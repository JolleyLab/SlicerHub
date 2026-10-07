import { LitElement, html, css } from 'lit-element';
import { t } from './i18n/index.js';
import './components/page-layout-template.js';
import './components/registration-request-row.js';
import './components/approval-link-panel.js';
import { panelStyles } from './styles/panel.js';
import { listPendingRegistrations, approveRegistration, rejectRegistration } from './services/directus.js';

export class AdminRegistrationsPage extends LitElement {
    static get properties() {
        return {
            username:      { type: String },
            avatarUrl:     { type: String },
            isOrgAdmin:    { type: Boolean },
            canGoBack:     { type: Boolean },
            _pending:      { type: Array },
            _decided:      { type: Array },
            _loading:      { type: Boolean },
            _error:        { type: String },
            _approvedLink: { type: Object }
        };
    }

    static get styles() {
        return [panelStyles, css`
            .section {
                max-width: 720px;
                padding: 14px 16px;
            }
            .list { list-style: none; margin: 0; padding: 0; }
            .empty {
                padding: 32px 0;
                color: var(--color-text-secondary, #6b7280);
                font-size: 14px;
                text-align: center;
            }
            .error-msg {
                color: var(--color-status-error, #dc2626);
                font-size: 13px;
                margin-bottom: 12px;
            }
            .decided-section {
                margin-top: 24px;
                padding-top: 16px;
                border-top: 1px solid var(--color-border, #e5e7eb);
            }
            .section-label {
                font-size: 11px;
                font-weight: 600;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                color: var(--color-text-primary, #111827);
                margin: 0 0 8px 0;
            }
        `];
    }

    constructor() {
        super();
        this.username = '';
        this.avatarUrl = '';
        this.isOrgAdmin = false;
        this.canGoBack = false;
        this._pending = [];
        this._decided = [];
        this._loading = true;
        this._error = '';
        this._approvedLink = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._load();
    }

    async _load() {
        this._loading = true;
        this._error = '';
        try {
            const all = await listPendingRegistrations();
            this._pending = all.filter(r => !r.status || r.status === 'pending');
            this._decided = all.filter(r => r.status === 'approved' || r.status === 'rejected');
        } catch (err) {
            this._error = err?.message || 'Failed to load requests';
        } finally {
            this._loading = false;
        }
    }

    async _approve({ id, asAdmin }) {
        this._error = '';
        try {
            const req = this._pending.find(r => r.id === id);
            const result = await approveRegistration(id, { asAdmin });
            this._approvedLink = { email: req?.email || '', asAdmin, ...result };
            await this._load();
        } catch (err) {
            this._error = err?.message || 'Failed to approve';
        }
    }

    async _reject(id) {
        this._error = '';
        try {
            await rejectRegistration(id);
            await this._load();
        } catch (err) {
            this._error = err?.message || 'Failed to reject';
        }
    }

    handleMenuSelectionChange(e) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: e.detail,
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin}
                .isRegistrationReviewer=${true}
                .showBackButton=${this.canGoBack}
                selectedMenuKey="admin-registrations"
                homeHref="/file-manager"
                homeLabel=${t('common.home')}
                pageTitle=${t('nav.pendingRegistrations')}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content">
                    <div class="section panel">
                        ${this._approvedLink ? html`
                            <approval-link-panel
                                .email=${this._approvedLink.email}
                                .completionUrl=${this._approvedLink.completionUrl}
                                .expiresAt=${this._approvedLink.expiresAt}
                                .asAdmin=${this._approvedLink.asAdmin}
                                @done=${() => { this._approvedLink = null; }}
                            ></approval-link-panel>
                        ` : ''}

                        ${this._error ? html`<div class="error-msg">${this._error}</div>` : ''}

                        ${this._loading
                            ? html`<div class="empty">${t('common.loading')}</div>`
                            : this._pending.length === 0 && this._decided.length === 0 && !this._approvedLink
                                ? html`<div class="empty">No registration requests in the last 7 days.</div>`
                                : html`
                                    ${this._pending.length > 0 ? html`
                                        <ul class="list">
                                            ${this._pending.map(r => html`
                                                <li>
                                                    <registration-request-row
                                                        .request=${r}
                                                        ?showAdminOption=${this.isOrgAdmin}
                                                        @approve=${e => this._approve(e.detail)}
                                                        @reject=${e => this._reject(e.detail.id)}
                                                    ></registration-request-row>
                                                </li>
                                            `)}
                                        </ul>
                                    ` : !this._approvedLink ? html`
                                        <div class="empty">No pending registration requests.</div>
                                    ` : ''}
                                    ${this._decided.length > 0 ? html`
                                        <div class="decided-section">
                                            <p class="section-label">Recently decided</p>
                                            <ul class="list">
                                                ${this._decided.map(r => html`
                                                    <li>
                                                        <registration-request-row
                                                            .request=${r}
                                                        ></registration-request-row>
                                                    </li>
                                                `)}
                                            </ul>
                                        </div>
                                    ` : ''}
                                `
                        }
                    </div>
                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('admin-registrations-page', AdminRegistrationsPage);
