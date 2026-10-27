import { LitElement, html, css } from 'lit-element';
import { previewKcInvite, redeemKcInvite } from './services/cases.js';
import { authFormSharedStyles } from './styles/auth-form-shared.js';
import { t } from './i18n/index.js';

/**
 * Redeem a Keycloak case signup invite (?kc-invite=token).
 * Collects first/last name + password, enables the Keycloak account.
 * Emits `kc-invite-accepted` with { status, email, caseId } on success.
 */
export class KcInviteAcceptForm extends LitElement {
    static get properties() {
        return {
            token:           { type: String },
            preview:         { type: Object },
            loading:         { type: Boolean },
            submitting:      { type: Boolean },
            error:           { type: String },
            firstName:       { type: String },
            lastName:        { type: String },
            password:        { type: String },
            confirmPassword: { type: String },
            done:            { type: Boolean },
        };
    }

    static get styles() {
        return [
            authFormSharedStyles,
            css`
              h2 { margin: 0 0 8px 0; }
              .sub {
                margin: 0 0 20px 0;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 14px;
                line-height: 1.4;
              }
              .form-group { margin-bottom: 16px; }
            `,
        ];
    }

    constructor() {
        super();
        this.token           = '';
        this.preview         = null;
        this.loading         = true;
        this.submitting      = false;
        this.error           = '';
        this.firstName       = '';
        this.lastName        = '';
        this.password        = '';
        this.confirmPassword = '';
        this.done            = false;
        this._acceptedDetail = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this.loadPreview();
    }

    async loadPreview() {
        this.loading = true;
        this.error   = '';
        try {
            this.preview = await previewKcInvite(this.token);
        } catch (err) {
            this.preview = null;
            this.error   = err?.message || t('auth.invite.invalidOrExpired');
        } finally {
            this.loading = false;
        }
    }

    async handleSubmit(e) {
        e.preventDefault();
        if (this.submitting || !this.preview) return;

        if (!this.password || this.password.length < 8) {
            this.error = t('auth.invite.passwordMin');
            return;
        }
        if (this.password !== this.confirmPassword) {
            this.error = t('auth.invite.passwordMismatch');
            return;
        }

        this.submitting = true;
        this.error = '';
        try {
            const result = await redeemKcInvite(this.token, {
                firstName: this.firstName || undefined,
                lastName:  this.lastName  || undefined,
                password:  this.password,
            });
            this._acceptedDetail = { status: result.status, email: result.email, caseId: result.caseId };
            this.done = true;
        } catch (err) {
            this.error = err?.message || t('auth.invite.createFailed');
        } finally {
            this.submitting = false;
        }
    }

    _handleSignIn() {
        this.dispatchEvent(new CustomEvent('kc-invite-accepted', {
            detail: this._acceptedDetail || {},
            bubbles: true,
            composed: true,
        }));
    }

    render() {
        if (this.loading) {
            return html`<div class="auth-card"><p class="sub">${t('auth.invite.loading')}</p></div>`;
        }
        if (!this.preview) {
            return html`
                <div class="auth-card">
                    <h2>${t('auth.invite.unavailable')}</h2>
                    <div class="auth-alert auth-alert--error" role="alert">
                        ${this.error || t('auth.invite.invalidOrExpired')}
                    </div>
                    <button @click=${() => this._handleSignIn()}>
                        Continue to sign in
                    </button>
                </div>
            `;
        }
        if (this.done) {
            const email = this._acceptedDetail?.email || this.preview?.email || '';
            const caseTitle = this.preview?.caseTitle || t('auth.invite.caseFallback');
            return html`
                <div class="auth-card">
                    <h2>${t('auth.invite.joinTitle', { caseTitle })}</h2>
                    <p class="sub">
                        Your account is ready for <strong>${email}</strong>.
                        Sign in to access the case.
                    </p>
                    <button @click=${() => this._handleSignIn()}>
                        Sign in now
                    </button>
                </div>
            `;
        }

        const caseTitle = this.preview.caseTitle || t('auth.invite.caseFallback');
        const role = String(this.preview.role || 'collaborator').replace(/_/g, ' ');
        return html`
            <div class="auth-card">
                <h2>${t('auth.invite.joinTitle', { caseTitle })}</h2>
                ${this.error ? html`
                    <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
                ` : ''}
                <p class="sub">${t('auth.invite.subcopy', { role })}</p>
                <form @submit=${(e) => this.handleSubmit(e)}>
                    <div class="form-group">
                        <label>${t('auth.invite.email')}</label>
                        <input type="email" .value=${this.preview.email || ''} disabled />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.firstName')}</label>
                        <input type="text" .value=${this.firstName}
                            @input=${(e) => { this.firstName = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.lastName')}</label>
                        <input type="text" .value=${this.lastName}
                            @input=${(e) => { this.lastName = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.password')}</label>
                        <input type="password" .value=${this.password} required
                            autocomplete="new-password"
                            @input=${(e) => { this.password = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.confirmPassword')}</label>
                        <input type="password" .value=${this.confirmPassword} required
                            autocomplete="new-password"
                            @input=${(e) => { this.confirmPassword = e.target.value; }} />
                    </div>
                    <button type="submit" ?disabled=${this.submitting}>
                        ${this.submitting ? t('auth.invite.submitting') : t('auth.invite.submit')}
                    </button>
                </form>
            </div>
        `;
    }
}

customElements.define('kc-invite-accept-form', KcInviteAcceptForm);
