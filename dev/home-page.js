import { LitElement, html, css } from 'lit-element';
import { t } from './i18n/index.js';
import { loadAppFeatures } from './services/features.js';
import {
    listDirectusCases,
    listInvitesAwaitingMyApproval,
    listRecentActivity,
    approveDirectusCaseInvite,
    rejectDirectusCaseInvite
} from './services/directus.js';
import { invalidateNotifications, listMentionNotifications } from './services/notifications.js';
import { eventToActivity, mentionToActivity } from './utils/activityItems.js';
import { condensedTime, fullTime } from './utils/condensedTime.js';
import { ICON_CASES, ICON_TODO, ICON_ACTIVITY, ICON_GEAR } from './utils/homeIcons.js';
import { visibleColumns, normalizeHomeLayout } from './utils/homeLayout.js';
import { getCachedUserPreferences } from './utils/userPreferences.js';
import './components/page-layout-template.js';

/** Time-of-day greeting key, so the page feels current without any data behind it. */
function greetingKey(date = new Date()) {
    const hour = date.getHours();
    if (hour < 12) return 'home.greetingMorning';
    if (hour < 18) return 'home.greetingAfternoon';
    return 'home.greetingEvening';
}




const ICON_CHECK = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 2a10 10 0 100 20 10 10 0 000-20zm-1.2 14.4l-4-4 1.4-1.4 2.6 2.6 5-5 1.4 1.4-6.4 6.4z"></path>
    </svg>`;

const ICON_PEOPLE = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M9 11a4 4 0 100-8 4 4 0 000 8zm8 0a3 3 0 100-6 3 3 0 000 6zM9 13c-3.3 0-7 1.7-7 4.5V20h14v-2.5C16 14.7 12.3 13 9 13zm8 0c-.5 0-1 0-1.5.1 1.5 1 2.5 2.5 2.5 4.4V20h5v-2.5c0-2.4-3.1-4.5-6-4.5z"></path>
    </svg>`;

const ICON_MENTION = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M12 2a10 10 0 100 20h4v-2h-4a8 8 0 118-8v1.2a1.8 1.8 0 01-3.6 0V12a4.4 4.4 0 10-1.3 3.1 3.8 3.8 0 006.9-2V12A10 10 0 0012 2zm0 13.6a2.6 2.6 0 110-5.2 2.6 2.6 0 010 5.2z"></path>
    </svg>`;

const ICON_TASK = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M19 3H5a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2V5a2 2 0 00-2-2zm-8.2 13.4l-3.9-3.9 1.4-1.4 2.5 2.5 5.6-5.6 1.4 1.4-7 7z"></path>
    </svg>`;

/** Categories of item, in the order their filter chips appear. */
const CATEGORIES = [
    { category: 'collaboration', labelKey: 'home.category.collaboration', icon: ICON_PEOPLE },
    { category: 'mention', labelKey: 'home.category.mention', icon: ICON_MENTION },
    { category: 'task', labelKey: 'home.category.task', icon: ICON_TASK }
];

/** An invite waiting for a decision, as a card in To do. */
function inviteToTodo(invite) {
    return {
        id: `invite:${invite.kind}:${invite.id}`,
        category: 'collaboration',
        title: t('home.todo.inviteTitle', {
            actor: invite.inviterName || t('home.activity.someone'),
            invitee: invite.inviteeName || invite.inviteeEmail,
            case: invite.caseTitle || t('home.invite.untitledCase')
        }),
        detail: t('home.card.asRole', { role: roleLabel(invite.proposedRole) }),
        at: invite.createdAt,
        actionRequired: true,
        invite
    };
}

/**
 * Landing page after sign-in: what needs the user's action (To do), what has happened lately
 * (Recent activity) and their recent cases. Only To do has a data source so far (invites awaiting
 * approval); the others render empty states.
 */
export class HomePage extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .home-stack {
                position: relative;
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            /* A wide main column (2/3) and a narrow side column (1/3). A lone column, or a narrow window,
               gets the full width. Cards adapt to the width of their own column (container queries). */
            .widgets {
                container-type: inline-size;
            }

            .columns {
                display: grid;
                grid-template-columns: minmax(0, 1fr);
                gap: 20px;
                align-items: start;
            }

            @container (min-width: 800px) {
                .columns.two {
                    grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
                }
            }

            .column {
                display: flex;
                flex-direction: column;
                gap: 20px;
                min-width: 0;
            }

            .widget {
                min-width: 0;
                container-type: inline-size;
            }

            .widgets-empty {
                margin: 0;
                padding: 18px;
                border: 1px dashed var(--color-border);
                border-radius: var(--radius-lg);
                color: var(--color-text-secondary);
                text-align: center;
            }

            .hero {
                padding: 4px 4px 4px;
            }

            .hero-customize {
                position: absolute;
                top: -12px;
                right: -12px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 36px;
                height: 36px;
                padding: 0;
                border: 1px solid transparent;
                border-radius: 50%;
                background: transparent;
                color: var(--color-text-secondary);
                cursor: pointer;
            }

            .hero-customize svg {
                width: 19px;
                height: 19px;
                display: block;
            }

            .hero-customize:hover {
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
                color: var(--color-text-primary);
            }

            .hero-customize:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .hero-title {
                margin: 0;
                padding-right: 44px;
                font-size: 1.6rem;
                font-weight: 650;
                letter-spacing: -0.01em;
                color: var(--color-text-primary);
            }

            .secondary-button {
                display: inline-flex;
                align-items: center;
                padding: 8px 18px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-size: 0.875rem;
                font-weight: 600;
                line-height: 1.2;
                cursor: pointer;
            }

            .secondary-button:hover {
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
            }

            .secondary-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .panel {
                display: flex;
                flex-direction: column;
                min-width: 0;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
            }

            :host-context([data-theme='dark']) .panel {
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
            }

            .panel-header {
                display: flex;
                align-items: center;
                gap: 10px;
                padding: 14px 18px;
                border-bottom: 1px solid var(--color-border);
            }

            .panel-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 30px;
                height: 30px;
                flex: 0 0 30px;
                border-radius: var(--radius-md, 8px);
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-primary);
            }

            :host-context([data-theme='dark']) .panel-icon {
                color: var(--color-text-primary);
            }

            .panel-icon svg {
                width: 18px;
                height: 18px;
                display: block;
            }

            .panel-title {
                margin: 0;
                font-size: 1.05rem;
                color: var(--color-text-primary);
            }

            .panel-body {
                display: flex;
                padding: 18px;
            }

            .empty-state {
                flex: 1;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                gap: 6px;
                min-height: 120px;
                padding: 12px;
                border: 1px dashed var(--color-border);
                border-radius: var(--radius-md, 8px);
                text-align: center;
            }

            .empty-title {
                margin: 0;
                font-weight: 600;
                color: var(--color-text-primary);
            }

            .empty-hint {
                margin: 0;
                max-width: 42ch;
                font-size: 0.9rem;
                line-height: 1.45;
                color: var(--color-text-secondary);
            }

            /* Updates: one calm box, grouped by kind. Filter chips only appear when there is more than one kind. */
            .panel-clear {
                display: flex;
                align-items: center;
                justify-content: center;
                gap: 10px;
                margin: 0;
                padding: 14px 18px;
                color: var(--color-text-secondary);
            }

            .panel-clear svg {
                width: 20px;
                height: 20px;
                flex: 0 0 20px;
            }

            .filter-dropdown {
                position: relative;
                margin-left: auto;
            }

            .filter-toggle {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 4px 10px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm, 6px);
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-size: 0.85rem;
                cursor: pointer;
                white-space: nowrap;
            }

            .filter-toggle:hover {
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
                border-color: var(--color-primary);
            }

            .filter-toggle:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .filter-chevron {
                width: 14px;
                height: 14px;
                flex-shrink: 0;
            }

            .filter-menu {
                position: absolute;
                top: calc(100% + 4px);
                right: 0;
                min-width: 180px;
                padding: 6px;
                background: var(--color-panel, var(--color-surface));
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                box-shadow: 0 4px 12px color-mix(in srgb, var(--color-text-primary) 12%, transparent);
                z-index: 50;
                display: flex;
                flex-direction: column;
                gap: 2px;
            }

            .filter-option {
                display: flex;
                align-items: center;
                gap: 8px;
                padding: 7px 10px;
                border-radius: var(--radius-sm, 6px);
                font-size: 0.9rem;
                cursor: pointer;
                user-select: none;
            }

            .filter-option:hover {
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
            }

            .filter-option input[type='checkbox'] {
                width: 15px;
                height: 15px;
                flex-shrink: 0;
                accent-color: var(--color-primary);
                cursor: pointer;
            }

            .filter-option-icon {
                display: inline-flex;
                width: 16px;
                flex-shrink: 0;
                color: var(--color-text-secondary);
            }

            .filter-option-icon svg {
                width: 14px;
                height: 14px;
                display: block;
            }

            .filter-option-count {
                margin-left: auto;
                font-size: 0.8rem;
                color: var(--color-text-secondary);
            }

            .card-list {
                margin: 0;
                padding: 14px 18px 16px;
                list-style: none;
                display: flex;
                flex-direction: column;
                gap: 10px;
            }


            /* Categories are told apart by icon and name, not hue: the app has one palette. */
            :host {
                --card-accent: var(--color-primary);
                --action: #92400e;
                --on-action: #ffffff;
            }

            :host-context([data-theme='dark']) {
                --card-accent: var(--color-accent);
                --action: #fcd34d;
                --on-action: #1f1300;
            }

            .card {
                display: grid;
                grid-template-columns: minmax(0, 1fr) auto;
                column-gap: 16px;
                row-gap: 8px;
                align-items: start;
                padding: 12px 16px 12px 14px;
                border: 1px solid var(--color-border);
                border-left: 5px solid var(--card-accent);
                border-radius: var(--radius-md, 8px);
                background: color-mix(in srgb, var(--card-accent) 6%, var(--color-panel, var(--color-surface)));
            }

            .card-meta {
                grid-column: 1;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 8px;
            }

            .card-category {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                font-size: 0.72rem;
                font-weight: 700;
                letter-spacing: 0.06em;
                text-transform: uppercase;
                color: var(--color-text-secondary);
            }

            .card-category svg {
                width: 14px;
                height: 14px;
                display: block;
            }

            .card-action {
                display: inline-flex;
                align-items: center;
                gap: 5px;
                padding: 1px 9px 1px 7px;
                border-radius: 999px;
                background: var(--action);
                color: var(--on-action);
                font-size: 0.72rem;
                font-weight: 700;
            }

            .card-action::before {
                content: '';
                width: 6px;
                height: 6px;
                border-radius: 50%;
                background: currentColor;
            }

            .card-time {
                grid-column: 2;
                grid-row: 1;
                justify-self: end;
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                white-space: nowrap;
            }

            .card-main {
                grid-column: 1;
                min-width: 0;
            }

            .card-title {
                margin: 0;
                font-size: 0.98rem;
                font-weight: 600;
                line-height: 1.35;
                color: var(--color-text-primary);
            }

            .card-detail {
                margin: 2px 0 0;
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .card .update-actions {
                grid-column: 2;
                grid-row: 2;
                align-self: end;
                justify-self: end;
            }

            button.card {
                width: 100%;
                text-align: left;
                border: 1px solid var(--color-border);
                border-left: 5px solid var(--card-accent);
                cursor: pointer;
            }

            button.card:hover {
                background: color-mix(in srgb, var(--card-accent) 12%, var(--color-panel, var(--color-surface)));
                border-color: var(--card-accent);
            }

            button.card:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            @container (max-width: 560px) {
                .card {
                    grid-template-columns: minmax(0, 1fr);
                }

                .card-time,
                .card .update-actions {
                    grid-column: 1;
                    grid-row: auto;
                    justify-self: start;
                }
            }

            .update-actions {
                display: inline-flex;
                gap: 8px;
            }

            .update-status {
                margin: 0;
                padding: 0 18px 12px;
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .update-status:empty {
                display: none;
            }

            .update-status.is-error {
                color: var(--color-status-error-fg, #8a1212);
            }


            .small-button {
                padding: 5px 14px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                font-size: 0.85rem;
                font-weight: 600;
                cursor: pointer;
            }

            .small-button.is-primary {
                border-color: transparent;
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .small-button:hover:not([aria-disabled='true']) {
                opacity: 0.87;
            }

            .small-button[aria-disabled='true'] {
                opacity: 0.5;
                cursor: progress;
            }

            .small-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

        `;
    }

    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            /** @type {{ id: string, kind: 'invite'|'task', title: string, detail?: string }[]} */
            todo: { type: Array },
            /** @type {{ id: string, kind: 'mention'|'approval', title: string, detail?: string }[]} */
            activity: { type: Array },
            recentCases: { type: Array },
            panelFilters: { type: Object },
            _filterMenuOpen: { type: Object },
            homeLayout: { type: Object },
            busyUpdates: { type: Object },
            updateStatus: { type: String },
            updateStatusIsError: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.username = '';
        this.avatarUrl = '';
        this.todo = [];
        this.activity = [];
        this.recentCases = [];
        this.panelFilters = {};
        this._filterMenuOpen = {};
        this._onDocClick = (e) => this._handleDocClick(e);
        this.homeLayout = normalizeHomeLayout(getCachedUserPreferences().homeLayout);
        this._onPreferencesChanged = () => {
            this.homeLayout = normalizeHomeLayout(getCachedUserPreferences().homeLayout);
        };
        this.busyUpdates = {};
        this.updateStatus = '';
        this.updateStatusIsError = false;
        this._onNotificationsInvalidate = () => this.loadInviteData();
        this._onDirectusSessionRestored = () => {
            this.loadRecentCases();
            this.loadInviteData();
        };
    }

    connectedCallback() {
        super.connectedCallback();
        // The Cases shortcut depends on server feature flags, which may still be loading.
        loadAppFeatures().then(() => {
            this.requestUpdate();
            this.loadInviteData();
            this.loadRecentCases();
        });
        window.addEventListener('notifications-invalidate', this._onNotificationsInvalidate);
        window.addEventListener('user-preferences-changed', this._onPreferencesChanged);
        window.addEventListener('directus-session-restored', this._onDirectusSessionRestored);
        document.addEventListener('click', this._onDocClick, true);
        this._onPreferencesChanged();
    }

    disconnectedCallback() {
        window.removeEventListener('notifications-invalidate', this._onNotificationsInvalidate);
        window.removeEventListener('user-preferences-changed', this._onPreferencesChanged);
        window.removeEventListener('directus-session-restored', this._onDirectusSessionRestored);
        document.removeEventListener('click', this._onDocClick, true);
        super.disconnectedCallback();
    }

    /** Everything on Home that comes from invites: what needs a decision, and what has happened. */
    loadInviteData() {
        return Promise.all([this.loadPendingInvites(), this.loadRecentActivity()]);
    }

    async loadRecentActivity() {
        try {
            const [events, mentions] = await Promise.all([
                listRecentActivity(),
                listMentionNotifications()
            ]);
            this.activity = [
                ...events.map(eventToActivity),
                ...mentions.map(mentionToActivity)
            ];
        } catch (err) {
            console.warn('Could not load recent activity:', err.message);
        }
    }

    async loadPendingInvites() {
        try {
            const invites = await listInvitesAwaitingMyApproval();
            this.todo = [
                ...this.todo.filter((item) => item.kind !== 'invite'),
                ...invites.map(inviteToTodo)
            ];
        } catch (err) {
            console.warn('Could not load pending invites:', err.message);
        }
    }

    async loadRecentCases() {
        try {
            const { cases = [] } = await listDirectusCases({ limit: 50 });
            const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
            this.recentCases = cases
                .map((c) => {
                    const timestamps = [
                        c.updatedAt,
                        c.createdAt,
                        ...(c.comments || []).map((cm) => cm.createdAt),
                        ...(c.attachments || []).map((a) => a.modifiedAt)
                    ].map((ts) => {
                        if (!ts) return 0;
                        const s = String(ts).trim();
                        const normalised = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s) ? s.replace(' ', 'T') + 'Z' : s;
                        return Date.parse(normalised) || 0;
                    });
                    return { ...c, _lastActivityMs: Math.max(...timestamps) };
                })
                .filter((c) => c._lastActivityMs >= cutoff)
                .sort((a, b) => b._lastActivityMs - a._lastActivityMs);
        } catch (err) {
            console.warn('Could not load recent cases:', err.message);
        }
    }

    async decideInvite(item, decision) {
        if (this.busyUpdates[item.id]) return;
        const { invite } = item;
        this.busyUpdates = { ...this.busyUpdates, [item.id]: true };
        this.updateStatus = '';
        try {
            const decide = decision === 'approve' ? approveDirectusCaseInvite : rejectDirectusCaseInvite;
            await decide(invite.caseId, invite.id, { kind: invite.kind });
            this.todo = this.todo.filter((entry) => entry.id !== item.id);
            this.updateStatusIsError = false;
            this.updateStatus = t(decision === 'approve' ? 'home.invite.approved' : 'home.invite.rejected', {
                email: invite.inviteeEmail
            });
            invalidateNotifications();
        } catch (err) {
            this.updateStatusIsError = true;
            this.updateStatus = err.message || t(decision === 'approve' ? 'errors.approveInviteFailed' : 'errors.rejectInviteFailed');
        } finally {
            const { [item.id]: _done, ...rest } = this.busyUpdates;
            this.busyUpdates = rest;
        }
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    _handleDocClick(e) {
        if (!Object.values(this._filterMenuOpen).some(Boolean)) return;
        if (!e.composedPath().some((el) => el?.classList?.contains('filter-dropdown'))) {
            this._filterMenuOpen = {};
        }
    }

    _toggleFilterMenu(id) {
        const isOpen = Boolean(this._filterMenuOpen[id]);
        this._filterMenuOpen = isOpen ? {} : { [id]: true };
    }

    _toggleFilterCategory(id, category) {
        const current = this.panelFilters[id] instanceof Set ? this.panelFilters[id] : new Set();
        const next = new Set(current);
        if (next.has(category)) next.delete(category); else next.add(category);
        this.panelFilters = { ...this.panelFilters, [id]: next };
    }

    /** Open the case and its People dialog, the same way a bell notification does. */
    openPeople(item) {
        this.dispatchEvent(new CustomEvent('notification-open', {
            detail: { caseId: item.caseId, inviteId: item.inviteId || null, type: 'case_invite_accepted' },
            bubbles: true,
            composed: true
        }));
    }

    /** Navigate to the case without opening the People dialog (used for mention cards). */
    openCase(item) {
        this.dispatchEvent(new CustomEvent('notification-open', {
            detail: { caseId: item.caseId, type: 'mention' },
            bubbles: true,
            composed: true
        }));
    }

    openCases() {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey: 'cases' },
            bubbles: true,
            composed: true
        }));
    }

    /** A panel of cards, newest first, with a multiselect filter dropdown when more than one category is present. */
    renderCardPanel({ id, title, icon, items, clearKey, clearIcon = null, status = null }) {
        const present = CATEGORIES
            .map((entry) => ({ ...entry, count: items.filter((item) => item.category === entry.category).length }))
            .filter((entry) => entry.count > 0);
        const selected = this.panelFilters[id] instanceof Set ? this.panelFilters[id] : new Set();
        const shown = items
            .filter((item) => selected.size === 0 || selected.has(item.category))
            .sort((a, b) => String(b.at || '').localeCompare(String(a.at || '')));
        const menuOpen = Boolean(this._filterMenuOpen[id]);

        let toggleLabel;
        if (selected.size === 0 || selected.size === present.length) {
            toggleLabel = t('home.filterAll');
        } else if (selected.size === 1) {
            const cat = present.find((e) => selected.has(e.category));
            toggleLabel = cat ? t(cat.labelKey) : t('home.filterAll');
        } else {
            toggleLabel = t('home.filterCount', { count: selected.size });
        }

        return html`
            <section class="panel" aria-labelledby=${id}>
                <div class="panel-header">
                    <span class="panel-icon">${icon}</span>
                    <h2 class="panel-title" id=${id}>${title}</h2>
                    ${present.length > 1 ? html`
                        <div class="filter-dropdown">
                            <button
                                type="button"
                                class="filter-toggle"
                                aria-haspopup="listbox"
                                aria-expanded=${menuOpen ? 'true' : 'false'}
                                aria-label=${t('home.filterLabel', { section: title })}
                                @click=${() => this._toggleFilterMenu(id)}
                                @keydown=${(e) => { if (e.key === 'Escape') this._filterMenuOpen = {}; }}
                            >
                                ${toggleLabel}
                                <svg class="filter-chevron" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>
                            </button>
                            ${menuOpen ? html`
                                <div class="filter-menu" role="listbox" aria-multiselectable="true" aria-label=${t('home.filterLabel', { section: title })}>
                                    ${present.map((entry) => html`
                                        <label class="filter-option" role="option" aria-selected=${selected.has(entry.category) ? 'true' : 'false'}>
                                            <input
                                                type="checkbox"
                                                .checked=${selected.has(entry.category)}
                                                @change=${() => this._toggleFilterCategory(id, entry.category)}
                                            >
                                            <span class="filter-option-icon">${entry.icon}</span>
                                            ${t(entry.labelKey)}
                                            <span class="filter-option-count">${entry.count}</span>
                                        </label>
                                    `)}
                                </div>
                            ` : ''}
                        </div>
                    ` : ''}
                </div>
                ${items.length === 0 ? html`
                    <p class="panel-clear">${clearIcon}<span>${t(clearKey)}</span></p>
                ` : html`
                    <ul class="card-list">
                        ${shown.map((item) => this.renderCard(item))}
                    </ul>
                `}
                ${status}
            </section>
        `;
    }

    renderCard(item) {
        const category = CATEGORIES.find((entry) => entry.category === item.category);
        const cardInner = html`
            <div class="card-meta">
                <span class="card-category">${category ? category.icon : ''}${category ? t(category.labelKey) : ''}</span>
                ${item.actionRequired ? html`<span class="card-action">${t('home.card.actionRequired')}</span>` : ''}
            </div>
            ${item.at ? html`
                <time class="card-time" datetime=${item.at} title=${fullTime(item.at)}>${condensedTime(item.at)}</time>
            ` : ''}
            <div class="card-main">
                <p class="card-title">${item.title}</p>
                ${item.detail ? html`<p class="card-detail">${item.detail}</p>` : ''}
            </div>
        `;

        if (!item.invite && item.caseId) {
            const ariaLabel = item.category === 'mention'
                ? t('home.card.openCaseAria', { case: item.caseTitle || t('home.invite.untitledCase') })
                : t('home.card.openPeopleAria', { case: item.caseTitle || t('home.invite.untitledCase') });
            const handler = () => item.category === 'mention' ? this.openCase(item) : this.openPeople(item);
            return html`
                <li>
                    <button type="button" class="card card-clickable cat-${item.category}" aria-label=${ariaLabel} @click=${handler}>
                        ${cardInner}
                    </button>
                </li>
            `;
        }

        return html`
            <li class="card cat-${item.category}">
                ${cardInner}
                ${item.invite ? this.renderInviteActions(item) : ''}
            </li>
        `;
    }

    renderTodo() {
        return this.renderCardPanel({
            id: 'home-todo',
            title: t('home.todo.title'),
            icon: ICON_TODO,
            items: this.todo,
            clearKey: 'home.todo.clear',
            clearIcon: ICON_CHECK,
            status: html`
                <p
                    class="update-status ${this.updateStatusIsError ? 'is-error' : ''}"
                    role=${this.updateStatusIsError ? 'alert' : 'status'}
                >${this.updateStatus}</p>
            `
        });
    }

    renderActivity() {
        return this.renderCardPanel({
            id: 'home-activity',
            title: t('home.activity.title'),
            icon: ICON_ACTIVITY,
            items: this.activity,
            clearKey: 'home.activity.clear'
        });
    }

    renderInviteActions(item) {
        const busy = this.busyUpdates[item.id] === true;
        const subject = `${item.invite.inviteeName || item.invite.inviteeEmail}, ${item.invite.caseTitle || t('home.invite.untitledCase')}`;
        return html`
            <span class="update-actions">
                <button
                    type="button"
                    class="small-button is-primary"
                    aria-disabled=${busy ? 'true' : 'false'}
                    aria-label=${t('home.invite.approveAria', { subject })}
                    @click=${() => this.decideInvite(item, 'approve')}
                >${t('home.invite.approve')}</button>
                <button
                    type="button"
                    class="small-button"
                    aria-disabled=${busy ? 'true' : 'false'}
                    aria-label=${t('home.invite.rejectAria', { subject })}
                    @click=${() => this.decideInvite(item, 'reject')}
                >${t('home.invite.reject')}</button>
            </span>
        `;
    }

    /** The widgets the user chose, in their columns and order. */
    renderWidgets() {
        const columns = visibleColumns(this.homeLayout);
        const shown = [columns.main, columns.side].filter((widgets) => widgets.length > 0);
        if (shown.length === 0) {
            return html`
                <p class="widgets-empty">
                    ${t('home.allHidden')}
                    <button type="button" class="secondary-button" @click=${() => this.openSettings()}>${t('home.customize')}</button>
                </p>
            `;
        }
        const renderers = {
            todo: () => this.renderTodo(),
            activity: () => this.renderActivity(),
            'recent-cases': () => this.renderRecentCases()
        };
        return html`
            <div class="widgets">
                <div class="columns ${shown.length === 2 ? 'two' : ''}">
                    ${shown.map((widgets) => html`
                        <div class="column">
                            ${widgets.map((widget) => html`<div class="widget">${renderers[widget.id]()}</div>`)}
                        </div>
                    `)}
                </div>
            </div>
        `;
    }

    openSettings() {
        this.dispatchEvent(new CustomEvent('settings-request', { bubbles: true, composed: true }));
    }

    renderRecentCases() {
        const cases = this.recentCases;
        return html`
            <section class="panel" aria-labelledby="home-recent-cases">
                <div class="panel-header">
                    <span class="panel-icon">${ICON_CASES}</span>
                    <h2 class="panel-title" id="home-recent-cases">${t('home.recentCases')}</h2>
                </div>
                ${cases.length === 0 ? html`
                    <p class="panel-clear"><span>${t('home.recentCasesEmptyTitle')}</span></p>
                ` : html`
                    <ul class="card-list">
                        ${cases.map((c) => html`
                            <li>
                                <button
                                    type="button"
                                    class="card card-clickable"
                                    aria-label=${t('home.recentCasesOpenAria', { title: c.title || t('home.invite.untitledCase') })}
                                    @click=${() => this.dispatchEvent(new CustomEvent('notification-open', {
                                        detail: { caseId: c.id, type: 'mention' },
                                        bubbles: true, composed: true
                                    }))}
                                >
                                    <time class="card-time" datetime=${new Date(c._lastActivityMs).toISOString()} title=${fullTime(new Date(c._lastActivityMs).toISOString())}>
                                        ${condensedTime(new Date(c._lastActivityMs).toISOString())}
                                    </time>
                                    <div class="card-main">
                                        <p class="card-title">${c.title || t('home.invite.untitledCase')}</p>
                                        ${(c.comments?.length || c.attachments?.length) ? html`
                                            <p class="card-detail">${[
                                                c.comments?.length ? `${c.comments.length} ${c.comments.length === 1 ? t('home.recentCasesComment') : t('home.recentCasesComments')}` : null,
                                                c.attachments?.length ? `${c.attachments.length} ${c.attachments.length === 1 ? t('home.recentCasesFile') : t('home.recentCasesFiles')}` : null,
                                            ].filter(Boolean).join(' · ')}</p>
                                        ` : ''}
                                    </div>
                                </button>
                            </li>
                        `)}
                    </ul>
                `}
            </section>
        `;
    }

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                selectedMenuKey=""
                homeHref="/"
                homeLabel=${t('common.home')}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="home-stack">
                    <button
                        type="button"
                        class="hero-customize"
                        title=${t('home.customize')}
                        aria-label=${t('home.customize')}
                        @click=${() => this.openSettings()}
                    >${ICON_GEAR}</button>
                    <section class="hero" aria-labelledby="home-title">
                        <h1 class="hero-title" id="home-title">
                            ${t(greetingKey(), { name: this.username || t('common.guest') })}
                        </h1>
                    </section>

                    ${this.renderWidgets()}
                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('home-page', HomePage);
