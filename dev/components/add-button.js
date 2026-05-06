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
                border: 1px solid var(--color-text-secondary);
                border-radius: 999px;
                padding: 5px 10px;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-weight: 500;
                font-size: 0.9rem;
                cursor: pointer;
                transition: transform 0.2s ease, background-color 0.2s ease, border-color 0.2s ease, opacity 0.2s ease;
            }

            .add-button:hover,
            .add-button:focus-visible {
                background: var(--color-secondary);
                color: var(--color-background);
                border-color: var(--color-secondary);
                outline: none;
                transform: translateY(-1px);
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
                background: var(--color-text-secondary);
                color: var(--color-background);
                font-size: 14px;
                line-height: 0;
                font-weight: 600;
                flex: 0 0 18px;
                text-align: center;
                padding: 0;
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
