import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { resolvePreferredThemeForNewAccount } from './utils/userPreferences.js';
import { authFormStyleText } from './styles/auth-form-shared.js';
import { t } from './i18n/index.js';

const registerExtras = css`
  .password-hint {
    font-size: 12px;
    color: var(--color-text-secondary);
    margin-top: 3px;
  }
`;

export class RegisterForm extends LitElement {
    static get styles() {
        return [registerExtras];
    }

    static get properties() {
        return {
            username: { type: String },
            email: { type: String },
            password: { type: String },
            confirmPassword: { type: String },
            loading: { type: Boolean },
            error: { type: String },
            success: { type: String }
        };
    }

    createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.username = '';
        this.email = '';
        this.password = '';
        this.confirmPassword = '';
        this.loading = false;
        this.error = '';
        this.success = '';
    }

    async handleSubmit(e) {
        e.preventDefault();

        this.error = '';
        this.success = '';

        if (!this.username || !this.email || !this.password || !this.confirmPassword) {
            this.error = t('auth.register.fillAll');
            return;
        }

        if (this.password.length < 8) {
            this.error = t('auth.register.passwordMin');
            return;
        }

        if (this.password !== this.confirmPassword) {
            this.error = t('auth.register.passwordMismatch');
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.email)) {
            this.error = t('auth.register.invalidEmail');
            return;
        }

        this.loading = true;

        try {
            const response = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include',
                body: JSON.stringify({
                    username: this.username,
                    email: this.email,
                    password: this.password,
                    theme: resolvePreferredThemeForNewAccount()
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.success = t('auth.register.success');

                this.dispatchEvent(new CustomEvent('register-success', {
                    detail: { user: data.user },
                    bubbles: true,
                    composed: true
                }));

                this.username = '';
                this.email = '';
                this.password = '';
                this.confirmPassword = '';
            } else {
                this.error = data.error?.message || data.error || data.message || t('auth.register.failed');
            }
        } catch (err) {
            console.error('Registration error:', err);
            this.error = t('common.networkError');
        } finally {
            this.loading = false;
        }
    }

    handleLoginClick(e) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('show-login', {
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
      <style>${authFormStyleText(registerExtras)}</style>
      <div class="auth-card">
        <h2>${t('auth.register.title')}</h2>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        ${this.success ? html`
          <div class="auth-alert auth-alert--success" role="status">${this.success}</div>
        ` : ''}
        <form @submit=${this.handleSubmit} autocomplete="on">
          <div class="form-group">
            <label for="username">${t('auth.register.username')}</label>
            <input
              id="username"
              name="username"
              type="text"
              autocomplete="username"
              .value=${this.username}
              @input=${(e) => this.username = e.target.value}
              ?disabled=${this.loading}
              placeholder=${t('auth.register.usernamePlaceholder')}
            />
          </div>

          <div class="form-group">
            <label for="email">${t('auth.register.email')}</label>
            <input
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              .value=${this.email}
              @input=${(e) => this.email = e.target.value}
              ?disabled=${this.loading}
              placeholder=${t('auth.register.emailPlaceholder')}
            />
          </div>

          <div class="form-group">
            <label for="password">${t('auth.register.password')}</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="new-password"
              .value=${this.password}
              @input=${(e) => this.password = e.target.value}
              ?disabled=${this.loading}
              placeholder=${t('auth.register.passwordPlaceholder')}
            />
            <div class="password-hint">${t('auth.register.passwordHint')}</div>
          </div>

          <div class="form-group">
            <label for="confirmPassword">${t('auth.register.confirmPassword')}</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              .value=${this.confirmPassword}
              @input=${(e) => this.confirmPassword = e.target.value}
              ?disabled=${this.loading}
              placeholder=${t('auth.register.confirmPasswordPlaceholder')}
            />
          </div>

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading
                ? html`<span class="spinner"></span>${t('auth.register.submitting')}`
                : t('auth.register.submit')}
          </button>
        </form>

        <div class="switch-link">
          ${t('auth.register.haveAccount')} <a @click=${this.handleLoginClick}>${t('auth.register.loginHere')}</a>
        </div>
      </div>
    `;
    }
}

customElements.define('register-form', RegisterForm);
