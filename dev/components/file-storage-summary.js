import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

export class FileStorageSummary extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                margin-top: 16px;
            }

            .summary {
                display: flex;
                flex-wrap: wrap;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                padding: 14px 16px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: color-mix(in srgb, var(--color-primary) 6%, transparent);
                color: var(--color-text-primary);
                font-size: 0.95rem;
            }

            .summary strong {
                color: var(--color-text-primary);
                font-weight: 600;
            }

            .meta {
                color: var(--color-text-secondary);
            }
        `;
    }

    static get properties() {
        return {
            megabytesUsed: { type: String },
            fileCount: { type: Number }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.megabytesUsed = '0.00';
        this.fileCount = 0;
    }

    render() {
        return html`
            <div class="summary">
                <div class="meta"><strong>Storage used</strong> ${this.megabytesUsed} MB</div>
                <div class="meta"><strong>Files</strong> ${this.fileCount}</div>
            </div>
        `;
    }
}

customElements.define('file-storage-summary', FileStorageSummary);
