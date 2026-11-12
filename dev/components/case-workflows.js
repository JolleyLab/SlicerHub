import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import { listCaseWorkflows, approveCaseWorkflow, removeCaseWorkflow } from '../services/workflows.js';

/**
 * Case page, for case admins: approving and removing workflows. (Choosing one to open with is
 * the Open ▾ menu; this moves to Case Settings.) Shows nothing to other members.
 * Emits `workflows-changed` after a change, so the Open ▾ menus reload.
 */
export class CaseWorkflows extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { state: true },
            approveId: { state: true },
            busy: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            :host { margin-bottom: 12px; }
            summary { cursor: pointer; color: var(--color-text-secondary); font-size: 0.85rem; }
            details[open] summary { margin-bottom: 8px; }
            #approve-id { min-width: 200px; }
        `];
    }

    constructor() {
        super();
        this.data = null;
        this.approveId = '';
        this.busy = false;
        this.error = '';
    }

    updated(changed) {
        if (changed.has('caseId') && this.caseId) this._load();
    }

    /** `refresh` (after a change) keeps what is on screen until the new list arrives. */
    async _load({ refresh = false } = {}) {
        const caseId = this.caseId;
        if (!refresh) {
            this.data = null;
            this.error = '';
        }
        try {
            const data = await listCaseWorkflows(caseId);
            if (caseId === this.caseId) this.data = data;
        } catch (err) {
            if (caseId === this.caseId) this.error = err?.message || t('workflows.loadFailed');
        }
    }

    async _manage(action) {
        this.busy = true;
        this.error = '';
        try {
            await action();
            await this._load({ refresh: true });
            this.dispatchEvent(new CustomEvent('workflows-changed', { bubbles: true, composed: true }));
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
        } finally {
            this.busy = false;
        }
    }

    _approve(workflowId) {
        return this._manage(async () => {
            await approveCaseWorkflow(this.caseId, workflowId);
            this.approveId = '';
        });
    }

    render() {
        if (!this.data?.canManage) return this.error ? html`<span class="error">${this.error}</span>` : '';
        const approved = this.data.approved;
        return html`
            <details>
                <summary>${t('workflows.manage')}</summary>
                <div class="stack">
                    ${approved.length ? html`<ul class="list">${approved.map((a) => html`
                        <li class="item">
                            <span class="item-name grow">${a.name}</span>
                            <span class="muted">${a.extensions.join(', ') || t('workflows.noExtensions')}</span>
                            ${a.updateAvailable ? html`
                                <span class="pill">${t('workflows.updateAvailable')}</span>
                                <button class="quiet-button" type="button" ?disabled=${this.busy}
                                    aria-label=${t('workflows.updateItem', { name: a.name })}
                                    @click=${() => this._approve(a.workflowId)}>${t('workflows.update')}</button>
                            ` : ''}
                            <button class="quiet-button" type="button" ?disabled=${this.busy}
                                aria-label=${t('common.removeItem', { item: a.name })}
                                @click=${() => this._manage(() => removeCaseWorkflow(this.caseId, a.id))}>${t('common.remove')}</button>
                        </li>`)}</ul>`
                    : html`<span class="muted">${t('workflows.noneApproved')}</span>`}
                    <form class="row" @submit=${(e) => { e.preventDefault(); this._approve(this.approveId); }}>
                        <label for="approve-id" class="muted">${t('workflows.approveLabel')}</label>
                        <select id="approve-id" .value=${this.approveId}
                            @change=${(e) => { this.approveId = e.target.value; }}>
                            <option value="">${t('workflows.chooseWorkflow')}</option>
                            ${(this.data.available || []).map((w) => html`
                                <option value=${String(w.id)}>${w.name}${w.isMine ? '' : ` (${t('workflows.public')})`}</option>`)}
                        </select>
                        <button class="secondary-button" type="submit" ?disabled=${this.busy || !this.approveId}>
                            ${t('workflows.approve')}
                        </button>
                    </form>
                    ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                </div>
            </details>
        `;
    }
}

customElements.define('case-workflows', CaseWorkflows);
