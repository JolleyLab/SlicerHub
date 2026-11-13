import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import './toggle-switch.js';
import {
    approveCaseWorkflow, removeCaseWorkflow, declineCaseWorkflowRequest, updateCaseWorkflowSettings,
} from '../services/workflows.js';
import { formatFileExtension } from '../utils/fileTypes.js';

/** "A", "A and B", "A and 2 others". */
function requesterText(names) {
    const shown = names.map((n) => n || t('caseSettings.someone'));
    if (shown.length <= 2) return shown.join(` ${t('caseSettings.and')} `);
    return t('caseSettings.nameAndOthers', { name: shown[0], count: shown.length - 1 });
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

/**
 * Case Settings › Workflows, for case admins (docs/workflows-design.md › Case Settings):
 * pending requests and approved workflows (these move to the case's Workflows panel), the
 * case's default workflow, and whether members may use their own workflows. `data` is the case
 * page's GET /api/cases/:id/workflows.
 * Emits `workflows-changed` after a change, and `find-workflows` for "Add…".
 */
export class CaseSettings extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { attribute: false },
            decliningId: { state: true },
            declineReason: { state: true },
            busy: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            :host { max-width: 760px; }
            section { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
            h3 { margin: 0; font-size: 1rem; }
            h4 { margin: 8px 0 0; font-size: 0.9rem; }
            .default-select { max-width: 320px; }
            .hint { padding: 8px 10px; border-radius: var(--radius-sm, 6px); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
            .decline-form { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; }
            .decline-form input { flex: 1 1 240px; }
        `];
    }

    constructor() {
        super();
        this.caseId = '';
        this.data = null;
        this.decliningId = '';
        this.declineReason = '';
        this.busy = false;
        this.error = '';
    }

    async _run(action) {
        this.busy = true;
        this.error = '';
        try {
            await action();
            this.dispatchEvent(new CustomEvent('workflows-changed', { bubbles: true, composed: true }));
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
        } finally {
            this.busy = false;
        }
    }

    _renderApproved() {
        const approved = this.data?.approved || [];
        return html`
            <div class="row">
                <h4 class="grow">${t('caseSettings.approved')}</h4>
                <button class="secondary-button" type="button" ?disabled=${this.busy}
                    @click=${() => this.dispatchEvent(new CustomEvent('find-workflows', { bubbles: true, composed: true }))}>
                    ${t('caseSettings.addWorkflow')}
                </button>
            </div>
            ${approved.length ? html`<ul class="list">${approved.map((a) => html`
                <li class="item">
                    <span class="item-name grow">${a.name}</span>
                    <span class="muted">${(a.fileTypes || []).length
                        ? a.fileTypes.map(formatFileExtension).join(', ')
                        : t('workflows.anyFileType')}</span>
                    ${a.updateAvailable ? html`
                        <span class="pill">${t('workflows.updateAvailable')}</span>
                        <button class="quiet-button" type="button" ?disabled=${this.busy}
                            aria-label=${t('workflows.updateItem', { name: a.name })}
                            @click=${() => this._run(() => approveCaseWorkflow(this.caseId, a.workflowId))}>${t('workflows.update')}</button>
                    ` : ''}
                    <button class="quiet-button" type="button" ?disabled=${this.busy}
                        aria-label=${t('common.removeItem', { item: a.name })}
                        @click=${() => this._run(() => removeCaseWorkflow(this.caseId, a.id))}>${t('common.remove')}</button>
                </li>`)}</ul>`
            : html`<span class="muted">${t('workflows.noneApproved')}</span>`}
        `;
    }

    _renderDefault() {
        const approved = this.data?.approved || [];
        const value = this.data?.defaultWorkflow || '';
        return html`
            <h4><label for="default-workflow">${t('caseSettings.defaultWorkflow')}</label></h4>
            <span class="muted">${t('caseSettings.defaultWorkflowHint')}</span>
            ${approved.length && !value ? html`<span class="hint">${t('caseSettings.noDefaultHint')}</span>` : ''}
            <select id="default-workflow" class="default-select" .value=${value} ?disabled=${this.busy}
                @change=${(e) => this._run(() => updateCaseWorkflowSettings(this.caseId, { defaultWorkflow: e.target.value }))}>
                <option value="" ?selected=${!value}>${t('caseSettings.noWorkflow')}</option>
                ${approved.map((a) => html`<option value=${String(a.id)} ?selected=${value === String(a.id)}>${a.name}</option>`)}
            </select>
        `;
    }

    _renderRequest(r) {
        const declining = this.decliningId === String(r.id);
        return html`
            <li class="item">
                <span class="grow">
                    <span class="item-name">${r.name}</span>
                    <span class="muted">· ${t('caseSettings.requestedBy', { names: requesterText(r.requesterNames) })}</span>
                    ${r.previousDecline ? html`<br><span class="muted">${r.previousDecline.reason
                        ? t('caseSettings.previouslyDeclinedReason', { date: formatDate(r.previousDecline.at), reason: r.previousDecline.reason })
                        : t('caseSettings.previouslyDeclined', { date: formatDate(r.previousDecline.at) })}</span>` : ''}
                </span>
                ${r.sourcePublic ? '' : html`<span class="pill">${t('caseSettings.noLongerPublic')}</span>`}
                ${declining ? html`
                    <form class="decline-form" @submit=${(e) => {
                        e.preventDefault();
                        this._run(() => declineCaseWorkflowRequest(this.caseId, r.id, this.declineReason.trim()))
                            .then(() => { this.decliningId = ''; this.declineReason = ''; });
                    }}>
                        <input type="text" maxlength="500" .value=${this.declineReason}
                            placeholder=${t('caseSettings.declineReason')} aria-label=${t('caseSettings.declineReason')}
                            @input=${(e) => { this.declineReason = e.target.value; }} />
                        <button class="secondary-button" type="submit" ?disabled=${this.busy}>${t('caseSettings.decline')}</button>
                        <button class="quiet-button" type="button" @click=${() => { this.decliningId = ''; }}>${t('common.cancel')}</button>
                    </form>
                ` : html`
                    <button class="secondary-button" type="button" ?disabled=${this.busy || !r.sourcePublic}
                        aria-label=${t('caseSettings.approveItem', { name: r.name })}
                        @click=${() => this._run(() => approveCaseWorkflow(this.caseId, r.workflowId))}>${t('workflows.approve')}</button>
                    <button class="quiet-button" type="button" ?disabled=${this.busy}
                        aria-label=${t('caseSettings.declineItem', { name: r.name })}
                        @click=${() => { this.decliningId = String(r.id); this.declineReason = ''; }}>${t('caseSettings.decline')}</button>
                `}
            </li>
        `;
    }

    render() {
        if (!this.data) return html`<span class="muted">${t('common.loading')}</span>`;
        const requests = this.data.requests || [];
        return html`
            <section aria-labelledby="workflows-heading">
                <h3 id="workflows-heading">${t('workflows.title')}</h3>
                ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                ${requests.length ? html`
                    <h4>${t('caseSettings.requests', { count: requests.length })}</h4>
                    <ul class="list">${requests.map((r) => this._renderRequest(r))}</ul>
                ` : ''}
                ${this._renderApproved()}
                ${this._renderDefault()}
                <h4>${t('caseSettings.personalWorkflows')}</h4>
                <toggle-switch
                    .checked=${this.data.allowPersonal !== false}
                    .trueLabel=${t('caseSettings.allowPersonal')}
                    .falseLabel=${t('caseSettings.allowPersonal')}
                    aria-label=${t('caseSettings.allowPersonal')}
                    @toggle-change=${(e) => this._run(() => updateCaseWorkflowSettings(this.caseId, { allowPersonal: e.detail.checked }))}
                ></toggle-switch>
                <span class="muted">${t('caseSettings.allowPersonalHint')}</span>
            </section>
        `;
    }
}

customElements.define('case-settings', CaseSettings);
