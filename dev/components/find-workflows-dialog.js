import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import './app-dialog.js';
import {
    listAvailableCaseWorkflows, requestCaseWorkflow, cancelCaseWorkflowRequest, approveCaseWorkflow,
} from '../services/workflows.js';
import { fileTypesOf } from '../utils/caseWorkflowMenu.js';
import { formatFileExtension } from '../utils/fileTypes.js';

const SEARCH_DELAY_MS = 250;

/**
 * "Find more…" from an Open ▾ menu (docs/workflows-design.md): public workflows not yet on the
 * case. Members request them (or cancel their request); admins add them directly.
 * Call open({ caseId, fileName, canManage }). Emits `workflows-changed` after a change.
 */
export class FindWorkflowsDialog extends LitElement {
    static get properties() {
        return {
            caseId: { state: true },
            fileName: { state: true },
            canManage: { state: true },
            query: { state: true },
            onlyForFile: { state: true },
            results: { state: true },
            busyId: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            .results { max-height: min(50vh, 420px); overflow-y: auto; }
            .item { align-items: flex-start; }
            .item-text { display: flex; flex-direction: column; gap: 2px; }
            .search { width: 100%; }
        `];
    }

    constructor() {
        super();
        this.caseId = '';
        this.fileName = null;
        this.canManage = false;
        this.query = '';
        this.onlyForFile = true;
        this.results = null;
        this.busyId = '';
        this.error = '';
        this._searchTimer = null;
    }

    open({ caseId, fileName = null, canManage = false }) {
        Object.assign(this, { caseId: String(caseId), fileName, canManage, query: '', onlyForFile: fileName != null });
        this.renderRoot?.querySelector('app-dialog')?.openDialog();
        this._search();
    }

    get _fileTypes() {
        return this.onlyForFile && this.fileName != null ? fileTypesOf(this.fileName) : [];
    }

    async _search() {
        const key = `${this.caseId}|${this.query}|${this._fileTypes}`;
        this._searchKey = key;
        this.error = '';
        try {
            const results = await listAvailableCaseWorkflows(this.caseId, { q: this.query.trim(), fileTypes: this._fileTypes });
            if (key === this._searchKey) this.results = results;
        } catch (err) {
            if (key === this._searchKey) this.error = err?.message || t('workflows.loadFailed');
        }
    }

    _onQuery(value) {
        this.query = value;
        clearTimeout(this._searchTimer);
        this._searchTimer = setTimeout(() => this._search(), SEARCH_DELAY_MS);
    }

    async _act(workflow, action) {
        this.busyId = String(workflow.id);
        this.error = '';
        try {
            await action(this.caseId, workflow.id);
            await this._search();
            this.dispatchEvent(new CustomEvent('workflows-changed', { bubbles: true, composed: true }));
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
        } finally {
            this.busyId = '';
        }
    }

    _actionButton(w) {
        const busy = this.busyId === String(w.id);
        const button = (label, action, cls = 'secondary-button') => html`
            <button class=${cls} type="button" ?disabled=${busy}
                aria-label=${`${label}: ${w.name}`}
                @click=${() => this._act(w, action)}>${label}</button>`;
        if (this.canManage) return button(t('workflows.add'), approveCaseWorkflow);
        if (w.requestedByMe) return button(t('workflows.cancelRequest'), cancelCaseWorkflowRequest, 'quiet-button');
        return button(t('workflows.request'), requestCaseWorkflow);
    }

    _renderResults() {
        if (!this.results) return html`<span class="muted">${t('common.loading')}</span>`;
        if (!this.results.length) return html`<span class="muted">${t('workflows.findNone')}</span>`;
        return html`<ul class="list results">${this.results.map((w) => html`
            <li class="item">
                <span class="item-text grow">
                    <span class="item-name">${w.name}</span>
                    ${w.description ? html`<span class="muted">${w.description}</span>` : ''}
                    <span class="muted">${w.extensions.join(', ') || t('workflows.noExtensions')}</span>
                </span>
                ${w.requestedByMe ? html`<span class="pill">${t('workflows.requested')}</span>`
                    : w.requested && !this.canManage ? html`<span class="pill">${t('workflows.requestedByOthers')}</span>` : ''}
                ${this._actionButton(w)}
            </li>`)}</ul>`;
    }

    render() {
        const types = this.fileName != null ? fileTypesOf(this.fileName) : [];
        return html`
            <app-dialog title=${t('workflows.findTitle')}>
                <div class="stack">
                    <span class="muted">${this.canManage ? t('workflows.findHintAdmin') : t('workflows.findHint')}</span>
                    <input class="search" type="text" .value=${this.query}
                        placeholder=${t('workflows.filterPlaceholder')} aria-label=${t('workflows.searchAria')}
                        @input=${(e) => this._onQuery(e.target.value)} />
                    ${types.length ? html`
                        <label class="row muted">
                            <input type="checkbox" .checked=${this.onlyForFile}
                                @change=${(e) => { this.onlyForFile = e.target.checked; this._search(); }} />
                            ${t('workflows.onlyForType', { type: formatFileExtension(types[0]) })}
                        </label>
                    ` : ''}
                    ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                    ${this._renderResults()}
                </div>
            </app-dialog>
        `;
    }
}

customElements.define('find-workflows-dialog', FindWorkflowsDialog);
