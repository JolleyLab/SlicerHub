import { LitElement, html, css } from 'lit-element';
import { listPendingRegistrations, approveRegistration, rejectRegistration } from '../services/directus.js';
import './app-dialog.js';
import './registration-request-row.js';
import './approval-link-panel.js';

/**
 * OrgAdmin dialog for reviewing and approving/rejecting pending registration requests.
 * After approval, shows the completion link for the admin to share manually.
 */
export class PendingRegistrationsDialog extends LitElement {
    static get properties() {
        return {
            _requests:     { type: Array },
            _loading:      { type: Boolean },
            _error:        { type: String },
            _approvedLink: { type: Object }
        };
    }

    static get styles() {
        return css`
            :host { display: block; }
            .list { list-style: none; margin: 0; padding: 0; }
            .empty {
                text-align: center;
                padding: 32px 0;
                color: var(--color-text-secondary, #6b7280);
                font-size: 14px;
            }
            .error-msg {
                color: var(--color-status-error, #dc2626);
                font-size: 13px;
                margin-bottom: 12px;
            }
        `;
    }

    constructor() {
        super();
        this._requests = [];
        this._loading = true;
        this._error = '';
        this._approvedLink = null;
    }

    open() {
        this._approvedLink = null;
        this._load();
        this.shadowRoot.querySelector('app-dialog')?.openDialog();
    }

    close() {
        this.shadowRoot.querySelector('app-dialog')?.closeDialog();
    }

    async _load() {
        this._loading = true;
        this._error = '';
        try {
            this._requests = await listPendingRegistrations();
        } catch (err) {
            this._error = err?.message || 'Failed to load requests';
        } finally {
            this._loading = false;
        }
    }

    async _approve({ id, asAdmin }) {
        this._error = '';
        try {
            const req = this._requests.find(r => r.id === id);
            const result = await approveRegistration(id, { asAdmin });
            this._approvedLink = { email: req?.email || '', asAdmin, ...result };
            this._requests = this._requests.filter(r => r.id !== id);
        } catch (err) {
            this._error = err?.message || 'Failed to approve';
        }
    }

    async _reject(id) {
        this._error = '';
        try {
            await rejectRegistration(id);
            this._requests = this._requests.filter(r => r.id !== id);
        } catch (err) {
            this._error = err?.message || 'Failed to reject';
        }
    }

    render() {
        return html`
            <app-dialog title="Pending Registrations" .lightDismiss=${true}>
                ${this._approvedLink ? html`
                    <approval-link-panel
                        .email=${this._approvedLink.email}
                        .completionUrl=${this._approvedLink.completionUrl}
                        .expiresAt=${this._approvedLink.expiresAt}
                        .asAdmin=${this._approvedLink.asAdmin || false}
                        @done=${() => { this._approvedLink = null; }}
                    ></approval-link-panel>
                ` : ''}

                ${this._error ? html`<div class="error-msg">${this._error}</div>` : ''}

                ${this._loading
                    ? html`<div class="empty">Loading…</div>`
                    : this._requests.length === 0 && !this._approvedLink
                        ? html`<div class="empty">No pending registration requests</div>`
                        : html`
                            <ul class="list">
                                ${this._requests.map(r => html`
                                    <li>
                                        <registration-request-row
                                            .request=${r}
                                            @approve=${e => this._approve(e.detail)}
                                            @reject=${e => this._reject(e.detail.id)}
                                        ></registration-request-row>
                                    </li>
                                `)}
                            </ul>
                        `
                }
            </app-dialog>
        `;
    }
}

customElements.define('pending-registrations-dialog', PendingRegistrationsDialog);
