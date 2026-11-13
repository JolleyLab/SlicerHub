import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import { filterByText } from '../utils/listSort.js';
import './app-dialog.js';

/**
 * "More workflows…" from an Open ▾ menu: every workflow that can open this file in this viewer
 * (the same `usable` list the menu shortens), with a search box. Choosing one opens the file.
 * Call open({ title, usable, selectedKey }); emits `open-workflow` with { key }.
 */
export class MoreWorkflowsDialog extends LitElement {
    static get properties() {
        return {
            heading: { state: true },
            usable: { state: true },
            selectedKey: { state: true },
            query: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            .search { width: 100%; }
            .results { max-height: min(55vh, 460px); overflow-y: auto; }
            .pick { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; width: 100%;
                text-align: left; background: transparent; border: 1px solid var(--color-border);
                border-radius: var(--radius-sm, 6px); padding: 8px 10px; cursor: pointer; font: inherit; color: inherit; }
            .pick:hover, .pick:focus-visible { background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
            .pick[aria-current='true'] { border-color: var(--color-focus); }
        `];
    }

    constructor() {
        super();
        this.heading = '';
        this.usable = { caseWorkflows: [], mine: [] };
        this.selectedKey = '';
        this.query = '';
    }

    open({ title, usable, selectedKey }) {
        Object.assign(this, { heading: title, usable, selectedKey, query: '' });
        this.renderRoot?.querySelector('app-dialog')?.openDialog();
    }

    _pick(key) {
        this.renderRoot?.querySelector('app-dialog')?.closeDialog();
        this.dispatchEvent(new CustomEvent('open-workflow', { detail: { key }, bubbles: true, composed: true }));
    }

    _section(headingKey, entries) {
        const shown = filterByText(entries, this.query, (e) => [e.name, e.description]);
        if (!shown.length) return '';
        return html`
            <h4>${t(headingKey)}</h4>
            <ul class="list">${shown.map((e) => html`
                <li>
                    <button class="pick" type="button" aria-current=${e.key === this.selectedKey ? 'true' : 'false'}
                        @click=${() => this._pick(e.key)}>
                        <span class="item-name">${e.name}</span>
                        ${e.description ? html`<span class="muted">${e.description.split('\n')[0]}</span>` : ''}
                    </button>
                </li>`)}
            </ul>
        `;
    }

    render() {
        const sections = [this._section('viewers.thisCase', this.usable.caseWorkflows), this._section('viewers.mine', this.usable.mine)];
        return html`
            <app-dialog title=${this.heading}>
                <div class="stack">
                    <input class="search" type="text" .value=${this.query}
                        placeholder=${t('workflows.filterPlaceholder')} aria-label=${t('workflows.searchAria')}
                        @input=${(e) => { this.query = e.target.value; }} />
                    <div class="results">
                        ${sections.some(Boolean) ? sections : html`<span class="muted">${t('workflows.noMatch', { query: this.query })}</span>`}
                    </div>
                </div>
            </app-dialog>
        `;
    }
}

customElements.define('more-workflows-dialog', MoreWorkflowsDialog);
