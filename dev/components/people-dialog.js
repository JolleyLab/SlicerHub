import { LitElement, html } from 'lit-element';
import { peopleDialogStyles } from './people-dialog.styles.js';
import './person-chip.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import { isInviteEmailEnabled } from '../services/features.js';
import { normalizeMember } from '../utils/memberNormalize.js';
import { roleOrder } from '../utils/casePermissions.js';
import { roleLabel } from '../utils/activityItems.js';
import './app-dialog.js';
import './app-button.js';
import './badge-pill.js';
import './icon-button.js';
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


function personFullName(person) {
    if (person?.displayName) return String(person.displayName).trim();
    if (person?.preferredName) return String(person.preferredName).trim();
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
        return peopleDialogStyles;
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
            /** Directus user id of the signed-in viewer (for "Me" label) */
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
            (members || []).map(normalizeMember)
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
            const diff = roleOrder(a.role) - roleOrder(b.role);
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
                    this.lookupMessage = (result.emailSent && isInviteEmailEnabled())
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
                preferredName: user.preferredName || '',
                displayName: user.displayName || '',
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
                <person-chip
                    .avatarUrl=${member.avatarUrl || ''}
                    .name=${name}
                    .secondaryLine=${secondary}
                ></person-chip>
                <div class="meta">
                    ${editable ? html`
                        <dropdown-select
                            .value=${member.role || 'collaborator'}
                            .options=${this.effectiveRoleOptions.filter((o) => o.value)}
                            aria-label=${t('people.roleForPerson', { name })}
                            @change=${(e) => this.handleRoleChange(member.id, e)}
                        ></dropdown-select>
                        <icon-button
                            label=${t('people.removePerson', { name })}
                            title=${t('common.remove')}
                            ?disabled=${this.saving}
                            @click=${() => this.handleRemove(member.id)}
                        >
                            <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
                                <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                            </svg>
                        </icon-button>
                    ` : html`
                        <badge-pill>${roleLabel(member.role)}</badge-pill>
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
                    <app-button
                        variant="ghost"
                        type="submit"
                        ?disabled=${this.lookingUp || this.saving || this.inviting}
                    >
                        ${this.lookingUp ? t('people.finding') : t('people.find')}
                    </app-button>
                </form>
                ${this.lookupMessage ? html`
                    <p class="invite-status ${/added|sent|notified|waiting|ready|copied|create one|email/i.test(this.lookupMessage) ? '' : (target ? '' : 'error')}">${this.lookupMessage}</p>
                ` : ''}
                ${this.lastInviteUrl ? html`
                    <div class="invite-link-row">
                        <input class="invite-input" type="text" readonly .value=${this.lastInviteUrl} />
                        <app-button variant="ghost" @click=${() => this.copyInviteUrl()}>
                            ${t('people.copyLink')}
                        </app-button>
                    </div>
                ` : ''}
                ${target ? html`
                    <div class="invite-match">
                        <person-chip
                            .name=${this.matchedUser ? displayName(this.matchedUser, this.nameContext) : this.unknownEmail}
                            .secondaryLine=${target.email ? (target.email + (this.unknownEmail ? ` · ${t('people.newAccount')}` : '')) : ''}
                        ></person-chip>
                        <div class="meta">
                            <dropdown-select
                                .value=${this.inviteRole}
                                .options=${this.effectiveRoleOptions}
                                aria-label=${t('people.roleForNew')}
                                @change=${(e) => { this.inviteRole = e.target?.value || e.detail?.value || ''; }}
                            ></dropdown-select>
                            <app-button
                                variant="primary"
                                ?disabled=${addDisabled}
                                @click=${() => this.handleAddMatched()}
                            >${this.inviting ? t('people.sending') : (this.unknownEmail ? t('people.inviteToCreate') : t('people.invite'))}</app-button>
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
                        <person-chip
                            .name=${invite.inviteeEmail || invite.inviteeDirectusUserId}
                            .secondaryLine=${statusLine}
                        ></person-chip>
                        ${this.canManage ? html`
                            <div class="pending-actions">
                                ${needsApproval ? html`
                                    <app-button
                                        variant="primary"
                                        ?disabled=${this.saving}
                                        @click=${() => this.dispatchEvent(new CustomEvent('people-approve-invite', {
                detail: { inviteId: invite.id, kind: inviteKind(invite) },
                bubbles: true,
                composed: true
            }))}
                                    >${t('people.approve')}</app-button>
                                ` : ''}
                                <app-button
                                    variant="ghost"
                                    ?disabled=${this.saving}
                                    @click=${() => this.dispatchEvent(new CustomEvent('people-reject-invite', {
                detail: { inviteId: invite.id, kind: inviteKind(invite) },
                bubbles: true,
                composed: true
            }))}
                                >${awaitingSignup ? t('common.cancel') : t('people.reject')}</app-button>
                            </div>
                        ` : html`<badge-pill>${awaitingSignup ? t('people.linkSent') : t('people.pending')}</badge-pill>`}
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
                    <app-button
                        slot="actions"
                        variant="ghost"
                        ?disabled=${this.saving}
                        @click=${() => this.handleCancel()}
                    >${t('common.cancel')}</app-button>
                    <app-button
                        slot="actions"
                        variant="primary"
                        ?disabled=${this.saving}
                        @click=${() => this.handleSave()}
                    >${t('common.save')}</app-button>
                ` : html`
                    <app-button
                        slot="actions"
                        variant="ghost"
                        @click=${() => this.handleCancel()}
                    >${t('common.close')}</app-button>
                `}
            </app-dialog>
        `;
    }
}

customElements.define('people-dialog', PeopleDialog);
