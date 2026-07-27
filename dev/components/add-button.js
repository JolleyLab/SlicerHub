import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

export class AddButton extends LitElement {
    static get styles() {
        return css`
            :host {
                display: inline-block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .add-button {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                border: 1px solid color-mix(in srgb, var(--color-border) 50%, transparent);
                border-radius: var(--radius-md);
                padding: 5px 10px;
                background: transparent;
                color: var(--color-text-secondary);
                font: inherit;
                font-weight: 500;
                font-size: 0.9rem;
                cursor: pointer;
                transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease, opacity 0.2s ease;
            }

            .add-button:hover,
            .add-button:focus-visible {
                background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
                color: var(--color-text-primary);
                border-color: color-mix(in srgb, var(--color-border) 75%, transparent);
                transform: translateY(-1px);
            }

            .add-button:focus-visible {
                outline: 3px solid var(--color-focus, var(--color-primary));
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 3px var(--color-focus, var(--color-primary)));
            }

            :host-context([data-theme='dark']) .add-button:hover,
            :host-context([data-theme='dark']) .add-button:focus-visible {
                background: color-mix(in srgb, var(--color-secondary) 18%, transparent);
                color: var(--color-text-primary);
                border-color: color-mix(in srgb, var(--color-border) 85%, transparent);
            }

            .add-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }

            .plus-mark {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 18px;
                height: 18px;
                border-radius: 50%;
                background: color-mix(in srgb, var(--color-primary) 82%, transparent);
                color: var(--color-on-primary);
                font-size: 14px;
                line-height: 0;
                font-weight: 600;
                flex: 0 0 18px;
                text-align: center;
                padding: 0;
            }

            .add-button:hover .plus-mark,
            .add-button:focus-visible .plus-mark {
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            :host-context([data-theme='dark']) .add-button:hover .plus-mark,
            :host-context([data-theme='dark']) .add-button:focus-visible .plus-mark {
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .button-title {
                white-space: nowrap;
            }
        `;
    }

    static get properties() {
        return {
            title: { type: String },
            disabled: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.title = 'Add';
        this.disabled = false;
    }

    handleClick() {
        if (this.disabled) return;

        this.dispatchEvent(new CustomEvent('add-button-click', {
            detail: { title: this.title },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <button class="add-button" ?disabled=${this.disabled} @click=${this.handleClick}>
                <span class="plus-mark" aria-hidden="true">+</span>
                <span class="button-title">${this.title}</span>
            </button>
        `;
    }
}

customElements.define('add-button', AddButton);
