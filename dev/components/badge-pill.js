import { LitElement, html, css } from 'lit-element';

/**
 * Pill-shaped badge label.
 *
 * Attributes:
 *   variant  default | primary | success | warning  (default: default)
 *
 * Slot: label text
 */
export class BadgePill extends LitElement {
    static get properties() {
        return {
            variant: { type: String, reflect: true }
        };
    }

    static get styles() {
        return css`
            :host { display: inline-block; }
            :host([hidden]) { display: none; }

            span {
                display: inline-block;
                font-size: 0.75rem;
                font-weight: 550;
                white-space: nowrap;
                padding: 3px 8px;
                border-radius: 999px;
                border: 1px solid var(--color-border);
                background: color-mix(in srgb, var(--color-border) 22%, transparent);
                color: var(--color-text-secondary);
            }

            /* primary: tinted with brand colour */
            :host([variant='primary']) span {
                color: var(--color-primary);
                border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
            }

            /* success */
            :host([variant='success']) span {
                color: var(--color-status-success-fg, #166534);
                border-color: color-mix(in srgb, var(--color-status-success, #16a34a) 35%, transparent);
                background: color-mix(in srgb, var(--color-status-success, #16a34a) 10%, transparent);
            }

            /* warning */
            :host([variant='warning']) span {
                color: var(--color-status-warning-fg, #92400e);
                border-color: color-mix(in srgb, var(--color-status-warning, #f59e0b) 35%, transparent);
                background: color-mix(in srgb, var(--color-status-warning, #f59e0b) 10%, transparent);
            }
        `;
    }

    render() {
        return html`<span><slot></slot></span>`;
    }
}

customElements.define('badge-pill', BadgePill);
