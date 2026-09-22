import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { loadAppFeatures, getAppFeatures } from './services/features.js';
import { authFormStyleText } from './styles/auth-form-shared.js';

const loginExtras = css`
  .dev-banner {
    background: color-mix(in srgb, var(--color-accent) 35%, var(--color-panel));
    color: var(--color-text-primary);
    border: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-accent));
    font-size: 12px;
    padding: 8px 10px;
    border-radius: var(--radius-sm);
    margin-bottom: 14px;
    text-align: center;
  }
`;

/**
 * Login form in light DOM so browser password managers can autofill.
 * Colors come from document theme tokens (OS light/dark on auth screens).
 */
export class LoginForm extends LitElement {
    static get styles() {
        return [loginExtras];
    }

    static get properties() {
        return {
            identity: { type: String },
            password: { type: String },
            otp: { type: String },
            otpRequired: { type: Boolean },
            devRelaxed: { type: Boolean },
            loading: { type: Boolean },
            error: { type: String },
            success: { type: String },
            identityLabel: { type: String },
            identityPlaceholder: { type: String },
            registrationEnabled: { type: Boolean }
        };
    }

    createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.identity = '';
        this.password = '';
        this.otp = '';
        this.otpRequired = false;
        this.devRelaxed = false;
        this.loading = false;
        this.error = '';
        this.success = '';
        this.identityLabel = 'Username or email';
        this.identityPlaceholder = 'Username or email';
        this.registrationEnabled = true;
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadAuthConfig();
    }

    async _loadAuthConfig() {
        try {
            let auth = null;
            const flags = await loadAppFeatures();
            auth = flags?.auth || getAppFeatures()?.auth;
            if (!auth) {
                try {
                    const res = await fetch(`${API_URL}/api/auth/config`, {
                        credentials: 'include',
                        cache: 'no-store'
                    });
                    if (res.ok) auth = await res.json();
                } catch {
                    /* keep defaults */
                }
            }
            if (auth) {
                if (auth.identityLabel) this.identityLabel = auth.identityLabel;
                if (auth.identityPlaceholder) this.identityPlaceholder = auth.identityPlaceholder;
                if (typeof auth.registrationEnabled === 'boolean') {
                    this.registrationEnabled = auth.registrationEnabled;
                }
                this.devRelaxed = auth.devRelaxed === true;
            }
        } catch {
            // keep defaults
        }
    }

    async handleSubmit(e) {
        e.preventDefault();

        this.error = '';
        this.success = '';

        if (!this.identity || !this.password) {
            this.error = 'Please enter your credentials';
            return;
        }

        if (this.otpRequired && !this.otp) {
            this.error = 'Enter the authentication code from your authenticator app';
            return;
        }

        this.loading = true;

        try {
            const body = {
                identity: this.identity,
                username: this.identity,
                password: this.password
            };
            if (this.otpRequired && this.otp) {
                body.otp = this.otp.trim();
            }

            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify(body)
            });

            const data = await response.json();
            const errCode = data.error?.code;
            const errMsg = data.error?.message || data.error || data.message || 'Login failed';

            if (response.ok) {
                this.success = 'Login successful!';
                this.otpRequired = false;
                this.otp = '';
                this.dispatchEvent(new CustomEvent('login-success', {
                    detail: { user: data.user },
                    bubbles: true,
                    composed: true
                }));
                this.identity = '';
                this.password = '';
            } else if (
                errCode === 'OTP_REQUIRED'
                || (response.status === 401 && /verification|otp|totp/i.test(String(errMsg)))
            ) {
                this.otpRequired = true;
                this.error = '';
                this.otp = '';
            } else if (response.status === 429 || errCode === 'ACCOUNT_COOLDOWN') {
                this.error = typeof errMsg === 'string'
                    ? errMsg
                    : 'Too many failed sign-in attempts. Please wait and try again.';
            } else {
                this.error = typeof errMsg === 'string' ? errMsg : 'Login failed';
            }
        } catch (err) {
            console.error('Login error:', err);
            this.error = 'Network error. Please try again.';
        } finally {
            this.loading = false;
        }
    }

    handleBackFromOtp(e) {
        e.preventDefault();
        this.otpRequired = false;
        this.otp = '';
        this.error = '';
    }

    handleRegisterClick(e) {
        e.preventDefault();
        this.dispatchEvent(new CustomEvent('show-register', {
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
      <style>${authFormStyleText(loginExtras)}</style>
      <div class="auth-card">
        <h2>${this.otpRequired ? 'Verification' : 'Login'}</h2>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        ${this.success ? html`
          <div class="auth-alert auth-alert--success" role="status">${this.success}</div>
        ` : ''}
        ${this.devRelaxed && !this.otpRequired ? html`
          <div class="dev-banner">Dev relaxed mode: longer session + softer rate limits</div>
        ` : ''}
        <form @submit=${this.handleSubmit} autocomplete="on">
          ${this.otpRequired ? html`
          <p class="hint">Enter the one-time code from your authenticator app.</p>
          <div class="form-group">
            <label for="otp">Authentication code</label>
            <input
              id="otp"
              name="otp"
              type="text"
              inputmode="numeric"
              autocomplete="one-time-code"
              .value=${this.otp}
              @input=${(e) => this.otp = e.target.value}
              ?disabled=${this.loading}
              placeholder="6-digit code"
            />
          </div>
          ` : html`
          <div class="form-group">
            <label for="identity">${this.identityLabel}</label>
            <input
              id="identity"
              name="username"
              type="text"
              autocomplete="username"
              .value=${this.identity}
              @input=${(e) => this.identity = e.target.value}
              ?disabled=${this.loading}
              placeholder=${this.identityPlaceholder}
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="current-password"
              .value=${this.password}
              @input=${(e) => this.password = e.target.value}
              ?disabled=${this.loading}
              placeholder="Enter your password"
            />
          </div>
          `}

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading
                ? html`<span class="spinner"></span>${this.otpRequired ? 'Verifying...' : 'Logging in...'}`
                : (this.otpRequired ? 'Verify' : 'Login')}
          </button>

          ${this.otpRequired ? html`
          <button type="button" class="secondary" @click=${this.handleBackFromOtp} ?disabled=${this.loading}>
            Back
          </button>
          ` : ''}
        </form>

        ${!this.otpRequired && this.registrationEnabled ? html`
        <div class="switch-link">
          Don't have an account? <a @click=${this.handleRegisterClick}>Register here</a>
        </div>
        ` : ''}
      </div>
    `;
    }
}

customElements.define('login-form', LoginForm);
