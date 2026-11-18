import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import './app-dialog.js';
import './icon-button.js';
import {
    listAvailableCaseWorkflows, requestCaseWorkflow, cancelCaseWorkflowRequest, approveCaseWorkflow,
    removeCaseWorkflow, declineCaseWorkflowRequest,
} from '../services/workflows.js';
import { VIEWER, canRun } from '../utils/openWith.js';
import { formatFileExtension } from '../utils/fileTypes.js';
import { ICON_TRASH } from '../utils/icons.js';
import { requesterText } from '../utils/activityItems.js';
import { invalidateNotifications } from '../services/notifications.js';

const SEARCH_DELAY_MS = 250;
export const PANEL_TAB = Object.freeze({ CASE: 'case', BROWSE: 'browse', REQUESTS: 'requests' });

const formatDate = (iso) => (iso ? new Date(iso).toLocaleDateString() : '');

/**
 * The case's Workflows panel (docs/workflows-design.md › Workflows panel), from the case toolbar,
 * for everyone: what's in the case (admins remove or update; members see and cancel their
 * requests), browsing public workflows to request (members above read_only) or add (admins), and
 * for admins the requests waiting. `data` is the case page's GET /api/cases/:id/workflows.
 * Call open({ tab }); emits `workflows-changed` after a change.
 */
export class CaseWorkflowsPanel extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { attribute: false },
            /** Extensions in the SlicerWeb build being launched, for "runs in" (null: unknown). */
            slicerWebExtensions: { attribute: false },
            tab: { state: true },
            query: { state: true },
            results: { state: true },
            busyId: { state: true },
            decliningId: { state: true },
            declineReason: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, workflowStyles, css`
            icon-button svg { width: 15px; height: 15px; }
            .tabs { display: flex; gap: 4px; border-bottom: 1px solid var(--color-border); margin-bottom: 12px; }
            .tabs button { border: 0; background: transparent; color: var(--color-text-secondary); font: inherit;
                padding: 6px 10px; cursor: pointer; border-bottom: 2px solid transparent; }
            .tabs button[aria-selected='true'] { color: var(--color-text-primary); font-weight: 600; border-bottom-color: var(--color-focus); }
            .results { max-height: min(55vh, 460px); overflow-y: auto; }
            /* Details on the left, actions in their own column on the right, so buttons line up row to row. */
            .item { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; column-gap: 12px; }
            .item-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
            .actions { display: flex; align-items: center; justify-content: flex-end; gap: 6px; }
            .tags { display: flex; gap: 6px; flex-wrap: wrap; margin-top: 2px; }
            .search { width: 100%; }
            .decline-form { display: flex; gap: 8px; flex-wrap: wrap; grid-column: 1 / -1; }
            .decline-form input { flex: 1 1 240px; }
        `];
    }

    constructor() {
        super();
        this.caseId = '';
        this.data = null;
        this.slicerWebExtensions = null;
        this.tab = PANEL_TAB.CASE;
        this.query = '';
        this.results = null;
        this.busyId = '';
        this.decliningId = '';
        this.declineReason = '';
        this.error = '';
        this._searchTimer = null;
    }

    get _admin() { return this.data?.canManage === true; }

    get _tabs() {
        return [
            [PANEL_TAB.CASE, t('caseWorkflows.tabInCase')],
            ...(this.data?.canRequest || this._admin
                ? [[PANEL_TAB.BROWSE, this._admin ? t('caseWorkflows.tabAdd') : t('caseWorkflows.tabRequest')]] : []),
            ...(this._admin ? [[PANEL_TAB.REQUESTS, t('caseWorkflows.tabRequests', { count: (this.data?.requests || []).length })]] : []),
        ];
    }

    /** Opens on `tab`; by default on the requests when an admin has some waiting. */
    open({ tab } = {}) {
        const waiting = this._admin && (this.data?.requests || []).length;
        this._show(tab || (waiting ? PANEL_TAB.REQUESTS : PANEL_TAB.CASE));
        this.renderRoot?.querySelector('app-dialog')?.openDialog();
    }

    _show(tab) {
        Object.assign(this, { tab, error: '', decliningId: '' });
        if (tab === PANEL_TAB.BROWSE) {
            this.query = '';
            this._search();
        }
    }

    async _search() {
        const key = `${this.caseId}|${this.query}`;
        this._searchKey = key;
        try {
            const results = await listAvailableCaseWorkflows(this.caseId, { q: this.query.trim() });
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

    /** Run an action for one row, then tell the page (which reloads `data`) and refresh the browse list. */
    async _act(id, action) {
        this.busyId = String(id);
        this.error = '';
        try {
            await action();
            if (this.tab === PANEL_TAB.BROWSE) await this._search();
            this.dispatchEvent(new CustomEvent('workflows-changed', { bubbles: true, composed: true }));
            invalidateNotifications(); // the bell's count of requests waiting
            return true;
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
            return false;
        } finally {
            this.busyId = '';
        }
    }

    /** "Runs in SlicerWeb and Full Slicer", with the same rule as the Open ▾ menu. */
    _runsIn(workflow) {
        const opts = { viewers: this.data?.viewers, slicerWebExtensions: this.slicerWebExtensions };
        const web = canRun(workflow, VIEWER.SLICERWEB, opts);
        const full = canRun(workflow, VIEWER.FULL, opts);
        const key = web && full ? 'runsBoth' : web ? 'runsSlicerWeb' : full ? 'runsFullSlicer' : 'runsNowhere';
        return t(`caseWorkflows.${key}`);
    }

    /** Name, description, then "file types · runs in · starts in", and any `tags` (shown as pills). */
    _details(w, tags = []) {
        return html`
            <span class="item-text">
                <span class="item-name">${w.name}</span>
                ${w.description ? html`<span class="muted">${w.description}</span>` : ''}
                <span class="muted">${[
                    (w.fileTypes || []).length ? w.fileTypes.map(formatFileExtension).join(', ') : t('workflows.anyFileType'),
                    this._runsIn(w),
                    w.startupConfig?.module ? t('viewers.startsIn', { module: w.startupConfig.module }) : null,
                ].filter(Boolean).join(' · ')}</span>
                ${tags.length ? html`<span class="tags">${tags.map((tag) => html`<span class="pill">${tag}</span>`)}</span>` : ''}
            </span>
        `;
    }

    _removeButton(name, onClick, id) {
        return html`<icon-button size="sm" label=${t('common.removeItem', { item: name })}
            ?disabled=${this.busyId === String(id)} @click=${onClick}>${ICON_TRASH}</icon-button>`;
    }

    _button(label, itemName, onClick, { quiet = false, disabled = false, id } = {}) {
        return html`<button class=${quiet ? 'quiet-button' : 'secondary-button'} type="button"
            ?disabled=${disabled || this.busyId === String(id)} aria-label=${`${label}: ${itemName}`}
            @click=${onClick}>${label}</button>`;
    }

    _renderInCase() {
        const approved = this.data?.approved || [];
        const mine = this.data?.myRequests || [];
        return html`
            ${approved.length ? html`<ul class="list results">${approved.map((a) => html`
                <li class="item">
                    ${this._details(a, this._admin && a.updateAvailable ? [t('workflows.updateAvailable')] : [])}
                    ${this._admin ? html`<span class="actions">
                        ${a.updateAvailable ? this._button(t('workflows.update'), a.name, () => this._act(a.id, () => approveCaseWorkflow(this.caseId, a.workflowId)), { quiet: true, id: a.id }) : ''}
                        ${this._removeButton(a.name, () => this._act(a.id, () => removeCaseWorkflow(this.caseId, a.id)), a.id)}
                    </span>` : ''}
                </li>`)}</ul>`
            : html`<span class="muted">${t('caseWorkflows.none')}</span>`}
            ${mine.length ? html`
                <h4>${t('caseWorkflows.yourRequests')}</h4>
                <ul class="list">${mine.map((r) => html`
                    <li class="item">
                        <span class="item-text">
                            <span class="item-name">${r.name}</span>
                            <span class="tags"><span class="pill">${t('caseWorkflows.waiting')}</span></span>
                        </span>
                        <span class="actions">${this._button(t('workflows.cancelRequest'), r.name, () => this._act(r.workflowId, () => cancelCaseWorkflowRequest(this.caseId, r.workflowId)), { quiet: true, id: r.workflowId })}</span>
                    </li>`)}</ul>
            ` : ''}
        `;
    }

    _browseRow(w) {
        const tags = this._admin ? [] : w.requestedByMe ? [t('workflows.requested')] : w.requested ? [t('workflows.requestedByOthers')] : [];
        const action = this._admin
            ? this._button(t('workflows.add'), w.name, () => this._act(w.id, () => approveCaseWorkflow(this.caseId, w.id)), { id: w.id })
            : w.requestedByMe ? this._button(t('workflows.cancelRequest'), w.name, () => this._act(w.id, () => cancelCaseWorkflowRequest(this.caseId, w.id)), { quiet: true, id: w.id })
            : this._button(w.requested ? t('caseWorkflows.requestToo') : t('workflows.request'), w.name,
                () => this._act(w.id, () => requestCaseWorkflow(this.caseId, w.id)), { id: w.id });
        return html`<li class="item">${this._details(w, tags)}<span class="actions">${action}</span></li>`;
    }

    _renderBrowse() {
        return html`
            <span class="muted">${this._admin ? t('caseWorkflows.browseHintAdmin') : t('caseWorkflows.browseHint')}</span>
            <input class="search" type="text" .value=${this.query}
                placeholder=${t('workflows.filterPlaceholder')} aria-label=${t('workflows.searchAria')}
                @input=${(e) => this._onQuery(e.target.value)} />
            ${!this.results ? html`<span class="muted">${t('common.loading')}</span>`
                : !this.results.length ? html`<span class="muted">${t('caseWorkflows.browseNone')}</span>`
                : html`<ul class="list results">${this.results.map((w) => this._browseRow(w))}</ul>`}
        `;
    }

    _renderRequest(r) {
        if (this.decliningId === String(r.id)) {
            return html`
                <form class="decline-form" @submit=${async (e) => {
                    e.preventDefault();
                    if (await this._act(r.id, () => declineCaseWorkflowRequest(this.caseId, r.id, this.declineReason.trim()))) {
                        Object.assign(this, { decliningId: '', declineReason: '' });
                    }
                }}>
                    <input type="text" maxlength="500" .value=${this.declineReason}
                        placeholder=${t('caseWorkflows.declineReason')} aria-label=${t('caseWorkflows.declineReason')}
                        @input=${(e) => { this.declineReason = e.target.value; }} />
                    <button class="secondary-button" type="submit" ?disabled=${this.busyId === String(r.id)}>${t('caseWorkflows.decline')}</button>
                    <button class="quiet-button" type="button" @click=${() => { this.decliningId = ''; }}>${t('common.cancel')}</button>
                </form>
            `;
        }
        return html`<span class="actions">
            ${this._button(t('workflows.approve'), r.name, () => this._act(r.id, () => approveCaseWorkflow(this.caseId, r.workflowId)), { disabled: !r.sourcePublic, id: r.id })}
            ${this._button(t('caseWorkflows.decline'), r.name, () => Object.assign(this, { decliningId: String(r.id), declineReason: '' }), { quiet: true, id: r.id })}
        </span>`;
    }

    _renderRequests() {
        const requests = this.data?.requests || [];
        if (!requests.length) return html`<span class="muted">${t('caseWorkflows.noRequests')}</span>`;
        return html`<ul class="list results">${requests.map((r) => html`
            <li class="item">
                <span class="item-text">
                    <span class="item-name">${r.name}</span>
                    <span class="muted">${t('caseWorkflows.requestedBy', { names: requesterText(r.requesterNames) })}</span>
                    ${r.previousDecline ? html`<span class="muted">${r.previousDecline.reason
                        ? t('caseWorkflows.previouslyDeclinedReason', { date: formatDate(r.previousDecline.at), reason: r.previousDecline.reason })
                        : t('caseWorkflows.previouslyDeclined', { date: formatDate(r.previousDecline.at) })}</span>` : ''}
                    ${r.sourcePublic ? '' : html`<span class="tags"><span class="pill">${t('caseWorkflows.noLongerPublic')}</span></span>`}
                </span>
                ${this._renderRequest(r)}
            </li>`)}</ul>`;
    }

    render() {
        const body = { [PANEL_TAB.CASE]: () => this._renderInCase(), [PANEL_TAB.BROWSE]: () => this._renderBrowse(), [PANEL_TAB.REQUESTS]: () => this._renderRequests() };
        return html`
            <app-dialog .title=${t('caseWorkflows.title')}>
                <div class="tabs" role="tablist">
                    ${this._tabs.map(([key, label]) => html`
                        <button role="tab" aria-selected=${this.tab === key ? 'true' : 'false'} @click=${() => this._show(key)}>${label}</button>`)}
                </div>
                <div class="stack" role="tabpanel">
                    ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                    ${(body[this.tab] || body[PANEL_TAB.CASE])()}
                </div>
            </app-dialog>
        `;
    }
}

customElements.define('case-workflows-panel', CaseWorkflowsPanel);
