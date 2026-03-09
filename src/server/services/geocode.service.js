const fetch = require('node-fetch');

/**
 * Google Geocoding Service
 * Resolves a location string (e.g. "123 Main St, Dallas, TX") to lat/lng coordinates.
 * Uses the Google Geocoding API with the project's API key.
 */

const GEOCODE_URL = 'https://maps.googleapis.com/maps/api/geocode/json';

// Simple in-memory cache to avoid re-geocoding the same address within a session
const geocodeCache = new Map();

/**
 * Geocode a location string to { lat, lng }.
 * Returns null if geocoding fails.
 *
 * @param {string} address — e.g. "Dallas, TX, USA" or "123 Main St, Houston"
 * @returns {Promise<{lat: number, lng: number} | null>}
 */
const geocodeAddress = async (address) => {
    if (!address) return null;

    // Check cache first
    const cacheKey = address.trim().toLowerCase();
    if (geocodeCache.has(cacheKey)) {
        return geocodeCache.get(cacheKey);
    }

    const apiKey = process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.warn('[Geocode] GOOGLE_MAPS_API_KEY not set in .env');
        return null;
    }

    try {
        const url = `${GEOCODE_URL}?address=${encodeURIComponent(address)}&key=${apiKey}`;
        const response = await fetch(url);
        const data = await response.json();

        if (data.status === 'OK' && data.results && data.results.length > 0) {
            const loc = data.results[0].geometry.location;
            const result = { lat: loc.lat, lng: loc.lng };

            // Cache the result
            geocodeCache.set(cacheKey, result);
            return result;
        } else {
            console.warn(`[Geocode] No results for "${address}": ${data.status}`);
            return null;
        }
    } catch (error) {
        console.error(`[Geocode] Error geocoding "${address}":`, error.message);
        return null;
    }
};

module.exports = {
    geocodeAddress
};
