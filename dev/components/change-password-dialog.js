import { LitElement, html } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import './app-dialog.js';
import '../change-password-form.js';

export class ChangePasswordDialog extends LitElement {
    static get properties() {
        return {
            firstName: { type: String },
            lastName: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.firstName = '';
        this.lastName = '';
    }

    get _dialog() {
        return this.renderRoot?.querySelector('app-dialog');
    }

    open() {
        this._dialog?.openDialog();
    }

    close() {
        this._dialog?.closeDialog();
    }

    _onPasswordChanged(e) {
        this.close();
        this.dispatchEvent(new CustomEvent('password-changed', {
            detail: e.detail,
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <app-dialog title=${t('auth.changePassword.settingsTitle')}>
                <change-password-form
                    .firstName=${this.firstName}
                    .lastName=${this.lastName}
                    @password-changed=${this._onPasswordChanged}
                ></change-password-form>
            </app-dialog>
        `;
    }
}

customElements.define('change-password-dialog', ChangePasswordDialog);
