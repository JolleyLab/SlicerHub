import { LitElement, html, css } from 'lit-element';
import '../components/dropdown-select.js';

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

            .user-initial {
                border: 1px solid var(--color-border);
                border-radius: 50%;
                background: var(--color-primary);
                color: var(--color-on-primary);
                width: 40px;
                height: 40px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                font-weight: 600;
                flex: 0 0 40px;
            }

            :host-context([data-theme='dark']) .user-initial {
                background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
                color: var(--color-primary);
                border-color: color-mix(in srgb, #c5cce6 45%, var(--color-border));
            }

            .user-name {
                color: var(--color-text-primary);
                font-weight: 500;
                min-width: 120px;
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

            .add-user-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                background: var(--color-primary);
                color: var(--color-on-primary);
                min-height: 38px;
                padding: 8px 14px;
                font: inherit;
                line-height: 1.2;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .add-user-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .add-user-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .add-user-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .remove-icon-button {
                border: none;
                border-radius: var(--radius-lg);
                background: transparent;
                color: var(--color-text-primary);
                width: 34px;
                height: 34px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .remove-icon-button:hover,
            .remove-icon-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .remove-icon {
                width: 16px;
                height: 16px;
                display: block;
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
            { value: '', label: 'Select role', disabled: true },
            { value: 'admin', label: 'Admin' },
            { value: 'collaborator', label: 'Collaborator' },
            { value: 'observer', label: 'Observer' }
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

        const displayName = this.user.username || this.user.email || '?';
        const firstInitial = displayName.charAt(0).toUpperCase();
        const roleValue = this.selectedRole || this.role || '';
        const addDisabled = this.isAddDisabled || (!this.hideRoles && !this.selectedRole);
        const addButtonTooltip = this.isAddDisabled
            ? this.addDisabledTooltip
            : (!this.hideRoles && !this.selectedRole ? 'You must assign a role' : 'Add collaborator');

        return html`
            <div class="result-row">
                <div class="result-user">
                    <div class="user-initial">${firstInitial}</div>
                    <div class="user-name">${displayName}${this.user.email && this.user.email !== displayName
                        ? html`<div style="font-size:0.85em;opacity:0.75;font-weight:400">${this.user.email}</div>`
                        : ''}</div>
                </div>
                <div class="result-actions">
                    ${!this.hideRoles ? html`
                        <dropdown-select
                            .value=${roleValue}
                            .options=${this.effectiveRoleOptions}
                            aria-label="Assign collaborator role"
                            ?disabled=${!this.isRoleEditable}
                            @change=${(event) => this.handleRoleChange(event)}
                        ></dropdown-select>
                    ` : ''}
                    ${this.mode === 'search' ? html`
                        <div class="add-button-wrapper ${addDisabled ? 'show-tooltip' : ''}">
                            <button
                                class="add-user-button"
                                type="button"
                                ?disabled=${addDisabled}
                                aria-describedby=${addDisabled ? 'pending-tooltip' : ''}
                                @click=${() => this.emitAdd()}
                            >
                                Add
                            </button>
                            ${addDisabled ? html`
                                <div id="pending-tooltip" class="tooltip-bubble">${addButtonTooltip}</div>
                            ` : ''}
                        </div>
                    ` : ''}
                    ${this.mode === 'selected' && this.showRemoveButton ? html`
                        <button
                            class="remove-icon-button"
                            type="button"
                            aria-label="Remove collaborator"
                            title="Remove collaborator"
                            @click=${() => this.emitRemove()}
                        >
                            <svg class="remove-icon" viewBox="0 0 24 24" aria-hidden="true">
                                <path
                                    fill="currentColor"
                                    d="M9 3h6l1 2h4v2h-2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7H4V5h4l1-2zm7 4H8v13h8V7zm-6 3h2v7h-2v-7zm4 0h2v7h-2v-7z"
                                ></path>
                            </svg>
                        </button>
                    ` : ''}
                </div>
            </div>
        `;
    }
}

customElements.define('collaborator-result-row', CollaboratorResultRow);
