import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import './toggle-switch.js';
import {
    approveCaseWorkflow, removeCaseWorkflow, declineCaseWorkflowRequest, updateCaseWorkflowSettings,
} from '../services/workflows.js';
import { BUILTIN_WORKFLOWS } from '../utils/caseWorkflowMenu.js';
import { formatFileExtension } from '../utils/fileTypes.js';

const BLANK = 'blank';
const OTHER = '*';

/** "A", "A and B", "A and 2 others". */
function requesterText(names) {
    const shown = names.map((n) => n || t('caseSettings.someone'));
    if (shown.length <= 2) return shown.join(` ${t('caseSettings.and')} `);
    return t('caseSettings.nameAndOthers', { name: shown[0], count: shown.length - 1 });
}

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

/**
 * Case Settings › Workflows, for case admins (docs/workflows-design.md › Case Settings):
 * approved workflows, the defaults table, whether members may use their own workflows, and
 * pending requests. `data` is the case page's GET /api/cases/:id/workflows; `fileTypes` the
 * case's attachment types, offered when adding a default.
 * Emits `workflows-changed` after a change, and `find-workflows` for "Add…".
 */
export class CaseSettings extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { attribute: false },
            fileTypes: { attribute: false },
            addedTypes: { state: true },
            newType: { state: true },
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
            .defaults { display: grid; grid-template-columns: minmax(120px, max-content) minmax(0, 1fr); gap: 8px 16px; align-items: center; }
            .defaults select { width: 100%; max-width: 320px; }
            .hint { padding: 8px 10px; border-radius: var(--radius-sm, 6px); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
            .decline-form { display: flex; gap: 8px; flex-wrap: wrap; width: 100%; }
            .decline-form input { flex: 1 1 240px; }
        `];
    }

    constructor() {
        super();
        this.caseId = '';
        this.data = null;
        this.fileTypes = [];
        this.addedTypes = [];
        this.newType = '';
        this.decliningId = '';
        this.declineReason = '';
        this.busy = false;
        this.error = '';
    }

    updated(changed) {
        if (changed.has('caseId')) this.addedTypes = [];
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

    get _defaults() {
        return this.data?.defaults || {};
    }

    _setDefault(key, value) {
        const defaults = { ...this._defaults, [key]: value };
        if (!value) delete defaults[key];
        if (key !== BLANK && key !== OTHER && !value) this.addedTypes = this.addedTypes.filter((ext) => ext !== key);
        return this._run(() => updateCaseWorkflowSettings(this.caseId, { defaults }));
    }

    _typeKeys() {
        const fromDefaults = Object.keys(this._defaults).filter((k) => k !== BLANK && k !== OTHER);
        return [...new Set([...fromDefaults, ...this.addedTypes])].sort();
    }

    /** File types to offer for a new default row: from approved workflows and the case's files. */
    _typeSuggestions() {
        const used = new Set(this._typeKeys());
        const fromWorkflows = (this.data?.approved || []).flatMap((a) => a.fileTypes || []);
        return [...new Set([...fromWorkflows, ...(this.fileTypes || [])])].filter((ext) => !used.has(ext)).sort();
    }

    _defaultRow(key, label) {
        const blank = key === BLANK;
        const builtins = BUILTIN_WORKFLOWS.filter((b) => !blank || b.target === 'slicerweb');
        const value = this._defaults[key] || '';
        const id = `default-${key === OTHER ? 'other' : key.replace(/\./g, '-')}`;
        return html`
            <label for=${id}>${label}</label>
            <select id=${id} .value=${value} ?disabled=${this.busy} @change=${(e) => this._setDefault(key, e.target.value)}>
                <option value="" ?selected=${!value}>${t('caseSettings.eachPersonsDefault')}</option>
                ${(this.data?.approved || []).length ? html`
                    <optgroup label=${t('viewers.recommended')}>
                        ${this.data.approved.map((a) => html`<option value=${String(a.id)} ?selected=${value === String(a.id)}>${a.name}</option>`)}
                    </optgroup>
                ` : ''}
                <optgroup label=${t('viewers.otherWays')}>
                    ${builtins.map((b) => html`<option value=${b.key} ?selected=${value === b.key}>${t(b.nameKey)}</option>`)}
                </optgroup>
            </select>
        `;
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

    _renderDefaults() {
        const suggestions = this._typeSuggestions();
        const noDefaults = (this.data?.approved || []).length && !Object.keys(this._defaults).length;
        return html`
            <h4>${t('caseSettings.defaults')}</h4>
            <span class="muted">${t('caseSettings.defaultsHint')}</span>
            ${noDefaults ? html`<span class="hint">${t('caseSettings.noDefaultsHint')}</span>` : ''}
            <div class="defaults">
                ${this._defaultRow(BLANK, t('caseSettings.blankViewer'))}
                ${this._typeKeys().map((ext) => this._defaultRow(ext, formatFileExtension(ext)))}
                ${this._defaultRow(OTHER, t('caseSettings.otherFiles'))}
            </div>
            ${suggestions.length ? html`
                <form class="row" @submit=${(e) => {
                    e.preventDefault();
                    if (this.newType) this.addedTypes = [...this.addedTypes, this.newType];
                    this.newType = '';
                }}>
                    <label for="new-type" class="muted">${t('caseSettings.addFileType')}</label>
                    <select id="new-type" .value=${this.newType} @change=${(e) => { this.newType = e.target.value; }}>
                        <option value="">${t('caseSettings.chooseFileType')}</option>
                        ${suggestions.map((ext) => html`<option value=${ext}>${formatFileExtension(ext)}</option>`)}
                    </select>
                    <button class="secondary-button" type="submit" ?disabled=${!this.newType}>${t('workflows.add')}</button>
                </form>
            ` : ''}
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
                ${this._renderDefaults()}
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
