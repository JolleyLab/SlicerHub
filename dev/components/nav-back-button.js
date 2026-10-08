import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';

/**
 * Reusable back-navigation button. Dispatches `navigate-back` (bubbles, composed)
 * on click so app-shell can pop its history stack.
 *
 * Usage:
 *   <nav-back-button></nav-back-button>
 *   <nav-back-button label="My Cases"></nav-back-button>
 */
export class NavBackButton extends LitElement {
    static get styles() {
        return css`
            :host {
                display: inline-block;
            }

            button {
                border: none;
                background: transparent;
                padding: 4px 0;
                margin: 0;
                font: inherit;
                font-size: 0.875rem;
                font-weight: 600;
                color: var(--color-focus, var(--color-secondary));
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }

            button:hover,
            button:focus-visible {
                color: var(--color-text-primary);
            }

            button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                border-radius: 4px;
            }

            svg {
                flex-shrink: 0;
            }
        `;
    }

    static get properties() {
        return {
            label: { type: String }
        };
    }

    constructor() {
        super();
        this.label = '';
    }

    _handleClick() {
        this.dispatchEvent(new CustomEvent('navigate-back', { bubbles: true, composed: true }));
    }

    render() {
        const label = this.label || t('common.back');
        return html`
            <button type="button" aria-label="${label}" @click=${this._handleClick}>
                <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true"
                    fill="none" stroke="currentColor" stroke-width="2.5"
                    stroke-linecap="round" stroke-linejoin="round">
                    <polyline points="15 18 9 12 15 6"/>
                </svg>
                ${label}
            </button>
        `;
    }
}

customElements.define('nav-back-button', NavBackButton);
