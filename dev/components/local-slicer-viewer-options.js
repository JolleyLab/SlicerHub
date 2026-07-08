import { LitElement, html, css } from 'lit-element';
import {
    normalizeLocalSlicerViewerOptions
} from '../utils/localSlicerViewerOptions.js';

/**
 * Reusable Local Full Slicer preference checkboxes.
 * Emits `options-change` with { useFullSlicer, useSimplifiedViewer }.
 * Intended for project GPU panel now and user/project settings later.
 */
export class LocalSlicerViewerOptions extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .options {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
                cursor: pointer;
            }

            .checkbox input {
                margin: 0;
            }

            .checkbox[aria-disabled='true'] {
                cursor: default;
                opacity: 0.85;
            }

            .nested {
                margin-left: 24px;
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .hint {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
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
                    Use Full Slicer
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
                            Use Simplified Viewer
                        </label>
                        <div class="hint">
                            Opens Full Slicer with the Simplified Viewer UI instead of the full Slicer chrome.
                        </div>
                    </div>
                ` : ''}
                ${this.showComposeHint ? html`
                    <div class="hint">
                        Opens the standalone GPU Slicer container in a new browser tab.
                        Requires <code>docker compose --profile slicer-gui up -d slicer-gui</code>.
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderReadonly() {
        const { useFullSlicer, useSimplifiedViewer } = this.normalized;
        let summary = 'Local Trame viewer';
        if (useFullSlicer && useSimplifiedViewer) {
            summary = 'Full Slicer with Simplified Viewer (read-only) opens in a new tab.';
        } else if (useFullSlicer) {
            summary = 'Full Slicer viewer (read-only) opens in a new tab.';
        }

        return html`
            <div class="options">
                <div class="readonly">${summary}</div>
                ${this.showComposeHint && useFullSlicer ? html`
                    <div class="hint">
                        Requires <code>docker compose --profile slicer-gui up -d slicer-gui</code>.
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
