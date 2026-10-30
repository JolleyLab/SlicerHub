import { listNotifications } from './notifications.js';
import { getPendingRegistrationsCount } from './registrations.js';
import { getPendingCaseInvitesCount } from './cases.js';

const POLL_MS = 60_000;

class NotificationStore {
    constructor() {
        this._state = {
            notifications: [],
            unreadCount: 0,
            pendingRegCount: 0,
            pendingInviteCount: 0,
            loading: false
        };
        this._subscribers = new Set();
        this._pollTimer = null;
        this._isRegistrationReviewer = false;
        this._onInvalidate = () => this.refresh({ quiet: true });
        this._onVisibilityChange = () => {
            if (document.visibilityState === 'visible') this.refresh({ quiet: true });
        };
    }

    /**
     * Subscribe to state changes. The callback fires immediately with the current state
     * and again on every update. Returns an unsubscribe function.
     */
    subscribe(callback) {
        const first = this._subscribers.size === 0;
        this._subscribers.add(callback);
        if (first) {
            this._pollTimer = setInterval(() => this.refresh({ quiet: true }), POLL_MS);
            window.addEventListener('notifications-invalidate', this._onInvalidate);
            document.addEventListener('visibilitychange', this._onVisibilityChange);
            this.refresh({ quiet: true });
        }
        callback(this._state);
        return () => this._unsubscribe(callback);
    }

    _unsubscribe(callback) {
        this._subscribers.delete(callback);
        if (this._subscribers.size === 0) {
            clearInterval(this._pollTimer);
            this._pollTimer = null;
            window.removeEventListener('notifications-invalidate', this._onInvalidate);
            document.removeEventListener('visibilitychange', this._onVisibilityChange);
        }
    }

    /** Call when the current user's registration-reviewer status is known or changes. */
    setRegistrationReviewer(value) {
        const changed = this._isRegistrationReviewer !== Boolean(value);
        this._isRegistrationReviewer = Boolean(value);
        if (changed) this.refresh({ quiet: true });
    }

    _notify(patch) {
        if (patch) this._state = { ...this._state, ...patch };
        for (const cb of this._subscribers) cb(this._state);
    }

    async refresh({ quiet = false } = {}) {
        if (!quiet) this._notify({ loading: true });
        try {
            const [data, pendingRegCount, pendingInviteCount] = await Promise.all([
                listNotifications(),
                this._isRegistrationReviewer ? getPendingRegistrationsCount() : Promise.resolve(0),
                getPendingCaseInvitesCount()
            ]);
            this._notify({
                notifications: Array.isArray(data.notifications) ? data.notifications : [],
                unreadCount: Number(data.unreadCount) || 0,
                pendingRegCount,
                pendingInviteCount,
                loading: false
            });
        } catch {
            this._notify({ loading: false });
        }
    }
}

export const notificationStore = new NotificationStore();
