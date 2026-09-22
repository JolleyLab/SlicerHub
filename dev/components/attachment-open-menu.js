import { LitElement, html, css } from 'lit-element';
import { render } from 'lit-html';
import { initializeTheme } from './theme.js';

const MENU_MIN_WIDTH = 220;
const MENU_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
const PORTAL_STYLE_ID = 'attachment-open-menu-portal-styles';
const APPROX_MENU_HEIGHT_PX = 96;

const PORTAL_CSS = `
.attachment-open-menu-panel {
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
.attachment-open-menu-panel .item {
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
.attachment-open-menu-panel .item:hover,
.attachment-open-menu-panel .item:focus-visible {
  background: color-mix(in srgb, var(--color-primary, #3366cc) 10%, transparent);
  outline: none;
}
.attachment-open-menu-panel .item-label { flex: 1; min-width: 0; }
.attachment-open-menu-panel .check {
  flex: 0 0 14px;
  width: 14px;
  color: var(--color-primary, #3366cc);
  font-size: 0.85rem;
  line-height: 1;
  text-align: center;
}
.attachment-open-menu-panel .check.is-empty { visibility: hidden; }
.attachment-open-menu-panel .hint {
  display: block;
  margin-top: 2px;
  font-size: 0.72rem;
  color: var(--color-text-secondary, #666);
}
`;

/**
 * Open-with control for case attachments.
 * Emits `open-viewer` with { simplified: boolean }.
 * Menu is portaled to document.body so scroll parents do not clip it.
 */
export class AttachmentOpenMenu extends LitElement {
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
                width: 28px;
                height: 28px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
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
            }
        `;
    }

    static get properties() {
        return {
            open: { type: Boolean },
            disabled: { type: Boolean },
            /** Account default is Simplified viewer. */
            preferSimplifiedDefault: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.disabled = false;
        this.preferSimplifiedDefault = false;
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
        if (changed.has('open') || (this.open && changed.has('preferSimplifiedDefault'))) {
            if (this.open) this.renderMenuPortal();
            else this.destroyMenuPortal();
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
        host.setAttribute('data-attachment-open-menu', '');
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

    menuItemTemplate({ label, simplified, isDefault }) {
        return html`
            <button
                class="item"
                type="button"
                role="menuitem"
                @click=${() => this.selectViewer(simplified)}
            >
                <span class="check ${isDefault ? '' : 'is-empty'}" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${label}
                    ${isDefault ? html`<span class="hint">Default</span>` : ''}
                </span>
            </button>
        `;
    }

    renderMenuPortal() {
        const { top, left } = this.menuAnchorPosition();
        const preferSimplified = this.preferSimplifiedDefault === true;
        const host = this.ensurePortalHost();

        render(html`
            <div
                class="attachment-open-menu-panel"
                role="menu"
                style="top:${top}px;left:${left}px;"
            >
                ${this.menuItemTemplate({
                    label: 'Full Slicer',
                    simplified: false,
                    isDefault: !preferSimplified
                })}
                ${this.menuItemTemplate({
                    label: 'Simplified viewer',
                    simplified: true,
                    isDefault: preferSimplified
                })}
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
        this.open = !this.open;
    }

    selectViewer(simplified) {
        this.open = false;
        this.dispatchEvent(new CustomEvent('open-viewer', {
            detail: { simplified: simplified === true },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <button
                class="trigger"
                type="button"
                title="Open with…"
                aria-label="Open with"
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
            >
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

customElements.define('attachment-open-menu', AttachmentOpenMenu);
