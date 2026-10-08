import { LitElement, html, css } from 'lit-element';

/**
 * Site-wide announcement banner for maintenance notices.
 *
 * Properties:
 *   message   String   The announcement text.
 *   severity  String   'info' | 'warning' | 'error'  (default: 'info')
 *
 * Dismissal is stored in sessionStorage keyed by a hash of the message,
 * so a new message will always reappear even if the previous one was dismissed.
 */
export class AnnouncementBanner extends LitElement {
    static get properties() {
        return {
            message:   { type: String },
            severity:  { type: String },
            _dismissed: { type: Boolean, state: true }
        };
    }

    static get styles() {
        return css`
            :host {
                display: block;
                width: 100%;
            }
            :host([hidden]) { display: none; }

            .banner {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                padding: 10px 14px;
                border-radius: var(--radius-md, 8px);
                border: 1px solid transparent;
                font-size: 0.875rem;
                line-height: 1.5;
            }

            /* Severity variants */
            .banner.info {
                background: var(--color-info-bg, #eff6ff);
                border-color: var(--color-info-border, #bfdbfe);
                color: var(--color-info-fg, #1e40af);
            }
            .banner.warning {
                background: var(--color-warning-bg, #fffbeb);
                border-color: var(--color-warning-border, #fde68a);
                color: var(--color-warning-fg, #92400e);
            }
            .banner.error {
                background: var(--color-error-bg, #fef2f2);
                border-color: var(--color-error-border, #fecaca);
                color: var(--color-error-fg, #991b1b);
            }

            .icon {
                flex-shrink: 0;
                font-size: 1rem;
                line-height: 1.5;
                user-select: none;
            }

            .text {
                flex: 1;
                min-width: 0;
            }

            .dismiss {
                flex-shrink: 0;
                background: none;
                border: none;
                cursor: pointer;
                padding: 2px 4px;
                border-radius: var(--radius-sm, 4px);
                font-size: 1rem;
                line-height: 1;
                color: inherit;
                opacity: 0.6;
            }
            .dismiss:hover { opacity: 1; }
            .dismiss:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                opacity: 1;
            }

            /* Dark mode */
            :host-context([data-theme='dark']) .banner.info {
                background: color-mix(in srgb, #3b82f6 12%, var(--color-surface, #1e1e2e));
                border-color: color-mix(in srgb, #3b82f6 30%, transparent);
                color: #93c5fd;
            }
            :host-context([data-theme='dark']) .banner.warning {
                background: color-mix(in srgb, #f59e0b 12%, var(--color-surface, #1e1e2e));
                border-color: color-mix(in srgb, #f59e0b 30%, transparent);
                color: #fcd34d;
            }
            :host-context([data-theme='dark']) .banner.error {
                background: color-mix(in srgb, #ef4444 12%, var(--color-surface, #1e1e2e));
                border-color: color-mix(in srgb, #ef4444 25%, transparent);
                color: var(--color-status-error-light, #f87171);
            }
        `;
    }

    constructor() {
        super();
        this.message = '';
        this.severity = 'info';
        this._dismissed = false;
    }

    _storageKey() {
        // Simple hash so dismissal is per unique message, not global.
        let h = 0;
        for (let i = 0; i < this.message.length; i++) {
            h = (Math.imul(31, h) + this.message.charCodeAt(i)) | 0;
        }
        return `announcement-dismissed-${h}`;
    }

    updated(changed) {
        if (changed.has('message') && this.message) {
            try {
                this._dismissed = sessionStorage.getItem(this._storageKey()) === '1';
            } catch {
                this._dismissed = false;
            }
        }
    }

    _dismiss() {
        try {
            sessionStorage.setItem(this._storageKey(), '1');
        } catch { /* private browsing — dismiss in-memory only */ }
        this._dismissed = true;
    }

    _icon() {
        if (this.severity === 'warning') return '⚠';
        if (this.severity === 'error')   return '⛔';
        return 'ℹ';
    }

    render() {
        if (!this.message || this._dismissed) return html``;
        const sev = ['info', 'warning', 'error'].includes(this.severity) ? this.severity : 'info';
        return html`
            <div class="banner ${sev}" role="alert" aria-live="polite">
                <span class="icon" aria-hidden="true">${this._icon()}</span>
                <span class="text">${this.message}</span>
                <button class="dismiss" aria-label="Dismiss announcement" @click=${this._dismiss}>✕</button>
            </div>
        `;
    }
}

customElements.define('announcement-banner', AnnouncementBanner);
