/**
 * Map Controller — Animation Config
 */
if (!window.ANIM_CONFIG) {
    const saved = (() => { try { return JSON.parse(localStorage.getItem('anim_config') || 'null'); } catch { return null; } })();
    window.ANIM_CONFIG = saved || {
        frameMs: 180,
        framesPerPhase: 10,
        northResetMs: 8,
        holdMs: 0,
    };
}

/**
 * Map Controller
 * Universal Map ID: 1a69e9680804148ef13dfe31  (WebGL vector map)
 *
 * TILT: Enforced via `map.setTilt(45)` on every idle AND in every moveCamera call.
 *       `map.getTilt()` can return null on vector maps; we use `setTilt` which is
 *       unconditional, not guarded by a comparison.
 *
 * ZOOM FLOOR: The circle must occupy ≥ 25 % of the visible map area (between panels).
 *             `_minZoomFor25Pct(lat, radiusMeters)` computes this floor.
 *
 * VIEWPORT OFFSET: Left panel (220 px) + right panel (280 px) are subtracted from
 *                  the full map width. The camera center is shifted so the target
 *                  lands visually in the centre of the remaining space.
 */
export class MapController {
    constructor(elementId) {
        this.elementId = elementId;
        this.map = null;
        this.defaultCenter = { lat: 30.2672, lng: -97.7431 };
        this._flying = false;
        this._flyTimers = [];
        this._northTimers = [];

        this.LEFT_PANEL_PX = 220;
        this.RIGHT_PANEL_PX = 280;
        this._idleBusy = false;  // prevents idle → setTilt → idle loop
    }

    // ─── init ────────────────────────────────────────────────────────────────

    async init() {
        this.map = new google.maps.Map(document.getElementById(this.elementId), {
            center: this.defaultCenter,
            zoom: 15,
            mapId: '1a69e9680804148ef13dfe31',
            renderingType: google.maps.RenderingType.VECTOR,   // ← REQUIRED for tilt to work
            colorScheme: 'DARK',
            disableDefaultUI: true,
            zoomControl: true,
            tilt: 45,
            heading: 0,
            tiltInteractionEnabled: true,    // Allow Ctrl+drag to tilt
            headingInteractionEnabled: true,    // Allow Ctrl+drag to rotate
        });

        // Correct tilt/heading ONLY when they've actually drifted.
        // Guard with _idleBusy to prevent setTilt → idle → setTilt loop.
        this.map.addListener('idle', () => {
            if (this._flying || this._idleBusy) return;
            this._idleBusy = true;

            const tilt = this.map.getTilt();
            if (tilt !== null && tilt !== undefined && tilt < 40) {
                this.map.moveCamera({ tilt: 45 });
            }

            this._resetToNorth();

            // Release guard after a short delay so the idle triggered by
            // our own corrections doesn't re-enter.
            setTimeout(() => { this._idleBusy = false; }, 300);
        });

        return this.map;
    }

    // ─── Viewport helpers ────────────────────────────────────────────────────

    /** Net pixel delta so target lands at visual centre between panels. */
    _panelOffsetPx() {
        // visibleCentreX = LEFT + visibleW/2 ; mapCentreX = totalW/2
        // delta = visibleCentreX - mapCentreX = LEFT - (LEFT+RIGHT)/2 = (LEFT-RIGHT)/2
        return {
            x: (this.LEFT_PANEL_PX - this.RIGHT_PANEL_PX) / 2,   // = -30 px
            y: 30,                                                   // navbar offset
        };
    }

    _pixelOffsetToLatLng(lat, lng, zoom, px) {
        const scale = Math.pow(2, zoom);
        const latPerPx = 360 / (256 * scale);
        const lngPerPx = 360 / (256 * scale * Math.cos(lat * Math.PI / 180));
        return {
            lat: lat - px.y * latPerPx,
            lng: lng - px.x * lngPerPx,
        };
    }

    /** Camera centre adjusted so target appears in the visible viewport centre. */
    _adjustedCenter(lat, lng, zoom) {
        return this._pixelOffsetToLatLng(lat, lng, zoom, this._panelOffsetPx());
    }

    /** Visible area dimensions (px) between the two panels. */
    _visibleDims() {
        const el = this.map?.getDiv();
        const totalW = el?.offsetWidth || window.innerWidth;
        const totalH = el?.offsetHeight || window.innerHeight;
        return {
            w: Math.max(200, totalW - this.LEFT_PANEL_PX - this.RIGHT_PANEL_PX),
            h: Math.max(200, totalH - 60),
        };
    }

    // ─── Zoom floor (25 % screen area rule) ──────────────────────────────────

    /**
     * Minimum zoom level at which the given circle covers ≥ 25 % of the
     * visible map area.
     *
     * Circle area on screen (px²) = π × r_px²
     * Screen area (px²)           = visW × visH
     * Constraint: π × r_px² ≥ 0.25 × visW × visH
     *   → r_px ≥ sqrt(0.25 × visW × visH / π)
     *   → (R × 256 × 2^zoom / earthCirc) ≥ minRpx
     *   → zoom ≥ log2(minRpx × earthCirc / (R × 256))
     */
    _minZoomFor25Pct(lat, radiusMeters) {
        const { w, h } = this._visibleDims();
        const minRpx = Math.sqrt(0.25 * w * h / Math.PI);
        const earthCirc = 40075016.686 * Math.cos(lat * Math.PI / 180);
        return Math.log2(minRpx * earthCirc / (radiusMeters * 256));
    }

    // ─── Tile prewarming ─────────────────────────────────────────────────────

    prewarmTiles(lat, lng) {
        if (!this.map) return;
        const zoom = 15;
        const adj = this._adjustedCenter(lat, lng, zoom);
        this.map.moveCamera({ center: adj, zoom, tilt: 45, heading: 0 });
        this.map.setTilt(45);
        setTimeout(() => {
            if (!this._flying) {
                this.map.moveCamera({ center: adj, zoom: zoom - 1, tilt: 45, heading: 0 });
                this.map.setTilt(45);
            }
        }, 700);
    }

    // ─── Animation ───────────────────────────────────────────────────────────

    _cancelFlight() {
        this._flyTimers.forEach(t => clearTimeout(t));
        this._northTimers.forEach(t => clearTimeout(t));
        this._flyTimers = [];
        this._northTimers = [];
        this._flying = false;
    }

    _lerp(a, b, t) { return a + (b - a) * t; }
    _ease(t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; }

    _animatePhase(from, to, startDelay = 0) {
        const { frameMs, framesPerPhase, holdMs = 0 } = window.ANIM_CONFIG;
        const timers = [];
        for (let i = 1; i <= framesPerPhase; i++) {
            const t = this._ease(i / framesPerPhase);
            timers.push(setTimeout(() => {
                this.map.moveCamera({
                    center: { lat: this._lerp(from.lat, to.lat, t), lng: this._lerp(from.lng, to.lng, t) },
                    zoom: this._lerp(from.zoom, to.zoom, t),
                    tilt: this._lerp(from.tilt, to.tilt, t),
                    heading: this._lerp(from.heading, to.heading, t),
                });
                // NOTE: Do NOT call setTilt separately — moveCamera already
                // includes tilt, and a separate call triggers an extra idle event
                // which causes the wobble loop.
            }, startDelay + holdMs + i * frameMs));
        }
        return timers;
    }

    _phaseDur() {
        const { frameMs, framesPerPhase, holdMs = 0 } = window.ANIM_CONFIG;
        return holdMs + framesPerPhase * frameMs;
    }

    _distM(lat1, lng1, lat2, lng2) {
        const R = 6371000, φ1 = lat1 * Math.PI / 180, φ2 = lat2 * Math.PI / 180;
        const a = Math.sin((lat2 - lat1) * Math.PI / 360) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin((lng2 - lng1) * Math.PI / 360) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    _resetToNorth() {
        if (!this.map) return;
        const h = this.map.getHeading() || 0;
        if (Math.abs(h) < 2) return;
        const { northResetMs = 8, frameMs = 180 } = window.ANIM_CONFIG;
        this._northTimers.forEach(t => clearTimeout(t));
        this._northTimers = [];

        // Suppress idle handler during the entire north-reset animation
        this._idleBusy = true;

        for (let i = 1; i <= northResetMs; i++) {
            const t = this._ease(i / northResetMs);
            this._northTimers.push(setTimeout(() => {
                let heading = h * (1 - t);
                while (heading > 180) heading -= 360;
                while (heading < -180) heading += 360;
                this.map.moveCamera({ heading });
            }, i * frameMs));
        }

        // Release idle guard after full animation completes
        const totalMs = northResetMs * frameMs;
        this._northTimers.push(setTimeout(() => {
            this._idleBusy = false;
        }, totalMs + 100));
    }

    /**
     * Fly to a location.
     * • LOCAL (< 50 km): single smooth phase — no zoom-out drama.
     * • LONG-DISTANCE (> 50 km): 3-phase pull-back → pan → zoom-in.
     */
    cinematicFlyTo(lat, lng, { zoom = 15, heading = 0, tilt = 45 } = {}) {
        if (!this.map) return;
        this._cancelFlight();
        this._flying = true;

        const adj = this._adjustedCenter(lat, lng, zoom);
        const cur = this.map.getCenter();
        const curLat = cur.lat(), curLng = cur.lng();
        const curZoom = this.map.getZoom() || 15;
        const curTilt = this.map.getTilt() ?? 45;
        const curHead = this.map.getHeading() || 0;
        const dist = this._distM(curLat, curLng, lat, lng);
        const pd = this._phaseDur();

        const from = { lat: curLat, lng: curLng, zoom: curZoom, tilt: curTilt, heading: curHead };
        const to = { lat: adj.lat, lng: adj.lng, zoom, tilt, heading };

        if (dist > 50000) {
            // ── Long-distance: 3-phase with pull-back ──
            const { w } = this._visibleDims();
            const ec = 40075016.686 * Math.cos(((curLat + lat) / 2) * Math.PI / 180);
            const pbZoom = Math.max(5, Math.log2(ec * w / (dist * 2.0 * 256)));
            const mid = { lat: adj.lat, lng: adj.lng, zoom: pbZoom, tilt: 20, heading };
            const p1end = { lat: curLat, lng: curLng, zoom: pbZoom, tilt: 20, heading: curHead };

            const t1 = this._animatePhase(from, p1end, 0);
            const t2 = this._animatePhase(p1end, mid, pd);
            const t3 = this._animatePhase(mid, to, pd * 2);
            const done = setTimeout(() => { this._flying = false; }, pd * 3 + 50);
            this._flyTimers = [...t1, ...t2, ...t3, done];
        } else {
            // ── Local: single smooth glide — no zoom-out ──
            const t1 = this._animatePhase(from, to, 0);
            const done = setTimeout(() => { this._flying = false; }, pd + 50);
            this._flyTimers = [...t1, done];
        }
    }

    // ─── fitAllZones ─────────────────────────────────────────────────────────

    /**
     * Fit the viewport to show ALL circles, fully visible between panels.
     *
     * ZOOM LOGIC:
     *  • `lngMeters` / `latMeters` already span the full diameter of bounds.
     *  • Use 1.2× padding (10 % margin each side).
     *  • Apply 25 % area floor using the largest inclusive radius.
     */
    fitAllZones(radiusManager) {
        if (!this.map || !radiusManager) return;
        const bounds = radiusManager.getAllZonesBounds();
        if (!bounds) return;

        const ne = bounds.getNorthEast(), sw = bounds.getSouthWest();
        const cLat = (ne.lat() + sw.lat()) / 2;
        const cLng = (ne.lng() + sw.lng()) / 2;
        const { w, h } = this._visibleDims();

        // Size of bounds in metres
        const latMeters = Math.abs(ne.lat() - sw.lat()) * 111320;
        const earthCirc = 40075016.686 * Math.cos(cLat * Math.PI / 180);
        const lngMeters = Math.abs(ne.lng() - sw.lng()) * (earthCirc / 360);

        // 1.2 = 10 % margin each side around the full diameter span
        const PADDING = 1.2;
        const zoomW = Math.log2(earthCirc * w / (lngMeters * PADDING * 256));
        const zoomH = Math.log2(111320 * 360 * h / (latMeters * PADDING * 256));
        let zoom = Math.min(zoomW, zoomH);

        // Compute the largest inclusive zone radius for the 25 % floor
        const zones = radiusManager.getZonesData();
        const incl = zones.filter(z => z.type === 'inclusive');
        if (incl.length > 0) {
            const maxR = Math.max(...incl.map(z => z.radiusMeters));
            const floor = this._minZoomFor25Pct(cLat, maxR);
            zoom = Math.max(zoom, floor);
        }

        // Hard limits: never wider than "see both sides of an ocean", never closer than building-level
        zoom = Math.max(9, Math.min(16, zoom));

        this.cinematicFlyTo(cLat, cLng, { zoom, tilt: 45, heading: 0 });
    }

    // ─── Public API ───────────────────────────────────────────────────────────

    setCenter(lat, lng, zoom = 15) {
        this.prewarmTiles(lat, lng);
        setTimeout(() => this.cinematicFlyTo(lat, lng, { zoom, heading: 0, tilt: 45 }), 300);
    }

    zoomToRadius(lat, lng, radiusMeters) {
        const { w, h } = this._visibleDims();
        const earthCirc = 40075016.686 * Math.cos(lat * Math.PI / 180);
        const zoom = Math.log2(earthCirc * Math.min(w, h) / (radiusMeters * 2.2 * 256));
        this.cinematicFlyTo(lat, lng, { zoom: Math.max(9, Math.min(16, zoom)), heading: 0, tilt: 45 });
    }

    flyTo(lat, lng, heading = 0, tilt = 45, zoom = 15) {
        this.cinematicFlyTo(lat, lng, { zoom, heading, tilt });
    }
}
