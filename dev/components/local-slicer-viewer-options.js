import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import {
    normalizeLocalSlicerViewerOptions
} from '../utils/localSlicerViewerOptions.js';

/**
 * Reusable Local Full Slicer preference checkboxes.
 * Emits `options-change` with { useFullSlicer, useSimplifiedViewer }.
 * Used by user Settings; My Projects reads the saved user preference.
 */
export class LocalSlicerViewerOptions extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .options {
                display: flex;
                flex-direction: column;
                gap: 10px;
            }

            .checkbox {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                font-size: 0.9rem;
                font-weight: 500;
                color: var(--color-text-primary);
                cursor: pointer;
                line-height: 1.35;
            }

            .checkbox input {
                appearance: none;
                -webkit-appearance: none;
                width: 18px;
                height: 18px;
                margin: 1px 0 0;
                flex: 0 0 18px;
                box-sizing: border-box;
                border: 1.5px solid var(--color-border);
                border-radius: var(--radius-sm, 4px);
                background: var(--color-surface, var(--color-background));
                cursor: pointer;
                position: relative;
                transition:
                    background-color 0.15s ease,
                    border-color 0.15s ease,
                    box-shadow 0.15s ease;
            }

            .checkbox input::after {
                content: '';
                position: absolute;
                left: 5px;
                top: 1px;
                width: 5px;
                height: 9px;
                border: solid var(--color-on-primary, #fff);
                border-width: 0 2px 2px 0;
                transform: rotate(45deg) scale(0);
                transform-origin: center;
                transition: transform 0.12s ease;
                opacity: 0;
            }

            .checkbox input:hover:not(:disabled) {
                border-color: var(--color-secondary);
            }

            .checkbox input:checked {
                background: var(--color-secondary);
                border-color: var(--color-secondary);
            }

            .checkbox input:checked::after {
                opacity: 1;
                transform: rotate(45deg) scale(1);
            }

            .checkbox input:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .checkbox input:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            :host-context([data-theme='dark']) .checkbox input {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface));
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
            }

            :host-context([data-theme='dark']) .checkbox input:hover:not(:disabled) {
                border-color: color-mix(in srgb, var(--color-secondary) 50%, var(--color-border));
                background: color-mix(in srgb, var(--color-primary) 22%, var(--color-surface));
            }

            :host-context([data-theme='dark']) .checkbox input:checked {
                background: var(--color-secondary);
                border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
            }

            :host-context([data-theme='dark']) .checkbox input:checked::after {
                border-color: var(--color-on-secondary);
            }

            .checkbox[aria-disabled='true'] {
                cursor: default;
                opacity: 0.85;
            }

            .nested {
                margin-left: 28px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            /* Align under the label text (checkbox 18px + gap 10px). */
            .nested > .hint {
                margin-left: 28px;
            }

            .hint {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                line-height: 1.4;
            }

            :host-context([data-theme='dark']) .hint {
                color: color-mix(in srgb, var(--color-text-secondary) 70%, #fff);
            }

            .readonly {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            code {
                font-size: 0.8em;
            }
        `;
    }

    static get properties() {
        return {
            useFullSlicer: { type: Boolean },
            useSimplifiedViewer: { type: Boolean },
            canEdit: { type: Boolean },
            disabled: { type: Boolean },
            showComposeHint: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.useFullSlicer = false;
        this.useSimplifiedViewer = false;
        this.canEdit = true;
        this.disabled = false;
        this.showComposeHint = true;
    }

    get normalized() {
        return normalizeLocalSlicerViewerOptions({
            useFullSlicer: this.useFullSlicer,
            useSimplifiedViewer: this.useSimplifiedViewer
        });
    }

    emitChange(patch) {
        const detail = normalizeLocalSlicerViewerOptions({
            ...this.normalized,
            ...patch
        });
        this.dispatchEvent(new CustomEvent('options-change', {
            detail,
            bubbles: true,
            composed: true
        }));
    }

    handleFullSlicerChange(event) {
        this.emitChange({
            useFullSlicer: event.target.checked,
            // Turning Full Slicer off also clears simplified viewer.
            useSimplifiedViewer: event.target.checked ? this.useSimplifiedViewer : false
        });
    }

    handleSimplifiedViewerChange(event) {
        this.emitChange({
            useFullSlicer: true,
            useSimplifiedViewer: event.target.checked
        });
    }

    renderEditable() {
        const { useFullSlicer, useSimplifiedViewer } = this.normalized;
        return html`
            <div class="options">
                <label class="checkbox">
                    <input
                        type="checkbox"
                        .checked=${useFullSlicer}
                        ?disabled=${this.disabled}
                        @change=${(e) => this.handleFullSlicerChange(e)}
                    />
                    ${t('viewers.useFullSlicer')}
                </label>
                ${useFullSlicer ? html`
                    <div class="nested">
                        <label class="checkbox">
                            <input
                                type="checkbox"
                                .checked=${useSimplifiedViewer}
                                ?disabled=${this.disabled}
                                @change=${(e) => this.handleSimplifiedViewerChange(e)}
                            />
                            ${t('viewers.useSimplifiedViewer')}
                        </label>
                        <div class="hint">
                            ${t('viewers.simplifiedHint')}
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderReadonly() {
        const { useFullSlicer, useSimplifiedViewer } = this.normalized;
        let summary = t('viewers.localTrame');
        if (useFullSlicer && useSimplifiedViewer) {
            summary = t('viewers.readonlySimplified');
        } else if (useFullSlicer) {
            summary = t('viewers.readonlyFull');
        }

        return html`
            <div class="options">
                <div class="readonly">${summary}</div>
                ${this.showComposeHint && useFullSlicer ? html`
                    <div class="hint">
                    </div>
                ` : ''}
            </div>
        `;
    }

    render() {
        return this.canEdit ? this.renderEditable() : this.renderReadonly();
    }
}

customElements.define('local-slicer-viewer-options', LocalSlicerViewerOptions);
