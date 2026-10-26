import { LitElement, html } from 'lit-element';
import { uploadTrayStyles } from './upload-tray.styles.js';
import { buttonStyles } from '../styles/buttons.js';
import { utilStyles } from '../styles/utils.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import './app-dialog.js';
import { uploadManager, UPLOAD_STATUS } from '../services/uploadManager.js';
import { friendlyError } from '../services/cases.js';
import { formatBytes } from '../utils/formatBytes.js';

function formatEta(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '';
    if (seconds < 60) return t('uploads.secondsLeft', { n: Math.max(1, Math.round(seconds)) });
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return t('uploads.minutesLeft', { n: minutes, s: Math.round(seconds % 60) });
    return t('uploads.hoursLeft', { h: Math.floor(minutes / 60), m: minutes % 60 });
}

const CANCELABLE = new Set([
    UPLOAD_STATUS.QUEUED,
    UPLOAD_STATUS.UPLOADING,
    UPLOAD_STATUS.AWAITING_DETAILS
]);
const DISMISSABLE = new Set([UPLOAD_STATUS.DONE, UPLOAD_STATUS.ERROR, UPLOAD_STATUS.CANCELED]);

/**
 * App-wide upload progress panel and "add details" prompt for background uploads.
 * Mounted once in the app shell; all state lives in the uploadManager singleton.
 */
export class UploadTray extends LitElement {
    static get styles() {
        return [buttonStyles, utilStyles, uploadTrayStyles];
    }

    static get properties() {
        return {
            jobs: { type: Array },
            collapsed: { type: Boolean },
            detailsJobIds: { type: Array },
            announcement: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.jobs = uploadManager.list();
        this.collapsed = false;
        this.detailsJobIds = [];
        this.announcement = '';
        this._closeBound = false;
        this._statuses = new Map(this.jobs.map((job) => [job.id, job.status]));
        this._onChange = () => {
            const jobs = uploadManager.list();
            this.announceTransitions(jobs);
            this.jobs = jobs;
        };
        this._onDetailsRequested = (event) => this.openDetails(event.detail.jobIds);
    }

    connectedCallback() {
        super.connectedCallback();
        uploadManager.addEventListener('change', this._onChange);
        uploadManager.addEventListener('details-requested', this._onDetailsRequested);
        this.jobs = uploadManager.list();
    }

    disconnectedCallback() {
        uploadManager.removeEventListener('change', this._onChange);
        uploadManager.removeEventListener('details-requested', this._onDetailsRequested);
        super.disconnectedCallback();
    }

    /** Screen-reader users are told about the moments they would otherwise miss (not every progress tick). */
    announceTransitions(jobs) {
        for (const job of jobs) {
            if (this._statuses.get(job.id) !== job.status) {
                const message = this.announcementFor(job);
                if (message) this.announcement = message;
            }
            this._statuses.set(job.id, job.status);
        }
        const current = new Set(jobs.map((job) => job.id));
        for (const id of [...this._statuses.keys()]) {
            if (!current.has(id)) this._statuses.delete(id);
        }
    }

    announcementFor(job) {
        switch (job.status) {
            case UPLOAD_STATUS.DONE:
                return t('uploads.announceDone', { name: job.name, case: job.caseTitle || t('cases.untitledCase') });
            case UPLOAD_STATUS.ERROR:
                return t('uploads.announceFailed', { name: job.name });
            case UPLOAD_STATUS.AWAITING_DETAILS:
                return t('uploads.announceNeedsDetails', { name: job.name });
            default:
                return '';
        }
    }

    /** Run a per-job action, then put keyboard focus somewhere sensible: the row's next button, else the header. */
    async runJobAction(jobId, action) {
        action();
        await this.updateComplete;
        const row = this.renderRoot.querySelector(`li[data-job-id="${jobId}"]`);
        (row?.querySelector('button') || this.renderRoot.querySelector('.tray-header'))?.focus();
    }

    async clearFinished() {
        uploadManager.dismissFinished();
        await this.updateComplete;
        this.renderRoot.querySelector('.tray-header')?.focus();
    }

    get detailsDialog() {
        return this.renderRoot?.querySelector('#upload-details-dialog');
    }

    async openDetails(jobIds) {
        this.detailsJobIds = [...new Set([...this.detailsJobIds, ...jobIds])];
        await this.updateComplete;
        const dialog = this.detailsDialog;
        if (!dialog) return;
        await dialog.updateComplete;
        if (!this._closeBound && dialog.nativeDialog) {
            // Closing by any route (Skip, X, Escape, outside click) means "use the defaults".
            dialog.nativeDialog.addEventListener('close', () => this.finishDetails(false));
            this._closeBound = true;
        }
        dialog.openDialog();
    }

    /** Apply the typed names (when submitted) and let the pending uploads attach. */
    finishDetails(submit) {
        const ids = this.detailsJobIds;
        if (ids.length === 0) return;
        if (submit) {
            for (const input of this.renderRoot.querySelectorAll('.name-input')) {
                uploadManager.updateDetails(Number(input.dataset.jobId), { name: input.value });
            }
        }
        this.detailsJobIds = [];
        uploadManager.resolveDetails(ids);
    }

    submitDetails() {
        this.finishDetails(true);
        this.detailsDialog?.closeDialog();
    }

    skipDetails() {
        this.detailsDialog?.closeDialog();
    }

    jobStatusText(job) {
        switch (job.status) {
            case UPLOAD_STATUS.QUEUED:
                return t('uploads.queued');
            case UPLOAD_STATUS.UPLOADING:
                return `${Math.round(job.progress * 100)}% · ${formatBytes(job.sent)} / ${formatBytes(job.size)}`;
            case UPLOAD_STATUS.AWAITING_DETAILS:
                return t('uploads.waitingForDetails');
            case UPLOAD_STATUS.ATTACHING:
                return t('uploads.attaching');
            case UPLOAD_STATUS.DONE:
                return t('uploads.addedToCase', { case: job.caseTitle || t('cases.untitledCase') });
            case UPLOAD_STATUS.CANCELED:
                return t('uploads.canceled');
            case UPLOAD_STATUS.ERROR:
                return friendlyError(
                    job.error?.message,
                    t('uploads.failed'),
                    job.error?.status,
                    job.error?.code
                );
            default:
                return '';
        }
    }

    renderJob(job) {
        const showBar = job.status === UPLOAD_STATUS.UPLOADING
            || job.status === UPLOAD_STATUS.AWAITING_DETAILS
            || job.status === UPLOAD_STATUS.ATTACHING;
        const rateText = job.status === UPLOAD_STATUS.UPLOADING && job.rate > 0
            ? [`${formatBytes(job.rate)}/s`, formatEta(job.eta)].filter(Boolean).join(' · ')
            : '';
        return html`
            <li class="job" data-job-id=${job.id}>
                <div class="job-head">
                    <span class="job-name" title=${job.name}>${job.name}</span>
                </div>
                ${job.caseTitle ? html`<span class="job-case">${job.caseTitle}</span>` : ''}
                ${showBar ? html`
                    <progress max="1" .value=${job.progress} aria-label=${job.name}></progress>
                ` : ''}
                <span class="job-status ${job.status === UPLOAD_STATUS.ERROR ? 'is-error' : ''}">
                    ${this.jobStatusText(job)}
                </span>
                ${rateText ? html`<span class="job-rate">${rateText}</span>` : ''}
                <div class="job-actions">
                    ${job.status === UPLOAD_STATUS.AWAITING_DETAILS ? html`
                        <button
                            class="text-button"
                            type="button"
                            aria-label=${t('uploads.addDetailsNamed', { name: job.name })}
                            @click=${() => this.openDetails([job.id])}
                        >${t('uploads.addDetails')}</button>
                    ` : ''}
                    ${job.status === UPLOAD_STATUS.ERROR ? html`
                        <button
                            class="text-button"
                            type="button"
                            aria-label=${t('uploads.retryNamed', { name: job.name })}
                            @click=${() => this.runJobAction(job.id, () => uploadManager.retry(job.id))}
                        >${t('uploads.retry')}</button>
                    ` : ''}
                    ${CANCELABLE.has(job.status) ? html`
                        <button
                            class="text-button"
                            type="button"
                            aria-label=${t('uploads.cancelNamed', { name: job.name })}
                            @click=${() => this.runJobAction(job.id, () => uploadManager.cancel(job.id))}
                        >${t('common.cancel')}</button>
                    ` : ''}
                    ${DISMISSABLE.has(job.status) ? html`
                        <button
                            class="text-button"
                            type="button"
                            aria-label=${t('uploads.dismissNamed', { name: job.name })}
                            @click=${() => this.runJobAction(job.id, () => uploadManager.dismiss(job.id))}
                        >${t('uploads.dismiss')}</button>
                    ` : ''}
                </div>
            </li>
        `;
    }

    renderDetailsDialog() {
        const pending = this.jobs.filter((job) => this.detailsJobIds.includes(job.id));
        return html`
            <app-dialog
                id="upload-details-dialog"
                .title=${t('uploads.detailsTitle')}
                .lightDismiss=${true}
            >
                <p class="details-intro">${t('uploads.detailsIntro')}</p>
                ${pending.map((job) => html`
                    <div class="details-row">
                        <label for="upload-name-${job.id}">${t('uploads.nameLabel')}</label>
                        <input
                            id="upload-name-${job.id}"
                            class="name-input"
                            type="text"
                            maxlength="200"
                            data-job-id=${job.id}
                            aria-describedby="upload-file-${job.id}"
                            autocomplete="off"
                            .value=${job.name}
                            @keydown=${(e) => { if (e.key === 'Enter') this.submitDetails(); }}
                        />
                        <span class="details-file" id="upload-file-${job.id}">${job.fileName} · ${formatBytes(job.size)}</span>
                    </div>
                `)}
                <button slot="actions" class="secondary-button" type="button" @click=${() => this.skipDetails()}>
                    ${t('uploads.skip')}
                </button>
                <button slot="actions" class="primary-button" type="button" @click=${() => this.submitDetails()}>
                    ${t('uploads.continue')}
                </button>
            </app-dialog>
        `;
    }

    render() {
        const active = this.jobs.filter((job) => job.status !== UPLOAD_STATUS.DONE
            && job.status !== UPLOAD_STATUS.CANCELED && job.status !== UPLOAD_STATUS.ERROR).length;
        const hasFinished = this.jobs.some((job) => job.status === UPLOAD_STATUS.DONE || job.status === UPLOAD_STATUS.CANCELED);
        return html`
            <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">${this.announcement}</div>
            ${this.jobs.length > 0 ? html`
                <div class="tray ${this.collapsed ? 'collapsed' : ''}" role="region" aria-label=${t('uploads.title')}>
                    <button
                        class="tray-header"
                        type="button"
                        aria-expanded=${this.collapsed ? 'false' : 'true'}
                        @click=${() => { this.collapsed = !this.collapsed; }}
                    >
                        <span>
                            ${active > 0
                    ? t('uploads.titleActive', { count: active })
                    : t('uploads.title')}
                        </span>
                        <span class="chevron" aria-hidden="true">▾</span>
                    </button>
                    ${this.collapsed ? '' : html`
                        <div class="tray-body">
                            <ul class="jobs" role="list">${this.jobs.map((job) => this.renderJob(job))}</ul>
                            ${hasFinished ? html`
                                <div class="tray-footer">
                                    <button class="text-button" type="button" @click=${() => this.clearFinished()}>
                                        ${t('uploads.clearFinished')}
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    `}
                </div>
            ` : ''}
            ${this.renderDetailsDialog()}
        `;
    }
}

customElements.define('upload-tray', UploadTray);
