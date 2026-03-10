const { ApifyClient } = require('apify-client');

// Client is lazily initialized on first call to ensure .env is loaded
let _client = null;
function getClient() {
    if (!_client) {
        const token = process.env.APIFY_API_TOKEN;
        if (!token) throw new Error('[Apify Service] APIFY_API_TOKEN is not set in .env');
        console.log(`[Apify] Initializing client with token: ${token.substring(0, 15)}...`);
        _client = new ApifyClient({ token });
    }
    return _client;
}

/**
 * Extract just the city + province from a full Google Places address string.
 *
 * "Calgary Tower, 9 Ave SW, Calgary, AB T2G 2B3, Canada" → "Calgary, AB"
 * "Vancouver, BC, Canada"                                → "Vancouver, BC"
 */
function extractCityRegion(location) {
    if (!location) return '';

    const provinceCodes = new Set([
        'AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'NT', 'NU', 'ON', 'PE', 'QC', 'SK', 'YT',
        'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
        'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
        'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
        'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
        'NSW', 'VIC', 'QLD', 'SA', 'TAS', 'ACT',
    ]);

    const parts = location.split(',').map(s => s.trim()).filter(Boolean);

    for (let i = parts.length - 1; i >= 1; i--) {
        const firstToken = parts[i].split(' ')[0].toUpperCase();
        if (provinceCodes.has(firstToken)) {
            return `${parts[i - 1]}, ${firstToken}`;
        }
    }

    const countryNames = ['canada', 'united states', 'usa', 'uk', 'united kingdom', 'australia', 'germany', 'france', 'india'];
    const filtered = parts.filter(p => !countryNames.includes(p.toLowerCase()));
    if (filtered.length >= 2) return filtered.slice(-2).join(', ');
    return filtered.join(', ') || location;
}

/**
 * Detect lowercase 2-letter country code.
 * borderline/indeed-scraper requires lowercase country codes.
 */
function detectCountry(location) {
    const loc = (location || '').toLowerCase();
    if (loc.includes('canada') || loc.match(/\b(ab|bc|on|qc|sk|mb|ns|nb|pe|nl|nt|nu|yt)\b/)) return 'ca';
    if (loc.includes('united kingdom') || loc.includes(' uk') || loc.match(/\b(england|scotland|wales)\b/)) return 'uk';
    if (loc.includes('australia') || loc.match(/\b(nsw|vic|qld|wa|sa)\b/)) return 'au';
    if (loc.includes('germany') || loc.includes('deutschland')) return 'de';
    if (loc.includes('france')) return 'fr';
    if (loc.includes('india')) return 'in';
    return 'us';
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Scrape jobs using borderline/indeed-scraper (MXLpngmVpE8WTESQr).
 *
 * Input fields: query (keyword), location, country (lowercase), maxRows
 * Output: title, companyName, location.latitude/longitude, salary.salaryMin/Max,
 *         rating.rating, jobKey, jobUrl, descriptionHtml, datePublished
 *
 * NOTE: dataset.itemCount is read directly since stats.outputItems may lag.
 *       We read dataset.itemCount directly to detect new items.
 *
 * @param {Object}   opts
 * @param {string}   opts.query       - Job search keywords
 * @param {string}   opts.location    - Location string (full Google Places address is OK)
 * @param {number}   opts.maxItems    - Max results
 * @param {function} opts.onProgress  - async Callback(totalCount, newItems[])
 * @returns {Array}  All scraped items
 */
const scrapeIndeedJobs = async ({ query, location, maxItems = 50, searchRadiusMiles = '10', onProgress }) => {
    const client = getClient();

    const country = detectCountry(location);
    const cleanLocation = extractCityRegion(location);

    const input = {
        country,
        query,                  // borderline uses 'query' for keywords
        location: cleanLocation,
        maxRows: maxItems,    // borderline uses 'maxRows'
        radius: searchRadiusMiles, // derived from user's drawn zone
        sort: 'relevance',
        enableUniqueJobs: true,
    };

    console.log(`[Apify] Starting borderline/indeed-scraper — input:`, JSON.stringify(input));

    const run = await client.actor('MXLpngmVpE8WTESQr').start(input);
    const runId = run.id;
    const datasetId = run.defaultDatasetId;
    console.log(`[Apify] Run started: ${runId}, dataset: ${datasetId}`);

    // ── POLL ─────────────────────────────────────────────────────────────────
    const POLL_INTERVAL = 5_000;
    const MAX_TOTAL_MS = 5 * 60 * 1000;
    const IDLE_TIMEOUT = 90_000;

    let lastItemCount = 0;
    let offset = 0;
    let lastItemChangeAt = Date.now();
    const startedAt = Date.now();
    const allItems = [];

    while (true) {
        await sleep(POLL_INTERVAL);
        const elapsed = Date.now() - startedAt;

        if (elapsed > MAX_TOTAL_MS) {
            console.warn(`[Apify] Hit 5-min ceiling, stopping.`);
            break;
        }

        try {
            const runInfo = await client.run(runId).get();
            const status = runInfo.status;

            // Read dataset.itemCount directly — more reliable than stats.outputItems
            const datasetInfo = await client.dataset(datasetId).get();
            const itemCount = datasetInfo.itemCount || 0;

            console.log(`[Apify] Poll: status=${status}, items=${itemCount}, elapsed=${Math.round(elapsed / 1000)}s`);

            if (itemCount > lastItemCount) {
                lastItemChangeAt = Date.now();
                lastItemCount = itemCount;

                const newItemsRes = await client.dataset(datasetId).listItems({ offset });
                const newItems = newItemsRes.items;

                if (newItems.length > 0) {
                    offset += newItems.length;
                    allItems.push(...newItems);
                    // AWAIT the callback so DB + streaming completes before we continue
                    if (onProgress) await onProgress(itemCount, newItems);
                }
            } else {
                if (onProgress) await onProgress(itemCount, []);
            }

            if (['SUCCEEDED', 'FAILED', 'ABORTED', 'TIMED-OUT'].includes(status)) {
                // Final sweep: catch any items that arrived between last poll and end
                const finalRes = await client.dataset(datasetId).listItems({ offset });
                const finalItems = finalRes.items;
                if (finalItems.length > 0) {
                    console.log(`[Apify] Final sweep: ${finalItems.length} more items.`);
                    allItems.push(...finalItems);
                    if (onProgress) await onProgress(allItems.length, finalItems);
                }
                console.log(`[Apify] Run ended: ${status}, total: ${allItems.length}`);
                break;
            }

            if (Date.now() - lastItemChangeAt > IDLE_TIMEOUT && itemCount > 0) {
                console.warn(`[Apify] Idle ${IDLE_TIMEOUT / 1000}s — stopping.`);
                break;
            }
        } catch (pollErr) {
            console.error(`[Apify] Poll error: ${pollErr.message}`);
        }
    }

    if (allItems.length === 0) {
        console.warn(`[Apify] WARNING: 0 items for position="${query}" location="${cleanLocation}" country="${country}"`);
    }
    return allItems;
};

module.exports = { scrapeIndeedJobs };
