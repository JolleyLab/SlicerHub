import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { listPageStyles } from '../styles/listPage.js';
import { VIEWER_NAME_KEY, viewerKey } from '../utils/openWith.js';
import './app-dialog.js';

/**
 * Choosing what files open with by default, for everyone: before an upload (a dropdown per file)
 * or later for one file. ask({ title, hint, action, rows, caseDefault }) resolves to the chosen key
 * per row, or null if it was closed without choosing (Cancel, ×, Escape or a click outside).
 * `rows`: [{ name, usable, selectedKey }] (usable from uploadChoices in utils/openWith.js);
 * `caseDefault`: if given, the label of a first option, '' (go back to the case default).
 */
export class DefaultToolkitDialog extends LitElement {
    static get properties() {
        return { request: { state: true } };
    }

    static get styles() {
        return [buttonStyles, listPageStyles, css`
            .rows { display: grid; gap: 12px; max-height: min(55vh, 460px); overflow-y: auto; }
            .row .form-label { word-break: break-word; }
            .row .form-input { width: 100%; }
        `];
    }

    constructor() {
        super();
        this.request = { title: '', hint: '', action: '', rows: [], caseDefault: null };
        this._resolve = null;
    }

    get _dialog() {
        return this.renderRoot?.querySelector('app-dialog');
    }

    async ask({ title, hint, action, rows, caseDefault = null }) {
        this._finish(null); // an earlier ask() still waiting resolves as cancelled, so its caller isn't left hanging
        this.request = { title, hint, action, caseDefault, rows: rows.map((row) => ({ ...row })) };
        await this.updateComplete;
        this._dialog?.openDialog();
        // Start on the first choice, not ×: Enter on a first focus shouldn't cancel.
        this.renderRoot.querySelector('select')?.focus();
        return new Promise((resolve) => { this._resolve = resolve; });
    }

    _finish(keys) {
        const resolve = this._resolve;
        this._resolve = null;
        resolve?.(keys);
    }

    _confirm() {
        this._finish(this.request.rows.map((row) => row.selectedKey)); // before closing, so dialog-closed doesn't cancel it
        this._dialog?.closeDialog();
    }

    _options({ usable }) {
        const viewerName = (viewer) => t(VIEWER_NAME_KEY[viewer]);
        return [
            ...(this.request.caseDefault != null ? [{ key: '', label: this.request.caseDefault }] : []),
            ...usable.viewers.map((v) => ({ key: viewerKey(v), label: t('viewers.plainViewer', { viewer: viewerName(v) }) })),
            ...usable.caseWorkflows.map((e) => ({ key: e.key, label: `${e.name} · ${viewerName(e.viewer)}` })),
        ];
    }

    render() {
        const { title, hint, action, rows } = this.request;
        return html`
            <app-dialog .title=${title} .message=${hint} @dialog-closed=${() => this._finish(null)}>
                <div class="rows">
                    ${rows.map((row, i) => html`
                        <div class="row">
                            <label class="form-label" for="default-toolkit-${i}">${row.name}</label>
                            <select id="default-toolkit-${i}" class="form-input" .value=${row.selectedKey}
                                @change=${(e) => { row.selectedKey = e.target.value; }}>
                                ${this._options(row).map((o) => html`<option value=${o.key} ?selected=${o.key === row.selectedKey}>${o.label}</option>`)}
                            </select>
                        </div>`)}
                </div>
                <button slot="actions" class="secondary-button" type="button" @click=${() => this._dialog?.closeDialog()}>${t('common.cancel')}</button>
                <button slot="actions" class="primary-button" type="button" @click=${() => this._confirm()}>${action}</button>
            </app-dialog>
        `;
    }
}

customElements.define('default-toolkit-dialog', DefaultToolkitDialog);
