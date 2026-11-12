import { LitElement, html, css } from 'lit-element';
import { render } from 'lit-html';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

const MENU_MIN_WIDTH = 240;
const MENU_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
const PORTAL_STYLE_ID = 'open-with-menu-portal-styles';
const APPROX_MENU_HEIGHT_PX = 240;

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
.open-with-menu-panel .more .caret { transition: transform 0.15s; }
.open-with-menu-panel .more[aria-expanded='true'] .caret { transform: rotate(90deg); }
.open-with-menu-panel .nested { padding-left: 12px; }
.open-with-menu-panel .item.is-pending { opacity: 0.6; cursor: default; }
.open-with-menu-panel .item.is-pending:hover { background: transparent; }
`;

/**
 * Open ▾ for a case file or the blank viewer (docs/workflows-design.md › Opening a file).
 * `menu` comes from utils/caseWorkflowMenu.js workflowMenu(); `selectedKey` is what the main
 * button opens. Built-in viewers sit under "Other ways to open", shown directly when there is
 * nothing else; the person's pending requests are listed greyed out.
 * Emits `open-workflow` with { entry }, and `find-workflows` for "Find more…".
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
        `;
    }

    static get properties() {
        return {
            open: { type: Boolean },
            /** The attachment this menu belongs to; makes the button's accessible name specific. */
            fileName: { type: String },
            disabled: { type: Boolean },
            /** { recommended, yours, builtins } from workflowMenu() */
            menu: { attribute: false },
            /** Key of the entry the main button opens (checked in the menu). */
            selectedKey: { type: String },
            /** Shown next to the chevron, e.g. the workflow's name when it isn't the person's own default. */
            label: { type: String },
            showMore: { state: true }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.fileName = '';
        this.disabled = false;
        this.menu = null;
        this.selectedKey = '';
        this.label = '';
        this.showMore = false;
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
        const contentChanged = ['menu', 'selectedKey', 'showMore'].some((key) => changed.has(key));
        if (changed.has('open') || (this.open && contentChanged)) {
            if (this.open) this.renderMenuPortal();
            else this.destroyMenuPortal();
        }
        // Opening the menu moves keyboard focus into it (it is rendered at the end of the page);
        // expanding "Other ways to open" keeps focus on that item.
        if (changed.has('open') && this.open) this.focusMenuItem(0);
        else if (this.open && changed.has('showMore')) this._portalHost?.querySelector('.more[aria-expanded]')?.focus();
    }

    menuItems() {
        return Array.from(this._portalHost?.querySelectorAll('[role="menuitem"]') || []);
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
        const current = items.indexOf(event.target.closest?.('[role="menuitem"]'));
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

    menuAnchorPosition() {
        const trigger = this.shadowRoot?.querySelector('.trigger');
        const rect = trigger?.getBoundingClientRect?.() || { left: 0, right: 0, top: 0, bottom: 0 };
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const menuWidth = Math.min(MENU_MIN_WIDTH, viewportWidth - VIEWPORT_PADDING_PX * 2);

        let left = rect.left;
        if (left + menuWidth > viewportWidth - VIEWPORT_PADDING_PX) {
            left = Math.max(VIEWPORT_PADDING_PX, rect.right - menuWidth);
        }
        if (left < VIEWPORT_PADDING_PX) left = VIEWPORT_PADDING_PX;

        let top = rect.bottom + MENU_GAP_PX;
        const spaceBelow = viewportHeight - VIEWPORT_PADDING_PX - top;
        if (spaceBelow < APPROX_MENU_HEIGHT_PX) {
            const above = rect.top - MENU_GAP_PX - APPROX_MENU_HEIGHT_PX;
            if (above > VIEWPORT_PADDING_PX) top = above;
        }

        return { top: Math.round(top), left: Math.round(left) };
    }

    entryName(entry) {
        return entry.nameKey ? t(entry.nameKey) : entry.name;
    }

    /** Second line: the description's first line, else where it opens. */
    entryHint(entry) {
        if (entry.hintKey) return t(entry.hintKey);
        return (entry.description || '').split('\n')[0].trim() || t('viewers.opensInBrowser');
    }

    itemTemplate(entry) {
        const selected = entry.key === this.selectedKey;
        return html`
            <button class="item" type="button" role="menuitem" tabindex="-1" @click=${() => this.select(entry)}>
                <span class="check ${selected ? '' : 'is-empty'}" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${this.entryName(entry)}
                    <span class="hint">${this.entryHint(entry)}</span>
                </span>
            </button>
        `;
    }

    pendingTemplate(request) {
        return html`
            <div class="item is-pending" role="menuitem" aria-disabled="true" tabindex="-1">
                <span class="check is-empty" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${request.name}
                    <span class="hint">${t('viewers.pendingApproval')}</span>
                </span>
            </div>
        `;
    }

    /** The sections to show; the selected entry is always listed, even if made for another file type. */
    sections() {
        const { recommended = [], yours = [], builtins = [], all = [] } = this.menu || {};
        const listed = [...recommended, ...yours, ...builtins];
        const selected = all.find((e) => e.key === this.selectedKey);
        const extra = selected && !listed.includes(selected) ? [selected] : [];
        return { recommended: [...extra, ...recommended], yours, builtins };
    }

    renderMenuPortal() {
        const { top, left } = this.menuAnchorPosition();
        const host = this.ensurePortalHost();
        const { recommended, yours, builtins } = this.sections();
        const pending = this.menu?.pending || [];
        const hasWorkflows = recommended.length + yours.length + pending.length > 0;
        const section = (headingKey, entries, requests = []) => (entries.length + requests.length ? html`
            <div role="group" aria-label=${t(headingKey)}>
                <div class="heading" aria-hidden="true">${t(headingKey)}</div>
                ${entries.map((e) => this.itemTemplate(e))}
                ${requests.map((r) => this.pendingTemplate(r))}
            </div>
        ` : '');

        render(html`
            <div
                class="open-with-menu-panel"
                role="menu"
                aria-label=${t('viewers.openWith')}
                @keydown=${(e) => this.onMenuKeydown(e)}
                style="top:${top}px;left:${left}px;"
            >
                ${section('viewers.recommended', recommended, pending)}
                ${section('viewers.yours', yours)}
                ${hasWorkflows ? html`
                    <div class="divider" role="separator"></div>
                    <button class="item more" type="button" role="menuitem" tabindex="-1"
                        aria-expanded=${this.showMore ? 'true' : 'false'}
                        @click=${() => { this.showMore = !this.showMore; }}>
                        <span class="check caret" aria-hidden="true">›</span>
                        <span class="item-label">${t('viewers.otherWays')}</span>
                    </button>
                    ${this.showMore ? html`<div class="nested">${builtins.map((e) => this.itemTemplate(e))}</div>` : ''}
                ` : builtins.map((e) => this.itemTemplate(e))}
                ${this.menu?.canFindMore ? html`
                    <div class="divider" role="separator"></div>
                    <button class="item more" type="button" role="menuitem" tabindex="-1" @click=${() => this.findMore()}>
                        <span class="check is-empty" aria-hidden="true">✓</span>
                        <span class="item-label">${t('viewers.findMore')}</span>
                    </button>
                ` : ''}
            </div>
        `, host);
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
        // Built-ins start expanded when one of them is what the button opens.
        if (!this.open) this.showMore = (this.menu?.builtins || []).some((e) => e.key === this.selectedKey);
        this.open = !this.open;
    }

    /** Close, then emit. Focus goes back to the button first, so whatever opens next knows where to return to. */
    closeAndEmit(type, detail = {}) {
        this.shadowRoot?.querySelector('.trigger')?.focus();
        this.open = false;
        this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
    }

    select(entry) {
        this.closeAndEmit('open-workflow', { entry });
    }

    findMore() {
        this.closeAndEmit('find-workflows');
    }

    triggerLabel() {
        return this.fileName
            ? t('viewers.openWithNamed', { name: this.fileName })
            : t('viewers.openWith');
    }

    render() {
        return html`
            <button
                class="trigger"
                type="button"
                title=${this.label ? `${this.triggerLabel()} (${this.label})` : this.triggerLabel()}
                aria-label=${this.triggerLabel()}
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
                @keydown=${(e) => this.onTriggerKeydown(e)}
            >
                ${this.label ? html`<span class="trigger-label">${this.label}</span>` : ''}
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
