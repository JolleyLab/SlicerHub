import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import '../components/dropdown-select.js';
import '../components/app-button.js';
import '../components/icon-button.js';
import '../components/person-chip.js';

export class CollaboratorResultRow extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .result-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                flex-wrap: wrap;
            }

            .result-user {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
            }

            person-chip {
                --person-chip-size: 40px;
            }

            .result-actions {
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 2px;
            }

            .add-button-wrapper {
                position: relative;
                display: inline-flex;
                align-items: center;
            }

            .result-actions dropdown-select {
                min-width: 160px;
            }

            .tooltip-bubble {
                position: absolute;
                bottom: calc(100% + 10px);
                right: 0;
                background: var(--color-text-primary);
                color: var(--color-background);
                border-radius: var(--radius-lg);
                padding: 9px 12px;
                font-size: 0.8rem;
                line-height: 1.45;
                white-space: normal;
                width: max-content;
                max-width: 190px;
                box-shadow: 0 8px 18px var(--color-shadow, rgba(0, 0, 0, 0.2));
                opacity: 0;
                visibility: hidden;
                pointer-events: none;
                transition: opacity 0.15s ease;
                z-index: 5;
            }

            .tooltip-bubble::after {
                content: '';
                position: absolute;
                top: 100%;
                right: 12px;
                border: 6px solid transparent;
                border-top-color: var(--color-text-primary);
            }

            .add-button-wrapper.show-tooltip:hover .tooltip-bubble,
            .add-button-wrapper.show-tooltip:focus-within .tooltip-bubble {
                opacity: 1;
                visibility: visible;
            }
        `;
    }

    static get properties() {
        return {
            user: { type: Object },
            mode: { type: String }, // "search" | "selected"
            role: { type: String },
            selectedRole: { type: String },
            isAddDisabled: { type: Boolean },
            addDisabledTooltip: { type: String },
            isRoleEditable: { type: Boolean },
            showRemoveButton: { type: Boolean },
            hideRoles: { type: Boolean },
            /** Optional override for role dropdown options */
            roleOptions: { type: Array }
        };
    }

    constructor() {
        super();
        this.user = null;
        this.mode = 'search';
        this.role = '';
        this.selectedRole = '';
        this.isAddDisabled = false;
        this.addDisabledTooltip = '';
        this.isRoleEditable = true;
        this.showRemoveButton = false;
        this.hideRoles = false;
        this.roleOptions = null;
    }

    get effectiveRoleOptions() {
        if (Array.isArray(this.roleOptions) && this.roleOptions.length) {
            return this.roleOptions;
        }
        return [
            { value: '', label: t('roles.selectRole'), disabled: true },
            { value: 'admin', label: t('roles.admin') },
            { value: 'collaborator', label: t('roles.collaborator') },
            { value: 'observer', label: t('roles.observer') }
        ];
    }

    handleRoleChange(event) {
        this.selectedRole = event.target.value;
        this.dispatchEvent(new CustomEvent('role-change', {
            detail: { user: this.user, role: this.selectedRole },
            bubbles: true,
            composed: true
        }));
    }

    emitAdd() {
        if (!this.user) return;
        const role = this.hideRoles
            ? (this.selectedRole || this.role || 'collaborator')
            : this.selectedRole;
        if (!this.hideRoles && !role) return;
        this.dispatchEvent(new CustomEvent('add-collaborator', {
            detail: { user: this.user, role },
            bubbles: true,
            composed: true
        }));
    }

    emitRemove() {
        if (!this.user) return;
        this.dispatchEvent(new CustomEvent('remove-collaborator', {
            detail: { user: this.user },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        if (!this.user) return html``;

        const name = this.user.username || this.user.email || '?';
        const secondaryLine = this.user.email && this.user.email !== name ? this.user.email : '';
        const roleValue = this.selectedRole || this.role || '';
        const addDisabled = this.isAddDisabled || (!this.hideRoles && !this.selectedRole);
        const addButtonTooltip = this.isAddDisabled
            ? this.addDisabledTooltip
            : (!this.hideRoles && !this.selectedRole ? t('collaborators.assignRoleRequired') : t('collaborators.addCollaborator'));

        return html`
            <div class="result-row">
                <div class="result-user">
                    <person-chip
                        .name=${name}
                        .secondaryLine=${secondaryLine}
                        .avatarUrl=${this.user.avatarUrl || ''}
                    ></person-chip>
                </div>
                <div class="result-actions">
                    ${!this.hideRoles ? html`
                        <dropdown-select
                            .value=${roleValue}
                            .options=${this.effectiveRoleOptions}
                            aria-label=${t('collaborators.assignRoleAria')}
                            ?disabled=${!this.isRoleEditable}
                            @change=${(event) => this.handleRoleChange(event)}
                        ></dropdown-select>
                    ` : ''}
                    ${this.mode === 'search' ? html`
                        <div class="add-button-wrapper ${addDisabled ? 'show-tooltip' : ''}">
                            <app-button
                                variant="primary"
                                ?disabled=${addDisabled}
                                aria-describedby=${addDisabled ? 'pending-tooltip' : ''}
                                @click=${() => this.emitAdd()}
                            >
                                ${t('collaborators.addCollaborator')}
                            </app-button>
                            ${addDisabled ? html`
                                <div id="pending-tooltip" class="tooltip-bubble">${addButtonTooltip}</div>
                            ` : ''}
                        </div>
                    ` : ''}
                    ${this.mode === 'selected' && this.showRemoveButton ? html`
                        <icon-button
                            size="lg"
                            label=${t('collaborators.removeAria')}
                            title=${t('collaborators.removeAria')}
                            @click=${() => this.emitRemove()}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    fill="currentColor"
                                    d="M9 3h6l1 2h4v2h-2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7H4V5h4l1-2zm7 4H8v13h8V7zm-6 3h2v7h-2v-7zm4 0h2v7h-2v-7z"
                                ></path>
                            </svg>
                        </icon-button>
                    ` : ''}
                </div>
            </div>
        `;
    }
}

customElements.define('collaborator-result-row', CollaboratorResultRow);
