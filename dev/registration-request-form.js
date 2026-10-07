import { LitElement, html, css } from 'lit-element';
import { submitRegistrationRequest } from './services/directus.js';
import { authFormSharedStyles } from './styles/auth-form-shared.js';
import { t } from './i18n/index.js';

/**
 * Request access form. Submits a pending_registration record; no account is created yet.
 * Emits `show-login` when the user clicks "Back to login".
 */
export class RegistrationRequestForm extends LitElement {
    static get properties() {
        return {
            email:       { type: String },
            firstName:   { type: String },
            lastName:    { type: String },
            affiliation: { type: String },
            intendedUse: { type: String },
            submitting:       { type: Boolean },
            submitted:        { type: Boolean },
            duplicate:        { type: Boolean },
            existingAccount:  { type: Boolean },
            error:            { type: String }
        };
    }

    static get styles() {
        return [
            authFormSharedStyles,
            css`
              .form-group { margin-bottom: 16px; }
              .form-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
              }
              textarea {
                width: 100%;
                box-sizing: border-box;
                min-height: 72px;
                resize: vertical;
                font-family: inherit;
                font-size: 14px;
                padding: 8px 10px;
                border: 1px solid var(--color-border, #d1d5db);
                border-radius: 6px;
                background: var(--color-input-bg, #fff);
                color: var(--color-text, #111);
              }
              .label-row {
                display: flex;
                align-items: center;
                gap: 5px;
                margin-bottom: 4px;
              }
              .label-row label {
                margin-bottom: 0;
              }
              .tooltip-wrap {
                position: relative;
                display: inline-flex;
                align-items: center;
              }
              .tooltip-btn {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 16px;
                height: 16px;
                border-radius: 50%;
                border: 1px solid var(--color-border, #d1d5db);
                background: var(--color-surface, #f9fafb);
                color: var(--color-text-secondary, #6b7280);
                font-size: 10px;
                font-weight: 700;
                line-height: 1;
                cursor: default;
                padding: 0;
                flex-shrink: 0;
              }
              .tooltip-btn:focus-visible {
                outline: 2px solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
              }
              .tooltip-content {
                display: none;
                position: absolute;
                left: 50%;
                bottom: calc(100% + 6px);
                transform: translateX(-50%);
                width: 220px;
                background: var(--color-surface, #fff);
                border: 1px solid var(--color-border, #d1d5db);
                border-radius: 6px;
                box-shadow: 0 4px 12px rgba(0,0,0,0.12);
                padding: 8px 10px;
                font-size: 12px;
                line-height: 1.5;
                color: var(--color-text-secondary, #374151);
                z-index: 10;
                pointer-events: none;
              }
              .tooltip-wrap:hover .tooltip-content,
              .tooltip-btn:focus-visible ~ .tooltip-content {
                display: block;
              }
              .success-icon {
                font-size: 40px;
                text-align: center;
                margin-bottom: 12px;
              }
              .success-message {
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 14px;
                line-height: 1.5;
              }
            `
        ];
    }

    constructor() {
        super();
        this.email = '';
        this.firstName = '';
        this.lastName = '';
        this.affiliation = '';
        this.intendedUse = '';
        this.submitting = false;
        this.submitted = false;
        this.duplicate = false;
        this.existingAccount = false;
        this.error = '';
    }

    async handleSubmit(e) {
        e.preventDefault();
        if (this.submitting) return;
        this.error = '';
        this.submitting = true;
        try {
            await submitRegistrationRequest({
                email:       this.email.trim(),
                firstName:   this.firstName.trim(),
                lastName:    this.lastName.trim(),
                affiliation: this.affiliation.trim(),
                intendedUse: this.intendedUse.trim()
            });
            this.submitted = true;
        } catch (err) {
            if (err?.code === 'EMAIL_ALREADY_REGISTERED') {
                this.existingAccount = true;
            } else if (err?.status === 409) {
                this.duplicate = true;
            } else {
                this.error = err?.message || t('errors.registrationFailed');
            }
        } finally {
            this.submitting = false;
        }
    }

    render() {
        if (this.existingAccount) {
            return html`
                <div class="auth-card">
                    <div class="success-icon">🔑</div>
                    <h2>${t('registration.existingAccountTitle')}</h2>
                    <p class="success-message">${t('registration.existingAccountBody')}</p>
                    <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('show-login', { bubbles: true, composed: true }))}>
                        ${t('registration.backToLogin')}
                    </button>
                </div>
            `;
        }

        if (this.submitted || this.duplicate) {
            return html`
                <div class="auth-card">
                    <div class="success-icon">${this.duplicate ? '⏳' : '✓'}</div>
                    <h2>${this.duplicate ? t('registration.duplicateTitle') : t('registration.successTitle')}</h2>
                    <p class="success-message">${this.duplicate ? t('registration.duplicateBody') : t('registration.successBody')}</p>
                    <button type="button" @click=${() => this.dispatchEvent(new CustomEvent('show-login', { bubbles: true, composed: true }))}>
                        ${t('registration.backToLogin')}
                    </button>
                </div>
            `;
        }

        return html`
            <div class="auth-card">
                <h2>${t('registration.title')}</h2>
                ${this.error ? html`
                    <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
                ` : ''}
                <form @submit=${(e) => this.handleSubmit(e)}>
                    <div class="form-row">
                        <div class="form-group">
                            <label for="reg-first-name">${t('registration.firstName')}</label>
                            <input id="reg-first-name" type="text" required .value=${this.firstName}
                                @input=${(e) => { this.firstName = e.target.value; }} />
                        </div>
                        <div class="form-group">
                            <label for="reg-last-name">${t('registration.lastName')}</label>
                            <input id="reg-last-name" type="text" required .value=${this.lastName}
                                @input=${(e) => { this.lastName = e.target.value; }} />
                        </div>
                    </div>
                    <div class="form-group">
                        <label for="reg-email">${t('registration.email')}</label>
                        <input id="reg-email" type="email" required .value=${this.email}
                            @input=${(e) => { this.email = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <div class="label-row">
                            <label for="reg-affiliation">${t('registration.affiliation')}</label>
                            <span class="tooltip-wrap">
                                <button type="button" class="tooltip-btn" aria-label="About the affiliation field">?</button>
                                <span class="tooltip-content" role="tooltip">
                                    Your institution, university, hospital, or research group. This helps reviewers understand your context and is only used to assess your access request.
                                </span>
                            </span>
                        </div>
                        <input id="reg-affiliation" type="text" .value=${this.affiliation}
                            @input=${(e) => { this.affiliation = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <div class="label-row">
                            <label for="reg-intended-use">${t('registration.intendedUse')}</label>
                            <span class="tooltip-wrap">
                                <button type="button" class="tooltip-btn" aria-label="About the intended use field">?</button>
                                <span class="tooltip-content" role="tooltip">
                                    A brief description of how you plan to use SlicerHub. This is shared with the reviewer as context for your request and is not stored or used for any other purpose.
                                </span>
                            </span>
                        </div>
                        <textarea id="reg-intended-use" .value=${this.intendedUse}
                            @input=${(e) => { this.intendedUse = e.target.value; }}
                            placeholder="${t('registration.intendedUsePlaceholder')}"></textarea>
                    </div>
                    <button type="submit" ?disabled=${this.submitting}>
                        ${this.submitting ? t('registration.submitting') : t('registration.submit')}
                    </button>
                </form>
                <div class="switch-link">
                    <a href="#" @click=${(e) => { e.preventDefault(); this.dispatchEvent(new CustomEvent('show-login', { bubbles: true, composed: true })); }}>
                        ${t('registration.backToLogin')}
                    </a>
                </div>
            </div>
        `;
    }
}

customElements.define('registration-request-form', RegistrationRequestForm);
