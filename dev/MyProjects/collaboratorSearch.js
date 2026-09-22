import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { lookupUserByEmailExact } from '../services/users.js';
import { initializeTheme } from '../components/theme.js';
import './collaboratorResultRow.js';

export class CollaboratorSearch extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .search-wrapper {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .field-label {
                color: var(--color-text-primary);
                font-weight: 500;
            }

            .search-input {
                width: 100%;
                flex: 1 1 auto;
                min-width: 220px;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm);
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                padding: 10px 12px;
                font: inherit;
                cursor: text;
                caret-color: var(--color-primary, #167aac);
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }

            .search-input::placeholder {
                color: var(--color-text-secondary);
                opacity: 0.7;
            }

            .search-input:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                border-color: var(--color-focus, var(--color-primary));
                box-shadow: none;
            }

            .search-actions {
                flex: 0 0 auto;
            }

            .search-form-row {
                display: flex;
                align-items: center;
                gap: 12px;
                margin-top: 4px;
                padding: 2px 0;
            }

            .search-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                background: var(--color-primary);
                color: var(--color-on-primary);
                padding: 8px 12px;
                font: inherit;
                cursor: pointer;
            }

            .search-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .search-button:focus-visible,
            .primary-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .search-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .search-status {
                margin-top: 12px;
                font-size: 0.95rem;
                color: var(--color-text-secondary);
            }

            .search-status.error {
                color: #c62828;
            }

            .search-result {
                margin-top: 12px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                padding: 10px 12px;
            }

            .section-title {
                margin: 14px 0 8px;
                font-weight: 600;
                color: var(--color-text-primary);
            }

            .selected-list {
                display: flex;
                flex-direction: column;
                gap: 10px;
                padding: 2px 0;
            }

            .dialog-actions {
                margin-top: 14px;
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 2px 0;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                min-height: 38px;
                padding: 8px 14px;
                font: inherit;
                cursor: pointer;
            }

            .secondary-button {
                background: transparent;
                color: var(--color-text-primary);
            }

            .primary-button {
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .primary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }
        `;
    }

    static get properties() {
        return {
            emailQuery: { type: String },
            loading: { type: Boolean },
            message: { type: String },
            messageType: { type: String },
            matchedUser: { type: Object },
            addedCollaborators: { type: Array },
            /** Optional async (email) => user; defaults to SQLite /api/users/lookup */
            lookupFn: { attribute: false },
            hideRoles: { type: Boolean },
            allowEmptyDone: { type: Boolean },
            /** When true, members present at startSession cannot be removed or re-roled (invite-only). */
            lockExisting: { type: Boolean },
            roleOptions: { type: Array }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.emailQuery = '';
        this.loading = false;
        this.message = '';
        this.messageType = '';
        this.matchedUser = null;
        this.addedCollaborators = [];
        this.lookupFn = null;
        this.hideRoles = false;
        this.allowEmptyDone = false;
        this.lockExisting = false;
        this._lockedUserIds = new Set();
        this.roleOptions = null;
    }

    getRoleSortValue(role) {
        if (role === 'admin') return 0;
        if (role === 'collaborator') return 1;
        return 2;
    }

    sortCollaborators(collaborators = []) {
        return [...collaborators].sort((a, b) => {
            const roleDiff = this.getRoleSortValue(a.role) - this.getRoleSortValue(b.role);
            if (roleDiff !== 0) return roleDiff;
            const userA = (a.user?.username || '').toLowerCase();
            const userB = (b.user?.username || '').toLowerCase();
            return userA.localeCompare(userB);
        });
    }

    startSession(collaborators = []) {
        const seed = collaborators.map((entry) => ({ ...entry }));
        this.addedCollaborators = this.sortCollaborators(seed);
        this._lockedUserIds = this.lockExisting
            ? new Set(seed.map((entry) => String(entry?.user?.id || '')).filter(Boolean))
            : new Set();
        this.emailQuery = '';
        this.message = '';
        this.messageType = '';
        this.matchedUser = null;
    }

    isLockedUser(userId) {
        return this.lockExisting && this._lockedUserIds.has(String(userId || ''));
    }

    async handleSearchSubmit(event) {
        event.preventDefault();

        const email = this.emailQuery.trim();
        this.message = '';
        this.messageType = '';
        this.matchedUser = null;

        if (!email) {
            this.message = t('collaborators.enterFullEmail');
            this.messageType = 'error';
            return;
        }

        this.loading = true;

        try {
            const lookup = typeof this.lookupFn === 'function'
                ? this.lookupFn
                : lookupUserByEmailExact;
            const user = await lookup(email);
            this.matchedUser = user;
        } catch (error) {
            if (error.status === 404) {
                this.message = t('collaborators.noResults');
                this.messageType = 'error';
            } else if (error.status === 400) {
                this.message = t('collaborators.invalidEmail');
                this.messageType = 'error';
            } else {
                this.message = t('collaborators.searchFailed');
                this.messageType = 'error';
            }
        } finally {
            this.loading = false;
        }
    }

    handleAddCollaborator(event) {
        const { user, role } = event.detail;
        const alreadyAdded = this.addedCollaborators.some((entry) => entry.user.id === user.id);

        if (alreadyAdded) {
            this.message = t('collaborators.alreadyAdded');
            this.messageType = 'error';
            return;
        }

        const nextRole = this.hideRoles ? (role || 'collaborator') : role;
        this.addedCollaborators = this.sortCollaborators([
            ...this.addedCollaborators,
            { user, role: nextRole }
        ]);
        this.emailQuery = '';
        this.matchedUser = null;
    }

    handleRemoveSelected(event) {
        const userId = event.detail?.user?.id;
        if (!userId || this.isLockedUser(userId)) return;
        this.addedCollaborators = this.addedCollaborators.filter((entry) => entry.user.id !== userId);
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('collaborators-cancel', {
            bubbles: true,
            composed: true
        }));
    }

    handleDone() {
        if (!this.allowEmptyDone && this.addedCollaborators.length === 0) return;

        this.dispatchEvent(new CustomEvent('collaborators-done', {
            detail: { collaborators: this.addedCollaborators },
            bubbles: true,
            composed: true
        }));
    }

    handleSelectedCollaboratorRoleChange(event) {
        const { user, role } = event.detail;
        if (this.isLockedUser(user?.id)) return;
        this.addedCollaborators = this.sortCollaborators(this.addedCollaborators.map((entry) => (
            entry.user.id === user.id ? { ...entry, role } : entry
        )));
    }

    render() {
        const matchedUserAlreadyAdded = this.matchedUser
            ? this.addedCollaborators.some((entry) => entry.user.id === this.matchedUser.id)
            : false;

        return html`
            <div class="search-wrapper">
                <label class="field-label" for="collaborator-search-input">${t('collaborators.searchTitle')}</label>
                <form @submit=${(event) => this.handleSearchSubmit(event)}>
                    <div class="search-form-row">
                        <input
                            id="collaborator-search-input"
                            class="search-input"
                            type="email"
                            .value=${this.emailQuery}
                            placeholder=${t('collaborators.emailPlaceholder')}
                            @input=${(event) => { this.emailQuery = event.target.value; }}
                        />
                        <div class="search-actions">
                            <button class="search-button" type="submit" ?disabled=${this.loading}>
                                ${this.loading ? t('collaborators.searching') : t('collaborators.findUser')}
                            </button>
                        </div>
                    </div>
                </form>
                ${this.message && this.messageType === 'error' ? html`
                    <div class="search-status ${this.messageType}">${this.message}</div>
                ` : ''}
                ${this.matchedUser ? html`
                    <div class="search-result">
                        <collaborator-result-row
                            .user=${this.matchedUser}
                            mode="search"
                            ?hideRoles=${this.hideRoles}
                            .roleOptions=${this.roleOptions}
                            .isAddDisabled=${matchedUserAlreadyAdded}
                            addDisabledTooltip=${t('collaborators.alreadyAddedTooltip')}
                            @add-collaborator=${(event) => this.handleAddCollaborator(event)}
                        ></collaborator-result-row>
                    </div>
                ` : ''}
                ${this.addedCollaborators.length > 0 ? html`
                    <div class="section-title">${t('collaborators.selected')}</div>
                    <div class="selected-list">
                        ${this.addedCollaborators.map((entry) => {
                            const locked = this.isLockedUser(entry.user?.id);
                            return html`
                            <div class="search-result">
                                <collaborator-result-row
                                    .user=${entry.user}
                                    mode="selected"
                                    .role=${entry.role}
                                    ?hideRoles=${this.hideRoles}
                                    .roleOptions=${this.roleOptions}
                                    ?showRemoveButton=${!locked}
                                    .isRoleEditable=${!this.hideRoles && !locked}
                                    @role-change=${(event) => this.handleSelectedCollaboratorRoleChange(event)}
                                    @remove-collaborator=${(event) => this.handleRemoveSelected(event)}
                                ></collaborator-result-row>
                            </div>
                        `;
                        })}
                    </div>
                ` : ''}
                <div class="dialog-actions">
                    <button class="secondary-button" type="button" @click=${() => this.handleCancel()}>${t('common.cancel')}</button>
                    <button
                        class="primary-button"
                        type="button"
                        ?disabled=${!this.allowEmptyDone && this.addedCollaborators.length === 0}
                        @click=${() => this.handleDone()}
                    >
                        ${t('collaborators.done')}
                    </button>
                </div>
            </div>
        `;
    }
}

customElements.define('collaborator-search', CollaboratorSearch);
