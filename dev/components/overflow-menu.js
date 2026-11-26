import { html, css } from 'lit-element';
import { PopupMenu } from './popup-menu.js';

const ICON_MORE = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4zm6 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4z"/>
    </svg>`;

/**
 * A "⋯" button for actions that don't need their own button, e.g. on a toolbar.
 * `items`: [{ key, label, badge?, disabled? }] (badge: a count, also summed on the button).
 * Emits `menu-select` with { key }.
 */
export class OverflowMenu extends PopupMenu {
    static get styles() {
        return [PopupMenu.triggerStyles, css`
            .trigger { width: 32px; height: 32px; padding: 0; position: relative; min-width: var(--tap-target-min, 0px); min-height: var(--tap-target-min, 0px); }
            .trigger svg { width: 20px; height: 20px; }
            .trigger-badge {
                position: absolute;
                top: -2px;
                right: -2px;
                min-width: 16px;
                height: 16px;
                padding: 0 4px;
                box-sizing: border-box;
                border-radius: 999px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                background: var(--color-primary);
                color: var(--color-on-primary);
                font-size: 0.65rem;
                font-weight: 700;
                line-height: 1;
            }
        `];
    }

    static get contentProperties() { return ['items']; }

    static get properties() {
        return {
            ...super.properties,
            /** The button's accessible name, e.g. "More actions". */
            label: { type: String },
            items: { attribute: false },
        };
    }

    constructor() {
        super();
        this.label = '';
        this.items = [];
        this.alignEnd = true;
    }

    menuLabel() { return this.label; }

    menuContent() {
        return html`${this.actionItemsTemplate(this.items)}`;
    }

    render() {
        const badge = (this.items || []).reduce((sum, item) => sum + (Number(item.badge) || 0), 0);
        return html`
            <button
                class="trigger"
                type="button"
                title=${this.label}
                aria-label=${badge ? `${this.label} (${badge})` : this.label}
                aria-expanded=${this.open ? 'true' : 'false'}
                aria-haspopup="menu"
                ?disabled=${this.disabled}
                @click=${(e) => this.toggleMenu(e)}
                @keydown=${(e) => this.onTriggerKeydown(e)}
            >
                ${ICON_MORE}
                ${badge ? html`<span class="trigger-badge" aria-hidden="true">${badge}</span>` : ''}
            </button>
        `;
    }
}

customElements.define('overflow-menu', OverflowMenu);
