import { LitElement, html, css } from 'lit-element';

/**
 * General-purpose button component.
 *
 * Attributes:
 *   variant   primary | ghost | ghost-danger | danger  (default: primary)
 *   size      sm | md                                   (default: md)
 *   type      button | submit | reset                   (default: button)
 *   disabled  Boolean
 *
 * Slot: button label / content
 *
 * Note: type="submit" / type="reset" works across shadow-DOM by finding the
 * closest <form> in the light DOM and calling requestSubmit() / reset().
 */
export class AppButton extends LitElement {
    static get properties() {
        return {
            variant:  { type: String, reflect: true },
            size:     { type: String, reflect: true },
            type:     { type: String },
            disabled: { type: Boolean, reflect: true }
        };
    }

    static get styles() {
        return css`
            :host { display: inline-block; }
            :host([hidden]) { display: none; }

            button {
                border-radius: var(--radius-sm, 6px);
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                gap: 6px;
                white-space: nowrap;
                transition: background 0.1s ease, color 0.1s ease, border-color 0.1s ease;
                width: 100%;
            }
            button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
            button:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            /* ── Sizes ── */
            :host([size='sm']) button {
                padding: 4px 10px;
                font-size: 0.75rem;
            }
            :host(:not([size])) button,
            :host([size='md']) button {
                padding: 7px 14px;
                font-size: 0.8125rem;
            }

            /* ── primary (default) ── */
            :host(:not([variant])) button,
            :host([variant='primary']) button {
                background: var(--color-primary);
                color: var(--color-on-primary, #fff);
                border: 1px solid transparent;
            }
            :host(:not([variant])) button:hover:not(:disabled),
            :host([variant='primary']) button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            /* ── ghost ── */
            :host([variant='ghost']) button {
                background: transparent;
                color: var(--color-text-primary);
                border: 1px solid var(--color-border);
            }
            :host([variant='ghost']) button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-border) 35%, transparent);
            }

            /* ── ghost-danger: visible border, turns red on hover ── */
            :host([variant='ghost-danger']) button {
                background: transparent;
                color: var(--color-text-secondary);
                border: 1px solid var(--color-border);
            }
            :host([variant='ghost-danger']) button:hover:not(:disabled) {
                border-color: var(--color-status-error, #dc2626);
                color: var(--color-status-error, #dc2626);
            }

            /* ── danger: no border, turns red on hover (for inline delete actions) ── */
            :host([variant='danger']) button {
                background: transparent;
                color: var(--color-text-secondary);
                border: 1px solid transparent;
            }
            :host([variant='danger']) button:hover:not(:disabled) {
                color: var(--color-status-error, #dc2626);
                border-color: color-mix(in srgb, var(--color-status-error, #dc2626) 30%, transparent);
            }
        `;
    }

    constructor() {
        super();
        this.type = 'button';
        this.disabled = false;
    }

    _handleClick() {
        if (this.disabled) return;
        if (this.type === 'submit') {
            this.closest('form')?.requestSubmit();
        } else if (this.type === 'reset') {
            this.closest('form')?.reset();
        }
    }

    render() {
        return html`
            <button
                type="button"
                ?disabled=${this.disabled}
                @click=${this._handleClick}
            ><slot></slot></button>
        `;
    }
}

customElements.define('app-button', AppButton);
