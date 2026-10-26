import { LitElement, html } from 'lit-element';
import { appDialogStyles } from './app-dialog.styles.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

/** Default outside-click safe zone (px) for motor/touch forgiveness. */
const DEFAULT_LIGHT_DISMISS_BUFFER_PX = 28;

export class AppDialog extends LitElement {
    static get styles() {
        return appDialogStyles;
    }

    static get properties() {
        return {
            title: { type: String },
            showDefaultCloseButton: { type: Boolean },
            /** When false, Escape and outside click do not close the dialog. */
            lightDismiss: { type: Boolean },
            /**
             * Extra px around the dialog that still count as "inside"
             * (helps movement disorders / fat-finger taps).
             */
            lightDismissBuffer: { type: Number }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.title = '';
        this.showDefaultCloseButton = true;
        this.lightDismiss = true;
        this.lightDismissBuffer = DEFAULT_LIGHT_DISMISS_BUFFER_PX;
        this._dismissPointerId = null;
        this._onDialogCancel = (event) => {
            if (!this.lightDismiss) {
                event.preventDefault();
            }
        };
        this._onPointerDown = (event) => this.handleDismissPointerDown(event);
        this._onPointerUp = (event) => this.handleDismissPointerUp(event);
        this._onPointerCancel = () => {
            this._dismissPointerId = null;
        };
    }

    get nativeDialog() {
        return this.renderRoot?.querySelector('dialog');
    }

    get dismissBufferPx() {
        const n = Number(this.lightDismissBuffer);
        return Number.isFinite(n) && n >= 0 ? n : DEFAULT_LIGHT_DISMISS_BUFFER_PX;
    }

    firstUpdated() {
        const dialog = this.nativeDialog;
        if (!dialog) return;
        dialog.addEventListener('cancel', this._onDialogCancel);
        dialog.addEventListener('pointerdown', this._onPointerDown);
        dialog.addEventListener('pointerup', this._onPointerUp);
        dialog.addEventListener('pointercancel', this._onPointerCancel);
    }

    disconnectedCallback() {
        const dialog = this.nativeDialog;
        if (dialog) {
            dialog.removeEventListener('cancel', this._onDialogCancel);
            dialog.removeEventListener('pointerdown', this._onPointerDown);
            dialog.removeEventListener('pointerup', this._onPointerUp);
            dialog.removeEventListener('pointercancel', this._onPointerCancel);
        }
        super.disconnectedCallback();
    }

    updated(changed) {
        if (changed.has('lightDismiss') && this.nativeDialog) {
            this.nativeDialog.removeEventListener('cancel', this._onDialogCancel);
            this.nativeDialog.addEventListener('cancel', this._onDialogCancel);
        }
    }

    /**
     * True if the point is inside the dialog box expanded by the dismiss buffer.
     */
    isInsideDismissSafeZone(clientX, clientY) {
        const dialog = this.nativeDialog;
        if (!dialog) return true;
        const rect = dialog.getBoundingClientRect();
        const pad = this.dismissBufferPx;
        return (
            clientX >= rect.left - pad
            && clientX <= rect.right + pad
            && clientY >= rect.top - pad
            && clientY <= rect.bottom + pad
        );
    }

    handleDismissPointerDown(event) {
        if (!this.lightDismiss || !this.nativeDialog?.open) return;
        // Only primary button / touch / pen
        if (event.pointerType === 'mouse' && event.button !== 0) return;
        if (this.isInsideDismissSafeZone(event.clientX, event.clientY)) {
            this._dismissPointerId = null;
            return;
        }
        this._dismissPointerId = event.pointerId;
    }

    handleDismissPointerUp(event) {
        if (!this.lightDismiss || this._dismissPointerId == null) return;
        if (event.pointerId !== this._dismissPointerId) return;
        this._dismissPointerId = null;
        // Require both press and release outside the buffered zone
        if (this.isInsideDismissSafeZone(event.clientX, event.clientY)) return;
        this.closeDialog();
    }

    openDialog() {
        this._dismissPointerId = null;
        if (this.nativeDialog && !this.nativeDialog.open) {
            this.nativeDialog.showModal();
        }
    }

    closeDialog() {
        this._dismissPointerId = null;
        if (this.nativeDialog?.open) {
            this.nativeDialog.close();
        }
    }

    render() {
        return html`
            <dialog class="dialog">
                ${this.title ? html`<h2 class="dialog-title">${this.title}</h2>` : ''}
                ${this.showDefaultCloseButton ? html`
                    <button class="close-button" aria-label=${t('dialog.closeAria')} @click=${() => this.closeDialog()}>×</button>
                ` : ''}
                <slot></slot>
                <div class="dialog-actions">
                    <slot name="actions"></slot>
                </div>
            </dialog>
        `;
    }
}

customElements.define('app-dialog', AppDialog);
