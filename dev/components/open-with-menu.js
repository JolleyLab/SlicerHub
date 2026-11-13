import { LitElement, html, css } from 'lit-element';
import { render } from 'lit-html';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import { VIEWER, NO_WORKFLOW, shortList } from '../utils/openWith.js';

const MENU_MIN_WIDTH = 240;
const MENU_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
const PORTAL_STYLE_ID = 'open-with-menu-portal-styles';
/** Everything the arrow keys move between: choices are radios, "More workflows…" a plain item. */
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

const PORTAL_CSS = `
.open-with-menu-panel {
  position: fixed;
  z-index: 10000;
  min-width: ${MENU_MIN_WIDTH}px;
  max-width: min(280px, calc(100vw - 16px));
  padding: 4px 0;
  box-sizing: border-box;
  font-family: var(--font-family-base, system-ui, sans-serif);
  font-size: 0.875rem;
  color: var(--color-text-primary, #1a1a1a);
  background: var(--color-panel, #fff);
  border: 1px solid var(--color-border, #ccc);
  border-radius: var(--radius-md, 6px);
  box-shadow: 0 8px 22px rgba(0, 0, 0, 0.18);
}
.open-with-menu-panel .item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  border: none;
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  padding: 8px 12px;
  cursor: pointer;
  box-sizing: border-box;
}
.open-with-menu-panel .item:hover,
.open-with-menu-panel .item:focus-visible {
  background: color-mix(in srgb, var(--color-primary, #3366cc) 10%, transparent);
  outline: none;
}
.open-with-menu-panel .item-label { flex: 1; min-width: 0; }
.open-with-menu-panel .check {
  flex: 0 0 14px;
  width: 14px;
  color: var(--color-primary, #3366cc);
  font-size: 0.85rem;
  line-height: 1;
  text-align: center;
}
.open-with-menu-panel .check.is-empty { visibility: hidden; }
.open-with-menu-panel .hint {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.open-with-menu-panel .heading {
  padding: 8px 12px 2px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #666);
}
.open-with-menu-panel .divider {
  height: 1px;
  margin: 4px 0;
  background: var(--color-border, #ccc);
}
.open-with-menu-panel .more { color: var(--color-text-secondary, #666); }
.open-with-menu-panel .viewer-switch {
  display: flex;
  margin: 2px 12px 6px;
  border: 1px solid var(--color-border, #ccc);
  border-radius: var(--radius-md, 6px);
  overflow: hidden;
}
.open-with-menu-panel .viewer-switch .item {
  flex: 1;
  justify-content: center;
  padding: 5px 8px;
}
.open-with-menu-panel .viewer-switch .item[aria-checked='true'] {
  background: var(--color-primary, #3366cc);
  color: var(--color-on-primary, #fff);
}
`;

/**
 * Open ▾ for a case file or the blank viewer (docs/workflows-design.md › Opening a file):
 * "Open in" (the viewer, for files), "No workflow", then this case's workflows and mine, and
 * "More workflows…" when there are more than fit. Only what can be used right now is listed;
 * the page works that out with utils/openWith.js and passes it in as `usable`.
 * Emits `switch-viewer` with { viewer } (the menu stays open), `open-workflow` with { key }
 * (a workflow key or NO_WORKFLOW), and `more-workflows`.
 * The menu is portaled to document.body so scroll parents do not clip it.
 */
export class OpenWithMenu extends LitElement {
    static get styles() {
        return css`
            :host {
                position: relative;
                display: inline-flex;
                flex-shrink: 0;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .trigger {
                border: none;
                border-radius: var(--radius-lg, 8px);
                background: transparent;
                color: var(--color-text-secondary);
                min-width: 28px;
                max-width: 220px;
                height: 28px;
                padding: 0 4px;
                gap: 2px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                font: inherit;
                font-size: 0.78rem;
            }

            .trigger-label {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                padding-left: 4px;
            }

            .trigger:hover:not(:disabled),
            .trigger:focus-visible,
            .trigger[aria-expanded='true'] {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
            }

            .trigger:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .trigger:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            .trigger svg {
                width: 16px;
                height: 16px;
                display: block;
                flex-shrink: 0;
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
        `;
    }

    static get properties() {
        return {
            open: { type: Boolean },
            /** Show as a labelled button that only opens the menu (the blank viewer), instead of a bare chevron (file rows). */
            buttonLabel: { type: String },
            /** The attachment this menu belongs to; makes the button's accessible name specific. */
            fileName: { type: String },
            disabled: { type: Boolean },
            /** The viewer this file opens in (VIEWER); `canSwitchViewer` shows "Open in" (files, not the blank viewer). */
            viewer: { type: String },
            canSwitchViewer: { type: Boolean },
            /** { caseWorkflows, mine } from usableWorkflows(): what can open it in that viewer. */
            usable: { attribute: false },
            /** What the main button opens: a workflow key, or NO_WORKFLOW (checked in the menu). */
            selectedKey: { type: String },
            /** Shown next to the chevron: what differs from the person's own viewer with no workflow. */
            label: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.fileName = '';
        this.disabled = false;
        this.buttonLabel = '';
        this.viewer = VIEWER.SLICERWEB;
        this.canSwitchViewer = false;
        this.usable = null;
        this.selectedKey = NO_WORKFLOW;
        this.label = '';
        this._portalHost = null;
        this._onDocumentPointerDown = (event) => this.closeIfOutside(event);
        this._repositionIfOpen = () => {
            if (this.open) this.renderMenuPortal();
        };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('pointerdown', this._onDocumentPointerDown, true);
        window.addEventListener('resize', this._repositionIfOpen);
        window.addEventListener('scroll', this._repositionIfOpen, true);
    }

    disconnectedCallback() {
        document.removeEventListener('pointerdown', this._onDocumentPointerDown, true);
        window.removeEventListener('resize', this._repositionIfOpen);
        window.removeEventListener('scroll', this._repositionIfOpen, true);
        this.destroyMenuPortal();
        super.disconnectedCallback();
    }

    updated(changed) {
        const contentChanged = ['viewer', 'usable', 'selectedKey'].some((key) => changed.has(key));
        if (changed.has('open') || (this.open && contentChanged)) {
            if (this.open) this.renderMenuPortal();
            else this.destroyMenuPortal();
        }
        // Opening the menu moves keyboard focus into it (it is rendered at the end of the page);
        // switching the viewer keeps focus on the viewer now chosen.
        if (changed.has('open') && this.open) this.focusSelected();
        else if (this.open && changed.has('viewer')) this._portalHost?.querySelector('[aria-checked="true"]')?.focus();
    }

    /** Focus the checked workflow choice (so Enter opens with it), else the first item. */
    focusSelected() {
        const checked = this._portalHost?.querySelector('[data-choice][aria-checked="true"]');
        if (checked) checked.focus();
        else this.focusMenuItem(0);
    }

    menuItems() {
        return Array.from(this._portalHost?.querySelectorAll(MENU_ITEMS) || []);
    }

    focusMenuItem(index) {
        const items = this.menuItems();
        if (items.length === 0) return;
        items[((index % items.length) + items.length) % items.length].focus();
    }

    closeAndFocusTrigger() {
        this.open = false;
        this.shadowRoot?.querySelector('.trigger')?.focus();
    }

    onMenuKeydown(event) {
        const items = this.menuItems();
        const current = items.indexOf(event.target.closest?.(MENU_ITEMS));
        switch (event.key) {
            case 'ArrowDown':
                event.preventDefault();
                this.focusMenuItem(current + 1);
                break;
            case 'ArrowUp':
                event.preventDefault();
                this.focusMenuItem(current - 1);
                break;
            case 'Home':
                event.preventDefault();
                this.focusMenuItem(0);
                break;
            case 'End':
                event.preventDefault();
                this.focusMenuItem(items.length - 1);
                break;
            case 'Escape':
                event.preventDefault();
                this.closeAndFocusTrigger();
                break;
            case 'Tab':
                // Leave the menu; focus returns to the button so Tab carries on from there.
                this.closeAndFocusTrigger();
                break;
            default:
        }
    }

    onTriggerKeydown(event) {
        if (event.key === 'ArrowDown' && !this.open && !this.disabled) {
            event.preventDefault();
            this.open = true;
        }
    }

    ensurePortalStyles() {
        if (document.getElementById(PORTAL_STYLE_ID)) return;
        const style = document.createElement('style');
        style.id = PORTAL_STYLE_ID;
        style.textContent = PORTAL_CSS;
        document.head.appendChild(style);
    }

    ensurePortalHost() {
        if (this._portalHost) return this._portalHost;
        this.ensurePortalStyles();
        const host = document.createElement('div');
        host.setAttribute('data-open-with-menu', '');
        document.body.appendChild(host);
        this._portalHost = host;
        return host;
    }

    destroyMenuPortal() {
        if (!this._portalHost) return;
        render(html``, this._portalHost);
        this._portalHost.remove();
        this._portalHost = null;
    }

    /**
     * Place the rendered menu: just below the button, or just above when it doesn't fit below.
     */
    positionMenu() {
        const panel = this._portalHost?.firstElementChild;
        const anchor = this.shadowRoot?.querySelector('.trigger');
        if (!panel || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const { width, height } = panel.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const maxLeft = viewportWidth - VIEWPORT_PADDING_PX - width;
        const left = Math.max(VIEWPORT_PADDING_PX, Math.min(rect.left, maxLeft));
        const below = rect.bottom + MENU_GAP_PX;
        const above = rect.top - MENU_GAP_PX - height;
        const fitsBelow = below + height <= viewportHeight - VIEWPORT_PADDING_PX;
        const top = fitsBelow || above < VIEWPORT_PADDING_PX ? below : above;
        Object.assign(panel.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
    }

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

    renderMenuPortal() {
        const host = this.ensurePortalHost();
        const list = shortList(this.usable || { caseWorkflows: [], mine: [] }, this.selectedKey);
        const viewerName = t(this.viewer === VIEWER.FULL ? 'viewers.fullSlicer' : 'viewers.slicerWeb');
        const section = (headingKey, entries) => (entries.length ? html`
            <div role="group" aria-label=${t(headingKey)}>
                <div class="heading" aria-hidden="true">${t(headingKey)}</div>
                ${entries.map((e) => this.itemTemplate(e.key, e.name, this.entryHint(e)))}
            </div>
        ` : '');

        render(html`
            <div
                class="open-with-menu-panel"
                role="menu"
                aria-label=${t('viewers.openWith')}
                @keydown=${(e) => this.onMenuKeydown(e)}
            >
                ${this.canSwitchViewer ? this.viewerSwitchTemplate() : ''}
                ${this.itemTemplate(NO_WORKFLOW, t('viewers.noWorkflow'), t('viewers.justViewer', { viewer: viewerName }))}
                ${section('viewers.thisCase', list.caseWorkflows)}
                ${section('viewers.mine', list.mine)}
                ${list.hidden ? html`
                    <button class="item more" type="button" role="menuitem" tabindex="-1" @click=${() => this.closeAndEmit('more-workflows')}>
                        <span class="check is-empty" aria-hidden="true">✓</span>
                        <span class="item-label">${t('viewers.moreWorkflows', { count: list.hidden })}</span>
                    </button>
                ` : ''}
            </div>
        `, host);
        this.positionMenu();
    }

    closeIfOutside(event) {
        if (!this.open) return;
        const path = event.composedPath?.() || [];
        if (path.includes(this) || (this._portalHost && path.includes(this._portalHost))) return;
        this.open = false;
    }

    toggleMenu(event) {
        event?.stopPropagation?.();
        if (this.disabled) return;
        this.open = !this.open;
    }

    emit(type, detail = {}) {
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    /** Close, then emit. Focus goes back to the button first, so whatever opens next knows where to return to. */
    closeAndEmit(type, detail = {}) {
        this.shadowRoot?.querySelector('.trigger')?.focus();
        this.open = false;
        this.emit(type, detail);
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
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                        fill="currentColor"
                        d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6 1.4-1.4z"
                    />
                </svg>
            </button>
        `;
    }
}

customElements.define('open-with-menu', OpenWithMenu);
