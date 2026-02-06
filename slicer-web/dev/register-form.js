import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';

export class RegisterForm extends LitElement {
    static get styles() {
        return css`
      :host {
        display: block;
        max-width: 400px;
        margin: 0 auto;
        padding: 20px;
      }

      .register-container {
        background: #fff;
        border-radius: 8px;
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
        border-radius: 4px;
        font-size: 14px;
        box-sizing: border-box;
      }

      input:focus {
        outline: none;
        border-color: #2196F3;
      }

      button {
        width: 100%;
        padding: 12px;
        background: #2196F3;
        color: white;
        border: none;
        border-radius: 4px;
        font-size: 16px;
        cursor: pointer;
        transition: background 0.3s;
      }

      button:hover {
        background: #0b7dda;
      }

      button:disabled {
        background: #ccc;
        cursor: not-allowed;
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
        color: #2196F3;
        text-decoration: none;
        cursor: pointer;
      }

      .switch-link a:hover {
        text-decoration: underline;
      }

      .password-hint {
        font-size: 12px;
        color: #777;
        margin-top: 3px;
      }
    `;
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
                    password: this.password
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
      <div class="register-container">
        <h2>Create Account</h2>
        <form @submit=${this.handleSubmit}>
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
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
              type="email"
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
              type="password"
              .value=${this.password}
              @input=${(e) => this.password = e.target.value}
              ?disabled=${this.loading}
              placeholder="Create a password"
            />
            <div class="password-hint">Must be at least 8 characters</div>
          </div>

          <div class="form-group">
            <label for="confirmPassword">Confirm Password</label>
            <input
              id="confirmPassword"
              type="password"
              .value=${this.confirmPassword}
              @input=${(e) => this.confirmPassword = e.target.value}
              ?disabled=${this.loading}
              placeholder="Confirm your password"
            />
          </div>

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? html`<span class="spinner"></span>Creating account...` : 'Register'}
          </button>

          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          ${this.success ? html`<div class="success">${this.success}</div>` : ''}
        </form>

        <div class="switch-link">
          Already have an account? <a @click=${this.handleLoginClick}>Login here</a>
        </div>
      </div>
    `;
    }
}

customElements.define('register-form', RegisterForm);
