/**
 * Background upload manager (module singleton).
 *
 * Owns file uploads outside any page component, so the user can keep working, or move to another
 * view, while large files upload. Each job has two phases: send the bytes (resumable, chunked), then
 * attach the uploaded file to its case. The attach step waits until the upload has finished AND the
 * user has confirmed or skipped the "details" prompt, so filling in details can overlap the upload.
 *
 * Events (this is an EventTarget):
 *   change             any job changed (progress events are throttled)
 *   details-requested  { batchId, jobIds } new jobs whose details the UI should ask for
 *   attached           { caseId, attachment, job } a job finished and its attachment exists
 */
import { uploadFileResumable, attachUploadedFile } from './directus.js';

export const UPLOAD_STATUS = Object.freeze({
    QUEUED: 'queued',
    UPLOADING: 'uploading',
    AWAITING_DETAILS: 'awaiting-details',
    ATTACHING: 'attaching',
    DONE: 'done',
    ERROR: 'error',
    CANCELED: 'canceled'
});

const ACTIVE_STATUSES = new Set([
    UPLOAD_STATUS.QUEUED,
    UPLOAD_STATUS.UPLOADING,
    UPLOAD_STATUS.AWAITING_DETAILS,
    UPLOAD_STATUS.ATTACHING
]);

const PROGRESS_EMIT_MS = 200;
const RATE_SAMPLE_MS = 500;
const RATE_SMOOTHING = 0.6;

let nextJobId = 1;
let nextBatchId = 1;

export class UploadManager extends EventTarget {
    constructor({
        upload = uploadFileResumable,
        attach = attachUploadedFile,
        now = () => Date.now()
    } = {}) {
        super();
        this._upload = upload;
        this._attach = attach;
        this._now = now;
        this._jobs = [];
        this._running = false;
        this._lastProgressEmit = 0;
    }

    /** Copies of all jobs (safe to hand to UI state). */
    list() {
        return this._jobs.map((job) => this._snapshot(job));
    }

    hasActive() {
        return this._jobs.some((job) => ACTIVE_STATUSES.has(job.status));
    }

    /** Aggregate for one case, for inline progress: { count, progress, names, awaitingDetails }. */
    summary(caseId) {
        const jobs = this._jobs.filter((job) => job.caseId === caseId && ACTIVE_STATUSES.has(job.status));
        const total = jobs.reduce((sum, job) => sum + job.size, 0);
        const sent = jobs.reduce((sum, job) => sum + job.sent, 0);
        return {
            count: jobs.length,
            progress: total > 0 ? Math.min(1, sent / total) : 0,
            names: jobs.map((job) => job.name),
            awaitingDetails: jobs.some((job) => job.status === UPLOAD_STATUS.AWAITING_DETAILS)
        };
    }

    /** Queue files for upload to a case. Uploading starts immediately; details are asked for separately. */
    enqueue({ caseId, caseTitle = '', files }) {
        const batchId = nextBatchId++;
        const added = [];
        for (const file of files) {
            const job = {
                id: nextJobId++,
                batchId,
                caseId,
                caseTitle,
                fileName: file.name,
                name: file.name,
                size: file.size,
                type: file.type || '',
                status: UPLOAD_STATUS.QUEUED,
                sent: 0,
                progress: 0,
                rate: 0,
                eta: null,
                error: null,
                errorStage: null,
                upload: null,
                attachment: null,
                detailsResolved: false,
                _file: file,
                _abort: null,
                _sample: null
            };
            this._jobs.push(job);
            added.push(job);
        }
        this._emit('change');
        this._emit('details-requested', { batchId, jobIds: added.map((job) => job.id) });
        this._pump();
        return added.map((job) => this._snapshot(job));
    }

    /** Set the details for a job; the UI calls this before resolveDetails. */
    updateDetails(jobId, { name } = {}) {
        const job = this._find(jobId);
        if (!job) return;
        const trimmed = String(name ?? '').trim();
        if (trimmed) job.name = trimmed;
        this._emit('change');
    }

    /** The user confirmed or skipped the details prompt: jobs may attach as soon as their upload is done. */
    resolveDetails(jobIds) {
        for (const id of jobIds) {
            const job = this._find(id);
            if (!job || job.detailsResolved) continue;
            job.detailsResolved = true;
            if (job.status === UPLOAD_STATUS.AWAITING_DETAILS) this._attachJob(job);
        }
        this._emit('change');
    }

    cancel(jobId) {
        const job = this._find(jobId);
        if (!job) return;
        if (job.status === UPLOAD_STATUS.ATTACHING || !ACTIVE_STATUSES.has(job.status)) return;
        job.status = UPLOAD_STATUS.CANCELED;
        job._abort?.abort();
        this._emit('change');
    }

    cancelAll() {
        for (const job of this._jobs) this.cancel(job.id);
    }

    /** Retry a failed job: re-attach if the bytes already made it, otherwise upload again. */
    retry(jobId) {
        const job = this._find(jobId);
        if (!job || job.status !== UPLOAD_STATUS.ERROR) return;
        job.error = null;
        job.detailsResolved = true;
        if (job.upload) {
            this._attachJob(job);
        } else {
            job.status = UPLOAD_STATUS.QUEUED;
            job.sent = 0;
            job.progress = 0;
            job._sample = null;
            this._emit('change');
            this._pump();
        }
    }

    /**
     * Remove every finished or canceled job. Failed ones stay, because they offer a retry. Finished
     * jobs are never removed on a timer: a message that disappears by itself is a time limit for
     * people who read or navigate slowly.
     */
    dismissFinished() {
        this._jobs = this._jobs.filter((job) => job.status !== UPLOAD_STATUS.DONE && job.status !== UPLOAD_STATUS.CANCELED);
        this._emit('change');
    }

    /** Remove a finished, failed or canceled job from the list. */
    dismiss(jobId) {
        const job = this._find(jobId);
        if (!job || ACTIVE_STATUSES.has(job.status)) return;
        this._jobs = this._jobs.filter((j) => j.id !== jobId);
        this._emit('change');
    }

    // ── internals ──────────────────────────────────────────────────────────

    _find(jobId) {
        return this._jobs.find((job) => job.id === jobId);
    }

    _snapshot(job) {
        const { _file, _abort, _sample, ...rest } = job;
        return rest;
    }

    _emit(type, detail) {
        this.dispatchEvent(new CustomEvent(type, { detail }));
    }

    /** One upload at a time: parallel uploads would only split the same uplink. */
    async _pump() {
        if (this._running) return;
        this._running = true;
        try {
            let job;
            while ((job = this._jobs.find((j) => j.status === UPLOAD_STATUS.QUEUED))) {
                await this._uploadJob(job);
            }
        } finally {
            this._running = false;
        }
    }

    async _uploadJob(job) {
        job.status = UPLOAD_STATUS.UPLOADING;
        job._abort = new AbortController();
        job._sample = null;
        this._emit('change');
        try {
            job.upload = await this._upload(job._file, {
                signal: job._abort.signal,
                onProgress: (sent, total) => this._onProgress(job, sent, total)
            });
        } catch (err) {
            if (job.status === UPLOAD_STATUS.CANCELED) return;
            job.status = UPLOAD_STATUS.ERROR;
            job.errorStage = 'upload';
            job.error = err;
            this._emit('change');
            return;
        }
        if (job.status === UPLOAD_STATUS.CANCELED) return;
        job.sent = job.size;
        job.progress = 1;
        job.eta = 0;
        if (job.detailsResolved) {
            this._attachJob(job); // not awaited: the next upload can start meanwhile
        } else {
            job.status = UPLOAD_STATUS.AWAITING_DETAILS;
            this._emit('change');
        }
    }

    async _attachJob(job) {
        job.status = UPLOAD_STATUS.ATTACHING;
        this._emit('change');
        try {
            job.attachment = await this._attach(job.caseId, {
                uploadToken: job.upload.uploadToken,
                name: job.name,
                type: job.type,
                size: job.size
            });
        } catch (err) {
            job.status = UPLOAD_STATUS.ERROR;
            job.errorStage = 'attach';
            job.error = err;
            this._emit('change');
            return;
        }
        job.status = UPLOAD_STATUS.DONE;
        this._emit('attached', {
            caseId: job.caseId,
            attachment: job.attachment,
            job: this._snapshot(job)
        });
        this._emit('change');
    }

    _onProgress(job, sent, total) {
        const now = this._now();
        job.sent = sent;
        job.progress = total > 0 ? sent / total : 0;
        if (!job._sample) {
            job._sample = { t: now, sent };
        } else if (now - job._sample.t >= RATE_SAMPLE_MS) {
            const instant = (sent - job._sample.sent) / ((now - job._sample.t) / 1000);
            job.rate = job.rate ? RATE_SMOOTHING * job.rate + (1 - RATE_SMOOTHING) * instant : instant;
            job._sample = { t: now, sent };
        }
        job.eta = job.rate > 0 ? (total - sent) / job.rate : null;
        // Progress events arrive many times a second; keep the UI from re-rendering on each.
        if (now - this._lastProgressEmit >= PROGRESS_EMIT_MS) {
            this._lastProgressEmit = now;
            this._emit('change');
        }
    }
}

export const uploadManager = new UploadManager();

// Closing the tab would lose in-flight uploads; ask the browser to confirm.
if (typeof window !== 'undefined') {
    window.addEventListener('beforeunload', (event) => {
        if (uploadManager.hasActive()) {
            event.preventDefault();
            event.returnValue = '';
        }
    });
}
