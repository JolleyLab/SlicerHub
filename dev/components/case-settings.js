import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { workflowStyles } from '../styles/workflows.js';
import { listPageStyles } from '../styles/listPage.js';
import './toggle-switch.js';
import { updateCaseWorkflowSettings } from '../services/workflows.js';

/**
 * Case Settings, for case admins (docs/workflows-design.md › Case Settings): its header
 * ("← Back to case", title, the case's name), the case's default workflow, and whether members
 * may use their own. Adding, removing and requests are in the case's Workflows panel. `data` is
 * the case page's GET /api/cases/:id/workflows.
 * Emits `back`, `workflows-changed` after a change, and `open-workflows` for the panel.
 */
export class CaseSettings extends LitElement {
    static get properties() {
        return {
            caseId: { type: String },
            caseTitle: { type: String },
            data: { attribute: false },
            busy: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [listPageStyles, buttonStyles, workflowStyles, css`
            :host { max-width: 760px; }
            section { display: flex; flex-direction: column; gap: 10px; margin-bottom: 28px; }
            h3 { margin: 0; font-size: 1rem; }
            h4 { margin: 8px 0 0; font-size: 0.9rem; }
            .default-select { max-width: 320px; }
            .hint { padding: 8px 10px; border-radius: var(--radius-sm, 6px); background: color-mix(in srgb, var(--color-primary) 8%, transparent); }
            .link { background: none; border: 0; padding: 0; font: inherit; color: var(--color-focus); cursor: pointer; text-decoration: underline; }
        `];
    }

    constructor() {
        super();
        this.caseId = '';
        this.caseTitle = '';
        this.data = null;
        this.busy = false;
        this.error = '';
    }

    _emit(type) {
        this.dispatchEvent(new CustomEvent(type, { bubbles: true, composed: true }));
    }

    async _save(settings) {
        this.busy = true;
        this.error = '';
        try {
            await updateCaseWorkflowSettings(this.caseId, settings);
            this._emit('workflows-changed');
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
        } finally {
            this.busy = false;
        }
    }

    render() {
        return html`
            <div class="detail-toolbar">
                <button class="back-link" type="button" @click=${() => this._emit('back')}>${t('caseSettings.backToCase')}</button>
            </div>
            <div class="detail-header">
                <h2 class="detail-title">${t('caseSettings.title')}</h2>
                <p class="detail-desc">${this.caseTitle || t('cases.untitledCase')}</p>
            </div>
            ${this.data ? this._renderWorkflows() : html`<span class="muted">${t('common.loading')}</span>`}
        `;
    }

    _renderWorkflows() {
        const approved = this.data.approved || [];
        const value = this.data.defaultWorkflow || '';
        return html`
            <section aria-labelledby="workflows-heading">
                <h3 id="workflows-heading">${t('workflows.title')}</h3>
                ${this.error ? html`<span class="error" role="alert">${this.error}</span>` : ''}
                <span class="muted">
                    ${t('caseSettings.manageHint')}
                    <button class="link" type="button" @click=${() => this._emit('open-workflows')}>${t('caseSettings.manageLink')}</button>
                </span>

                <h4><label for="default-workflow">${t('caseSettings.defaultWorkflow')}</label></h4>
                <span class="muted">${t('caseSettings.defaultWorkflowHint')}</span>
                ${approved.length && !value ? html`<span class="hint">${t('caseSettings.noDefaultHint')}</span>` : ''}
                <select id="default-workflow" class="default-select" .value=${value} ?disabled=${this.busy}
                    @change=${(e) => this._save({ defaultWorkflow: e.target.value })}>
                    <option value="" ?selected=${!value}>${t('caseSettings.noWorkflow')}</option>
                    ${approved.map((a) => html`<option value=${String(a.id)} ?selected=${value === String(a.id)}>${a.name}</option>`)}
                </select>

                <h4>${t('caseSettings.personalWorkflows')}</h4>
                <toggle-switch
                    .checked=${this.data.allowPersonal !== false}
                    .trueLabel=${t('caseSettings.allowPersonal')}
                    .falseLabel=${t('caseSettings.allowPersonal')}
                    aria-label=${t('caseSettings.allowPersonal')}
                    @toggle-change=${(e) => this._save({ allowPersonal: e.detail.checked })}
                ></toggle-switch>
                <span class="muted">${t('caseSettings.allowPersonalHint')}</span>
            </section>
        `;
    }
}

customElements.define('case-settings', CaseSettings);
