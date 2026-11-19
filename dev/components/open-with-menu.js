import { html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { PopupMenu } from './popup-menu.js';
import { VIEWER, NO_WORKFLOW, shortList } from '../utils/openWith.js';

const ICON_CHEVRON = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4z"/>
    </svg>`;

/**
 * Open ▾ for a case file or the blank viewer: "Open in" (files only), "No workflow", the usable
 * workflows (`usable`, from utils/openWith.js), and "More workflows…" when they don't all fit.
 * Emits `switch-viewer` { viewer }, `open-workflow` { key } and `more-workflows`.
 */
export class OpenWithMenu extends PopupMenu {
    static get styles() {
        return [PopupMenu.triggerStyles, css`
            .trigger { max-width: 220px; }

            .trigger-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-left: 4px;
            }

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
.popup-menu-panel.open-with .more { color: var(--color-text-secondary, #666); }
.popup-menu-panel.open-with .viewer-switch {
  display: flex;
  margin: 2px 12px 6px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}
.popup-menu-panel.open-with .viewer-switch .item {
  flex: 1;
  justify-content: center;
  padding: 5px 8px;
}
.popup-menu-panel.open-with .viewer-switch .item[aria-checked='true'] {
  background: var(--color-primary, #3366cc);
  color: var(--color-on-primary, #fff);
}
`;
    }

    static get contentProperties() { return ['viewer', 'usable', 'selectedKey']; }

    static get properties() {
        return {
            ...super.properties,
            /** Show as a labelled button that only opens the menu (the blank viewer), instead of a bare chevron (file rows). */
            buttonLabel: { type: String },
            /** The attachment this menu belongs to; makes the button's accessible name specific. */
            fileName: { type: String },
            /** The viewer this file opens in (VIEWER); `canSwitchViewer` shows "Open in" (files, not the blank viewer). */
            viewer: { type: String },
            canSwitchViewer: { type: Boolean },
            /** { caseWorkflows, mine } from usableWorkflows(): what can open it in that viewer. */
            usable: { attribute: false },
            /** What the main button opens: a workflow key, or NO_WORKFLOW (checked in the menu). */
            selectedKey: { type: String },
            /** Shown next to the chevron: what differs from the person's own viewer with no workflow. */
            label: { type: String },
            /** List "No workflow" first (true by default; off where only workflows are offered). */
            showNoWorkflow: { type: Boolean },
        };
    }

    constructor() {
        super();
        this.fileName = '';
        this.buttonLabel = '';
        this.viewer = VIEWER.SLICERWEB;
        this.canSwitchViewer = false;
        this.usable = null;
        this.selectedKey = NO_WORKFLOW;
        this.label = '';
        this.showNoWorkflow = true;
    }

    updated(changed) {
        super.updated(changed);
        // Switching the viewer keeps focus on the viewer now chosen.
        if (this.open && !changed.has('open') && changed.has('viewer')) this._menuContainer?.querySelector('[aria-checked="true"]')?.focus();
    }

    /** Focus the checked workflow choice (so Enter opens with it), else the first item. */
    focusOnOpen() {
        const checked = this._menuContainer?.querySelector('[data-choice][aria-checked="true"]');
        if (checked) checked.focus();
        else this.focusMenuItem(0);
    }

    menuLabel() { return t('viewers.openWith'); }

    panelClass() { return 'open-with'; }

    /** Second line: the description's first line, else where it starts. */
    entryHint(entry) {
        const description = (entry.description || '').split('\n')[0].trim();
        if (description) return description;
        return entry.startupConfig?.module ? t('viewers.startsIn', { module: entry.startupConfig.module }) : '';
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

    viewerSwitchTemplate() {
        const option = (viewer, nameKey) => html`
            <button class="item" type="button" role="menuitemradio" tabindex="-1"
                aria-checked=${this.viewer === viewer ? 'true' : 'false'}
                @click=${() => this.emit('switch-viewer', { viewer })}>${t(nameKey)}</button>
        `;
        return html`
            <div class="heading" id="open-in-heading">${t('viewers.openIn')}</div>
            <div class="viewer-switch" role="group" aria-labelledby="open-in-heading">
                ${option(VIEWER.SLICERWEB, 'viewers.slicerWeb')}
                ${option(VIEWER.FULL, 'viewers.fullSlicer')}
            </div>
            <div class="divider" role="separator"></div>
        `;
    }

    menuContent() {
        const list = shortList(this.usable || { caseWorkflows: [], mine: [] }, this.selectedKey);
        const viewerName = t(this.viewer === VIEWER.FULL ? 'viewers.fullSlicer' : 'viewers.slicerWeb');
        const section = (headingKey, entries) => (entries.length ? html`
            <div role="group" aria-label=${t(headingKey)}>
                <div class="heading" aria-hidden="true">${t(headingKey)}</div>
                ${entries.map((e) => this.itemTemplate(e.key, e.name, this.entryHint(e)))}
            </div>
        ` : '');
        return html`
            ${this.canSwitchViewer ? this.viewerSwitchTemplate() : ''}
            ${this.showNoWorkflow ? this.itemTemplate(NO_WORKFLOW, t('viewers.noWorkflow'), t('viewers.justViewer', { viewer: viewerName })) : ''}
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
                ${this.buttonLabel ? this.buttonLabel : this.label ? html`<span class="trigger-label">${this.label}</span>` : ''}
                ${ICON_CHEVRON}
            </button>
        `;
    }
}

customElements.define('open-with-menu', OpenWithMenu);
