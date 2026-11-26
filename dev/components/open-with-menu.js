import { html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { PopupMenu } from './popup-menu.js';
import { VIEWER_NAME_KEY, viewerKey, shortList } from '../utils/openWith.js';
import { iconTile, iconTileStyles } from '../utils/iconTile.js';
import { ICON_MORE } from '../utils/icons.js';

/** What the open panel shows. */
const VIEW = Object.freeze({ GRID: 'grid', LIST: 'list' });

const ICON_CHEVRON = html`
    <svg part="chevron" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4z"/>
    </svg>`;

/**
 * Open ▾ for a case file or the blank viewer: the plain viewers, the usable workflows (`usable`,
 * from utils/openWith.js), and "More workflows…" when they don't all fit.
 * `grid` (file rows): a bare chevron opening an icon grid; "All options…" shows the list instead.
 * `canSetDefault`: also offer "Default for this file…". The button and its ▾ are exposed as ::part(trigger) and ::part(chevron).
 * `more` (phones): a ⋯ button instead, the file row's only one; `extraItems` [{ key, label, disabled? }] are the row's
 * other actions, listed last. `busy` (a file is opening): the open choices do nothing; the other actions still work.
 * Emits `open-workflow` { key }, `more-workflows`, `set-default` and `menu-select` { key } (an extra item).
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

            /* With more: a ⋯ button the size of overflow-menu's. */
            .trigger.as-more { width: 32px; height: 32px; padding: 0; }
            .trigger.as-more svg { width: 20px; height: 20px; }

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
.popup-menu-panel.open-with .tile[aria-disabled='true'] { opacity: 0.5; cursor: not-allowed; }
.popup-menu-panel.open-with .tile:focus-visible { border-color: var(--color-text-primary, #1a1a1a); }
.popup-menu-panel.open-with .tile .icon-tile { --icon-tile-size: 32px; }
/* Touch has no hover: name each tile under its icon instead of in a tooltip. */
.popup-menu-panel.open-with .tile-name { display: none; }
@media (hover: none) {
  .popup-menu-panel.open-with .tiles { grid-template-columns: repeat(3, 76px); }
  .popup-menu-panel.open-with .tile {
    flex-direction: column;
    gap: 4px;
    width: 76px;
    height: auto;
    min-height: 76px;
    padding: 6px 2px;
  }
  .popup-menu-panel.open-with .tile::after { display: none; }
  .popup-menu-panel.open-with .tile-name {
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
    overflow: hidden;
    max-width: 100%;
    font-size: 0.72rem;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
  }
}
${iconTileStyles.cssText}
.popup-menu-panel.open-with .more { color: var(--color-text-secondary, #666); }
`;
    }

    static get contentProperties() { return ['usable', 'selectedKey', 'extraItems', 'busy', '_view']; }

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
            /** Offer "Default for this file…" (its uploader or a case admin). */
            canSetDefault: { type: Boolean },
            /** Icon grid behind a bare chevron (file rows). */
            grid: { type: Boolean },
            /** A ⋯ button instead of the ▾, for a file row on a phone. */
            more: { type: Boolean },
            /** The row's other actions, listed last: [{ key, label, disabled? }]; picking one emits `menu-select`. */
            extraItems: { attribute: false },
            /** A file is opening: the open choices (viewers, toolkits, More…) show disabled. */
            busy: { type: Boolean },
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
        this.more = false;
        this.extraItems = [];
        this.busy = false;
        this.canSetDefault = false;
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

    /** Open with a choice (or the More… list), unless a file is already opening. */
    choose(type, detail = {}) {
        if (!this.busy) this.closeAndEmit(type, detail);
    }

    itemTemplate(key, name, hint) {
        const selected = key === this.selectedKey;
        return html`
            <button class="item" type="button" role="menuitemradio" data-choice aria-checked=${selected ? 'true' : 'false'} tabindex="-1"
                aria-disabled=${this.busy ? 'true' : 'false'} @click=${() => this.choose('open-workflow', { key })}>
                <span class="check ${selected ? '' : 'is-empty'}" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${name}
                    ${hint ? html`<span class="hint">${hint}</span>` : ''}
                </span>
            </button>
        `;
    }

    /** `name` is the full tooltip ("SlicerHeart · SlicerWeb"); `iconName` is the short name shown under the icon on touch screens. */
    tileTemplate(key, name, iconName, iconSrc) {
        const selected = key === this.selectedKey;
        return html`
            <button class="tile" type="button" role="menuitemradio" data-choice aria-checked=${selected ? 'true' : 'false'} tabindex="-1"
                aria-disabled=${this.busy ? 'true' : 'false'} aria-label=${name} data-name=${name}
                @click=${() => this.choose('open-workflow', { key })}>
                ${iconTile(iconName, iconSrc)}
                <span class="tile-name" aria-hidden="true">${iconName}</span>
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
                    <button class="tile" type="button" role="menuitem" tabindex="-1" aria-disabled=${this.busy ? 'true' : 'false'}
                        aria-label=${t('viewers.moreWorkflows', { count: list.hidden })} data-name=${t('viewers.moreWorkflows', { count: list.hidden })}
                        @click=${() => this.choose('more-workflows')}>
                        <span class="icon-tile" aria-hidden="true">⋯</span>
                        <span class="tile-name" aria-hidden="true">${t('viewers.moreWorkflowsShort', { count: list.hidden })}</span>
                    </button>
                ` : ''}
            </div>
            <div class="divider" role="separator"></div>
            <button class="item" type="button" role="menuitem" tabindex="-1" @click=${() => { this._view = VIEW.LIST; }}>
                <span class="item-label">${t('viewers.allOptions')}</span>
            </button>
            ${this.setDefaultItem()}
            ${this.extraItemsContent()}
        `;
    }

    /** The row's other actions (e.g. Download, Remove), below a divider; `inList` lines them up with the ✓ column. */
    extraItemsContent({ inList = false } = {}) {
        if (!this.extraItems?.length) return '';
        return html`
            <div class="divider" role="separator"></div>
            ${this.actionItemsTemplate(this.extraItems, { checkColumn: inList })}
        `;
    }

    /** "Default for this file…", below a divider; `inList` lines it up with the list's ✓ column. */
    setDefaultItem({ inList = false } = {}) {
        return this.canSetDefault ? html`
            ${inList ? html`<div class="divider" role="separator"></div>` : ''}
            <button class="item" type="button" role="menuitem" tabindex="-1" @click=${() => this.closeAndEmit('set-default')}>
                ${inList ? html`<span class="check is-empty" aria-hidden="true">✓</span>` : ''}
                <span class="item-label">${t('viewers.defaultForFile')}</span>
            </button>
        ` : '';
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
                <button class="item more" type="button" role="menuitem" tabindex="-1" aria-disabled=${this.busy ? 'true' : 'false'}
                    @click=${() => this.choose('more-workflows')}>
                    <span class="check is-empty" aria-hidden="true">✓</span>
                    <span class="item-label">${t('viewers.moreWorkflows', { count: list.hidden })}</span>
                </button>
            ` : ''}
            ${this.setDefaultItem({ inList: true })}
            ${this.extraItemsContent({ inList: true })}
        `;
    }

    triggerLabel() {
        if (this.more) return t('common.moreActionsFor', { name: this.fileName });
        return this.fileName
            ? t('viewers.openWithNamed', { name: this.fileName })
            : t('viewers.openWith');
    }

    render() {
        return html`
            <button
                class="trigger ${this.buttonLabel ? 'as-button' : ''} ${this.more ? 'as-more' : ''}"
                part="trigger"
                type="button"
                title=${this.label && !this.more ? `${this.triggerLabel()} (${this.label})` : this.triggerLabel()}
                aria-label=${this.buttonLabel || this.triggerLabel()}
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
                @keydown=${(e) => this.onTriggerKeydown(e)}
            >
                ${this.more ? ICON_MORE : html`${this.buttonLabel}${ICON_CHEVRON}`}
            </button>
        `;
    }
}

customElements.define('open-with-menu', OpenWithMenu);
