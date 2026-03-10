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
                    e.target.closest('.jo-note-form') ||
                    e.target.tagName === 'A') return;
                this.toggle();
            });

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
            this.div.style.left = pos.x + 'px';
            this.div.style.top = pos.y + 'px';
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

            if (window.innerWidth < 768) {
                // Mobile layout - callback handles expanding the bottom sheet
                this.div.classList.add('job-overlay--active');
                if (this.callbacks.onExpand) this.callbacks.onExpand(this);
                return;
            }

            this.div.classList.add('job-overlay--expanded');
            this.div.innerHTML = this._buildExpanded();
            this._wireActions();
            this.draw();
            // Re-insert AFTER innerHTML is set and click has completed — safe here
            // because we are no longer inside a pointer-event sequence.
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
            if (j.payHourly) {
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

            // Mobile minimal pin (Salary Only)
            if (window.innerWidth < 768) {
                return `
                    <div class="jo-collapsed mobile-minimal">
                        <div class="jo-row-pay">${pay}${lockIcon}</div>
                    </div>
                    <div class="jo-arrow"></div>
                `;
            }

            const rating = this._formatRating();
            const company = this._truncate(this.job.company, 20);
            const title = this._truncate(this.job.title, 24);

            return `
                <div class="jo-collapsed">
                    <div class="jo-row-pay">${pay}</div>
                    <div class="jo-row-company">
                        <span class="jo-company-name">${company}${lockIcon}</span>
                        ${rating}
                    </div>
                    <div class="jo-row-title">${title}</div>
                </div>
                <div class="jo-arrow"></div>
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

            const applyUrl = (this.job.indeedUrl && !this.job.indeedUrl.includes('google.com'))
                ? this.job.indeedUrl
                : `https://www.indeed.com/jobs?q=${encodeURIComponent(title + ' ' + company)}&l=${encodeURIComponent(location)}`;

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
                    <a href="${applyUrl}" target="_blank" rel="noopener noreferrer" class="jo-apply">Apply on Indeed ↗</a>
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

            this.div.querySelector('.jo-close')?.addEventListener('click', (e) => {
                e.stopPropagation();
                this.collapse();
            });

            this.div.querySelector('[data-action="route"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.callbacks.onRoute) this.callbacks.onRoute(this.job);
            });

            this.div.querySelector('[data-action="lock"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const nowLocked = !this.isLocked;
                this.setLocked(nowLocked);
                if (this.callbacks.onLock) this.callbacks.onLock(this.job, nowLocked);
            });

            this.div.querySelector('[data-action="note"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                const noteForm = this.div.querySelector('.jo-note-form');
                if (noteForm) {
                    this._noteVisible = !this._noteVisible;
                    noteForm.style.display = this._noteVisible ? 'block' : 'none';
                    if (this._noteVisible) noteForm.querySelector('textarea')?.focus();
                }
            });

            this.div.querySelector('.jo-btn-save-note')?.addEventListener('click', (e) => {
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
            });

            this.div.querySelector('[data-action="hide"]')?.addEventListener('click', (e) => {
                e.stopPropagation();
                if (this.callbacks.onHide) this.callbacks.onHide(this.job);
            });
        }
    }

    return JobInfoOverlay;
}
