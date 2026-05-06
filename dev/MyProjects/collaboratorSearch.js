import { LitElement, html, css } from 'lit-element';
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
                border-radius: 10px;
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

            .search-input:focus {
                outline: none;
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
            }

            .search-actions {
                flex: 0 0 auto;
            }

            .search-form-row {
                display: flex;
                align-items: center;
                gap: 10px;
                margin-top: 4px;
            }

            .search-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-primary);
                color: var(--color-background);
                padding: 8px 12px;
                font: inherit;
                cursor: pointer;
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
                border-radius: 10px;
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
                gap: 8px;
            }

            .dialog-actions {
                margin-top: 16px;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
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
                color: var(--color-background);
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
            addedCollaborators: { type: Array }
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
        this.addedCollaborators = this.sortCollaborators(collaborators.map((entry) => ({ ...entry })));
        this.emailQuery = '';
        this.message = '';
        this.messageType = '';
        this.matchedUser = null;
    }

    async handleSearchSubmit(event) {
        event.preventDefault();

        const email = this.emailQuery.trim();
        this.message = '';
        this.messageType = '';
        this.matchedUser = null;

        if (!email) {
            this.message = 'Enter a full email address to search.';
            this.messageType = 'error';
            return;
        }

        this.loading = true;

        try {
            const user = await lookupUserByEmailExact(email);
            this.matchedUser = user;
        } catch (error) {
            if (error.status === 404) {
                this.message = 'No results found for that exact email.';
                this.messageType = 'error';
            } else if (error.status === 400) {
                this.message = 'Enter a valid full email address.';
                this.messageType = 'error';
            } else {
                this.message = 'Unable to search right now. Please try again.';
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
            this.message = 'That user has already been added.';
            this.messageType = 'error';
            return;
        }

        this.addedCollaborators = this.sortCollaborators([...this.addedCollaborators, { user, role }]);
        this.emailQuery = '';
        this.matchedUser = null;
    }

    handleCancel() {
        this.dispatchEvent(new CustomEvent('collaborators-cancel', {
            bubbles: true,
            composed: true
        }));
    }

    handleDone() {
        if (this.addedCollaborators.length === 0) return;

        this.dispatchEvent(new CustomEvent('collaborators-done', {
            detail: { collaborators: this.addedCollaborators },
            bubbles: true,
            composed: true
        }));
    }

    handleSelectedCollaboratorRoleChange(event) {
        const { user, role } = event.detail;
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
                <label class="field-label" for="collaborator-search-input">Search Collaborators</label>
                <form @submit=${(event) => this.handleSearchSubmit(event)}>
                    <div class="search-form-row">
                        <input
                            id="collaborator-search-input"
                            class="search-input"
                            type="email"
                            .value=${this.emailQuery}
                            placeholder="Enter full email address"
                            @input=${(event) => { this.emailQuery = event.target.value; }}
                        />
                        <div class="search-actions">
                            <button class="search-button" type="submit" ?disabled=${this.loading}>
                                ${this.loading ? 'Searching...' : 'Find User'}
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
                            .isAddDisabled=${matchedUserAlreadyAdded}
                            addDisabledTooltip="This collaborator has already been added."
                            @add-collaborator=${(event) => this.handleAddCollaborator(event)}
                        ></collaborator-result-row>
                    </div>
                ` : ''}
                ${this.addedCollaborators.length > 0 ? html`
                    <div class="section-title">Selected Collaborators</div>
                    <div class="selected-list">
                        ${this.addedCollaborators.map((entry) => html`
                            <div class="search-result">
                                <collaborator-result-row
                                    .user=${entry.user}
                                    mode="selected"
                                    .role=${entry.role}
                                    @role-change=${(event) => this.handleSelectedCollaboratorRoleChange(event)}
                                ></collaborator-result-row>
                            </div>
                        `)}
                    </div>
                ` : ''}
                <div class="dialog-actions">
                    <button class="secondary-button" type="button" @click=${() => this.handleCancel()}>Cancel</button>
                    <button
                        class="primary-button"
                        type="button"
                        ?disabled=${this.addedCollaborators.length === 0}
                        @click=${() => this.handleDone()}
                    >
                        Done
                    </button>
                </div>
            </div>
        `;
    }
}

customElements.define('collaborator-search', CollaboratorSearch);
