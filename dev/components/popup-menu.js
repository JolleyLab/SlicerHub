import { LitElement, html, css } from 'lit-element';
import { render } from 'lit-html';
import { initializeTheme } from './theme.js';

const MENU_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
/** Everything the arrow keys move between. */
const MENU_ITEMS = '[role="menuitem"], [role="menuitemradio"]';

/** Styles for every popup menu's panel (rendered at the end of the page, outside any shadow root). */
const BASE_STYLE_ID = 'popup-menu-portal-styles';
const BASE_CSS = `
.popup-menu-panel {
  position: fixed;
  z-index: 10000;
  min-width: 200px;
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
.popup-menu-panel .item {
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
.popup-menu-panel .item:hover,
.popup-menu-panel .item:focus-visible {
  background: color-mix(in srgb, var(--color-primary, #3366cc) 10%, transparent);
  outline: none;
}
.popup-menu-panel .item-label { flex: 1; min-width: 0; }
.popup-menu-panel .check {
  flex: 0 0 14px;
  width: 14px;
  color: var(--color-focus, #0057c2); /* a ✓ needs 3:1 against the panel: primary is too dark on the dark theme */
  font-size: 0.85rem;
  line-height: 1;
  text-align: center;
}
.popup-menu-panel .check.is-empty { visibility: hidden; }
.popup-menu-panel .hint {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #666);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.popup-menu-panel .heading {
  padding: 8px 12px 2px;
  font-size: 0.72rem;
  font-weight: 600;
  color: var(--color-text-secondary, #666);
}
.popup-menu-panel .divider {
  height: 1px;
  margin: 4px 0;
  background: var(--color-border, #ccc);
}
.popup-menu-panel .badge {
  min-width: 1.25rem;
  height: 1.25rem;
  padding: 0 5px;
  border-radius: 999px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--color-primary, #3366cc);
  color: var(--color-on-primary, #fff);
  font-size: 0.7rem;
  font-weight: 700;
  line-height: 1;
}
`;

function ensureStyle(id, text) {
    if (!text || document.getElementById(id)) return;
    const style = document.createElement('style');
    style.id = id;
    style.textContent = text;
    document.head.appendChild(style);
}

/**
 * A button that opens a menu. Subclasses render the button with `.trigger` (see
 * triggerStyles) calling toggleMenu/onTriggerKeydown, and supply menuContent() and menuLabel();
 * optional: contentProperties (re-render the open menu when these change), focusOnOpen(),
 * portalStyleId/portalCss (extra panel styles), and the `alignEnd` property (line the menu up
 * with the button's right edge, for buttons at the end of a toolbar).
 *
 * The menu is portaled to document.body so scroll parents don't clip it, placed just below the
 * button (or above when it doesn't fit), and closes on Escape, Tab or a click outside.
 */
export class PopupMenu extends LitElement {
    static get properties() {
        return {
            open: { type: Boolean },
            disabled: { type: Boolean },
            alignEnd: { type: Boolean },
        };
    }

    /** Shared look for a bare icon button that opens a menu. */
    static get triggerStyles() {
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

    /** Properties that change what the open menu shows. */
    static get contentProperties() { return []; }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.disabled = false;
        this.alignEnd = false;
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
        const contentChanged = this.constructor.contentProperties.some((key) => changed.has(key));
        if (changed.has('open') || (this.open && contentChanged)) {
            if (this.open) this.renderMenuPortal();
            else this.destroyMenuPortal();
        }
        // Opening the menu moves keyboard focus into it (it is rendered at the end of the page).
        if (changed.has('open') && this.open) this.focusOnOpen();
    }

    // ── For subclasses ─────────────────────────────────────────────────────

    /** The menu's items (a lit template). */
    menuContent() { return html``; }

    /** The menu's accessible name. */
    menuLabel() { return ''; }

    /** An extra class on the panel, for a subclass's portalCss. */
    panelClass() { return ''; }

    focusOnOpen() { this.focusMenuItem(0); }

    // ── Keyboard and focus ─────────────────────────────────────────────────

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
        const moves = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: items.length - 1 };
        if (event.key in moves) {
            event.preventDefault();
            this.focusMenuItem(moves[event.key]);
        } else if (event.key === 'Escape') {
            event.preventDefault();
            this.closeAndFocusTrigger();
        } else if (event.key === 'Tab') {
            // Leave the menu; focus returns to the button so Tab carries on from there.
            this.closeAndFocusTrigger();
        }
    }

    onTriggerKeydown(event) {
        if (event.key === 'ArrowDown' && !this.open && !this.disabled) {
            event.preventDefault();
            this.open = true;
        }
    }

    // ── The panel ──────────────────────────────────────────────────────────

    ensurePortalHost() {
        if (this._portalHost) return this._portalHost;
        ensureStyle(BASE_STYLE_ID, BASE_CSS);
        ensureStyle(this.constructor.portalStyleId, this.constructor.portalCss);
        const host = document.createElement('div');
        host.setAttribute('data-popup-menu', this.localName);
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

    renderMenuPortal() {
        render(html`
            <div class="popup-menu-panel ${this.panelClass()}" role="menu" aria-label=${this.menuLabel()} @keydown=${(e) => this.onMenuKeydown(e)}>
                ${this.menuContent()}
            </div>
        `, this.ensurePortalHost());
        this.positionMenu();
    }

    /** Just below the button, or just above when it doesn't fit below; inside the window. */
    positionMenu() {
        const panel = this._portalHost?.firstElementChild;
        const anchor = this.shadowRoot?.querySelector('.trigger');
        if (!panel || !anchor) return;
        const rect = anchor.getBoundingClientRect();
        const { width, height } = panel.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const wanted = this.alignEnd ? rect.right - width : rect.left;
        const left = Math.max(VIEWPORT_PADDING_PX, Math.min(wanted, viewportWidth - VIEWPORT_PADDING_PX - width));
        const below = rect.bottom + MENU_GAP_PX;
        const above = rect.top - MENU_GAP_PX - height;
        const fitsBelow = below + height <= viewportHeight - VIEWPORT_PADDING_PX;
        const top = fitsBelow || above < VIEWPORT_PADDING_PX ? below : above;
        Object.assign(panel.style, { left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
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
}
