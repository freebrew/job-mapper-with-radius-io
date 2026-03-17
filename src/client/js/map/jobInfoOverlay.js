/**
 * JobInfoOverlay — Custom OverlayView that renders expandable info panels on the map.
 *
 * Collapsed pin:
 *   ┌──────────────────────┐
 *   │  $67,000 – $78,000   │   ← large salary (annualized)
 *   │  Acme Corp  ⭐ 3.4   │   ← company + rating
 *   │  Welder              │   ← job title
 *   └─────────┬────────────┘
 *             ▼
 *
 * Expanded panel: full details, no-scroll description, Route/Note/Hide/📌Lock buttons.
 * Locked jobs get a gold border and persist across new searches.
 */

let _OverlayClass = null;

export function createJobInfoOverlay(position, job, callbacks) {
    if (!_OverlayClass) {
        _OverlayClass = _buildClass();
    }
    return new _OverlayClass(position, job, callbacks);
}

function _buildClass() {
    class JobInfoOverlay extends google.maps.OverlayView {
        constructor(position, job, callbacks = {}) {
            super();
            this.position = position instanceof google.maps.LatLng
                ? position
                : new google.maps.LatLng(position.lat, position.lng);
            this.job = job;
            this.callbacks = callbacks;
            this.div = null;
            this.expanded = false;
            this._noteVisible = false;
            this.isLocked = callbacks.isLocked || false;
            this._stackOffset = 0;  // vertical pixel offset for collision stacking
        }

        // ── Google OverlayView lifecycle ────────────────────────────

        onAdd() {
            this.div = document.createElement('div');
            this.div.className = 'job-overlay' + (this.isLocked ? ' job-overlay--locked' : '');
            this.div.innerHTML = this._buildCollapsed();

            // Click → toggle expanded/collapsed
            // IMPORTANT: Do NOT do any DOM re-insertion here (no _raiseToTop call).
            // DOM re-insertion mid-pointer-sequence kills the click in Google Maps panes.
            this.div.addEventListener('click', (e) => {
                e.stopPropagation(); // Prevent bubbling up to the map which closes the sheets
                if (e.target.closest('.jo-actions') ||
                    e.target.closest('.jo-quick-pin') ||
                    e.target.closest('.jo-note-form') ||
                    e.target.tagName === 'A') return;
                this.toggle();
            });

            // Initialize event delegation routing for all injected map buttons
            this._wireActions();

            // Hover: bump z-index only — NEVER re-insert the DOM node here.
            // Re-inserting on mouseenter/pointerdown breaks the Maps event chain.
            this.div.addEventListener('mouseenter', () => this._bumpZIndex());
            this.div.addEventListener('mouseleave', () => {
                // Restore base z-index (expanded panel keeps its elevated z)
                if (!this.expanded) this.div.style.zIndex = '5';
            });

            const panes = this.getPanes();
            panes.overlayMouseTarget.appendChild(this.div);
        }

        draw() {
            if (!this.div) return;
            const proj = this.getProjection();
            if (!proj) return;
            const pos = proj.fromLatLngToDivPixel(this.position);
            if (!pos) return;
            // Always anchor at geo point — chip position is controlled by CSS transform
            this.div.style.left = pos.x + 'px';
            this.div.style.top  = pos.y + 'px';
        }

        onRemove() {
            if (this.div) {
                this.div.remove();
                this.div = null;
            }
        }

        // ── Public API ──────────────────────────────────────────────

        expand() {
            if (this.expanded) return;
            this.expanded = true;
            this._noteVisible = false;

            // On ALL screen sizes: just mark this overlay as active (visual highlight only)
            // and fire the onExpand callback — the sidebar / bottom-sheet handles the details.
            // We never build the full inline expanded HTML here; the pin stays compact on the map.
            this.div.classList.add('job-overlay--active');
            this._raiseToTop();
            if (this.callbacks.onExpand) this.callbacks.onExpand(this);
        }

        collapse() {
            if (!this.expanded) return;
            this.expanded = false;
            this.div.classList.remove('job-overlay--expanded');
            this.div.classList.remove('job-overlay--active');
            this.div.innerHTML = this._buildCollapsed();
            this.draw();
        }

        toggle() {
            this.expanded ? this.collapse() : this.expand();
        }

        /**
         * Fan this pin to a (dx, dy) offset from its geo anchor.
         *
         * The overlay div stays at left=geoX, top=geoY.
         * The base CSS transform `translate(-50%, -100%)` puts chip
         * bottom-center at the geo point.  We override it to shift the
         * chip dx pixels horizontally and dy pixels upward while KEEPING
         * the div anchored at the geo point — this lets the inline SVG
         * draw an angled line back from chip-bottom to (0, 0) = geo point.
         *
         * @param {number} dx  horizontal shift (positive = right)
         * @param {number} dy  extra upward lift (positive = up)
         */
        applyStackOffset(dx, dy) {
            this._stackDx = dx;
            this._stackDy = dy;
            if (this.div && !this.expanded) {
                // Update transform in-place (chip position)
                this.div.style.transform =
                    `translate(calc(-50% + ${dx}px), calc(-100% - ${dy}px))`;
                // Update the SVG connector endpoints in-place
                const svg = this.div.querySelector('.jo-connector');
                if (svg) {
                    const line = svg.querySelector('line');
                    const circle = svg.querySelector('circle');
                    // (0,0) = chip bottom-center; geo anchor = (-dx, dy)
                    if (line) {
                        line.setAttribute('x2', -dx);
                        line.setAttribute('y2', dy);
                    }
                    if (circle) {
                        circle.setAttribute('cx', -dx);
                        circle.setAttribute('cy', dy);
                    }
                }
            }
            this.draw();
        }

        setLocked(locked) {
            this.isLocked = locked;
            if (this.div) {
                this.div.classList.toggle('job-overlay--locked', locked);
                // Rebuild to update lock icon
                if (this.expanded) {
                    this.div.innerHTML = this._buildExpanded();
                    this._wireActions();
                } else {
                    this.div.innerHTML = this._buildCollapsed();
                }
            }
        }

        setMap(map) { super.setMap(map); }
        getPosition() { return this.position; }
        setAnimation() { /* no-op */ }
        setZIndex(z) { if (this.div) this.div.style.zIndex = z; }

        /**
         * Re-insert this overlay div at the END of its parent's child list.
         * Safe to call ONLY after a click has been fully processed (e.g. from expand()).
         * NEVER call from mouseenter/pointerdown — that breaks the Maps click chain.
         */
        _raiseToTop() {
            if (this.div && this.div.parentNode) {
                this.div.parentNode.appendChild(this.div);
            }
        }

        /**
         * Bump this overlay's z-index above all current siblings.
         * Safe to call from ANY event (mouseenter, pointerdown, etc.) because
         * it only sets a CSS property — no DOM re-insertion, no event chain break.
         */
        _bumpZIndex() {
            if (!this.div || !this.div.parentNode) return;
            const siblings = Array.from(this.div.parentNode.children);
            const maxZ = siblings.reduce((max, el) => {
                return Math.max(max, parseInt(el.style.zIndex || '0', 10));
            }, 0);
            this.div.style.zIndex = String(maxZ + 1);
        }

        /**
         * Abbreviated K/M notation for the lower bound of a range.
         * e.g.  45000 → $45k  |  1200000 → $1.2M
         */
        _fmtAbbrev(n) {
            if (!n) return '';
            if (n >= 1_000_000) return '$' + (n / 1_000_000).toFixed(1).replace(/\.0$/, '') + 'M';
            if (n >= 1_000) return '$' + Math.round(n / 1000) + 'k';
            return '$' + Math.round(n);
        }

        /**
         * Full locale number with thousand separators — used for the upper
         * bound so it is never abbreviated.  Uses the browser's locale so
         * comma vs period separator is correct automatically.
         * e.g.  55000 → $55,000  (en-US)  |  $55.000 (de-DE)
         */
        _fmtFull(n) {
            return n ? '$' + Math.round(n).toLocaleString() : '';
        }

        /**
         * Hero pay string for the collapsed chip.
         * Range: abbreviated lower – full upper  →  $45k–$55,000
         * Single value: abbreviated              →  $55k
         * N/A: grey placeholder
         */
        _formatPayHero() {
            const j = this.job;
            if (!j.payMin && !j.payMax) {
                return '<span class="jo-pay-na">Salary N/A</span>';
            }

            // Annualize hourly rates (40 hours/week * 52 weeks = 2080 hours)
            let min = j.payMin;
            let max = j.payMax;
            if (j.payHourly || (max && max < 1000)) {
                if (min) min *= 2080;
                if (max) max *= 2080;
            }

            if (min && max && min !== max) {
                const lo = this._fmtAbbrev(min);
                const hi = this._fmtFull(max);
                return `<span class="jo-pay-hero">${lo}\u2013${hi}</span>`;
            }
            // Single value — use full format so it reads cleanly
            const val = max || min;
            return `<span class="jo-pay-hero">${this._fmtFull(val)}</span>`;
        }

        /**
         * Full salary line for expanded panel.
         * Shows raw hourly rate + annualized if job is hourly.
         */
        _formatPayFull() {
            const j = this.job;
            if (!j.payMin && !j.payMax) return 'Pay not listed';
            const min = this._fmtFull(j.payMin);
            const max = this._fmtFull(j.payMax);
            const range = min && max && min !== max ? `${min} – ${max}` : (max || min);
            if (j.payHourly) {
                const label = j.payType === 'part-time' ? '/hr (part-time, ~20hr/wk)' : '/hr (full-time, ~40hr/wk)';
                return `${this._fmtFull(j.payHourly)}${label} = <strong>${range}/yr</strong>`;
            }
            return `${range}/yr`;
        }

        _formatRating() {
            if (!this.job.rating) return '';
            return `<span class="jo-rating">⭐ ${parseFloat(this.job.rating).toFixed(1)}</span>`;
        }

        _truncate(str, len) {
            if (!str) return '';
            return str.length > len ? str.substring(0, len) + '…' : str;
        }

        // Clip to 'len' chars at nearest word boundary, then special chars, append …
        _truncateWords(str, len) {
            if (!str || str.length <= len) return str || '';
            // First, find if a special character comes before the limit — clip there cleanly
            const specialMatch = str.match(/^(.{10,}?)[,|\-\/|\\|:|\(|\[]/)
            if (specialMatch && specialMatch[1].length <= len) {
                return specialMatch[1].trimEnd() + '…';
            }
            // Otherwise clip at word boundary
            const cut = str.slice(0, len);
            const lastSpace = cut.lastIndexOf(' ');
            return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut) + '…';
        }

        /**
         * Wrap a job title at whole-word boundaries every 40 characters.
         * Returns the FULL title (no ellipsis) — just inserts line breaks.
         * Each line is at most 40 chars; breaks happen at spaces.
         */
        _wrapAt40(str) {
            if (!str) return '';
            const LIMIT = 40;
            const words = str.split(' ');
            const lines = [];
            let current = '';
            for (const word of words) {
                if (current.length === 0) {
                    current = word;
                } else if (current.length + 1 + word.length <= LIMIT) {
                    current += ' ' + word;
                } else {
                    lines.push(current);
                    current = word;
                }
            }
            if (current) lines.push(current);
            return lines.join('<br>');
        }

        _ageText() {
            const d = this.job.postedDate || this.job.createdAt;
            if (!d) return '';
            const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
            if (days === 0) return 'Today';
            if (days === 1) return '1d ago';
            return `${days}d ago`;
        }

        // ── Collapsed pin ───────────────────────────────────────────

        _buildCollapsed() {
            const pay = this._formatPayHero();
            const lockIcon = this.isLocked ? ' 📌' : '';
            const dx = this._stackDx || 0;
            const dy = this._stackDy || 0;
            const chipH = 70; // approximate chip height for initial SVG — updated live by applyStackOffset
            // Connector SVG: line from chip bottom-center to geo anchor (0,0 in div space)
            // The div is positioned at geoX, geoY with transform(-50%, -100%) + offset.
            // In div-local space, chip bottom-center = (0, 0) (before transform), geo = (-dx, dy+chipH).
            // We draw with overflow:visible so the SVG size doesn't matter.
            const isLocked = this.isLocked;
            const strokeColor = isLocked ? '#f5a623' : 'rgba(77,168,218,0.75)';
            const dotColor   = isLocked ? '#f5a623' : 'rgba(77,168,218,0.9)';
            // SVG is positioned at left:50%; top:100% inside the chip.
            // (0,0) in SVG space = chip bottom-center.
            // Geo anchor point relative to SVG origin = (-dx, dy).
            const svgConnector = `
                <svg class="jo-connector" xmlns="http://www.w3.org/2000/svg"
                     width="1" height="1" style="overflow:visible; position:absolute;
                     left:50%; top:100%; pointer-events:none; z-index:-1">
                    <line x1="0" y1="0"
                          x2="${-dx}" y2="${dy}"
                          stroke="${strokeColor}" stroke-width="6"
                          stroke-linecap="round"/>
                    <circle cx="${-dx}" cy="${dy}" r="4"
                            fill="${dotColor}" opacity="0.9"/>
                </svg>`;

            // Quick pin button (Colored Dark Slate if unpinned, Green if pinned)
            const pinBg = this.isLocked ? '#2ecc71' : '#1e293b';
            const pinTitle = this.isLocked ? 'Unpin Job' : 'Pin Job';
            const quickPinBtn = `
                <div class="jo-quick-pin" data-action="quick-lock" title="${pinTitle}" 
                    style="position:absolute; top:-12px; right:-12px; background:${pinBg}; border:2px solid #1e293b; border-radius:50%; width:30px; height:30px; min-width:30px; min-height:30px; box-sizing:border-box; padding:0; display:flex; align-items:center; justify-content:center; cursor:pointer; z-index:10; box-shadow:0 3px 6px rgba(0,0,0,0.5); transition: transform 0.1s, background 0.2s;">
                    <span class="icon" style="font-size: 14px; line-height: 1;">📌</span>
                </div>`;

            // Mobile minimal pin
            if (window.innerWidth < 768) {
                const title = this._wrapAt40(this.job.title);
                return `
                    <div class="jo-collapsed mobile-minimal" style="position:relative">
                        ${quickPinBtn}
                        <div class="jo-row-pay">${pay}${lockIcon}</div>
                        <div class="jo-row-title">${title}</div>
                        ${svgConnector}
                    </div>
                `;
            }

            const title = this._wrapAt40(this.job.title);

            return `
                <div class="jo-collapsed" style="position:relative">
                    ${quickPinBtn}
                    <div class="jo-row-pay">${pay}</div>
                    <div class="jo-row-title">${title}</div>
                    ${svgConnector}
                </div>
            `;
        }

        // ── Expanded panel ──────────────────────────────────────────

        _buildExpanded() {
            const company = this.job.company || 'Unknown';
            const title = this.job.title || 'Untitled';
            const location = this.job.location || 'Remote';
            const rating = this._formatRating();
            const age = this._ageText();
            const payFull = this._formatPayFull();
            const lockLabel = this.isLocked ? '📌 Locked' : '📌 Lock';
            const lockClass = this.isLocked ? 'jo-btn--locked' : '';

            // Always route to Google Jobs search instead of Indeed directly
            const applyUrl = `https://www.google.com/search?q=${encodeURIComponent(title + ' ' + company + ' ' + location + ' job')}&ibp=htl;jobs`;

            // Truncate description to 300 words, append ...More link
            const rawDesc = this.job.description || '';
            let descHtml = '';
            if (rawDesc) {
                // Strip tags to count words, then truncate the original HTML
                const plainText = rawDesc.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
                const words = plainText.split(' ');
                const LIMIT = 100;
                if (words.length > LIMIT) {
                    // Find a safe cut point in the original HTML by iterating words
                    let count = 0, pos = 0, inTag = false;
                    for (let i = 0; i < rawDesc.length && count < LIMIT; i++) {
                        if (rawDesc[i] === '<') { inTag = true; }
                        if (!inTag && rawDesc[i] !== ' ') { /* inside word */ }
                        if (!inTag && rawDesc[i] === ' ') { count++; pos = i; }
                        if (rawDesc[i] === '>') { inTag = false; }
                    }
                    const truncated = rawDesc.slice(0, pos).trim();
                    descHtml = `<div class="jo-desc">${truncated}… <a href="${applyUrl}" target="_blank" rel="noopener noreferrer" class="jo-more-link">More →</a></div>`;
                } else {
                    descHtml = `<div class="jo-desc">${rawDesc}</div>`;
                }
            }

            return `
                <div class="jo-expanded">
                    <button class="jo-close" title="Close">×</button>
                    <div class="jo-header">
                        <div class="jo-exp-pay">${this._formatPayHero()}</div>
                        <div class="jo-exp-company">${company} ${rating}</div>
                        <div class="jo-exp-title">${title}</div>
                        <div class="jo-exp-meta">
                            📍 ${location}
                            ${age ? `· <span class="jo-age">${age}</span>` : ''}
                        </div>
                    </div>
                    <div class="jo-salary-full">💰 ${payFull}</div>
                    ${descHtml}
                    <a href="${applyUrl}" target="_blank" rel="noopener noreferrer" class="jo-apply">View Job ↗</a>
                    <div class="jo-actions">
                        <button class="jo-btn jo-btn--route" data-action="route">🚗 Route</button>
                        <button class="jo-btn jo-btn--note"  data-action="note">📝 Note</button>
                        <button class="jo-btn jo-btn--lock  ${lockClass}" data-action="lock">${lockLabel}</button>
                        <button class="jo-btn jo-btn--hide"  data-action="hide">⊘ Hide</button>
                    </div>
                    <div class="jo-note-form" style="display:none;">
                        <textarea class="jo-note-input" placeholder="Follow-up context, contact names..." rows="3"></textarea>
                        <button class="jo-btn-save-note">Save Note</button>
                    </div>
                </div>
                <div class="jo-arrow"></div>
            `;
        }

        // ── Wire buttons ────────────────────────────────────────────

        _wireActions() {
            if (!this.div) return;

            // Use Event Delegation on the parent container to survive innerHTML rewrites natively.
            this.div.addEventListener('click', (e) => {
                const closeBtn = e.target.closest('.jo-close');
                if (closeBtn) {
                    e.stopPropagation();
                    return this.collapse();
                }

                const routeBtn = e.target.closest('[data-action="route"]');
                if (routeBtn) {
                    e.stopPropagation();
                    if (this.callbacks.onRoute) this.callbacks.onRoute(this.job);
                    return;
                }

                const lockBtn = e.target.closest('[data-action="lock"]');
                if (lockBtn) {
                    e.stopPropagation();
                    const nowLocked = !this.isLocked;
                    this.setLocked(nowLocked);
                    if (this.callbacks.onLock) this.callbacks.onLock(this.job, nowLocked);
                    return;
                }

                const quickLockBtn = e.target.closest('[data-action="quick-lock"]');
                if (quickLockBtn) {
                    e.stopPropagation();
                    const nowLocked = !this.isLocked;
                    this.setLocked(nowLocked);
                    if (this.callbacks.onLock) this.callbacks.onLock(this.job, nowLocked);
                    
                    quickLockBtn.style.background = nowLocked ? '#2ecc71' : '#1e293b';
                    quickLockBtn.title = nowLocked ? 'Unpin Job' : 'Pin Job';
                    return;
                }

                const noteBtn = e.target.closest('[data-action="note"]');
                if (noteBtn) {
                    e.stopPropagation();
                    const noteForm = this.div.querySelector('.jo-note-form');
                    if (noteForm) {
                        this._noteVisible = !this._noteVisible;
                        noteForm.style.display = this._noteVisible ? 'block' : 'none';
                        if (this._noteVisible) noteForm.querySelector('textarea')?.focus();
                    }
                    return;
                }

                const saveNoteBtn = e.target.closest('.jo-btn-save-note');
                if (saveNoteBtn) {
                    e.stopPropagation();
                    const textarea = this.div.querySelector('.jo-note-input');
                    const noteText = textarea?.value?.trim();
                    if (noteText && this.callbacks.onSaveNote) {
                        this.callbacks.onSaveNote(this.job, noteText);
                        textarea.value = '';
                        const noteForm = this.div.querySelector('.jo-note-form');
                        if (noteForm) noteForm.style.display = 'none';
                        this._noteVisible = false;
                    }
                    return;
                }

                const hideBtn = e.target.closest('[data-action="hide"]');
                if (hideBtn) {
                    e.stopPropagation();
                    if (this.callbacks.onHide) this.callbacks.onHide(this.job);
                    return;
                }
            });
        }
    }

    return JobInfoOverlay;
}
