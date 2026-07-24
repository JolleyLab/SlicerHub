import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * Reusable comments list + optional compose box (chat-style).
 *
 * Expected comment shape:
 *   { id, body, createdAt, author?: { name } }
 *
 * Events:
 *   post-comment — detail: { text } (compose submit)
 */
export class CommentsPanel extends LitElement {
    static get styles() {
        return css`
            :host {
                display: flex;
                flex-direction: column;
                min-height: 360px;
                height: var(--comments-panel-height, auto);
                max-height: var(--comments-panel-max-height, 560px);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
                overflow: hidden;
                box-sizing: border-box;
            }

            :host-context([data-theme='dark']) {
                border-color: var(--color-border);
                box-shadow: 0 3px 14px rgba(0, 0, 0, 0.32);
            }

            .chat-header {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 10px;
                padding: 12px 14px;
                background: var(--color-primary);
                color: var(--color-on-primary);
                flex-shrink: 0;
            }

            :host-context([data-theme='dark']) .chat-header {
                background: color-mix(in srgb, var(--color-primary) 82%, #0c1020);
                color: var(--color-on-primary);
                border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-primary));
            }

            :host-context([data-theme='dark']) .comments-count {
                color: var(--color-on-primary);
                opacity: 0.92;
            }

            .comments-title {
                margin: 0;
                font-weight: 650;
                font-size: 0.98rem;
                letter-spacing: 0.01em;
            }

            .comments-count {
                font-size: 0.82rem;
                opacity: 0.85;
                font-weight: 500;
            }

            .chat-thread {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 14px;
                background: transparent;
            }

            .empty-note {
                margin: auto;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 0.95rem;
                max-width: 220px;
                line-height: 1.4;
            }

            .comment-row {
                display: grid;
                grid-template-columns: 36px minmax(0, 1fr);
                gap: 10px;
                align-items: start;
                max-width: min(100%, 520px);
            }

            .avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.72rem;
                font-weight: 700;
                letter-spacing: 0.02em;
                /* Light initials on dark fills — keeps ≥4.5:1 in both themes. */
                color: #f5f6fb;
                background: #2c3878;
                border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
                flex-shrink: 0;
            }

            .avatar.tone-a {
                background: #2c3878;
                color: #f5f6fb;
            }

            .avatar.tone-b {
                background: #1e5a72;
                color: #f5f6fb;
            }

            .avatar.tone-c {
                background: #3d2f6e;
                color: #f5f6fb;
            }

            :host-context([data-theme='light']) .avatar,
            :host-context([data-theme='light']) .avatar.tone-a {
                background: #074174;
                color: #ecf4f9;
            }

            :host-context([data-theme='light']) .avatar.tone-b {
                background: #0f5f86;
                color: #ecf4f9;
            }

            :host-context([data-theme='light']) .avatar.tone-c {
                background: #1a3d6e;
                color: #ecf4f9;
            }

            .bubble {
                border-radius: var(--radius-sm) var(--radius-lg) var(--radius-lg) var(--radius-lg);
                padding: 8px 12px 10px;
                background: var(--color-background);
                border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
            }

            :host-context([data-theme='dark']) .bubble {
                background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface));
                border-color: var(--color-border);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
            }

            :host-context([data-theme='dark']) .comment-date,
            :host-context([data-theme='dark']) .empty-note {
                color: var(--color-text-secondary);
            }

            :host-context([data-theme='dark']) .comment-compose {
                background: color-mix(in srgb, var(--color-primary) 6%, var(--color-panel));
                border-top-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .comment-compose textarea {
                background: var(--color-surface);
                border-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .primary-button {
                background: var(--color-primary);
                color: var(--color-on-primary);
                border-color: color-mix(in srgb, var(--color-primary) 70%, var(--color-border));
            }

            :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, var(--color-secondary));
                color: var(--color-on-primary);
            }

            .comment-header {
                display: flex;
                flex-wrap: nowrap;
                align-items: baseline;
                justify-content: space-between;
                gap: 10px;
                margin-bottom: 4px;
                width: 100%;
            }

            .comment-author {
                font-weight: 650;
                color: var(--color-text-primary);
                font-size: 0.88rem;
                min-width: 0;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .comment-date {
                color: var(--color-text-secondary);
                font-size: 0.75rem;
                flex-shrink: 0;
                text-align: right;
                white-space: nowrap;
            }

            .comment-body {
                margin: 0;
                color: var(--color-text-primary);
                font-size: 0.92rem;
                line-height: 1.45;
                white-space: pre-wrap;
                word-break: break-word;
            }

            .comment-compose {
                flex-shrink: 0;
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                gap: 10px;
                align-items: end;
                padding: 12px;
                border-top: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
                background: color-mix(in srgb, var(--color-primary) 5%, var(--color-panel, var(--color-surface, var(--color-background))));
            }

            .comment-compose textarea {
                width: 100%;
                min-height: 44px;
                max-height: 120px;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm);
                padding: 10px 12px;
                font: inherit;
                color: var(--color-text-primary);
                background: var(--color-background);
                resize: vertical;
            }

            .comment-compose textarea:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .primary-button:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                min-height: 44px;
                padding: 8px 16px;
                font: inherit;
                font-weight: 650;
                cursor: pointer;
                background: var(--color-primary);
                color: var(--color-on-primary);
                white-space: nowrap;
            }

            .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .primary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
        `;
    }

    static get properties() {
        return {
            comments: { type: Array },
            title: { type: String },
            emptyMessage: { type: String },
            placeholder: { type: String },
            submitLabel: { type: String },
            postingLabel: { type: String },
            allowCompose: { type: Boolean },
            posting: { type: Boolean },
            draft: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.comments = [];
        this.title = 'Comments';
        this.emptyMessage = 'No comments yet.';
        this.placeholder = 'Write a message…';
        this.submitLabel = 'Send';
        this.postingLabel = 'Sending…';
        this.allowCompose = true;
        this.posting = false;
        this.draft = '';
    }

    clearDraft() {
        this.draft = '';
    }

    authorName(comment) {
        return comment?.author?.name || 'Unknown';
    }

    authorInitials(name) {
        const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
        return `${parts[0][0] || ''}${parts[1][0] || ''}`.toUpperCase();
    }

    authorTone(name) {
        const raw = String(name || '');
        let hash = 0;
        for (let i = 0; i < raw.length; i += 1) {
            hash = ((hash << 5) - hash) + raw.charCodeAt(i);
            hash |= 0;
        }
        const tones = ['tone-a', 'tone-b', 'tone-c'];
        return tones[Math.abs(hash) % tones.length];
    }

    formatCommentDate(iso) {
        if (!iso) return '';
        try {
            const date = new Date(iso);
            const now = new Date();
            const sameDay = date.toDateString() === now.toDateString();
            if (sameDay) {
                return date.toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit'
                });
            }
            return date.toLocaleString(undefined, {
                month: 'short',
                day: 'numeric',
                hour: 'numeric',
                minute: '2-digit'
            });
        } catch {
            return String(iso);
        }
    }

    handleDraftInput(event) {
        this.draft = event.target.value;
    }

    handleComposeKeydown(event) {
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handlePost();
        }
    }

    handlePost() {
        const text = String(this.draft || '').trim();
        if (!text || this.posting || !this.allowCompose) return;
        this.dispatchEvent(new CustomEvent('post-comment', {
            detail: { text },
            bubbles: true,
            composed: true
        }));
    }

    updated(changed) {
        if (changed.has('comments')) {
            const thread = this.shadowRoot?.querySelector?.('.chat-thread');
            if (thread) {
                requestAnimationFrame(() => {
                    thread.scrollTop = thread.scrollHeight;
                });
            }
        }
    }

    renderComment(comment) {
        const name = this.authorName(comment);
        return html`
            <div class="comment-row">
                <div class="avatar ${this.authorTone(name)}" aria-hidden="true">
                    ${this.authorInitials(name)}
                </div>
                <div class="bubble">
                    <div class="comment-header">
                        <span class="comment-author">${name}</span>
                        <span class="comment-date">${this.formatCommentDate(comment.createdAt)}</span>
                    </div>
                    <p class="comment-body">${comment.body || ''}</p>
                </div>
            </div>
        `;
    }

    render() {
        const comments = Array.isArray(this.comments) ? this.comments : [];
        const canPost = !this.posting && !!String(this.draft || '').trim();

        return html`
            <div class="chat-header">
                <h3 class="comments-title">${this.title}</h3>
                <span class="comments-count">${comments.length}</span>
            </div>
            <div class="chat-thread">
                ${comments.length === 0 ? html`
                    <div class="empty-note">${this.emptyMessage}</div>
                ` : comments.map((comment) => this.renderComment(comment))}
            </div>
            ${this.allowCompose ? html`
                <div class="comment-compose">
                    <textarea
                        placeholder=${this.placeholder}
                        .value=${this.draft}
                        ?disabled=${this.posting}
                        @input=${this.handleDraftInput}
                        @keydown=${this.handleComposeKeydown}
                    ></textarea>
                    <button
                        class="primary-button"
                        type="button"
                        ?disabled=${!canPost}
                        @click=${this.handlePost}
                    >
                        ${this.posting ? this.postingLabel : this.submitLabel}
                    </button>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('comments-panel', CommentsPanel);
