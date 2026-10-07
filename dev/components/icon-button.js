import { LitElement, html, css } from 'lit-element';

/**
 * Square transparent icon button with focus ring.
 *
 * Attributes:
 *   label     String   Accessible label (required — maps to aria-label)
 *   size      sm | md | lg  28 | 32 | 34 px  (default: md)
 *   disabled  Boolean
 *
 * Slot: SVG icon
 */
export class IconButton extends LitElement {
    static get properties() {
        return {
            label:    { type: String },
            size:     { type: String, reflect: true },
            disabled: { type: Boolean, reflect: true }
        };
    }

    static get styles() {
        return css`
            :host { display: inline-block; }
            :host([hidden]) { display: none; }

            button {
                border: none;
                border-radius: var(--radius-sm, 6px);
                background: transparent;
                color: var(--color-text-secondary);
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }
            button:hover:not(:disabled),
            button:focus-visible {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
            }
            button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
            button:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            /* Sizes */
            :host(:not([size])) button,
            :host([size='md']) button {
                width: 32px;
                height: 32px;
            }
            :host([size='sm']) button {
                width: 28px;
                height: 28px;
            }
            :host([size='lg']) button {
                width: 34px;
                height: 34px;
            }

            ::slotted(svg) {
                display: block;
                pointer-events: none;
            }
        `;
    }

    constructor() {
        super();
        this.disabled = false;
    }

    render() {
        return html`
            <button
                type="button"
                aria-label=${this.label || ''}
                ?disabled=${this.disabled}
            ><slot></slot></button>
        `;
    }
}

customElements.define('icon-button', IconButton);
