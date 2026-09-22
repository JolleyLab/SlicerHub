import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

const NAME_CLICK_DELAY_MS = 280;
const LONG_PRESS_MS = 550;
const LONG_PRESS_MOVE_PX = 10;

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
                border: 1px solid var(--color-border);
                border-left: 3px solid var(--file-row-accent, var(--color-primary));
                border-radius: var(--radius-md);
                padding: 10px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
                background: var(--color-panel, #fff);
            }

            .file-row:hover {
                background: color-mix(in srgb, var(--color-background) 40%, var(--color-panel, #fff));
            }

            :host-context([data-theme='dark']) .file-row {
                border-color: var(--color-border);
                border-left-color: var(--color-accent);
                background: var(--color-panel);
            }

            :host-context([data-theme='dark']) .file-row:hover {
                background: color-mix(in srgb, var(--color-accent) 10%, var(--color-panel));
            }

            :host-context([data-theme='dark']) .file-meta {
                color: var(--color-text-secondary);
            }

            .file-main {
                min-width: 0;
                flex: 1;
            }

            .file-title-row {
                display: flex;
                align-items: center;
                gap: 4px;
                min-width: 0;
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
                user-select: none;
                -webkit-user-select: none;
                -webkit-touch-callout: none;
                touch-action: manipulation;
            }

            .file-name-button:hover:not(:disabled) {
                color: var(--color-secondary);
                text-decoration: underline;
                text-underline-offset: 2px;
            }

            :host-context([data-theme='dark']) .file-name-button:hover:not(:disabled) {
                color: var(--color-accent);
            }

            .file-name-button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            .edit-title-button {
                border: none;
                border-radius: var(--radius-md);
                background: transparent;
                color: var(--color-text-secondary);
                width: 28px;
                height: 28px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                flex-shrink: 0;
                transition: opacity 0.15s ease, background-color 0.15s ease, color 0.15s ease;
            }

            .edit-title-button .edit-title-icon {
                width: 14px;
                height: 14px;
                display: block;
            }

            .edit-title-button:hover {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
            }

            .edit-title-button:focus-visible {
                opacity: 1;
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .edit-title-button:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            /* Fine-pointer: hide until row hover / keyboard focus. Touch keeps it visible. */
            @media (hover: hover) and (pointer: fine) {
                .edit-title-button {
                    opacity: 0;
                }

                .file-row:hover .edit-title-button,
                .edit-title-button:focus-visible {
                    opacity: 1;
                }

                .edit-title-button:disabled {
                    opacity: 0;
                }

                .file-row:hover .edit-title-button:disabled {
                    opacity: 0.45;
                }
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
            nameButtonDisabled: { type: Boolean },
            showEditTitle: { type: Boolean },
            editTitleDisabled: { type: Boolean },
            editTitleLabel: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.fileName = '';
        this.metaLine = '';
        this.nameButtonTitle = t('files.launchFile');
        this.nameButtonDisabled = false;
        this.showEditTitle = false;
        this.editTitleDisabled = false;
        this.editTitleLabel = t('files.editTitle');
        this._nameClickTimer = null;
        this._longPressTimer = null;
        this._longPressTriggered = false;
        this._suppressNextClick = false;
        this._pointerStart = null;
    }

    disconnectedCallback() {
        this.clearNameClickTimer();
        this.clearLongPressTimer();
        super.disconnectedCallback();
    }

    clearNameClickTimer() {
        if (this._nameClickTimer) {
            clearTimeout(this._nameClickTimer);
            this._nameClickTimer = null;
        }
    }

    clearLongPressTimer() {
        if (this._longPressTimer) {
            clearTimeout(this._longPressTimer);
            this._longPressTimer = null;
        }
    }

    emitNameClick() {
        this.dispatchEvent(new CustomEvent('name-click', {
            bubbles: true,
            composed: true
        }));
    }

    emitEditTitle() {
        if (this.editTitleDisabled) return;
        this.dispatchEvent(new CustomEvent('edit-title-click', {
            bubbles: true,
            composed: true
        }));
    }

    handleNameClick(event) {
        if (this.nameButtonDisabled) return;
        if (this._suppressNextClick || this._longPressTriggered) {
            event.preventDefault();
            this._suppressNextClick = false;
            this._longPressTriggered = false;
            return;
        }

        // Without edit mode, open immediately.
        if (!this.showEditTitle || this.editTitleDisabled) {
            this.emitNameClick();
            return;
        }

        // Delay launch so a second click can become a double-click edit gesture.
        this.clearNameClickTimer();
        this._nameClickTimer = setTimeout(() => {
            this._nameClickTimer = null;
            this.emitNameClick();
        }, NAME_CLICK_DELAY_MS);
    }

    handleNameDblClick(event) {
        if (!this.showEditTitle || this.editTitleDisabled || this.nameButtonDisabled) return;
        event.preventDefault();
        this.clearNameClickTimer();
        this._suppressNextClick = true;
        this.emitEditTitle();
    }

    handleNamePointerDown(event) {
        if (!this.showEditTitle || this.editTitleDisabled || this.nameButtonDisabled) return;
        if (event.button != null && event.button !== 0) return;
        // Mouse uses double-click; touch/pen use long-press.
        if (event.pointerType === 'mouse') return;

        this._longPressTriggered = false;
        this._pointerStart = { x: event.clientX, y: event.clientY };
        this.clearLongPressTimer();
        this._longPressTimer = setTimeout(() => {
            this._longPressTimer = null;
            this._longPressTriggered = true;
            this.clearNameClickTimer();
            this.emitEditTitle();
            if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
                navigator.vibrate(12);
            }
        }, LONG_PRESS_MS);
    }

    handleNamePointerMove(event) {
        if (!this._pointerStart || !this._longPressTimer) return;
        const dx = Math.abs(event.clientX - this._pointerStart.x);
        const dy = Math.abs(event.clientY - this._pointerStart.y);
        if (dx > LONG_PRESS_MOVE_PX || dy > LONG_PRESS_MOVE_PX) {
            this.clearLongPressTimer();
            this._pointerStart = null;
        }
    }

    handleNamePointerEnd() {
        this.clearLongPressTimer();
        this._pointerStart = null;
    }

    handleEditTitleClick(event) {
        event.stopPropagation();
        this.clearNameClickTimer();
        this.clearLongPressTimer();
        this.emitEditTitle();
    }

    render() {
        return html`
            <div class="file-row">
                <div class="file-main">
                    <div class="file-title-row">
                        <button
                            class="file-name-button"
                            type="button"
                            title=${this.nameButtonTitle || undefined}
                            ?disabled=${this.nameButtonDisabled}
                            @click=${this.handleNameClick}
                            @dblclick=${this.handleNameDblClick}
                            @pointerdown=${this.handleNamePointerDown}
                            @pointermove=${this.handleNamePointerMove}
                            @pointerup=${this.handleNamePointerEnd}
                            @pointercancel=${this.handleNamePointerEnd}
                            @pointerleave=${this.handleNamePointerEnd}
                        >
                            ${this.fileName}
                        </button>
                        <slot name="title-trailing"></slot>
                        ${this.showEditTitle ? html`
                            <button
                                class="edit-title-button"
                                type="button"
                                aria-label=${this.editTitleLabel}
                                ?disabled=${this.editTitleDisabled}
                                @click=${this.handleEditTitleClick}
                            >
                                <svg class="edit-title-icon" viewBox="0 0 24 24" aria-hidden="true">
                                    <path fill="currentColor" d="M3 17.25V21h3.75l11-11.03-3.75-3.75L3 17.25zm14.81-9.06 1.83-1.83a1 1 0 0 0 0-1.41l-1.41-1.41a1 1 0 0 0-1.41 0l-1.83 1.83 2.82 2.82z"></path>
                                </svg>
                            </button>
                        ` : ''}
                    </div>
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
