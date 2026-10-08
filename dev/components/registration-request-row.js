import { LitElement, html, css } from 'lit-element';

/**
 * Renders a single registration request row.
 * Pending items show approve/reject actions.
 * Decided items (approved/rejected within the last 7 days) show read-only attribution.
 *
 * Properties:
 *   request          Object   { id, firstName, lastName, email, affiliation, createdAt,
 *                               intendedUse, status, reviewerName, decidedAt }
 *   saving           Boolean  Disables buttons while an API call is in flight
 *   showAdminOption  Boolean  Show the "Approve as OrgAdmin" checkbox (default: false)
 *
 * Events:
 *   approve   detail: { id, asAdmin }
 *   reject    detail: { id }
 */
export class RegistrationRequestRow extends LitElement {
    static get properties() {
        return {
            request:         { type: Object },
            saving:          { type: Boolean },
            showAdminOption: { type: Boolean },
            _asAdmin:        { type: Boolean, state: true }
        };
    }

    static get styles() {
        return css`
            :host {
                display: block;
                padding: 14px 0;
                border-bottom: 1px solid var(--color-border, #e5e7eb);
            }
            :host(:last-of-type) { border-bottom: none; }

            .name {
                font-weight: 600;
                font-size: 15px;
                margin: 0 0 2px 0;
                color: var(--color-text-primary, #111);
            }
            .email {
                font-size: 13px;
                color: var(--color-text-secondary, #6b7280);
                margin: 0 0 4px 0;
            }
            .meta {
                font-size: 12px;
                color: var(--color-text-secondary, #6b7280);
                margin: 0 0 10px 0;
            }
            .intended-use {
                font-size: 13px;
                color: var(--color-text-primary, #333);
                background: var(--color-surface-subtle, #f9fafb);
                border-radius: 6px;
                padding: 8px 10px;
                margin: 0 0 10px 0;
                white-space: pre-wrap;
            }
            .admin-option {
                display: flex;
                align-items: center;
                gap: 6px;
                font-size: 12px;
                color: var(--color-text-secondary, #6b7280);
                margin-bottom: 10px;
                cursor: pointer;
                width: fit-content;
            }
            .admin-option input[type='checkbox'] { cursor: pointer; accent-color: var(--color-primary); }
            .actions { display: flex; gap: 8px; flex-wrap: wrap; }

            /* Approve button */
            .btn-approve {
                background: var(--color-primary);
                color: var(--color-on-primary, #fff);
                border: 1px solid transparent;
                border-radius: var(--radius-sm, 6px);
                padding: 6px 14px;
                font-size: 0.8125rem;
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
            }
            .btn-approve:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            /* Reject button */
            .btn-reject {
                background: transparent;
                color: var(--color-text-secondary, #6b7280);
                border: 1px solid var(--color-border, #d1d5db);
                border-radius: var(--radius-sm, 6px);
                padding: 6px 14px;
                font-size: 0.8125rem;
                font-family: inherit;
                font-weight: 600;
                cursor: pointer;
            }
            .btn-reject:hover:not(:disabled) {
                border-color: var(--color-status-error, #dc2626);
                color: var(--color-status-error, #dc2626);
            }

            .btn-approve:disabled,
            .btn-reject:disabled { opacity: 0.5; cursor: not-allowed; }

            .btn-approve:focus-visible,
            .btn-reject:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            /* Decided state */
            .decision {
                display: flex;
                align-items: center;
                gap: 7px;
                font-size: 13px;
                font-weight: 600;
                margin-top: 2px;
            }
            .decision-icon {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                font-size: 11px;
                flex-shrink: 0;
            }
            .decision-icon.approved {
                background: color-mix(in srgb, var(--color-status-success, #16a34a) 15%, transparent);
                color: var(--color-status-success, #16a34a);
            }
            .decision-icon.rejected {
                background: color-mix(in srgb, var(--color-status-error, #dc2626) 12%, transparent);
                color: var(--color-status-error, #dc2626);
            }
            /* Use -fg tokens: dark enough for 4.5:1 on light backgrounds */
            .decision-label.approved { color: var(--color-status-success-fg, #166534); }
            .decision-label.rejected { color: var(--color-status-error, #dc2626); }
            .decision-by {
                font-weight: 400;
                color: var(--color-text-secondary, #6b7280);
            }

            :host-context([data-theme='dark']) .decision-label.approved {
                color: var(--color-status-success-light, #4ade80);
            }
            :host-context([data-theme='dark']) .decision-label.rejected {
                color: var(--color-status-error-light, #f87171);
            }
            :host-context([data-theme='dark']) .decision-icon.approved {
                color: var(--color-status-success-light, #4ade80);
                background: color-mix(in srgb, #4ade80 18%, transparent);
            }
            :host-context([data-theme='dark']) .decision-icon.rejected {
                color: var(--color-status-error-light, #f87171);
                background: color-mix(in srgb, #f87171 15%, transparent);
            }
        `;
    }

    constructor() {
        super();
        this.saving = false;
        this.showAdminOption = false;
        this._asAdmin = false;
    }

    _formatDate(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
        } catch (_) { return iso; }
    }

    _approve() {
        this.dispatchEvent(new CustomEvent('approve', {
            detail: { id: this.request?.id, asAdmin: this._asAdmin },
            bubbles: true, composed: true
        }));
    }

    _reject() {
        this.dispatchEvent(new CustomEvent('reject', {
            detail: { id: this.request?.id },
            bubbles: true, composed: true
        }));
    }

    _renderDecision(r) {
        const approved = r.status === 'approved';
        const label = approved ? 'Approved' : 'Rejected';
        const icon = approved ? '✓' : '✕';
        const cls = approved ? 'approved' : 'rejected';
        const byLine = r.reviewerName
            ? html` <span class="decision-by">by ${r.reviewerName}</span>`
            : '';
        const onDate = r.decidedAt
            ? html` <span class="decision-by">on ${this._formatDate(r.decidedAt)}</span>`
            : '';
        return html`
            <div class="decision">
                <span class="decision-icon ${cls}" aria-hidden="true">${icon}</span>
                <span class="decision-label ${cls}">${label}</span>${byLine}${onDate}
            </div>
        `;
    }

    render() {
        const r = this.request;
        if (!r) return '';
        const fullName = [r.firstName, r.lastName].filter(Boolean).join(' ');
        const isPending = !r.status || r.status === 'pending';
        return html`
            <p class="name">${fullName}</p>
            <p class="email">${r.email}</p>
            <p class="meta">
                ${r.affiliation ? html`${r.affiliation} &middot; ` : ''}
                Requested ${this._formatDate(r.createdAt)}
            </p>
            ${r.intendedUse ? html`
                <div class="intended-use">${r.intendedUse}</div>
            ` : ''}
            ${isPending ? html`
                ${this.showAdminOption ? html`
                    <label class="admin-option">
                        <input type="checkbox"
                            .checked=${this._asAdmin}
                            @change=${e => { this._asAdmin = e.target.checked; }} />
                        Approve as OrgAdmin
                    </label>
                ` : ''}
                <div class="actions">
                    <button class="btn-approve"
                        aria-label="Approve ${fullName}"
                        ?disabled=${this.saving}
                        @click=${this._approve}>Approve</button>
                    <button class="btn-reject"
                        aria-label="Reject ${fullName}"
                        ?disabled=${this.saving}
                        @click=${this._reject}>Reject</button>
                </div>
            ` : this._renderDecision(r)}
        `;
    }
}

customElements.define('registration-request-row', RegistrationRequestRow);
