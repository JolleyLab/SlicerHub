import { LitElement, html, css } from 'lit-element';

/**
 * Green success panel shown after a registration is approved: the person already has
 * a Keycloak account and can sign in now (they're emailed too).
 *
 * Properties:
 *   email          String   Recipient email address
 *   asAdmin        Boolean  True when the account was approved with OrgAdmin role
 *
 * Events:
 *   done   Fired when the user dismisses the panel
 */
export class ApprovalLinkPanel extends LitElement {
    static get properties() {
        return {
            email:         { type: String },
            asAdmin:       { type: Boolean },
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
    }

    _done() {
        this.dispatchEvent(new CustomEvent('done', { bubbles: true, composed: true }));
    }

    render() {
        const adminNote = this.asAdmin ? ' with OrgAdmin access' : '';
        return html`
            <div class="panel">
                <h3>Registration approved</h3>
                <p><strong>${this.email}</strong> can sign in now${adminNote}. They've been sent an
                    email letting them know.</p>
                <button class="btn-done" @click=${this._done}>Done</button>
            </div>
        `;
    }
}

customElements.define('approval-link-panel', ApprovalLinkPanel);
