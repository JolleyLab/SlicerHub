import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

export class AppDialog extends LitElement {
    static get styles() {
        return css`
            :host {
                display: contents;
            }

            .dialog {
                position: relative;
                width: min(560px, calc(100vw - 32px));
                border: 1px solid var(--color-border);
                border-radius: 12px;
                background: var(--color-background);
                color: var(--color-text-primary);
                padding: 20px;
            }

            :host-context([data-theme='dark']) .dialog {
                border-color: var(--color-primary);
            }

            .dialog::backdrop {
                background: rgba(0, 0, 0, 0.4);
            }

            .dialog-title {
                margin: 0 0 14px;
                font-size: 1.25rem;
                font-weight: 700;
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
                outline: none;
            }
        `;
    }

    static get properties() {
        return {
            title: { type: String },
            showDefaultCloseButton: { type: Boolean },
            /** When false, Escape and backdrop click do not close the dialog. */
            lightDismiss: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.title = '';
        this.showDefaultCloseButton = true;
        this.lightDismiss = true;
        this._onDialogCancel = (event) => {
            if (!this.lightDismiss) {
                event.preventDefault();
            }
        };
    }

    get nativeDialog() {
        return this.renderRoot?.querySelector('dialog');
    }

    firstUpdated() {
        this.nativeDialog?.addEventListener('cancel', this._onDialogCancel);
    }

    disconnectedCallback() {
        this.nativeDialog?.removeEventListener('cancel', this._onDialogCancel);
        super.disconnectedCallback();
    }

    updated(changed) {
        if (changed.has('lightDismiss') && this.nativeDialog) {
            // Re-assert cancel handler after re-render.
            this.nativeDialog.removeEventListener('cancel', this._onDialogCancel);
            this.nativeDialog.addEventListener('cancel', this._onDialogCancel);
        }
    }

    openDialog() {
        if (this.nativeDialog && !this.nativeDialog.open) {
            this.nativeDialog.showModal();
        }
    }

    closeDialog() {
        if (this.nativeDialog?.open) {
            this.nativeDialog.close();
        }
    }

    render() {
        return html`
            <dialog class="dialog">
                ${this.title ? html`<h2 class="dialog-title">${this.title}</h2>` : ''}
                ${this.showDefaultCloseButton ? html`
                    <button class="close-button" aria-label="Close dialog" @click=${() => this.closeDialog()}>×</button>
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
