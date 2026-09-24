import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import './app-dialog.js';
import { uploadManager, UPLOAD_STATUS } from '../services/uploadManager.js';
import { friendlyCasesError } from '../services/directus.js';
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
        return css`
            :host {
                position: fixed;
                right: 16px;
                bottom: 16px;
                z-index: 9000;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .tray {
                width: min(360px, calc(100vw - 32px));
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg, 10px);
                background: var(--color-panel, var(--color-surface, #fff));
                color: var(--color-text-primary);
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
                overflow: hidden;
            }

            .tray-header {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                padding: 10px 12px;
                border: 0;
                width: 100%;
                background: transparent;
                color: inherit;
                font: inherit;
                font-weight: 700;
                font-size: 0.9rem;
                cursor: pointer;
                text-align: left;
            }

            .tray-header:focus-visible,
            .icon-button:focus-visible,
            .text-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
            }

            .chevron {
                transition: transform 0.15s ease;
            }

            .collapsed .chevron {
                transform: rotate(180deg);
            }

            .tray-body {
                max-height: min(50vh, 360px);
                overflow-y: auto;
                border-top: 1px solid var(--color-border);
            }

            .jobs {
                list-style: none;
                margin: 0;
                padding: 0;
            }

            .tray-footer {
                padding: 8px 12px;
                border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
            }

            /* Read by screen readers only (announcements of finished, failed and waiting uploads). */
            .visually-hidden {
                position: absolute;
                width: 1px;
                height: 1px;
                margin: -1px;
                padding: 0;
                overflow: hidden;
                clip: rect(0 0 0 0);
                white-space: nowrap;
                border: 0;
            }

            .job {
                display: flex;
                flex-direction: column;
                gap: 4px;
                padding: 10px 12px;
            }

            .job + .job {
                border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
            }

            .job-head {
                display: flex;
                align-items: baseline;
                justify-content: space-between;
                gap: 8px;
            }

            .job-name {
                font-size: 0.85rem;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                min-width: 0;
            }

            .job-case,
            .job-status,
            .job-rate {
                font-size: 0.78rem;
                color: var(--color-text-secondary);
            }

            .job-case {
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .job-status.is-error {
                color: var(--color-status-error-fg, #c62828);
            }

            progress {
                width: 100%;
                height: 6px;
                /* focus is the theme's on-panel blue: readable in both light and dark */
                accent-color: var(--color-focus, var(--color-primary));
            }

            .job-actions {
                display: flex;
                gap: 12px;
                margin-top: 2px;
            }

            .text-button {
                border: 0;
                padding: 0;
                background: transparent;
                color: var(--color-focus, var(--color-primary));
                font: inherit;
                font-size: 0.78rem;
                font-weight: 600;
                cursor: pointer;
            }

            .text-button:hover {
                text-decoration: underline;
            }

            .details-intro {
                margin: 0 0 14px;
                font-size: 0.875rem;
                color: var(--color-text-secondary);
            }

            .details-row {
                display: flex;
                flex-direction: column;
                gap: 4px;
                margin-bottom: 12px;
            }

            .details-row label {
                font-size: 0.8rem;
                font-weight: 600;
            }

            .details-row input {
                border: 1px solid var(--color-border);
                border-radius: 6px;
                padding: 8px 10px;
                font: inherit;
                font-size: 0.9rem;
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
            }

            .details-file {
                font-size: 0.75rem;
                color: var(--color-text-secondary);
            }

            .primary-button,
            .secondary-button {
                border-radius: 6px;
                padding: 8px 16px;
                font: inherit;
                font-size: 0.875rem;
                font-weight: 600;
                cursor: pointer;
            }

            .primary-button {
                border: 1px solid transparent;
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .primary-button:focus-visible,
            .secondary-button:focus-visible,
            .details-row input:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .secondary-button {
                border: 1px solid var(--color-border);
                background: transparent;
                color: var(--color-text-primary);
            }
        `;
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
                return friendlyCasesError(
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
