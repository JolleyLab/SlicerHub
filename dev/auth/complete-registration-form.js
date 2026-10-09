import { LitElement, html, css } from 'lit-element';
import { previewRegistrationToken, completeRegistration } from '../services/registrations.js';
import { authFormSharedStyles } from '../styles/auth-form-shared.js';
import { t } from '../i18n/index.js';
import { resolvePreferredThemeForNewAccount } from '../utils/userPreferences.js';

/**
 * Complete account setup from a ?register=<token> link.
 * The user sets their own password; no temp password is ever shared.
 * Emits `registration-complete` with { user } on success.
 */
export class CompleteRegistrationForm extends LitElement {
    static get properties() {
        return {
            token:           { type: String },
            preview:         { type: Object },
            loading:         { type: Boolean },
            submitting:      { type: Boolean },
            error:           { type: String },
            password:        { type: String },
            confirmPassword: { type: String }
        };
    }

    static get styles() {
        return [
            authFormSharedStyles,
            css`
              .form-group { margin-bottom: 16px; }
              .sub {
                margin: 0 0 20px 0;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 14px;
                line-height: 1.4;
              }
            `
        ];
    }

    constructor() {
        super();
        this.token = '';
        this.preview = null;
        this.loading = true;
        this.submitting = false;
        this.error = '';
        this.password = '';
        this.confirmPassword = '';
    }

    connectedCallback() {
        super.connectedCallback();
        this.loadPreview();
    }

    async loadPreview() {
        this.loading = true;
        this.error = '';
        try {
            this.preview = await previewRegistrationToken(this.token);
        } catch (err) {
            this.preview = null;
            this.error = err?.message || t('auth.invite.invalidOrExpired');
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
            const result = await completeRegistration({
                token:     this.token,
                password:  this.password,
                firstName: this.preview.firstName,
                lastName:  this.preview.lastName,
                theme:     resolvePreferredThemeForNewAccount()
            });
            this.dispatchEvent(new CustomEvent('registration-complete', {
                detail: result,
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.error = err?.message || t('errors.createAccountFailed');
        } finally {
            this.submitting = false;
        }
    }

    render() {
        if (this.loading) {
            return html`<div class="auth-card"><p class="sub">${t('auth.invite.loading')}</p></div>`;
        }
        if (!this.preview) {
            return html`
                <div class="auth-card">
                    <h2>${t('registration.completeTitle')}</h2>
                    <div class="auth-alert auth-alert--error" role="alert">
                        ${this.error || t('auth.invite.invalidOrExpired')}
                    </div>
                </div>
            `;
        }

        return html`
            <div class="auth-card">
                <h2>${t('registration.completeTitle')}</h2>
                <p class="sub">${t('registration.completeSubcopy', { name: this.preview.firstName })}</p>
                ${this.error ? html`
                    <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
                ` : ''}
                <form @submit=${(e) => this.handleSubmit(e)}>
                    <div class="form-group">
                        <label for="complete-email">${t('auth.invite.email')}</label>
                        <input id="complete-email" type="email" .value=${this.preview.email || ''} disabled />
                    </div>
                    <div class="form-group">
                        <label for="complete-password">${t('auth.invite.password')}</label>
                        <input id="complete-password" type="password" required minlength="8"
                            autocomplete="new-password"
                            .value=${this.password}
                            @input=${(e) => { this.password = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label for="complete-confirm-password">${t('auth.invite.confirmPassword')}</label>
                        <input id="complete-confirm-password" type="password" required minlength="8"
                            autocomplete="new-password"
                            .value=${this.confirmPassword}
                            @input=${(e) => { this.confirmPassword = e.target.value; }} />
                    </div>
                    <button type="submit" ?disabled=${this.submitting}>
                        ${this.submitting ? t('auth.invite.submitting') : t('registration.completeSubmit')}
                    </button>
                </form>
            </div>
        `;
    }
}

customElements.define('complete-registration-form', CompleteRegistrationForm);
