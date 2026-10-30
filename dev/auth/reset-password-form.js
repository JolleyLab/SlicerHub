import { LitElement, html } from 'lit-element';
import { authFormSharedStyles } from '../styles/auth-form-shared.js';
import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';

/**
 * Handles both account activation (kind='activation') and forgot-password (kind='reset').
 *
 * States:
 *   request  — email input, no token in URL yet
 *   sent     — confirmation screen after email is sent
 *   set      — password form, token present in URL
 *   done     — success, emits `password-reset-complete` with { user? }
 *
 * Props:
 *   token    — raw reset token from URL (?reset=…), triggers set state when present
 *   mode     — 'activate' | 'reset' (hint for copy on request screen; auto-detected from token preview)
 */
export class ResetPasswordForm extends LitElement {
    static get properties() {
        return {
            token:           { type: String },
            mode:            { type: String },
            prefillEmail:    { type: String },
            _state:          { type: String },
            _email:          { type: String },
            _kind:           { type: String },
            _firstName:      { type: String },
            _password:       { type: String },
            _confirm:        { type: String },
            _loading:        { type: Boolean },
            _error:          { type: String },
        };
    }

    static get styles() { return [authFormSharedStyles]; }

    constructor() {
        super();
        this.token        = '';
        this.mode         = 'reset';
        this.prefillEmail = '';
        this._state       = 'request';
        this._email   = '';
        this._kind    = 'reset';
        this._firstName = '';
        this._password  = '';
        this._confirm   = '';
        this._loading   = false;
        this._error     = '';
    }

    connectedCallback() {
        super.connectedCallback();
        if (this.prefillEmail) this._email = this.prefillEmail;
        if (this.token) {
            this._loadPreview();
        }
    }

    async _loadPreview() {
        this._loading = true;
        this._error   = '';
        try {
            const res = await fetch(
                `${API_URL}/api/auth/password-reset/preview?token=${encodeURIComponent(this.token)}`,
                { credentials: 'include' }
            );
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error?.message || t('auth.invite.invalidOrExpired'));
            this._email     = data.email     || '';
            this._kind      = data.kind      || 'reset';
            this._firstName = data.firstName || '';
            this._state = 'set';
        } catch (err) {
            this._error = err.message;
            this._state = 'set'; // show error in set-state card
        } finally {
            this._loading = false;
        }
    }

    async _handleRequest(e) {
        e.preventDefault();
        const email = String(this._email || '').trim();
        if (!email) { this._error = t('auth.email_required'); return; }
        this._loading = true;
        this._error   = '';
        try {
            const res = await fetch(`${API_URL}/api/auth/password-reset/request`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ email })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error?.message || t('common.networkError'));
            this._state = 'sent';
            // Dev: no SMTP — surface the link
            if (data.resetUrl) {
                console.info('[dev] Reset URL:', data.resetUrl);
            }
        } catch (err) {
            this._error = err.message;
        } finally {
            this._loading = false;
        }
    }

    async _handleSetPassword(e) {
        e.preventDefault();
        if (this._password.length < 8) { this._error = t('auth.invite.passwordMin'); return; }
        if (this._password !== this._confirm) { this._error = t('auth.invite.passwordMismatch'); return; }
        this._loading = true;
        this._error   = '';
        try {
            const res = await fetch(`${API_URL}/api/auth/password-reset/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ token: this.token, password: this._password })
            });
            const data = await res.json();
            if (!res.ok) throw new Error(data?.error?.message || t('common.networkError'));
            this._state = 'done';
            this.dispatchEvent(new CustomEvent('password-reset-complete', {
                detail: { user: data.user || null },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this._error = err.message;
        } finally {
            this._loading = false;
        }
    }

    _handleBackToLogin(e) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('show-login', { bubbles: true, composed: true }));
    }

    render() {
        const isActivate = this.mode === 'activate' || this._kind === 'activation';

        if (this._state === 'request') {
            return html`
                <div class="auth-card">
                    <h2>${isActivate ? t('passwordReset.requestTitleActivate') : t('passwordReset.requestTitle')}</h2>
                    <p class="sub">${isActivate ? t('passwordReset.requestSubcopyActivate') : t('passwordReset.requestSubcopy')}</p>
                    ${this._error ? html`<div class="auth-alert auth-alert--error" role="alert">${this._error}</div>` : ''}
                    <form @submit=${this._handleRequest}>
                        <div class="form-group">
                            <label for="pr-email">${t('passwordReset.emailLabel')}</label>
                            <input id="pr-email" type="email" autocomplete="email"
                                .value=${this._email}
                                @input=${(e) => { this._email = e.target.value; }}
                                placeholder=${t('passwordReset.emailPlaceholder')}
                                ?disabled=${this._loading} />
                        </div>
                        <button type="submit" ?disabled=${this._loading}>
                            ${this._loading ? t('passwordReset.sending') : t('passwordReset.sendLink')}
                        </button>
                    </form>
                    <div class="switch-link">
                        <a @click=${this._handleBackToLogin}>${t('passwordReset.backToLogin')}</a>
                    </div>
                </div>
            `;
        }

        if (this._state === 'sent') {
            return html`
                <div class="auth-card">
                    <h2>${t('passwordReset.sentTitle')}</h2>
                    <p class="sub">${t('passwordReset.sentBody', { email: this._email })}</p>
                    <div class="switch-link">
                        <a @click=${this._handleBackToLogin}>${t('passwordReset.backToLogin')}</a>
                    </div>
                </div>
            `;
        }

        if (this._state === 'set') {
            if (this._loading) {
                return html`<div class="auth-card"><p class="sub">${t('auth.invite.loading')}</p></div>`;
            }
            if (this._error && !this._email) {
                return html`
                    <div class="auth-card">
                        <h2>${isActivate ? t('passwordReset.activationTitle') : t('passwordReset.resetTitle')}</h2>
                        <div class="auth-alert auth-alert--error" role="alert">${this._error}</div>
                        <div class="switch-link">
                            <a @click=${this._handleBackToLogin}>${t('passwordReset.backToLogin')}</a>
                        </div>
                    </div>
                `;
            }
            const title   = this._kind === 'activation' ? t('passwordReset.activationTitle') : t('passwordReset.resetTitle');
            const subcopy = this._kind === 'activation'
                ? t('passwordReset.activationSubcopy', { name: this._firstName || this._email })
                : t('passwordReset.resetSubcopy', { email: this._email });
            return html`
                <div class="auth-card">
                    <h2>${title}</h2>
                    <p class="sub">${subcopy}</p>
                    ${this._error ? html`<div class="auth-alert auth-alert--error" role="alert">${this._error}</div>` : ''}
                    <form @submit=${this._handleSetPassword}>
                        <div class="form-group">
                            <label for="pr-password">${t('passwordReset.passwordLabel')}</label>
                            <input id="pr-password" type="password" required minlength="8"
                                autocomplete="new-password"
                                .value=${this._password}
                                @input=${(e) => { this._password = e.target.value; }}
                                ?disabled=${this._loading} />
                        </div>
                        <div class="form-group">
                            <label for="pr-confirm">${t('passwordReset.confirmLabel')}</label>
                            <input id="pr-confirm" type="password" required minlength="8"
                                autocomplete="new-password"
                                .value=${this._confirm}
                                @input=${(e) => { this._confirm = e.target.value; }}
                                ?disabled=${this._loading} />
                        </div>
                        <button type="submit" ?disabled=${this._loading}>
                            ${this._loading ? t('passwordReset.submitting') : t('passwordReset.submit')}
                        </button>
                    </form>
                </div>
            `;
        }

        // done — logged in via dispatchEvent; this card briefly shows before app-shell transitions
        return html`
            <div class="auth-card">
                <h2>${t('passwordReset.successTitle')}</h2>
                <p class="sub">${t('passwordReset.successBody')}</p>
            </div>
        `;
    }
}

customElements.define('reset-password-form', ResetPasswordForm);
