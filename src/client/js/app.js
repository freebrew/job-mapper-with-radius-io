/**
 * JobRadius - Main Application Entry
 */

import { MapController } from './map/mapController.js';
import { createJobInfoOverlay } from './map/jobInfoOverlay.js';
import { RadiusManager } from './map/radiusManager.js';

class JobRadiusApp {
    constructor(startLocation) {
        this.mapController = new MapController('map');
        this.radiusManager = null;
        this.currentCenter = null;
        this.startLocation = startLocation || null;

        // DOM Elements
        this.searchInput = document.getElementById('map-search-box');
        this.jobKeyword = document.getElementById('job-keyword');
        this.btnSearch = document.getElementById('btn-search');
        this.btnAddInclusive = document.getElementById('btn-add-inclusive');
        this.btnAddExclusive = document.getElementById('btn-add-exclusive');
        this.radiusList = document.getElementById('radius-list');
        this.radiusPanel = document.getElementById('radius-panel'); // Mobile Top Drawer

        // Mobile Top Tabs
        this.mobileTopTabs = document.getElementById('mobile-top-tabs');
        this.tabSearch = document.getElementById('tab-search');
        this.tabRadius = document.getElementById('tab-radius');
        this.header = document.querySelector('header.top-drawer');

        // Mobile Elements
        this.btnLogin = document.getElementById('btn-login');
        this.btnSubscribe = document.getElementById('btn-subscribe');
        this.btnCheckout = document.getElementById('btn-checkout');
        this.authModal = document.getElementById('auth-modal');
        this.paymentModal = document.getElementById('payment-modal');
        this.modalOverlay = document.getElementById('modal-overlay');
        this.jobDetailSheet = document.getElementById('job-detail-sheet');
        this.jdsMiniTitle = document.getElementById('jds-mini-title');
        this.jdsMiniPay = document.getElementById('jds-mini-pay');
        this.btnJdsExpand = document.getElementById('btn-jds-expand');
        this.btnCloseDetail = document.getElementById('btn-close-detail');
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
        this.btnAdminPanel = document.getElementById('btn-admin-panel');
        this.adminPanel = document.getElementById('admin-panel');
        this.btnCloseAdmin = document.getElementById('btn-close-admin');

        // Auto-start the app immediately after construction
        this.startApp();

        // Default Mobile State (Open Search Panel)
        if (window.innerWidth < 768 && this.header && this.tabSearch) {
            this.header.classList.add('panel-open');
            this.tabSearch.classList.add('active');
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
            this.setupSearchBox();
            this._populateJobAutocomplete();
            this.setupModals();

            // Restore session from localStorage (persist login across refreshes)
            this.restoreSession();

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
     * Restores login state from localStorage without a new network request.
     * Called on every startup so the user doesn't have to re-login after refresh.
     */
    restoreSession() {
        const token = localStorage.getItem('jobradius_token');
        const userStr = localStorage.getItem('jobradius_user');
        if (!token || !userStr) return;

        try {
            const user = JSON.parse(userStr);
            let displayName = user.name || user.email.split('@')[0];

            // Consolidate name for mobile screens (Initials only)
            if (window.innerWidth < 768 && user.name) {
                const parts = user.name.split(' ').filter(p => p.trim() !== '');
                if (parts.length >= 2) {
                    displayName = (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
                } else if (parts.length === 1) {
                    displayName = parts[0].substring(0, 2).toUpperCase();
                }
            }

            this.btnLogin.innerText = displayName;

            if (user.email === 'bruno.brottes@gmail.com' && this.btnAdminPanel) {
                this.btnAdminPanel.classList.remove('hidden');
            }
            console.log('[Session] Restored session for:', user.email);
        } catch (e) {
            // Corrupted user data — clear it
            localStorage.removeItem('jobradius_token');
            localStorage.removeItem('jobradius_user');
        }

        this.checkPremiumStatus();
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
            this.btnSubscribe.innerText = "Premium Active";
            return;
        }

        // Check the 24-hour pass
        if (user.dayPassExpiresAt) {
            const expiresDate = new Date(user.dayPassExpiresAt);

            // Clear any existing timer
            if (this.premiumTimerToken) clearInterval(this.premiumTimerToken);

            this.premiumTimerToken = setInterval(() => {
                const now = new Date();
                const diffTime = expiresDate - now;

                if (diffTime <= 0) {
                    // Expired
                    clearInterval(this.premiumTimerToken);
                    this.isPremium = false;
                    this.btnSubscribe.innerText = "Get 24hr Pass";
                } else {
                    this.isPremium = true;
                    // Format diff into HHh MMm SSs
                    const hours = Math.floor(diffTime / (1000 * 60 * 60));
                    const minutes = Math.floor((diffTime % (1000 * 60 * 60)) / (1000 * 60));
                    const seconds = Math.floor((diffTime % (1000 * 60)) / 1000);
                    this.btnSubscribe.innerText = `${hours}h ${minutes}m ${seconds}s Left`;
                }
            }, 1000); // tick every second

        } else {
            this.isPremium = false;
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
            this.radiusManager.addZone('inclusive', 5000, { lat, lng, address: place.formatted_address });
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

        // Mobile Top Tabs Accordion Logic
        if (this.tabSearch && this.tabRadius && this.header && this.radiusPanel) {
            this.tabSearch.addEventListener('click', () => {
                const isOpen = this.header.classList.contains('panel-open');
                if (isOpen) {
                    this.header.classList.remove('panel-open');
                    this.tabSearch.classList.remove('active');
                } else {
                    this.header.classList.add('panel-open');
                    this.tabSearch.classList.add('active');
                    this.radiusPanel.classList.remove('panel-open');
                    this.tabRadius.classList.remove('active');
                }
            });

            this.tabRadius.addEventListener('click', () => {
                const isOpen = this.radiusPanel.classList.contains('panel-open');
                if (isOpen) {
                    this.radiusPanel.classList.remove('panel-open');
                    this.tabRadius.classList.remove('active');
                } else {
                    this.radiusPanel.classList.add('panel-open');
                    this.tabRadius.classList.add('active');
                    this.header.classList.remove('panel-open');
                    this.tabSearch.classList.remove('active');
                }
            });
        }

        // Close Panels if map is clicked
        document.getElementById('map').addEventListener('click', () => {
            if (window.innerWidth < 768) {
                if (this.header) this.header.classList.remove('panel-open');
                if (this.radiusPanel) this.radiusPanel.classList.remove('panel-open');
                if (this.tabSearch) this.tabSearch.classList.remove('active');
                if (this.tabRadius) this.tabRadius.classList.remove('active');
            }
            if (this.jobDetailSheet) {
                this.jobDetailSheet.classList.add('hidden');
                this.jobDetailSheet.classList.remove('sheet-fullscreen');
                this.jobDetailSheet.classList.remove('sheet-minimized');
                this.disableFocusMode();
                this.clearRoute();
            }
        });

        // JDS Expand button
        if (this.btnJdsExpand && this.jobDetailSheet) {
            this.btnJdsExpand.addEventListener('click', () => {
                this.jobDetailSheet.classList.remove('sheet-minimized');
                this.jobDetailSheet.classList.add('sheet-fullscreen');
            });
        }

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

        // JDS Minimize Handle
        const jdsHandle = document.querySelector('#job-detail-sheet .sheet-handle');
        if (jdsHandle && this.jobDetailSheet) {
            jdsHandle.addEventListener('click', () => {
                // Allows user to collapse the full detail view without unselecting the job
                this.jobDetailSheet.classList.remove('sheet-fullscreen');
                this.jobDetailSheet.classList.add('sheet-minimized');
            });
        }

        // Radius Management — inline address picker for each zone
        this.btnAddInclusive.addEventListener('click', () => this._showZoneAddressForm('inclusive'));
        this.btnAddExclusive.addEventListener('click', () => this._showZoneAddressForm('exclusive'));

        // Listen for radius changes — re-filter jobs and refit map around all zones
        this.radiusManager.onChange(zones => {
            this.updateRadiusUI();
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
        this.btnSubscribe.addEventListener('click', () => showModal(this.paymentModal));

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

        // Route Here — in-app Google Directions
        this.btnRouteHere.addEventListener('click', () => {
            if (this.currentSelectedJob && this.currentCenter) {
                this.showInAppRoute();
            } else {
                alert('Please select a center location and a job first.');
            }
        });

        // Hide Job Button
        this.btnHideJob.addEventListener('click', () => {
            if (this.currentSelectedJob) {
                this.hideJob(this.currentSelectedJob);
            }
        });

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

        // Job Mini Panel Close
        this.btnCloseDetail.addEventListener('click', () => {
            if (this.jobDetailSheet) {
                this.jobDetailSheet.classList.add('hidden');
                this.jobDetailSheet.classList.remove('sheet-fullscreen');
                this.jobDetailSheet.classList.remove('sheet-minimized');
            }
            this.clearRoute();
            this.disableFocusMode();
        });

        // Add Note Toggle
        this.btnAddNote.addEventListener('click', () => {
            this.noteForm.classList.toggle('hidden');
        });

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
        if (this.btnCloseAdmin) {
            this.btnCloseAdmin.addEventListener('click', () => {
                this.adminPanel.classList.add('admin-hidden');
            });
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
                this.btnLogin.innerText = data.user.name || email.split('@')[0];

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
            const res = await fetch('/api/stripe/create-checkout-session', {
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
        this.enableFocusMode(job); // Hide other map pins

        // Build a safe apply URL: prefer direct job URL, fallback to Indeed search
        const applyUrl = (job.url && !job.url.includes('google.com/search?q='))
            ? job.url
            : `https://www.indeed.com/jobs?q=${encodeURIComponent(job.title + ' ' + (job.company || ''))}&l=${encodeURIComponent(job.location || 'Remote')}&fromage=30`;

        const displayCompany = this.isPremium ? job.company : 'Premium Required';

        this.jobDetailContent.innerHTML = `
            <h2 style="color: var(--accent-cyan); margin-bottom: 4px;">${job.title}</h2>
            <h4 style="color: var(--text-secondary); margin-bottom: 12px; font-weight: 500;">${this.isPremium ? '🏢' : '🔒'} ${displayCompany}</h4>
            <div style="display:flex; justify-content:space-between; margin-bottom: 16px; border-bottom: 1px solid var(--border-glass); padding-bottom: 12px;">
                <span style="color:#10b981; font-weight:bold;">${job.payMin ? `💰 $${job.payMin.toLocaleString()}` : 'Pay N/A'}</span>
                <span>⭐ ${job.rating || 'New'}</span>
            </div>
            <p style="color: var(--text-primary); font-size: 0.95rem; line-height: 1.5; margin-bottom: 16px;">
                Click "Apply for Job" below to view the full listing and description on Indeed.
                <br><br>Location: ${job.location || 'Remote'}
            </p>
            ${job.snippet ? `<div style="background:rgba(255,255,255,0.05); padding:12px; border-radius:8px; border-left:3px solid var(--accent-cyan); margin-bottom:16px; font-size:0.9rem; line-height:1.4; color:var(--text-secondary);">"${job.snippet}"</div>` : ''}
            <a href="${applyUrl}" target="_blank" rel="noopener noreferrer" class="btn-primary" style="display:block; text-align:center; text-decoration:none;">Apply for Job</a>
            <div id="route-steps" style="margin-top:12px;"></div>
        `;

        if (this.jdsMiniTitle) this.jdsMiniTitle.textContent = job.title;
        if (this.jdsMiniPay) this.jdsMiniPay.textContent = job.payMin ? `$${(job.payMin / 1000).toFixed(0)}k` : 'N/A';

        this.jobDetailSheet.classList.remove('hidden');
        this.jobDetailSheet.classList.remove('sheet-minimized');
        this.jobDetailSheet.classList.add('sheet-fullscreen');
        this.noteForm.classList.add('hidden'); // Reset note form

        if (this.btnLockJob) {
            const isLocked = this.lockedJobs.has(job.indeedJobId);
            this.btnLockJob.innerText = isLocked ? '🔓 Unpin' : '📌 Pin';
        }

        // Cinematic fly to job location — tilt 60, north heading, auto-reset via shortest angle
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

        this.btnRouteHere.innerText = '⏳ Routing...';

        this.directionsService.route({
            origin: { lat: center.lat, lng: center.lng },
            destination: { lat: job.lat, lng: job.lng },
            travelMode: google.maps.TravelMode[travelMode]
        }, (result, status) => {
            this.btnRouteHere.innerText = '🚗 Route';

            if (status === 'OK') {
                this.directionsRenderer.setDirections(result);

                // Orient map to north after route renders (shortest-angle turn)
                this.mapController.resetToNorth(400);

                // Mobile UX: Minimize the job panel so the user can see the route
                if (window.innerWidth < 768 && this.jobDetailSheet) {
                    this.jobDetailSheet.classList.remove('sheet-fullscreen');
                    this.jobDetailSheet.classList.add('sheet-minimized');
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

        // Close detail panel
        this.jobDetailSheet.classList.add('hidden');
        this.jobDetailSheet.classList.remove('sheet-fullscreen');
        this.jobDetailSheet.classList.remove('sheet-minimized');
        this.currentSelectedJob = null;
        this.clearRoute();
        this.disableFocusMode();
    }

    // ── Map Pin Focus Mode ────────────────────────────────────────

    enableFocusMode(selectedJob) {
        if (!this.jobMarkers) return;
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

    disableFocusMode() {
        if (!this.jobMarkers) return;
        this.jobMarkers.forEach(overlay => {
            if (overlay.div) {
                overlay.div.style.opacity = '1';
                overlay.div.style.pointerEvents = 'auto';
            }
        });
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

            // Mobile UX: Automatically close the radius drawer when a zone is added
            if (window.innerWidth < 768 && this.radiusPanel) {
                this.radiusPanel.classList.remove('panel-open');
                if (this.tabRadius) this.tabRadius.classList.remove('active');
            }
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

        // If user typed a location but didn't select autocomplete, geocode it
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

        // Add first inclusive zone if none exist
        if (!this.radiusManager.getZonesData().length) {
            this.radiusManager.addZone('inclusive', 5000, this.currentCenter);
        }

        // Mobile UX: Automatically close the search drawer when a search begins
        if (window.innerWidth < 1200 && this.header) {
            this.header.classList.remove('panel-open');
            if (this.tabSearch) this.tabSearch.classList.remove('active');
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
                const existingToken = localStorage.getItem('jobradius_token');
                if (!existingToken) {
                    this.modalOverlay.classList.remove('hidden');
                    this.authModal.classList.remove('hidden');
                } else {
                    localStorage.removeItem('jobradius_token');
                    localStorage.removeItem('jobradius_user');
                    this.btnLogin.innerText = 'Login';
                    this.modalOverlay.classList.remove('hidden');
                    this.authModal.classList.remove('hidden');
                }
                const container = document.getElementById('job-list-container'); // Assuming container is defined here
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
        const container = document.getElementById('job-list-container');
        document.getElementById('job-count').innerText = jobs.length;

        if (jobs.length === 0) {
            container.innerHTML = '<div class="empty-state">No jobs found in these specific zones.</div>';
            return;
        }

        // Sort jobs by highest pay descending
        jobs.sort((a, b) => {
            const payA = a.payMax || a.payMin || 0;
            const payB = b.payMax || b.payMin || 0;
            return payB - payA;
        });

        container.innerHTML = '';
        jobs.forEach((j, index) => {
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
            div.style.cssText = "padding:14px; background:rgba(255,255,255,0.05); border-radius:8px; border:1px solid rgba(255,255,255,0.1); cursor:pointer; transition: background 0.2s;";
            div.innerHTML = `
                <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:4px;">
                    <h4 style="color:#06b6d4; margin:0; flex:1;">${j.title}</h4>
                    ${ageText ? `<span style="font-size:0.75rem; color:#64748b; white-space:nowrap; margin-left:8px;">${ageText}</span>` : ''}
                </div>
                <div style="font-size:0.85rem; color:#94a3b8; margin-bottom:6px;">${j.company} ${ratingText ? `<span style="color:#f59e0b; margin-left:6px;">${ratingText}</span>` : ''}</div>
                <div style="font-size:0.8rem; display:flex; flex-wrap:wrap; gap:8px; align-items:center;">
                    <span style="color:#94a3b8;">📍 ${j.location || 'Remote'}</span>
                    ${payText ? `<span style="color:#10b981; font-weight:600;">💰 ${payText}</span>` : '<span style="color:#64748b;">💰 Pay N/A</span>'}
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

        let mobileOmittedCount = 0;

        jobs.forEach(j => {
            // Skip jobs without valid coordinates
            if (j.lat == null || j.lng == null || isNaN(j.lat) || isNaN(j.lng)) {
                console.warn('[plot] Skipping job with invalid coords:', j.title);
                return;
            }

            // Mobile specific filtering: Omit jobs without a listed salary
            if (window.innerWidth < 768 && !j.payMin && !j.payMax) {
                mobileOmittedCount++;
                return;
            }

            // Don't re-add if already shown as a locked marker
            if (this.lockedJobs.has(j.indeedJobId)) return;

            const overlay = createJobInfoOverlay(
                { lat: j.lat, lng: j.lng },
                j,
                {
                    isLocked: false,
                    onExpand: (o) => {
                        if (window.innerWidth < 1200) {
                            this.showJobDetail(o.job);
                            return;
                        }
                        if (this._expandedOverlay && this._expandedOverlay !== o) {
                            this._expandedOverlay.collapse();
                        }
                        this._expandedOverlay = o;
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
            overlay.setMap(this.mapController.map);
            this.jobMarkers.push(overlay);
        });

        // Always re-plot locked jobs after a fresh search clear
        if (!append) this._replotLockedJobs();

        // Show toast if mobile filtered out jobs
        if (mobileOmittedCount > 0) {
            this._showToast(`Omitted ${mobileOmittedCount} jobs without salary data to save screen space.`);
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
        this.lockedJobs.set(job.indeedJobId, job);
        this._saveLockedJobs();
        console.log(`[Lock] Locked: "${job.title}" (${job.indeedJobId})`);
        // Re-plot locked markers so the newly locked one gets a gold border
        this._replotLockedJobs();
    }

    unlockJob(job) {
        this.lockedJobs.delete(job.indeedJobId);
        this._saveLockedJobs();
        console.log(`[Lock] Unlocked: "${job.title}"`);
        this._replotLockedJobs();
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
            data.forEach(([id, job]) => this.lockedJobs.set(id, job));
            console.log(`[Lock] Restored ${this.lockedJobs.size} pinned jobs from localStorage`);
        } catch (e) { console.warn('[Lock] Could not restore from localStorage:', e.message); }
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
                        if (window.innerWidth < 1200) {
                            this.showJobDetail(o.job);
                            return;
                        }
                        if (this._expandedOverlay && this._expandedOverlay !== o) {
                            this._expandedOverlay.collapse();
                        }
                        this._expandedOverlay = o;
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
    }

    // ── Admin Panel Metrics ──────────────────────────────────────
    async loadAdminMetrics() {
        if (!this.adminPanel) return;
        this.adminPanel.classList.remove('admin-hidden');

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
