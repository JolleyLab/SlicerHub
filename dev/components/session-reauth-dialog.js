import { LitElement, html, css } from 'lit-element';
import { authFormSharedStyles } from '../styles/auth-form-shared.js';
import { t } from '../i18n/index.js';
import { openKeycloakPopup } from '../services/keycloakPopup.js';

/**
 * "Your session ended — sign in to continue."
 *
 * Shown by the app shell (via services/reauth.js) when the server says the session is
 * over, or after the idle timeout. The page underneath is hidden by an opaque backdrop
 * (an unattended screen shouldn't keep showing case data) but not reloaded, so unsaved
 * work stays in memory; the request that failed is retried after signing in. Signing in
 * happens on Keycloak's page in a popup window; if Keycloak still has a live sign-in,
 * the popup closes without asking for the password.
 *
 * If a different account signs in, the page reloads rather than mixing two people's data.
 *
 * Usage: const el = …; await el.prompt(reason)  // resolves when signed in, rejects on sign-out
 */
export class SessionReauthDialog extends LitElement {
    static get properties() {
        return {
            userId: { type: String },
            idleMinutes: { type: Number },
            maxHours: { type: Number },
            _reason: { state: true },
            _busy: { state: true },
            _error: { state: true },
            _popupBlocked: { state: true },
        };
    }

    static get styles() {
        return [authFormSharedStyles, css`
            dialog {
                border: none;
                padding: 0;
                background: transparent;
                max-width: 420px;
                width: calc(100% - 32px);
            }
            /* Opaque: the page underneath (possibly case data) is not visible. */
            dialog::backdrop {
                background: var(--color-background, #ecf4f9);
            }
            .auth-card p {
                margin: 0 0 16px 0;
                color: var(--color-text-primary);
                line-height: 1.45;
            }
            button.secondary { margin-top: 10px; }
        `];
    }

    constructor() {
        super();
        this.userId = '';
        this.idleMinutes = 30;
        this.maxHours = 12;
        this._reason = 'expired';
        this._busy = false;
        this._error = '';
        this._popupBlocked = false;
        this._settle = null;
    }

    get _dialog() {
        return this.renderRoot?.querySelector('dialog');
    }

    /** Show the dialog. Resolves once signed in again; rejects if they choose to sign out. */
    prompt(reason = 'expired') {
        this._reason = reason;
        this._error = '';
        this._busy = false;
        this._popupBlocked = false;
        return new Promise((resolve, reject) => {
            this._settle = { resolve, reject };
            this.updateComplete.then(() => {
                const dialog = this._dialog;
                if (dialog && !dialog.open) dialog.showModal();
                this.renderRoot.querySelector('button.primary')?.focus();
            });
        });
    }

    _close() {
        this._dialog?.close();
    }

    async _confirmSameAccount(signedInUserId) {
        if (this.userId && signedInUserId && String(signedInUserId) !== String(this.userId)) {
            // Someone else signed in: start clean rather than show the previous person's page.
            window.location.reload();
            return false;
        }
        return true;
    }

    _succeed() {
        this._close();
        const settle = this._settle;
        this._settle = null;
        settle?.resolve();
    }

    _signOut() {
        this._close();
        const settle = this._settle;
        this._settle = null;
        settle?.reject(new Error('signed-out'));
        this.dispatchEvent(new CustomEvent('reauth-sign-out', { bubbles: true, composed: true }));
    }

    async _openPopup() {
        this._error = '';
        this._popupBlocked = false;
        this._busy = true;
        let result;
        try {
            result = await openKeycloakPopup();
        } catch {
            this._popupBlocked = true;
            this._busy = false;
            return;
        }
        this._busy = false;
        if (!result.ok) {
            if (result.code !== 'popup_closed') this._error = t('auth.reauth.failed');
            return;
        }
        try {
            const res = await fetch('/api/auth/me', { credentials: 'include' });
            const data = await res.json();
            if (res.ok && await this._confirmSameAccount(data?.user?.id)) this._succeed();
            else if (!res.ok) this._error = t('auth.reauth.failed');
        } catch {
            this._error = t('auth.reauth.failed');
        }
    }

    _title() {
        if (this._reason === 'idle') return t('auth.reauth.titleIdle', { minutes: this.idleMinutes });
        if (this._reason === 'max-age') return t('auth.reauth.titleMaxAge', { hours: this.maxHours });
        return t('auth.reauth.titleExpired');
    }

    render() {
        return html`
            <dialog
                aria-labelledby="reauth-title"
                aria-describedby="reauth-body"
                @cancel=${(e) => e.preventDefault()}
            >
                <div class="auth-card">
                    <h2 id="reauth-title">${this._title()}</h2>
                    <p id="reauth-body">${t('auth.reauth.body')}</p>
                    ${this._error ? html`<div class="auth-alert auth-alert--error" role="alert">${this._error}</div>` : ''}
                    ${this._popupBlocked ? html`
                        <div class="auth-alert auth-alert--error" role="alert">${t('auth.reauth.popupBlocked')}</div>
                    ` : ''}
                    <button class="primary" type="button" @click=${this._openPopup} ?disabled=${this._busy}>
                        ${this._busy ? t('auth.reauth.waitingForPopup') : t('auth.reauth.signIn')}
                    </button>
                    <button class="secondary" type="button" @click=${this._signOut}>${t('auth.reauth.signOut')}</button>
                </div>
            </dialog>
        `;
    }
}

customElements.define('session-reauth-dialog', SessionReauthDialog);
