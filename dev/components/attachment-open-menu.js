import { LitElement, html, css } from 'lit-element';
import { render } from 'lit-html';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

const MENU_MIN_WIDTH = 220;
const MENU_GAP_PX = 4;
const VIEWPORT_PADDING_PX = 8;
const PORTAL_STYLE_ID = 'attachment-open-menu-portal-styles';
const APPROX_MENU_HEIGHT_PX = 136;

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
 * Emits `open-viewer` with { viewer: 'full' | 'simplified' | 'web' }.
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
            /** The attachment this menu belongs to; makes the button's accessible name specific. */
            fileName: { type: String },
            disabled: { type: Boolean },
            /** Which viewer is the account default: 'web' | 'full' | 'simplified' */
            defaultViewer: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.fileName = '';
        this.disabled = false;
        this.defaultViewer = 'web';
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
        if (changed.has('open') || (this.open && changed.has('defaultViewer'))) {
            if (this.open) this.renderMenuPortal();
            else this.destroyMenuPortal();
        }
        // Opening the menu moves keyboard focus into it (it is rendered at the end of the page).
        if (changed.has('open') && this.open) this.focusMenuItem(0);
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

    menuItemTemplate({ label, viewer, isDefault, hint = '' }) {
        return html`
            <button
                class="item"
                type="button"
                role="menuitem"
                tabindex="-1"
                @click=${() => this.selectViewer(viewer)}
            >
                <span class="check ${isDefault ? '' : 'is-empty'}" aria-hidden="true">✓</span>
                <span class="item-label">
                    ${label}
                    ${hint ? html`<span class="hint">${hint}</span>` : ''}
                    ${isDefault ? html`<span class="hint">${t('viewers.defaultHint')}</span>` : ''}
                </span>
            </button>
        `;
    }

    renderMenuPortal() {
        const { top, left } = this.menuAnchorPosition();
        const dv = this.defaultViewer || 'web';
        const host = this.ensurePortalHost();

        render(html`
            <div
                class="attachment-open-menu-panel"
                role="menu"
                aria-label=${t('viewers.openWith')}
                @keydown=${(e) => this.onMenuKeydown(e)}
                style="top:${top}px;left:${left}px;"
            >
                ${this.menuItemTemplate({
                    label: t('viewers.slicerWeb'),
                    viewer: 'web',
                    isDefault: dv === 'web',
                    hint: t('viewers.slicerWebHint')
                })}
                ${this.menuItemTemplate({
                    label: t('viewers.fullSlicer'),
                    viewer: 'full',
                    isDefault: dv === 'full'
                })}
                ${this.menuItemTemplate({
                    label: t('viewers.simplified'),
                    viewer: 'simplified',
                    isDefault: dv === 'simplified'
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

    selectViewer(viewer) {
        // Focus goes back to the button first, so whatever opens next knows where to return to.
        this.shadowRoot?.querySelector('.trigger')?.focus();
        this.open = false;
        this.dispatchEvent(new CustomEvent('open-viewer', {
            detail: { viewer },
            bubbles: true,
            composed: true
        }));
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
                title=${this.triggerLabel()}
                aria-label=${this.triggerLabel()}
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
                @keydown=${(e) => this.onTriggerKeydown(e)}
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
