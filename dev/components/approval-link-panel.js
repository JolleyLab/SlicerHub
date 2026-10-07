import { LitElement, html, css } from 'lit-element';

/**
 * Green success panel shown after a registration is approved.
 * Displays the completion link for the new user to set their password.
 *
 * Properties:
 *   email          String   Recipient email address
 *   completionUrl  String   Registration completion URL
 *   expiresAt      String   ISO date string for expiry
 *   asAdmin        Boolean  True when the account was approved with OrgAdmin role
 *
 * Events:
 *   done   Fired when the user dismisses the panel
 */
export class ApprovalLinkPanel extends LitElement {
    static get properties() {
        return {
            email:         { type: String },
            completionUrl: { type: String },
            expiresAt:     { type: String },
            asAdmin:       { type: Boolean },
            _copied:       { type: Boolean, state: true }
        };
    }

    static get styles() {
        return css`
            :host { display: block; }

            .panel {
                background: var(--color-surface-subtle, #f0fdf4);
                border: 1px solid #bbf7d0;
                border-radius: var(--radius-md, 8px);
                padding: 16px;
                margin-bottom: 16px;
            }
            .panel h3 {
                margin: 0 0 6px 0;
                font-size: 14px;
                color: #166534;
            }
            .panel p {
                margin: 0 0 12px 0;
                font-size: 13px;
                color: #166534;
            }
            .link-box {
                display: flex;
                gap: 8px;
                align-items: center;
            }
            .link-url {
                flex: 1;
                font-size: 12px;
                font-family: monospace;
                background: #fff;
                border: 1px solid #bbf7d0;
                border-radius: 4px;
                padding: 6px 8px;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: #111;
                user-select: all;
            }
            .btn-copy {
                background: #16a34a;
                color: #fff;
                border: none;
                border-radius: var(--radius-sm, 6px);
                padding: 6px 12px;
                font-size: 13px;
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
                white-space: nowrap;
                flex-shrink: 0;
            }
            .btn-copy:hover { opacity: 0.9; }
            .btn-copy:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
            .expiry {
                font-size: 11px;
                color: #166534;
                margin-top: 6px;
            }
            .btn-done {
                margin-top: 10px;
                background: none;
                border: 1px solid #bbf7d0;
                border-radius: var(--radius-sm, 6px);
                padding: 5px 12px;
                font-size: 13px;
                font-family: inherit;
                font-weight: 600;
                color: #16a34a;
                cursor: pointer;
            }
            .btn-done:hover { background: color-mix(in srgb, #bbf7d0 40%, transparent); }
            .btn-done:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
        `;
    }

    constructor() {
        super();
        this.asAdmin = false;
        this._copied = false;
    }

    _formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) { return iso; }
    }

    async _copyLink() {
        try {
            await navigator.clipboard.writeText(this.completionUrl || '');
            this._copied = true;
            setTimeout(() => { this._copied = false; }, 2000);
        } catch (_) {
            // fallback: select the text
            this.shadowRoot.querySelector('.link-url')?.select?.();
        }
    }

    _done() {
        this.dispatchEvent(new CustomEvent('done', { bubbles: true, composed: true }));
    }

    render() {
        const adminNote = this.asAdmin ? ' with OrgAdmin access' : '';
        return html`
            <div class="panel">
                <h3>Registration approved</h3>
                ${this.completionUrl ? html`
                    <p>Share this link with <strong>${this.email}</strong> so they can set their
                        password and activate their account${adminNote}.</p>
                    <div class="link-box">
                        <span class="link-url">${this.completionUrl}</span>
                        <button class="btn-copy" @click=${this._copyLink}>
                            ${this._copied ? 'Copied!' : 'Copy'}
                        </button>
                    </div>
                    <div class="expiry">Expires ${this._formatDate(this.expiresAt)}</div>
                ` : html`
                    <p>An email has been sent to <strong>${this.email}</strong> with instructions
                        to set their password and activate their account${adminNote}.</p>
                `}
                <button class="btn-done" @click=${this._done}>Done</button>
            </div>
        `;
    }
}

customElements.define('approval-link-panel', ApprovalLinkPanel);
