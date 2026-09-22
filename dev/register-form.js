import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { resolvePreferredThemeForNewAccount } from './utils/userPreferences.js';
import { authFormStyleText } from './styles/auth-form-shared.js';

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

        // Validation
        if (!this.username || !this.email || !this.password || !this.confirmPassword) {
            this.error = 'Please fill in all fields';
            return;
        }

        if (this.password.length < 8) {
            this.error = 'Password must be at least 8 characters long';
            return;
        }

        if (this.password !== this.confirmPassword) {
            this.error = 'Passwords do not match';
            return;
        }

        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(this.email)) {
            this.error = 'Please enter a valid email address';
            return;
        }

        this.loading = true;

        try {
            const response = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // Send/receive cookies
                body: JSON.stringify({
                    username: this.username,
                    email: this.email,
                    password: this.password,
                    theme: resolvePreferredThemeForNewAccount()
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.success = 'Registration successful! Logging you in...';

                // Cookie is automatically stored by browser
                // Dispatch custom event for parent component
                this.dispatchEvent(new CustomEvent('register-success', {
                    detail: { user: data.user },
                    bubbles: true,
                    composed: true
                }));

                // Clear form
                this.username = '';
                this.email = '';
                this.password = '';
                this.confirmPassword = '';
            } else {
                // Handle different error response formats
                this.error = data.error?.message || data.error || data.message || 'Registration failed';
            }
        } catch (err) {
            console.error('Registration error:', err);
            this.error = 'Network error. Please try again.';
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
        <h2>Create Account</h2>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        ${this.success ? html`
          <div class="auth-alert auth-alert--success" role="status">${this.success}</div>
        ` : ''}
        <form @submit=${this.handleSubmit} autocomplete="on">
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              name="username"
              type="text"
              autocomplete="username"
              .value=${this.username}
              @input=${(e) => this.username = e.target.value}
              ?disabled=${this.loading}
              placeholder="Choose a username"
            />
          </div>

          <div class="form-group">
            <label for="email">Email</label>
            <input
              id="email"
              name="email"
              type="email"
              autocomplete="email"
              .value=${this.email}
              @input=${(e) => this.email = e.target.value}
              ?disabled=${this.loading}
              placeholder="your@email.com"
            />
          </div>

          <div class="form-group">
            <label for="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autocomplete="new-password"
              .value=${this.password}
              @input=${(e) => this.password = e.target.value}
              ?disabled=${this.loading}
              placeholder="Create a password"
            />
            <div class="password-hint">Must be at least 8 characters</div>
          </div>

          <div class="form-group">
            <label for="confirmPassword">Confirm password</label>
            <input
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              autocomplete="new-password"
              .value=${this.confirmPassword}
              @input=${(e) => this.confirmPassword = e.target.value}
              ?disabled=${this.loading}
              placeholder="Confirm your password"
            />
          </div>

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? html`<span class="spinner"></span>Creating account...` : 'Register'}
          </button>
        </form>

        <div class="switch-link">
          Already have an account? <a @click=${this.handleLoginClick}>Log in here</a>
        </div>
      </div>
    `;
    }
}

customElements.define('register-form', RegisterForm);
