import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * Icon → popover search + sort controls for list/toolbars.
 *
 * Properties:
 *   searchQuery, sortOrder, sortOptions: [{ value, label, ariaLabel? }]
 *   showSearch, showSort
 *   searchLabel, sortLabel, searchPlaceholder, searchHeading, sortHeading
 *
 * Events:
 *   search-change — detail: { query }
 *   sort-change — detail: { order }
 */
export class ListFilterTools extends LitElement {
    static get styles() {
        return css`
            :host {
                display: inline-flex;
                align-items: center;
                gap: 6px;
                flex-shrink: 0;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .tool {
                position: relative;
                flex-shrink: 0;
            }

            .tool-trigger {
                border: 1px solid var(--color-border);
                border-radius: 6px;
                background: var(--color-panel, #fff);
                color: var(--color-text-secondary);
                width: 32px;
                height: 30px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .tool-trigger:hover {
                color: var(--color-primary);
                border-color: color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
                background: color-mix(in srgb, var(--color-primary) 8%, var(--color-panel, #fff));
            }

            .tool-trigger:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
                color: var(--color-primary);
            }

            .tool-trigger[aria-expanded='true'],
            .tool-trigger.is-active {
                color: var(--color-primary);
                border-color: color-mix(in srgb, var(--color-secondary) 55%, var(--color-border));
                background: color-mix(in srgb, var(--color-secondary) 12%, var(--color-panel, #fff));
            }

            .tool-trigger svg {
                display: block;
            }

            .tool-menu {
                position: absolute;
                top: calc(100% + 6px);
                right: 0;
                z-index: 20;
                min-width: 220px;
                padding: 6px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 6px);
                background: var(--color-panel, #fff);
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
                box-sizing: border-box;
            }

            .tool-heading {
                margin: 0;
                padding: 6px 10px 8px;
                font-size: 0.68rem;
                font-weight: 700;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                color: var(--color-text-secondary);
            }

            .sort-item {
                display: grid;
                grid-template-columns: 18px minmax(0, 1fr);
                align-items: center;
                gap: 8px;
                width: 100%;
                border: none;
                border-radius: var(--radius-sm, 4px);
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-size: 0.875rem;
                font-weight: 500;
                text-align: left;
                padding: 8px 10px;
                cursor: pointer;
                box-sizing: border-box;
            }

            .sort-item:hover,
            .sort-item:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
                outline: none;
            }

            .sort-item[aria-checked='true'] {
                color: var(--color-primary);
                background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
            }

            .sort-check {
                width: 18px;
                height: 18px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
            }

            .sort-check svg {
                display: block;
            }

            .search-row {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 6px;
                align-items: center;
                padding: 4px 4px 6px;
            }

            .search-input {
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm, 4px);
                padding: 8px 10px;
                font: inherit;
                font-size: 0.875rem;
                color: var(--color-text-primary);
                background: var(--color-background);
            }

            .search-input:focus-visible {
                outline: none;
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
            }

            .search-clear {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm, 4px);
                background: transparent;
                color: var(--color-text-secondary);
                min-height: 34px;
                padding: 0 10px;
                font: inherit;
                font-size: 0.8rem;
                font-weight: 600;
                cursor: pointer;
            }

            .search-clear:hover:not(:disabled),
            .search-clear:focus-visible {
                color: var(--color-primary);
                border-color: color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
                outline: none;
            }

            .search-clear:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            :host-context([data-theme='dark']) .tool-trigger {
                background: var(--color-panel);
            }

            :host-context([data-theme='dark']) .tool-trigger[aria-expanded='true'],
            :host-context([data-theme='dark']) .tool-trigger.is-active {
                background: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel));
                border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
                color: var(--color-text-primary);
            }

            :host-context([data-theme='dark']) .tool-menu {
                background: var(--color-panel);
                box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
            }

            :host-context([data-theme='dark']) .sort-item[aria-checked='true'] {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-accent) 16%, transparent);
            }

            :host-context([data-theme='dark']) .search-input {
                background: var(--color-background);
                border-color: var(--color-border);
                color: var(--color-text-primary);
            }
        `;
    }

    static get properties() {
        return {
            searchQuery: { type: String },
            sortOrder: { type: String },
            sortOptions: { type: Array },
            showSearch: { type: Boolean },
            showSort: { type: Boolean },
            searchLabel: { type: String },
            sortLabel: { type: String },
            searchPlaceholder: { type: String },
            searchHeading: { type: String },
            sortHeading: { type: String },
            searchOpen: { type: Boolean },
            sortOpen: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.searchQuery = '';
        this.sortOrder = '';
        this.sortOptions = [];
        this.showSearch = true;
        this.showSort = true;
        this.searchLabel = 'Search';
        this.sortLabel = 'Sort';
        this.searchPlaceholder = 'Filter by name…';
        this.searchHeading = 'Search';
        this.sortHeading = 'Sort by';
        this.searchOpen = false;
        this.sortOpen = false;
        this._outsideHandler = null;
        this._keyHandler = null;
        this._bindTimer = null;
    }

    get menusOpen() {
        return this.searchOpen || this.sortOpen;
    }

    get selectedSortOption() {
        const options = Array.isArray(this.sortOptions) ? this.sortOptions : [];
        return options.find((opt) => opt.value === this.sortOrder) || null;
    }

    disconnectedCallback() {
        this.closeMenus();
        super.disconnectedCallback();
    }

    closeMenus() {
        this.searchOpen = false;
        this.sortOpen = false;
        this._unbindDismiss();
    }

    emitSearch(query) {
        this.dispatchEvent(new CustomEvent('search-change', {
            detail: { query: String(query || '') },
            bubbles: true,
            composed: true
        }));
    }

    emitSort(order) {
        this.dispatchEvent(new CustomEvent('sort-change', {
            detail: { order: String(order || '') },
            bubbles: true,
            composed: true
        }));
    }

    handleSearchInput(event) {
        this.emitSearch(event?.target?.value || '');
    }

    clearSearch() {
        this.emitSearch('');
        requestAnimationFrame(() => {
            this.renderRoot?.querySelector('.search-input')?.focus?.();
        });
    }

    setSortOrder(order) {
        const options = Array.isArray(this.sortOptions) ? this.sortOptions : [];
        if (!options.some((opt) => opt.value === order)) return;
        this.emitSort(order);
        this.closeSortMenu();
    }

    toggleSearchMenu(event) {
        event?.stopPropagation?.();
        if (this.searchOpen) {
            this.closeSearchMenu();
            return;
        }
        this.closeSortMenu({ keepListeners: true });
        this.openSearchMenu();
    }

    toggleSortMenu(event) {
        event?.stopPropagation?.();
        if (this.sortOpen) {
            this.closeSortMenu();
            return;
        }
        this.closeSearchMenu({ keepListeners: true });
        this.openSortMenu();
    }

    openSearchMenu() {
        this.searchOpen = true;
        this._bindDismiss();
        requestAnimationFrame(() => {
            this.renderRoot?.querySelector('.search-input')?.focus?.();
        });
    }

    openSortMenu() {
        this.sortOpen = true;
        this._bindDismiss();
        requestAnimationFrame(() => {
            this.renderRoot?.querySelector('.sort-item')?.focus?.();
        });
    }

    closeSearchMenu({ keepListeners = false } = {}) {
        this.searchOpen = false;
        if (!keepListeners && !this.menusOpen) this._unbindDismiss();
    }

    closeSortMenu({ keepListeners = false } = {}) {
        this.sortOpen = false;
        if (!keepListeners && !this.menusOpen) this._unbindDismiss();
    }

    _bindDismiss() {
        this._unbindDismiss();
        this._outsideHandler = (event) => {
            const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
            if (path.includes(this) || this.contains(event.target)) return;
            this.closeMenus();
        };
        this._keyHandler = (event) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            const returnToSearch = this.searchOpen;
            const returnToSort = this.sortOpen;
            this.closeMenus();
            if (returnToSearch) {
                this.renderRoot?.querySelector('.search-trigger')?.focus?.();
            } else if (returnToSort) {
                this.renderRoot?.querySelector('.sort-trigger')?.focus?.();
            }
        };
        this._bindTimer = setTimeout(() => {
            this._bindTimer = null;
            if (!this.menusOpen) return;
            document.addEventListener('pointerdown', this._outsideHandler, true);
            document.addEventListener('keydown', this._keyHandler, true);
        }, 0);
    }

    _unbindDismiss() {
        if (this._bindTimer) {
            clearTimeout(this._bindTimer);
            this._bindTimer = null;
        }
        if (this._outsideHandler) {
            document.removeEventListener('pointerdown', this._outsideHandler, true);
            this._outsideHandler = null;
        }
        if (this._keyHandler) {
            document.removeEventListener('keydown', this._keyHandler, true);
            this._keyHandler = null;
        }
    }

    renderSearch() {
        if (!this.showSearch) return '';
        const query = String(this.searchQuery || '').trim();
        const active = !!query;
        const label = this.searchLabel || 'Search';
        return html`
            <div class="tool">
                <button
                    class="tool-trigger search-trigger ${active ? 'is-active' : ''}"
                    type="button"
                    title=${active ? `${label}: ${query}` : label}
                    aria-label=${active ? `${label}. Current query: ${query}` : label}
                    aria-haspopup="dialog"
                    aria-expanded=${this.searchOpen ? 'true' : 'false'}
                    aria-controls="list-filter-search-menu"
                    @click=${(e) => this.toggleSearchMenu(e)}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/>
                    </svg>
                </button>
                ${this.searchOpen ? html`
                    <div
                        id="list-filter-search-menu"
                        class="tool-menu"
                        role="dialog"
                        aria-label=${label}
                    >
                        <p class="tool-heading">${this.searchHeading || 'Search'}</p>
                        <div class="search-row">
                            <input
                                class="search-input"
                                type="search"
                                placeholder=${this.searchPlaceholder || 'Filter by name…'}
                                autocomplete="off"
                                spellcheck="false"
                                .value=${this.searchQuery || ''}
                                @input=${(e) => this.handleSearchInput(e)}
                                aria-label=${label}
                            />
                            <button
                                class="search-clear"
                                type="button"
                                ?disabled=${!active}
                                @click=${() => this.clearSearch()}
                            >Clear</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderSort() {
        if (!this.showSort) return '';
        const options = Array.isArray(this.sortOptions) ? this.sortOptions : [];
        if (!options.length) return '';
        const selected = this.selectedSortOption;
        const label = this.sortLabel || 'Sort';
        return html`
            <div class="tool">
                <button
                    class="tool-trigger sort-trigger"
                    type="button"
                    title=${selected ? `${label}: ${selected.label}` : label}
                    aria-label=${selected ? `${label}. Current: ${selected.label}` : label}
                    aria-haspopup="menu"
                    aria-expanded=${this.sortOpen ? 'true' : 'false'}
                    aria-controls="list-filter-sort-menu"
                    @click=${(e) => this.toggleSortMenu(e)}
                >
                    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                        <path fill="currentColor" d="M4.25 5.61C6.27 8.2 10 13 10 13v6c0 .55.45 1 1 1h2c.55 0 1-.45 1-1v-6s3.72-4.8 5.74-7.39c.51-.66.04-1.61-.79-1.61H5.04c-.83 0-1.3.95-.79 1.61z"/>
                    </svg>
                </button>
                ${this.sortOpen ? html`
                    <div
                        id="list-filter-sort-menu"
                        class="tool-menu"
                        role="menu"
                        aria-label=${this.sortHeading || 'Sort by'}
                    >
                        <p class="tool-heading">${this.sortHeading || 'Sort by'}</p>
                        ${options.map((opt) => {
                            const checked = this.sortOrder === opt.value;
                            return html`
                                <button
                                    class="sort-item"
                                    type="button"
                                    role="menuitemradio"
                                    aria-checked=${checked ? 'true' : 'false'}
                                    aria-label=${opt.ariaLabel || opt.label}
                                    @click=${() => this.setSortOrder(opt.value)}
                                >
                                    <span class="sort-check" aria-hidden="true">
                                        ${checked ? html`
                                            <svg width="14" height="14" viewBox="0 0 24 24" focusable="false">
                                                <path fill="currentColor" d="M9.55 18.2 4.4 13.05l1.4-1.4 3.75 3.75 8.65-8.65 1.4 1.4z"/>
                                            </svg>
                                        ` : ''}
                                    </span>
                                    <span>${opt.label}</span>
                                </button>
                            `;
                        })}
                    </div>
                ` : ''}
            </div>
        `;
    }

    render() {
        return html`
            ${this.renderSearch()}
            ${this.renderSort()}
        `;
    }
}

customElements.define('list-filter-tools', ListFilterTools);
