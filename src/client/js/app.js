/**
 * JobRadius - Main Application Entry
 */

import { MapController } from './map/mapController.js';
import { createJobInfoOverlay } from './map/jobInfoOverlay.js';
import { RadiusManager } from './map/radiusManager.js';

window.JobInfoOverlayClass = null;

// ─── Theme Guard (redundant safety net) ──────────────────────────────────────
// The PRIMARY theme application is the inline <script> in index.html <head>.
// This IIFE is a FALLBACK for browsers serving a cached index.html that
// lacks the inline script. Both mechanisms are idempotent (classList.add on
// an existing class is a no-op). Do NOT remove this — belt-and-suspenders.
(function applyThemeSafetyNet() {
    try {
        const savedTheme = localStorage.getItem('jobradius_map_theme') || '1a69e9680804148ef13dfe31';
        const isLight = savedTheme === '784c8b99db731157518b28d2';

        // Apply theme class + color-scheme to <html> (prevents Chrome Auto Dark Mode override)
        document.documentElement.classList.toggle('theme-light', isLight);
        document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';

        // Apply to <body> if available now, otherwise on DOMContentLoaded
        if (document.body) {
            document.body.classList.toggle('theme-light', isLight);
        }
        document.addEventListener('DOMContentLoaded', () => {
            if (document.body) {
                document.body.classList.toggle('theme-light', isLight);
            }
        });
    } catch (e) { /* localStorage may be unavailable in some private browsing modes */ }
})();

class JobRadiusApp {
    constructor(startLocation) {
        this.mapController = new MapController('map');
        this.radiusManager = null;
        this.currentCenter = null;
        this.startLocation = startLocation || null;

        // DOM Elements
        this.searchInput = document.getElementById('map-search-box');
        this.jobKeyword = document.getElementById('job-keyword');
        this.btnSearch = document.getElementById('pill-search'); // Search pill triggers performJobSearch
        this.btnAddInclusive = document.getElementById('btn-add-inclusive');
        this.btnAddExclusive = document.getElementById('btn-add-exclusive');
        this.radiusList = document.getElementById('radius-list');
        this.radiusList = document.getElementById('radius-list');

        // Unified UI Elements
        this.unifiedPanel = document.getElementById('unified-user-panel');
        this.actionPills = document.querySelectorAll('.action-pill');
        this.unifiedViews = document.querySelectorAll('.unified-view');
        this.passCountdown = document.getElementById('pass-countdown');

        // Mobile Elements
        this.btnLogin = document.getElementById('btn-login');
        this.btnSubscribe = document.getElementById('btn-subscribe');
        this.btnCheckout = document.getElementById('btn-checkout');
        this.authModal = document.getElementById('auth-modal');
        this.paymentModal = document.getElementById('payment-modal');
        this.modalOverlay = document.getElementById('modal-overlay');
        
        // Job Details View
        this.jobDetailView = document.getElementById('job-detail-view');
        this.btnBackToResults = document.getElementById('btn-back-to-results');
        this.jobDetailContent = document.getElementById('job-detail-content');
        this.btnRouteHere = document.getElementById('btn-route-here');
        this.btnAddNote = document.getElementById('btn-add-note');
        this.btnSaveNote = document.getElementById('btn-save-note');
        this.noteTextInput = document.getElementById('note-text-input');
        this.noteForm = document.getElementById('note-form');
        this.btnHideJob = document.getElementById('btn-hide-job');
        this.btnLockJob = document.getElementById('btn-lock-job');

        // Map Tracking Memory
        this.currentSelectedJob = null;
        this.jobMarkers = [];
        this.lockedMarkers = []; // Separate array — never cleared by new searches
        this.lockedJobs = new Map(); // indeedJobId → job data
        this.transitLayer = null;
        this.directionsService = null;
        this.directionsRenderer = null;
        this.hiddenJobs = new Set();
        this.lastFetchedJobs = [];
        // Restore locked jobs from localStorage
        this._restoreLockedJobs();

        // Admin Elements
        this.btnAdminPanel = document.getElementById('admin-pill');
        this.adminPanel = document.getElementById('admin-view');

        // Auto-start the app immediately after construction
        this.startApp();

        // Default Mobile State
        if (window.innerWidth < 768 && this.unifiedPanel) {
            this.unifiedPanel.classList.add('panel-half');
        }
    } // End constructor

    async startApp() {
        console.log("JobRadius App Starting...");
        try {
            const map = await this.mapController.init();
            this.radiusManager = new RadiusManager(map);

            // Initialize Google Directions for in-app routing
            this.directionsService = new google.maps.DirectionsService();
            this.directionsRenderer = new google.maps.DirectionsRenderer({
                map: map,
                suppressMarkers: false,
                polylineOptions: {
                    strokeColor: '#06b6d4',
                    strokeOpacity: 0.9,
                    strokeWeight: 5
                }
            });

            this.setupListeners();
            this.setupUnifiedNavigation();
            this.setupSearchBox();
            this._populateJobAutocomplete();
            this.setupModals();

            // Recalculate pin stacking on every map zoom / pan (idle fires when settled)
            let _overlapTimer = null;
            map.addListener('idle', () => {
                clearTimeout(_overlapTimer);
                _overlapTimer = setTimeout(() => this.resolveOverlaps(), 150);
            });

            // Restore session from localStorage (persist login across refreshes)
            this.restoreSession();

            // Populate Saved Jobs panel immediately from localStorage
            this.renderSavedJobs();

            // ── Post-Payment Sync: Detect Stripe return URL ──────────────────
            // When Stripe redirects back after checkout, the URL contains ?session_id=cs_...
            // We use this to immediately verify the payment with Stripe and activate the day pass,
            // bypassing the webhook (which may not fire instantly in sandbox/dev).
            const urlParams = new URLSearchParams(window.location.search);
            const sessionId = urlParams.get('session_id');
            if (sessionId) {
                const token = localStorage.getItem('jobradius_token');
                if (token) {
                    try {
                        console.log('[Payment] Stripe return detected. Verifying session:', sessionId);
                        const verifyRes = await fetch(`/api/payment/verify-session?session_id=${encodeURIComponent(sessionId)}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        const verifyData = await verifyRes.json();
                        if (verifyRes.ok && verifyData.user) {
                            // Update localStorage with fresh user data (now includes dayPassExpiresAt)
                            const existingUser = JSON.parse(localStorage.getItem('jobradius_user') || '{}');
                            localStorage.setItem('jobradius_user', JSON.stringify({ ...existingUser, ...verifyData.user }));
                            // Restart the premium timer with the new expiry
                            this.checkPremiumStatus();
                            console.log('[Payment] Day pass activated. Expiry:', verifyData.user.dayPassExpiresAt);
                            this._showToast('✅ 24hr Pass activated! Your timer has started.');
                        }
                    } catch (e) {
                        console.error('[Payment] Failed to verify Stripe session:', e);
                    }
                }
                // Clean the ?session_id from the URL bar so refresh doesn't re-verify
                window.history.replaceState({}, document.title, '/');
            }

            // If we have a starting location from Geolocation, reverse-geocode it,
            // pre-fill the search location box, and cache the result.
            if (this.startLocation) {
                console.log('Centering map on user location:', this.startLocation);
                this.mapController.prewarmTiles(this.startLocation.lat, this.startLocation.lng);
                this.currentCenter = { lat: this.startLocation.lat, lng: this.startLocation.lng, address: 'Current Location' };

                // Reverse geocode to get human-readable city / province / country
                try {
                    const geocoder = new google.maps.Geocoder();
                    const geoResult = await new Promise((resolve) => {
                        geocoder.geocode({ location: { lat: this.startLocation.lat, lng: this.startLocation.lng } },
                            (results, status) => resolve(status === 'OK' && results[0] ? results[0] : null));
                    });
                    if (geoResult) {
                        // Build a compact "City, Province/State, Country" string
                        const comps = geoResult.address_components;
                        const get = (type) => comps.find(c => c.types.includes(type))?.long_name || '';
                        const getShort = (type) => comps.find(c => c.types.includes(type))?.short_name || '';
                        const city = get('locality') || get('sublocality') || get('administrative_area_level_2');
                        const province = getShort('administrative_area_level_1');
                        const country = get('country');
                        const locationStr = [city, province, country].filter(Boolean).join(', ');
                        this.searchInput.value = locationStr;
                        this.currentCenter.address = locationStr;
                        // Cache so the next page load pre-fills without needing geolocation
                        localStorage.setItem('jobradius_last_location', JSON.stringify({
                            lat: this.startLocation.lat,
                            lng: this.startLocation.lng,
                            address: locationStr
                        }));
                    }
                } catch (e) {
                    console.warn('[Geocode] Reverse geocode failed:', e);
                }

                setTimeout(() => {
                    this.mapController.cinematicFlyTo(this.startLocation.lat, this.startLocation.lng, {
                        zoom: 15, heading: 0, tilt: 60
                    });
                }, 400);
            } else {
                // Geolocation denied — try to restore last known location from cache
                const cached = (() => { try { return JSON.parse(localStorage.getItem('jobradius_last_location')); } catch { return null; } })();
                if (cached && cached.lat && cached.lng) {
                    console.log('[Session] Restoring cached location:', cached.address);
                    this.currentCenter = cached;
                    this.searchInput.value = cached.address;
                    this.mapController.prewarmTiles(cached.lat, cached.lng);
                    setTimeout(() => {
                        this.mapController.cinematicFlyTo(cached.lat, cached.lng, { zoom: 15, heading: 0, tilt: 60 });
                    }, 400);
                }
            }
            console.log('JobRadius App fully initialized.');
        } catch (e) {
            console.error("Failed to initialize map:", e);
        }
    }

    _populateJobAutocomplete() {
        const datalist = document.getElementById('job-titles');
        if (!datalist) return;

        const commonJobs = [
            "Software Developer", "Frontend Developer", "Backend Developer", "Full Stack Developer",
            "Data Analyst", "Data Scientist", "Product Manager", "Project Manager",
            "Registered Nurse", "Licensed Practical Nurse", "Medical Assistant",
            "Teacher", "Tutor", "Substitute Teacher", "Graphic Designer", "UX Designer",
            "Sales Representative", "Account Executive", "Customer Service Representative",
            "Marketing Manager", "Social Media Manager", "Content Writer",
            "Administrative Assistant", "Executive Assistant", "Receptionist",
            "Barista", "Bartender", "Server", "Chef", "Line Cook",
            "Retail Sales Associate", "Store Manager", "Cashier",
            "Warehouse Worker", "Delivery Driver", "Truck Driver",
            "Electrician", "Plumber", "Carpenter", "Construction Worker",
            "Security Guard", "Cleaner", "Janitor", "Maintenance Technician"
        ];

        datalist.innerHTML = commonJobs.sort().map(job => `<option value="${job}">`).join('');
    }

    /**
     * Restores login state from localStorage without blocking startup.
     * On every page load:
     *  1. Read token + user from localStorage
     *  2. Check if JWT is expired (no network call)
     *  3. If valid — restore UI immediately
     *  4. Silently re-fetch /api/auth/me in the background to sync fresh data
     */
    restoreSession() {
        const token = localStorage.getItem('jobradius_token');
        const userStr = localStorage.getItem('jobradius_user');

        // Nothing stored — fresh visitor
        if (!token) return;

        // ── 1. Check JWT expiry locally (no network) ──
        try {
            const parts = token.split('.');
            if (parts.length === 3) {
                const payload = JSON.parse(atob(parts[1]));
                if (payload.exp && (payload.exp * 1000) < Date.now()) {
                    // Token is definitely expired — safe to clear
                    console.warn('[Session] JWT expired, clearing session.');
                    localStorage.removeItem('jobradius_token');
                    localStorage.removeItem('jobradius_user');
                    return;
                }
            }
        } catch(e) {
            // Malformed JWT — also safe to clear
            console.warn('[Session] Malformed JWT, clearing session.');
            localStorage.removeItem('jobradius_token');
            localStorage.removeItem('jobradius_user');
            return;
        }

        // ── 2. Restore UI immediately from localStorage (no flash) ──
        let user = null;
        if (userStr) {
            try { user = JSON.parse(userStr); } catch(e) {
                // Corrupted user JSON — don't log out, just rebuild from /me below
                console.warn('[Session] Could not parse stored user data, will re-fetch.');
            }
        }

        if (user) {
            // Build display name defensively
            let displayName = 'Account';
            try {
                if (user.name) {
                    displayName = user.name;
                } else if (user.email) {
                    displayName = user.email.split('@')[0];
                }
            } catch(e) { displayName = 'Account'; }

            // Update the user-name-display strip (new top element)
            const nameEl = document.getElementById('user-name-display');
            if (nameEl) nameEl.textContent = displayName;

            // Also hide the Login button, show subscribe button if needed
            if (this.btnLogin) this.btnLogin.classList.add('hidden');

            if (user.email === 'bruno.brottes@gmail.com' && this.btnAdminPanel) {
                this.btnAdminPanel.classList.remove('hidden');
            }
            console.log('[Session] Restored UI for:', user.email || '(unknown)');
        }

        // Always run premium check with whatever data we have
        this.checkPremiumStatus();

        // ── 3. Background sync + restore cached search results ──
        // Restore previous job results from sessionStorage (survive refresh)
        try {
            const cachedResults = sessionStorage.getItem('jobradius_last_results');
            if (cachedResults) {
                const jobs = JSON.parse(cachedResults);
                if (Array.isArray(jobs) && jobs.length > 0) {
                    this.lastFetchedJobs = jobs;
                    // Re-plot all pins on the map
                    const filtered = jobs.filter(j => j.lat != null && j.lng != null);
                    filtered.forEach(job => {
                        const overlay = createJobInfoOverlay(
                            { lat: job.lat, lng: job.lng }, job,
                            {
                                isLocked: this.lockedJobs.has(job.indeedJobId),
                                onExpand: (o) => { this.currentSelectedJob = o.job; this.showJobDetail(o.job); },
                                onRoute: (j) => { this.currentSelectedJob = j; this.showInAppRoute(); },
                                onHide: (j) => this.hideJob(j),
                                onLock: (j, locked) => { locked ? this.lockJob(j) : this.unlockJob(j); }
                            }
                        );
                        overlay.setMap(this.mapController.map);
                        this.jobMarkers.push(overlay);
                    });
                    this.renderJobList(jobs);
                    console.log(`[Cache] Restored ${jobs.length} cached job results from session.`);
                }
            }
        } catch(e) { console.warn('[Cache] Could not restore cached results:', e.message); }

        // Background sync: re-fetch fresh user data from server
        fetch('/api/auth/me', {
            headers: { 'Authorization': `Bearer ${token}` }
        }).then(async (res) => {
            if (res.ok) {
                const data = await res.json();
                if (data.user) {
                    localStorage.setItem('jobradius_user', JSON.stringify(data.user));
                    // Re-run premium check with fresh server data
                    this.checkPremiumStatus();
                    console.log('[Session] Synced fresh user data from server.');
                }
            } else if (res.status === 401) {
                // The server rejected this token — clear session AND cached results
                console.warn('[Session] Server rejected token (401), clearing session.');
                localStorage.removeItem('jobradius_token');
                localStorage.removeItem('jobradius_user');
                sessionStorage.removeItem('jobradius_last_results');
                // Restore login button visibility
                const nameEl = document.getElementById('user-name-display');
                if (nameEl) nameEl.textContent = '';
                if (this.btnLogin) {
                    this.btnLogin.classList.remove('hidden');
                }
                this.checkPremiumStatus();
            }
            // Any other error (503, network failure etc.) — do NOT clear localStorage
        }).catch(e => {
            console.warn('[Session] Background sync failed (network?), keeping session:', e.message);
        });
    }

    // ── Search usage tracking (max 10 per 24-hr pass window) ────────────
    _getSearchUsage() {
        try {
            const raw = localStorage.getItem('jobradius_search_usage');
            if (!raw) return { count: 0, windowStart: 0 };
            const data = JSON.parse(raw);
            // Resets automatically when window is more than 24h old
            if (Date.now() - data.windowStart > 24 * 60 * 60 * 1000) {
                return { count: 0, windowStart: Date.now() };
            }
            return data;
        } catch { return { count: 0, windowStart: 0 }; }
    }

    _incrementSearchUsage() {
        const usage = this._getSearchUsage();
        const updated = {
            count: usage.count + 1,
            windowStart: usage.windowStart || Date.now()
        };
        localStorage.setItem('jobradius_search_usage', JSON.stringify(updated));
        return updated.count;
    }

    _resetSearchUsage() {
        localStorage.removeItem('jobradius_search_usage');
    }

    checkPremiumStatus() {
        const userStr = localStorage.getItem('jobradius_user');
        if (!userStr) {
            this.isPremium = false;
            return;
        }

        const user = JSON.parse(userStr);
        // If they are an active monthly subscriber, they bypass the timer
        if (user.subscriptionStatus === 'active') {
            this.isPremium = true;
            this.btnSubscribe.classList.add('hidden');
            if (this.passCountdown) {
                this.passCountdown.classList.remove('hidden');
                const usage = this._getSearchUsage();
                this.passCountdown.innerText = `Premium Active  •  ${usage.count}/10`;
            }
            return;
        }

        // Check the 24-hour pass
        if (user.dayPassExpiresAt) {
            const expiresDate = new Date(user.dayPassExpiresAt);

            // Clear any existing timer
            if (this.premiumTimerToken) clearInterval(this.premiumTimerToken);

            this.btnSubscribe.classList.add('hidden');
            if (this.passCountdown) this.passCountdown.classList.remove('hidden');

            this.premiumTimerToken = setInterval(() => {
                const now = new Date();
                const diffTime = expiresDate - now;

                if (diffTime <= 0) {
                    // Expired
                    clearInterval(this.premiumTimerToken);
                    this.isPremium = false;
                    this._resetSearchUsage();
                    if (this.passCountdown) this.passCountdown.classList.add('hidden');
                    this.btnSubscribe.classList.remove('hidden');
                    this.btnSubscribe.innerText = "Get 24hr Pass";
                } else {
                    this.isPremium = true;
                    // Format diff into HH:MM:SS
                    const hours = Math.floor(diffTime / (1000 * 60 * 60)).toString().padStart(2, '0');
                    const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60)).toString().padStart(2, '0');
                    const seconds = Math.floor((diffTime % (1000 * 60)) / 1000).toString().padStart(2, '0');
                    const usage = this._getSearchUsage();
                    if (this.passCountdown) this.passCountdown.innerText = `${hours}:${minutes}:${seconds}  •  ${usage.count}/10`;
                }
            }, 1000); // tick every second

        } else {
            this.isPremium = false;
            if (this.passCountdown) this.passCountdown.classList.add('hidden');
            this.btnSubscribe.classList.remove('hidden');
            this.btnSubscribe.innerText = "Get 24hr Pass";
        }
    }


    setupSearchBox() {
        // Google Places Autocomplete
        const autocomplete = new google.maps.places.Autocomplete(this.searchInput);

        autocomplete.addListener('place_changed', () => {
            const place = autocomplete.getPlace();
            if (!place.geometry || !place.geometry.location) return;

            const lat = place.geometry.location.lat();
            const lng = place.geometry.location.lng();

            this.currentCenter = { lat, lng, address: place.formatted_address };
            // Cache the new location so it survives refresh
            localStorage.setItem('jobradius_last_location', JSON.stringify({ lat, lng, address: place.formatted_address }));

            this.mapController.setCenter(lat, lng, 15);

            // Clear old zones and add a new inclusive radius centered on the new search location
            this.radiusManager.zones.forEach(z => {
                if (z.circleObj) z.circleObj.setMap(null);
                if (z.markerObj) z.markerObj.setMap(null);
            });
            this.radiusManager.zones = [];
            this.radiusManager.addZone('inclusive', 20000, { lat, lng, address: place.formatted_address });
            this.updateRadiusUI();

            // Fit map around the new zone accounting for panel offsets
            setTimeout(() => this.mapController.fitAllZones(this.radiusManager), 600);
        });
    }

    setupListeners() {
        // Search API Trigger
        this.btnSearch.addEventListener('click', () => this.performJobSearch());

        // Allow Enter / Return on keyword OR location inputs to trigger search
        const triggerOnEnter = (e) => { if (e.key === 'Enter') { e.preventDefault(); this.performJobSearch(); } };
        this.jobKeyword.addEventListener('keydown', triggerOnEnter);
        this.searchInput.addEventListener('keydown', triggerOnEnter);

        // Close panels if map is clicked (mobile specifically dims bottom sheet)
        document.getElementById('map').addEventListener('click', () => {
            if (window.innerWidth < 768 && this.unifiedPanel) {
                this.unifiedPanel.classList.remove('panel-half');
                this.unifiedPanel.classList.remove('panel-full');
            }
        });

        // F11 Fullscreen Mobile Toggle
        const btnFullscreen = document.getElementById('btn-fullscreen');
        if (btnFullscreen) {
            btnFullscreen.addEventListener('click', () => {
                const docElm = document.documentElement;
                const fsElm = document.fullscreenElement || document.webkitFullscreenElement || document.mozFullScreenElement || document.msFullscreenElement;

                if (!fsElm) {
                    const req = docElm.requestFullscreen || docElm.webkitRequestFullscreen || docElm.mozRequestFullScreen || docElm.msRequestFullscreen;
                    if (req) {
                        try {
                            const promise = req.call(docElm);
                            if (promise && promise.catch) {
                                promise.catch(err => {
                                    console.log('Fullscreen error:', err);
                                    if (err.name !== 'TypeError') {
                                        alert('Could not enter fullscreen. Your browser might be blocking it.');
                                    }
                                });
                            }
                        } catch (e) {
                            console.log('Fullscreen request failed', e);
                        }
                    } else {
                        alert('Fullscreen API is not directly supported in this browser. On iOS, you must use "Add to Home Screen" to enable full screen mode.');
                    }
                } else {
                    const exit = document.exitFullscreen || document.webkitExitFullscreen || document.mozCancelFullScreen || document.msExitFullscreen;
                    if (exit) {
                        exit.call(document);
                    }
                }
            });
        }

        // Radius Management — inline address picker for each zone
        this.btnAddInclusive.addEventListener('click', () => this._showZoneAddressForm('inclusive'));
        this.btnAddExclusive.addEventListener('click', () => this._showZoneAddressForm('exclusive'));

        // Listen for radius changes — re-filter jobs and refit map around all zones
        this.radiusManager.onChange(zones => {
            try {
                this._saveZones(zones);
                this.updateRadiusUI();
            } catch (e) { console.warn('[Zones] onChange error:', e.message); }
            // Always re-filter regardless of save/UI errors
            this._refilterJobs();
            // Fit viewport around all circles (accounting for panel offsets)
            if (zones.length > 0) {
                setTimeout(() => this.mapController.fitAllZones(this.radiusManager), 400);
            }
        });

        // Transit Routing Fix
        const transitSelect = document.getElementById('route-mode');
        if (transitSelect) {
            transitSelect.addEventListener('change', (e) => {
                if (e.target.value === 'TRANSIT') {
                    if (!this.transitLayer) this.transitLayer = new google.maps.TransitLayer();
                    this.transitLayer.setMap(this.mapController.map);
                    this.mapController.flyTo(this.currentCenter.lat, this.currentCenter.lng, 15, 60, 14); // Emphasize 3D transit
                } else {
                    if (this.transitLayer) this.transitLayer.setMap(null);
                }
            });
        }
    }

    setupUnifiedNavigation() {
        if(!this.actionPills || !this.unifiedViews) return;

        // Saved Jobs Sorting
        const sortSelect = document.getElementById('sort-saved-jobs');
        if (sortSelect) {
            sortSelect.addEventListener('change', () => this.renderSavedJobs());
        }
        
        this.actionPills.forEach(pill => {
            pill.addEventListener('click', () => {
                // Remove active from all pills
                this.actionPills.forEach(p => p.classList.remove('active'));
                pill.classList.add('active');
                
                // Hide all views
                this.unifiedViews.forEach(v => {
                    v.classList.add('hidden');
                    v.classList.remove('active');
                });
                
                // Show target view
                const targetId = pill.getAttribute('data-target');
                const targetView = document.getElementById(targetId);
                if(targetView) {
                    targetView.classList.remove('hidden');
                    targetView.classList.add('active');
                }

                // Refresh saved jobs panel when that tab is clicked
                if (targetId === 'saved-jobs-view') {
                    this.renderSavedJobs();
                }

                // On mobile, clicking a pill expands the panel to half or full
                if(window.innerWidth < 768 && this.unifiedPanel) {
                    this.unifiedPanel.classList.add('panel-half');
                }
            });
        });
        
        // Bottom Sheet Swipe Mechanics (Mobile)
        const sheetHandle = document.querySelector('.sheet-handle');
        if (sheetHandle && this.unifiedPanel) {
            let startY = 0;
            let currentY = 0;
            let initialTransform = 0;
            let isDragging = false;

            const getTransformY = () => {
                const style = window.getComputedStyle(this.unifiedPanel);
                const matrix = new DOMMatrixReadOnly(style.transform);
                return matrix.m42;
            };

            // Touch Start: Init drag
            sheetHandle.addEventListener('touchstart', (e) => {
                isDragging = true;
                startY = e.touches[0].clientY;
                currentY = startY; // default safely
                initialTransform = getTransformY();
                this.unifiedPanel.style.transition = 'none'; // Disable transition for live track
            }, { passive: true });

            // Touch Move: Track finger
            sheetHandle.addEventListener('touchmove', (e) => {
                if (!isDragging) return;
                // Prevent drag processing if the panel is fully hidden (avoid OS gesture clash)
                if (this.unifiedPanel.classList.contains('panel-hidden')) {
                    return;
                }

                currentY = e.touches[0].clientY;
                const deltaY = currentY - startY;
                let newY = initialTransform + deltaY;
                
                // Bound it so it doesn't go above 0 (top of screen)
                if (newY < 0) newY = 0;
                
                this.unifiedPanel.style.transform = `translateY(${newY}px)`;
            }, { passive: true });

            // Touch End: Snap to nearest state
            sheetHandle.addEventListener('touchend', (e) => {
                if (!isDragging) return;
                isDragging = false;
                this.unifiedPanel.style.transition = 'transform 0.4s cubic-bezier(0.32, 0.72, 0, 1)';
                this.unifiedPanel.style.transform = ''; // Clear inline style to let CSS take over

                const deltaY = currentY - startY;

                // If the panel was hidden, ANY interaction on the handle is treated as a tap to restore.
                if (this.unifiedPanel.classList.contains('panel-hidden')) {
                    this.unifiedPanel.classList.remove('panel-hidden');
                    this.unifiedPanel.classList.remove('panel-half');
                    this.unifiedPanel.classList.remove('panel-full');
                    return;
                }

                // Threshold logic to snap
                if (Math.abs(deltaY) < 20) {
                    // It was just a tap -> cycle states instead
                    if (!this.unifiedPanel.classList.contains('panel-half') && !this.unifiedPanel.classList.contains('panel-full')) {
                        this.unifiedPanel.classList.add('panel-half');
                    } else if (this.unifiedPanel.classList.contains('panel-half')) {
                        this.unifiedPanel.classList.remove('panel-half');
                        this.unifiedPanel.classList.add('panel-full');
                    } else {
                        // From Full -> Default
                        this.unifiedPanel.classList.remove('panel-full');
                    }
                    return;
                }

                if (deltaY > 50) {
                    // Swiped DOWN
                    if (this.unifiedPanel.classList.contains('panel-full')) {
                        this.unifiedPanel.classList.remove('panel-full');
                        this.unifiedPanel.classList.add('panel-half');
                    } else if (this.unifiedPanel.classList.contains('panel-half')) {
                        this.unifiedPanel.classList.remove('panel-half');
                        // Default state
                    } else {
                        // Swipe down from default -> completely hide
                        this.unifiedPanel.classList.add('panel-hidden');
                    }
                } else if (deltaY < -50) {
                    // Swiped UP
                    if (!this.unifiedPanel.classList.contains('panel-half') && !this.unifiedPanel.classList.contains('panel-full')) {
                        this.unifiedPanel.classList.add('panel-half');
                    } else if (this.unifiedPanel.classList.contains('panel-half')) {
                        this.unifiedPanel.classList.remove('panel-half');
                        this.unifiedPanel.classList.add('panel-full');
                    }
                }
            }, { passive: true });
        }
        
        // Theme Selection (Requires reload to apply Map ID to Google Maps instance)
        const themeBtns = document.querySelectorAll('.theme-btn');
        if (themeBtns.length > 0) {
            const currentTheme = localStorage.getItem('jobradius_map_theme') || '1a69e9680804148ef13dfe31';
            
            themeBtns.forEach(btn => {
                if(btn.getAttribute('data-map-id') === currentTheme) {
                    btn.classList.add('active');
                } else {
                    btn.classList.remove('active');
                }
                
                btn.addEventListener('click', () => {
                    // Use `btn` (closure) not `e.target` — e.target may be a child element
                    const newTheme = btn.getAttribute('data-map-id');
                    const isLight = newTheme === '784c8b99db731157518b28d2';
                    localStorage.setItem('jobradius_map_theme', newTheme);
                    themeBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    
                    // Instantly apply theme + color-scheme so the transition feels responsive
                    document.documentElement.classList.toggle('theme-light', isLight);
                    document.documentElement.style.colorScheme = isLight ? 'light' : 'dark';
                    if (document.body) document.body.classList.toggle('theme-light', isLight);
                    
                    this._showToast('Theme saved! Reloading map...');
                    setTimeout(() => window.location.reload(), 1000);
                });
            });
        }
    }

    setupModals() {
        const showModal = (modalNode) => {
            this.modalOverlay.classList.remove('hidden');
            modalNode.classList.remove('hidden');
        };
        const hideAllModals = () => {
            this.modalOverlay.classList.add('hidden');
            this.authModal.classList.add('hidden');
            this.paymentModal.classList.add('hidden');
        };

        // Header Buttons — only show auth modal if NOT already logged in
        this.btnLogin.addEventListener('click', () => {
            const token = localStorage.getItem('jobradius_token');
            if (token) {
                // Already logged in: clicking name/profile does nothing
                // (future: could show a profile dropdown)
                return;
            }
            showModal(this.authModal);
        });
        // Payment Button: require login first, then show payment modal
        this.btnSubscribe.addEventListener('click', () => {
            const token = localStorage.getItem('jobradius_token');
            if (!token) {
                // Not logged in — show auth modal first
                // After login, user can click "Get 24hr Pass" again
                showModal(this.authModal);
                // Add a subtle note to the auth modal
                const authNote = document.getElementById('auth-modal-note');
                if (authNote) authNote.textContent = 'Please log in to purchase a 24hr Pass.';
                return;
            }
            showModal(this.paymentModal);
        });

        // Close Buttons
        document.querySelectorAll('.close-btn[data-modal]').forEach(btn => {
            btn.addEventListener('click', hideAllModals);
        });

        // Close on overlay click
        this.modalOverlay.addEventListener('click', (e) => {
            if (e.target === this.modalOverlay) hideAllModals();
        });

        // Auth Form (Email)
        document.getElementById('auth-form').addEventListener('submit', (e) => {
            e.preventDefault();
            this.handleAuth();
        });

        // Payment
        this.btnCheckout.addEventListener('click', () => this.handlePayment());

        // Route Here — only if the element still exists (may be removed in newer HTML)
        if (this.btnRouteHere) {
            this.btnRouteHere.addEventListener('click', () => {
                if (this.currentSelectedJob && this.currentCenter) {
                    this.showInAppRoute();
                } else {
                    alert('Please select a center location and a job first.');
                }
            });
        }

        // Hide Job Button (old static button — null-safe)
        if (this.btnHideJob) {
            this.btnHideJob.addEventListener('click', () => {
                if (this.currentSelectedJob) {
                    this.hideJob(this.currentSelectedJob);
                }
            });
        }

        // Lock Job Button
        if (this.btnLockJob) {
            this.btnLockJob.addEventListener('click', () => {
                if (this.currentSelectedJob) {
                    const job = this.currentSelectedJob;
                    const isLocked = this.lockedJobs.has(job.indeedJobId);
                    if (isLocked) {
                        this.unlockJob(job);
                        this.btnLockJob.innerText = '📌 Pin';
                    } else {
                        this.lockJob(job);
                        this.btnLockJob.innerText = '🔓 Unpin';
                    }
                }
            });
        }

        if (this.btnBackToResults) {
            this.btnBackToResults.addEventListener('click', () => {
                // 1. Restore panel header (unhide search + action pills)
                if (this.unifiedPanel) {
                    this.unifiedPanel.classList.remove('panel-in-detail-mode');
                }

                // 2. Switch views WITHOUT calling searchPill.click().
                //    Clicking the pill also fires performJobSearch because btnSearch
                //    IS the search pill — use direct DOM manipulation instead.
                document.getElementById('job-detail-view')?.classList.add('hidden');
                document.querySelectorAll('.unified-view').forEach(v => v.classList.remove('hidden'));

                // Mark the search pill as active (visual highlight only)
                document.querySelectorAll('.action-pill').forEach(p => p.classList.remove('active'));
                const searchPill = document.querySelector('.action-pill[data-target="job-search-view"]');
                searchPill?.classList.add('active');

                // 3. Re-render the cached job list without a new API call
                if (this.lastFetchedJobs && this.lastFetchedJobs.length > 0) {
                    this.renderJobList(this.lastFetchedJobs);
                }

                // 4. Clean up route + focus state
                this.clearRoute();
                this.disableFocusMode();
                this.currentSelectedJob = null;

                // 5. Mobile: hide panel back to map view
                if (window.innerWidth < 768 && this.unifiedPanel) {
                    this.unifiedPanel.classList.remove('panel-half');
                    this.unifiedPanel.classList.remove('panel-full');
                    this.unifiedPanel.classList.add('panel-hidden');
                }
            });
        }

        // Add Note Toggle (old static button — null-safe)
        if (this.btnAddNote) {
            this.btnAddNote.addEventListener('click', () => {
                if (this.noteForm) this.noteForm.classList.toggle('hidden');
            });
        }

        // Save Note Submit
        if (this.btnSaveNote) {
            this.btnSaveNote.addEventListener('click', async () => {
                if (!this.currentSelectedJob) return;
                const noteText = this.noteTextInput ? this.noteTextInput.value.trim() : '';
                if (!noteText) {
                    this._showToast('Note cannot be empty.');
                    return;
                }
                const btnOriginalText = this.btnSaveNote.innerText;
                this.btnSaveNote.innerText = 'Saving...';
                try {
                    const token = localStorage.getItem('jobradius_token');
                    const headers = { 'Content-Type': 'application/json' };
                    if (token) headers['Authorization'] = `Bearer ${token}`;
                    await fetch('/api/notes', {
                        method: 'POST',
                        headers,
                        body: JSON.stringify({ jobId: this.currentSelectedJob.id || this.currentSelectedJob.indeedJobId, title: this.currentSelectedJob.title, content: noteText })
                    });
                    this.noteForm.classList.add('hidden');
                    if (this.noteTextInput) this.noteTextInput.value = '';
                    this._showToast('Note saved successfully');
                } catch (e) {
                    console.error('[Note] Save failed:', e.message);
                    this._showToast('Failed to save note');
                } finally {
                    this.btnSaveNote.innerText = btnOriginalText;
                }
            });
        }

        // Admin Panel Logic
        if (this.btnAdminPanel) {
            this.btnAdminPanel.addEventListener('click', () => this.loadAdminMetrics());
        }

        // Multi-theme select logic removed per user preference. 
        // We now use a single unified vector map aesthetic.
    }

    async handleAuth() {
        const email = document.getElementById('auth-email').value;
        const pass = document.getElementById('auth-password').value;
        const submitBtn = document.querySelector('#auth-form button');

        submitBtn.innerText = 'Verifying...';

        try {
            const res = await fetch('/api/auth/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password: pass })
            });
            const data = await res.json();

            if (res.ok) {
                localStorage.setItem('jobradius_token', data.token);
                localStorage.setItem('jobradius_user', JSON.stringify(data.user));
                this.modalOverlay.classList.add('hidden');
                this.authModal.classList.add('hidden');

                // Update the user-status-strip: show name, hide login button
                const nameToShow = data.user.name || data.user.email?.split('@')[0] || 'Account';
                const nameEl = document.getElementById('user-name-display');
                if (nameEl) nameEl.textContent = nameToShow;
                if (this.btnLogin) this.btnLogin.classList.add('hidden');

                // Check premium status (in case they already have a pass)
                this.checkPremiumStatus();

                // Show Admin gear icon for specific user
                if (data.user.email === 'bruno.brottes@gmail.com' && this.btnAdminPanel) {
                    this.btnAdminPanel.classList.remove('hidden');
                }
            } else {
                alert('Login failed: ' + (data.error || 'Unknown error'));
            }
        } catch (e) {
            console.error('Login error', e);
            alert('Failed to connect to authentication server.');
        } finally {
            submitBtn.innerText = 'Join / Sign In';
        }
    }

    async handlePayment() {
        const token = localStorage.getItem('jobradius_token');
        if (!token) {
            alert('Please sign in first before purchasing a pass.');
            // Show auth modal instead
            this.paymentModal.classList.add('hidden');
            this.authModal.classList.remove('hidden');
            return;
        }

        this.btnCheckout.innerText = 'Processing...';
        try {
            // Note: Sending empty context, server will parse userId from JWT via requireAuth
            const res = await fetch('/api/payment/create-checkout-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                },
                body: JSON.stringify({})
            });
            const data = await res.json();
            if (data.url) {
                window.location.href = data.url;
            } else {
                throw new Error(data.error || 'No checkout URL returned');
            }
        } catch (e) {
            console.error('Payment failed', e);
            alert('Payment init failed: ' + e.message);
            this.btnCheckout.innerText = 'Pay with Stripe';
        }
    }

    showJobDetail(job) {
        this.currentSelectedJob = job;
        this.clearRoute(); // Clear any previous route

        // Build apply URL — use the real job URL (Indeed posting), fall back to Indeed search
        const applyUrl = job.jobUrl
            ? job.jobUrl
            : `https://www.indeed.com/jobs?q=${encodeURIComponent(job.title)}&l=${encodeURIComponent(job.location || '')}`;

        const displayCompany = this.isPremium ? (job.company || 'Unknown Employer') : '🔒 Premium Required';
        const isLocked = this.lockedJobs.has(job.indeedJobId);

        // Format salary
        let salaryHtml = '';
        if (job.payMin || job.payMax) {
            let min = job.payMin, max = job.payMax;
            if (job.payHourly || (max && max < 1000)) {
                if (min) min = min * 2080;
                if (max) max = max * 2080;
            }
            const fmtN = n => n ? '$' + Math.round(n).toLocaleString() : '';
            const range = (min && max && min !== max)
                ? `${fmtN(min)} – ${fmtN(max)}`
                : fmtN(max || min);
            salaryHtml = `<div style="color:#10b981; font-weight:700; font-size:1.1rem; margin-bottom:6px;">💰 ${range}${job.payHourly ? '/yr (annualized)' : '/yr'}</div>`;
        }

        // Rating
        const ratingHtml = job.rating
            ? `<span style="color:#f59e0b; font-size:0.9rem;">⭐ ${parseFloat(job.rating).toFixed(1)}</span>`
            : '';

        // Age
        let ageHtml = '';
        const dateField = job.postedDate || job.createdAt;
        if (dateField) {
            const days = Math.floor((Date.now() - new Date(dateField).getTime()) / 86400000);
            const label = days === 0 ? 'Today' : days === 1 ? '1d ago' : `${days}d ago`;
            ageHtml = `<span style="color:#64748b; font-size:0.8rem; float:right;">${label}</span>`;
        }

        // Description — prefer HTML, fall back to text, then snippet
        let bodyHtml = '';
        if (job.description) {
            const clean = job.description
                .replace(/<script[\s\S]*?<\/script>/gi, '')
                .replace(/\son\w+="[^"]*"/gi, '')
                .replace(/\son\w+='[^']*'/gi, '');
            bodyHtml = `<div class="jd-description">${clean}</div>`;
        } else if (job.snippet) {
            bodyHtml = `<div class="jd-description" style="color:var(--text-secondary); font-style:italic;">"${job.snippet}"</div>`;
        } else {
            bodyHtml = `<div class="jd-description" style="color:var(--text-secondary);">No description available. Click "Apply for Job" to view the full listing.</div>`;
        }

        // Render into job-detail-content
        this.jobDetailContent.innerHTML = `
            <div style="padding:0 4px;">
                ${ageHtml}
                <h2 style="color:var(--accent-cyan); margin:0 0 6px; font-size:1.2rem; line-height:1.3;">${job.title}</h2>
                <div style="color:var(--text-secondary); font-size:0.95rem; margin-bottom:8px;">🏢 ${displayCompany}</div>
                ${salaryHtml}
                <div style="display:flex; gap:8px; align-items:center; margin-bottom:12px; padding-bottom:12px; border-bottom:1px solid var(--border-glass);">
                    ${ratingHtml}
                    <span style="color:var(--text-secondary); font-size:0.85rem;">📍 ${job.location || 'Remote'}</span>
                </div>

                ${bodyHtml}

                <div style="margin-top:16px; padding-top:12px; border-top:1px solid var(--border-glass);">
                    <a href="${applyUrl}" target="_blank" rel="noopener noreferrer"
                       style="display:block; text-align:center; text-decoration:none; padding:12px; background:var(--accent-cyan); color:#000; font-weight:700; border-radius:8px; margin-bottom:12px; font-size:0.95rem;">
                        🔗 Apply for Job
                    </a>
                    <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px;">
                        <button id="jd-btn-route" style="padding:10px 8px; background:rgba(6,182,212,0.15); border:1px solid var(--accent-cyan); color:var(--accent-cyan); border-radius:8px; cursor:pointer; font-size:0.9rem;">🚗 Route</button>
                        <button id="jd-btn-pin" style="padding:10px 8px; background:rgba(245,158,11,0.15); border:1px solid #f59e0b; color:#f59e0b; border-radius:8px; cursor:pointer; font-size:0.9rem;">${isLocked ? '🔓 Unpin' : '📌 Pin'}</button>
                        <button id="jd-btn-note" style="padding:10px 8px; background:rgba(255,255,255,0.05); border:1px solid var(--border-glass); color:var(--text-primary); border-radius:8px; cursor:pointer; font-size:0.9rem;">📝 Note</button>
                        <button id="jd-btn-hide" style="padding:10px 8px; background:rgba(239,68,68,0.1); border:1px solid rgba(239,68,68,0.4); color:#ef4444; border-radius:8px; cursor:pointer; font-size:0.9rem;">🙈 Hide</button>
                    </div>
                    <div id="jd-note-form" class="hidden" style="margin-top:10px;">
                        <textarea id="jd-note-text" rows="3" placeholder="Add your notes about this job..."
                            style="width:100%; box-sizing:border-box; background:rgba(255,255,255,0.05); border:1px solid var(--border-glass); color:var(--text-primary); border-radius:8px; padding:10px; font-size:0.9rem; resize:vertical;"></textarea>
                        <button id="jd-btn-save-note" style="margin-top:6px; padding:8px 16px; background:var(--accent-cyan); color:#000; font-weight:700; border:none; border-radius:6px; cursor:pointer; width:100%;">💾 Save Note</button>
                    </div>
                    <div id="route-steps"></div>
                </div>
            </div>
        `;

        // ── Wire action buttons ──────────────────────────────────────────────

        // Route: calls the existing showInAppRoute() which uses this.currentSelectedJob
        document.getElementById('jd-btn-route')?.addEventListener('click', () => {
            this.showInAppRoute();
        });

        // Pin/Unpin: toggle, update map marker gold border, and re-render button
        document.getElementById('jd-btn-pin')?.addEventListener('click', () => {
            const wasLocked = this.lockedJobs.has(job.indeedJobId);
            if (wasLocked) { this.unlockJob(job); } else { this.lockJob(job); }
            const nowLocked = !wasLocked;

            // Toggle only the CSS class on the marker div — do NOT call setLocked()
            // because setLocked() rebuilds the overlay HTML which re-shows the inline popup.
            const matchingOverlay = this.jobMarkers.find(m => m.job?.indeedJobId === job.indeedJobId)
                                 || this.lockedMarkers.find(m => m.job?.indeedJobId === job.indeedJobId);
            if (matchingOverlay?.div) {
                matchingOverlay.div.classList.toggle('job-overlay--locked', nowLocked);
            }

            this.showJobDetail(job); // re-render sidebar button label only
        });

        // Note: toggle form. On first open, fetch any saved note to pre-fill textarea.
        document.getElementById('jd-btn-note')?.addEventListener('click', async () => {
            const f = document.getElementById('jd-note-form');
            if (!f) return;
            f.classList.toggle('hidden');
            if (!f.classList.contains('hidden') && !f.dataset.loaded) {
                f.dataset.loaded = '1';
                const token = localStorage.getItem('jobradius_token');
                const textarea = document.getElementById('jd-note-text');
                const saveBtn = document.getElementById('jd-btn-save-note');
                if (token && textarea) {
                    const prev = textarea.placeholder;
                    textarea.placeholder = 'Loading saved note…';
                    if (saveBtn) saveBtn.disabled = true;
                    try {
                        const res = await fetch(`/api/notes/by-job/${encodeURIComponent(job.indeedJobId || job.id)}`, {
                            headers: { 'Authorization': `Bearer ${token}` }
                        });
                        if (res.ok) {
                            const data = await res.json();
                            if (data.data?.noteText) textarea.value = data.data.noteText;
                        }
                    } catch(e) { console.warn('[Note] Load failed:', e.message); }
                    finally {
                        textarea.placeholder = prev || 'Write your note here…';
                        if (saveBtn) saveBtn.disabled = false;
                    }
                }
            }
            if (!f.classList.contains('hidden')) {
                const textarea = document.getElementById('jd-note-text');
                setTimeout(() => f.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 50);
                textarea?.focus();
            }
        });

        // (NOT via pill.click() which would trigger a new search)
        document.getElementById('jd-btn-hide')?.addEventListener('click', () => {
            this.hideJob(job);
            this.disableFocusMode();
            // Use the Back button's own handler: it removes panel-in-detail-mode and goes to search view
            if (this.btnBackToResults) {
                this.btnBackToResults.click();
            }
        });

        // Save Note: POST to /api/notes — send indeedJobId as the server looks it up
        document.getElementById('jd-btn-save-note')?.addEventListener('click', async function() {
            const noteText = document.getElementById('jd-note-text')?.value?.trim();
            if (!noteText) return;
            const token = localStorage.getItem('jobradius_token');
            if (!token) {
                alert('Please log in to save notes.');
                return;
            }
            const btn = this;
            btn.disabled = true;
            btn.textContent = 'Saving…';
            try {
                const headers = {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${token}`
                };
                const res = await fetch('/api/notes', {
                    method: 'POST', headers,
                    body: JSON.stringify({
                        indeedJobId: job.indeedJobId || job.id,
                        noteText: noteText
                    })
                });
                if (res.ok) {
                    document.getElementById('jd-note-form')?.classList.add('hidden');
                    document.getElementById('jd-note-text').value = '';
                    btn.textContent = '💾 Save Note';
                    btn.disabled = false;
                } else {
                    const errData = await res.json().catch(() => ({}));
                    console.error('[Note] Save error:', res.status, errData);
                    btn.textContent = '❌ ' + (errData.error || 'Error ' + res.status);
                    btn.disabled = false;
                }
            } catch(e) {
                console.error('[Note] Network error:', e);
                btn.textContent = '❌ Network error';
                btn.disabled = false;
            }
        });

        // Switch the unified panel to the Job Detail View
        // Hide the search header and action pills while reviewing a job
        if (this.unifiedPanel) this.unifiedPanel.classList.add('panel-in-detail-mode');
        document.querySelectorAll('.unified-view').forEach(v => v.classList.add('hidden'));
        document.querySelectorAll('.action-pill').forEach(btn => btn.classList.remove('active'));
        const detailView = document.getElementById('job-detail-view');
        if (detailView) detailView.classList.remove('hidden');

        // Mobile: slide panel to full height
        if (window.innerWidth < 768 && this.unifiedPanel) {
            this.unifiedPanel.classList.remove('panel-hidden');
            this.unifiedPanel.classList.remove('panel-half');
            this.unifiedPanel.classList.add('panel-full');
        }

        // Desktop: make panel visible
        if (window.innerWidth >= 768 && this.unifiedPanel) {
            this.unifiedPanel.classList.remove('panel-hidden');
        }

        this.noteForm?.classList.add('hidden'); // Reset old note form

        // Cinematic fly to job location
        if (this.mapController) {
            this.mapController.cinematicFlyTo(job.lat, job.lng, { zoom: 17, heading: 0, tilt: 60 });
        }
    }

    // ── In-app Directions ──────────────────────────────────────
    showInAppRoute() {
        const job = this.currentSelectedJob;
        const center = this.currentCenter;
        const modeSelect = document.getElementById('route-mode');
        const travelMode = modeSelect ? modeSelect.value : 'DRIVING';

        // Hide other pins so route stands out
        this.enableFocusMode(job);

        // Update Route button text if the old static button still exists
        const routeBtn = document.getElementById('jd-btn-route') || this.btnRouteHere;
        if (routeBtn) routeBtn.textContent = '⏳ Routing...';

        const unitSystem = navigator.language === 'en-US' 
            ? google.maps.UnitSystem.IMPERIAL 
            : google.maps.UnitSystem.METRIC;

        this.directionsService.route({
            origin: { lat: center.lat, lng: center.lng },
            destination: { lat: job.lat, lng: job.lng },
            travelMode: google.maps.TravelMode[travelMode],
            unitSystem: unitSystem
        }, (result, status) => {
            if (routeBtn) routeBtn.textContent = '🚗 Route';

            if (status === 'OK') {
                this.directionsRenderer.setDirections(result);

                // Orient map to north after route renders (shortest-angle turn)
                this.mapController.resetToNorth(400);

                // Desktop/Tablet: pan map so full route clears the permanent left sidebar
                if (window.innerWidth >= 768) {
                    setTimeout(() => this.mapController.panToExposeRoute(result), 700);
                }

                // Mobile UX: Keep panel half-open so route summary is visible
                if (window.innerWidth < 768 && this.unifiedPanel) {
                    this.unifiedPanel.classList.remove('panel-full');
                    this.unifiedPanel.classList.add('panel-half');
                }

                // Show step-by-step directions inside the panel
                const stepsDiv = document.getElementById('route-steps');
                if (stepsDiv && result.routes[0]) {
                    const leg = result.routes[0].legs[0];
                    stepsDiv.innerHTML = `
                        <div style="border-top:1px solid var(--border-glass); padding-top:12px; margin-top:8px;">
                            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
                                <strong style="color:var(--accent-cyan);">${leg.distance.text}</strong>
                                <strong style="color:#10b981;">${leg.duration.text}</strong>
                                <button id="btn-clear-route" style="background:transparent;border:1px solid #ef4444;color:#ef4444;border-radius:6px;padding:2px 10px;cursor:pointer;font-size:0.8rem;">✕ Clear</button>
                            </div>
                            <ol style="padding-left:16px; color:var(--text-primary); font-size:0.85rem; max-height:200px; overflow-y:auto; line-height:1.6;">
                                ${leg.steps.map(s => `<li style="margin-bottom:4px;">${s.instructions}</li>`).join('')}
                            </ol>
                        </div>
                    `;
                    document.getElementById('btn-clear-route')?.addEventListener('click', () => this.clearRoute());
                }
            } else {
                alert('Could not calculate route: ' + status);
            }
        });
    }

    clearRoute() {
        if (this.directionsRenderer) {
            this.directionsRenderer.setDirections({ routes: [] });
        }
        const stepsDiv = document.getElementById('route-steps');
        if (stepsDiv) stepsDiv.innerHTML = '';
    }

    // ── Hide Job ───────────────────────────────────────────────
    hideJob(job) {
        const jobId = job.id || job.title; // unique identifier
        this.hiddenJobs.add(jobId);

        // Remove marker from map
        const idx = this.jobMarkers.findIndex((m, i) => {
            // match by position
            const pos = m.getPosition();
            return Math.abs(pos.lat() - job.lat) < 0.0001 && Math.abs(pos.lng() - job.lng) < 0.0001;
        });
        if (idx !== -1) {
            this.jobMarkers[idx].setMap(null);
            this.jobMarkers.splice(idx, 1);
        }

        // Remove job card from list
        const cards = document.querySelectorAll('#job-list-container .job-card');
        cards.forEach(card => {
            if (card.querySelector('h4')?.textContent === job.title) {
                card.remove();
            }
        });

        // Update count
        const countEl = document.getElementById('job-count');
        if (countEl) countEl.innerText = document.querySelectorAll('#job-list-container .job-card').length;

        // Return to search results if hide was clicked from inside the detail view
        if (this.currentSelectedJob && (this.currentSelectedJob.id === jobId || this.currentSelectedJob.indeedJobId === jobId)) {
            if (this.btnBackToResults) this.btnBackToResults.click();
        }
    }

    // ── Map Pin Focus Mode ────────────────────────────────────────

    enableFocusMode(selectedJob) {
        // Hide search-result markers that aren't the selected job
        if (this.jobMarkers) {
            this.jobMarkers.forEach(overlay => {
                if (overlay.job.indeedJobId !== selectedJob.indeedJobId) {
                    if (overlay.div) {
                        overlay.div.style.opacity = '0';
                        overlay.div.style.pointerEvents = 'none';
                    }
                } else {
                    if (overlay.div) {
                        overlay.div.style.opacity = '1';
                        overlay.div.style.pointerEvents = 'auto';
                    }
                }
            });
        }
        // Also hide pinned-job markers that aren't the selected job
        if (this.lockedMarkers) {
            this.lockedMarkers.forEach(overlay => {
                if (overlay.job && overlay.job.indeedJobId !== selectedJob.indeedJobId) {
                    if (overlay.div) {
                        overlay.div.style.opacity = '0';
                        overlay.div.style.pointerEvents = 'none';
                    }
                }
            });
        }
    }

    disableFocusMode() {
        // Restore all search-result markers
        if (this.jobMarkers) {
            this.jobMarkers.forEach(overlay => {
                if (overlay.div) {
                    overlay.div.style.opacity = '1';
                    overlay.div.style.pointerEvents = 'auto';
                }
            });
        }
        // Restore all pinned-job markers
        if (this.lockedMarkers) {
            this.lockedMarkers.forEach(overlay => {
                if (overlay.div) {
                    overlay.div.style.opacity = '1';
                    overlay.div.style.pointerEvents = 'auto';
                }
            });
        }
    }

    /**
     * Show inline address picker form for adding a new radius zone.
     * Each zone gets its own Google Places address + km input.
     */
    _showZoneAddressForm(type) {
        // Remove any existing form
        const existing = document.getElementById('zone-add-form');
        if (existing) existing.remove();

        const color = type === 'inclusive' ? '#10b981' : '#ef4444';
        const defaultKm = type === 'inclusive' ? '5' : '5';
        const label = type === 'inclusive' ? 'Include' : 'Exclude';

        const form = document.createElement('div');
        form.id = 'zone-add-form';
        form.style.cssText = `
            margin-top:8px; padding:10px; border-radius:6px;
            background:rgba(255,255,255,0.05); border:1px solid ${color};
        `;
        form.innerHTML = `
            <div style="font-size:0.8rem; font-weight:600; color:${color}; margin-bottom:6px;">New ${label} Zone</div>
            <input id="zone-address-input" type="text" placeholder="Enter address..."
                class="neumorphic-input" style="width:100%; margin-bottom:6px; font-size:0.85rem; padding:8px;" />
            <div style="display:flex; gap:6px; align-items:center;">
                <input id="zone-km-input" type="number" min="1" max="200" value="${defaultKm}"
                    class="neumorphic-input" style="width:70px; font-size:0.85rem; padding:8px;" />
                <span style="font-size:0.8rem; color:var(--text-secondary);">km</span>
                <button id="zone-add-confirm" class="btn-primary" style="flex:1; padding:8px; font-size:0.85rem;">Add</button>
                <button id="zone-add-cancel" class="btn-secondary" style="padding:8px; font-size:0.85rem;">Cancel</button>
            </div>
        `;

        // Insert form into the radius panel before the buttons
        this.radiusList.parentElement.insertBefore(form, this.btnAddInclusive.parentElement);

        // Setup Google Places Autocomplete on the address input
        const addressInput = document.getElementById('zone-address-input');
        const kmInput = document.getElementById('zone-km-input');
        const zoneAutocomplete = new google.maps.places.Autocomplete(addressInput);
        let selectedPlace = null;

        // Pre-fill with current search center if available
        if (this.currentCenter) {
            addressInput.value = this.currentCenter.address || '';
            selectedPlace = this.currentCenter;
        }

        zoneAutocomplete.addListener('place_changed', () => {
            const place = zoneAutocomplete.getPlace();
            if (place.geometry && place.geometry.location) {
                selectedPlace = {
                    lat: place.geometry.location.lat(),
                    lng: place.geometry.location.lng(),
                    address: place.formatted_address
                };
            }
        });

        // Confirm button
        document.getElementById('zone-add-confirm').addEventListener('click', () => {
            if (!selectedPlace) {
                alert('Please select an address from the dropdown.');
                return;
            }
            const km = parseFloat(kmInput.value);
            if (isNaN(km) || km <= 0) {
                alert('Enter a valid radius in km.');
                return;
            }
            this.radiusManager.addZone(type, km * 1000, selectedPlace);
            this.updateRadiusUI();
            form.remove();

            // Fly to the new zone
            this.mapController.cinematicFlyTo(selectedPlace.lat, selectedPlace.lng, { zoom: 12, heading: 0, tilt: 60 });
        });

        // Cancel button
        document.getElementById('zone-add-cancel').addEventListener('click', () => {
            form.remove();
        });

        // Focus the address input
        addressInput.focus();
    }

    updateRadiusUI() {
        const zones = this.radiusManager.getZonesData();
        this.radiusList.innerHTML = '';

        zones.forEach((z) => {
            const div = document.createElement('div');
            div.className = `radius-item ${z.type}`;
            div.style.cssText = 'padding:8px; margin-top:4px; border-radius:6px; background:rgba(255,255,255,0.05);';
            div.style.borderLeft = `4px solid ${z.type === 'inclusive' ? '#10b981' : '#ef4444'}`;

            const kmVal = (z.radiusMeters / 1000).toFixed(1);
            const addrShort = z.center?.address ? z.center.address.split(',')[0] : 'Unknown';

            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:4px;">
                    <span style="font-size:0.85rem; font-weight:600;">${z.type === 'inclusive' ? 'Include' : 'Exclude'}</span>
                    <span class="radius-km-label" style="font-size:0.85rem; color:var(--accent-cyan);">${kmVal} km</span>
                    <button data-id="${z.id}" class="remove-zone-btn" style="background:transparent; color:#94a3b8; padding:2px 6px; font-size:0.9rem;">✕</button>
                </div>
                <div style="font-size:0.75rem; color:var(--text-secondary); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">📍 ${addrShort}</div>
                <input type="range" min="1" max="100" step="0.5" value="${kmVal}" data-zone-id="${z.id}"
                    class="radius-slider"
                    style="width:100%; height:4px; accent-color:${z.type === 'inclusive' ? '#10b981' : '#ef4444'}; cursor:pointer;" />
            `;
            this.radiusList.appendChild(div);
        });

        // Attach remove zone listeners
        this.radiusList.querySelectorAll('.remove-zone-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const id = e.target.getAttribute('data-id');
                this.radiusManager.removeZone(id);
                this.updateRadiusUI();
            });
        });

        // Attach slider listeners for live radius adjustment
        this.radiusList.querySelectorAll('.radius-slider').forEach(slider => {
            slider.addEventListener('input', (e) => {
                const zoneId = e.target.getAttribute('data-zone-id');
                const newKm = parseFloat(e.target.value);
                const newMeters = newKm * 1000;

                // Update the circle on the map
                const zone = this.radiusManager.zones.find(z => z.id === zoneId);
                if (zone) {
                    zone.circleObj.setRadius(newMeters);
                    zone.radiusMeters = newMeters;
                }

                // Update the km label live (without re-rendering whole UI)
                const parent = e.target.closest('.radius-item');
                const label = parent.querySelector('.radius-km-label');
                if (label) label.textContent = `${newKm.toFixed(1)} km`;

                // Re-filter jobs when slider changes (exclusion zones may grow/shrink)
                this._refilterJobs();
            });
        });
    }

    /**
     * Persist zone configuration to localStorage so zones survive page refresh.
     */
    _saveZones(zones) {
        try {
            localStorage.setItem('jobradius_zones', JSON.stringify(zones));
        } catch (e) { console.warn('[Zones] Could not save zones:', e.message); }
    }

    /**
     * Restore zone configuration from localStorage and re-create circles on the map.
     * @returns {boolean} true if zones were successfully restored
     */
    _restoreZones() {
        try {
            const saved = localStorage.getItem('jobradius_zones');
            if (!saved) return false;
            const zones = JSON.parse(saved);
            if (!Array.isArray(zones) || zones.length === 0) return false;

            zones.forEach(z => {
                if (!z.center || z.center.lat == null || z.center.lng == null) return;
                this.radiusManager.addZone(z.type, z.radiusMeters, z.center);
            });
            this.updateRadiusUI();
            return true;
        } catch (e) {
            console.warn('[Zones] Could not restore zones:', e.message);
            return false;
        }
    }

    /**
     * Re-filter and re-render jobs from the last API fetch.
     * Jobs must be inside at least one inclusive zone AND outside all exclusive zones.
     */
    _refilterJobs() {
        if (!this.lastFetchedJobs || this.lastFetchedJobs.length === 0) return;

        const filtered = this.lastFetchedJobs.filter(j =>
            this.radiusManager.isIncluded(j.lat, j.lng) &&
            !this.radiusManager.isExcluded(j.lat, j.lng)
        );
        this.renderJobList(filtered);
        this.plotJobMarkers(filtered);
    }

    async performJobSearch() {
        // ── AUTH GATE: Must be logged in to search ──
        const token = localStorage.getItem('jobradius_token');
        if (!token) {
            // Show login modal instead of searching
            this.modalOverlay.classList.remove('hidden');
            this.authModal.classList.remove('hidden');
            return;
        }

        // ── PREMIUM GATE: Must have an active pass to search ──
        if (!this.isPremium) {
            // Immediately sync with the server to ensure their timer hasn't expired or actually started recently on another tab
            try {
                const authRes = await fetch('/api/auth/me', { headers: { 'Authorization': `Bearer ${token}` } });
                const authData = await authRes.json();
                if (authData.user) {
                    localStorage.setItem('jobradius_user', JSON.stringify(authData.user));
                    this.checkPremiumStatus();
                }
            } catch (e) { }

            // If still not premium even after DB check, throw modal
            if (!this.isPremium) {
                this.modalOverlay.classList.remove('hidden');
                this.paymentModal.classList.remove('hidden');
                return;
            }
        }
        // ── SEARCH LIMIT GATE: Max 10 searches per 24-hr pass window ──
        const MAX_SEARCHES = 10;
        const usage = this._getSearchUsage();
        if (usage.count >= MAX_SEARCHES) {
            alert(`You have used all ${MAX_SEARCHES} searches included with your 24hr Pass. Your results remain visible — select any job to view details, route, or add notes.`);
            return;
        }

        if (!this.currentCenter) {
            if (this.searchInput.value.length > 2) {
                // Use Google Geocoder to resolve the typed text to real coordinates
                try {
                    const geocoder = new google.maps.Geocoder();
                    const result = await new Promise((resolve, reject) => {
                        geocoder.geocode({ address: this.searchInput.value }, (results, status) => {
                            if (status === 'OK' && results[0]) resolve(results[0]);
                            else reject(new Error(`Geocode failed: ${status}`));
                        });
                    });
                    const loc = result.geometry.location;
                    this.currentCenter = {
                        lat: loc.lat(),
                        lng: loc.lng(),
                        address: result.formatted_address
                    };
                    this.searchInput.value = result.formatted_address;
                } catch (e) {
                    alert('Could not find that location. Please select from the dropdown.');
                    return;
                }
            } else {
                alert('Please enter a location to search.');
                return;
            }
        }

        // Restore previous zones or add default
        if (!this.radiusManager.getZonesData().length) {
            const restored = this._restoreZones();
            if (!restored) {
                // If no localStorage, fallback to default 20km zone and 5km exclusion
                this.radiusManager.addZone('inclusive', 20000, this.currentCenter);
                this.radiusManager.addZone('exclusive', 5000, this.currentCenter);
            }
        }

        // Mobile UX: Hide the bottom sheet completely when a search begins
        if (window.innerWidth < 768 && this.unifiedPanel) {
            this.unifiedPanel.classList.add('panel-hidden');
            this.unifiedPanel.classList.remove('panel-full');
            this.unifiedPanel.classList.remove('panel-half');
            const searchPill = document.querySelector('.action-pill[data-target="job-search-view"]');
            if(searchPill) searchPill.click();
        }

        const query = this.jobKeyword.value || 'Developer';
        const zones = this.radiusManager.getZonesData();

        // 1. Prewarm tiles at search location (instant camera jump to seed cache),
        //    then fly there cinematically so tiles are ready when we arrive.
        this.mapController.prewarmTiles(this.currentCenter.lat, this.currentCenter.lng);
        setTimeout(() => {
            this.mapController.fitAllZones(this.radiusManager);
        }, 400);

        // 2. Clear previous search results (locked jobs are preserved by _replotLockedJobs)
        this.plotJobMarkers([], false);

        // 3. Show the map progress overlay
        const mapProgress = document.getElementById('map-progress-overlay');
        const mapProgressText = document.getElementById('map-progress-text');
        mapProgress.style.display = 'flex';
        mapProgressText.textContent = `Searching "${query}" near ${this.currentCenter.address}`;
        mapProgressText.classList.remove('has-results');

        // 3. Fetch from backend (NDJSON streaming response)
        try {
            const token = localStorage.getItem('jobradius_token');
            const headers = { 'Content-Type': 'application/json' };
            if (token) headers['Authorization'] = `Bearer ${token}`;

            // 5-min timeout — Apify scraping can take a while
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);

            // Count this search against the 24-hr pass limit
            this._incrementSearchUsage();

            const response = await fetch('/api/jobs/search', {
                method: 'POST',
                headers,
                signal: controller.signal,
                body: JSON.stringify({
                    query: query,
                    location: this.currentCenter.address,
                    centerLat: this.currentCenter.lat,
                    centerLng: this.currentCenter.lng,
                    radiuses: zones
                })
            });

            if (response.status === 401) {
                clearTimeout(timeoutId);
                // Only clear token if it's actually expired — don't wipe a valid session
                // on a transient 401 (e.g. server restart, rate limit, etc.)
                let isExpired = false;
                try {
                    const token = localStorage.getItem('jobradius_token');
                    if (token) {
                        const payload = JSON.parse(atob(token.split('.')[1]));
                        isExpired = payload.exp && (payload.exp * 1000) < Date.now();
                    }
                } catch(e) { isExpired = true; } // Unparseable token is as good as expired

                if (isExpired) {
                    localStorage.removeItem('jobradius_token');
                    localStorage.removeItem('jobradius_user');
                    this.btnLogin.innerText = 'Login';
                }
                this.modalOverlay.classList.remove('hidden');
                this.authModal.classList.remove('hidden');
                const container = document.getElementById('job-list-container');
                container.innerHTML = '<div class="empty-state">Session expired. Please sign in again.</div>';
                return;
            }
            if (!response.ok) throw new Error('API Error ' + response.statusText);

            // ── Stream NDJSON response for live progress ──
            let accumulatedJobs = [];

            const updateProgress = (items) => {
                if (mapProgressText) {
                    mapProgressText.textContent = items > 0
                        ? `Found ${items} job${items !== 1 ? 's' : ''} so far...`
                        : 'Waiting for results...';
                    if (items > 0) mapProgressText.classList.add('has-results');
                }
            };

            const parseNDJSONLine = (line) => {
                if (!line.trim()) return;
                let evt;
                try {
                    evt = JSON.parse(line);
                } catch (e) {
                    return; // malformed JSON — skip
                }

                // Handle each event type OUTSIDE the JSON parse try/catch
                // so errors in geometry/rendering don't silently swallow job batches
                if (evt.type === 'progress') {
                    updateProgress(evt.items);
                } else if (evt.type === 'status' && mapProgressText) {
                    mapProgressText.textContent = evt.message;
                } else if (evt.type === 'jobs' && evt.jobs) {
                    accumulatedJobs.push(...evt.jobs);

                    const filteredNewJobs = evt.jobs.filter(j => {
                        // Jobs with null/missing coords: trust the server's fallback,
                        // don't silently drop them
                        if (j.lat == null || j.lng == null) return true;
                        try {
                            return this.radiusManager.isIncluded(j.lat, j.lng) &&
                                !this.radiusManager.isExcluded(j.lat, j.lng);
                        } catch (geoErr) {
                            console.warn('[filter] geometry error, allowing job:', geoErr.message);
                            return true; // geometry library not ready — allow all
                        }
                    });

                    if (filteredNewJobs.length > 0) {
                        this.plotJobMarkers(filteredNewJobs, true);
                    } else {
                        console.warn(`[stream] ${evt.jobs.length} jobs received but ALL filtered by zone — check radius bounds`);
                    }
                } else if (evt.type === 'error') {
                    console.error('[stream] server error:', evt.message);
                }
            };

            // Try streaming first, fallback to full-body text
            if (response.body && response.body.getReader) {
                const reader = response.body.getReader();
                const decoder = new TextDecoder();
                let buffer = '';

                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split('\n');
                    buffer = lines.pop();
                    for (const line of lines) parseNDJSONLine(line);
                }
                // Parse any remaining buffer
                if (buffer.trim()) parseNDJSONLine(buffer);
            } else {
                // Fallback: read entire body at once
                const rawText = await response.text();
                for (const line of rawText.split('\n')) parseNDJSONLine(line);
            }

            clearTimeout(timeoutId);

            // Hide progress overlay
            mapProgress.style.display = 'none';

            // Process final results check
            if (accumulatedJobs.length > 0) {
                this.lastFetchedJobs = accumulatedJobs;

                // Persist search results in sessionStorage so refresh restores pins
                try {
                    sessionStorage.setItem('jobradius_last_results', JSON.stringify(accumulatedJobs));
                } catch(e) { console.warn('[Cache] Could not cache results:', e.message); }

                // Final full filter for the sidebar list
                const finalFiltered = accumulatedJobs.filter(j => {
                    if (j.lat == null || j.lng == null) return true;
                    try {
                        return this.radiusManager.isIncluded(j.lat, j.lng) &&
                            !this.radiusManager.isExcluded(j.lat, j.lng);
                    } catch (e) { return true; }
                });
                this.renderJobList(finalFiltered);

                setTimeout(() => this.mapController.fitAllZones(this.radiusManager), 600);
            } else {
                // No jobs — briefly show toast-style message
                mapProgress.style.display = 'flex';
                document.querySelector('.map-progress-spinner').style.display = 'none';
                document.querySelector('.map-progress-title').textContent = 'No Results';
                if (mapProgressText) mapProgressText.textContent = 'Apify found 0 jobs matching this criteria.';

                setTimeout(() => {
                    mapProgress.style.display = 'none';
                    document.querySelector('.map-progress-spinner').style.display = 'block';
                    document.querySelector('.map-progress-title').textContent = 'Generating Map Layers';
                }, 3000);
            }

        } catch (e) {
            console.error("API Call Failed:", e);
            mapProgress.style.display = 'flex';
            document.querySelector('.map-progress-spinner').style.display = 'none';
            document.querySelector('.map-progress-title').textContent = 'Search Failed';
            mapProgressText.textContent = `${e.message}. Please ensure the backend server is running.`;
            mapProgressText.classList.remove('has-results');
            setTimeout(() => { mapProgress.style.display = 'none'; }, 5000);
        }
    }

    renderJobList(jobs) {
        // Filter out no-salary jobs (defence-in-depth against sessionStorage/locked sources)
        const filtered = jobs.filter(j => j.payMin || j.payMax);
        const container = document.getElementById('job-list-container');
        document.getElementById('job-count').innerText = filtered.length;

        if (filtered.length === 0) {
            container.innerHTML = '<div class="empty-state">No jobs with listed compensation found in this area.</div>';
            return;
        }

        // Sort jobs by highest pay descending
        filtered.sort((a, b) => {
            const payA = a.payMax || a.payMin || 0;
            const payB = b.payMax || b.payMin || 0;
            return payB - payA;
        });

        container.innerHTML = '';
        filtered.forEach((j, index) => {
            // Calculate listing age
            let ageText = '';
            const dateField = j.postedDate || j.createdAt;
            if (dateField) {
                const days = Math.floor((Date.now() - new Date(dateField).getTime()) / 86400000);
                ageText = days === 0 ? 'Today' : days === 1 ? '1 day ago' : `${days}d ago`;
            }

            // Format pay
            const payText = j.payMin
                ? (j.payMax ? `$${Math.round(j.payMin).toLocaleString()} - $${Math.round(j.payMax).toLocaleString()}` : `$${Math.round(j.payMin).toLocaleString()}`)
                : '';

            // Star rating
            const ratingText = j.rating ? `⭐ ${j.rating}` : '';

            const div = document.createElement('div');
            div.className = "job-card";
            div.innerHTML = `
                <div class="jc-header">
                    <h4 class="jc-title">${j.title}</h4>
                    ${ageText ? `<span class="jc-age">${ageText}</span>` : ''}
                </div>
                <div class="jc-company">${j.company} ${ratingText ? `<span class="jc-rating">${ratingText}</span>` : ''}</div>
                <div class="jc-meta">
                    <span class="jc-location">📍 ${j.location || 'Remote'}</span>
                    ${payText ? `<span class="jc-pay">💰 ${payText}</span>` : '<span class="jc-pay-na">💰 Pay N/A</span>'}
                </div>
            `;

            // Interaction
            div.addEventListener('click', () => this.showJobDetail(j));

            // Map Overlay Highlighting (Link sidebar card to map panel)
            div.addEventListener('mouseenter', () => {
                div.style.background = 'rgba(255,255,255,0.1)';
                const overlay = this.jobMarkers[index];
                if (overlay && overlay.highlight) {
                    overlay.highlight(true);
                }
            });
            div.addEventListener('mouseleave', () => {
                div.style.background = 'rgba(255,255,255,0.05)';
                const overlay = this.jobMarkers[index];
                if (overlay && overlay.highlight) {
                    overlay.highlight(false);
                }
            });

            container.appendChild(div);
        });
    }

    /**
     * Plots job markers on the map.
     * @param {Array} jobs - List of jobs to plot
     * @param {boolean} append - If true, keeps existing markers and appends the new ones (used for streaming chunks)
     */
    plotJobMarkers(jobs, append = false) {
        if (!this.mapController.map) return;

        // Clear non-locked markers for fresh searches
        if (!append) {
            this.jobMarkers.forEach(m => m.setMap(null));
            this.jobMarkers = [];
            this._expandedOverlay = null;
        }

        const JobListUI = document.getElementById('job-list-container');
        if (JobListUI && !append) JobListUI.innerHTML = '';

        let omittedCount = 0;

        jobs.forEach(j => {
            // Skip jobs without valid coordinates
            if (j.lat == null || j.lng == null || isNaN(j.lat) || isNaN(j.lng)) {
                console.warn('[plot] Skipping job with invalid coords:', j.title);
                return;
            }

            // Filter: omit jobs without any salary/pay data
            if (!j.payMin && !j.payMax) {
                omittedCount++;
                return;
            }

            const isAlreadyLocked = this.lockedJobs.has(j.indeedJobId);

            const overlay = createJobInfoOverlay(
                { lat: j.lat, lng: j.lng },
                j,
                {
                    isLocked: false,
                    onExpand: (o) => {
                        this.showJobDetail(o.job);
                    },
                    onLock: (job, locked) => {
                        locked ? this.lockJob(job) : this.unlockJob(job);
                    },
                    onRoute: (job) => {
                        this.currentSelectedJob = job;
                        this.showInAppRoute();
                    },
                    onSaveNote: async (job, noteText) => {
                        try {
                            const token = localStorage.getItem('jobradius_token');
                            const headers = { 'Content-Type': 'application/json' };
                            if (token) headers['Authorization'] = `Bearer ${token}`;
                            await fetch('/api/notes', {
                                method: 'POST',
                                headers,
                                body: JSON.stringify({ jobId: job.id, title: job.title, content: noteText })
                            });
                        } catch (e) { console.error('[Note] Save failed:', e.message); }
                    },
                    onHide: (job) => { this.hideJob(job); }
                }
            );
            if (isAlreadyLocked) {
                overlay.setMap(null); // Hide standard duplicate marker immediately if already pinned
            } else {
                overlay.setMap(this.mapController.map);
            }
            this.jobMarkers.push(overlay);
        });

        // Always re-plot locked jobs after a fresh search clear
        if (!append) this._replotLockedJobs();

        // Show toast if jobs were filtered for missing salary
        if (omittedCount > 0) {
            this._showToast(`Filtered out ${omittedCount} job${omittedCount !== 1 ? 's' : ''} with no listed compensation.`);
        }

        // Run overlap stacking after overlays are drawn (Google Maps draws async)
        setTimeout(() => this.resolveOverlaps(), 600);
    }

    /**
     * resolveOverlaps()
     *
     * Detects overlapping map pins in pixel space and fans them vertically
     * so every pin in a cluster is visible, each connected by a thin stem
     * line pointing down to its true geo location on the map.
     *
     * Algorithm (runs in O(n²) which is fine for ≤200 pins):
     *  1. Get pixel position of every visible (non-expanded) overlay.
     *  2. Build clusters: a pin joins a cluster if it is within
     *     PIN_W × PIN_H pixels of ANY existing cluster member.
     *  3. Sort cluster members by salary desc (highest near map surface).
     *  4. Assign stack offsets: slot 0 → 0px, slot 1 → 1 step, …
     *  5. Assign all solo pins offset = 0 (reset any stale elevation).
     *
     * Called after plotJobMarkers() and on map 'idle' (zoom/pan).
     */
    resolveOverlaps() {
        const allOverlays = [...(this.jobMarkers || []), ...(this.lockedMarkers || [])];
        if (allOverlays.length === 0) return;

        // Only non-expanded overlays whose Google Maps projection is ready
        const items = allOverlays.map(o => {
            if (!o?.div || o.expanded) return null;
            try {
                const proj = o.getProjection?.();
                if (!proj) return null;
                const px = proj.fromLatLngToDivPixel(o.position);
                if (!px) return null;
                return { overlay: o, x: px.x, y: px.y };
            } catch { return null; }
        }).filter(Boolean);

        if (items.length === 0) return;

        // ── Fan layout slot table (dx, dy) ────────────────────────────────
        // Max 5 pins shown per cluster; rest collapse behind slot 0.
        // Slot 0 = highest salary = closest to map surface (dy=50, centred).
        // Row 1 (slots 1-2): fan left/right at the same height.
        // Row 2 (slots 3-4): second row above, offset inward.
        // All pins stay within ±200px horizontal, ≤130px vertical lift.
        const FAN_SLOTS = [
            [   0,  50],   // slot 0: straight up, close to map
            [-160,  50],   // slot 1: left, same height
            [ 160,  50],   // slot 2: right, same height
            [ -80, 130],   // slot 3: upper-left
            [  80, 130],   // slot 4: upper-right
        ];
        const MAX_FAN = FAN_SLOTS.length;

        // Cluster detection: only group pins that share nearly identical map anchor coordinates
        // (within 10px of each other), NOT when their large 200x80 labels overlap.
        const CLUSTER_RAD = 10;

        const used = new Array(items.length).fill(false);

        for (let i = 0; i < items.length; i++) {
            if (used[i]) continue;

            // Build cluster transitively (join if within CLUSTER_RAD of any member)
            const cluster = [i];
            used[i] = true;
            let changed = true;
            while (changed) {
                changed = false;
                for (let j = 0; j < items.length; j++) {
                    if (used[j]) continue;
                    const withinCluster = cluster.some(ci => {
                        const ddx = Math.abs(items[j].x - items[ci].x);
                        const ddy = Math.abs(items[j].y - items[ci].y);
                        return ddx < CLUSTER_RAD && ddy < CLUSTER_RAD;
                    });
                    if (withinCluster) {
                        cluster.push(j);
                        used[j] = true;
                        changed = true;
                    }
                }
            }

            if (cluster.length === 1) {
                // Solo pin — reset to default (no offset)
                items[cluster[0]].overlay.applyStackOffset(0, 0);
                continue;
            }

            // Sort by salary desc — highest pay gets slot 0 (nearest map surface)
            cluster.sort((a, b) => {
                const jobA = items[a].overlay.job;
                const jobB = items[b].overlay.job;
                return ((jobB?.payMax || jobB?.payMin || 0) - (jobA?.payMax || jobA?.payMin || 0));
            });

            // Assign fan slots — pins beyond MAX_FAN collapse behind slot 0
            cluster.forEach((itemIdx, slot) => {
                const [sdx, sdy] = slot < MAX_FAN ? FAN_SLOTS[slot] : FAN_SLOTS[0];
                items[itemIdx].overlay.applyStackOffset(sdx, sdy);
            });
        }
    }

    // ── UI Helpers ────────────────────────────────────────────────

    _showToast(message) {
        let toast = document.getElementById('jr-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'jr-toast';
            toast.style.cssText = `
                position: fixed;
                bottom: 100px;
                left: 50%;
                transform: translateX(-50%) translateY(20px);
                background: rgba(15, 23, 42, 0.9);
                border: 1px solid rgba(255,255,255,0.1);
                color: #fff;
                padding: 10px 20px;
                border-radius: 20px;
                font-size: 0.85rem;
                z-index: 9999;
                opacity: 0;
                transition: transform 0.3s ease, opacity 0.3s ease;
                pointer-events: none;
                text-align: center;
                box-shadow: 0 4px 12px rgba(0,0,0,0.5);
            `;
            document.body.appendChild(toast);
        }
        toast.innerText = message;
        // Trigger animation
        requestAnimationFrame(() => {
            toast.style.opacity = '1';
            toast.style.transform = 'translateX(-50%) translateY(0)';
            if (toast.timeoutId) clearTimeout(toast.timeoutId);
            toast.timeoutId = setTimeout(() => {
                toast.style.opacity = '0';
                toast.style.transform = 'translateX(-50%) translateY(20px)';
            }, 3500);
        });
    }

    // ── Job Locking ───────────────────────────────────────────────

    lockJob(job) {
        // Stamp pinnedAt if not already set (preserve original pin time on re-lock)
        const existing = this.lockedJobs.get(job.indeedJobId);
        const pinnedJob = { ...job, pinnedAt: existing?.pinnedAt || Date.now() };
        this.lockedJobs.set(job.indeedJobId, pinnedJob);
        this._saveLockedJobs();
        console.log(`[Lock] Locked: "${job.title}" (${job.indeedJobId})`);
        
        // Hide standard duplicate marker if it exists in current search
        const standardMarker = this.jobMarkers.find(o => o.job.indeedJobId === job.indeedJobId);
        if (standardMarker) standardMarker.setMap(null);

        // Re-plot locked markers so the newly locked one gets a gold border
        this._replotLockedJobs();
        // Update the Saved panel
        this.renderSavedJobs();
    }

    unlockJob(job) {
        this.lockedJobs.delete(job.indeedJobId);
        this._saveLockedJobs();
        console.log(`[Lock] Unlocked: "${job.title}"`);
        this._replotLockedJobs();

        // Restore standard marker if it exists in current search
        const standardMarker = this.jobMarkers.find(o => o.job.indeedJobId === job.indeedJobId);
        if (standardMarker) standardMarker.setMap(this.mapController.map);

        // Update the Saved panel
        this.renderSavedJobs();
    }

    _saveLockedJobs() {
        try {
            const data = Array.from(this.lockedJobs.entries());
            localStorage.setItem('jobradius_locked_jobs', JSON.stringify(data));
        } catch (e) { console.warn('[Lock] Could not save to localStorage:', e.message); }
    }

    _restoreLockedJobs() {
        try {
            const raw = localStorage.getItem('jobradius_locked_jobs');
            if (!raw) return;
            const data = JSON.parse(raw);
            if (!Array.isArray(data)) return;
            data.forEach(([id, job]) => {
                // Backfill pinnedAt for legacy entries saved before this field existed
                if (!job.pinnedAt) job.pinnedAt = Date.now();
                this.lockedJobs.set(id, job);
            });
            console.log(`[Lock] Restored ${this.lockedJobs.size} pinned jobs from localStorage`);
        } catch (e) { console.warn('[Lock] Could not restore from localStorage:', e.message); }
    }

    /**
     * Render the Saved Jobs panel (#saved-list).
     * Shows pinned jobs sorted newest-first with their notes.
     */
    async renderSavedJobs() {
        const container = document.getElementById('saved-list');
        if (!container) return;

        const sortSelect = document.getElementById('sort-saved-jobs');
        const sortValue = sortSelect ? sortSelect.value : 'dateSaved';

        const jobs = Array.from(this.lockedJobs.values()).sort((a, b) => {
            if (sortValue === 'datePosted') {
                const bTime = b.postedDate ? new Date(b.postedDate).getTime() : 0;
                const aTime = a.postedDate ? new Date(a.postedDate).getTime() : 0;
                return bTime - aTime;
            } else if (sortValue === 'pay') {
                const bPay = b.payMax || b.payMin || 0;
                const aPay = a.payMax || a.payMin || 0;
                return bPay - aPay;
            }
            // Default: 'dateSaved'
            return (b.pinnedAt || 0) - (a.pinnedAt || 0);
        });

        if (jobs.length === 0) {
            container.innerHTML = '<div class="empty-state">No pinned jobs yet. Click the 📌 pin on any job to save it here.</div>';
            return;
        }

        // Show skeleton while fetching notes
        container.innerHTML = '<div class="saved-loading">Loading saved jobs…</div>';

        // Fetch notes for all pinned jobs in parallel
        const token = localStorage.getItem('jobradius_token');
        const headers = token ? { 'Authorization': `Bearer ${token}` } : {};

        const noteMap = {};
        await Promise.all(jobs.map(async (j) => {
            try {
                const res = await fetch(`/api/notes/by-job/${encodeURIComponent(j.indeedJobId)}`, { headers });
                if (res.ok) {
                    const data = await res.json();
                    // API returns { success: true, data: note } — note has .content
                    if (data.data?.content) noteMap[j.indeedJobId] = data.data.content;
                }
            } catch { /* ignore — notes are optional */ }
        }));

        // Render cards
        container.innerHTML = jobs.map(j => {
            const pay = j.payMax
                ? `$${Math.round(j.payMin || 0).toLocaleString()}–$${Math.round(j.payMax).toLocaleString()}`
                : j.payMin ? `$${Math.round(j.payMin).toLocaleString()}` : '';
            
            let dateLabel = '';
            if (sortValue === 'datePosted' && j.postedDate) {
                dateLabel = `Posted ${new Date(j.postedDate).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
            } else if (sortValue === 'datePosted') {
                dateLabel = 'Posted: Unknown';
            } else if (j.pinnedAt) {
                dateLabel = `Pinned ${new Date(j.pinnedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
            }
            
            const note = noteMap[j.indeedJobId] || '';
            const noteDisplay = note ? 'block' : 'none';
            const noteHtml = `
                <div class="saved-note-container" style="display: ${noteDisplay}; margin-top: 8px;">
                    <textarea class="saved-note-area" placeholder="Add notes here..." rows="2" style="width: 100%; box-sizing: border-box; padding: 4px; border-radius: 4px; border: 1px solid #ccc;">${note}</textarea>
                    <button class="btn-save-inline-note" style="margin-top: 4px; font-size: 0.75rem;">Save Note</button>
                    <span class="inline-note-feedback" style="font-size: 0.75rem; color: #4caf50; display: none; margin-left: 6px;">Saved!</span>
                </div>
            `;
            return `
            <div class="saved-job-card" data-job-id="${j.indeedJobId}" title="Click to view job details" style="cursor:pointer">
                <div class="saved-job-meta">
                    ${pay ? `<span class="saved-pay">${pay}</span>` : ''}
                    <span class="saved-date">${dateLabel}</span>
                </div>
                <div class="saved-job-title">${j.title || 'Untitled'}</div>
                ${j.company ? `<div class="saved-company">${j.company}</div>` : ''}
                ${noteHtml}
                <div class="saved-job-actions">
                    <button class="btn-unpin" data-job-id="${j.indeedJobId}">📌 Unpin</button>
                    <button class="btn-route" data-job-id="${j.indeedJobId}">🚗 Route</button>
                    <button class="btn-note" data-job-id="${j.indeedJobId}">📝 Notes</button>
                    ${j.indeedUrl ? `<a class="btn-job-link" href="${j.indeedUrl}" target="_blank" rel="noopener">View Job ↗</a>` : ''}
                </div>
            </div>`;
        }).join('');

        // Wire up card click → open job detail view
        container.querySelectorAll('.saved-job-card').forEach(card => {
            card.addEventListener('click', async (e) => {
                // Ignore clicks on links or unpin
                if (e.target.closest('.btn-unpin') || e.target.closest('.btn-job-link')) return;
                
                const id = card.dataset.jobId;
                const job = this.lockedJobs.get(id);
                if (!job) return;

                // Handle Inline Route button
                if (e.target.closest('.btn-route')) {
                    this.currentSelectedJob = job;
                    this.showInAppRoute();
                    return;
                }

                const noteContainer = card.querySelector('.saved-note-container');
                const noteArea = card.querySelector('.saved-note-area');

                // Handle Inline Notes button (Toggle)
                if (e.target.closest('.btn-note')) {
                    if (noteContainer.style.display === 'none') {
                        noteContainer.style.display = 'block';
                        noteArea.focus();
                    } else {
                        noteContainer.style.display = 'none';
                    }
                    return;
                }

                // Handle Save Note button
                if (e.target.closest('.btn-save-inline-note')) {
                    const content = noteArea.value;
                    const feedback = card.querySelector('.inline-note-feedback');
                    const btn = e.target.closest('.btn-save-inline-note');
                    const token = localStorage.getItem('jobradius_token');
                    
                    btn.disabled = true;
                    btn.textContent = 'Saving...';
                    try {
                        const res = await fetch('/api/notes', {
                            method: 'POST',
                            headers: {
                                'Content-Type': 'application/json',
                                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                            },
                            body: JSON.stringify({ indeedJobId: id, noteText: content })
                        });
                        if (res.ok) {
                            btn.textContent = 'Save Note';
                            btn.disabled = false;
                            feedback.style.display = 'inline';
                            setTimeout(() => feedback.style.display = 'none', 2000);
                        } else {
                            throw new Error('Failed to save');
                        }
                    } catch (err) {
                        btn.textContent = 'Error!';
                        setTimeout(() => { btn.textContent = 'Save Note'; btn.disabled = false; }, 2000);
                    }
                    return;
                }

                // If they click inside the note container (e.g. typing), do nothing
                if (e.target.closest('.saved-note-container')) return;

                // Otherwise, open standard job details
                this.showJobDetail(job);
            });
        });

        // Wire up Unpin buttons
        container.querySelectorAll('.btn-unpin').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.jobId;
                const job = this.lockedJobs.get(id);
                if (job) this.unlockJob(job);
            });
        });
    }

    _replotLockedJobs() {
        if (!this.mapController.map) return;

        // ── PREMIUM GATE: Pins are wiped from map if pass expired ──
        if (!this.isPremium) {
            this.lockedMarkers.forEach(m => m.setMap(null));
            this.lockedMarkers = [];
            return;
        }

        // Remove existing locked markers and redraw all
        this.lockedMarkers.forEach(m => m.setMap(null));
        this.lockedMarkers = [];

        this.lockedJobs.forEach((job) => {
            if (!job.lat || !job.lng) return;
            const overlay = createJobInfoOverlay(
                { lat: job.lat, lng: job.lng },
                job,
                {
                    isLocked: true,
                    onExpand: (o) => {
                        this.showJobDetail(o.job);
                    },
                    onLock: (j, locked) => {
                        // Toggling off: unlock it
                        if (!locked) this.unlockJob(j);
                    },
                    onRoute: (j) => {
                        this.currentSelectedJob = j;
                        this.showInAppRoute();
                    },
                    onSaveNote: async (j, noteText) => {
                        try {
                            const token = localStorage.getItem('jobradius_token');
                            const headers = { 'Content-Type': 'application/json' };
                            if (token) headers['Authorization'] = `Bearer ${token}`;
                            await fetch('/api/notes', {
                                method: 'POST', headers,
                                body: JSON.stringify({ jobId: j.id, title: j.title, content: noteText })
                            });
                        } catch (e) { console.error('[Note] Save failed:', e.message); }
                    },
                    onHide: (j) => { this.unlockJob(j); this.hideJob(j); }
                }
            );
            overlay.setMap(this.mapController.map);
            this.lockedMarkers.push(overlay);
        });

        // Re-calculate cluster fans after Google Maps draws them
        setTimeout(() => this.resolveOverlaps(), 400);
    }

    // ── Admin Panel Metrics ──────────────────────────────────────
    async loadAdminMetrics() {
        if (!this.adminPanel) return;

        const token = localStorage.getItem('jobradius_token');
        const contentDiv = document.getElementById('admin-metrics-content');

        if (!token) {
            contentDiv.innerHTML = `<div style="color:#ef4444;">No token available. Login required.</div>`;
            return;
        }

        try {
            const res = await fetch('/api/admin/metrics', {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                contentDiv.innerHTML = `
                    <div class="admin-metric-group">
                        <strong style="color:var(--accent-cyan); display:block; margin-bottom:8px;">New Users</strong>
                        <div class="admin-metric-row"><span>Today:</span> <span>${data.users.day}</span></div>
                        <div class="admin-metric-row"><span>This Week:</span> <span>${data.users.week}</span></div>
                        <div class="admin-metric-row"><span>This Month:</span> <span>${data.users.month}</span></div>
                        <div class="admin-metric-row" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:6px;"><span>Total:</span> <span>${data.users.total}</span></div>
                    </div>
                    <div class="admin-metric-group">
                        <strong style="color:var(--accent-green); display:block; margin-bottom:8px;">Earnings (Stripe)</strong>
                        <div class="admin-metric-row"><span>Today:</span> <span>${data.earnings.day}</span></div>
                        <div class="admin-metric-row"><span>This Week:</span> <span>${data.earnings.week}</span></div>
                        <div class="admin-metric-row"><span>This Month:</span> <span>${data.earnings.month}</span></div>
                        <div class="admin-metric-row" style="border-top:1px solid rgba(255,255,255,0.1);margin-top:6px;padding-top:6px;"><span>All Time:</span> <span>${data.earnings.total}</span></div>
                    </div>
                    <div class="admin-metric-group">
                        <strong style="color:var(--text-primary); display:block; margin-bottom:8px;">Subscriptions</strong>
                        <div class="admin-metric-row"><span>Active:</span> <span>${data.memberships.active}</span></div>
                        <div class="admin-metric-row"><span>Day Pass:</span> <span>${data.memberships.dayPass}</span></div>
                        <div class="admin-metric-row"><span>Inactive:</span> <span>${data.memberships.inactive}</span></div>
                        <div class="admin-metric-row"><span>Canceled:</span> <span>${data.memberships.canceled}</span></div>
                    </div>
                    <div class="admin-metric-group">
                        <strong style="color:#a78bfa; display:block; margin-bottom:8px;">Job Searches</strong>
                        <div class="admin-metric-row"><span>Today:</span> <span>${data.searches.today}</span></div>
                        <div class="admin-metric-row"><span>This Week:</span> <span>${data.searches.thisWeek}</span></div>
                    </div>

                    <div class="admin-metric-group" style="border-top:1px solid rgba(255,255,255,0.12); padding-top:14px; margin-top:4px;">
                        <strong style="color:#f59e0b; display:block; margin-bottom:12px;">🎬 Map Animation Settings</strong>

                        ${this._animSlider('frameMs', 'Frame Duration (ms)', 45, 500, 5,
                    'Time between each interpolation frame. 45ms = 22fps (fast). 180ms = 4× slower. 500ms = very cinematic.')}
                        ${this._animSlider('framesPerPhase', 'Frames per Phase', 5, 40, 1,
                        'Number of interpolation steps per animation phase. More = smoother but longer.')}
                        ${this._animSlider('holdMs', 'Hold Between Phases (ms)', 0, 2000, 50,
                            'Pause between each of the 3 animation phases. 0 = no pause.')}
                        ${this._animSlider('northResetMs', 'North-Reset Frames', 4, 30, 1,
                                'Frames used to smoothly rotate back to true north after landing.')}

                        <div style="display:flex;gap:8px;margin-top:10px;">
                            <button id="anim-apply" style="flex:1;padding:7px;background:var(--accent-cyan);color:#000;border:none;border-radius:6px;font-size:0.8rem;font-weight:600;cursor:pointer;">Apply & Save</button>
                            <button id="anim-reset" style="flex:1;padding:7px;background:rgba(255,255,255,0.08);color:var(--text-secondary);border:none;border-radius:6px;font-size:0.8rem;cursor:pointer;">Reset Defaults</button>
                        </div>
                        <div id="anim-status" style="font-size:0.72rem;color:var(--accent-green);text-align:center;margin-top:6px;height:14px;"></div>
                    </div>
                `;

                // Wire up sliders to show live values
                this._wireAnimSliders();

            } else {
                contentDiv.innerHTML = `<div style="color:#ef4444;">Failed to load metrics. HTTP ${res.status}</div>`;
            }
        } catch (e) {
            console.error(e);
            contentDiv.innerHTML = `<div style="color:#ef4444;">Network error loading metrics.</div>`;
        }
    }

    /** Build a labeled range slider HTML for a given ANIM_CONFIG key */
    _animSlider(key, label, min, max, step, hint) {
        const val = window.ANIM_CONFIG[key] || 0;
        return `
            <div style="margin-bottom:10px;">
                <div style="display:flex;justify-content:space-between;margin-bottom:3px;">
                    <label style="font-size:0.75rem;color:var(--text-secondary);">${label}</label>
                    <span id="anim-val-${key}" style="font-size:0.75rem;color:var(--accent-cyan);font-weight:600;">${val}</span>
                </div>
                <input type="range" id="anim-${key}" min="${min}" max="${max}" step="${step}" value="${val}"
                    style="width:100%;accent-color:var(--accent-cyan);cursor:pointer;"
                    oninput="document.getElementById('anim-val-${key}').innerText=this.value">
                <div style="font-size:0.68rem;color:rgba(255,255,255,0.35);margin-top:2px;">${hint}</div>
            </div>`;
    }

    /** Wire Apply / Reset buttons and keep value labels live */
    _wireAnimSliders() {
        const keys = ['frameMs', 'framesPerPhase', 'holdMs', 'northResetMs'];
        const statusEl = document.getElementById('anim-status');

        document.getElementById('anim-apply')?.addEventListener('click', () => {
            keys.forEach(k => {
                const el = document.getElementById(`anim-${k}`);
                if (el) window.ANIM_CONFIG[k] = parseFloat(el.value);
            });
            localStorage.setItem('anim_config', JSON.stringify(window.ANIM_CONFIG));
            if (statusEl) { statusEl.innerText = '✓ Saved'; setTimeout(() => statusEl.innerText = '', 2000); }
        });

        document.getElementById('anim-reset')?.addEventListener('click', () => {
            const defaults = { frameMs: 180, framesPerPhase: 10, holdMs: 0, northResetMs: 8 };
            window.ANIM_CONFIG = { ...defaults };
            localStorage.setItem('anim_config', JSON.stringify(defaults));
            keys.forEach(k => {
                const el = document.getElementById(`anim-${k}`);
                const lbl = document.getElementById(`anim-val-${k}`);
                if (el) el.value = defaults[k];
                if (lbl) lbl.innerText = defaults[k];
            });
            if (statusEl) { statusEl.innerText = '↩ Reset to defaults'; setTimeout(() => statusEl.innerText = '', 2000); }
        });
    }

} // Ends JobRadiusApp class

// Build and connect the app instance safely preventing async race conditions
const bootApp = () => {
    console.log('Boot sequence initiated...');

    // Check if both systems are ready
    if (window.googleMapsLoaded && document.readyState !== 'loading') {
        console.log('Dependencies fully met. Initializing App.');
        if (!window._jobRadiusApp) {
            if (navigator.geolocation) {
                console.log('Requesting Browser Geolocation...');
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        console.log('Location acquired:', pos.coords.latitude, pos.coords.longitude);
                        window._jobRadiusApp = new JobRadiusApp({ lat: pos.coords.latitude, lng: pos.coords.longitude });
                    },
                    (err) => {
                        console.warn('Geolocation denied or failed. Defaulting to Austin, TX.', err);
                        window._jobRadiusApp = new JobRadiusApp();
                    },
                    { timeout: 5000 }
                );
            } else {
                window._jobRadiusApp = new JobRadiusApp();
            }
        }
    } else {
        console.log('Waiting for asynchronous modules...');
        // CRITICAL: index.html dispatches 'google-maps-loaded' on `document`, NOT `window`
        document.removeEventListener('google-maps-loaded', bootApp);
        document.removeEventListener('DOMContentLoaded', bootApp);

        if (!window.googleMapsLoaded) {
            document.addEventListener('google-maps-loaded', bootApp);
        }
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', bootApp);
        }
    }
};

bootApp(); // Kick off immediately (it will wait natively)
