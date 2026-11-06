import { LitElement, html, css } from 'lit-element';
import { API_URL } from '../config.js';
import { loadAppFeatures, getAppFeatures } from '../services/features.js';
import { authFormStyleText } from '../styles/auth-form-shared.js';
import { t } from '../i18n/index.js';

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

const SIGN_OUT_REASON_KEY = 'sh-sign-out-reason';

/**
 * Say why the app signed out, for the sign-in screen after Keycloak's sign-out sends the
 * browser back (it always returns to "/", so this can't ride in the URL).
 */
export function noteSignOutReason(code) {
    try { sessionStorage.setItem(SIGN_OUT_REASON_KEY, String(code)); } catch { /* storage blocked */ }
}

function takeSignOutReason() {
    try {
        const code = sessionStorage.getItem(SIGN_OUT_REASON_KEY);
        sessionStorage.removeItem(SIGN_OUT_REASON_KEY);
        return code;
    } catch {
        return null;
    }
}

const KNOWN_ERRORS = [
    'login_expired', 'login_state_mismatch', 'login_denied', 'login_failed',
    'login_unavailable', 'login_not_fresh', 'procedure_mode_ended',
];

/**
 * Sign-in screen. Signing in, requesting access and resetting a password all happen on
 * Keycloak's pages (styled as SlicerHub), so a signed-out visit goes straight there and
 * comes back to the same page. This card is shown only when there is something to say
 * first: a sign-in that failed, or procedure mode that ended.
 * docs/redirect-login-and-sessions-design.md ("Login flow").
 */
export class LoginForm extends LitElement {
    static get styles() {
        return [loginExtras];
    }

    static get properties() {
        return {
            devRelaxed: { type: Boolean },
            loading: { type: Boolean },
            error: { type: String },
        };
    }

    createRenderRoot() {
        return this;
    }

    constructor() {
        super();
        this.devRelaxed = false;
        this.loading = false;
        this.error = '';
    }

    connectedCallback() {
        super.connectedCallback();
        this._takeRedirectLoginError();
        // Nothing to tell them: go straight to Keycloak's sign-in page.
        if (!this.error) this.startRedirectLogin();
        else this._loadAuthConfig();
    }

    /**
     * A failed sign-in lands on /?login_error=<code>; a sign-out the person didn't choose
     * (procedure mode ran out) leaves a note. Show it once, then drop it.
     */
    _takeRedirectLoginError() {
        const url = new URL(window.location.href);
        const code = url.searchParams.get('login_error') || takeSignOutReason();
        if (!code) return;
        this.error = t(`auth.login.redirectErrors.${KNOWN_ERRORS.includes(code) ? code : 'login_failed'}`);
        url.searchParams.delete('login_error');
        history.replaceState(null, '', `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}${url.hash}`);
    }

    /** Go to Keycloak's sign-in page; come back to the current page afterwards. */
    startRedirectLogin() {
        this.loading = true;
        const returnTo = `${window.location.pathname}${window.location.search}`;
        window.location.assign(`${API_URL}/api/auth/login/start?returnTo=${encodeURIComponent(returnTo)}`);
    }

    async _loadAuthConfig() {
        try {
            const flags = await loadAppFeatures();
            const auth = flags?.auth || getAppFeatures()?.auth;
            this.devRelaxed = auth?.devRelaxed === true;
        } catch {
            // keep defaults
        }
    }

    render() {
        return html`
      <style>${authFormStyleText(loginExtras)}</style>
      <div class="auth-card">
        <h2>${t('auth.login.title')}</h2>
        ${this.error ? html`
          <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
        ` : ''}
        ${this.devRelaxed ? html`
          <div class="dev-banner">${t('auth.login.devRelaxedBanner')}</div>
        ` : ''}
        <!-- Keycloak's page has its own "Forgot your password?" and "Request access" links. -->
        <button type="button" @click=${this.startRedirectLogin} ?disabled=${this.loading}>
          ${this.loading
              ? html`<span class="spinner"></span>${t('auth.login.redirecting')}`
              : t('auth.login.submit')}
        </button>
      </div>
    `;
    }
}

customElements.define('login-form', LoginForm);
