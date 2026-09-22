import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import {
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead
} from '../services/notifications.js';

/**
 * Global notification bell for the product inbox (any notification type).
 * Placed next to the user avatar in navigation-header.
 */
export class NotificationBell extends LitElement {
    static get styles() {
        return css`
            :host {
                position: relative;
                display: inline-flex;
                align-items: center;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .bell-button {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                padding: 0;
                border: 1px solid color-mix(in srgb, var(--color-on-primary) 40%, transparent);
                border-radius: 50%;
                background: color-mix(in srgb, var(--color-on-primary) 12%, transparent);
                color: var(--color-on-primary);
                cursor: pointer;
                font-family: inherit;
            }

            .bell-button:hover,
            .bell-button:focus-visible {
                background: color-mix(in srgb, var(--color-on-primary) 22%, transparent);
            }

            .bell-button:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
            }

            .bell-button svg {
                width: 18px;
                height: 18px;
                display: block;
            }

            .badge {
                position: absolute;
                top: 4px;
                right: 4px;
                width: 9px;
                height: 9px;
                padding: 0;
                border-radius: 50%;
                background: var(--color-accent, var(--color-secondary));
                border: 2px solid var(--color-primary);
                box-sizing: border-box;
                pointer-events: none;
            }

            :host-context([data-theme='dark']) .badge {
                background: var(--color-accent, var(--color-secondary));
                border-color: var(--color-primary);
            }

            .panel {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                width: min(360px, calc(100vw - 32px));
                max-height: min(420px, 70vh);
                display: flex;
                flex-direction: column;
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                box-shadow: 0 10px 28px var(--color-shadow, rgba(0, 0, 0, 0.16));
                z-index: 30;
                overflow: hidden;
            }

            .panel-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 12px 14px;
                border-bottom: 1px solid var(--color-border);
            }

            .panel-head strong {
                font-size: 0.95rem;
            }

            .panel-action {
                border: none;
                background: transparent;
                color: var(--color-primary);
                font: inherit;
                font-size: 0.85rem;
                cursor: pointer;
                padding: 4px 6px;
            }

            .panel-action:disabled {
                opacity: 0.45;
                cursor: default;
            }

            .list {
                list-style: none;
                margin: 0;
                padding: 0;
                overflow-y: auto;
                flex: 1;
            }

            .item {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                width: 100%;
                padding: 12px 14px 12px 16px;
                border: none;
                border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
                border-left: 3px solid transparent;
                background: color-mix(in srgb, var(--color-border) 8%, transparent);
                color: var(--color-text-secondary);
                text-align: left;
                font: inherit;
                cursor: pointer;
                box-sizing: border-box;
            }

            .item:hover {
                background: color-mix(in srgb, var(--color-border) 18%, transparent);
            }

            .item.unread {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-panel, var(--color-surface, var(--color-background))));
                border-left-color: var(--color-primary);
                color: var(--color-text-primary);
            }

            .item.unread:hover {
                background: color-mix(in srgb, var(--color-primary) 20%, var(--color-panel, var(--color-surface, var(--color-background))));
            }

            .item-title {
                font-weight: 500;
                font-size: 0.9rem;
            }

            .item.unread .item-title {
                font-weight: 700;
            }

            .item-body {
                font-size: 0.82rem;
                color: inherit;
                opacity: 0.85;
                line-height: 1.35;
            }

            .item.unread .item-body {
                opacity: 1;
                color: var(--color-text-secondary);
            }

            .item-meta {
                font-size: 0.75rem;
                opacity: 0.75;
            }

            .item.unread .item-meta {
                opacity: 0.9;
            }

            :host-context([data-theme='dark']) .item {
                background: color-mix(in srgb, #000 22%, transparent);
            }

            :host-context([data-theme='dark']) .item.unread {
                background: color-mix(in srgb, var(--color-primary) 22%, transparent);
            }

            .empty,
            .error {
                padding: 20px 14px;
                text-align: center;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
            }

            .error {
                color: #c62828;
            }

            :host-context([data-theme='dark']) .bell-button {
                background: color-mix(in srgb, var(--color-on-primary) 14%, transparent);
                border-color: color-mix(in srgb, var(--color-on-primary) 35%, transparent);
            }
        `;
    }

    static get properties() {
        return {
            open: { type: Boolean },
            loading: { type: Boolean },
            notifications: { type: Array },
            unreadCount: { type: Number },
            error: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.open = false;
        this.loading = false;
        this.notifications = [];
        this.unreadCount = 0;
        this.error = '';
        this._pollTimer = null;
        this._onDocPointer = (e) => this.handleDocPointer(e);
        this._onInvalidate = () => this.refresh({ quiet: true });
    }

    connectedCallback() {
        super.connectedCallback();
        this.refresh({ quiet: true });
        this._pollTimer = setInterval(() => this.refresh({ quiet: true }), 60000);
        document.addEventListener('pointerdown', this._onDocPointer, true);
        window.addEventListener('notifications-invalidate', this._onInvalidate);
    }

    disconnectedCallback() {
        if (this._pollTimer) clearInterval(this._pollTimer);
        document.removeEventListener('pointerdown', this._onDocPointer, true);
        window.removeEventListener('notifications-invalidate', this._onInvalidate);
        super.disconnectedCallback();
    }

    handleDocPointer(event) {
        if (!this.open) return;
        const path = event.composedPath?.() || [];
        if (!path.includes(this)) this.open = false;
    }

    async refresh({ quiet = false } = {}) {
        if (!quiet) this.loading = true;
        try {
            const data = await listNotifications();
            this.notifications = Array.isArray(data.notifications) ? data.notifications : [];
            this.unreadCount = Number(data.unreadCount) || 0;
            this.error = '';
        } catch (err) {
            if (!quiet) {
                this.error = err?.message || "Couldn't load notifications.";
            }
        } finally {
            this.loading = false;
        }
    }

    async toggleOpen() {
        this.open = !this.open;
        if (this.open) await this.refresh();
    }

    hasUnread() {
        return this.unreadCount > 0;
    }

    formatWhen(value) {
        const ms = Date.parse(value || '');
        if (!Number.isFinite(ms)) return '';
        try {
            return new Date(ms).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short'
            });
        } catch {
            return '';
        }
    }

    async handleMarkAll() {
        if (!this.unreadCount) return;
        try {
            await markAllNotificationsRead();
            await this.refresh();
        } catch (err) {
            this.error = err?.message || "Couldn't mark notifications read.";
        }
    }

    async handleItemClick(notification) {
        try {
            if (!notification.read_at) {
                await markNotificationRead(notification.id);
                this.unreadCount = Math.max(0, this.unreadCount - 1);
                this.notifications = this.notifications.map((n) => (
                    n.id === notification.id
                        ? { ...n, read_at: n.read_at || new Date().toISOString() }
                        : n
                ));
            }
        } catch {
            // still allow navigation
        }
        this.open = false;
        this.dispatchEvent(new CustomEvent('notification-open', {
            detail: {
                id: notification.id,
                type: notification.type,
                caseId: notification.case_id || notification.caseId || null,
                inviteId: notification.invite_id || notification.inviteId || null,
                notification
            },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        const hasUnread = this.hasUnread();
        return html`
            <button
                class="bell-button"
                type="button"
                aria-label=${hasUnread
                    ? 'Notifications, unread items'
                    : 'Notifications'}
                aria-expanded=${this.open ? 'true' : 'false'}
                @click=${() => this.toggleOpen()}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
                    <path
                        fill="currentColor"
                        d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22zm6-6V11a6 6 0 1 0-12 0v5l-2 2v1h16v-1l-2-2z"
                    />
                </svg>
                ${hasUnread ? html`<span class="badge" aria-hidden="true"></span>` : ''}
            </button>
            ${this.open ? html`
                <div class="panel" role="dialog" aria-label="Notifications">
                    <div class="panel-head">
                        <strong>Notifications</strong>
                        <button
                            class="panel-action"
                            type="button"
                            ?disabled=${!this.unreadCount}
                            @click=${() => this.handleMarkAll()}
                        >Mark all read</button>
                    </div>
                    ${this.error ? html`<p class="error">${this.error}</p>` : ''}
                    ${this.loading && !this.notifications.length
                        ? html`<p class="empty">Loading…</p>`
                        : (!this.notifications.length
                            ? html`<p class="empty">No notifications yet.</p>`
                            : html`
                                <ul class="list">
                                    ${this.notifications.map((n) => html`
                                        <li>
                                            <button
                                                type="button"
                                                class="item ${n.read_at ? '' : 'unread'}"
                                                @click=${() => this.handleItemClick(n)}
                                            >
                                                <span class="item-title">${n.title}</span>
                                                ${n.body ? html`
                                                    <span class="item-body">${n.body}</span>
                                                ` : ''}
                                                <span class="item-meta">${this.formatWhen(n.created_at)}</span>
                                            </button>
                                        </li>
                                    `)}
                                </ul>
                            `)}
                </div>
            ` : ''}
        `;
    }
}

customElements.define('notification-bell', NotificationBell);
