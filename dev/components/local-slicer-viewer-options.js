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

            /* The browser's own checkbox, as everywhere else (user-settings-page .checkbox-row). */
            .checkbox input {
                margin: 2px 0 0;
                flex-shrink: 0;
                width: 16px;
                height: 16px;
                cursor: pointer;
            }

            .checkbox input:disabled {
                cursor: not-allowed;
            }

            .checkbox[aria-disabled='true'] {
                cursor: default;
                opacity: 0.85;
            }

            .nested {
                margin-left: 26px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            /* Align under the label text (checkbox 16px + gap 10px). */
            .nested > .hint {
                margin-left: 26px;
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
