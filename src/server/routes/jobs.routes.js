const express = require('express');
const router = express.Router();
const prisma = require('../config/db');
const { requireAuth } = require('../middleware/auth');
const apifyService = require('../services/apify.service');
const { geocodeAddress } = require('../services/geocode.service');

/**
 * Map misceres/indeed-scraper output to our internal job format.
 *
 * misceres schema:
 *   positionName, company, location (string), salary (string),
 *   description (string), url, id, postedAt, postingDateParsed,
 *   jobType, rating, reviewsCount
 */
function parseSalary(salaryStr) {
    if (!salaryStr || typeof salaryStr !== 'string') return { min: null, max: null };
    // Extract numbers: "$40–$60 an hour", "$75,000–$100,000 a year"
    const nums = salaryStr.match(/[\d,.]+/g);
    if (!nums || nums.length === 0) return { min: null, max: null };

    const values = nums.map(n => parseFloat(n.replace(/,/g, '')));
    let multiplier = 1;
    const lower = salaryStr.toLowerCase();
    if (lower.includes('hour')) multiplier = 2080;
    else if (lower.includes('week')) multiplier = 52;
    else if (lower.includes('month')) multiplier = 12;
    // 'year' or 'annually' = 1

    return {
        min: values[0] ? Math.round(values[0] * multiplier) : null,
        max: values[1] ? Math.round(values[1] * multiplier) : (values[0] ? Math.round(values[0] * multiplier) : null)
    };
}

function mapApifyJob(raw, searchCenter) {
    const title = raw.positionName || raw.title || 'Untitled Position';
    const company = raw.company || 'Unknown Employer';
    const locationStr = (typeof raw.location === 'string' ? raw.location : null)
        || searchCenter.address || 'Remote';

    // misceres doesn't provide coordinates — will be geocoded later
    const lat = null;
    const lng = null;

    // Parse salary string to annual min/max
    const { min: payMin, max: payMax } = parseSalary(raw.salary);

    const rating = raw.rating || null;
    const indeedUrl = raw.url || '';
    const indeedJobId = raw.id || raw.url || `scraped-${Date.now()}`;
    const postedDate = raw.postingDateParsed || null;

    return {
        title,
        company,
        location: locationStr,
        lat,
        lng,
        payMin,
        payMax,
        rating: rating ? parseFloat(rating) : null,
        indeedUrl,
        indeedJobId,
        postedDate
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

        // 2. Fetch real jobs from Indeed via Apify
        console.log(`[Jobs] Scraping Indeed for "${query}" in "${location}"...`);
        const scrapedJobs = await apifyService.scrapeIndeedJobs({
            query,
            location,
            maxItems: 50
        });
        console.log(`[Jobs] Apify returned ${scrapedJobs.length} raw jobs.`);

        // 2.5 Keyword relevance filter
        // misceres/indeed-scraper returns mostly relevant jobs, but we still score & sort.
        const getTitle = (j) => (j.positionName || j.title || '').toLowerCase();
        const getDescText = (j) => (typeof j.description === 'string' ? j.description.toLowerCase() : '');

        // Expand abbreviations
        const ABBR = {
            rmt: ['massage therapist', 'registered massage therapist', 'rmt', 'massage'],
            rn: ['registered nurse', 'nurse', 'rn'],
            lpn: ['licensed practical nurse', 'practical nurse', 'lpn'],
            cpa: ['accountant', 'accounting', 'cpa', 'chartered professional accountant'],
            hr: ['human resources', 'hr'],
            ot: ['occupational therapist', 'ot'],
            pt: ['physiotherapist', 'physical therapist', 'pt'],
            dev: ['developer', 'software engineer', 'programmer'],
        };

        const qLower = query.toLowerCase().trim();

        // Build token list: full phrase + individual words + abbreviation expansions
        const STOP_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'in', 'at', 'for', 'of', 'to', 'is', 'on', 'jobs', 'job', 'near', 'me']);
        const words = qLower.split(/\s+/).filter(w => w.length > 1 && !STOP_WORDS.has(w));
        const tokens = new Set([qLower, ...words, ...(ABBR[qLower] || [])]);
        for (const w of words) {
            if (ABBR[w]) ABBR[w].forEach(t => tokens.add(t));
        }
        const tokenArr = [...tokens];

        // Score each job by title AND description.text matches
        const scored = scrapedJobs.map(j => {
            const title = getTitle(j);
            const desc = getDescText(j).substring(0, 1000);  // first 1000 chars of description
            let score = 0;
            for (const tok of tokenArr) {
                if (title.includes(tok)) {
                    score += tok.includes(' ') ? 3 : 2;  // title match = strong
                } else if (desc.includes(tok)) {
                    score += 1;  // description match = weaker but still relevant
                }
            }
            return { job: j, score };
        });

        // Sort by relevance — best matches first for DB storage
        const sorted = scored.sort((a, b) => b.score - a.score);
        const matchCount = scored.filter(x => x.score > 0).length;

        console.log(`[Jobs] Relevance: ${matchCount}/${scrapedJobs.length} matched (tokens: ${tokenArr.join(', ')})`);

        // Save ALL to DB (for data completeness) but track which are relevant
        const jobsToProcess = sorted;



        const savedJobs = [];       // ALL saved jobs
        const relevantJobs = [];    // ONLY keyword-matched jobs (returned to client)
        const searchCenter = { lat: centerLat, lng: centerLng, address: location };

        for (let idx = 0; idx < jobsToProcess.length; idx++) {
            const { job: rawJob, score } = jobsToProcess[idx];
            try {
                const mapped = mapApifyJob(rawJob, searchCenter);

                // Geocode if coordinates are missing
                let { lat, lng } = mapped;
                if (!lat || !lng) {
                    const coords = await geocodeAddress(mapped.location || location);
                    if (coords) {
                        lat = coords.lat;
                        lng = coords.lng;
                    } else {
                        // Last resort: use search center
                        lat = centerLat;
                        lng = centerLng;
                    }
                }

                const jobResult = await prisma.jobResult.upsert({
                    where: {
                        searchProfileId_indeedJobId: {
                            searchProfileId: searchProfile.id,
                            indeedJobId: mapped.indeedJobId
                        }
                    },
                    update: {},
                    create: {
                        searchProfileId: searchProfile.id,
                        indeedJobId: mapped.indeedJobId,
                        title: mapped.title,
                        company: mapped.company,
                        location: mapped.location,
                        lat: lat,
                        lng: lng,
                        indeedUrl: mapped.indeedUrl,
                        payMin: mapped.payMin,
                        payMax: mapped.payMax,
                        rating: mapped.rating
                    }
                });

                const enriched = { ...jobResult, postedDate: mapped.postedDate };
                savedJobs.push(enriched);

                // Only include keyword-matched jobs in the response
                if (score > 0) {
                    relevantJobs.push(enriched);
                }
            } catch (e) {
                if (idx < 3) console.error(`[Jobs] SAVE ERROR job #${idx} "${rawJob.title}":`, e.message);
            }
        }

        console.log(`[Jobs] Saved ${savedJobs.length}/${jobsToProcess.length} to DB. Returning ${relevantJobs.length} relevant to client.`);

        res.json({
            profile: searchProfile,
            resultsCount: relevantJobs.length,
            jobs: relevantJobs
        });

    } catch (err) {
        console.error('[Jobs] Search error:', err.message);
        next(err);
    }
});

module.exports = router;
