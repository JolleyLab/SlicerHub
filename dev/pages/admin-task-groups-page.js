import { LitElement, html } from 'lit-element';
import { panelStyles } from '../styles/panel.js';
import { buttonStyles } from '../styles/buttons.js';
import { adminTaskGroupsStyles } from './admin-task-groups-page.styles.js';
import '../components/person-chip.js';
import { t } from '../i18n/index.js';
import '../components/page-layout-template.js';
import {
    getMyGroups,
    getMyGroup,
    createMyGroup,
    updateMyGroup,
    addMyGroupMember,
    updateMyGroupMember,
    removeMyGroupMember,
    listTaskGroups,
    getTaskGroup,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
    addTaskGroupMember,
    removeTaskGroupMember,
    updateTaskGroupMember,
} from '../services/groups.js';
import { getPendingRegistrationsCount } from '../services/registrations.js';

export class AdminTaskGroupsPage extends LitElement {
    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean },
            currentDirectusUserId: { type: String },
            _unifiedList: { type: Array },
            _selectedGroup: { type: Object },
            _activeTab: { type: String },
            _loading: { type: Boolean },
            _detailLoading: { type: Boolean },
            _error: { type: String },
            _detailError: { type: String },
            _creating: { type: Boolean },
            _saving: { type: Boolean },
            _editName: { type: String },
            _editDesc: { type: String },
            _addEmail: { type: String },
            _addError: { type: String },
            _addBusy: { type: Boolean },
            _saved: { type: Boolean },
            _newName: { type: String },
            _newDesc: { type: String },
            _newFormError: { type: String },
            _pendingCount: { type: Number }
        };
    }

    static get styles() {
        return [panelStyles, buttonStyles, adminTaskGroupsStyles];
    }

    constructor() {
        super();
        this.username = '';
        this.avatarUrl = '';
        this.isOrgAdmin = false;
        this.isRegistrationReviewer = false;
        this.currentDirectusUserId = '';
        this._unifiedList = [];
        this._selectedGroup = null;
        this._activeTab = 'tasks';
        this._loading = true;
        this._detailLoading = false;
        this._error = '';
        this._detailError = '';
        this._creating = false;
        this._saving = false;
        this._editName = '';
        this._editDesc = '';
        this._addEmail = '';
        this._addError = '';
        this._addBusy = false;
        this._saved = false;
        this._newName = '';
        this._newDesc = '';
        this._newFormError = '';
        this._pendingCount = null;
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadGroups();
    }

    // ── Data loading ──────────────────────────────────────────────

    async _loadGroups() {
        this._loading = true;
        this._error = '';
        try {
            const fetches = this.isOrgAdmin
                ? [listTaskGroups(), getMyGroups()]
                : [getMyGroups()];
            if (this.isRegistrationReviewer) fetches.push(getPendingRegistrationsCount());

            const results = await Promise.all(fetches);

            if (this.isOrgAdmin) {
                const [allGroups, myMemberships] = results;
                const membershipMap = new Map(myMemberships.map(m => [m.group.id, m]));
                this._unifiedList = allGroups.map(g => ({
                    group: g,
                    canManageGroup: true,
                    isMember: membershipMap.has(g.id)
                }));
            } else {
                const [myMemberships] = results;
                this._unifiedList = myMemberships.map(m => ({
                    group: m.group,
                    canManageGroup: m.canManageGroup,
                    isMember: true
                }));
            }

            if (this.isRegistrationReviewer) {
                this._pendingCount = results[results.length - 1];
            }

            // Re-sync the selected group if it's still in the list
            if (this._selectedGroup) {
                const stillThere = this._unifiedList.find(e => e.group.id === this._selectedGroup.id);
                if (!stillThere) this._selectedGroup = null;
            }
        } catch (err) {
            this._error = err?.message || t('errors.generic');
        } finally {
            this._loading = false;
        }
    }

    async _selectGroup(id) {
        if (this._selectedGroup?.id === id && !this._creating) return;
        this._creating = false;
        this._detailError = '';
        this._addError = '';
        this._saved = false;
        this._detailLoading = true;
        this._selectedGroup = null;
        try {
            const group = this.isOrgAdmin
                ? await getTaskGroup(id)
                : await getMyGroup(id);
            this._selectedGroup = group;
            this._editName = group.name;
            this._editDesc = group.description || '';
            this._activeTab = this._defaultTab(this._unifiedList.find(e => e.group.id === id));
        } catch (err) {
            this._detailError = err?.message || t('errors.generic');
        } finally {
            this._detailLoading = false;
        }
    }

    // ── Helpers ───────────────────────────────────────────────────

    _defaultTab(entry) {
        if (!entry) return 'members';
        if (this._hasTasks(entry)) return 'tasks';
        if (this._canManage(entry)) return 'manage';
        return 'members';
    }

    _canManage(entry) {
        return this.isOrgAdmin || entry?.canManageGroup === true;
    }

    _hasTasks(entry) {
        return entry?.group.canApproveRegistrations && this.isRegistrationReviewer;
    }

    _selectedEntry() {
        if (!this._selectedGroup) return null;
        return this._unifiedList.find(e => e.group.id === this._selectedGroup.id) || null;
    }


    _capBadge(group) {
        const caps = [];
        if (group.canApproveRegistrations) caps.push('Approvals');
        return caps.join(', ') || null;
    }

    // ── Actions ───────────────────────────────────────────────────

    _startCreating() {
        this._creating = true;
        this._selectedGroup = null;
        this._newName = '';
        this._newDesc = '';
        this._newFormError = '';
        this._detailError = '';
    }

    async _createGroup(e) {
        e.preventDefault();
        if (this._saving || !this._newName.trim()) return;
        this._saving = true;
        this._newFormError = '';
        try {
            const group = this.isOrgAdmin
                ? await createTaskGroup({ name: this._newName.trim(), description: this._newDesc.trim() })
                : await createMyGroup({ name: this._newName.trim(), description: this._newDesc.trim() });
            await this._loadGroups();
            this._creating = false;
            await this._selectGroup(group.id);
        } catch (err) {
            this._newFormError = err?.message || t('errors.generic');
        } finally {
            this._saving = false;
        }
    }

    async _saveGroup(e) {
        e.preventDefault();
        if (this._saving || !this._selectedGroup) return;
        this._saving = true;
        this._saved = false;
        this._detailError = '';
        try {
            if (this.isOrgAdmin) {
                await updateTaskGroup(this._selectedGroup.id, {
                    name: this._editName.trim(),
                    description: this._editDesc.trim()
                });
            } else {
                await updateMyGroup(this._selectedGroup.id, {
                    name: this._editName.trim(),
                    description: this._editDesc.trim()
                });
            }
            await this._loadGroups();
            await this._selectGroup(this._selectedGroup.id);
            this._saved = true;
            setTimeout(() => { this._saved = false; }, 3000);
        } catch (err) {
            this._detailError = err?.message || t('errors.generic');
        } finally {
            this._saving = false;
        }
    }

    async _deleteGroup() {
        if (!this._selectedGroup) return;
        if (!confirm(`Delete group "${this._selectedGroup.name}"? This will remove all members.`)) return;
        this._detailError = '';
        try {
            await deleteTaskGroup(this._selectedGroup.id);
            this._selectedGroup = null;
            await this._loadGroups();
        } catch (err) {
            this._detailError = err?.message || t('errors.generic');
        }
    }

    async _addMember() {
        if (!this._selectedGroup || !this._addEmail.trim() || this._addBusy) return;
        this._addBusy = true;
        this._addError = '';
        try {
            if (this.isOrgAdmin) {
                await addTaskGroupMember(this._selectedGroup.id, { email: this._addEmail.trim() });
            } else {
                await addMyGroupMember(this._selectedGroup.id, { email: this._addEmail.trim() });
            }
            this._addEmail = '';
            await this._selectGroup(this._selectedGroup.id);
        } catch (err) {
            this._addError = err?.message || t('errors.generic');
        } finally {
            this._addBusy = false;
        }
    }

    async _removeMember(memberId) {
        if (!this._selectedGroup) return;
        this._addError = '';
        try {
            if (this.isOrgAdmin) {
                await removeTaskGroupMember(this._selectedGroup.id, memberId);
            } else {
                await removeMyGroupMember(this._selectedGroup.id, memberId);
            }
            await this._selectGroup(this._selectedGroup.id);
        } catch (err) {
            this._addError = err?.message || t('errors.generic');
        }
    }

    async _updateMemberPermission(memberId, permission, value) {
        if (!this._selectedGroup) return;
        this._addError = '';
        // Optimistic update
        this._selectedGroup = {
            ...this._selectedGroup,
            members: this._selectedGroup.members.map(m =>
                m.id === memberId ? { ...m, [permission]: value } : m
            )
        };
        try {
            if (this.isOrgAdmin) {
                await updateTaskGroupMember(this._selectedGroup.id, memberId, { [permission]: value });
            } else {
                await updateMyGroupMember(this._selectedGroup.id, memberId, { [permission]: value });
            }
        } catch (err) {
            this._addError = err?.message || t('errors.generic');
            await this._selectGroup(this._selectedGroup.id);
        }
    }

    _navigateTo(selectedKey) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey },
            bubbles: true,
            composed: true
        }));
    }

    handleMenuSelectionChange(e) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: e.detail,
            bubbles: true,
            composed: true
        }));
    }

    // ── Render ────────────────────────────────────────────────────

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin}
                .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                selectedMenuKey="my-groups"
                homeHref="/file-manager"
                homeLabel=${t('common.home')}
                pageTitle=${t('taskGroups.title')}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content">
                    ${this._error ? html`<div class="error-msg" style="margin-bottom:12px">${this._error}</div>` : ''}
                    ${this._renderUnifiedView()}
                </div>
            </page-layout-template>
        `;
    }

    _renderUnifiedView() {
        return html`
            <div class="layout">
                <!-- Sidebar: group list -->
                <div class="panel">
                    <div class="sidebar-header">
                        <p class="sidebar-title">${t('taskGroups.title')}</p>
                        <button class="primary-button btn-sm" @click=${this._startCreating}>
                            + ${t('taskGroups.newGroup')}
                        </button>
                    </div>
                    ${this._loading
                ? html`<div class="loading">${t('common.loading')}</div>`
                : this._unifiedList.length === 0 && !this._creating
                    ? html`<div class="empty-sidebar">${t('taskGroups.noGroups')}</div>`
                    : html`
                                <ul class="group-list" role="listbox" aria-label=${t('taskGroups.title')}>
                                    ${this._unifiedList.map(({ group }) => html`
                                        <li class="group-item ${this._selectedGroup?.id === group.id ? 'selected' : ''}"
                                            role="option"
                                            tabindex="0"
                                            aria-selected=${this._selectedGroup?.id === group.id ? 'true' : 'false'}
                                            @click=${() => this._selectGroup(group.id)}
                                            @keydown=${e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); this._selectGroup(group.id); } }}>
                                            <span class="group-name">${group.name}</span>
                                            ${this._capBadge(group) ? html`<span class="group-caps">${this._capBadge(group)}</span>` : ''}
                                        </li>
                                    `)}
                                </ul>
                            `
            }
                </div>

                <!-- Detail panel -->
                <div class="panel">
                    ${this._creating
                ? this._renderNewGroupForm()
                : this._detailLoading
                    ? html`<div class="loading">${t('common.loading')}</div>`
                    : this._selectedGroup
                        ? this._renderGroupDetail()
                        : html`<div class="placeholder">${t('taskGroups.selectGroup')}</div>`
            }
                </div>
            </div>
        `;
    }

    _renderNewGroupForm() {
        return html`
            <div class="detail-header">
                <p class="detail-title">${t('taskGroups.createGroup')}</p>
            </div>
            <div class="tab-content">
                ${this._detailError ? html`<p class="detail-error">${this._detailError}</p>` : ''}
                <form @submit=${this._createGroup}>
                    <div class="form-group">
                        <label for="new-group-name">${t('taskGroups.groupName')}</label>
                        <input id="new-group-name" type="text" required autofocus
                            placeholder="${t('taskGroups.namePlaceholder')}"
                            .value=${this._newName}
                            @input=${e => { this._newName = e.target.value; }} />
                    </div>
                    <div class="form-group">
                        <label for="new-group-desc">${t('taskGroups.description')}</label>
                        <textarea id="new-group-desc"
                            placeholder="${t('taskGroups.descriptionPlaceholder')}"
                            .value=${this._newDesc}
                            @input=${e => { this._newDesc = e.target.value; }}></textarea>
                    </div>
                    ${this._newFormError ? html`<p class="error-msg">${this._newFormError}</p>` : ''}
                    <div class="new-group-actions">
                        <button type="submit" class="primary-button" ?disabled=${this._saving || !this._newName.trim()}>
                            ${this._saving ? t('taskGroups.saving') : t('taskGroups.createGroup')}
                        </button>
                        <button type="button" class="secondary-button"
                            @click=${() => { this._creating = false; }}>
                            ${t('taskGroups.cancel')}
                        </button>
                    </div>
                </form>
            </div>
        `;
    }

    _renderGroupDetail() {
        const entry = this._selectedEntry();
        const canManage = this._canManage(entry);
        const hasTasks = this._hasTasks(entry);

        const tabs = [
            ...(hasTasks ? [{ key: 'tasks', label: t('taskGroups.tasks') }] : []),
            { key: 'members', label: t('taskGroups.members') },
            ...(canManage ? [{ key: 'manage', label: 'Manage' }] : [])
        ];
        const activeTab = tabs.find(tb => tb.key === this._activeTab) ? this._activeTab : (tabs[0]?.key || 'members');

        return html`
            <div class="detail-header">
                <p class="detail-title">${this._selectedGroup.name}</p>
            </div>
            ${tabs.length > 1 ? html`
                <div class="tab-bar" role="tablist">
                    ${tabs.map(tb => html`
                        <button class="tab-btn ${activeTab === tb.key ? 'active' : ''}"
                            role="tab"
                            aria-selected=${activeTab === tb.key ? 'true' : 'false'}
                            @click=${() => { this._activeTab = tb.key; }}>
                            ${tb.label}
                            ${tb.key === 'tasks' && this._pendingCount ? html`
                                <span class="task-badge btn-sm" style="margin-left:6px">${this._pendingCount}</span>
                            ` : ''}
                        </button>
                    `)}
                </div>
            ` : ''}
            ${this._detailError ? html`<p class="detail-error" style="padding:12px 16px 0;margin:0">${this._detailError}</p>` : ''}
            <div class="tab-content">
                ${activeTab === 'tasks' ? this._renderTasksTab(entry) : ''}
                ${activeTab === 'members' ? this._renderMembersTab(canManage) : ''}
                ${activeTab === 'manage' ? this._renderManageTab() : ''}
            </div>
        `;
    }

    _renderTasksTab(entry) {
        const hasPendingReg = this._hasTasks(entry);
        if (!hasPendingReg) {
            return html`<p class="no-tasks">${t('taskGroups.noTasks')}</p>`;
        }
        return html`
            <ul class="task-list">
                ${hasPendingReg ? html`
                    <li class="task-item">
                        <span class="task-label">${t('nav.pendingRegistrations')}</span>
                        <div class="task-actions">
                            ${this._pendingCount !== null ? html`
                                <span class="task-badge ${this._pendingCount === 0 ? 'empty' : ''}">
                                    ${this._pendingCount}
                                </span>
                            ` : ''}
                            <button class="primary-button btn-sm"
                                @click=${() => this._navigateTo('admin-registrations')}>
                                ${t('taskGroups.reviewAction')}
                            </button>
                        </div>
                    </li>
                ` : ''}
            </ul>
        `;
    }

    _renderMembersTab(canManage) {
        const members = this._selectedGroup.members || [];
        return html`
            ${members.length > 0 ? html`
                <ul class="member-list">
                    ${members.map(m => html`
                        <li class="member-row">
                            <person-chip
                                .avatarUrl=${m.avatarUrl || ''}
                                .name=${[m.firstName, m.lastName].filter(Boolean).join(' ')}
                                .secondaryLine=${m.email || ''}
                            ></person-chip>
                            ${canManage ? html`
                                <div class="member-perms">
                                    <label class="perm-row" title=${m.directusUserId === this.currentDirectusUserId ? t('taskGroups.cannotRemoveOwnManage') : ''}>
                                        <input type="checkbox"
                                            .checked=${m.canManageGroup}
                                            ?disabled=${m.directusUserId === this.currentDirectusUserId}
                                            @change=${e => this._updateMemberPermission(m.id, 'canManageGroup', e.target.checked)} />
                                        ${t('taskGroups.canManageGroup')}
                                    </label>
                                </div>
                                <button class="danger-button" type="button"
                                    title="Remove ${m.firstName} ${m.lastName}"
                                    aria-label="Remove ${m.firstName} ${m.lastName}"
                                    @click=${() => this._removeMember(m.id)}>
                                    <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                                        <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                    </svg>
                                </button>
                            ` : html`
                                <span class="role-badge ${m.canManageGroup ? 'manager' : ''}">
                                    ${m.canManageGroup ? t('taskGroups.myGroupsManager') : t('taskGroups.myGroupsMember')}
                                </span>
                                <span></span>
                            `}
                        </li>
                    `)}
                </ul>
            ` : html`<p style="font-size:13px;color:var(--color-text-secondary)">${t('taskGroups.noMembers')}</p>`}

            ${canManage ? html`
                ${this._addError ? html`<p class="error-msg">${this._addError}</p>` : ''}
                <p class="section-heading" style="margin-top:16px">${t('taskGroups.addMemberLabel')}</p>
                <div class="add-member-row">
                    <input type="email"
                        placeholder="${t('taskGroups.emailPlaceholder')}"
                        .value=${this._addEmail}
                        @input=${e => { this._addEmail = e.target.value; this._addError = ''; }}
                        @keydown=${e => { if (e.key === 'Enter') { e.preventDefault(); this._addMember(); } }} />
                    <button class="primary-button" type="button"
                        ?disabled=${!this._addEmail.trim() || this._addBusy}
                        @click=${this._addMember}>
                        ${this._addBusy ? '…' : t('taskGroups.addMember')}
                    </button>
                </div>
            ` : ''}
        `;
    }

    _renderManageTab() {
        const entry = this._selectedEntry();
        const canDelete = this.isOrgAdmin && !this._selectedGroup.canApproveRegistrations;
        return html`
            <form @submit=${this._saveGroup}>
                <div class="form-group">
                    <label for="edit-group-name">${t('taskGroups.groupName')}</label>
                    <input id="edit-group-name" type="text" required
                        .value=${this._editName}
                        @input=${e => { this._editName = e.target.value; }} />
                </div>
                <div class="form-group">
                    <label for="edit-group-desc">${t('taskGroups.description')}</label>
                    <textarea id="edit-group-desc"
                        .value=${this._editDesc}
                        @input=${e => { this._editDesc = e.target.value; }}></textarea>
                </div>
                <div class="action-row">
                    ${canDelete ? html`
                        <button type="button" class="secondary-button" @click=${() => this._deleteGroup()}>
                            ${t('taskGroups.deleteGroup')}
                        </button>
                    ` : html`<span></span>`}
                    <div>
                        ${this._saved ? html`<span class="saved-badge">${t('taskGroups.saved')}</span>` : ''}
                        <button type="submit" class="primary-button" ?disabled=${this._saving}>
                            ${this._saving ? t('taskGroups.saving') : t('taskGroups.save')}
                        </button>
                    </div>
                </div>
            </form>
        `;
    }
}

customElements.define('admin-task-groups-page', AdminTaskGroupsPage);
