import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

/**
 * Audit log display — a chronological list of Directus activity rows.
 *
 * Props:
 *   rows      — array of activity rows from /api/directus/cases/:id/activity
 *   loading   — boolean
 *   error     — string | null
 *   title     — string (heading, defaults to 'Case History')
 *
 * Events:
 *   load-more — user clicked Load More
 */
export class AuditLog extends LitElement {
    static get properties() {
        return {
            rows:    { type: Array },
            loading: { type: Boolean },
            error:   { type: String },
            title:   { type: String },
            hasMore: { type: Boolean }
        };
    }

    static get styles() {
        return css`
            :host {
                display: block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .audit-header {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-bottom: 20px;
            }

            .audit-title {
                margin: 0;
                font-size: 1.1rem;
                font-weight: 650;
                color: var(--color-text-primary, #111);
            }

            .audit-count {
                font-size: 0.72rem;
                font-weight: 650;
                color: var(--color-text-secondary);
                background: color-mix(in srgb, var(--color-border) 16%, transparent);
                border: 1px solid var(--color-border);
                border-radius: 999px;
                padding: 2px 8px;
                line-height: 1.3;
            }

            .audit-list {
                display: flex;
                flex-direction: column;
                gap: 0;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg, 8px);
                overflow: hidden;
            }

            .audit-row {
                display: grid;
                grid-template-columns: 140px 1fr auto;
                gap: 12px;
                align-items: start;
                padding: 12px 16px;
                border-bottom: 1px solid var(--color-border);
                background: var(--color-panel, #fff);
                font-size: 0.875rem;
                line-height: 1.4;
            }

            .audit-row:last-child {
                border-bottom: none;
            }

            .audit-row:nth-child(even) {
                background: color-mix(in srgb, var(--color-background) 40%, var(--color-panel, #fff));
            }

            .audit-timestamp {
                color: var(--color-text-secondary);
                font-size: 0.8rem;
                white-space: nowrap;
                padding-top: 1px;
            }

            .audit-action {
                color: var(--color-text-primary, #111);
            }

            .audit-action strong {
                font-weight: 600;
            }

            .audit-fields {
                color: var(--color-text-secondary);
                font-size: 0.82rem;
                margin-left: 4px;
            }

            .audit-by {
                color: var(--color-text-secondary);
                font-size: 0.82rem;
                margin-left: 4px;
            }

            .audit-collection {
                font-size: 0.75rem;
                color: var(--color-text-secondary);
                background: color-mix(in srgb, var(--color-border) 20%, transparent);
                border: 1px solid var(--color-border);
                border-radius: 4px;
                padding: 1px 6px;
                white-space: nowrap;
                align-self: start;
                margin-top: 2px;
            }

            .audit-empty {
                padding: 32px 16px;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 0.875rem;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg, 8px);
            }

            .audit-error {
                padding: 16px;
                color: var(--color-error, #c00);
                background: color-mix(in srgb, var(--color-error, #c00) 8%, transparent);
                border: 1px solid color-mix(in srgb, var(--color-error, #c00) 30%, transparent);
                border-radius: var(--radius-lg, 8px);
                font-size: 0.875rem;
            }

            .audit-loading {
                padding: 32px 16px;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 0.875rem;
            }

            .load-more-row {
                padding: 10px 16px;
                text-align: center;
                border-top: 1px solid var(--color-border);
                background: var(--color-panel, #fff);
            }

            .load-more-btn {
                background: none;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 6px);
                padding: 6px 16px;
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                cursor: pointer;
                font-family: inherit;
            }

            .load-more-btn:hover {
                background: color-mix(in srgb, var(--color-border) 20%, transparent);
                color: var(--color-text-primary, #111);
            }

            :host-context([data-theme='dark']) .audit-row {
                background: var(--color-panel);
            }

            :host-context([data-theme='dark']) .audit-row:nth-child(even) {
                background: color-mix(in srgb, var(--color-background) 40%, var(--color-panel));
            }
        `;
    }

    constructor() {
        super();
        this.rows = [];
        this.loading = false;
        this.error = null;
        this.title = t('audit.caseHistory');
        this.hasMore = false;
        initializeTheme(this);
    }

    _formatTimestamp(ts) {
        if (!ts) return '—';
        try {
            const d = new Date(ts);
            return d.toLocaleString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric',
                hour: '2-digit', minute: '2-digit'
            });
        } catch (_) {
            return ts;
        }
    }

    _by(row) {
        return row.userName
            ? html` <span class="audit-by">by ${row.userName}</span>`
            : '';
    }

    _fieldSentence(fields) {
        if (!fields?.length) return null;
        const cap = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
        if (fields.length === 1) return cap(fields[0]);
        if (fields.length === 2) return `${cap(fields[0])} and ${fields[1]}`;
        return `${fields.slice(0, -1).map((f, i) => i === 0 ? cap(f) : f).join(', ')}, and ${fields[fields.length - 1]}`;
    }

    _describeAction(row) {
        const by = this._by(row);
        const fields = Array.isArray(row.changedFields) ? row.changedFields : [];

        if (row.collection === 'attachment') {
            if (row.action === 'create') {
                return row.attachmentName
                    ? html`Attachment <strong>${row.attachmentName}</strong> added${by}`
                    : html`Attachment added${by}`;
            }
            if (row.action === 'update') {
                if (fields.includes('file')) {
                    return row.attachmentName
                        ? html`New version of <strong>${row.attachmentName}</strong> saved${by}`
                        : html`New version saved${by}`;
                }
                const sentence = this._fieldSentence(fields);
                return sentence
                    ? html`Attachment <strong>${sentence}</strong> updated${by}`
                    : html`Attachment updated${by}`;
            }
            if (row.action === 'delete') return html`Attachment removed${by}`;
        }

        if (row.collection === 'case') {
            if (row.action === 'create') return html`Case created${by}`;
            if (row.action === 'delete') return html`Case deleted${by}`;
            if (row.action === 'update') {
                if (fields.includes('status') && row.newStatus) {
                    return html`Case <strong>${row.newStatus}</strong>${by}`;
                }
                const sentence = this._fieldSentence(fields);
                return sentence
                    ? html`<strong>${sentence}</strong> updated${by}`
                    : html`Case updated${by}`;
            }
        }

        return html`${row.action}${by}`;
    }

    _collectionLabel(collection) {
        if (collection === 'attachment') return 'file';
        return collection;
    }

    render() {
        if (this.loading && !this.rows.length) {
            return html`<div class="audit-loading">${t('audit.loading')}</div>`;
        }

        if (this.error) {
            return html`<div class="audit-error">${this.error}</div>`;
        }

        if (!this.rows.length) {
            return html`
                <div class="audit-header">
                    <h2 class="audit-title">${this.title}</h2>
                </div>
                <div class="audit-empty">${t('audit.noActivity')}</div>
            `;
        }

        return html`
            <div class="audit-header">
                <h2 class="audit-title">${this.title}</h2>
                <span class="audit-count">${this.rows.length}${this.hasMore ? '+' : ''}</span>
            </div>
            <div class="audit-list" role="list">
                ${this.rows.map((row) => html`
                    <div class="audit-row" role="listitem">
                        <span class="audit-timestamp">${this._formatTimestamp(row.timestamp)}</span>
                        <span class="audit-action">${this._describeAction(row)}</span>
                        <span class="audit-collection">${this._collectionLabel(row.collection)}</span>
                    </div>
                `)}
                ${this.hasMore ? html`
                    <div class="load-more-row">
                        <button
                            class="load-more-btn"
                            ?disabled=${this.loading}
                            @click=${() => this.dispatchEvent(new CustomEvent('load-more'))}
                        >${this.loading ? t('audit.loading') : t('audit.loadMore')}</button>
                    </div>
                ` : ''}
            </div>
        `;
    }
}

customElements.define('audit-log', AuditLog);
