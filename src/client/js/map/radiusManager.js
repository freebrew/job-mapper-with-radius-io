/**
 * Radius Manager
 * Handles the logic for rendering and tracking Inclusive (green) and Exclusive (red) search radiuses.
 * Each zone has its OWN center (address + lat/lng) — they are independent.
 */

export class RadiusManager {
    constructor(mapInstance) {
        this.map = mapInstance;
        this.zones = []; // { id, type, circleObj, radiusMeters, center: {lat, lng, address} }

        // Colors
        this.colors = {
            inclusive: {
                stroke: '#10b981',
                fill: '#10b981',
                fillOpacity: 0.15
            },
            exclusive: {
                stroke: '#ef4444',
                fill: '#ef4444',
                fillOpacity: 0.25
            }
        };
    }

    /**
     * @param {string} type 'inclusive' | 'exclusive'
     * @param {number} initialRadiusMeters
     * @param {{ lat: number, lng: number, address: string }} center — each zone gets its own center
     */
    addZone(type, initialRadiusMeters = 20000, center) {
        if (!center || !center.lat || !center.lng) {
            console.warn("Center coordinates required. Provide { lat, lng, address }.");
            return null;
        }

        const id = Date.now().toString();
        const colorOpts = this.colors[type];

        const circle = new google.maps.Circle({
            strokeColor: colorOpts.stroke,
            strokeOpacity: 0.8,
            strokeWeight: 2,
            fillColor: colorOpts.fill,
            fillOpacity: colorOpts.fillOpacity,
            map: this.map,
            center: { lat: center.lat, lng: center.lng },
            radius: initialRadiusMeters,
            editable: true,
            draggable: false
        });

        const zone = {
            id,
            type,
            circleObj: circle,
            radiusMeters: initialRadiusMeters,
            center: { lat: center.lat, lng: center.lng, address: center.address || '' }
        };

        // Listen for radius changes from circle edge drag
        google.maps.event.addListener(circle, 'radius_changed', () => {
            zone.radiusMeters = circle.getRadius();
            this._triggerCallback();
        });

        this.zones.push(zone);
        this._triggerCallback();
        return zone;
    }

    removeZone(id) {
        const index = this.zones.findIndex(z => z.id === id);
        if (index > -1) {
            this.zones[index].circleObj.setMap(null); // remove from map
            this.zones.splice(index, 1);
            this._triggerCallback();
        }
    }

    getZonesData() {
        return this.zones.map(z => ({
            id: z.id,
            type: z.type,
            radiusMeters: z.radiusMeters,
            center: z.center
        }));
    }

    /**
     * Check if a point falls inside ANY exclusion zone.
     * @returns {boolean} true if the job should be excluded
     */
    isExcluded(lat, lng) {
        return this.zones.some(z => {
            if (z.type !== 'exclusive') return false;
            const circleCenter = z.circleObj.getCenter();
            const circleRadius = z.circleObj.getRadius();
            const dist = google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(lat, lng),
                circleCenter
            );
            return dist <= circleRadius;
        });
    }

    /**
     * Check if a point falls inside AT LEAST ONE inclusive zone.
     * Jobs that are NOT inside any inclusive zone should not be shown as pins.
     * @returns {boolean} true if the job is inside an inclusive zone
     */
    isIncluded(lat, lng) {
        const inclusiveZones = this.zones.filter(z => z.type === 'inclusive');
        // If no inclusive zones defined yet, allow all (don't hide everything)
        if (inclusiveZones.length === 0) return true;

        return inclusiveZones.some(z => {
            const circleCenter = z.circleObj.getCenter();
            const circleRadius = z.circleObj.getRadius();
            const dist = google.maps.geometry.spherical.computeDistanceBetween(
                new google.maps.LatLng(lat, lng),
                circleCenter
            );
            return dist <= circleRadius;
        });
    }

    /**
     * Returns a LatLngBounds that encompasses ALL current zones.
     * Used by map controller to fit the viewport around all zones.
     * @returns {google.maps.LatLngBounds | null}
     */
    getAllZonesBounds() {
        if (this.zones.length === 0) return null;

        const bounds = new google.maps.LatLngBounds();
        this.zones.forEach(z => {
            // Extend bounds by the circle's bounding box
            const circleBounds = z.circleObj.getBounds();
            if (circleBounds) bounds.union(circleBounds);
        });
        return bounds;
    }

    // Callbacks for UI updates
    onChange(callback) {
        this.callback = callback;
    }

    _triggerCallback() {
        if (this.callback) {
            this.callback(this.getZonesData());
        }
    }
}
