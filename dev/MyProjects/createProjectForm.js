import { LitElement, html, css } from 'lit-element';
import { APP_MENU_ITEMS } from '../components/app-menu.js';
import '../components/page-layout-template.js';
import '../components/add-button.js';
import '../components/toggle-switch.js';
import '../components/app-dialog.js';
import { createProject } from '../services/projects.js';
import './collaboratorSearch.js';
import './collaboratorResultRow.js';

export class CreateProjectForm extends LitElement {
    static get styles() {
        return css`
            .form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-top: 8px;
            }

            .form-actions {
                margin-top: 18px;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                min-height: 44px;
                padding: 10px 18px;
                font: inherit;
                font-weight: 600;
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

            .primary-button:hover,
            .primary-button:focus-visible {
                background: var(--color-accent);
                color: var(--color-text-primary);
                outline: none;
                transform: translateY(-1px);
            }

            .primary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
            }

            .field-label {
                color: var(--color-text-primary);
                font-weight: 500;
            }

            .text-input {
                width: 100%;
                max-width: 420px;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                padding: 10px 12px;
                font: inherit;
                transition: border-color 0.2s ease, box-shadow 0.2s ease;
            }

            .text-input::placeholder {
                color: var(--color-text-secondary);
                opacity: 0.7;
            }

            .text-input:focus {
                outline: none;
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 22%, transparent);
            }

            .information-note {
                margin-top: 16px;
                padding: 12px 14px;
                border: 1px dashed var(--color-text-secondary);
                border-radius: 10px;
                color: var(--color-text-secondary);
            }

            .collaborators-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-surface, var(--color-background));
                padding: 4px 10px 10px;
            }

            .collaborators-panel summary {
                cursor: pointer;
                list-style: none;
                font-weight: 600;
                color: var(--color-text-primary);
                padding: 10px 2px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .collaborators-panel summary::-webkit-details-marker {
                display: none;
            }

            .collaborators-panel summary::before {
                content: '▸';
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--color-text-primary);
                background: var(--color-surface, var(--color-background));
                transition: transform 0.15s ease, background-color 0.15s ease;
            }

            .collaborators-panel details[open] summary::before {
                transform: rotate(90deg);
            }

            .collaborators-panel summary:hover::before,
            .collaborators-panel summary:focus-visible::before {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface, var(--color-background)));
            }

            .collaborators-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
                max-height: 280px;
                overflow-y: auto;
                padding-right: 4px;
            }

            .collaborator-row {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                padding: 10px 12px;
            }

            .form-error {
                margin-top: 12px;
                color: #c62828;
            }

            add-button {
                margin-top: 16px;
            }
            .visibility-toggle-control {
                display: flex;
                align-items: center;
                margin-top: 12px;
                gap: 10px;
            }
            toggle-switch {
                margin-left: 0;
            }

            @media (max-width: 640px) {
                .text-input {
                    max-width: none;
                }
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            menuItems: { type: Array },
            isPublic: { type: Boolean },
            collaborators: { type: Array },
            projectName: { type: String },
            saving: { type: Boolean },
            formError: { type: String }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.menuItems = APP_MENU_ITEMS;
        this.isPublic = false;
        this.collaborators = [];
        this.projectName = '';
        this.saving = false;
        this.formError = '';
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

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    openCollaboratorDialog() {
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        const collaboratorSearch = this.renderRoot?.querySelector('collaborator-search');
        collaboratorSearch?.startSession(this.collaborators);
        dialog?.openDialog();
    }

    closeCollaboratorDialog() {
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        dialog?.closeDialog();
    }

    handleCollaboratorsDone(event) {
        this.collaborators = this.sortCollaborators(event.detail.collaborators);
        this.closeCollaboratorDialog();
    }

    handleCollaboratorRoleChange(event) {
        const { user, role } = event.detail;
        this.collaborators = this.sortCollaborators(this.collaborators.map((entry) => (
            entry.user.id === user.id ? { ...entry, role } : entry
        )));
    }

    redirectToMyProjects() {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: {
                selectedKey: 'my-projects',
                item: { key: 'my-projects', label: 'My Projects' }
            },
            bubbles: true,
            composed: true
        }));
    }

    handleCancel() {
        this.redirectToMyProjects();
    }

    async handleSave() {
        this.formError = '';
        const name = this.projectName.trim();
        if (!name) {
            this.formError = 'Project name is required.';
            return;
        }

        this.saving = true;
        try {
            const collaboratorsPayload = this.collaborators.map((entry) => ({
                userId: entry.user.id,
                role: entry.role
            }));
            await createProject({ name, collaborators: collaboratorsPayload });
            this.redirectToMyProjects();
        } catch (error) {
            this.formError = error.message || 'Unable to save project. Please try again.';
        } finally {
            this.saving = false;
        }
    }

    render() {
        return html`
            <page-layout-template
                .menuItems=${this.menuItems}
                .username=${this.username}
                selectedMenuKey="my-projects"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="Create New Project"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content">
                    <div class="form-group">
                        <label class="field-label" for="project-name">Project Name</label>
                        <input
                            class="text-input"
                            type="text"
                            id="project-name"
                            name="project-name"
                            .value=${this.projectName}
                            placeholder="Name"
                            @input=${(event) => { this.projectName = event.target.value; }}
                        />
                    </div>
                    <div class="visibility-toggle-control">
                        <label class="field-label" for="visibility-toggle">Who can view this project?</label>
                        <toggle-switch
                            .checked=${this.isPublic}
                            trueLabel="Public"
                            falseLabel="Private"
                            aria-label="Toggle project visibility"
                            @toggle-change=${(event) => { this.isPublic = event.detail.checked; }}
                        ></toggle-switch>
                    </div>
                </div>
                ${this.collaborators.length === 0 ? html`
                    <div slot="content" class="information-note">
                       You haven't invited any collaborators yet. <br>
                       <add-button
                           slot="content"
                           title="Add Collaborators"
                           @add-button-click=${() => this.openCollaboratorDialog()}
                        ></add-button>
                    </div>
                ` : html`
                    <div slot="content" class="collaborators-panel">
                        <details open>
                            <summary>Collaborators (${this.collaborators.length})</summary>
                            <div class="collaborators-list">
                                ${this.collaborators.map((entry) => html`
                                    <div class="collaborator-row">
                                        <collaborator-result-row
                                            .user=${entry.user}
                                            mode="selected"
                                            .role=${entry.role}
                                            .selectedRole=${entry.role}
                                            @role-change=${(event) => this.handleCollaboratorRoleChange(event)}
                                        ></collaborator-result-row>
                                    </div>
                                `)}
                            </div>
                        </details>
                        <add-button
                            slot="content"
                            title="Add Collaborators"
                            @add-button-click=${() => this.openCollaboratorDialog()}
                        ></add-button>
                    </div>
                `}
                <div slot="content" class="form-actions">
                    <button
                        class="primary-button"
                        type="button"
                        ?disabled=${this.saving}
                        @click=${() => this.handleSave()}
                    >
                        ${this.saving ? 'Saving...' : 'Save'}
                    </button>
                    <button class="secondary-button" type="button" @click=${() => this.handleCancel()}>
                        Cancel
                    </button>
                </div>
                ${this.formError ? html`<div slot="content" class="form-error">${this.formError}</div>` : ''}
            </page-layout-template>
            <app-dialog id="collaborator-dialog" title="Add Collaborators">
                <collaborator-search
                    @collaborators-cancel=${() => this.closeCollaboratorDialog()}
                    @collaborators-done=${(event) => this.handleCollaboratorsDone(event)}
                ></collaborator-search>
            </app-dialog>
        `;
    }
}

customElements.define('create-project-form', CreateProjectForm);
