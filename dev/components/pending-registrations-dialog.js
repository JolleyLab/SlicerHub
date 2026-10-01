import { LitElement, html, css } from 'lit-element';
import { listPendingRegistrations, approveRegistration, rejectRegistration } from '../services/directus.js';
import './app-dialog.js';

/**
 * OrgAdmin dialog for reviewing and approving/rejecting pending registration requests.
 * After approval, shows the completion link for the admin to share manually.
 */
export class PendingRegistrationsDialog extends LitElement {
    static get properties() {
        return {
            _requests:    { type: Array },
            _loading:     { type: Boolean },
            _error:       { type: String },
            _approvedLink: { type: Object }  // { email, completionUrl, expiresAt }
        };
    }

    static get styles() {
        return css`
          :host { display: block; }

          .list { list-style: none; margin: 0; padding: 0; }

          .request-row {
            padding: 14px 0;
            border-bottom: 1px solid var(--color-border, #e5e7eb);
          }
          .request-row:last-child { border-bottom: none; }

          .request-name {
            font-weight: 600;
            font-size: 15px;
            margin: 0 0 2px 0;
            color: var(--color-text, #111);
          }
          .request-email {
            font-size: 13px;
            color: var(--color-text-secondary, #6b7280);
            margin: 0 0 4px 0;
          }
          .request-meta {
            font-size: 12px;
            color: var(--color-text-secondary, #6b7280);
            margin: 0 0 10px 0;
          }
          .request-intended-use {
            font-size: 13px;
            color: var(--color-text, #333);
            background: var(--color-surface-subtle, #f9fafb);
            border-radius: 6px;
            padding: 8px 10px;
            margin: 0 0 10px 0;
            white-space: pre-wrap;
          }
          .actions {
            display: flex;
            gap: 8px;
          }
          .btn-approve {
            background: var(--color-primary, #2563eb);
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 13px;
            cursor: pointer;
          }
          .btn-approve:hover { opacity: 0.9; }
          .btn-reject {
            background: none;
            border: 1px solid var(--color-border, #d1d5db);
            border-radius: 6px;
            padding: 6px 14px;
            font-size: 13px;
            cursor: pointer;
            color: var(--color-text-secondary, #6b7280);
          }
          .btn-reject:hover { border-color: #ef4444; color: #ef4444; }

          .empty {
            text-align: center;
            padding: 32px 0;
            color: var(--color-text-secondary, #6b7280);
            font-size: 14px;
          }
          .error-msg {
            color: #dc2626;
            font-size: 13px;
            margin-bottom: 12px;
          }

          /* Approval link panel */
          .link-panel {
            background: var(--color-surface-subtle, #f0fdf4);
            border: 1px solid #bbf7d0;
            border-radius: 8px;
            padding: 16px;
            margin-bottom: 16px;
          }
          .link-panel h3 {
            margin: 0 0 6px 0;
            font-size: 14px;
            color: #166534;
          }
          .link-panel p {
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
          }
          .btn-copy {
            background: #16a34a;
            color: #fff;
            border: none;
            border-radius: 6px;
            padding: 6px 12px;
            font-size: 13px;
            cursor: pointer;
            white-space: nowrap;
          }
          .btn-copy:hover { opacity: 0.9; }
          .expiry {
            font-size: 11px;
            color: #166534;
            margin-top: 6px;
          }
          .btn-done {
            margin-top: 10px;
            background: none;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            padding: 5px 12px;
            font-size: 13px;
            color: #16a34a;
            cursor: pointer;
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

    async _approve(id) {
        this._error = '';
        try {
            const result = await approveRegistration(id);
            const req = this._requests.find(r => r.id === id);
            this._approvedLink = { email: req?.email || '', ...result };
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

    async _copyLink() {
        if (!this._approvedLink?.completionUrl) return;
        try {
            await navigator.clipboard.writeText(this._approvedLink.completionUrl);
        } catch (_) {
            /* fallback: select the input */
            this.shadowRoot.querySelector('.link-url')?.select();
        }
    }

    _formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) {
            return iso;
        }
    }

    render() {
        return html`
            <app-dialog title="Pending Registrations" .lightDismiss=${true}>
                ${this._approvedLink ? html`
                    <div class="link-panel">
                        <h3>Registration approved</h3>
                        <p>Share this link with <strong>${this._approvedLink.email}</strong> so they can set their password and activate their account.</p>
                        <div class="link-box">
                            <span class="link-url">${this._approvedLink.completionUrl}</span>
                            <button class="btn-copy" @click=${() => this._copyLink()}>Copy</button>
                        </div>
                        <div class="expiry">Expires ${this._formatDate(this._approvedLink.expiresAt)}</div>
                        <button class="btn-done" @click=${() => { this._approvedLink = null; }}>Done</button>
                    </div>
                ` : ''}

                ${this._error ? html`<div class="error-msg">${this._error}</div>` : ''}

                ${this._loading
                    ? html`<div class="empty">Loading…</div>`
                    : this._requests.length === 0 && !this._approvedLink
                        ? html`<div class="empty">No pending registration requests</div>`
                        : html`
                            <ul class="list">
                                ${this._requests.map(r => html`
                                    <li class="request-row">
                                        <p class="request-name">${r.firstName} ${r.lastName}</p>
                                        <p class="request-email">${r.email}</p>
                                        <p class="request-meta">
                                            ${r.affiliation ? html`${r.affiliation} &middot; ` : ''}
                                            Requested ${this._formatDate(r.createdAt)}
                                        </p>
                                        ${r.intendedUse ? html`
                                            <div class="request-intended-use">${r.intendedUse}</div>
                                        ` : ''}
                                        <div class="actions">
                                            <button class="btn-approve" @click=${() => this._approve(r.id)}>Approve</button>
                                            <button class="btn-reject"  @click=${() => this._reject(r.id)}>Reject</button>
                                        </div>
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
