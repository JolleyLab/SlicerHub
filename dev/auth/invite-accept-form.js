import { LitElement, html, css } from 'lit-element';
import { previewSignupInvite, acceptSignupInvite } from '../services/registrations.js';
import { authFormSharedStyles } from '../styles/auth-form-shared.js';
import { t } from '../i18n/index.js';

/**
 * Redeem a case signup invite (?invite=token).
 * Sends a Directus invite email so the user sets their own password.
 * No password collected here — emits `invite-accepted` with status:'invite_sent'.
 */
export class InviteAcceptForm extends LitElement {
    static get properties() {
        return {
            token:      { type: String },
            preview:    { type: Object },
            loading:    { type: Boolean },
            submitting: { type: Boolean },
            error:      { type: String },
            firstName:  { type: String },
            lastName:   { type: String },
            done:       { type: Boolean }
        };
    }

    static get styles() {
        return [
            authFormSharedStyles,
            css`
              h2 {
                margin: 0 0 8px 0;
              }
              .sub {
                margin: 0 0 20px 0;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 14px;
                line-height: 1.4;
              }
              .form-group {
                margin-bottom: 16px;
              }
            `
        ];
    }

    constructor() {
        super();
        this.token = '';
        this.preview = null;
        this.loading = true;
        this.submitting = false;
        this.error = '';
        this.firstName = '';
        this.lastName = '';
        this.done = false;
    }

    connectedCallback() {
        super.connectedCallback();
        this.loadPreview();
    }

    async loadPreview() {
        this.loading = true;
        this.error = '';
        try {
            this.preview = await previewSignupInvite(this.token);
        } catch (err) {
            this.preview = null;
            this.error = err?.message || t('auth.invite.invalidOrExpired');
        } finally {
            this.loading = false;
        }
    }

    async handleSubmit(event) {
        event.preventDefault();
        if (this.submitting || !this.preview) return;
        this.submitting = true;
        this.error = '';
        try {
            await acceptSignupInvite(this.token, {
                firstName: this.firstName,
                lastName: this.lastName
            });
            this.done = true;
            this.dispatchEvent(new CustomEvent('invite-accepted', {
                detail: { status: 'invite_sent', caseId: this.preview?.caseId },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.error = err?.message || t('auth.invite.createFailed');
        } finally {
            this.submitting = false;
        }
    }

    render() {
        if (this.loading) {
            return html`<div class="auth-card"><p class="sub">${t('auth.invite.loading')}</p></div>`;
        }
        if (!this.preview) {
            return html`
                <div class="auth-card">
                    <h2>${t('auth.invite.unavailable')}</h2>
                    <div class="auth-alert auth-alert--error" role="alert">
                      ${this.error || t('auth.invite.invalidOrExpired')}
                    </div>
                </div>
            `;
        }
        if (this.done) {
            return html`
                <div class="auth-card">
                    <h2>${t('auth.invite.sentTitle')}</h2>
                    <p class="sub">${t('auth.invite.sentBody', { email: this.preview?.inviteeEmail || '' })}</p>
                </div>
            `;
        }

        const caseTitle = this.preview.caseTitle || t('auth.invite.caseFallback');
        const role = String(this.preview.proposedRole || 'collaborator').replace('_', ' ');
        return html`
            <div class="auth-card">
                <h2>${t('auth.invite.joinTitle', { caseTitle })}</h2>
                ${this.error ? html`
                  <div class="auth-alert auth-alert--error" role="alert">${this.error}</div>
                ` : ''}
                <p class="sub">${t('auth.invite.subcopy', { role })}</p>
                <form @submit=${(e) => this.handleSubmit(e)}>
                    <div class="form-group">
                        <label>${t('auth.invite.email')}</label>
                        <input type="email" .value=${this.preview.email || ''} disabled />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.firstName')}</label>
                        <input type="text" .value=${this.firstName}
                            @input=${(e) => { this.firstName = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label>${t('auth.invite.lastName')}</label>
                        <input type="text" .value=${this.lastName}
                            @input=${(e) => { this.lastName = e.target.value; }} />
                    </div>
                    <button type="submit" ?disabled=${this.submitting}>
                        ${this.submitting ? t('auth.invite.submitting') : t('auth.invite.submit')}
                    </button>
                </form>
            </div>
        `;
    }
}

customElements.define('invite-accept-form', InviteAcceptForm);
