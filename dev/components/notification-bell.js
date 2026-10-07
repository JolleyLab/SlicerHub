import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import {
    listNotifications,
    markNotificationRead,
    markAllNotificationsRead,
    dismissNotification
} from '../services/notifications.js';
import { getPendingRegistrationsCount } from '../services/directus.js';

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
                top: -3px;
                right: -3px;
                width: 13px;
                height: 13px;
                padding: 0;
                border-radius: 50%;
                background: #f59e0b;
                border: 2.5px solid var(--color-primary);
                box-sizing: border-box;
                pointer-events: none;
                box-shadow: 0 1px 5px rgba(245, 158, 11, 0.6);
            }

            :host-context([data-theme='dark']) .badge {
                background: #fbbf24;
                border-color: var(--color-primary);
                box-shadow: 0 1px 6px rgba(251, 191, 36, 0.65);
            }

            .panel {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                width: min(360px, calc(100vw - 32px));
                max-height: min(420px, 70vh);
                display: flex;
                flex-direction: column;
                /* Solid elevated surface — avoid blending into page chrome */
                background: #ffffff;
                color: #040316;
                border: 2px solid #224f6b;
                border-radius: var(--radius-lg);
                /* Layered shadow for clear separation (≥ WCAG non-text affordance) */
                box-shadow:
                    0 0 0 1px color-mix(in srgb, #040316 12%, transparent),
                    0 12px 28px color-mix(in srgb, #040316 28%, transparent),
                    0 4px 10px color-mix(in srgb, #040316 18%, transparent);
                z-index: 40;
                overflow: hidden;
            }

            :host-context([data-theme='dark']) .panel {
                background: #1c2236;
                color: #f0f2f8;
                border-color: #8fa3d4;
                box-shadow:
                    0 0 0 1px color-mix(in srgb, #f0f2f8 18%, transparent),
                    0 14px 32px color-mix(in srgb, #000 65%, transparent),
                    0 4px 12px color-mix(in srgb, #000 45%, transparent);
            }

            .panel-head {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 12px 14px;
                border-bottom: 1px solid #224f6b;
                background: #f4f8fb;
                color: #040316;
            }

            :host-context([data-theme='dark']) .panel-head {
                background: #121726;
                border-bottom-color: #8fa3d4;
                color: #f0f2f8;
            }

            .panel-head strong {
                font-size: 0.95rem;
                color: inherit;
            }

            .panel-action {
                border: 1px solid transparent;
                border-radius: var(--radius-sm, 4px);
                background: transparent;
                color: #074174;
                font: inherit;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
                padding: 4px 8px;
            }

            :host-context([data-theme='dark']) .panel-action {
                color: #b8c8ef;
            }

            .panel-action:hover:not(:disabled),
            .panel-action:focus-visible:not(:disabled) {
                background: color-mix(in srgb, #074174 12%, #ffffff);
            }

            :host-context([data-theme='dark']) .panel-action:hover:not(:disabled),
            :host-context([data-theme='dark']) .panel-action:focus-visible:not(:disabled) {
                background: color-mix(in srgb, #b8c8ef 16%, transparent);
            }

            .panel-action:focus-visible:not(:disabled) {
                outline: 2px solid var(--color-focus, #0057c2);
                outline-offset: 1px;
            }

            /* Disabled: stay readable; signal inactive with border + muted fill, not washed-out opacity */
            .panel-action:disabled {
                color: #4a5568;
                background: #e8eef3;
                border-color: #9aa8b5;
                cursor: not-allowed;
                opacity: 1;
            }

            :host-context([data-theme='dark']) .panel-action:disabled {
                color: #aeb6c8;
                background: #2a3148;
                border-color: #5c6784;
            }

            .list {
                list-style: none;
                margin: 0;
                padding: 0;
                overflow-y: auto;
                flex: 1;
                background: #ffffff;
            }

            :host-context([data-theme='dark']) .list {
                background: #1c2236;
            }

            .item-row {
                position: relative;
                border-bottom: 1px solid color-mix(in srgb, #224f6b 45%, #ffffff);
            }

            :host-context([data-theme='dark']) .item-row {
                border-bottom-color: color-mix(in srgb, #8fa3d4 35%, #1c2236);
            }

            .item {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                width: 100%;
                padding: 12px 28px 12px 16px;
                border: none;
                border-left: 3px solid transparent;
                background: #ffffff;
                color: #0c0941;
                text-align: left;
                font: inherit;
                cursor: pointer;
                box-sizing: border-box;
            }

            .item:hover {
                background: #e8f0f6;
            }

            .item.unread {
                background: #dceaf4;
                border-left-color: #074174;
                color: #040316;
            }

            .item.unread:hover {
                background: #cfe2ef;
            }

            :host-context([data-theme='dark']) .item {
                background: #1c2236;
                color: #c2c8d8;
            }

            :host-context([data-theme='dark']) .item:hover {
                background: #252b42;
            }

            :host-context([data-theme='dark']) .item.unread {
                background: #252b48;
                border-left-color: #8fa3d4;
                color: #f0f2f8;
            }

            :host-context([data-theme='dark']) .item.unread:hover {
                background: #2d3454;
            }

            .dismiss {
                position: absolute;
                top: 4px;
                right: 4px;
                z-index: 1;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                margin: 0;
                padding: 0;
                border: none;
                border-radius: 4px;
                background: transparent;
                color: #0c0941;
                opacity: 0.4;
                cursor: pointer;
                font: inherit;
                font-size: 0.95rem;
                line-height: 1;
            }

            :host-context([data-theme='dark']) .dismiss {
                color: #c2c8d8;
            }

            .item-row:hover .dismiss,
            .dismiss:focus-visible {
                opacity: 0.8;
            }

            .dismiss:hover,
            .dismiss:focus-visible {
                opacity: 1;
                background: color-mix(in srgb, #224f6b 18%, #ffffff);
                color: #040316;
            }

            :host-context([data-theme='dark']) .dismiss:hover,
            :host-context([data-theme='dark']) .dismiss:focus-visible {
                background: color-mix(in srgb, #8fa3d4 22%, #1c2236);
                color: #f0f2f8;
            }

            .dismiss:focus-visible {
                outline: 2px solid var(--color-focus, #0057c2);
                outline-offset: 1px;
            }

            .item-title {
                font-weight: 500;
                font-size: 0.9rem;
                color: inherit;
            }

            .item.unread .item-title {
                font-weight: 700;
            }

            .item-body {
                font-size: 0.82rem;
                color: inherit;
                opacity: 0.92;
                line-height: 1.35;
            }

            .item.unread .item-body {
                opacity: 1;
            }

            .item-meta {
                font-size: 0.75rem;
                opacity: 0.8;
                color: inherit;
            }

            .item.unread .item-meta {
                opacity: 0.9;
            }

            .empty,
            .error {
                padding: 20px 14px;
                text-align: center;
                font-size: 0.9rem;
                color: #0c0941;
                background: #ffffff;
            }

            :host-context([data-theme='dark']) .empty,
            :host-context([data-theme='dark']) .error {
                color: #c2c8d8;
                background: #1c2236;
            }

            .error {
                color: #8a1212;
            }

            :host-context([data-theme='dark']) .error {
                color: #ffc9c2;
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
            error: { type: String },
            isRegistrationReviewer: { type: Boolean },
            _pendingRegCount: { type: Number }
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
        this.isRegistrationReviewer = false;
        this._pendingRegCount = 0;
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

    updated(changedProps) {
        if (changedProps.has('isRegistrationReviewer') && this.isRegistrationReviewer) {
            this.refresh({ quiet: true });
        }
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
            const [data, pendingCount] = await Promise.all([
                listNotifications(),
                this.isRegistrationReviewer ? getPendingRegistrationsCount() : Promise.resolve(0)
            ]);
            this.notifications = Array.isArray(data.notifications) ? data.notifications : [];
            this.unreadCount = Number(data.unreadCount) || 0;
            this._pendingRegCount = pendingCount;
            this.error = '';
        } catch (err) {
            if (!quiet) {
                this.error = err?.message || t('notifications.loadFailed');
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
        return this.unreadCount > 0 || this._pendingRegCount > 0;
    }

    _firePendingRegistrations() {
        this.open = false;
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey: 'admin-registrations' },
            bubbles: true,
            composed: true
        }));
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
            this.error = err?.message || t('notifications.markAllFailed');
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

    async handleDismiss(event, notification) {
        event.preventDefault();
        event.stopPropagation();
        try {
            const data = await dismissNotification(notification.id);
            const wasUnread = !notification.read_at;
            this.notifications = this.notifications.filter((n) => n.id !== notification.id);
            if (typeof data?.unreadCount === 'number') {
                this.unreadCount = data.unreadCount;
            } else if (wasUnread) {
                this.unreadCount = Math.max(0, this.unreadCount - 1);
            }
            this.error = '';
        } catch (err) {
            this.error = err?.message || t('notifications.dismissFailed');
        }
    }

    render() {
        const hasUnread = this.hasUnread();
        return html`
            <button
                class="bell-button"
                type="button"
                aria-label=${hasUnread
                    ? t('notifications.unreadBell')
                    : t('notifications.title')}
                aria-expanded=${this.open ? 'true' : 'false'}
                @click=${() => this.toggleOpen()}
            >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">
                    <path d="M14.857 17.082a23.848 23.848 0 0 0 5.454-1.31A8.967 8.967 0 0 1 18 9.75V9A6 6 0 0 0 6 9v.75a8.967 8.967 0 0 1-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 0 1-5.714 0m5.714 0a3 3 0 1 1-5.714 0" />
                </svg>
                ${hasUnread ? html`<span class="badge" aria-hidden="true"></span>` : ''}
            </button>
            ${this.open ? html`
                <div class="panel" role="dialog" aria-label=${t('notifications.title')}>
                    <div class="panel-head">
                        <strong>${t('notifications.title')}</strong>
                        <button
                            class="panel-action"
                            type="button"
                            ?disabled=${!this.unreadCount}
                            @click=${() => this.handleMarkAll()}
                        >${t('notifications.markAllRead')}</button>
                    </div>
                    ${this.error ? html`<p class="error">${this.error}</p>` : ''}
                    ${this._pendingRegCount > 0 ? html`
                        <ul class="list">
                            <li class="item-row">
                                <button
                                    type="button"
                                    class="item unread"
                                    @click=${() => this._firePendingRegistrations()}
                                >
                                    <span class="item-title">${this._pendingRegCount === 1
                                        ? t('notifications.pendingRegistration')
                                        : t('notifications.pendingRegistrations', { count: this._pendingRegCount })
                                    }</span>
                                    <span class="item-body">${t('notifications.pendingRegistrationsBody')}</span>
                                </button>
                            </li>
                        </ul>
                    ` : ''}
                    ${this.loading && !this.notifications.length
                        ? html`<p class="empty">${t('common.loading')}</p>`
                        : (!this.notifications.length && !this._pendingRegCount
                            ? html`<p class="empty">${t('notifications.empty')}</p>`
                            : this.notifications.length > 0 ? html`
                                <ul class="list">
                                    ${this.notifications.map((n) => html`
                                        <li class="item-row">
                                            <button
                                                class="dismiss"
                                                type="button"
                                                title=${t('notifications.dismiss')}
                                                aria-label=${t('notifications.dismissAria')}
                                                @click=${(e) => this.handleDismiss(e, n)}
                                            >×</button>
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
                            ` : '')}
                </div>
            ` : ''}
        `;
    }
}

customElements.define('notification-bell', NotificationBell);
