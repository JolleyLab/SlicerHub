import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { loadAppFeatures, getAppFeatures } from './services/features.js';
import { loginWithPasskey, supportsWebAuthn } from './services/webauthn.js';

export class LoginForm extends LitElement {
    static get styles() {
        return css`
      :host {
        display: block;
        max-width: 400px;
        margin: 0 auto;
        padding: 20px;
      }

      .login-container {
        background: #fff;
        border-radius: var(--radius-lg);
        box-shadow: 0 2px 10px rgba(0, 0, 0, 0.1);
        padding: 30px;
      }

      h2 {
        margin: 0 0 20px 0;
        text-align: center;
        color: #333;
      }

      .form-group {
        margin-bottom: 20px;
      }

      label {
        display: block;
        margin-bottom: 5px;
        color: #555;
        font-weight: 500;
      }

      input {
        width: 100%;
        padding: 10px;
        border: 1px solid #ddd;
        border-radius: var(--radius-sm);
        font-size: 14px;
        box-sizing: border-box;
      }

      input:focus {
        outline: none;
        border-color: #4CAF50;
      }

      .checkbox-row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 16px;
      }

      .checkbox-row input {
        width: auto;
      }

      .checkbox-row label {
        margin: 0;
        font-weight: 400;
      }

      button {
        width: 100%;
        padding: 12px;
        background: #4CAF50;
        color: white;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 16px;
        cursor: pointer;
        transition: background 0.3s;
      }

      button:hover {
        background: #45a049;
      }

      button:disabled {
        background: #ccc;
        cursor: not-allowed;
      }

      button.secondary {
        background: transparent;
        color: #555;
        border: 1px solid #ccc;
        margin-top: 10px;
      }

      button.secondary:hover {
        background: #f5f5f5;
      }

      .divider {
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 16px 0;
        color: #999;
        font-size: 12px;
      }

      .divider::before,
      .divider::after {
        content: '';
        flex: 1;
        height: 1px;
        background: #e0e0e0;
      }

      button.passkey {
        background: #1a1a1a;
        margin-bottom: 4px;
      }

      button.passkey:hover {
        background: #333;
      }

      .error {
        color: #f44336;
        font-size: 14px;
        margin-top: 10px;
        text-align: center;
      }

      .success {
        color: #4CAF50;
        font-size: 14px;
        margin-top: 10px;
        text-align: center;
      }

      .hint {
        color: #666;
        font-size: 13px;
        margin: 0 0 16px 0;
        text-align: center;
      }

      .dev-banner {
        background: #fff8e1;
        color: #6d4c00;
        font-size: 12px;
        padding: 8px 10px;
        border-radius: var(--radius-sm);
        margin-bottom: 14px;
        text-align: center;
      }

      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 3px solid rgba(255, 255, 255, 0.3);
        border-top-color: white;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        vertical-align: middle;
        margin-right: 8px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .switch-link {
        text-align: center;
        margin-top: 20px;
        color: #666;
      }

      .switch-link a {
        color: #4CAF50;
        text-decoration: none;
        cursor: pointer;
      }

      .switch-link a:hover {
        text-decoration: underline;
      }
    `;
    }

    static get properties() {
        return {
            identity: { type: String },
            password: { type: String },
            otp: { type: String },
            otpRequired: { type: Boolean },
            rememberDevice: { type: Boolean },
            rememberDeviceEnabled: { type: Boolean },
            webauthnEnabled: { type: Boolean },
            webauthnAvailable: { type: Boolean },
            devRelaxed: { type: Boolean },
            loading: { type: Boolean },
            error: { type: String },
            success: { type: String },
            identityLabel: { type: String },
            identityPlaceholder: { type: String },
            registrationEnabled: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.identity = '';
        this.password = '';
        this.otp = '';
        this.otpRequired = false;
        this.rememberDevice = true;
        this.rememberDeviceEnabled = false;
        this.webauthnEnabled = false;
        this.webauthnAvailable = false;
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
        this.webauthnAvailable = supportsWebAuthn();
        this._loadAuthConfig();
    }

    async _loadAuthConfig() {
        try {
            await loadAppFeatures();
            const auth = getAppFeatures()?.auth;
            if (auth) {
                if (auth.identityLabel) this.identityLabel = auth.identityLabel;
                if (auth.identityPlaceholder) this.identityPlaceholder = auth.identityPlaceholder;
                if (typeof auth.registrationEnabled === 'boolean') {
                    this.registrationEnabled = auth.registrationEnabled;
                }
                this.rememberDeviceEnabled = auth.rememberDeviceEnabled === true;
                this.devRelaxed = auth.devRelaxed === true;
                this.webauthnEnabled = auth.webauthn?.enabled === true
                    || (Array.isArray(auth.methods) && auth.methods.includes('webauthn'));
                if (this.rememberDeviceEnabled || this.devRelaxed) {
                    this.rememberDevice = true;
                }
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
                password: this.password,
                rememberDevice: this.rememberDeviceEnabled && this.rememberDevice
            };
            if (this.otpRequired && this.otp) {
                body.otp = this.otp.trim();
            }

            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
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

    async handlePasskeyLogin(e) {
        e.preventDefault();
        this.error = '';
        this.success = '';
        this.loading = true;
        try {
            const data = await loginWithPasskey({
                identity: this.identity?.trim() || undefined
            });
            this.success = 'Login successful!';
            this.dispatchEvent(new CustomEvent('login-success', {
                detail: { user: data.user },
                bubbles: true,
                composed: true
            }));
            this.identity = '';
            this.password = '';
        } catch (err) {
            console.error('Passkey login error:', err);
            if (err?.name === 'NotAllowedError') {
                this.error = 'Passkey sign-in was cancelled or timed out.';
            } else {
                this.error = err.message || 'Passkey sign-in failed';
            }
        } finally {
            this.loading = false;
        }
    }

    render() {
        const showPasskey = this.webauthnEnabled && this.webauthnAvailable && !this.otpRequired;
        return html`
      <div class="login-container">
        <h2>${this.otpRequired ? 'Verification' : 'Login'}</h2>
        ${this.devRelaxed && !this.otpRequired ? html`
          <div class="dev-banner">Dev relaxed mode: longer session + softer rate limits</div>
        ` : ''}
        <form @submit=${this.handleSubmit}>
          ${showPasskey ? html`
          <button
            type="button"
            class="passkey"
            ?disabled=${this.loading}
            @click=${this.handlePasskeyLogin}
          >
            ${this.loading
                ? html`<span class="spinner"></span>Waiting for passkey...`
                : 'Sign in with passkey'}
          </button>
          <div class="divider">or use password</div>
          ` : ''}

          ${this.otpRequired ? html`
          <p class="hint">Enter the one-time code from your authenticator app.</p>
          <div class="form-group">
            <label for="otp">Authentication code</label>
            <input
              id="otp"
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
              type="password"
              autocomplete="current-password"
              .value=${this.password}
              @input=${(e) => this.password = e.target.value}
              ?disabled=${this.loading}
              placeholder="Enter your password"
            />
          </div>

          ${this.rememberDeviceEnabled ? html`
          <div class="checkbox-row">
            <input
              id="remember-device"
              type="checkbox"
              .checked=${this.rememberDevice}
              @change=${(e) => this.rememberDevice = e.target.checked}
              ?disabled=${this.loading}
            />
            <label for="remember-device">Remember this device</label>
          </div>
          ` : ''}
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

          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          ${this.success ? html`<div class="success">${this.success}</div>` : ''}
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
