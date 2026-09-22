import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import './app-dialog.js';
import './dropdown-select.js';

const DEFAULT_ROLE_OPTIONS = Object.freeze([
    Object.freeze({ value: '', label: t('roles.selectRole'), disabled: true }),
    Object.freeze({ value: 'admin', label: t('roles.admin') }),
    Object.freeze({ value: 'collaborator', label: t('roles.collaborator') }),
    Object.freeze({ value: 'read_only', label: t('roles.readOnly') })
]);

function inviteKind(invite) {
    if (invite?.kind === 'signup' || invite?.kind === 'existing') return invite.kind;
    if (invite?.status === 'pending_approval' || invite?.status === 'pending_signup') return 'signup';
    if (!invite?.inviteeDirectusUserId && invite?.inviteeEmail) return 'signup';
    return 'existing';
}

function roleLabel(role) {
    const key = String(role || '').toLowerCase();
    if (key === 'admin') return t('roles.admin');
    if (key === 'read_only' || key === 'observer') return t('roles.readOnly');
    return t('roles.collaborator');
}

function personFullName(person) {
    const first = String(person?.firstName || person?.first_name || '').trim();
    const last = String(person?.lastName || person?.last_name || '').trim();
    return `${first} ${last}`.trim();
}

function hasPersonName(person) {
    return Boolean(personFullName(person));
}

/** UUID / truncated id fragments used as fallback "usernames" — not real display names. */
function looksLikeIdFragment(value) {
    const s = String(value || '').trim();
    if (!s) return true;
    if (/^[0-9a-f]{8}$/i.test(s)) return true;
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return true;
    return false;
}

function hasMeaningfulLabel(person) {
    if (hasPersonName(person)) return true;
    const username = String(person?.username || '').trim();
    if (username && !looksLikeIdFragment(username) && !username.includes('@')) return true;
    return false;
}

/**
 * @param {object} person
 * @param {{ currentUserId?: string|null, unknownLabels?: Map<string, string> }} [ctx]
 */
function displayName(person, ctx = {}) {
    const id = person?.id != null ? String(person.id) : '';
    if (ctx.currentUserId && id && id === String(ctx.currentUserId)) {
        return t('common.me');
    }
    if (hasPersonName(person)) return personFullName(person);
    const username = String(person?.username || '').trim();
    if (username && !looksLikeIdFragment(username) && !String(username).includes('@')) {
        return username;
    }
    if (ctx.unknownLabels?.has(id)) return ctx.unknownLabels.get(id);
    return t('people.unknownUser');
}

function buildUnknownLabels(members = [], currentUserId = null) {
    const labels = new Map();
    let n = 0;
    const me = currentUserId != null ? String(currentUserId) : '';
    for (const member of members) {
        const id = member?.id != null ? String(member.id) : '';
        if (!id || (me && id === me)) continue;
        if (hasMeaningfulLabel(member)) continue;
        n += 1;
        labels.set(id, t('people.unknownUserN', { n }));
    }
    return labels;
}

function initialFor(person, ctx = {}) {
    const name = displayName(person, ctx);
    if (name === 'Me') return 'M';
    if (/^unknown user/i.test(name)) return '?';
    return String(name).charAt(0).toUpperCase() || '?';
}

/** Secondary line: email when primary is not a real name (and not Me). */
function memberSecondaryLine(person, ctx = {}) {
    const id = person?.id != null ? String(person.id) : '';
    if (ctx.currentUserId && id === String(ctx.currentUserId)) return '';
    if (hasPersonName(person)) return '';
    return String(person?.email || '').trim();
}

/**
 * Reusable people / membership dialog.
 *
 * Members: [{ id, email?, username?, role, locked? }]
 * - locked members (e.g. owner) stay in the list; role/remove are disabled
 *
 * Events:
 * - people-save  detail: { members: [{ userId, role }] }  (excludes locked)
 * - people-cancel
 * - people-invited detail: { status, invitee, invite, collaborators? }
 * - people-approve-invite detail: { inviteId }
 * - people-reject-invite detail: { inviteId }
 */
export class PeopleDialog extends LitElement {
    static get styles() {
        return css`
            :host {
                display: contents;
            }

            app-dialog {
                --app-dialog-width: min(560px, calc(100vw - 32px));
            }

            .body {
                display: flex;
                flex-direction: column;
                gap: 14px;
            }

            .error {
                margin: 0;
                color: #c62828;
                font-size: 0.875rem;
            }

            .list {
                display: flex;
                flex-direction: column;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                overflow: hidden;
                background: var(--color-background);
                box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent);
            }

            .list-scroll {
                /* ~5 rows at min-height 52px, then scroll; invite stays pinned below */
                max-height: calc((52px * 5) + 1px);
                overflow-y: auto;
                overscroll-behavior: contain;
                -webkit-overflow-scrolling: touch;
            }

            .row {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 10px 12px;
                min-height: 52px;
                box-sizing: border-box;
            }

            .row + .row {
                border-top: 1px solid var(--color-border);
            }

            .invite-footer {
                border-top: 1px solid var(--color-border);
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                background: color-mix(in srgb, var(--color-border) 12%, transparent);
                flex-shrink: 0;
            }

            .avatar {
                width: 36px;
                height: 36px;
                border-radius: 50%;
                border: 1px solid var(--color-border);
                background: var(--color-primary);
                color: var(--color-on-primary);
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.85rem;
                font-weight: 650;
                flex: 0 0 36px;
            }

            :host-context([data-theme='dark']) .avatar {
                background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
                color: var(--color-primary);
            }

            .identity {
                display: flex;
                flex-direction: column;
                gap: 1px;
                min-width: 0;
                flex: 1;
            }

            .name {
                font-weight: 550;
                color: var(--color-text-primary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .email {
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .meta {
                display: flex;
                align-items: center;
                gap: 8px;
                flex-shrink: 0;
            }

            .badge {
                font-size: 0.75rem;
                font-weight: 550;
                color: var(--color-text-secondary);
                white-space: nowrap;
                padding: 4px 8px;
                border-radius: 999px;
                border: 1px solid var(--color-border);
                background: color-mix(in srgb, var(--color-border) 22%, transparent);
            }

            .meta dropdown-select {
                min-width: 140px;
            }

            .icon-button {
                border: none;
                border-radius: 6px;
                background: transparent;
                color: var(--color-text-secondary);
                width: 32px;
                height: 32px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .icon-button:hover:not(:disabled),
            .icon-button:focus-visible {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-border) 40%, transparent);
            }

            .icon-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .icon-button:disabled {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .empty {
                margin: 0;
                padding: 18px 14px;
                text-align: center;
                color: var(--color-text-secondary);
                font-size: 0.9rem;
            }

            .invite-row {
                display: flex;
                gap: 8px;
                align-items: stretch;
            }

            .invite-link-row {
                display: flex;
                gap: 8px;
                align-items: stretch;
                margin-top: 8px;
            }

            .invite-input {
                flex: 1;
                min-width: 0;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                padding: 9px 12px;
                font: inherit;
                font-size: 0.9rem;
                background: var(--color-background);
                color: var(--color-text-primary);
                box-sizing: border-box;
            }

            .invite-input:focus {
                outline: none;
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
            }

            .invite-match {
                display: flex;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }

            .invite-match .meta {
                margin-left: auto;
            }

            .invite-status {
                margin: 0;
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .invite-status.error {
                color: #c62828;
            }

            .primary-button,
            .secondary-button {
                border-radius: 6px;
                padding: 8px 16px;
                font: inherit;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
            }

            .primary-button {
                border: 1px solid transparent;
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .secondary-button {
                border: 1px solid var(--color-border);
                background: transparent;
                color: var(--color-text-primary);
            }

            .secondary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-border) 35%, transparent);
            }

            .primary-button:disabled,
            .secondary-button:disabled {
                opacity: 0.55;
                cursor: not-allowed;
            }

            .primary-button:focus-visible,
            .secondary-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .pending-block {
                margin-top: 4px;
                border: 1px dashed var(--color-border);
                border-radius: var(--radius-md, 8px);
                overflow: hidden;
            }

            .pending-heading {
                margin: 0;
                padding: 8px 12px;
                font-size: 0.8rem;
                font-weight: 600;
                color: var(--color-text-secondary);
                background: color-mix(in srgb, var(--color-border) 35%, transparent);
            }

            .pending-actions {
                display: flex;
                gap: 6px;
                flex-shrink: 0;
            }

            .saving {
                margin: 0;
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }
        `;
    }

    static get properties() {
        return {
            title: { type: String },
            error: { type: String },
            saving: { type: Boolean },
            canInvite: { type: Boolean },
            canManage: { type: Boolean },
            roleOptions: { type: Array },
            /** Optional async (email) => user */
            lookupFn: { attribute: false },
            /** Optional async ({ email, role }) => invite result */
            inviteFn: { attribute: false },
            members: { type: Array },
            pendingInvites: { type: Array },
            emailQuery: { type: String },
            lookingUp: { type: Boolean },
            inviting: { type: Boolean },
            lookupMessage: { type: String },
            matchedUser: { type: Object },
            /** Email with no Directus user — offer signup invite */
            unknownEmail: { type: String },
            inviteRole: { type: String },
            /** Last minted signup invite URL (copy-link) */
            lastInviteUrl: { type: String },
            /** Directus user id of the signed-in viewer (for “Me” label) */
            currentUserId: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.title = t('people.title');
        this.error = '';
        this.saving = false;
        this.canInvite = false;
        this.canManage = false;
        this.roleOptions = null;
        this.lookupFn = null;
        this.inviteFn = null;
        this.members = [];
        this.pendingInvites = [];
        this.emailQuery = '';
        this.lookingUp = false;
        this.inviting = false;
        this.lookupMessage = '';
        this.matchedUser = null;
        this.unknownEmail = '';
        this.inviteRole = '';
        this.lastInviteUrl = '';
        this.currentUserId = '';
        this._baselineIds = new Set();
    }

    get effectiveRoleOptions() {
        if (Array.isArray(this.roleOptions) && this.roleOptions.length) {
            return this.roleOptions;
        }
        return DEFAULT_ROLE_OPTIONS;
    }

    get nameContext() {
        return {
            currentUserId: this.currentUserId || null,
            unknownLabels: buildUnknownLabels(this.members, this.currentUserId || null)
        };
    }

    /**
     * Open with a fresh member list.
     * @param {Array} members
     * @param {{ pendingInvites?: Array }} [options]
     */
    async open(members = [], options = {}) {
        this.members = this.sortMembers(
            (members || []).map((m) => ({
                id: String(m.id),
                email: m.email || '',
                username: m.username || '',
                firstName: m.firstName || m.first_name || '',
                lastName: m.lastName || m.last_name || '',
                role: m.locked ? 'admin' : (m.role || 'collaborator'),
                locked: Boolean(m.locked)
            }))
        );
        this._baselineIds = new Set(
            this.members.filter((m) => !m.locked).map((m) => m.id)
        );
        this.pendingInvites = Array.isArray(options.pendingInvites) ? options.pendingInvites : [];
        this.emailQuery = '';
        this.lookupMessage = '';
        this.matchedUser = null;
        this.unknownEmail = '';
        this.inviteRole = '';
        this.lastInviteUrl = options.lastInviteUrl || this.lastInviteUrl || '';
        this.error = '';
        this.inviting = false;
        await this.updateComplete;
        this.renderRoot?.querySelector('app-dialog')?.openDialog?.();
    }

    close() {
        this.renderRoot?.querySelector('app-dialog')?.closeDialog?.();
    }

    sortMembers(list = []) {
        const ctx = {
            currentUserId: this.currentUserId || null,
            unknownLabels: buildUnknownLabels(list, this.currentUserId || null)
        };
        return [...list].sort((a, b) => {
            if (a.locked && !b.locked) return -1;
            if (!a.locked && b.locked) return 1;
            const aMe = ctx.currentUserId && String(a.id) === String(ctx.currentUserId);
            const bMe = ctx.currentUserId && String(b.id) === String(ctx.currentUserId);
            if (aMe && !bMe) return -1;
            if (!aMe && bMe) return 1;
            const rank = (role) => {
                if (role === 'admin') return 0;
                if (role === 'collaborator') return 1;
                return 2;
            };
            const diff = rank(a.role) - rank(b.role);
            if (diff !== 0) return diff;
            return displayName(a, ctx).localeCompare(displayName(b, ctx));
        });
    }

    memberIsEditable(member) {
        if (!member || member.locked) return false;
        // Only case admins edit roles / remove after invite API owns adds.
        return this.canManage;
    }

    handleRoleChange(memberId, event) {
        const role = event.target?.value || event.detail?.value;
        if (!role) return;
        this.members = this.sortMembers(this.members.map((m) => (
            m.id === memberId ? { ...m, role } : m
        )));
    }

    handleRemove(memberId) {
        const member = this.members.find((m) => m.id === memberId);
        if (!member || !this.memberIsEditable(member)) return;
        this.members = this.members.filter((m) => m.id !== memberId);
    }

    async handleLookup(event) {
        event.preventDefault();
        const email = this.emailQuery.trim();
        this.lookupMessage = '';
        this.matchedUser = null;
        this.unknownEmail = '';
        if (!email) {
            this.lookupMessage = t('people.enterEmail');
            return;
        }
        if (typeof this.lookupFn !== 'function') {
            this.lookupMessage = t('people.lookupUnavailable');
            return;
        }

        this.lookingUp = true;
        try {
            const user = await this.lookupFn(email);
            if (this.members.some((m) => String(m.id) === String(user.id))) {
                this.lookupMessage = t('people.alreadyOnList');
                return;
            }
            this.matchedUser = user;
            this.inviteRole = '';
        } catch (error) {
            if (error.status === 404) {
                this.unknownEmail = email;
                this.inviteRole = '';
                this.lookupMessage = t('people.noAccountYet');
            } else if (error.status === 400) {
                this.lookupMessage = t('collaborators.invalidEmail');
            } else {
                this.lookupMessage = t('collaborators.searchFailed');
            }
        } finally {
            this.lookingUp = false;
        }
    }

    async handleAddMatched() {
        if ((!this.matchedUser && !this.unknownEmail) || !this.inviteRole || this.inviting) return;
        const email = String(
            this.matchedUser?.email || this.unknownEmail || this.emailQuery || ''
        ).trim();
        if (!email) {
            this.lookupMessage = t('people.noEmailOnFile');
            return;
        }

        if (typeof this.inviteFn === 'function') {
            this.inviting = true;
            this.error = '';
            try {
                const result = await this.inviteFn({ email, role: this.inviteRole });
                this.matchedUser = null;
                this.unknownEmail = '';
                this.emailQuery = '';
                this.inviteRole = '';
                if (result?.status === 'signup_invite' && result?.inviteUrl) {
                    this.lastInviteUrl = result.inviteUrl;
                    this.lookupMessage = result.emailSent
                        ? t('people.inviteEmailSent')
                        : t('people.inviteLinkReady');
                } else if (result?.status === 'pending' || result?.status === 'pending_approval') {
                    this.lookupMessage = t('people.invitePending');
                } else {
                    this.lookupMessage = t('people.personAdded');
                }
                this.dispatchEvent(new CustomEvent('people-invited', {
                    detail: result || {},
                    bubbles: true,
                    composed: true
                }));
            } catch (err) {
                this.error = err?.message || t('people.inviteFailed');
            } finally {
                this.inviting = false;
            }
            return;
        }

        const user = this.matchedUser;
        this.members = this.sortMembers([
            ...this.members,
            {
                id: String(user.id),
                email: user.email || '',
                username: user.username || user.email || user.id,
                firstName: user.firstName || user.first_name || '',
                lastName: user.lastName || user.last_name || '',
                role: this.inviteRole,
                locked: false
            }
        ]);
        this.matchedUser = null;
        this.emailQuery = '';
        this.inviteRole = '';
        this.lookupMessage = '';
    }

    async copyInviteUrl() {
        const url = this.lastInviteUrl;
        if (!url) return;
        try {
            await navigator.clipboard.writeText(url);
            this.lookupMessage = t('people.inviteLinkCopied');
        } catch {
            this.lookupMessage = t('people.copyFailed');
        }
    }

    handleCancel() {
        this.close();
        this.dispatchEvent(new CustomEvent('people-cancel', {
            bubbles: true,
            composed: true
        }));
    }

    handleSave() {
        if (this.saving) return;
        const members = this.members
            .filter((m) => !m.locked)
            .map((m) => ({ userId: m.id, role: m.role || 'collaborator' }));
        this.dispatchEvent(new CustomEvent('people-save', {
            detail: { members },
            bubbles: true,
            composed: true
        }));
    }

    renderMemberRow(member) {
        const ctx = this.nameContext;
        const name = displayName(member, ctx);
        const secondary = memberSecondaryLine(member, ctx);
        const editable = this.memberIsEditable(member);
        return html`
            <div class="row">
                <div class="avatar" aria-hidden="true">${initialFor(member, ctx)}</div>
                <div class="identity">
                    <span class="name">${name}</span>
                    ${secondary ? html`<span class="email">${secondary}</span>` : ''}
                </div>
                <div class="meta">
                    ${editable ? html`
                        <dropdown-select
                            .value=${member.role || 'collaborator'}
                            .options=${this.effectiveRoleOptions.filter((o) => o.value)}
                            aria-label=${t('people.roleForPerson', { name })}
                            @change=${(e) => this.handleRoleChange(member.id, e)}
                        ></dropdown-select>
                        <button
                            class="icon-button"
                            type="button"
                            title=${t('common.remove')}
                            aria-label=${t('people.removePerson', { name })}
                            ?disabled=${this.saving}
                            @click=${() => this.handleRemove(member.id)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                        </button>
                    ` : html`
                        <span class="badge">${roleLabel(member.role)}</span>
                    `}
                </div>
            </div>
        `;
    }

    renderInvite() {
        if (!this.canInvite) return html``;
        const target = this.matchedUser || (this.unknownEmail
            ? { email: this.unknownEmail, firstName: '', lastName: '', username: this.unknownEmail }
            : null);
        const addDisabled = !target || !this.inviteRole || this.saving || this.inviting;
        return html`
            <div class="invite-footer">
                <form class="invite-row" @submit=${(e) => this.handleLookup(e)}>
                    <input
                        class="invite-input"
                        type="email"
                        placeholder=${t('people.inviteByEmail')}
                        .value=${this.emailQuery}
                        ?disabled=${this.lookingUp || this.saving || this.inviting}
                        @input=${(e) => { this.emailQuery = e.target.value; }}
                    />
                    <button
                        class="secondary-button"
                        type="submit"
                        ?disabled=${this.lookingUp || this.saving || this.inviting}
                    >
                        ${this.lookingUp ? t('people.finding') : t('people.find')}
                    </button>
                </form>
                ${this.lookupMessage ? html`
                    <p class="invite-status ${/added|sent|notified|waiting|ready|copied|create one|email/i.test(this.lookupMessage) ? '' : (target ? '' : 'error')}">${this.lookupMessage}</p>
                ` : ''}
                ${this.lastInviteUrl ? html`
                    <div class="invite-link-row">
                        <input class="invite-input" type="text" readonly .value=${this.lastInviteUrl} />
                        <button class="secondary-button" type="button" @click=${() => this.copyInviteUrl()}>
                            ${t('people.copyLink')}
                        </button>
                    </div>
                ` : ''}
                ${target ? html`
                    <div class="invite-match">
                        <div class="avatar" aria-hidden="true">${initialFor(target)}</div>
                        <div class="identity">
                            <span class="name">${this.matchedUser
                                ? displayName(this.matchedUser, this.nameContext)
                                : this.unknownEmail}</span>
                            ${target.email ? html`
                                <span class="email">${target.email}${this.unknownEmail ? ` · ${t('people.newAccount')}` : ''}</span>
                            ` : ''}
                        </div>
                        <div class="meta">
                            <dropdown-select
                                .value=${this.inviteRole}
                                .options=${this.effectiveRoleOptions}
                                aria-label=${t('people.roleForNew')}
                                @change=${(e) => { this.inviteRole = e.target?.value || e.detail?.value || ''; }}
                            ></dropdown-select>
                            <button
                                class="primary-button"
                                type="button"
                                ?disabled=${addDisabled}
                                @click=${() => this.handleAddMatched()}
                            >${this.inviting ? t('people.sending') : (this.unknownEmail ? t('people.inviteToCreate') : t('people.invite'))}</button>
                        </div>
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderPending() {
        const pending = (Array.isArray(this.pendingInvites) ? this.pendingInvites : [])
            .filter((invite) => invite && invite.status !== 'expired');
        if (!pending.length) return html``;
        return html`
            <div class="pending-block">
                <p class="pending-heading">${t('people.pendingInvites')}</p>
                ${pending.map((invite) => {
                    const isSignup = invite.kind === 'signup';
                    const needsApproval = invite.status === 'pending'
                        || invite.status === 'pending_approval';
                    const awaitingSignup = invite.status === 'pending_signup';
                    const statusSuffix = awaitingSignup
                        ? t('people.awaitingSignup')
                        : `${t('people.awaitingApproval')}${isSignup ? ` (${t('people.newAccount')})` : ''}`;
                    const statusLine = `${roleLabel(invite.proposedRole)} · ${statusSuffix}`;
                    return html`
                    <div class="row">
                        <div class="identity">
                            <span class="name">${invite.inviteeEmail || invite.inviteeDirectusUserId}</span>
                            <span class="email">${statusLine}</span>
                        </div>
                        ${this.canManage ? html`
                            <div class="pending-actions">
                                ${needsApproval ? html`
                                    <button
                                        class="primary-button"
                                        type="button"
                                        ?disabled=${this.saving}
                                        @click=${() => this.dispatchEvent(new CustomEvent('people-approve-invite', {
                                            detail: { inviteId: invite.id, kind: inviteKind(invite) },
                                            bubbles: true,
                                            composed: true
                                        }))}
                                    >${t('people.approve')}</button>
                                ` : ''}
                                <button
                                    class="secondary-button"
                                    type="button"
                                    ?disabled=${this.saving}
                                    @click=${() => this.dispatchEvent(new CustomEvent('people-reject-invite', {
                                        detail: { inviteId: invite.id, kind: inviteKind(invite) },
                                        bubbles: true,
                                        composed: true
                                    }))}
                >${awaitingSignup ? t('common.cancel') : t('people.reject')}</button>
                    </div>
                        ` : html`<span class="badge">${awaitingSignup ? t('people.linkSent') : t('people.pending')}</span>`}
                    </div>
                `;
                })}
            </div>
        `;
    }

    render() {
        return html`
            <app-dialog
                .title=${this.title}
                .lightDismiss=${true}
            >
                <div class="body">
                    ${this.error ? html`<p class="error">${this.error}</p>` : ''}

                    <div class="list">
                        <div class="list-scroll">
                            ${this.members.length === 0 ? html`
                                <p class="empty">${t('people.noPeople')}</p>
                            ` : this.members.map((m) => this.renderMemberRow(m))}
                        </div>
                        ${this.renderInvite()}
                    </div>

                    ${this.renderPending()}

                    ${this.saving ? html`<p class="saving">${t('common.saving')}</p>` : ''}
                </div>

                ${this.canManage ? html`
                    <button
                        slot="actions"
                        class="secondary-button"
                        type="button"
                        ?disabled=${this.saving}
                        @click=${() => this.handleCancel()}
                    >${t('common.cancel')}</button>
                    <button
                        slot="actions"
                        class="primary-button"
                        type="button"
                        ?disabled=${this.saving}
                        @click=${() => this.handleSave()}
                    >${t('common.save')}</button>
                ` : html`
                    <button
                        slot="actions"
                        class="secondary-button"
                        type="button"
                        @click=${() => this.handleCancel()}
                    >${t('common.close')}</button>
                `}
            </app-dialog>
        `;
    }
}

customElements.define('people-dialog', PeopleDialog);
