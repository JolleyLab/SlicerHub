import { LitElement, html, css } from 'lit-element';
import { authFormSharedStyles } from '../styles/auth-form-shared.js';
import { t } from '../i18n/index.js';
import { openKeycloakPopup } from '../services/keycloakPopup.js';

/**
 * Start procedure mode: keeps this workstation signed in for a long case.
 * Every time: choose how long, acknowledge what it means, and confirm with the password
 * on Keycloak's page in a popup (always asked, even with a live Keycloak sign-in; the
 * backend checks it was this account and a fresh sign-in).
 * docs/redirect-login-and-sessions-design.md ("Procedure mode").
 *
 * Fires `procedure-mode-started` with { until, openEnded }.
 */
export class ProcedureModeDialog extends LitElement {
    static get properties() {
        return {
            defaultHours: { type: Number },
            maxHours: { type: Number },
            _hours: { state: true },
            _untilEnded: { state: true },
            _ack: { state: true },
            _busy: { state: true },
            _error: { state: true },
        };
    }

    static get styles() {
        return [authFormSharedStyles, css`
            dialog {
                border: none;
                padding: 0;
                background: transparent;
                max-width: 480px;
                width: calc(100% - 32px);
            }
            dialog::backdrop {
                background: color-mix(in srgb, var(--color-text-primary, #040316) 45%, transparent);
            }
            .auth-card p { margin: 0 0 16px 0; color: var(--color-text-primary); line-height: 1.45; }
            fieldset { border: none; margin: 0 0 16px 0; padding: 0; }
            legend { color: var(--color-text-secondary); font-weight: 500; font-size: 0.9rem; margin-bottom: 8px; padding: 0; }
            .choice { display: flex; align-items: center; gap: 8px; margin: 6px 0; color: var(--color-text-primary); }
            .choice input[type="radio"], .ack input { width: auto; margin: 0; }
            .choice select {
                padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm);
                background: var(--color-panel); color: var(--color-text-primary); font: inherit;
            }
            .ack { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 16px 0; color: var(--color-text-primary); line-height: 1.4; }
            .ack input { margin-top: 3px; }
            .actions { display: flex; gap: 10px; }
            .actions button { flex: 1; }
            .actions button.secondary { margin-top: 0; }
        `];
    }

    constructor() {
        super();
        this.defaultHours = 8;
        this.maxHours = 24;
        this._reset();
    }

    _reset() {
        this._hours = this.defaultHours;
        this._untilEnded = false;
        this._ack = false;
        this._busy = false;
        this._error = '';
    }

    get _dialog() {
        return this.renderRoot?.querySelector('dialog');
    }

    open() {
        this._reset();
        this.updateComplete.then(() => {
            this._dialog?.showModal();
            this.renderRoot.querySelector('input[type="radio"]')?.focus();
        });
    }

    close() {
        this._dialog?.close();
    }

    _endsAt() {
        const hours = this._untilEnded ? this.maxHours : this._hours;
        return new Date(Date.now() + hours * 3600 * 1000)
            .toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' });
    }

    _started(procedureMode) {
        this.close();
        this.dispatchEvent(new CustomEvent('procedure-mode-started', {
            detail: procedureMode, bubbles: true, composed: true,
        }));
    }

    async _submit(e) {
        e.preventDefault();
        this._error = '';
        if (!this._ack) {
            this._error = t('procedureMode.needAck');
            return;
        }
        const duration = this._untilEnded ? 'open' : String(this._hours);
        this._busy = true;
        let result;
        try {
            result = await openKeycloakPopup({ ack: '1', procedure: duration });
        } catch {
            this._busy = false;
            this._error = t('auth.reauth.popupBlocked');
            return;
        }
        this._busy = false;
        if (!result.ok) {
            if (result.code === 'login_wrong_account') this._error = t('procedureMode.wrongAccount');
            else if (result.code !== 'popup_closed') this._error = t('procedureMode.failed');
            return;
        }
        const res = await fetch('/api/auth/me', { credentials: 'include' }).catch(() => null);
        const data = res?.ok ? await res.json().catch(() => null) : null;
        if (data?.session?.procedureMode?.active) this._started(data.session.procedureMode);
        else this._error = t('procedureMode.failed');
    }

    render() {
        const hourOptions = Array.from({ length: this.maxHours }, (_, i) => i + 1);
        return html`
            <dialog aria-labelledby="pm-title" aria-describedby="pm-intro">
                <form class="auth-card" @submit=${this._submit}>
                    <h2 id="pm-title">${t('procedureMode.title')}</h2>
                    <p id="pm-intro">${t('procedureMode.intro')}</p>
                    ${this._error ? html`<div class="auth-alert auth-alert--error" role="alert">${this._error}</div>` : ''}

                    <fieldset>
                        <legend>${t('procedureMode.howLong')}</legend>
                        <label class="choice">
                            <input type="radio" name="pm-length" .checked=${!this._untilEnded}
                                @change=${() => { this._untilEnded = false; }}>
                            ${t('procedureMode.forPrefix')}
                            <select aria-label=${t('procedureMode.hoursLabel')} .value=${String(this._hours)}
                                ?disabled=${this._untilEnded}
                                @change=${(e) => { this._hours = Number(e.target.value); }}>
                                ${hourOptions.map((h) => html`<option value=${h} ?selected=${h === this._hours}>${h}</option>`)}
                            </select>
                            ${t('procedureMode.hoursSuffix')}
                        </label>
                        <label class="choice">
                            <input type="radio" name="pm-length" .checked=${this._untilEnded}
                                @change=${() => { this._untilEnded = true; }}>
                            ${t('procedureMode.untilEnded', { max: this.maxHours })}
                        </label>
                    </fieldset>

                    <label class="ack">
                        <input type="checkbox" .checked=${this._ack} @change=${(e) => { this._ack = e.target.checked; }}>
                        <span>${t('procedureMode.ack', { time: this._endsAt() })}</span>
                    </label>

                    <p>${t('procedureMode.confirmWithSignIn')}</p>

                    <div class="actions">
                        <button class="secondary" type="button" @click=${() => this.close()}>${t('procedureMode.cancel')}</button>
                        <button class="primary" type="submit" ?disabled=${this._busy}>
                            ${this._busy ? t('procedureMode.starting') : t('procedureMode.start')}
                        </button>
                    </div>
                </form>
            </dialog>
        `;
    }
}

customElements.define('procedure-mode-dialog', ProcedureModeDialog);
