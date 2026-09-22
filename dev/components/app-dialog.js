import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

/** Default outside-click safe zone (px) for motor/touch forgiveness. */
const DEFAULT_LIGHT_DISMISS_BUFFER_PX = 28;

export class AppDialog extends LitElement {
    static get styles() {
        return css`
            :host {
                display: contents;
            }

            .dialog {
                position: relative;
                width: var(--app-dialog-width, min(560px, calc(100vw - 32px)));
                max-width: calc(100vw - 32px);
                border: 1px solid var(--color-border);
                border-radius: calc(var(--radius-lg, 12px) + 2px);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                padding: 22px 22px 18px;
                box-shadow:
                    0 0 0 1px color-mix(in srgb, var(--color-border) 55%, transparent),
                    0 8px 24px rgba(0, 0, 0, 0.12),
                    0 24px 64px rgba(0, 0, 0, 0.16);
            }

            :host-context([data-theme='dark']) .dialog {
                border-color: color-mix(in srgb, var(--color-border) 65%, var(--color-primary));
                box-shadow:
                    0 0 0 1px color-mix(in srgb, var(--color-primary) 22%, transparent),
                    0 12px 32px rgba(0, 0, 0, 0.4),
                    0 28px 72px rgba(0, 0, 0, 0.5);
            }

            .dialog::backdrop {
                background:
                    linear-gradient(
                        160deg,
                        color-mix(in srgb, var(--color-primary, #167aac) 18%, rgba(10, 14, 22, 0.62)),
                        rgba(10, 14, 22, 0.58)
                    );
                backdrop-filter: blur(3px);
                -webkit-backdrop-filter: blur(3px);
            }

            .dialog-title {
                margin: 0 0 16px;
                font-size: 1.2rem;
                font-weight: 700;
                letter-spacing: -0.01em;
                padding-right: 36px;
            }

            .dialog-actions {
                display: flex;
                justify-content: flex-end;
                margin-top: 16px;
                gap: 8px;
            }

            .close-button {
                position: absolute;
                top: 12px;
                right: 12px;
                width: 32px;
                height: 32px;
                border: none;
                border-radius: 50%;
                background: transparent;
                color: var(--color-text-primary);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 22px;
                line-height: 1;
                padding: 0;
                cursor: pointer;
            }

            .close-button:hover,
            .close-button:focus-visible {
                background: var(--color-surface, rgba(0, 0, 0, 0.08));
            }

            .close-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
        `;
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
