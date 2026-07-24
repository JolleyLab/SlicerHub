import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * One row in a file list: clickable name + meta line + icon actions via <slot name="actions">.
 */
export class FileListRow extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .file-row {
                border: 1px dashed var(--color-border);
                border-radius: var(--radius-md);
                padding: 10px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                background: transparent;
            }

            :host-context([data-theme='dark']) .file-row {
                border-color: var(--color-border);
                background: transparent;
            }

            :host-context([data-theme='dark']) .file-meta {
                color: var(--color-text-secondary);
            }

            .file-main {
                min-width: 0;
                flex: 1;
            }

            .file-name-button {
                border: none;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-weight: 600;
                padding: 0;
                cursor: pointer;
                text-align: left;
                word-break: break-word;
            }

            .file-name-button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            .file-meta {
                color: var(--color-text-secondary);
                font-size: 0.9rem;
                line-height: 1.35;
            }

            .file-action-group {
                display: inline-flex;
                align-items: center;
                gap: 10px;
                padding: 2px;
            }

            .file-name-button:hover {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
            }

            .file-name-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            ::slotted(.file-icon-button) {
                border: none;
                border-radius: var(--radius-lg);
                background: transparent;
                color: var(--color-text-primary);
                width: 34px;
                height: 34px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            ::slotted(.file-icon-button:hover) {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
            }

            ::slotted(.file-icon-button:focus-visible) {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            ::slotted(.file-icon-button:disabled) {
                opacity: 0.45;
                cursor: not-allowed;
            }
        `;
    }

    static get properties() {
        return {
            fileName: { type: String },
            metaLine: { type: String },
            nameButtonTitle: { type: String },
            nameButtonDisabled: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.fileName = '';
        this.metaLine = '';
        this.nameButtonTitle = 'Launch file';
        this.nameButtonDisabled = false;
    }

    handleNameClick() {
        if (this.nameButtonDisabled) return;
        this.dispatchEvent(new CustomEvent('name-click', {
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <div class="file-row">
                <div class="file-main">
                    <button
                        class="file-name-button"
                        type="button"
                        title=${this.nameButtonTitle}
                        ?disabled=${this.nameButtonDisabled}
                        @click=${this.handleNameClick}
                    >
                        ${this.fileName}
                    </button>
                    <div class="file-meta">${this.metaLine}</div>
                </div>
                <div class="file-action-group">
                    <slot name="actions"></slot>
                </div>
            </div>
        `;
    }
}

customElements.define('file-list-row', FileListRow);
