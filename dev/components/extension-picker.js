import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { loadExtensionCatalog } from '../services/workflows.js';
import { filterByText } from '../utils/listSort.js';
import { extensionIcon, iconTileStyles } from '../utils/iconTile.js';
import './list-filter-tools.js';

const SHOW_OPTIONS = Object.freeze([
    Object.freeze({ value: 'all', label: t('workflows.showAll') }),
    Object.freeze({ value: 'selected-first', label: t('workflows.showSelectedFirst') }),
    Object.freeze({ value: 'selected', label: t('workflows.showSelected') }),
]);

/**
 * Checklist of the extensions this SlicerWeb build ships. Search and "Show" (all, selected first,
 * selected only) sit behind the usual <list-filter-tools> icons. Selected names the build doesn't
 * have are listed first and flagged. Emits `extensions-change` with { extensions }.
 */
export class ExtensionPicker extends LitElement {
    static get properties() {
        return {
            selected: { type: Array },
            channel: { type: String },
            catalog: { state: true },
            query: { state: true },
            show: { state: true },
        };
    }

    static get styles() {
        return [iconTileStyles, css`
            :host { display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem; }
            .bar { display: flex; gap: 12px; align-items: center; justify-content: space-between; min-height: 32px; }
            .summary { color: var(--color-text-secondary); font-size: 0.85rem; }
            ul {
                list-style: none; margin: 0; padding: 4px 0; max-height: 320px; overflow-y: auto;
                border: 1px solid var(--color-border); border-radius: 6px; background: var(--color-panel, #fff);
            }
            :host-context([data-theme='dark']) ul { background: var(--color-background); }
            li label { display: flex; gap: 10px; align-items: flex-start; padding: 7px 12px; cursor: pointer; }
            li label:hover { background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
            input[type='checkbox'] { margin-top: 3px; accent-color: var(--color-primary); flex-shrink: 0; }
            .name { font-weight: 600; }
            .category, .desc, .note { color: var(--color-text-secondary); font-size: 0.8rem; }
            .desc { display: block; }
            .note { padding: 8px 12px; }
            .missing .name { color: var(--color-status-error-fg, #8a1212); }
            li .icon-tile { --icon-tile-size: 28px; }
        `];
    }

    constructor() {
        super();
        this.selected = [];
        this.channel = 'stable';
        this.catalog = null;
        this.query = '';
        this.show = 'all';
    }

    connectedCallback() {
        super.connectedCallback();
        loadExtensionCatalog(this.channel).then((c) => { this.catalog = c; }, () => { this.catalog = []; });
    }

    _toggle(name, on) {
        const rest = this.selected.filter((n) => n !== name);
        this.dispatchEvent(new CustomEvent('extensions-change', {
            detail: { extensions: on ? [...rest, name] : rest },
            bubbles: true,
            composed: true,
        }));
    }

    _rows() {
        const known = new Set(this.catalog.map((e) => e.name));
        const isSelected = (e) => this.selected.includes(e.name);
        const missing = this.selected.filter((n) => !known.has(n))
            .map((name) => ({ name, description: t('workflows.notInBuild'), category: '', missing: true }));
        let rows = filterByText([...missing, ...this.catalog], this.query, (e) => [e.name, e.description, e.category]);
        if (this.show === 'selected') rows = rows.filter(isSelected);
        if (this.show === 'selected-first') rows = [...rows.filter(isSelected), ...rows.filter((e) => !isSelected(e))];
        return rows;
    }

    render() {
        if (this.catalog === null) return html`<span class="note">${t('common.loading')}</span>`;
        if (!this.catalog.length) return html`<span class="note">${t('workflows.catalogUnavailable')}</span>`;
        const rows = this._rows();
        return html`
            <div class="bar">
                <span class="summary">${t('workflows.selectedCount', { count: this.selected.length })}</span>
                <list-filter-tools
                    .searchQuery=${this.query}
                    .sortOrder=${this.show}
                    .sortOptions=${SHOW_OPTIONS}
                    searchLabel=${t('workflows.filterExtensions')}
                    searchPlaceholder=${t('workflows.filterExtensions')}
                    sortLabel=${t('workflows.show')}
                    sortHeading=${t('workflows.show')}
                    @search-change=${(e) => { this.query = e.detail.query; }}
                    @sort-change=${(e) => { this.show = e.detail.order; }}
                ></list-filter-tools>
            </div>
            <ul role="group" aria-label=${t('workflows.extensions')}>
                ${rows.map((e) => html`
                    <li class=${e.missing ? 'missing' : ''}>
                        <label>
                            <input type="checkbox" .checked=${this.selected.includes(e.name)}
                                @change=${(ev) => this._toggle(e.name, ev.target.checked)} />
                            ${extensionIcon(e.name, this.channel)}
                            <span>
                                <span class="name">${e.name}</span>
                                ${e.category ? html` <span class="category">· ${e.category}</span>` : ''}
                                ${e.description ? html`<span class="desc">${e.description}</span>` : ''}
                            </span>
                        </label>
                    </li>
                `)}
                ${rows.length ? '' : html`<li class="note">${t('workflows.noExtensions')}</li>`}
            </ul>
        `;
    }
}

customElements.define('extension-picker', ExtensionPicker);
