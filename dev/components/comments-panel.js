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
                border-left: 4px solid var(--color-primary);
                border-radius: var(--radius-lg);
                background: var(--color-panel, #fff);
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
                overflow: hidden;
                box-sizing: border-box;
            }

            :host-context([data-theme='dark']) {
                border-color: var(--color-border);
                border-left-color: var(--color-accent);
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
                background: var(--color-panel);
            }

            .chat-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 10px;
                min-height: 44px;
                padding: 0 16px;
                border-bottom: 1px solid var(--color-border);
                background: var(--color-panel, #fff);
                flex-shrink: 0;
                box-sizing: border-box;
            }

            :host-context([data-theme='dark']) .chat-header {
                background: var(--color-panel);
                border-bottom-color: var(--color-border);
            }

            .comments-title {
                margin: 0;
                font-size: 0.72rem;
                font-weight: 700;
                letter-spacing: 0.07em;
                text-transform: uppercase;
                color: var(--color-text-secondary);
            }

            .comments-count {
                font-size: 0.72rem;
                font-weight: 650;
                color: var(--color-text-secondary);
                background: color-mix(in srgb, var(--color-border) 16%, transparent);
                border: 1px solid var(--color-border);
                border-radius: 999px;
                padding: 2px 8px;
                line-height: 1.3;
            }

            :host-context([data-theme='dark']) .comments-count {
                color: var(--color-text-secondary);
                background: color-mix(in srgb, var(--color-border) 40%, transparent);
                border-color: var(--color-border);
            }

            .chat-thread {
                flex: 1;
                min-height: 0;
                overflow-y: auto;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 12px 16px;
                background: color-mix(in srgb, var(--color-background) 55%, var(--color-panel, #fff));
            }

            :host-context([data-theme='dark']) .chat-thread {
                background: var(--color-background);
            }

            .empty-note {
                margin: auto;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 0.875rem;
                font-style: italic;
                max-width: 220px;
                line-height: 1.45;
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
                background: var(--color-panel, #fff);
                border: 1px solid var(--color-border);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
            }

            :host-context([data-theme='dark']) .bubble {
                background: var(--color-panel);
                border-color: var(--color-border);
                box-shadow: 0 1px 2px rgba(0, 0, 0, 0.22);
            }

            :host-context([data-theme='dark']) .comment-date,
            :host-context([data-theme='dark']) .empty-note {
                color: var(--color-text-secondary);
            }

            :host-context([data-theme='dark']) .comment-compose {
                background: var(--color-panel);
                border-top-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .comment-compose textarea {
                background: var(--color-background);
                border-color: var(--color-border);
                color: var(--color-text-primary);
            }

            :host-context([data-theme='dark']) .primary-button {
                background: var(--color-accent);
                color: var(--color-on-primary);
                border-color: var(--color-accent);
            }

            :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-accent) 85%, #ffffff);
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
                align-items: center;
                min-height: 56px;
                padding: 10px 16px;
                border-top: 1px solid var(--color-border);
                background: var(--color-panel, #fff);
                box-sizing: border-box;
            }

            .comment-compose textarea {
                width: 100%;
                min-height: 36px;
                max-height: 120px;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                padding: 8px 12px;
                font: inherit;
                font-size: 0.875rem;
                color: var(--color-text-primary);
                background: var(--color-background);
                resize: vertical;
            }

            .comment-compose textarea:focus-visible {
                outline: none;
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
            }

            .primary-button {
                border: 1px solid transparent;
                border-radius: 6px;
                min-height: 36px;
                padding: 8px 18px;
                font: inherit;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
                background: var(--color-primary);
                color: var(--color-on-primary);
                white-space: nowrap;
                display: inline-flex;
                align-items: center;
                line-height: 1.2;
            }

            .primary-button:hover:not(:disabled) {
                opacity: 0.87;
                box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 32%, transparent);
            }

            .primary-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .primary-button:disabled {
                opacity: 0.55;
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
