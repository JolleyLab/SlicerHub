import { LitElement, html, css } from 'lit-element';
import './components/page-layout-template.js';
import './components/page-content-message.js';
import './components/file-list-row.js';
import './components/comments-panel.js';
import {
    listDirectusCases,
    openDirectusAttachmentFullSlicer,
    createDirectusCaseComment
} from './services/directus.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    defaultReleaseModeForClose,
    getViewerSessionEndpoints,
    buildViewerStopBody,
    buildSlicerGuiLoaderUrl
} from './utils/viewerLaunch.js';
import { sendTrameContainerHeartbeat } from './utils/trameHeartbeat.js';
import { stopViewerSession } from './utils/viewerSessionLifecycle.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity
} from './utils/viewerActivity.js';

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * PoC Cases UI styled like My Projects / Project Review.
 * Landing = case cards; detail = attachments file list (no collaborators/GPU).
 */
export class DirectusCasesPage extends LitElement {
    static get styles() {
        return css`
            .status-note {
                margin-top: 14px;
                color: var(--color-text-secondary);
            }

            .case-detail {
                display: flex;
                flex-direction: column;
                gap: 16px;
                margin-top: 4px;
            }

            .case-summary {
                display: flex;
                flex-wrap: wrap;
                align-items: flex-start;
                justify-content: space-between;
                gap: 12px 16px;
                padding: 14px 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background:
                    linear-gradient(
                        135deg,
                        color-mix(in srgb, var(--color-primary) 92%, #1a2a6e),
                        color-mix(in srgb, var(--color-secondary) 70%, #2a3a9a)
                    );
                color: var(--color-on-primary);
                box-shadow: 0 4px 14px color-mix(in srgb, var(--color-primary) 22%, transparent);
            }

            :host-context([data-theme='dark']) .case-summary {
                background:
                    linear-gradient(
                        135deg,
                        color-mix(in srgb, var(--color-primary) 88%, #0c1020),
                        color-mix(in srgb, var(--color-primary) 70%, #151c32)
                    );
                border-color: color-mix(in srgb, var(--color-border) 80%, var(--color-primary));
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.35);
                color: var(--color-on-primary);
            }

            :host-context([data-theme='dark']) .case-summary-description {
                color: var(--color-on-primary);
                opacity: 0.95;
            }

            .case-summary-main {
                display: flex;
                flex-direction: column;
                gap: 6px;
                min-width: 0;
                flex: 1;
            }

            .case-summary-label {
                font-size: 0.98rem;
                font-weight: 650;
                letter-spacing: 0.01em;
            }

            .case-summary-description {
                margin: 0;
                font-size: 0.98rem;
                line-height: 1.45;
                opacity: 0.92;
            }

            .case-summary .status-badge {
                align-self: flex-start;
                font-size: 0.78rem;
                font-weight: 650;
                color: var(--color-on-primary);
                border: 1px solid color-mix(in srgb, var(--color-on-primary) 35%, transparent);
                border-radius: var(--radius-md);
                padding: 4px 10px;
                background: color-mix(in srgb, #000 22%, transparent);
                text-transform: capitalize;
            }

            :host-context([data-theme='light']) .case-summary .status-badge {
                color: var(--color-text-primary);
                background: var(--color-accent);
                border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
            }

            .case-detail-grid {
                display: grid;
                grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
                gap: 16px;
                align-items: stretch;
            }

            .case-detail-grid comments-panel {
                --comments-panel-height: 100%;
                --comments-panel-max-height: none;
                min-height: 360px;
            }

            @media (max-width: 980px) {
                .case-detail-grid {
                    grid-template-columns: 1fr;
                }

                .case-detail-grid comments-panel {
                    --comments-panel-height: auto;
                    --comments-panel-max-height: 560px;
                }
            }

            .case-grid {
                margin-top: 16px;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 14px;
                padding: 2px;
            }

            .case-card {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                padding: 14px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                cursor: pointer;
                transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
                text-align: left;
                font: inherit;
                color: inherit;
                width: 100%;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
                appearance: none;
                -webkit-appearance: none;
            }

            .case-card:hover {
                box-shadow: 0 6px 14px var(--color-shadow, rgba(0, 0, 0, 0.12));
                transform: translateY(-1px);
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
            }

            .case-card:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                border-color: var(--color-focus, #0057c2);
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
                transform: translateY(-1px);
            }

            :host-context([data-theme='dark']) .case-card {
                background: var(--color-panel);
                border-color: var(--color-border);
                box-shadow: 0 3px 14px rgba(0, 0, 0, 0.32);
            }

            :host-context([data-theme='dark']) .case-card:hover {
                border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
                background: color-mix(in srgb, var(--color-primary) 8%, var(--color-panel));
                box-shadow: 0 6px 16px rgba(0, 0, 0, 0.38);
            }

            :host-context([data-theme='dark']) .case-card:focus-visible {
                outline: 3px solid var(--color-focus, #8fa3d4);
                outline-offset: 2px;
                border-color: var(--color-focus, #8fa3d4);
                box-shadow:
                    0 0 0 3px var(--color-focus, #8fa3d4),
                    0 6px 14px rgba(0, 0, 0, 0.32);
            }

            .case-name {
                color: var(--color-text-primary);
                font-weight: 600;
            }

            .case-meta {
                color: var(--color-text-secondary);
                font-size: 0.92rem;
            }

            .status-badge {
                align-self: flex-start;
                font-size: 0.78rem;
                color: var(--color-text-secondary);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                padding: 3px 8px;
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
                text-transform: capitalize;
            }

            :host-context([data-theme='dark']) .status-badge {
                color: var(--color-on-secondary);
                background: var(--color-secondary);
                border-color: color-mix(in srgb, var(--color-secondary) 70%, #fff);
                font-weight: 650;
            }

            .files-panel {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
                padding: 0;
                overflow: hidden;
                display: flex;
                flex-direction: column;
                min-height: 360px;
            }

            :host-context([data-theme='dark']) .files-panel {
                border-color: var(--color-border);
                box-shadow: 0 3px 14px rgba(0, 0, 0, 0.32);
            }

            .files-title {
                margin: 0;
                font-weight: 650;
                font-size: 0.98rem;
                color: var(--color-on-primary);
                padding: 12px 14px;
                background: var(--color-primary);
                letter-spacing: 0.01em;
            }

            :host-context([data-theme='dark']) .files-title {
                background: color-mix(in srgb, var(--color-primary) 82%, #0c1020);
                color: var(--color-on-primary);
                border-bottom: 1px solid color-mix(in srgb, var(--color-border) 70%, var(--color-primary));
            }

            .files-body {
                padding: 12px 14px 14px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                flex: 1;
            }

            .file-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .empty-note {
                color: var(--color-text-secondary);
                font-size: 0.95rem;
            }

            :host-context([data-theme='dark']) .empty-note,
            :host-context([data-theme='dark']) .status-note {
                color: var(--color-text-secondary);
            }

            :host-context([data-theme='dark']) .secondary-button {
                background: transparent;
                border-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .secondary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 12%, var(--color-panel));
                border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
            }

            :host-context([data-theme='dark']) .primary-button {
                background: var(--color-primary);
                color: var(--color-on-primary);
                border-color: color-mix(in srgb, var(--color-primary) 70%, var(--color-border));
            }

            :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, var(--color-secondary));
            }

            .section-actions {
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 2px 0;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                min-height: 40px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .secondary-button {
                background: var(--color-surface, transparent);
                color: var(--color-text-primary);
            }

            .secondary-button:hover:not(:disabled) {
                border-color: color-mix(in srgb, var(--color-primary) 40%, var(--color-border));
                background: color-mix(in srgb, var(--color-primary) 8%, var(--color-surface, var(--color-background)));
            }

            .secondary-button:focus-visible,
            .primary-button:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .primary-button {
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            .primary-button:disabled,
            .secondary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .form-error {
                margin-top: 12px;
                color: #c62828;
            }

            file-list-row .file-action-icon {
                width: 16px;
                height: 16px;
                display: block;
            }

            .iframe-overlay {
                position: fixed;
                inset: 0;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 16px;
                box-sizing: border-box;
                background: var(--color-background);
                color: var(--color-text-primary);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .iframe-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                flex-shrink: 0;
                padding: 12px 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-primary);
                color: var(--color-on-primary);
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
            }

            .iframe-title {
                min-width: 0;
                font-size: 1rem;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .iframe-header-actions {
                display: flex;
                flex-shrink: 0;
                gap: 10px;
                align-items: center;
            }

            .iframe-header .primary-button {
                background: var(--color-secondary);
                color: var(--color-on-secondary);
                border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
            }

            .iframe-header .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-secondary) 82%, #fff);
                color: var(--color-on-secondary);
            }

            :host-context([data-theme='light']) .iframe-header .primary-button {
                background: var(--color-background);
                color: var(--color-primary);
                border-color: var(--color-border);
            }

            :host-context([data-theme='light']) .iframe-header .primary-button:hover:not(:disabled) {
                background: var(--color-accent);
                color: var(--color-text-primary);
            }

            .iframe-container {
                flex: 1;
                display: flex;
                position: relative;
                min-height: 0;
                overflow: hidden;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-surface, var(--color-background));
            }

            .trame-iframe {
                width: 100%;
                height: 100%;
                border: 0;
                background: #000;
            }

            .loading-overlay {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: color-mix(in srgb, var(--color-background) 80%, transparent);
                pointer-events: none;
            }

            .viewer-loading {
                text-align: center;
                padding: 16px;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            loading: { type: Boolean },
            errorMessage: { type: String },
            cases: { type: Array },
            selectedCaseId: { type: String },
            openingAttachmentId: { type: String },
            postingComment: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            currentFileName: { type: String }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.loading = false;
        this.errorMessage = '';
        this.cases = [];
        this.selectedCaseId = '';
        this.openingAttachmentId = '';
        this.postingComment = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.currentFileName = '';
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this._heartbeatInterval = null;
        this._handleBeforeUnload = null;
    }

    get selectedCase() {
        return this.cases.find((row) => row.id === this.selectedCaseId) || null;
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();
        this._handleBeforeUnload = () => {
            if (!this.showIframe || !this._viewerSessionToken) return;
            const { stopUrl } = getViewerSessionEndpoints({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionScope: 'directus'
            });
            stopViewerSession({
                stopUrl,
                sessionToken: this._viewerSessionToken,
                body: buildViewerStopBody({
                    kind: VIEWER_KINDS.SLICER_GUI,
                    sessionToken: this._viewerSessionToken,
                    seatId: this._viewerSeatId,
                    mode: defaultReleaseModeForClose(VIEWER_KINDS.SLICER_GUI)
                }),
                keepalive: true
            });
        };
        window.addEventListener('beforeunload', this._handleBeforeUnload);
        this.loadCases();
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        this.stopHeartbeat();
        super.disconnectedCallback();
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    async loadCases() {
        this.loading = true;
        this.errorMessage = '';
        const keepSelected = this.selectedCaseId;
        try {
            const data = await listDirectusCases({ limit: 50 });
            this.cases = Array.isArray(data.cases) ? data.cases : [];
            if (keepSelected && !this.cases.some((row) => row.id === keepSelected)) {
                this.selectedCaseId = '';
            }
        } catch (err) {
            this.cases = [];
            this.errorMessage = err.message || 'Failed to load cases';
        } finally {
            this.loading = false;
        }
    }

    openCase(caseId) {
        this.selectedCaseId = caseId;
        this.errorMessage = '';
    }

    backToCaseList() {
        this.selectedCaseId = '';
        this.errorMessage = '';
    }

    async handlePostComment(event, caseRow) {
        const text = String(event.detail?.text || '').trim();
        if (!caseRow?.id || !text || this.postingComment) return;

        this.postingComment = true;
        this.errorMessage = '';
        try {
            const data = await createDirectusCaseComment(caseRow.id, text);
            const created = data.comment;
            event.target?.clearDraft?.();
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                const comments = Array.isArray(row.comments) ? [...row.comments] : [];
                if (created?.id) comments.push(created);
                return { ...row, comments };
            });
        } catch (err) {
            this.errorMessage = err.message || 'Failed to post comment';
        } finally {
            this.postingComment = false;
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: 'directus'
        });
        const ping = () => {
            sendTrameContainerHeartbeat({
                sessionToken: this._viewerSessionToken,
                heartbeatUrl,
                includeUserActive: false,
                onIdleTimeout: () => this.closeViewer()
            }).catch(() => {});
        };
        ping();
        this._heartbeatInterval = setInterval(ping, 30000);
    }

    stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    async closeViewer() {
        this.stopHeartbeat();
        resetViewerActivity();
        const token = this._viewerSessionToken;
        const seatId = this._viewerSeatId;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.currentFileName = '';
        this.openingAttachmentId = '';

        if (!token) return;
        const { stopUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: 'directus'
        });
        await stopViewerSession({
            stopUrl,
            sessionToken: token,
            body: buildViewerStopBody({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionToken: token,
                seatId,
                mode: VIEWER_RELEASE_MODES.SOFT
            })
        });
    }

    attachmentMetaLine(attachment) {
        const parts = [];
        if (attachment.name && attachment.filenameDownload
            && attachment.name !== attachment.filenameDownload) {
            parts.push(attachment.filenameDownload);
        }
        const size = formatBytes(attachment.filesize);
        if (size) parts.push(size);
        if (attachment.isMrb) {
            parts.push('Click name to open in Full Slicer');
        } else {
            parts.push(attachment.mimeType || 'Not openable in Full Slicer');
        }
        return parts.join(' · ');
    }

    async handleOpenAttachment(caseRow, attachment) {
        if (!attachment?.isMrb || this.openingAttachmentId) return;

        this.openingAttachmentId = attachment.id;
        this.errorMessage = '';
        this.currentFileName = attachment.filenameDownload || attachment.name || 'scene.mrb';
        this.viewerLoading = true;
        this.viewerLoadingDetail = attachment.filesize && attachment.filesize > 50 * 1024 * 1024
            ? `Preparing ${this.currentFileName} (~${Math.round(attachment.filesize / (1024 * 1024))} MB). First open can take several minutes.`
            : `Preparing ${this.currentFileName}…`;
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            this.stopHeartbeat();
            const data = await openDirectusAttachmentFullSlicer(caseRow.id, attachment.id, {
                useSimplifiedViewer: false
            });

            this._viewerSessionToken = data.sessionToken || null;
            this._viewerSeatId = data.seatId != null ? Number(data.seatId) : null;
            this.currentFileName = data.fileName || this.currentFileName;

            const url = buildSlicerGuiLoaderUrl({
                fileId: data.stagedKey || attachment.fileId,
                fileName: this.currentFileName,
                vncPath: data.vncPath || data.slicerGuiUrl || '',
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                simplified: false,
                embed: true,
                quick: false
            });

            this.iframeUrl = url;
            markViewerActivity();
            this.startHeartbeat();
            this.viewerLoading = true;
            this.viewerLoadingDetail = 'Opening viewer — scene will load when Slicer is ready…';
            this.openingAttachmentId = '';
        } catch (err) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.currentFileName = '';
            this._viewerSessionToken = null;
            this._viewerSeatId = null;
            this.openingAttachmentId = '';
            this.errorMessage = err.message || 'Unable to open Full Slicer';
        }
    }

    handleViewerIframeLoad() {
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        markViewerActivity();
    }

    renderLanding() {
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="Cases"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.loading ? html`
                    <div slot="content" class="status-note">Loading cases…</div>
                ` : ''}

                ${this.errorMessage ? html`
                    <page-content-message
                        slot="content"
                        variant="error"
                        .message=${this.errorMessage}
                    ></page-content-message>
                ` : ''}

                ${!this.loading && !this.errorMessage && this.cases.length === 0 ? html`
                    <page-content-message
                        slot="content"
                        variant="empty"
                        message="No cases returned from Directus."
                    ></page-content-message>
                ` : ''}

                ${!this.loading && this.cases.length > 0 ? html`
                    <div slot="content" class="case-grid">
                        ${this.cases.map((row) => {
                            const attachments = Array.isArray(row.attachments) ? row.attachments : [];
                            const comments = Array.isArray(row.comments) ? row.comments : [];
                            const mrbCount = attachments.filter((a) => a.isMrb).length;
                            return html`
                                <button
                                    class="case-card"
                                    type="button"
                                    @click=${() => this.openCase(row.id)}
                                >
                                    <span class="case-name">${row.title || '(untitled case)'}</span>
                                    ${row.status ? html`
                                        <span class="status-badge">${row.status}</span>
                                    ` : ''}
                                    <span class="case-meta">
                                        ${attachments.length} attachment${attachments.length === 1 ? '' : 's'}
                                        ${mrbCount ? ` · ${mrbCount} MRB` : ''}
                                        ${comments.length
                                            ? ` · ${comments.length} comment${comments.length === 1 ? '' : 's'}`
                                            : ''}
                                    </span>
                                    ${row.description ? html`
                                        <span class="case-meta">${row.description}</span>
                                    ` : ''}
                                </button>
                            `;
                        })}
                    </div>
                    <div slot="content" class="section-actions">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.loading}
                            @click=${() => this.loadCases()}
                        >
                            Refresh
                        </button>
                    </div>
                ` : ''}
            </page-layout-template>
        `;
    }

    renderCaseDetail(caseRow) {
        const attachments = Array.isArray(caseRow.attachments) ? caseRow.attachments : [];
        const comments = Array.isArray(caseRow.comments) ? caseRow.comments : [];
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle=${caseRow.title || 'Case'}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="case-detail">
                    ${caseRow.description || caseRow.status ? html`
                        <div class="case-summary">
                            <div class="case-summary-main">
                                <span class="case-summary-label">Case Overview</span>
                                ${caseRow.description ? html`
                                    <p class="case-summary-description">${caseRow.description}</p>
                                ` : ''}
                            </div>
                            ${caseRow.status ? html`
                                <span class="status-badge">${caseRow.status}</span>
                            ` : ''}
                        </div>
                    ` : ''}

                    ${this.errorMessage ? html`
                        <page-content-message
                            variant="error"
                            .message=${this.errorMessage}
                        ></page-content-message>
                    ` : ''}

                    <div class="case-detail-grid">
                        <div class="files-panel">
                            <h3 class="files-title">Attachments</h3>
                            <div class="files-body">
                                ${attachments.length === 0 ? html`
                                    <div class="empty-note">No attachments on this case yet.</div>
                                ` : html`
                                    <div class="file-list">
                                        ${attachments.map((attachment) => html`
                                            <file-list-row
                                                .fileName=${attachment.name || attachment.filenameDownload || 'Attachment'}
                                                .metaLine=${this.attachmentMetaLine(attachment)}
                                                .nameButtonDisabled=${!attachment.isMrb || !!this.openingAttachmentId || this.viewerLoading}
                                                .nameButtonTitle=${attachment.isMrb
                                                    ? 'Open in Full Slicer'
                                                    : 'Only MRB attachments can be opened'}
                                                @name-click=${() => this.handleOpenAttachment(caseRow, attachment)}
                                            ></file-list-row>
                                        `)}
                                    </div>
                                `}
                            </div>
                        </div>

                        <comments-panel
                            .comments=${comments}
                            emptyMessage="No discussion on this case yet. Start the conversation."
                            ?posting=${this.postingComment}
                            @post-comment=${(e) => this.handlePostComment(e, caseRow)}
                        ></comments-panel>
                    </div>

                    <div class="section-actions">
                        <button class="secondary-button" type="button" @click=${() => this.backToCaseList()}>
                            Back to Cases
                        </button>
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.loading || !!this.openingAttachmentId}
                            @click=${() => this.loadCases()}
                        >
                            Refresh
                        </button>
                    </div>
                </div>
            </page-layout-template>
        `;
    }

    renderViewerOverlay() {
        if (!this.showIframe) return html``;
        return html`
            <div class="iframe-overlay">
                <div class="iframe-header">
                    <div class="iframe-title">
                        Full Slicer: ${this.currentFileName || 'Loading…'}
                    </div>
                    <div class="iframe-header-actions">
                        <button
                            class="primary-button"
                            type="button"
                            @click=${() => this.closeViewer()}
                        >
                            Close Full Slicer
                        </button>
                    </div>
                </div>
                <div class="iframe-container">
                    ${this.iframeUrl !== 'about:blank' ? html`
                        <iframe
                            class="trame-iframe"
                            src="${this.iframeUrl}"
                            allow="clipboard-read; clipboard-write; cross-origin-isolated"
                            allowfullscreen
                            frameborder="0"
                            referrerpolicy="origin"
                            @load=${() => this.handleViewerIframeLoad()}
                        ></iframe>
                    ` : ''}
                    ${this.viewerLoading ? html`
                        <div class="loading-overlay">
                            <div class="viewer-loading">
                                <p>${this.viewerLoadingDetail || 'Loading viewer…'}</p>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    render() {
        const detail = this.selectedCase;
        return html`
            ${detail ? this.renderCaseDetail(detail) : this.renderLanding()}
            ${this.renderViewerOverlay()}
        `;
    }
}

customElements.define('directus-cases-page', DirectusCasesPage);
