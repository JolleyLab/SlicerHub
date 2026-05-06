import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

export class StatusCard extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .card {
                width: min(560px, calc(100vw - 32px));
                background: var(--color-surface, var(--color-background));
                border: 1px solid var(--color-border);
                border-radius: 12px;
                padding: 18px;
                box-sizing: border-box;
                color: var(--color-text-primary);
            }

            .card.error {
                border-color: color-mix(in srgb, #c62828 42%, var(--color-border));
            }

            .title {
                margin: 0 0 8px;
                color: var(--color-text-primary);
                font-size: 1.2rem;
                font-weight: 700;
            }

            .message {
                margin: 0 0 14px;
                color: var(--color-text-secondary);
            }

            .actions {
                display: flex;
                gap: 8px;
                flex-wrap: wrap;
            }

            .actions ::slotted(button) {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                min-height: 42px;
                padding: 8px 16px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
                background: transparent;
                color: var(--color-text-primary);
            }

            .actions ::slotted(button.primary) {
                background: var(--color-primary);
                color: var(--color-background);
            }
        `;
    }

    static get properties() {
        return {
            title: { type: String },
            message: { type: String },
            tone: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.title = '';
        this.message = '';
        this.tone = 'default';
    }

    render() {
        const toneClass = this.tone === 'error' ? 'error' : '';
        return html`
            <article class="card ${toneClass}">
                ${this.title ? html`<h2 class="title">${this.title}</h2>` : ''}
                ${this.message ? html`<p class="message">${this.message}</p>` : ''}
                <div class="actions">
                    <slot name="actions"></slot>
                </div>
            </article>
        `;
    }
}

customElements.define('status-card', StatusCard);
