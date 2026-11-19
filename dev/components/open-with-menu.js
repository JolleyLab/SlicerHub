import { html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { PopupMenu } from './popup-menu.js';
import { VIEWER_NAME_KEY, viewerKey, shortList } from '../utils/openWith.js';
import { iconTile, iconTileStyles } from '../utils/iconTile.js';

/** What the open panel shows. */
const VIEW = Object.freeze({ GRID: 'grid', LIST: 'list' });

const ICON_CHEVRON = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4z"/>
    </svg>`;

/**
 * Open ▾ for a case file or the blank viewer: the plain viewers, the usable workflows (`usable`,
 * from utils/openWith.js), and "More workflows…" when they don't all fit.
 * `grid` (file rows): a bare chevron opening an icon grid; "All options…" shows the list instead.
 * Emits `open-workflow` { key } and `more-workflows`.
 */
export class OpenWithMenu extends PopupMenu {
    static get styles() {
        return [PopupMenu.triggerStyles, css`
            .trigger { max-width: 220px; }

            /* With buttonLabel: a whole secondary button (styles/buttons.js) that opens the menu. */
            .trigger.as-button {
                height: auto;
                max-width: none;
                gap: 6px;
                padding: 8px 12px 8px 18px;
                color: var(--color-text-primary);
                border: 1px solid var(--color-border);
                border-radius: 6px;
                font-size: 0.875rem;
                font-weight: 600;
                line-height: 1.2;
                white-space: nowrap;
            }

            .trigger.as-button:hover:not(:disabled),
            .trigger.as-button[aria-expanded='true'] {
                background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface, var(--color-background)));
                border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
            }
        `];
    }

    static get portalStyleId() { return 'open-with-menu-portal-styles'; }

    static get portalCss() {
        return `
.popup-menu-panel.open-with { min-width: 240px; }
.popup-menu-panel.open-with .tiles {
  display: grid;
  grid-template-columns: repeat(4, 48px);
  gap: 4px;
  padding: 4px 8px;
}
.popup-menu-panel.open-with .tile {
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  padding: 0;
  border: 2px solid transparent;
  border-radius: var(--radius-md, 6px);
  background: transparent;
  color: inherit;
  font: inherit;
  cursor: pointer;
}
/* Name tooltip on hover and focus (title doesn't show on focus). */
.popup-menu-panel.open-with .tile::after {
  content: attr(data-name);
  position: absolute;
  bottom: calc(100% + 4px);
  left: 50%;
  transform: translateX(-50%);
  width: max-content;
  max-width: 200px;
  padding: 3px 6px;
  border-radius: 4px;
  background: var(--color-text-primary, #1a1a1a);
  color: var(--color-panel, #fff);
  font-size: 0.72rem;
  line-height: 1.3;
  text-align: center;
  pointer-events: none;
  opacity: 0;
  z-index: 1;
}
.popup-menu-panel.open-with .tile:hover::after,
.popup-menu-panel.open-with .tile:focus-visible::after { opacity: 1; }
.popup-menu-panel.open-with .tile:hover,
.popup-menu-panel.open-with .tile:focus-visible {
  background: color-mix(in srgb, var(--color-primary, #3366cc) 10%, transparent);
  outline: none;
}
.popup-menu-panel.open-with .tile[aria-checked='true'] { border-color: var(--color-focus, #0057c2); }
.popup-menu-panel.open-with .tile:focus-visible { border-color: var(--color-text-primary, #1a1a1a); }
.popup-menu-panel.open-with .tile .icon-tile { --icon-tile-size: 32px; }
${iconTileStyles.cssText}
.popup-menu-panel.open-with .more { color: var(--color-text-secondary, #666); }
`;
    }

    static get contentProperties() { return ['usable', 'selectedKey', '_view']; }

    static get properties() {
        return {
            ...super.properties,
            /** Show as a labelled button that only opens the menu (the blank viewer), instead of a bare chevron (file rows). */
            buttonLabel: { type: String },
            /** The attachment this menu belongs to; makes the button's accessible name specific. */
            fileName: { type: String },
            /** { viewers, caseWorkflows, mine } from usableWorkflows(): what can open it. */
            usable: { attribute: false },
            /** What the main button opens (a key; checked in the menu). */
            selectedKey: { type: String },
            /** What it opens with, for the button's tooltip ("SlicerHeart · SlicerWeb"). */
            label: { type: String },
            /** Icon grid behind a bare chevron (file rows). */
            grid: { type: Boolean },
            /** VIEW; resets to the grid on close. */
            _view: { attribute: false },
        };
    }

    constructor() {
        super();
        this.fileName = '';
        this.buttonLabel = '';
        this.usable = null;
        this.selectedKey = '';
        this.label = '';
        this.grid = false;
        this._view = VIEW.GRID;
    }

    get showingGrid() {
        return this.grid && this._view === VIEW.GRID;
    }

    updated(changed) {
        super.updated(changed);
        if (this.open && !changed.has('open') && changed.has('_view')) this.focusOnOpen();
        if (changed.has('open') && !this.open) this._view = VIEW.GRID;
    }

    /** Focus the checked workflow choice (so Enter opens with it), else the first item. */
    focusOnOpen() {
        const checked = this._menuContainer?.querySelector('[data-choice][aria-checked="true"]');
        if (checked) checked.focus();
        else this.focusMenuItem(0);
    }

    menuLabel() { return t('viewers.openWith'); }

    panelClass() { return 'open-with'; }

    /** Second line: its viewer, then the description's first line, else where it starts. */
    entryHint(entry) {
        const description = (entry.description || '').split('\n')[0].trim();
        const detail = description || (entry.startupConfig?.module ? t('viewers.startsIn', { module: entry.startupConfig.module }) : '');
        return [t(VIEWER_NAME_KEY[entry.viewer]), detail].filter(Boolean).join(' · ');
    }

    /** What's offered, the workflows cut to the short list: { viewers, caseWorkflows, mine, hidden }. */
    choices() {
        const usable = this.usable || { viewers: [], caseWorkflows: [], mine: [] };
        return { viewers: usable.viewers || [], ...shortList(usable, this.selectedKey) };
    }

    itemTemplate(key, name, hint) {
        const selected = key === this.selectedKey;
        return html`
            <button class="item" type="button" role="menuitemradio" data-choice aria-checked=${selected ? 'true' : 'false'} tabindex="-1"
                @click=${() => this.closeAndEmit('open-workflow', { key })}>
                <span class="check ${selected ? '' : 'is-empty'}" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${name}
                    ${hint ? html`<span class="hint">${hint}</span>` : ''}
                </span>
            </button>
        `;
    }

    tileTemplate(key, name, iconName, iconSrc) {
        const selected = key === this.selectedKey;
        return html`
            <button class="tile" type="button" role="menuitemradio" data-choice aria-checked=${selected ? 'true' : 'false'} tabindex="-1"
                aria-label=${name} data-name=${name} @click=${() => this.closeAndEmit('open-workflow', { key })}>
                ${iconTile(iconName, iconSrc)}
            </button>
        `;
    }

    gridContent() {
        const list = this.choices();
        return html`
            <div class="tiles">
                ${list.viewers.map((v) => this.tileTemplate(viewerKey(v), t(VIEWER_NAME_KEY[v]), t(VIEWER_NAME_KEY[v]), null))}
                ${[...list.caseWorkflows, ...list.mine].map((e) => this.tileTemplate(e.key, `${e.name} · ${t(VIEWER_NAME_KEY[e.viewer])}`, e.name, e.iconUrl))}
                ${list.hidden ? html`
                    <button class="tile" type="button" role="menuitem" tabindex="-1"
                        aria-label=${t('viewers.moreWorkflows', { count: list.hidden })} data-name=${t('viewers.moreWorkflows', { count: list.hidden })}
                        @click=${() => this.closeAndEmit('more-workflows')}>
                        <span class="icon-tile" aria-hidden="true">⋯</span>
                    </button>
                ` : ''}
            </div>
            <div class="divider" role="separator"></div>
            <button class="item" type="button" role="menuitem" tabindex="-1" @click=${() => { this._view = VIEW.LIST; }}>
                <span class="item-label">${t('viewers.allOptions')}</span>
            </button>
        `;
    }

    menuContent() {
        if (this.showingGrid) return this.gridContent();
        const list = this.choices();
        const section = (headingKey, entries) => (entries.length ? html`
            <div role="group" aria-label=${t(headingKey)}>
                <div class="heading" aria-hidden="true">${t(headingKey)}</div>
                ${entries.map((e) => this.itemTemplate(e.key, e.name, this.entryHint(e)))}
            </div>
        ` : '');
        return html`
            ${list.viewers.map((v) => this.itemTemplate(viewerKey(v), t(VIEWER_NAME_KEY[v]), t('viewers.noWorkflow')))}
            ${section('viewers.thisCase', list.caseWorkflows)}
            ${section('viewers.mine', list.mine)}
            ${list.hidden ? html`
                <button class="item more" type="button" role="menuitem" tabindex="-1" @click=${() => this.closeAndEmit('more-workflows')}>
                    <span class="check is-empty" aria-hidden="true">✓</span>
                    <span class="item-label">${t('viewers.moreWorkflows', { count: list.hidden })}</span>
                </button>
            ` : ''}
        `;
    }

    triggerLabel() {
        return this.fileName
            ? t('viewers.openWithNamed', { name: this.fileName })
            : t('viewers.openWith');
    }

    render() {
        return html`
            <button
                class="trigger ${this.buttonLabel ? 'as-button' : ''}"
                type="button"
                title=${this.label ? `${this.triggerLabel()} (${this.label})` : this.triggerLabel()}
                aria-label=${this.buttonLabel || this.triggerLabel()}
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
                @keydown=${(e) => this.onTriggerKeydown(e)}
            >
                ${this.buttonLabel}
                ${ICON_CHEVRON}
            </button>
        `;
    }
}

customElements.define('open-with-menu', OpenWithMenu);
