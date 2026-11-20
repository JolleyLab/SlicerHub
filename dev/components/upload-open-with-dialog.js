import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { listPageStyles } from '../styles/listPage.js';
import { VIEWER_NAME_KEY, viewerKey } from '../utils/openWith.js';
import './app-dialog.js';

/**
 * "Choose the default toolkit": asked before an upload, one dropdown per file (`rows` from
 * uploadChoices in utils/openWith.js, plus each file's name). ask(rows) resolves to the chosen key
 * per row, or null if it was closed without uploading (Cancel, ×, Escape or a click outside).
 */
export class UploadOpenWithDialog extends LitElement {
    static get properties() {
        return { rows: { state: true } };
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
        this.rows = [];
        this._resolve = null;
    }

    get _dialog() {
        return this.renderRoot?.querySelector('app-dialog');
    }

    /** Ask about these files: [{ name, usable, selectedKey }]. */
    async ask(rows) {
        this._finish(null); // an earlier ask() still waiting resolves as cancelled, so its caller isn't left hanging
        this.rows = rows.map((row) => ({ ...row }));
        await this.updateComplete;
        this._dialog?.openDialog();
        // Start on the first choice, not ×: Enter on a first focus shouldn't cancel the upload.
        this.renderRoot.querySelector('select')?.focus();
        return new Promise((resolve) => { this._resolve = resolve; });
    }

    _finish(keys) {
        const resolve = this._resolve;
        this._resolve = null;
        resolve?.(keys);
    }

    _upload() {
        const keys = this.rows.map((row) => row.selectedKey);
        this._finish(keys); // before closing, so dialog-closed doesn't count it as cancelled
        this._dialog?.closeDialog();
    }

    _options({ usable }) {
        const viewerName = (viewer) => t(VIEWER_NAME_KEY[viewer]);
        return [
            ...usable.viewers.map((v) => ({ key: viewerKey(v), label: t('viewers.plainViewer', { viewer: viewerName(v) }) })),
            ...usable.caseWorkflows.map((e) => ({ key: e.key, label: `${e.name} · ${viewerName(e.viewer)}` })),
        ];
    }

    render() {
        const title = this.rows.length > 1 ? t('viewers.uploadTitleMany') : t('viewers.uploadTitle');
        return html`
            <app-dialog .title=${title} .message=${t('viewers.uploadHint')} @dialog-closed=${() => this._finish(null)}>
                <div class="rows">
                    ${this.rows.map((row, i) => html`
                        <div class="row">
                            <label class="form-label" for="upload-open-with-${i}">${row.name}</label>
                            <select id="upload-open-with-${i}" class="form-input" .value=${row.selectedKey}
                                @change=${(e) => { row.selectedKey = e.target.value; }}>
                                ${this._options(row).map((o) => html`<option value=${o.key} ?selected=${o.key === row.selectedKey}>${o.label}</option>`)}
                            </select>
                        </div>`)}
                </div>
                <button slot="actions" class="secondary-button" type="button" @click=${() => this._dialog?.closeDialog()}>${t('common.cancel')}</button>
                <button slot="actions" class="primary-button" type="button" @click=${() => this._upload()}>${t('viewers.uploadAction')}</button>
            </app-dialog>
        `;
    }
}

customElements.define('upload-open-with-dialog', UploadOpenWithDialog);
