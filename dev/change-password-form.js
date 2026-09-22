import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { authFormSharedStyles } from './styles/auth-form-shared.js';

/**
 * Forced / voluntary password change after admin provision (Pattern A).
 */
export class ChangePasswordForm extends LitElement {
  static get properties() {
    return {
      loading: { type: Boolean },
      error: { type: String },
      success: { type: Boolean }
    };
  }

  static get styles() {
    return [
      authFormSharedStyles,
      css`
        h2 {
          margin: 0 0 8px 0;
          font-size: 1.25rem;
        }
        .form-group {
          margin-bottom: 16px;
        }
      `
    ];
  }

  constructor() {
    super();
    this.loading = false;
    this.error = '';
    this.success = false;
  }

  async handleSubmit(e) {
    e.preventDefault();
    this.error = '';
    const form = e.target;
    const currentPassword = form.currentPassword?.value || '';
    const newPassword = form.newPassword?.value || '';
    const confirmPassword = form.confirmPassword?.value || '';

    if (newPassword !== confirmPassword) {
      this.error = 'New passwords do not match';
      return;
    }
    if (newPassword.length < 8) {
      this.error = 'New password must be at least 8 characters';
      return;
    }

    this.loading = true;
    try {
      const res = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ currentPassword, newPassword })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message || data.error || 'Could not update password');
      }
      this.success = true;
      this.dispatchEvent(new CustomEvent('password-changed', {
        detail: { user: data.user },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      this.error = err.message || 'Could not update password';
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="auth-card">
        <h2>Set a new password</h2>
        <p class="hint">Your account was provisioned with a temporary password. Choose a new one to continue.</p>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        <form @submit=${this.handleSubmit}>
          <div class="form-group">
            <label for="currentPassword">Current (temporary) password</label>
            <input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label for="newPassword">New password</label>
            <input id="newPassword" name="newPassword" type="password" required minlength="8" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="confirmPassword">Confirm new password</label>
            <input id="confirmPassword" name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" />
          </div>
          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? 'Updating…' : 'Update password'}
          </button>
        </form>
      </div>
    `;
  }
}

customElements.define('change-password-form', ChangePasswordForm);
