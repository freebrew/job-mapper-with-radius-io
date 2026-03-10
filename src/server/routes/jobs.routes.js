const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const apifyService = require('../services/apify.service');
const { geocodeAddress } = require('../services/geocode.service');

// ── Relevance Filter ──────────────────────────────────────────────────────────
// Strip common English suffixes to get a comparable root word.
// Order matters: longest suffixes first.
const SUFFIXES = [
    'ationists', 'ationalist', 'ationists', 'alists', 'ionist',
    'ionists', 'ising', 'izing', 'ists', 'iers', 'ers', 'ing',
    'ings', 'tion', 'tions', 'ies', 'ist', 'es', 'er', 'ly', 's', 'e'
];

function stemWord(word) {
    const w = word.toLowerCase();
    for (const sfx of SUFFIXES) {
        if (w.endsWith(sfx) && w.length - sfx.length >= 3) {
            return w.slice(0, -sfx.length);
        }
    }
    return w;
}

/**
 * Returns true if the job title is relevant to the search query.
 *
 * Since borderline/indeed-scraper already applies keyword filtering at Indeed's
 * search level, our job here is only to catch truly unrelated results that
 * slip through — NOT to do strict matching.
 *
 * Rules:
 *  1. Always pass if the title directly contains a query word.
 *  2. Pass if any 4+ char root of any query word appears in the title.
 *  3. Always drop generic/empty placeholders like "Untitled Position".
 *  4. If no match found, still PASS (trust the actor) — better to show
 *     a borderline result than to silently over-filter.
 */
function isTitleRelevant(jobTitle, searchQuery) {
    if (!jobTitle || !searchQuery) return true;

    // Drop known garbage titles regardless of query
    const GARBAGE = ['untitled position', 'untitled job', 'job opening'];
    if (GARBAGE.includes(jobTitle.toLowerCase().trim())) return false;

    const titleLower = jobTitle.toLowerCase();
    const queryWords = searchQuery.toLowerCase().split(/\s+/).filter(w => w.length >= 3);
    if (queryWords.length === 0) return true;

    // Check each query word for a match in the title
    const matched = queryWords.some(word => {
        if (titleLower.includes(word)) return true;           // exact substring
        const root = stemWord(word);
        if (root.length >= 4 && titleLower.includes(root)) return true; // root match
        return false;
    });

    // If no word matched at all, still let it through — the actor's search
    // already filtered by relevance. Only block garbage titles above.
    return true;
}

/**
 * Map borderline/indeed-scraper output to our internal job format.
 *
 * ACTUAL actor schema (verified against dataset JSON):
 *   title, key (jobKey), jobUrl, datePublished
 *   employer: { name, ratingsValue, ratingsCount }
 *   location: { latitude, longitude, city, streetAddress, admin1Code }
 *   baseSalary: { min, max, unitOfWork }   ← NOT salary.salaryMin/Max
 *   jobTypes:   { CODE: "Part-time", ... } ← object, not array
 *   description: { html, text }
 */
function mapApifyJob(raw) {
    const title = raw.title || 'Untitled Position';

    // employer.name is the correct field (not companyName)
    const company = raw.employer?.name || raw.companyName || 'Unknown Employer';

    // ── Location & Coordinates ─────────────────────────────────────
    const loc = raw.location || {};
    const lat = loc.latitude || null;
    const lng = loc.longitude || null;
    const locStr = [
        loc.streetAddress && loc.streetAddress !== loc.city ? loc.streetAddress : null,
        loc.city,
        loc.admin1Code
    ].filter(Boolean).join(', ') || 'Remote';

    // ── Salary — baseSalary.min/max/unitOfWork ─────────────────────
    const sal = raw.baseSalary || raw.salary || {};
    // unitOfWork values: "YEAR","HOUR","WEEK","MONTH" (uppercase from actor)
    const salType = (sal.unitOfWork || sal.salaryType || 'YEAR').toUpperCase();
    // jobTypes is an object { CODE: label }, check label values for part-time
    const jobTypeValues = Object.values(raw.jobTypes || raw.jobType || {});
    const isPartTime = jobTypeValues.some(t => typeof t === 'string' && t.toLowerCase().includes('part'));
    let multiplier = 1;
    if (salType === 'HOUR') multiplier = isPartTime ? 1040 : 2080;
    if (salType === 'WEEK') multiplier = 52;
    if (salType === 'MONTH') multiplier = 12;
    const rawMin = sal.min ?? sal.salaryMin ?? null;
    const rawMax = sal.max ?? sal.salaryMax ?? null;
    const payMin = rawMin != null ? Math.round(rawMin * multiplier) : null;
    const payMax = rawMax != null ? Math.round(rawMax * multiplier) : null;
    const payHourly = salType === 'HOUR' ? (rawMax || rawMin || null) : null;
    const payType = isPartTime ? 'part-time' : salType.toLowerCase();

    // ── Rating — employer.ratingsValue ────────────────────────────
    const ratingVal = raw.employer?.ratingsValue ?? raw.rating?.rating ?? null;
    const rating = ratingVal && ratingVal > 0 ? parseFloat(ratingVal) : null;

    // ── IDs & URLs ────────────────────────────────────────────────
    const indeedJobId = raw.key || raw.jobKey || raw.jobUrl || `scraped-${Date.now()}`;
    const indeedUrl = raw.jobUrl || raw.url || '';
    const postedDate = raw.datePublished ? new Date(raw.datePublished) : null;
    // description is nested: { html, text }
    const description = raw.description?.html || raw.description?.text
        || raw.descriptionHtml || raw.descriptionText || null;

    return {
        title,
        company,
        location: locStr,
        lat,
        lng,
        payMin,
        payMax,
        payHourly,
        payType,
        rating,
        indeedUrl,
        indeedJobId,
        postedDate,
        description
    };
}


/**
 * Perform a job search — scrapes real Indeed jobs via Apify,
 * geocodes locations when coordinates missing, saves results to DB.
 *
 * POST /api/jobs/search
 */
router.post('/search', requireAuth, async (req, res, next) => {
    try {
        const userId = req.user.id;
        const { query, location, centerLat, centerLng, radiuses } = req.body;

        if (!query || !location || !centerLat || !centerLng) {
            return res.status(400).json({ error: 'Missing required search parameters' });
        }

        // Derive the Apify search radius from the user's largest inclusive zone.
        // Apify accepts miles as a string enum: '0','5','10','15','25','35','50','100'.
        function metersToApifyRadius(meters) {
            const effectiveM = Math.max(meters || 40000, 40000); // 40km minimum
            const miles = effectiveM / 1609.34;
            for (const opt of [5, 10, 15, 25, 35, 50, 100]) {
                if (opt >= miles) return String(opt);
            }
            return '100';
        }
        const inclusiveZones = (radiuses || []).filter(z => z.type === 'inclusive');
        const maxInclusiveMeters = inclusiveZones.length
            ? Math.max(...inclusiveZones.map(z => z.radiusMeters || 40000))
            : 40000; // default 40km
        const searchRadiusMiles = metersToApifyRadius(maxInclusiveMeters);
        console.log(`[Jobs] Zone radius: ${Math.round(maxInclusiveMeters / 1000)}km → Apify radius: ${searchRadiusMiles} miles`);

        // Prevent Express/Node from killing this long request
        req.setTimeout(0);

        // 1. Save the search profile
        const searchProfile = await prisma.searchProfile.create({
            data: {
                userId,
                name: `${query} in ${location}`,
                centerLat,
                centerLng,
                centerAddress: location,
                radiuses: radiuses || [],
                keywords: query
            }
        });

        // 2. Stream progress to client via NDJSON (newline-delimited JSON)
        res.setHeader('Content-Type', 'application/x-ndjson');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Transfer-Encoding', 'chunked');

        // sendEvent: write NDJSON line, awaiting drain if the buffer is full
        const sendEvent = (obj) => new Promise((resolve) => {
            try {
                const line = JSON.stringify(obj) + '\n';
                const ok = res.write(line);
                console.log(`[Jobs] sendEvent type=${obj.type} size=${line.length} writeOk=${ok}`);
                if (!ok) {
                    // Buffer full — wait for drain before continuing
                    res.once('drain', resolve);
                } else {
                    resolve();
                }
            } catch (e) {
                console.error(`[Jobs] sendEvent FAILED type=${obj.type}: ${e.message}`);
                resolve();
            }
        });

        await sendEvent({ type: 'status', message: 'Starting Indeed scrape...' });

        // 2b. Fetch jobs with progressive callback
        console.log(`[Jobs] Scraping Indeed for "${query}" in "${location}"...`);
        const searchCenter = { lat: centerLat, lng: centerLng, address: location };
        const scrapedJobs = await apifyService.scrapeIndeedJobs({
            query,
            location,
            maxItems: 50,
            searchRadiusMiles,
            onProgress: async (itemCount, newItems = []) => {
                await sendEvent({ type: 'progress', items: itemCount });

                if (newItems && newItems.length > 0) {
                    // Process this chunk immediately
                    const chunkProms = newItems.map(async (rawJob) => {
                        const mapped = mapApifyJob(rawJob);

                        // ── Relevance filter — drop jobs whose title doesn't match the search term ──
                        if (!isTitleRelevant(mapped.title, query)) {
                            console.log(`[Jobs] Filtered irrelevant: "${mapped.title}" for query "${query}"`);
                            return null;
                        }

                        // ── Resolve coordinates ────────────────────────────────────
                        let { lat, lng } = mapped;

                        if (!lat || !lng) {
                            // Apify returned the location as a plain string (e.g. "Ottawa, ON K1S 2L2")
                            // We must geocode it to get map-plottable coordinates.
                            try {
                                const coords = await geocodeAddress(mapped.location);
                                if (coords) {
                                    lat = coords.lat;
                                    lng = coords.lng;
                                    console.log(`[Jobs] Geocoded "${mapped.location}" → ${lat}, ${lng}`);
                                } else {
                                    // Geocoder returned nothing — fall back to search centre
                                    // so the job still appears on the map rather than being dropped.
                                    lat = searchCenter.lat;
                                    lng = searchCenter.lng;
                                    console.warn(`[Jobs] Geocode empty for "${mapped.location}" — using search centre`);
                                }
                            } catch (geoErr) {
                                // Network/quota error — fall back to search centre
                                lat = searchCenter.lat;
                                lng = searchCenter.lng;
                                console.warn(`[Jobs] Geocode error for "${mapped.location}": ${geoErr.message} — using search centre`);
                            }
                        }

                        // Build the client-facing job object BEFORE DB save,
                        // so a DB failure cannot silently drop the job from the map.
                        const clientJob = {
                            id: mapped.indeedJobId,
                            title: mapped.title,
                            company: mapped.company,
                            location: mapped.location,
                            lat,
                            lng,
                            payMin: mapped.payMin,
                            payMax: mapped.payMax,
                            payHourly: mapped.payHourly,
                            payType: mapped.payType,
                            rating: mapped.rating,
                            indeedUrl: mapped.indeedUrl,
                            indeedJobId: mapped.indeedJobId,
                            description: mapped.description,
                            postedDate: mapped.postedDate
                        };

                        // Save to DB in the background — never block or drop on failure
                        prisma.jobResult.upsert({
                            where: {
                                searchProfileId_indeedJobId: {
                                    searchProfileId: searchProfile.id,
                                    indeedJobId: mapped.indeedJobId
                                }
                            },
                            update: {
                                title: mapped.title,
                                company: mapped.company,
                                location: mapped.location,
                                lat,
                                lng,
                                payMin: mapped.payMin,
                                payMax: mapped.payMax,
                                rating: mapped.rating,
                                scrapedAt: new Date()
                            },
                            create: {
                                searchProfileId: searchProfile.id,
                                indeedJobId: mapped.indeedJobId,
                                title: mapped.title,
                                company: mapped.company,
                                location: mapped.location,
                                lat,
                                lng,
                                payMin: mapped.payMin,
                                payMax: mapped.payMax,
                                rating: mapped.rating,
                                indeedUrl: mapped.indeedUrl,
                                description: mapped.description,
                                postedDate: mapped.postedDate
                            }
                        }).catch(e => {
                            console.error(`[Jobs] DB save error for "${mapped.indeedJobId}": ${e.message}`);
                        });

                        return clientJob;
                    });

                    const processedChunk = (await Promise.all(chunkProms)).filter(Boolean);

                    // Stream jobs in small batches to avoid buffer overflow
                    const BATCH = 10;
                    for (let i = 0; i < processedChunk.length; i += BATCH) {
                        const batch = processedChunk.slice(i, i + BATCH);
                        await sendEvent({ type: 'jobs', jobs: batch });
                    }
                }
            }
        });
        console.log(`[Jobs] Apify run complete. Total scraped: ${scrapedJobs.length}`);

        // 3. Close the stream
        await sendEvent({ type: 'complete' });
        res.end();

    } catch (err) {
        console.error('[Jobs] Search error:', err.message);
        // If we already started streaming, send error as an event
        if (res.headersSent) {
            try {
                res.write(JSON.stringify({ type: 'error', message: err.message }) + '\n');
                res.end();
            } catch { }
        } else {
            next(err);
        }
    }
});

module.exports = router;
