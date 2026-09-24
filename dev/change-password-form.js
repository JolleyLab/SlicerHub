import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { authFormSharedStyles } from './styles/auth-form-shared.js';
import { t } from './i18n/index.js';

/**
 * Forced password + profile change after admin provision / migrate (Pattern A).
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
        .name-row {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 12px;
        }
        @media (max-width: 480px) {
          .name-row {
            grid-template-columns: 1fr;
          }
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
    const firstName = String(form.firstName?.value || '').trim();
    const lastName = String(form.lastName?.value || '').trim();
    const currentPassword = form.currentPassword?.value || '';
    const newPassword = form.newPassword?.value || '';
    const confirmPassword = form.confirmPassword?.value || '';

    if (!firstName || !lastName) {
      this.error = t('auth.changePassword.nameRequired');
      return;
    }
    if (newPassword !== confirmPassword) {
      this.error = t('auth.changePassword.mismatch');
      return;
    }
    if (newPassword.length < 8) {
      this.error = t('auth.changePassword.minLength');
      return;
    }

    this.loading = true;
    try {
      const res = await fetch(`${API_URL}/api/auth/change-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword,
          newPassword,
          firstName,
          lastName
        })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const serverMsg = data.error?.message || data.message || data.error;
        throw new Error(typeof serverMsg === 'string' ? serverMsg : t('auth.changePassword.failed'));
      }
      this.success = true;
      this.dispatchEvent(new CustomEvent('password-changed', {
        detail: { user: data.user },
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      this.error = err.message || t('auth.changePassword.failed');
    } finally {
      this.loading = false;
    }
  }

  render() {
    return html`
      <div class="auth-card">
        <h2>${t('auth.changePassword.title')}</h2>
        <p class="hint">${t('auth.changePassword.hint')}</p>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        <form @submit=${this.handleSubmit}>
          <div class="name-row">
            <div class="form-group">
              <label for="firstName">${t('auth.changePassword.firstName')}</label>
              <input id="firstName" name="firstName" type="text" required autocomplete="given-name" />
            </div>
            <div class="form-group">
              <label for="lastName">${t('auth.changePassword.lastName')}</label>
              <input id="lastName" name="lastName" type="text" required autocomplete="family-name" />
            </div>
          </div>
          <div class="form-group">
            <label for="currentPassword">${t('auth.changePassword.current')}</label>
            <input id="currentPassword" name="currentPassword" type="password" required autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label for="newPassword">${t('auth.changePassword.newPassword')}</label>
            <input id="newPassword" name="newPassword" type="password" required minlength="8" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label for="confirmPassword">${t('auth.changePassword.confirm')}</label>
            <input id="confirmPassword" name="confirmPassword" type="password" required minlength="8" autocomplete="new-password" />
          </div>
          <button type="submit" ?disabled=${this.loading}>
            ${this.loading ? t('auth.changePassword.submitting') : t('auth.changePassword.submit')}
          </button>
        </form>
      </div>
    `;
  }
}

customElements.define('change-password-form', ChangePasswordForm);
