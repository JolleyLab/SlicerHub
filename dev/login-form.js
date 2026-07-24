import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';

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
            username: { type: String },
            password: { type: String },
            loading: { type: Boolean },
            error: { type: String },
            success: { type: String }
        };
    }

    constructor() {
        super();
        this.username = '';
        this.password = '';
        this.loading = false;
        this.error = '';
        this.success = '';
    }

    async handleSubmit(e) {
        e.preventDefault();

        this.error = '';
        this.success = '';

        if (!this.username || !this.password) {
            this.error = 'Please enter both username and password';
            return;
        }

        this.loading = true;

        try {
            const response = await fetch(`${API_URL}/api/auth/login`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                credentials: 'include', // Send/receive cookies
                body: JSON.stringify({
                    username: this.username,
                    password: this.password
                })
            });

            const data = await response.json();

            if (response.ok) {
                this.success = 'Login successful!';

                // Cookie is automatically stored by browser
                // Dispatch custom event for parent component
                this.dispatchEvent(new CustomEvent('login-success', {
                    detail: { user: data.user },
                    bubbles: true,
                    composed: true
                }));

                // Clear form
                this.username = '';
                this.password = '';
            } else {
                // Handle different error response formats
                this.error = data.error?.message || data.error || data.message || 'Login failed';
            }
        } catch (err) {
            console.error('Login error:', err);
            this.error = 'Network error. Please try again.';
        } finally {
            this.loading = false;
        }
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
      <div class="login-container">
        <h2>Login</h2>
        <form @submit=${this.handleSubmit}>
          <div class="form-group">
            <label for="username">Username</label>
            <input
              id="username"
              type="text"
              .value=${this.username}
              @input=${(e) => this.username = e.target.value}
              ?disabled=${this.loading}
              placeholder="Enter your username"
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
              placeholder="Enter your password"
            />
          </div>

          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? html`<span class="spinner"></span>Logging in...` : 'Login'}
          </button>

          ${this.error ? html`<div class="error">${this.error}</div>` : ''}
          ${this.success ? html`<div class="success">${this.success}</div>` : ''}
        </form>

        <div class="switch-link">
          Don't have an account? <a @click=${this.handleRegisterClick}>Register here</a>
        </div>
      </div>
    `;
    }
}

customElements.define('login-form', LoginForm);
