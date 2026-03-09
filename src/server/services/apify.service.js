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
 * Extract just the city name from a full location string.
 * "Vancouver, BC, Canada"  → "Vancouver, BC"
 * "Calgary, AB, Canada"    → "Calgary, AB"
 */
function extractCityRegion(location) {
    if (!location) return '';
    const parts = location.split(',').map(s => s.trim()).filter(Boolean);
    const countryNames = ['canada', 'united states', 'usa', 'uk', 'united kingdom', 'australia', 'germany', 'france', 'india'];
    // Remove country name from the end
    const filtered = parts.filter(p => !countryNames.includes(p.toLowerCase()));
    return filtered.join(', ') || location;
}

/**
 * Detect 2-letter country code from a location string (UPPERCASE for misceres actor).
 */
function detectCountry(location) {
    const loc = (location || '').toLowerCase();
    if (loc.includes('canada') || loc.match(/\b(ab|bc|on|qc|sk|mb|ns|nb|pe|nl|nt|nu|yt)\b/)) return 'CA';
    if (loc.includes('united kingdom') || loc.includes(' uk') || loc.match(/\b(england|scotland|wales)\b/)) return 'GB';
    if (loc.includes('australia') || loc.match(/\b(nsw|vic|qld|wa|sa)\b/)) return 'AU';
    if (loc.includes('germany') || loc.includes('deutschland')) return 'DE';
    if (loc.includes('france')) return 'FR';
    if (loc.includes('india')) return 'IN';
    return 'US';
}

/**
 * Scrape real jobs from Indeed via the Apify misceres/indeed-scraper actor.
 *
 * Actor input fields:
 *   country   – 2-letter code UPPERCASE (e.g. "CA")
 *   position  – job title / keywords (e.g. "mechanic")
 *   location  – city + region (e.g. "Vancouver, BC")
 *   maxItems  – number of results
 *
 * Output fields per job:
 *   positionName, company, location, salary, description, url, id,
 *   postedAt, postingDateParsed, jobType, rating, reviewsCount
 */
const scrapeIndeedJobs = async ({ query, location, maxItems = 50 }) => {
    const client = getClient();

    const country = detectCountry(location);
    const cleanLocation = extractCityRegion(location);

    const input = {
        country,
        position: query,
        location: cleanLocation,
        maxItems,
    };

    console.log(`[Apify] Starting scrape — input:`, JSON.stringify(input));

    const run = await client.actor('misceres/indeed-scraper').call(input, {
        waitSecs: 300,  // 5 minutes — Apify can be slow
    });
    console.log(`[Apify] Run finished: ${run.id}, status: ${run.status}`);

    if (run.status !== 'SUCCEEDED') {
        console.error(`[Apify] Run failed with status: ${run.status}`);
        return [];
    }

    const { items } = await client.dataset(run.defaultDatasetId).listItems();
    console.log(`[Apify] ${items.length} items from dataset ${run.defaultDatasetId}`);

    if (items.length === 0) {
        console.warn(`[Apify] WARNING: 0 items returned for position="${query}" location="${cleanLocation}" country="${country}"`);
    }

    return items;
};

module.exports = { scrapeIndeedJobs };
