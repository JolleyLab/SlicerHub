import { LitElement, html, css } from 'lit-element';
import { t } from './i18n/index.js';
import './components/page-layout-template.js';
import {
    getMyGroups,
    createMyGroup,
    listTaskGroups,
    getTaskGroup,
    createTaskGroup,
    updateTaskGroup,
    deleteTaskGroup,
    addTaskGroupMember,
    removeTaskGroupMember,
    updateTaskGroupMember
} from './services/directus.js';

export class AdminTaskGroupsPage extends LitElement {
    static get properties() {
        return {
            username:        { type: String },
            avatarUrl:       { type: String },
            isOrgAdmin:      { type: Boolean },
            _memberships:    { type: Array },
            _groups:         { type: Array },
            _selectedGroup:  { type: Object },
            _loading:        { type: Boolean },
            _detailLoading:  { type: Boolean },
            _error:          { type: String },
            _detailError:    { type: String },
            _creating:       { type: Boolean },
            _saving:         { type: Boolean },
            _editName:       { type: String },
            _editDesc:       { type: String },
            _editCanApprove: { type: Boolean },
            _addEmail:       { type: String },
            _addError:       { type: String },
            _addBusy:        { type: Boolean },
            _saved:          { type: Boolean },
            _newName:        { type: String },
            _newDesc:        { type: String },
            _newCanApprove:  { type: Boolean },
            _showNewForm:    { type: Boolean },
            _newFormError:   { type: String }
        };
    }

    static get styles() {
        return css`
            .layout {
                display: grid;
                grid-template-columns: 260px 1fr;
                gap: 20px;
                align-items: start;
                max-width: 900px;
            }
            @media (max-width: 640px) {
                .layout { grid-template-columns: 1fr; }
            }

            .panel {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 2px 12px rgba(0,0,0,0.08);
                overflow: hidden;
            }

            .sidebar-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 12px 14px;
                border-bottom: 1px solid var(--color-border);
            }
            .sidebar-title { font-weight: 600; font-size: 14px; margin: 0; }

            .group-list { list-style: none; margin: 0; padding: 0; }
            .group-item {
                padding: 10px 14px;
                cursor: pointer;
                border-bottom: 1px solid var(--color-border);
                font-size: 14px;
            }
            .group-item:last-child { border-bottom: none; }
            .group-item:hover { background: var(--color-surface-subtle, #f9fafb); }
            .group-item.selected { background: var(--color-primary-subtle, #eff6ff); font-weight: 600; }
            .group-name { display: block; color: var(--color-text, #111); }
            .group-caps { display: block; font-size: 11px; color: var(--color-text-secondary, #6b7280); margin-top: 2px; }

            .empty-sidebar {
                padding: 20px 14px;
                font-size: 13px;
                color: var(--color-text-secondary, #6b7280);
                text-align: center;
            }

            .detail-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 14px 16px;
                border-bottom: 1px solid var(--color-border);
            }
            .detail-title { font-weight: 600; font-size: 15px; margin: 0; }

            .detail-body { padding: 16px; }

            .form-group { margin-bottom: 14px; }
            .form-group label { display: block; font-size: 13px; font-weight: 500; margin-bottom: 4px; color: var(--color-text, #111); }
            .form-group input[type="text"],
            .form-group input[type="email"],
            .form-group textarea {
                width: 100%;
                box-sizing: border-box;
                padding: 7px 10px;
                border: 1px solid var(--color-border, #d1d5db);
                border-radius: 6px;
                background: var(--color-input-bg, #fff);
                color: var(--color-text, #111);
                font-size: 14px;
                font-family: inherit;
            }
            .form-group textarea { min-height: 60px; resize: vertical; }

            .capability-row {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 13px;
                cursor: pointer;
                margin-bottom: 8px;
            }
            .capability-row input[type="checkbox"] { cursor: pointer; }

            .section-heading {
                font-size: 12px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.05em;
                color: var(--color-text-secondary, #6b7280);
                margin: 20px 0 10px 0;
            }

            .member-list { list-style: none; margin: 0 0 12px 0; padding: 0; }
            .member-row {
                display: grid;
                grid-template-columns: auto 1fr auto auto;
                align-items: center;
                gap: 12px;
                padding: 8px 0;
                border-bottom: 1px solid var(--color-border);
                font-size: 13px;
            }
            .member-row:last-child { border-bottom: none; }
            .member-name { font-weight: 500; color: var(--color-text, #111); }
            .member-email { color: var(--color-text-secondary, #6b7280); font-size: 12px; }

            .avatar {
                width: 32px;
                height: 32px;
                border-radius: 50%;
                border: 1px solid var(--color-border);
                background: var(--color-primary, #2563eb);
                color: #fff;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-size: 0.8rem;
                font-weight: 650;
                flex: 0 0 32px;
                overflow: hidden;
                user-select: none;
            }
            .avatar img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                border-radius: 50%;
            }
            .member-perms {
                display: flex;
                flex-direction: column;
                gap: 4px;
            }
            .perm-row {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--color-text-secondary, #6b7280);
                white-space: nowrap;
                cursor: pointer;
            }
            .perm-row input[type="checkbox"] { cursor: pointer; }

            .add-member-row { display: flex; gap: 8px; margin-top: 4px; }
            .add-member-row input { flex: 1; }

            .btn-primary {
                background: var(--color-primary, #2563eb);
                color: #fff;
                border: none;
                border-radius: 6px;
                padding: 6px 14px;
                font-size: 13px;
                cursor: pointer;
                white-space: nowrap;
            }
            .btn-primary:hover { opacity: 0.9; }
            .btn-primary:disabled { opacity: 0.5; cursor: default; }

            .btn-ghost {
                background: none;
                border: 1px solid var(--color-border, #d1d5db);
                border-radius: 6px;
                padding: 6px 12px;
                font-size: 13px;
                cursor: pointer;
                color: var(--color-text-secondary, #6b7280);
            }
            .btn-ghost:hover { border-color: #ef4444; color: #ef4444; }

            .btn-danger {
                background: none;
                border: 1px solid transparent;
                border-radius: 6px;
                padding: 4px 8px;
                font-size: 12px;
                cursor: pointer;
                color: var(--color-text-secondary, #6b7280);
            }
            .btn-danger:hover { color: #ef4444; }

            .btn-save {
                background: var(--color-primary, #2563eb);
                color: #fff;
                border: none;
                border-radius: 6px;
                padding: 7px 18px;
                font-size: 13px;
                cursor: pointer;
            }
            .btn-save:disabled { opacity: 0.5; cursor: default; }

            .action-row {
                display: flex;
                justify-content: space-between;
                align-items: center;
                margin-top: 20px;
                padding-top: 14px;
                border-top: 1px solid var(--color-border);
            }

            .saved-badge {
                font-size: 12px;
                color: #16a34a;
                margin-left: 10px;
            }

            .error-msg { color: #dc2626; font-size: 13px; margin: 8px 0 0 0; }
            .detail-error { color: #dc2626; font-size: 13px; margin-bottom: 12px; }

            .placeholder {
                padding: 40px 20px;
                text-align: center;
                font-size: 14px;
                color: var(--color-text-secondary, #6b7280);
            }

            .loading { padding: 20px; text-align: center; font-size: 13px; color: var(--color-text-secondary, #6b7280); }

            /* New group inline form */
            .new-group-panel { padding: 14px 16px; border-bottom: 1px solid var(--color-border); }
            .new-group-title { font-size: 13px; font-weight: 600; margin: 0 0 10px 0; }
            .new-group-actions { display: flex; gap: 8px; margin-top: 10px; }

            /* User (non-admin) view */
            .my-groups-list { list-style: none; margin: 0; padding: 0; max-width: 560px; }
            .my-group-card {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                padding: 14px 16px;
                margin-bottom: 12px;
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 1px 6px rgba(0,0,0,0.05);
            }
            .my-group-name { font-weight: 600; font-size: 15px; margin: 0 0 4px 0; }
            .my-group-desc { font-size: 13px; color: var(--color-text-secondary, #6b7280); margin: 0 0 10px 0; }
            .my-group-role {
                display: inline-block;
                font-size: 11px;
                font-weight: 600;
                text-transform: uppercase;
                letter-spacing: 0.04em;
                padding: 2px 8px;
                border-radius: 99px;
                background: var(--color-primary-subtle, #eff6ff);
                color: var(--color-primary, #2563eb);
            }
        `;
    }

    constructor() {
        super();
        this.username = '';
        this.avatarUrl = '';
        this.isOrgAdmin = false;
        this._memberships = [];
        this._groups = [];
        this._selectedGroup = null;
        this._loading = true;
        this._detailLoading = false;
        this._error = '';
        this._detailError = '';
        this._creating = false;
        this._saving = false;
        this._editName = '';
        this._editDesc = '';
        this._editCanApprove = false;
        this._addEmail = '';
        this._addError = '';
        this._addBusy = false;
        this._saved = false;
        this._newName = '';
        this._newDesc = '';
        this._newCanApprove = false;
        this._showNewForm = false;
        this._newFormError = '';
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadGroups();
    }

    async _loadGroups() {
        this._loading = true;
        this._error = '';
        try {
            if (this.isOrgAdmin) {
                this._groups = await listTaskGroups();
            } else {
                this._memberships = await getMyGroups();
            }
        } catch (err) {
            this._error = err?.message || t('errors.generic');
        } finally {
            this._loading = false;
        }
    }

    async _selectGroup(id) {
        this._creating = false;
        this._detailError = '';
        this._addError = '';
        this._saved = false;
        this._detailLoading = true;
        this._selectedGroup = null;
        try {
            const group = await getTaskGroup(id);
            this._selectedGroup = group;
            this._editName = group.name;
            this._editDesc = group.description || '';
            this._editCanApprove = group.canApproveRegistrations;
        } catch (err) {
            this._detailError = err?.message || t('errors.generic');
        } finally {
            this._detailLoading = false;
        }
    }

    _startCreating() {
        this._creating = true;
        this._selectedGroup = null;
        this._newName = '';
        this._newDesc = '';
        this._newCanApprove = false;
        this._detailError = '';
        this._showNewForm = false;
        this._newFormError = '';
    }

    _openNewForm() {
        this._showNewForm = true;
        this._newName = '';
        this._newDesc = '';
        this._newFormError = '';
    }

    async _submitNewForm(e) {
        e.preventDefault();
        if (this._saving || !this._newName.trim()) return;
        this._saving = true;
        this._newFormError = '';
        try {
            await createMyGroup({ name: this._newName.trim(), description: this._newDesc.trim() });
            this._showNewForm = false;
            await this._loadGroups();
        } catch (err) {
            this._newFormError = err?.message || t('errors.generic');
        } finally {
            this._saving = false;
        }
    }

    async _createGroup(e) {
        e.preventDefault();
        if (this._saving) return;
        if (!this._newName.trim()) return;
        this._saving = true;
        this._detailError = '';
        try {
            const group = await createTaskGroup({
                name: this._newName.trim(),
                description: this._newDesc.trim(),
                canApproveRegistrations: this._newCanApprove
            });
            await this._loadGroups();
            this._creating = false;
            await this._selectGroup(group.id);
        } catch (err) {
            this._detailError = err?.message || t('errors.generic');
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
            await updateTaskGroup(this._selectedGroup.id, {
                name: this._editName.trim(),
                description: this._editDesc.trim(),
                canApproveRegistrations: this._editCanApprove
            });
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
            await addTaskGroupMember(this._selectedGroup.id, { email: this._addEmail.trim() });
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
            await removeTaskGroupMember(this._selectedGroup.id, memberId);
            await this._selectGroup(this._selectedGroup.id);
        } catch (err) {
            this._addError = err?.message || t('errors.generic');
        }
    }

    async _updateMemberPermission(memberId, permission, value) {
        if (!this._selectedGroup) return;
        this._addError = '';
        // Optimistic update so the checkbox feels instant
        this._selectedGroup = {
            ...this._selectedGroup,
            members: this._selectedGroup.members.map(m =>
                m.id === memberId ? { ...m, [permission]: value } : m
            )
        };
        try {
            await updateTaskGroupMember(this._selectedGroup.id, memberId, { [permission]: value });
        } catch (err) {
            this._addError = err?.message || t('errors.generic');
            // Revert on failure
            await this._selectGroup(this._selectedGroup.id);
        }
    }

    _memberInitial(m) {
        const first = String(m.firstName || '').trim();
        if (first) return first.charAt(0).toUpperCase();
        const email = String(m.email || '').trim();
        if (email) return email.charAt(0).toUpperCase();
        return '?';
    }

    _capBadge(group) {
        const caps = [];
        if (group.canApproveRegistrations) caps.push('Approvals');
        return caps.join(', ') || 'No capabilities';
    }

    handleMenuSelectionChange(e) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: e.detail,
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin}
                selectedMenuKey="my-groups"
                homeHref="/file-manager"
                homeLabel=${t('common.home')}
                pageTitle=${t('taskGroups.title')}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content">
                    ${this._error ? html`<div class="error-msg" style="margin-bottom:12px">${this._error}</div>` : ''}
                    <div style="display:flex;justify-content:flex-end;margin-bottom:14px;max-width:900px">
                        <button class="btn-primary"
                            @click=${this.isOrgAdmin ? this._startCreating : this._openNewForm}>
                            + ${t('taskGroups.newGroup')}
                        </button>
                    </div>
                    ${this.isOrgAdmin ? this._renderAdminView() : this._renderUserView()}
                </div>
            </page-layout-template>
        `;
    }

    _renderUserView() {
        return html`
            ${this._showNewForm ? html`
                <div class="panel" style="max-width:480px;margin-bottom:16px">
                    <div class="detail-body">
                        <form @submit=${this._submitNewForm}>
                            <div class="form-group">
                                <label for="new-form-name">${t('taskGroups.groupName')}</label>
                                <input id="new-form-name" type="text" required autofocus
                                    placeholder="${t('taskGroups.namePlaceholder')}"
                                    .value=${this._newName}
                                    @input=${e => { this._newName = e.target.value; }} />
                            </div>
                            <div class="form-group">
                                <label for="new-form-desc">${t('taskGroups.description')}</label>
                                <textarea id="new-form-desc"
                                    placeholder="${t('taskGroups.descriptionPlaceholder')}"
                                    .value=${this._newDesc}
                                    @input=${e => { this._newDesc = e.target.value; }}></textarea>
                            </div>
                            ${this._newFormError ? html`<p class="error-msg">${this._newFormError}</p>` : ''}
                            <div class="new-group-actions">
                                <button type="submit" class="btn-save" ?disabled=${this._saving || !this._newName.trim()}>
                                    ${this._saving ? t('taskGroups.saving') : t('taskGroups.createGroup')}
                                </button>
                                <button type="button" class="btn-ghost"
                                    @click=${() => { this._showNewForm = false; }}>
                                    ${t('taskGroups.cancel')}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            ` : ''}
            ${this._loading
                ? html`<div class="loading">${t('common.loading')}</div>`
                : !this._memberships.length
                    ? html`<p style="font-size:14px;color:var(--color-text-secondary)">${t('taskGroups.myGroupsEmpty')}</p>`
                    : html`
                        <ul class="my-groups-list">
                            ${this._memberships.map(m => html`
                                <li class="my-group-card">
                                    <p class="my-group-name">${m.group.name}</p>
                                    ${m.group.description ? html`<p class="my-group-desc">${m.group.description}</p>` : ''}
                                    <span class="my-group-role">
                                        ${m.canManageGroup ? t('taskGroups.myGroupsManager') : t('taskGroups.myGroupsMember')}
                                    </span>
                                </li>
                            `)}
                        </ul>
                    `
            }
        `;
    }

    _renderAdminView() {
        return html`<div class="layout">

                        <!-- Sidebar: group list -->
                        <div class="panel">
                            <div class="sidebar-header">
                                <p class="sidebar-title">${t('taskGroups.title')}</p>
                            </div>

                            ${this._loading
                                ? html`<div class="loading">${t('common.loading')}</div>`
                                : this._groups.length === 0 && !this._creating
                                    ? html`<div class="empty-sidebar">${t('taskGroups.noGroups')}</div>`
                                    : html`
                                        <ul class="group-list">
                                            ${this._groups.map(g => html`
                                                <li class="group-item ${this._selectedGroup?.id === g.id ? 'selected' : ''}"
                                                    @click=${() => this._selectGroup(g.id)}>
                                                    <span class="group-name">${g.name}</span>
                                                    <span class="group-caps">${this._capBadge(g)}</span>
                                                </li>
                                            `)}
                                        </ul>
                                    `
                            }
                        </div>

                        <!-- Detail panel -->
                        <div class="panel">
                            ${this._creating ? html`
                                <!-- New group form -->
                                <div class="detail-header">
                                    <p class="detail-title">${t('taskGroups.createGroup')}</p>
                                </div>
                                <div class="detail-body">
                                    ${this._detailError ? html`<p class="detail-error">${this._detailError}</p>` : ''}
                                    <form @submit=${this._createGroup}>
                                        <div class="form-group">
                                            <label for="new-group-name">${t('taskGroups.groupName')}</label>
                                            <input id="new-group-name" type="text" required
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
                                        <div class="new-group-actions">
                                            <button type="submit" class="btn-save" ?disabled=${this._saving || !this._newName.trim()}>
                                                ${this._saving ? t('taskGroups.saving') : t('taskGroups.createGroup')}
                                            </button>
                                            <button type="button" class="btn-ghost"
                                                @click=${() => { this._creating = false; }}>
                                                ${t('taskGroups.cancel')}
                                            </button>
                                        </div>
                                    </form>
                                </div>

                            ` : this._detailLoading ? html`
                                <div class="loading">${t('common.loading')}</div>

                            ` : this._selectedGroup ? html`
                                <!-- Edit existing group -->
                                <div class="detail-header">
                                    <p class="detail-title">${this._selectedGroup.name}</p>
                                </div>
                                <div class="detail-body">
                                    ${this._detailError ? html`<p class="detail-error">${this._detailError}</p>` : ''}
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
                                        <p class="section-heading">${t('taskGroups.capabilities')}</p>
                                        <label class="capability-row">
                                            <input type="checkbox"
                                                .checked=${this._editCanApprove}
                                                @change=${e => { this._editCanApprove = e.target.checked; }} />
                                            ${t('taskGroups.canApproveRegistrations')}
                                        </label>

                                        <div class="action-row">
                                            ${!this._selectedGroup.canApproveRegistrations ? html`
                                                <button type="button" class="btn-ghost"
                                                    @click=${() => this._deleteGroup()}>
                                                    ${t('taskGroups.deleteGroup')}
                                                </button>
                                            ` : html`<span></span>`}
                                            <div>
                                                ${this._saved ? html`<span class="saved-badge">${t('taskGroups.saved')}</span>` : ''}
                                                <button type="submit" class="btn-save" ?disabled=${this._saving}>
                                                    ${this._saving ? t('taskGroups.saving') : t('taskGroups.save')}
                                                </button>
                                            </div>
                                        </div>
                                    </form>

                                    <!-- Members -->
                                    <p class="section-heading">${t('taskGroups.members')} (${this._selectedGroup.members?.length ?? 0})</p>
                                    ${this._selectedGroup.members?.length > 0 ? html`
                                        <ul class="member-list">
                                            ${this._selectedGroup.members.map(m => html`
                                                <li class="member-row">
                                                    <div class="avatar" aria-hidden="true">
                                                        ${m.avatarUrl
                                                            ? html`<img src=${m.avatarUrl} alt="">`
                                                            : this._memberInitial(m)}
                                                    </div>
                                                    <div>
                                                        <span class="member-name">${m.firstName} ${m.lastName}</span>
                                                        <span class="member-email">${m.email}</span>
                                                    </div>
                                                    <div class="member-perms">
                                                        <label class="perm-row">
                                                            <input type="checkbox"
                                                                .checked=${m.canManageGroup}
                                                                @change=${e => this._updateMemberPermission(m.id, 'canManageGroup', e.target.checked)} />
                                                            ${t('taskGroups.canManageGroup')}
                                                        </label>
                                                    </div>
                                                    <button class="btn-danger"
                                                        type="button"
                                                        title="Remove ${m.firstName} ${m.lastName}"
                                                        aria-label="Remove ${m.firstName} ${m.lastName}"
                                                        @click=${() => this._removeMember(m.id)}>
                                                        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                                        </svg>
                                                    </button>
                                                </li>
                                            `)}
                                        </ul>
                                    ` : html`<p style="font-size:13px;color:var(--color-text-secondary)">${t('taskGroups.noMembers')}</p>`}

                                    <label for="add-member-email" style="font-size:13px;font-weight:500;display:block;margin-bottom:4px">
                                        ${t('taskGroups.addMemberLabel')}
                                    </label>
                                    <div class="add-member-row">
                                        <input id="add-member-email" type="email"
                                            placeholder="${t('taskGroups.emailPlaceholder')}"
                                            .value=${this._addEmail}
                                            @input=${e => { this._addEmail = e.target.value; this._addError = ''; }}
                                            @keydown=${e => { if (e.key === 'Enter') { e.preventDefault(); this._addMember(); } }} />
                                        <button class="btn-primary" type="button"
                                            ?disabled=${!this._addEmail.trim() || this._addBusy}
                                            @click=${this._addMember}>
                                            ${this._addBusy ? '…' : t('taskGroups.addMember')}
                                        </button>
                                    </div>
                                    ${this._addError ? html`<p class="error-msg">${this._addError}</p>` : ''}
                                </div>

                            ` : html`
                                <div class="placeholder">${t('taskGroups.selectGroup')}</div>
                            `}
                        </div>
                    </div>
        `;
    }
}

customElements.define('admin-task-groups-page', AdminTaskGroupsPage);
