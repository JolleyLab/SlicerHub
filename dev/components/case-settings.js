import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import './toggle-switch.js';
import {
    approveCaseWorkflow, removeCaseWorkflow, declineCaseWorkflowRequest, updateCaseWorkflowSettings,
} from '../services/workflows.js';
import { BUILTIN_WORKFLOWS } from '../utils/caseWorkflowMenu.js';
import { formatFileExtension, normalizeFileExtension } from '../utils/fileTypes.js';

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
 * pending requests; approved workflows, each of which can be the default for its file types;
 * what all other files and the blank viewer open with; built-in viewers for particular file
 * types; and whether members may use their own workflows. `data` is the case page's
 * GET /api/cases/:id/workflows; `fileTypes` the case's attachment types, suggested when adding
 * a built-in viewer default.
 * Emits `workflows-changed` after a change, and `find-workflows` for "Add…".
 */
export class CaseSettings extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            data: { attribute: false },
            fileTypes: { attribute: false },
            builtinType: { state: true },
            builtinViewer: { state: true },
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
            .defaults { display: grid; grid-template-columns: minmax(140px, max-content) minmax(0, 1fr); gap: 8px 16px; align-items: center; }
            .defaults select { width: 100%; max-width: 320px; }
            .type-input { width: 8em; }
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
        this.builtinType = '';
        this.builtinViewer = BUILTIN_WORKFLOWS[0].key;
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

    get _defaults() {
        return this.data?.defaults || {};
    }

    /** Save the defaults with `changes` applied; an empty value removes that key. */
    _saveDefaults(changes) {
        const defaults = { ...this._defaults, ...changes };
        for (const [key, value] of Object.entries(defaults)) if (!value) delete defaults[key];
        return this._run(() => updateCaseWorkflowSettings(this.caseId, { defaults }));
    }

    _isDefaultFor(approval) {
        return (approval.fileTypes || []).some((ext) => this._defaults[ext] === String(approval.id));
    }

    /** On: this workflow becomes the default for each of its file types (replacing whatever was). Off: it stops being. */
    _toggleDefault(approval, on) {
        const id = String(approval.id);
        const changes = Object.fromEntries((approval.fileTypes || [])
            .filter((ext) => on || this._defaults[ext] === id)
            .map((ext) => [ext, on ? id : '']));
        return this._saveDefaults(changes);
    }

    /** Defaults that send a file type to a built-in viewer, e.g. .mrb → Simplified Viewer. */
    _builtinTypeDefaults() {
        return Object.entries(this._defaults)
            .filter(([key, value]) => key !== BLANK && key !== OTHER && String(value).startsWith('builtin:'))
            .sort(([a], [b]) => a.localeCompare(b));
    }

    _builtinName(key) {
        const builtin = BUILTIN_WORKFLOWS.find((b) => b.key === key);
        return builtin ? t(builtin.nameKey) : key;
    }

    /** "All other files" or "Blank viewer": their own setting, an approved workflow, or a built-in viewer. */
    _defaultSelect(key, label) {
        const blank = key === BLANK;
        // Workflows made for particular file types are their defaults through the switches above.
        const approved = (this.data?.approved || []).filter((a) => blank || !(a.fileTypes || []).length);
        const builtins = BUILTIN_WORKFLOWS.filter((b) => !blank || b.target === 'slicerweb');
        const value = this._defaults[key] || '';
        const id = `default-${blank ? 'blank' : 'other'}`;
        return html`
            <label for=${id}>${label}</label>
            <select id=${id} .value=${value} ?disabled=${this.busy} @change=${(e) => this._saveDefaults({ [key]: e.target.value })}>
                <option value="" ?selected=${!value}>${t('caseSettings.ownViewerSetting')}</option>
                ${approved.length ? html`
                    <optgroup label=${t('caseSettings.approved')}>
                        ${approved.map((a) => html`<option value=${String(a.id)} ?selected=${value === String(a.id)}>${a.name}</option>`)}
                    </optgroup>
                ` : ''}
                <optgroup label=${t('caseSettings.builtinViewers')}>
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
                    <span class="muted">${(a.fileTypes || []).length
                        ? a.fileTypes.map(formatFileExtension).join(', ')
                        : t('workflows.anyFileType')}</span>
                    ${(a.fileTypes || []).length ? html`
                        <toggle-switch
                            .checked=${this._isDefaultFor(a)}
                            ?disabled=${this.busy}
                            .trueLabel=${t('caseSettings.defaultFor', { types: a.fileTypes.map(formatFileExtension).join(', ') })}
                            .falseLabel=${t('caseSettings.defaultFor', { types: a.fileTypes.map(formatFileExtension).join(', ') })}
                            aria-label=${t('caseSettings.defaultForItem', { name: a.name })}
                            @toggle-change=${(e) => this._toggleDefault(a, e.detail.checked)}
                        ></toggle-switch>
                    ` : ''}
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

    _addBuiltinDefault() {
        const ext = normalizeFileExtension(this.builtinType);
        if (!ext) {
            this.error = t('workflows.fileTypeInvalid', { value: this.builtinType.trim() });
            return;
        }
        this._saveDefaults({ [ext]: this.builtinViewer }).then(() => { this.builtinType = ''; });
    }

    _renderBuiltinTypeDefaults() {
        const suggestions = [...new Set([
            ...(this.data?.approved || []).flatMap((a) => a.fileTypes || []),
            ...(this.fileTypes || []),
        ])].sort();
        return html`
            <h4>${t('caseSettings.builtinForTypes')}</h4>
            ${this._builtinTypeDefaults().length ? html`<ul class="list">${this._builtinTypeDefaults().map(([ext, key]) => html`
                <li class="item">
                    <span class="grow">${t('caseSettings.opensIn', { type: formatFileExtension(ext), viewer: this._builtinName(key) })}</span>
                    <button class="quiet-button" type="button" ?disabled=${this.busy}
                        aria-label=${t('common.removeItem', { item: formatFileExtension(ext) })}
                        @click=${() => this._saveDefaults({ [ext]: '' })}>${t('common.remove')}</button>
                </li>`)}</ul>` : ''}
            <form class="row" @submit=${(e) => { e.preventDefault(); this._addBuiltinDefault(); }}>
                <input class="type-input" type="text" list="type-suggestions" .value=${this.builtinType}
                    placeholder=".mrb" aria-label=${t('caseSettings.fileType')}
                    @input=${(e) => { this.builtinType = e.target.value; }} />
                <datalist id="type-suggestions">
                    ${suggestions.map((ext) => html`<option value=${formatFileExtension(ext)}></option>`)}
                </datalist>
                <label for="builtin-viewer" class="muted">${t('caseSettings.opensInLabel')}</label>
                <select id="builtin-viewer" .value=${this.builtinViewer} @change=${(e) => { this.builtinViewer = e.target.value; }}>
                    ${BUILTIN_WORKFLOWS.map((b) => html`<option value=${b.key} ?selected=${this.builtinViewer === b.key}>${t(b.nameKey)}</option>`)}
                </select>
                <button class="secondary-button" type="submit" ?disabled=${this.busy || !this.builtinType.trim()}>${t('workflows.add')}</button>
            </form>
        `;
    }

    _renderDefaults() {
        const approved = this.data?.approved || [];
        const noDefaults = approved.length && !Object.keys(this._defaults).length;
        return html`
            ${noDefaults ? html`<span class="hint">${t('caseSettings.noDefaultsHint')}</span>` : ''}
            <h4>${t('caseSettings.otherDefaults')}</h4>
            <span class="muted">${t('caseSettings.defaultsHint')}</span>
            <div class="defaults">
                ${this._defaultSelect(OTHER, t('caseSettings.otherFiles'))}
                ${this._defaultSelect(BLANK, t('caseSettings.blankViewer'))}
            </div>
            ${this._renderBuiltinTypeDefaults()}
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
