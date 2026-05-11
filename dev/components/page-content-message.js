import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * Inline feedback blocks aligned with My Projects / shell pages (status, errors, empty, success).
 */
export class PageContentMessage extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .status {
                margin-top: 16px;
                color: var(--color-text-secondary);
            }

            .error {
                margin-top: 16px;
                color: #c62828;
            }

            .success {
                margin-top: 16px;
                padding: 10px 12px;
                border-radius: 10px;
                color: #1b5e20;
                background: color-mix(in srgb, #4caf50 12%, transparent);
                border: 1px solid color-mix(in srgb, #4caf50 35%, var(--color-border));
            }

            .empty {
                margin-top: 16px;
                padding: 12px 14px;
                border: 1px dashed var(--color-text-secondary);
                border-radius: 10px;
                color: var(--color-text-secondary);
            }
        `;
    }

    static get properties() {
        return {
            variant: { type: String },
            message: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.variant = 'status';
        this.message = '';
    }

    render() {
        if (!this.message) {
            return html``;
        }
        const v = this.variant === 'error' || this.variant === 'success' || this.variant === 'empty'
            ? this.variant
            : 'status';
        return html`<div class="${v}">${this.message}</div>`;
    }
}

customElements.define('page-content-message', PageContentMessage);
