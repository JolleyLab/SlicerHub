import { LitElement, html, css } from 'lit-element';
import { avatarCircleStyles } from '../styles/avatar.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

/**
 * Reusable comments list + optional compose box (chat-style).
 *
 * Expected comment shape:
 *   { id, body, createdAt, author?: { name } }
 *
 * Props:
 *   collaborators — [{ id: string (Directus uuid), name: string }]
 *     Pass the case's collaborator list so the @-mention picker can offer names.
 *     The posted text will contain @uuid (what Directus expects); the textarea
 *     shows @Name while the user is composing.
 *
 * Events:
 *   post-comment — detail: { text } (compose submit, mentions already resolved to @uuid)
 */
export class CommentsPanel extends LitElement {
    static get styles() {
        return [avatarCircleStyles, css`
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
                font-size: 0.72rem;
                font-weight: 700;
                letter-spacing: 0.02em;
                /* Light initials on dark fills — keeps ≥4.5:1 in both themes. */
                color: #f5f6fb;
                background: #2c3878;
                border: 1px solid color-mix(in srgb, var(--color-border) 55%, transparent);
                flex-shrink: 0;
            }

            .avatar.tone-a { background: #2c3878; color: #f5f6fb; }
            .avatar.tone-b { background: #1e5a72; color: #f5f6fb; }
            .avatar.tone-c { background: #3d2f6e; color: #f5f6fb; }

            :host-context([data-theme='light']) .avatar,
            :host-context([data-theme='light']) .avatar.tone-a { background: #074174; color: #ecf4f9; }
            :host-context([data-theme='light']) .avatar.tone-b { background: #0f5f86; color: #ecf4f9; }
            :host-context([data-theme='light']) .avatar.tone-c { background: #1a3d6e; color: #ecf4f9; }

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

            .mention-chip {
                display: inline;
                color: var(--color-primary, #2c3878);
                font-weight: 600;
            }

            :host-context([data-theme='dark']) .mention-chip {
                color: var(--color-accent, #7fa8d4);
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

            /* Wraps the textarea so the mention dropdown can be absolutely positioned */
            .textarea-wrap {
                position: relative;
                min-width: 0;
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

            /* @-mention autocomplete dropdown */
            .mention-dropdown {
                position: absolute;
                bottom: calc(100% + 4px);
                left: 0;
                right: 0;
                margin: 0;
                padding: 4px 0;
                list-style: none;
                background: var(--color-panel, #fff);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
                overflow-y: auto;
                max-height: 220px;
                z-index: 10;
            }

            :host-context([data-theme='dark']) .mention-dropdown {
                background: var(--color-panel);
                border-color: var(--color-border);
                box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
            }

            .mention-item {
                display: flex;
                align-items: center;
                gap: 10px;
                width: 100%;
                padding: 7px 12px;
                border: none;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-size: 0.88rem;
                text-align: left;
                cursor: pointer;
                box-sizing: border-box;
            }

            .mention-item:hover,
            .mention-item[aria-selected='true'] {
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
            }

            .mention-item:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: -2px;
            }

            .mention-avatar {
                flex-shrink: 0;
                width: 26px;
                height: 26px;
                border-radius: 50%;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.7rem;
                font-weight: 700;
                color: #f5f6fb;
                background: #2c3878;
            }

            :host-context([data-theme='light']) .mention-avatar {
                background: #074174;
                color: #ecf4f9;
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
        `];
    }

    static get properties() {
        return {
            comments: { type: Array },
            /** [{ id: string (uuid), name: string }] — collaborators available to @-mention */
            collaborators: { type: Array },
            title: { type: String },
            emptyMessage: { type: String },
            placeholder: { type: String },
            submitLabel: { type: String },
            postingLabel: { type: String },
            allowCompose: { type: Boolean },
            posting: { type: Boolean },
            draft: { type: String },
            /** null = not in a mention; string = active @query */
            _mentionQuery: { type: String },
            /** keyboard-selected index in the dropdown */
            _mentionIndex: { type: Number }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.comments = [];
        this.collaborators = [];
        this.title = t('comments.title');
        this.emptyMessage = t('comments.empty');
        this.placeholder = t('comments.placeholder');
        this.submitLabel = t('comments.send');
        this.postingLabel = t('comments.sending');
        this.allowCompose = true;
        this.posting = false;
        this.draft = '';
        this._mentionQuery = null;
        this._mentionIndex = 0;
        this._mentionStart = 0;   // cursor index in draft where the @ token started
        this._mentionMap = {};    // { displayName: uuid } for inserted mentions in this draft
    }

    clearDraft() {
        this.draft = '';
        this._mentionQuery = null;
        this._mentionMap = {};
    }

    /** Collaborators whose name contains the current @query, capped at 8. */
    get _mentionSuggestions() {
        if (this._mentionQuery === null || !Array.isArray(this.collaborators)) return [];
        const q = this._mentionQuery.toLowerCase();
        return this.collaborators
            .filter((c) => !q || c.name.toLowerCase().includes(q))
            .slice(0, 8);
    }

    authorName(comment) {
        return comment?.author?.name || t('comments.unknownAuthor');
    }

    authorInitials(name) {
        const parts = String(name || '?').trim().split(/\s+/).filter(Boolean);
        if (parts.length === 0) return '?';
        if (parts.length === 1) return parts[0][0].toUpperCase();
        return `${parts[0][0] || ''}${parts[parts.length - 1][0] || ''}`.toUpperCase();
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
                return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
            }
            return date.toLocaleString(undefined, {
                month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit'
            });
        } catch {
            return String(iso);
        }
    }

    handleDraftInput(event) {
        this.draft = event.target.value;
        this._detectMention(event.target);
    }

    /** Look behind the cursor for an active @query. Updates _mentionQuery and _mentionStart. */
    _detectMention(textarea) {
        const pos = textarea.selectionStart;
        const before = textarea.value.slice(0, pos);
        // Match @ followed by non-whitespace chars right up to the cursor
        const match = before.match(/@(\S*)$/);
        if (match) {
            this._mentionStart = pos - match[0].length;
            this._mentionQuery = match[1];
            this._mentionIndex = 0;
        } else {
            this._mentionQuery = null;
        }
    }

    handleComposeKeydown(event) {
        const suggestions = this._mentionSuggestions;
        // While the dropdown is open, intercept arrow/enter/escape keys
        if (suggestions.length && this._mentionQuery !== null) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                this._mentionIndex = (this._mentionIndex + 1) % suggestions.length;
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                this._mentionIndex = (this._mentionIndex - 1 + suggestions.length) % suggestions.length;
                return;
            }
            if (event.key === 'Enter') {
                event.preventDefault();
                this._insertMention(suggestions[this._mentionIndex]);
                return;
            }
            if (event.key === 'Escape') {
                this._mentionQuery = null;
                return;
            }
        }
        if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault();
            this.handlePost();
        }
    }

    /** Replace the active @query in the draft with @Name and record the uuid mapping. */
    _insertMention(collaborator) {
        const textarea = this.shadowRoot?.querySelector('textarea');
        if (!textarea) return;
        const token = `@${collaborator.name} `;
        const cursorPos = textarea.selectionStart;
        const before = this.draft.slice(0, this._mentionStart);
        const after = this.draft.slice(cursorPos);
        this.draft = before + token + after;
        this._mentionMap = { ...this._mentionMap, [collaborator.name]: collaborator.id };
        this._mentionQuery = null;
        // Restore cursor after the inserted token
        const newPos = before.length + token.length;
        this.updateComplete.then(() => {
            const t = this.shadowRoot?.querySelector('textarea');
            if (t) {
                t.setSelectionRange(newPos, newPos);
                t.focus();
            }
        });
    }

    handlePost() {
        const text = String(this.draft || '').trim();
        if (!text || this.posting || !this.allowCompose) return;
        // Substitute each @DisplayName with @uuid before sending to Directus
        let resolved = text;
        for (const [name, uuid] of Object.entries(this._mentionMap)) {
            resolved = resolved.split(`@${name}`).join(`@${uuid}`);
        }
        this.dispatchEvent(new CustomEvent('post-comment', {
            detail: { text: resolved },
            bubbles: true,
            composed: true
        }));
    }

    updated(changed) {
        if (changed.has('comments')) {
            const thread = this.shadowRoot?.querySelector?.('.chat-thread');
            if (thread) {
                requestAnimationFrame(() => { thread.scrollTop = thread.scrollHeight; });
            }
        }
    }

    /** Resolve @uuid tokens in body text to @Name chips using the collaborators list. */
    renderBody(text) {
        const idToName = new Map((this.collaborators || []).map(c => [c.id, c.name]));
        // UUID pattern: 8-4-4-4-12 hex groups
        const parts = String(text || '').split(/(@[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i);
        return parts.map((part) => {
            if (part.startsWith('@')) {
                const id = part.slice(1);
                const name = idToName.get(id);
                return name
                    ? html`<span class="mention-chip">@${name}</span>`
                    : part; // unknown uuid — render as-is
            }
            return part;
        });
    }

    renderComment(comment) {
        const name = this.authorName(comment);
        return html`
            <div class="comment-row">
                <div class="avatar ${comment.author?.avatarUrl ? '' : this.authorTone(name)}" aria-hidden="true">
                    ${comment.author?.avatarUrl
                        ? html`<img src=${comment.author.avatarUrl} alt="">`
                        : this.authorInitials(name)}
                </div>
                <div class="bubble">
                    <div class="comment-header">
                        <span class="comment-author">${name}</span>
                        <span class="comment-date">${this.formatCommentDate(comment.createdAt)}</span>
                    </div>
                    <p class="comment-body">${this.renderBody(comment.body)}</p>
                </div>
            </div>
        `;
    }

    renderMentionDropdown(suggestions) {
        if (!suggestions.length) return '';
        return html`
            <ul
                class="mention-dropdown"
                role="listbox"
                aria-label=${t('comments.mentionList')}
            >
                ${suggestions.map((c, i) => html`
                    <li role="presentation">
                        <button
                            type="button"
                            class="mention-item"
                            role="option"
                            aria-selected=${i === this._mentionIndex ? 'true' : 'false'}
                            @mousedown=${(e) => { e.preventDefault(); this._insertMention(c); }}
                        >
                            <span class="mention-avatar" aria-hidden="true">
                                ${this.authorInitials(c.name)}
                            </span>
                            ${c.name}
                        </button>
                    </li>
                `)}
            </ul>
        `;
    }

    render() {
        const comments = Array.isArray(this.comments) ? this.comments : [];
        const canPost = !this.posting && !!String(this.draft || '').trim();
        const suggestions = this._mentionSuggestions;

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
                    <div class="textarea-wrap">
                        <textarea
                            placeholder=${this.placeholder}
                            .value=${this.draft}
                            ?disabled=${this.posting}
                            @input=${this.handleDraftInput}
                            @keydown=${this.handleComposeKeydown}
                        ></textarea>
                        ${this.renderMentionDropdown(suggestions)}
                    </div>
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
