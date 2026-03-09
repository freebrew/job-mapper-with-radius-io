const express = require('express');
const router = express.Router();

/**
 * Global 3D Building Data Cache
 * ------------------------------------------------------------------
 * Stores building footprint/height data fetched during user sessions.
 * Key: "lat,lng" rounded to 3 decimal places (≈111m grid cells).
 * Value: { buildings: [...], fetchedAt: timestamp, hitCount: number }
 *
 * This is an in-memory cache shared across all sessions — any user who
 * visits a location benefits from previous users' fetched 3D data.
 * Cache evicts entries older than 24 hours to stay fresh.
 */
const buildingCache = new Map();
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function getCacheKey(lat, lng) {
    return `${parseFloat(lat).toFixed(3)},${parseFloat(lng).toFixed(3)}`;
}

function evictStaleEntries() {
    const cutoff = Date.now() - CACHE_TTL_MS;
    for (const [key, val] of buildingCache) {
        if (val.fetchedAt < cutoff) buildingCache.delete(key);
    }
}

/**
 * GET /api/buildings?lat={lat}&lng={lng}
 * Returns cached 3D building data for the given location.
 * If no data cached, returns empty (client should fetch from Google Maps 3D Tiles API).
 */
router.get('/', (req, res) => {
    evictStaleEntries();
    const { lat, lng } = req.query;
    if (!lat || !lng) return res.status(400).json({ error: 'lat and lng required' });

    const key = getCacheKey(lat, lng);
    const cached = buildingCache.get(key);

    if (cached) {
        cached.hitCount++;
        return res.json({
            cached: true,
            hitCount: cached.hitCount,
            fetchedAt: new Date(cached.fetchedAt).toISOString(),
            buildings: cached.buildings,
        });
    }

    res.json({ cached: false, buildings: [] });
});

/**
 * POST /api/buildings
 * Stores 3D building data fetched during a user session.
 * Body: { lat, lng, buildings: [...] }
 *
 * Client calls this after successfully loading 3D tiles for a location,
 * making the data available to all subsequent visitors of that area.
 */
router.post('/', (req, res) => {
    evictStaleEntries();
    const { lat, lng, buildings } = req.body;
    if (!lat || !lng || !Array.isArray(buildings)) {
        return res.status(400).json({ error: 'lat, lng, and buildings array required' });
    }

    const key = getCacheKey(lat, lng);
    const existing = buildingCache.get(key);

    buildingCache.set(key, {
        buildings: buildings.slice(0, 500), // cap at 500 buildings per cell
        fetchedAt: Date.now(),
        hitCount: existing ? existing.hitCount : 0,
    });

    res.json({
        success: true,
        key,
        cached: buildingCache.size,
        message: `3D data for ${key} cached globally (${buildings.length} buildings)`
    });
});

/**
 * GET /api/buildings/stats
 * Returns cache statistics (number of cached locations, total buildings).
 */
router.get('/stats', (req, res) => {
    evictStaleEntries();
    let totalBuildings = 0;
    for (const val of buildingCache.values()) totalBuildings += val.buildings.length;

    res.json({
        cachedLocations: buildingCache.size,
        totalBuildings,
        ttlHours: CACHE_TTL_MS / 3600000,
    });
});

module.exports = router;
