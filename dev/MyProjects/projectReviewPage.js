import { LitElement, html, css } from 'lit-element';
import { API_URL } from '../config.js';
import { APP_MENU_ITEMS } from '../components/app-menu.js';
import '../components/page-layout-template.js';
import '../components/add-button.js';
import '../components/file-list-row.js';
import '../components/app-dialog.js';
import './collaboratorSearch.js';
import './collaboratorResultRow.js';
import { getProjectById, updateProjectCollaborators, listProjectFiles } from '../services/projects.js';
import {
    getProjectGpu,
    listGpuProviders,
    configureProjectGpuProvider,
    setActiveProjectGpuProvider,
    openFullSlicerViewer,
    prepareFullSlicerViewer,
    startProjectGpuBilling,
    stopProjectGpuBilling,
    transferProjectGpuBilling,
    acknowledgeProjectGpuError,
    sendProjectGpuHeartbeat,
    prestageProjectGpu
} from '../services/projectGpu.js';
import { resolveTramePageUrl } from '../utils/trameViewerUrl.js';
import {
    getCachedLocalSlicerViewerOptions,
    fetchUserPreferences
} from '../utils/userPreferences.js';
import {
    scheduleViewerStopOnLeave,
    cancelViewerStopOnLeave
} from '../utils/viewerGraceStop.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity,
    setViewerIdleMs,
    isViewerUserActive
} from '../utils/viewerActivity.js';
import { sendTrameContainerHeartbeat } from '../utils/trameHeartbeat.js';
import { stopViewerSession } from '../utils/viewerSessionLifecycle.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    defaultReleaseModeForClose,
    getViewerSessionEndpoints,
    buildViewerStopBody,
    buildSlicerGuiLoaderUrl,
    viewerDisplayName
} from '../utils/viewerLaunch.js';

const GPU_PROVIDER_CONSOLE_URLS = {
    vast: 'https://cloud.vast.ai/instances/'
};

export class ProjectReviewPage extends LitElement {
    static get styles() {
        return css`
            .status-note {
                margin-top: 14px;
                color: var(--color-text-secondary);
            }

            .form-error {
                margin-top: 12px;
                color: #c62828;
            }

            .success-note {
                margin-top: 12px;
                color: #2e7d32;
            }

            .toast {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 1200;
                background: #2e7d32;
                color: #fff;
                border-radius: 10px;
                padding: 10px 14px;
                box-shadow: 0 10px 28px var(--color-shadow, rgba(0, 0, 0, 0.2));
                max-width: min(360px, calc(100vw - 40px));
                font-weight: 500;
            }

            .error-alert-message {
                margin: 0;
                line-height: 1.5;
                color: var(--color-text-primary);
                white-space: pre-wrap;
                word-break: break-word;
            }

            .collaborators-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-surface, var(--color-background));
                padding: 10px;
            }

            .files-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-surface, var(--color-background));
                padding: 12px;
            }

            .file-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
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
                border-radius: 12px;
                background: var(--color-primary);
                color: var(--color-background);
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

            .iframe-header .secondary-button {
                background: var(--color-secondary);
                color: var(--color-background);
                border-color: var(--color-border);
            }

            .iframe-header .secondary-button:hover:not(:disabled) {
                background: var(--color-accent);
                color: var(--color-text-primary);
            }

            .iframe-header .primary-button {
                background: var(--color-background);
                color: var(--color-primary);
                border-color: var(--color-border);
            }

            .iframe-header .primary-button:hover:not(:disabled) {
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
                border-radius: 12px;
                background: var(--color-surface, var(--color-background));
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
            }

            .trame-iframe {
                flex: 1;
                border: none;
                background: var(--color-surface, var(--color-background));
                width: 100%;
                height: 100%;
            }

            .loading-state {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--color-surface, var(--color-background));
                text-align: center;
            }

            .loading-state.loading-overlay {
                position: absolute;
                inset: 0;
                z-index: 2;
            }

            .viewer-loading {
                color: var(--color-text-secondary);
            }

            .viewer-loading p {
                margin: 0;
                font-size: 0.95rem;
            }

            .viewer-spinner {
                width: 40px;
                height: 40px;
                border: 4px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
                border-top-color: var(--color-primary);
                border-radius: 50%;
                animation: viewer-spin 0.8s linear infinite;
                margin: 0 auto 16px;
            }

            @keyframes viewer-spin {
                to { transform: rotate(360deg); }
            }

            .files-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 10px;
            }

            .upload-area {
                border: 2px dashed var(--color-border);
                border-radius: 10px;
                padding: 22px 16px;
                text-align: center;
                background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface, var(--color-background)));
                transition: border-color 0.2s ease, background-color 0.2s ease;
            }

            .upload-area.drag-over {
                border-color: var(--color-primary);
                background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface, var(--color-background)));
            }

            .upload-area input[type="file"] {
                display: none;
            }

            .upload-message {
                color: var(--color-text-secondary);
                margin-bottom: 10px;
            }

            .upload-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                min-height: 38px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
                background: var(--color-primary);
                color: var(--color-background);
            }

            .upload-button.secondary {
                background: transparent;
                color: var(--color-text-primary);
            }

            .upload-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .upload-file-info {
                margin-top: 10px;
                color: var(--color-text-secondary);
                font-size: 0.95rem;
            }

            .upload-actions {
                margin-top: 10px;
                display: flex;
                justify-content: center;
                gap: 8px;
            }

            .collaborators-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 10px;
            }

            .collaborators-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .collaborator-row {
                border-radius: 10px;
                padding: 10px 12px;
            }

            .empty-note {
                color: var(--color-text-secondary);
                font-size: 0.95rem;
            }

            .section-actions {
                margin-top: 14px;
                display: flex;
                justify-content: flex-end;
                gap: 10px;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                min-height: 40px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .secondary-button {
                background: transparent;
                color: var(--color-text-primary);
            }

            .primary-button {
                background: var(--color-primary);
                color: var(--color-background);
            }

            .primary-button:disabled,
            .secondary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            add-button {
                margin-top: 12px;
            }

            .gpu-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: var(--color-surface, var(--color-background));
                padding: 4px 10px 10px;
            }

            .gpu-panel-header {
                display: flex;
                align-items: center;
                gap: 10px;
                flex-wrap: wrap;
            }

            .gpu-panel-details {
                flex: 1;
                min-width: min(220px, 100%);
                margin: 0;
            }

            .gpu-panel summary {
                cursor: pointer;
                list-style: none;
                font-weight: 600;
                color: var(--color-text-primary);
                padding: 10px 2px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .gpu-panel summary::-webkit-details-marker {
                display: none;
            }

            .gpu-panel-summary-label {
                flex-shrink: 0;
            }

            .gpu-panel-summary-meta {
                flex: 1;
                min-width: 0;
                font-size: 0.85rem;
                font-weight: 500;
                color: var(--color-text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .gpu-panel-chevron {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--color-text-primary);
                background: var(--color-surface, var(--color-background));
                transition: transform 0.15s ease, background-color 0.15s ease;
                flex-shrink: 0;
            }

            .gpu-panel details[open] .gpu-panel-chevron {
                transform: rotate(90deg);
            }

            .gpu-panel summary:hover .gpu-panel-chevron,
            .gpu-panel summary:focus-visible .gpu-panel-chevron {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-surface, var(--color-background)));
            }

            .gpu-panel-billing-actions {
                display: flex;
                gap: 8px;
                flex-shrink: 0;
                padding: 4px 0;
            }

            .gpu-panel-billing-actions .primary-button,
            .gpu-panel-billing-actions .secondary-button {
                padding: 6px 12px;
                font-size: 0.9rem;
            }

            .gpu-panel-body {
                padding: 0 2px 4px;
            }

            .gpu-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 10px;
            }

            .gpu-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 12px;
            }

            .gpu-field label {
                font-size: 0.9rem;
                color: var(--color-text-secondary);
            }

            .gpu-field select,
            .gpu-field input,
            .gpu-field textarea {
                border: 1px solid var(--color-border);
                border-radius: 8px;
                padding: 8px 10px;
                font: inherit;
                background: var(--color-background);
                color: var(--color-text-primary);
                box-sizing: border-box;
                width: 100%;
                max-width: 100%;
            }

            .gpu-field select {
                appearance: none;
                -webkit-appearance: none;
                -moz-appearance: none;
                min-height: 38px;
                padding: 8px 36px 8px 10px;
                line-height: 1.2;
                background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8' viewBox='0 0 12 8'%3E%3Cpath fill='%23666' d='M1.41 0.59 6 5.17 10.59 0.59 12 2l-6 6-6-6z'/%3E%3C/svg%3E");
                background-repeat: no-repeat;
                background-position: right 12px center;
                background-size: 12px 8px;
            }

            .gpu-field textarea {
                min-height: 72px;
                resize: vertical;
            }

            .gpu-status {
                font-size: 0.95rem;
                color: var(--color-text-secondary);
                margin-bottom: 10px;
            }

            .gpu-status-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 10px;
            }

            .gpu-status-row .gpu-status {
                margin-bottom: 0;
                flex: 1;
                min-width: 0;
            }

            .gpu-info-button {
                border: 1px solid var(--color-border);
                border-radius: 8px;
                background: transparent;
                color: var(--color-text-secondary);
                width: 32px;
                height: 32px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                flex-shrink: 0;
            }

            .gpu-info-button:hover,
            .gpu-info-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
                outline: none;
            }

            .gpu-info-button[aria-expanded="true"] {
                background: color-mix(in srgb, var(--color-primary) 18%, transparent);
                color: var(--color-text-primary);
            }

            .gpu-info-icon {
                width: 18px;
                height: 18px;
            }

            .gpu-details {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                border: 1px solid var(--color-border);
                border-radius: 8px;
                padding: 10px 12px;
                margin-bottom: 10px;
                background: color-mix(in srgb, var(--color-border) 25%, transparent);
            }

            .gpu-detail-row {
                display: grid;
                grid-template-columns: minmax(88px, 34%) 1fr;
                gap: 6px 10px;
                padding: 4px 0;
            }

            .gpu-detail-row + .gpu-detail-row {
                border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
            }

            .gpu-detail-label {
                font-weight: 600;
                color: var(--color-text-primary);
            }

            .gpu-detail-value {
                line-height: 1.4;
                word-break: break-word;
            }

            .gpu-detail-value-with-link {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            .gpu-console-link {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: 4px;
                color: var(--color-text-secondary);
                text-decoration: none;
                flex-shrink: 0;
            }

            .gpu-console-link:hover,
            .gpu-console-link:focus-visible {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-border) 50%, transparent);
            }

            .gpu-console-link svg {
                width: 16px;
                height: 16px;
            }

            .gpu-status strong {
                color: var(--color-text-primary);
            }

            .gpu-hint {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                margin-top: 6px;
            }

            .gpu-title-row add-button {
                margin-top: 0;
            }

            .gpu-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 8px;
            }

            .gpu-title-row .gpu-title {
                margin-bottom: 0;
            }

            .gpu-dialog-form {
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-width: min(360px, 100%);
            }

            .gpu-dialog-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 4px;
            }

            .gpu-dialog-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
                cursor: pointer;
            }

            .gpu-dialog-checkbox input {
                margin: 0;
            }

            .gpu-local-option {
                margin-top: 8px;
            }

            .gpu-local-option .gpu-hint {
                margin-top: 4px;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            projectId: { type: Number },
            menuItems: { type: Array },
            loading: { type: Boolean },
            saving: { type: Boolean },
            toastMessage: { type: String },
            errorAlertTitle: { type: String },
            errorAlertMessage: { type: String },
            projectName: { type: String },
            collaborators: { type: Array },
            originalCollaborators: { type: Array },
            canEditCollaborators: { type: Boolean },
            canUploadFiles: { type: Boolean },
            canDeleteProjectFiles: { type: Boolean },
            projectFiles: { type: Array },
            loadingProjectFiles: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            viewerKind: { type: String },
            viewerSimplified: { type: Boolean },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            launchingFileId: { type: Number },
            currentFileName: { type: String },
            selectedFile: { type: Object },
            uploading: { type: Boolean },
            dragOver: { type: Boolean },
            uploadSuccess: { type: String },
            gpuProviders: { type: Array },
            configuredProviders: { type: Array },
            gpuSettings: { type: Object },
            gpuActiveProviderId: { type: String },
            gpuInstance: { type: Object },
            canManageGpu: { type: Boolean },
            canStartBilling: { type: Boolean },
            canStopBilling: { type: Boolean },
            billingOwnership: { type: Object },
            stopBillingImpact: { type: Object },
            ownerBillingPromptStep: { type: String },
            gpuSaving: { type: Boolean },
            gpuDialogProviderId: { type: String },
            gpuDialogApiKey: { type: String },
            gpuDialogUseNow: { type: Boolean },
            gpuDialogSaving: { type: Boolean },
            gpuBillingBusy: { type: Boolean },
            gpuBillingLease: { type: Object },
            stagedFileIds: { type: Array },
            gpuPrestageActive: { type: Boolean },
            vastGpuMode: { type: String },
            remoteActivity: { type: Object },
            remoteProvision: { type: Object },
            gpuDetailsOpen: { type: Boolean },
            gpuPanelOpen: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.projectId = null;
        this.menuItems = APP_MENU_ITEMS;
        this.loading = false;
        this.saving = false;
        this.toastMessage = '';
        this.errorAlertTitle = '';
        this.errorAlertMessage = '';
        this.projectName = '';
        this.collaborators = [];
        this.originalCollaborators = [];
        this.canEditCollaborators = false;
        this.canUploadFiles = false;
        this.canDeleteProjectFiles = false;
        this.projectFiles = [];
        this.loadingProjectFiles = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this.currentFileName = '';
        this.selectedFile = null;
        this.uploading = false;
        this.dragOver = false;
        this.uploadSuccess = '';
        this.gpuProviders = [];
        this.configuredProviders = [{ id: 'local', label: 'Local', configured: true }];
        this.gpuSettings = null;
        this.gpuActiveProviderId = 'local';
        this.gpuInstance = null;
        this.canManageGpu = false;
        this.canStartBilling = false;
        this.canStopBilling = false;
        this.billingOwnership = null;
        this.stopBillingImpact = null;
        this.ownerBillingPromptStep = '';
        this._billingReceivedViaTransfer = false;
        this.gpuSaving = false;
        this.gpuDialogProviderId = 'vast';
        this.gpuDialogApiKey = '';
        this.gpuDialogUseNow = true;
        this.gpuDialogSaving = false;
        this.gpuBillingBusy = false;
        this.gpuBillingLease = null;
        this.stagedFileIds = [];
        this.gpuPrestageActive = false;
        this.vastGpuMode = null;
        this.remoteActivity = null;
        this.remoteProvision = null;
        this.gpuDetailsOpen = false;
        this.gpuPanelOpen = false;
        this._prestageHoverTimer = null;
        this._autoPrestageDone = false;
        this._fullSlicerWarmPromise = null;
        this.toastTimeout = null;
        this._lastErrorAlertKey = '';
        this._errorAlertKind = null;
        this._trameHeartbeatInterval = null;
        this._viewerSessionToken = null;
        this._gpuPollInterval = null;
        this._gpuBillingHeartbeatInterval = null;
    }

    updated(changedProperties) {
        if (changedProperties.has('projectId') && this.projectId) {
            this.loadProject();
            return;
        }
        if (changedProperties.has('gpuSettings') || changedProperties.has('configuredProviders')) {
            this.syncGpuProviderSelect();
        }
        if (changedProperties.has('loading') && !this.loading) {
            this.syncGpuProviderSelect();
        }
    }

    applyGpuSettings(settings) {
        this.gpuSettings = settings;
        this.gpuActiveProviderId = settings?.providerId || 'local';
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this._handleBeforeUnload = () => {
            if (!this.showIframe || !this._viewerSessionToken) return;
            const kind = this.viewerKind || VIEWER_KINDS.TRAME;
            const { stopUrl } = getViewerSessionEndpoints({
                kind,
                projectId: this.projectId
            });
            stopViewerSession({
                stopUrl,
                sessionToken: this._viewerSessionToken,
                body: buildViewerStopBody({
                    kind,
                    sessionToken: this._viewerSessionToken,
                    projectId: this.projectId,
                    // Soft-park Full Slicer so refresh/reopen can reuse the warm seat.
                    mode: defaultReleaseModeForClose(kind)
                }),
                keepalive: true
            });
        };
        window.addEventListener('beforeunload', this._handleBeforeUnload);
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        this.stopTrameHeartbeat();
        this.stopGpuBillingHeartbeat();
        this.stopGpuPolling();
        const hadViewer = this.showIframe || (this.iframeUrl && this.iframeUrl !== 'about:blank');
        const projectId = this.projectId;
        const viewerKind = this.viewerKind || VIEWER_KINDS.TRAME;
        const sessionToken = this._viewerSessionToken;
        if (hadViewer && projectId) {
            scheduleViewerStopOnLeave(projectId, () => {
                this.cleanupContainerSession(projectId, {
                    kind: viewerKind,
                    sessionToken,
                    mode: defaultReleaseModeForClose(viewerKind)
                });
            });
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this.currentFileName = '';
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        super.disconnectedCallback();
    }

    showToast(message) {
        this.toastMessage = message || '';
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }
        this.toastTimeout = setTimeout(() => {
            this.toastMessage = '';
            this.toastTimeout = null;
        }, 3000);
    }

    showErrorAlert(message, { title = 'Something went wrong', force = false, kind = null } = {}) {
        const text = String(message || '').trim();
        if (!text) return;

        const key = `${title}\0${text}`;
        if (!force && key === this._lastErrorAlertKey) {
            return;
        }
        this._lastErrorAlertKey = key;
        this.errorAlertTitle = title;
        this.errorAlertMessage = text;
        this._errorAlertKind = kind;
        this.requestUpdate();
        queueMicrotask(() => {
            this.renderRoot?.querySelector('#error-alert-dialog')?.openDialog();
        });
    }

    gpuErrorTitle(errorSource, message) {
        if (errorSource === 'vast' || String(message || '').startsWith('Vast.ai: ')) {
            return 'Problem on Vast.ai';
        }
        return 'GPU problem in Slicer Web';
    }

    showGpuErrorAlert(message, errorSource = null) {
        this.showErrorAlert(message, {
            title: this.gpuErrorTitle(errorSource, message),
            kind: 'gpu',
            force: true
        });
    }

    get shouldCleanupGpuOnErrorDismiss() {
        if (this._errorAlertKind !== 'gpu' || !this.canManageGpu) return false;
        return this.gpuInstance?.status === 'error' && !!this.gpuInstance?.instanceId;
    }

    get errorAlertDismissLabel() {
        if (this._errorAlertKind === 'gpu' && this.gpuInstance?.instanceId) {
            return 'OK — remove instance';
        }
        if (this._errorAlertKind === 'gpu') {
            return 'OK — dismiss';
        }
        return 'OK';
    }

    async dismissErrorAlert() {
        const cleanupGpu = this.shouldCleanupGpuOnErrorDismiss;

        this.renderRoot?.querySelector('#error-alert-dialog')?.closeDialog();
        this.errorAlertMessage = '';
        this.errorAlertTitle = '';
        this._errorAlertKind = null;

        if (!cleanupGpu) return;

        this.gpuBillingBusy = true;
        try {
            const data = await acknowledgeProjectGpuError(this.projectId);
            this.gpuInstance = data.instance || this.gpuInstance;
            this.remoteProvision = null;
            this.clearErrorAlertDedupe();
            if (data.status === 'stopping') {
                this.showToast('Removing GPU instance…');
                this.maybeStartGpuPolling();
            } else {
                this.showToast('GPU error cleared.');
            }
            await this.loadProjectGpu();
        } catch (error) {
            this.showErrorAlert(error.message || 'Could not remove the GPU instance.', {
                title: 'GPU cleanup',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    clearErrorAlertDedupe() {
        this._lastErrorAlertKey = '';
    }

    pickGpuStatusError(data, prevStatus) {
        if (data.settings?.credentialsUnreadable) {
            return 'Saved GPU API key could not be read. Re-enter your Vast API key and save.';
        }
        if (data.remoteProvision?.failure) {
            return `Vast.ai: ${data.remoteProvision.failure}`;
        }
        if (data.reconcileChanged && (data.reconcileReason || data.instance?.errorMessage)) {
            return data.reconcileReason || data.instance.errorMessage;
        }
        if (data.instance?.status === 'error' && data.instance?.errorMessage) {
            if (prevStatus !== 'error' || data.reconcileChanged) {
                return data.instance.errorMessage;
            }
        }
        return '';
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    handleBackToProjects() {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: {
                selectedKey: 'my-projects',
                item: { key: 'my-projects', label: 'My Projects' }
            },
            bubbles: true,
            composed: true
        }));
    }

    collaboratorSnapshot(collaborators) {
        return collaborators
            .map((entry) => ({
                userId: Number(entry.user?.id),
                role: entry.role
            }))
            .filter((entry) => Number.isInteger(entry.userId) && entry.userId > 0 && typeof entry.role === 'string')
            .sort((a, b) => a.userId - b.userId);
    }

    getRoleSortValue(role) {
        if (role === 'admin') return 0;
        if (role === 'collaborator') return 1;
        return 2;
    }

    sortCollaborators(collaborators = []) {
        return [...collaborators].sort((a, b) => {
            const roleDiff = this.getRoleSortValue(a.role) - this.getRoleSortValue(b.role);
            if (roleDiff !== 0) return roleDiff;
            const userA = (a.user?.username || '').toLowerCase();
            const userB = (b.user?.username || '').toLowerCase();
            return userA.localeCompare(userB);
        });
    }

    get hasPendingCollaboratorChanges() {
        const current = this.collaboratorSnapshot(this.collaborators);
        const original = this.collaboratorSnapshot(this.originalCollaborators);
        return JSON.stringify(current) !== JSON.stringify(original);
    }

    async loadProject() {
        this.loading = true;
        this.toastMessage = '';
        try {
            const data = await getProjectById(this.projectId);
            this.projectName = data.project?.name || '';
            const role = data.project?.role;
            this.canEditCollaborators = role === 'admin';
            this.canUploadFiles = role === 'admin' || role === 'collaborator';
            this.canDeleteProjectFiles = role === 'admin' || role === 'collaborator';
            const collaborators = data.collaborators || [];
            this.collaborators = this.sortCollaborators(collaborators.map((entry) => ({ ...entry })));
            this.originalCollaborators = this.sortCollaborators(collaborators.map((entry) => ({ ...entry })));
            await Promise.all([this.loadProjectFiles(), this.loadProjectGpu()]);
            this.maybeWarmLocalFullSlicer();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to load project.', {
                title: 'Unable to load project',
                force: true
            });
            this.projectName = '';
            this.collaborators = [];
            this.originalCollaborators = [];
            this.canEditCollaborators = false;
            this.canUploadFiles = false;
            this.canDeleteProjectFiles = false;
            this.projectFiles = [];
        } finally {
            this.loading = false;
        }
    }

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatBytes(bytes) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    formatProjectFileMetaLine(file) {
        const modifiedAt = file.lastModifiedAt || file.uploadDate;
        const parts = [
            this.formatBytes(file.size),
            `Modified ${this.formatDate(modifiedAt)}`
        ];
        if (file.lastViewedAt) {
            parts.push(`Viewed ${this.formatDate(file.lastViewedAt)}`);
        }
        return parts.join(' · ');
    }

    isFileStagedOnGpu(file) {
        return (this.stagedFileIds || []).includes(file.id);
    }

    isRemoteGpuRunning() {
        if (this.savedGpuProviderId === 'local') return false;
        return this.gpuInstance?.status === 'running';
    }

    usesRemoteGpuProvider() {
        return this.savedGpuProviderId !== 'local';
    }

    syncConfiguredProvidersFromSettings(settings) {
        const providers = settings?.configuredProviders;
        if (Array.isArray(providers) && providers.length) {
            this.configuredProviders = providers.map((entry) => ({ ...entry }));
            return;
        }
        this.configuredProviders = [{ id: 'local', label: 'Local', configured: true, isDefault: true }];
    }

    ensureConfiguredProviderListed(providerId) {
        if (providerId === 'local' || this.isGpuProviderConfigured(providerId)) {
            return;
        }
        const meta = this.gpuProviders.find((provider) => provider.id === providerId);
        if (!meta) return;
        this.configuredProviders = [
            ...this.configuredProviders,
            { id: providerId, label: meta.label, configured: true }
        ];
    }

    syncGpuProviderSelect() {
        if (this.loading || !this.gpuSettings) return;
        const value = this.gpuActiveProviderId || this.savedGpuProviderId;
        const apply = () => {
            const select = this.renderRoot?.querySelector('#gpu-provider');
            if (!select) return;
            if (select.value !== value) {
                select.value = value;
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(apply);
        } else {
            apply();
        }
    }

    async handleGpuProviderChange(event) {
        const next = event.target.value;
        const prev = this.savedGpuProviderId;
        if (next === prev) return;

        if (next === 'local') {
            this.gpuDetailsOpen = false;
            this.stopGpuBillingHeartbeat();
        }
        await this.persistActiveGpuProvider(next);
    }

    async persistActiveGpuProvider(providerId) {
        if (!this.canManageGpu) return;

        this.gpuSaving = true;
        try {
            const data = await setActiveProjectGpuProvider(this.projectId, providerId);
            this.applyGpuSettings(data.settings);
            this.syncConfiguredProvidersFromSettings(data.settings);
            this.syncGpuProviderSelect();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to switch GPU provider.', {
                title: 'GPU settings',
                force: true
            });
            this.requestUpdate();
        } finally {
            this.gpuSaving = false;
        }
    }

    async handleLaunchFullSlicer(file) {
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        // Keep the warm seat attached when switching files — soft-park between
        // opens races the new stage request and can leave the loader waiting forever.
        const switchingInPlace = this.showIframe
            && this.viewerKind === VIEWER_KINDS.SLICER_GUI
            && !!this._viewerSessionToken;
        if (this.showIframe && !switchingInPlace) {
            await this.closeIframe();
        } else if (switchingInPlace) {
            this.stopTrameHeartbeat();
            if (this._viewerIframeActivityCleanup) {
                this._viewerIframeActivityCleanup();
                this._viewerIframeActivityCleanup = null;
            }
        }

        try {
            await fetchUserPreferences();
        } catch (_) {
            /* use cached prefs if refresh fails */
        }

        const simplified = this.useLocalSimplifiedViewer;
        const label = this.savedGpuProviderId === 'vast'
            ? 'Full Slicer (Vast)'
            : viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified });
        this.currentFileName = file.originalName;
        this.launchingFileId = file.id;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerSimplified = simplified;
        this.viewerLoading = true;
        this.viewerLoadingDetail = switchingInPlace
            ? `Switching to ${file.originalName}…`
            : (this.savedGpuProviderId === 'vast'
                ? `Copying ${file.originalName} to Vast Full Slicer…`
                : `Starting ${label} for ${file.originalName}…`);
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            this.stopTrameHeartbeat();
            const data = await openFullSlicerViewer(this.projectId, file.id, {
                useSimplifiedViewer: simplified
            });

            this._viewerSessionToken = data.sessionToken || null;
            this.viewerSimplified = data.useSimplifiedViewer === true;
            this.currentFileName = data.fileName || file.originalName;

            if (this.viewerSimplified !== simplified) {
                console.warn(
                    'Full Slicer mode mismatch: client requested simplified='
                    + simplified
                    + ' but server returned '
                    + this.viewerSimplified
                );
            }

            // Quick splash only when the warm seat already has this scene in memory.
            // Prepared-empty seats still need a real load (busy wait), not a reconnect skip.
            const quickReconnect = data.sessionReused === true && data.sceneReloaded === false;
            const url = buildSlicerGuiLoaderUrl({
                projectId: this.projectId,
                fileId: file.id,
                fileName: this.currentFileName,
                vncPath: data.vncPath || data.slicerGuiUrl || '',
                sessionToken: this._viewerSessionToken,
                simplified: this.viewerSimplified,
                embed: true,
                quick: quickReconnect
            });

            this.viewerLoadingDetail = quickReconnect
                ? `Reconnecting to ${this.currentFileName}…`
                : (data.sessionReused
                    ? `Loading ${this.currentFileName}…`
                    : `Loading ${this.currentFileName}… First launch can take 1–2 minutes.`);
            this.iframeUrl = url;
            markViewerActivity();
            this.showToast(`Launched ${this.currentFileName} in ${viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified: this.viewerSimplified })}`);
            this.startTrameHeartbeat();
        } catch (error) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerKind = VIEWER_KINDS.TRAME;
            this.viewerSimplified = false;
            this.currentFileName = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this._viewerSessionToken = null;
            this.showErrorAlert(error.message || 'Unable to open Full Slicer.', {
                title: 'Unable to open file',
                force: true
            });
        }
    }

    get gpuDialogProviderOptions() {
        return (this.gpuProviders || []).filter((provider) => provider.id !== 'local');
    }

    isGpuProviderConfigured(providerId) {
        return (this.configuredProviders || []).some(
            (entry) => entry.id === providerId && entry.configured
        );
    }

    get gpuDialogApiKeyPlaceholder() {
        const entry = (this.configuredProviders || []).find((p) => p.id === this.gpuDialogProviderId);
        if (entry?.apiKeyMasked) {
            return `Saved (${entry.apiKeyMasked}) — leave blank to keep`;
        }
        return 'Paste API key';
    }

    updateGpuDialogUseNowCheckbox() {
        const providerId = this.gpuDialogProviderId;
        const isNew = !this.isGpuProviderConfigured(providerId);
        const isActive = (this.gpuActiveProviderId || 'local') === providerId;
        // New providers default to Use now; reconfigure keeps checked only if already active.
        this.gpuDialogUseNow = isNew || isActive;
    }

    openGpuProviderDialog(providerId = null) {
        if (!this.canManageGpu) return;
        const options = this.gpuDialogProviderOptions;
        const unconfigured = options.find((provider) => !this.isGpuProviderConfigured(provider.id));
        this.gpuDialogProviderId = providerId
            || unconfigured?.id
            || this.gpuActiveProviderId
            || options[0]?.id
            || 'vast';
        this.gpuDialogApiKey = '';
        this.updateGpuDialogUseNowCheckbox();
        this.renderRoot?.querySelector('#gpu-provider-dialog')?.openDialog();
    }

    get gpuProviderDialogTitle() {
        return this.isGpuProviderConfigured(this.gpuDialogProviderId)
            ? 'Configure GPU Provider'
            : 'Add GPU Provider';
    }

    closeGpuProviderDialog() {
        this.renderRoot?.querySelector('#gpu-provider-dialog')?.closeDialog();
    }

    handleGpuDialogProviderChange(event) {
        this.gpuDialogProviderId = event.target.value;
        this.gpuDialogApiKey = '';
        this.updateGpuDialogUseNowCheckbox();
    }

    handleGpuDialogUseNowChange(event) {
        this.gpuDialogUseNow = event.target.checked;
    }

    handleGpuDialogApiKeyInput(event) {
        this.gpuDialogApiKey = event.target.value;
    }

    async handleSaveGpuProviderDialog() {
        if (!this.canManageGpu || this.gpuDialogSaving) return;

        const providerId = this.gpuDialogProviderId;
        const configured = this.isGpuProviderConfigured(providerId);
        if (!this.gpuDialogApiKey.trim() && !configured) {
            this.showErrorAlert('API key is required for this provider.', {
                title: 'GPU provider',
                force: true
            });
            return;
        }

        this.gpuDialogSaving = true;
        try {
            const payload = {
                providerId,
                useNow: this.gpuDialogUseNow
            };
            if (this.gpuDialogApiKey.trim()) {
                payload.apiKey = this.gpuDialogApiKey.trim();
            }
            const data = await configureProjectGpuProvider(this.projectId, payload);
            this.applyGpuSettings(data.settings);
            this.syncConfiguredProvidersFromSettings(data.settings);
            this.ensureConfiguredProviderListed(providerId);
            this.gpuDialogApiKey = '';
            this.closeGpuProviderDialog();
            this.showToast(
                this.gpuDialogUseNow
                    ? 'GPU provider saved and selected for Using now.'
                    : 'GPU provider saved.'
            );
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to save GPU provider.', {
                title: 'GPU provider',
                force: true
            });
        } finally {
            this.gpuDialogSaving = false;
        }
    }

    getRemoteGpuLaunchBlockMessage() {
        if (this.gpuSaving) {
            return 'GPU provider is updating. Try again in a moment.';
        }
        if (!this.projectId || !this.usesRemoteGpuProvider()) return null;
        if (this.isRemoteGpuRunning()) return null;

        const status = this.gpuInstance?.status || 'idle';
        if (status === 'provisioning') {
            return 'GPU is still starting. Wait until it shows “Ready to open files,” then try again.';
        }
        if (status === 'stopping') {
            return 'GPU is shutting down. Try again in a moment.';
        }
        if (status === 'error') {
            return this.gpuInstance?.errorMessage
                || 'GPU billing is unavailable. Start billing again or contact the project admin.';
        }
        if (!this.canManageGpu) {
            return 'GPU billing is not running. Ask the project admin to start billing before opening files.';
        }
        return 'Start GPU billing on this project before opening files.';
    }

    getFileLaunchTitle(file) {
        if (this.launchingFileId === file.id) return 'Opening…';
        const block = this.getRemoteGpuLaunchBlockMessage();
        if (block) return block;
        return 'Open file';
    }

    parseApiErrorMessage(data, fallback) {
        if (typeof data?.error === 'string') return data.error;
        if (data?.error?.message) return data.error.message;
        if (typeof data?.message === 'string') return data.message;
        return fallback;
    }

    maybePrestageRecentFiles() {
        if (!this.isRemoteGpuRunning()) {
            this._autoPrestageDone = false;
            return;
        }
        if (this._autoPrestageDone || this.gpuPrestageActive) return;
        this._autoPrestageDone = true;
        prestageProjectGpu(this.projectId)
            .then((data) => {
                this.stagedFileIds = data.stagedFileIds || this.stagedFileIds;
                this.gpuPrestageActive = false;
            })
            .catch(() => {
                this._autoPrestageDone = false;
            });
    }

    /**
     * Background-warm the local Full Slicer seat so the first Open skips cold boot.
     * Safe to call repeatedly; no-ops when not using local Full Slicer or when a viewer is open.
     */
    maybeWarmLocalFullSlicer() {
        if (!this.projectId || this.showIframe || !this.useLocalFullSlicer) {
            return;
        }
        if (this._fullSlicerWarmPromise) {
            return;
        }
        const simplified = this.useLocalSimplifiedViewer;
        this._fullSlicerWarmPromise = prepareFullSlicerViewer(this.projectId, {
            useSimplifiedViewer: simplified
        })
            .then((data) => {
                if (data?.ready === true) {
                    console.log('Full Slicer seat warmed', {
                        sessionReused: data.sessionReused,
                        warmIdleSeconds: data.warmIdleSeconds
                    });
                }
            })
            .catch((err) => {
                console.warn('Full Slicer warm prepare failed:', err.message);
            })
            .finally(() => {
                this._fullSlicerWarmPromise = null;
            });
    }

    handleFileHover(file) {
        if (!this.isRemoteGpuRunning()) return;
        if (this.isFileStagedOnGpu(file)) return;
        clearTimeout(this._prestageHoverTimer);
        this._prestageHoverTimer = setTimeout(() => {
            prestageProjectGpu(this.projectId, { fileIds: [file.id] })
                .then((data) => {
                    this.stagedFileIds = data.stagedFileIds || this.stagedFileIds;
                })
                .catch(() => {});
        }, 100);
    }

    handleFileSelect(event) {
        this.selectedFile = event.target.files?.[0] || null;
    }

    handleDragOver(event) {
        event.preventDefault();
        this.dragOver = true;
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.dragOver = false;
    }

    handleDrop(event) {
        event.preventDefault();
        this.dragOver = false;
        const files = event.dataTransfer?.files;
        if (files?.length > 0) {
            this.selectedFile = files[0];
        }
    }

    async loadProjectFiles() {
        if (!this.projectId) {
            this.projectFiles = [];
            return;
        }
        this.loadingProjectFiles = true;
        try {
            const data = await listProjectFiles(this.projectId);
            this.projectFiles = data.files || [];
        } catch (error) {
            this.projectFiles = [];
        } finally {
            this.loadingProjectFiles = false;
        }
    }

    openFileUploadDialog() {
        if (!this.canUploadFiles) return;
        this.selectedFile = null;
        this.dragOver = false;
        const input = this.renderRoot?.querySelector('#project-upload-input');
        if (input) input.value = '';
        this.renderRoot?.querySelector('#file-upload-dialog')?.openDialog();
    }

    closeFileUploadDialog() {
        this.renderRoot?.querySelector('#file-upload-dialog')?.closeDialog();
    }

    async uploadFileToProject() {
        if (!this.selectedFile || !this.canUploadFiles || !this.projectId) {
            this.showErrorAlert('Please choose a file.', { title: 'Upload file', force: true });
            return;
        }

        this.uploading = true;

        try {
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('projectId', String(this.projectId));

            const response = await fetch(`${API_URL}/api/files/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            const data = await response.json();
            if (response.ok) {
                this.showToast('File uploaded to project successfully.');
                this.selectedFile = null;
                const input = this.renderRoot?.querySelector('#project-upload-input');
                if (input) input.value = '';
                await this.loadProjectFiles();
                this.closeFileUploadDialog();
                return;
            }

            let errorMsg = 'Upload failed';
            if (typeof data.error === 'string') {
                errorMsg = data.error;
            } else if (data.error?.message) {
                errorMsg = data.error.message;
            } else if (data.message) {
                errorMsg = data.message;
            } else if (response.statusText) {
                errorMsg = `Upload failed: ${response.statusText}`;
            }
            this.showErrorAlert(errorMsg, { title: 'Upload failed', force: true });
        } catch (error) {
            this.showErrorAlert(error.message || 'Network error during upload', {
                title: 'Upload failed',
                force: true
            });
        } finally {
            this.uploading = false;
        }
    }

    async loadProjectGpu() {
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        const prevStatus = this.gpuInstance?.status;
        const prevProviderId = this.gpuSettings ? this.savedGpuProviderId : null;
        try {
            const providerData = await listGpuProviders();
            this.gpuProviders = providerData.providers || [];
            const data = await getProjectGpu(this.projectId);
            this.applyGpuSettings(data.settings);
            this.gpuInstance = data.instance;
            this.gpuBillingLease = data.billingLease || null;
            this.stagedFileIds = data.stagedFileIds || [];
            this.gpuPrestageActive = !!data.prestageActive;
            this.vastGpuMode = data.vastGpuMode || null;
            this.remoteActivity = data.remoteActivity || null;
            this.remoteProvision = data.remoteProvision || null;
            if (data.billingLease?.viewerLeaveGraceMinutes) {
                window.__GPU_VIEWER_LEAVE_GRACE_MINUTES__ = data.billingLease.viewerLeaveGraceMinutes;
            }
            if (data.billingLease?.viewerSessionTtlMinutes) {
                setViewerIdleMs(data.billingLease.viewerSessionTtlMinutes * 60 * 1000);
            }
            this.canManageGpu = !!data.canManage;
            this.canStartBilling = !!data.canStartBilling;
            this.canStopBilling = !!data.canStopBilling;
            this.applyBillingOwnership(data.billingOwnership, { announce: true });
            this.syncConfiguredProvidersFromSettings(data.settings);

            this.syncGpuProviderSelect();

            const nextProviderId = this.savedGpuProviderId;
            if (
                prevProviderId
                && nextProviderId
                && prevProviderId !== nextProviderId
            ) {
                const label = (this.configuredProviders.find((p) => p.id === nextProviderId) || {}).label
                    || nextProviderId;
                this.showToast(`GPU provider is now ${label}.`);
            }

            const gpuErr = this.pickGpuStatusError(data, prevStatus);
            if (gpuErr) {
                this.showGpuErrorAlert(gpuErr, data.instance?.errorSource);
            } else if (prevStatus === 'error' && data.instance?.status !== 'error') {
                this.clearErrorAlertDedupe();
            }

            this.maybeStartGpuPolling();
            this.maybeStartGpuBillingHeartbeat();
            this.maybePrestageRecentFiles();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to load GPU settings.', {
                title: 'GPU problem'
            });
        }
    }

    stopGpuPolling() {
        if (this._gpuPollInterval) {
            clearInterval(this._gpuPollInterval);
            this._gpuPollInterval = null;
        }
    }

    maybeStartGpuPolling() {
        this.stopGpuPolling();
        if (!this.projectId) return;

        const providerId = this.savedGpuProviderId || 'local';
        const status = this.gpuInstance?.status || 'idle';
        // Always poll on the project page so collaborator provider/billing changes show up
        // without a hard refresh (including Local → Vast).
        const intervalMs = ['provisioning', 'stopping'].includes(status)
            ? 5000
            : (providerId !== 'local' && status === 'running')
                ? 20000
                : 12000;
        this._gpuPollInterval = setInterval(() => {
            this.loadProjectGpu().catch(() => {});
        }, intervalMs);
    }

    stopGpuBillingHeartbeat() {
        if (this._gpuBillingHeartbeatInterval) {
            clearInterval(this._gpuBillingHeartbeatInterval);
            this._gpuBillingHeartbeatInterval = null;
        }
    }

    maybeStartGpuBillingHeartbeat() {
        this.stopGpuBillingHeartbeat();
        const isRemoteRunning = this.gpuInstance?.status === 'running'
            && this.savedGpuProviderId !== 'local';
        if (!isRemoteRunning) return;

        const ping = () => {
            const viewerOpen = this.showIframe && !!this.iframeUrl && this.iframeUrl !== 'about:blank';
            const viewerActive = viewerOpen && isViewerUserActive();
            sendProjectGpuHeartbeat(this.projectId, { viewerActive })
                .then((data) => {
                    if (data.billingOwnership) {
                        this.applyBillingOwnership(data.billingOwnership);
                    }
                    if (data.ownershipTransferred && data.billingOwnership?.youOwnBilling) {
                        this._billingReceivedViaTransfer = true;
                        this.showToast('You now own GPU billing on this project.');
                    }
                    if (data.billingStopped) {
                        this.gpuInstance = data.instance || this.gpuInstance;
                        this.gpuBillingLease = null;
                        this.canStopBilling = false;
                        this.showErrorAlert(
                            this.formatGpuSessionEndedMessage(data.reason || data.instance?.errorMessage),
                            { title: 'GPU session ended', force: true }
                        );
                        this.stopGpuBillingHeartbeat();
                        this.stopGpuPolling();
                        return;
                    }
                    if (data.remoteActivity) {
                        this.remoteActivity = data.remoteActivity;
                    }
                    if (data.billingLease) {
                        this.gpuBillingLease = data.billingLease;
                    }
                })
                .catch((error) => {
                    if (error.status === 404) {
                        this.stopGpuBillingHeartbeat();
                        this.loadProjectGpu().catch(() => {});
                    }
                });
        };
        ping();
        this._gpuBillingHeartbeatInterval = setInterval(ping, 60000);
    }

    formatBillingTime(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString();
        } catch (_) {
            return iso;
        }
    }

    /** Persisted provider from the server — gates file open and billing. */
    get savedGpuProviderId() {
        return this.gpuActiveProviderId || this.gpuSettings?.providerId || 'local';
    }

    get useLocalFullSlicer() {
        return this.savedGpuProviderId === 'local'
            && getCachedLocalSlicerViewerOptions().useFullSlicer === true;
    }

    /**
     * Full desktop Slicer: local when pref is on, or Vast when server mode is full-slicer.
     * Soft-warm prepare stays local-only (useLocalFullSlicer).
     */
    get useFullSlicerViewer() {
        if (this.useLocalFullSlicer) return true;
        return this.savedGpuProviderId === 'vast' && this.vastGpuMode === 'full-slicer';
    }

    get useLocalSimplifiedViewer() {
        return this.useLocalFullSlicer
            && getCachedLocalSlicerViewerOptions().useSimplifiedViewer === true;
    }

    get selectedGpuProvider() {
        return this.gpuProviders.find((p) => p.id === this.savedGpuProviderId) || null;
    }

    /** Active provider — always matches persisted server settings. */
    get activeGpuProviderId() {
        return this.savedGpuProviderId;
    }

    get gpuStatusLabel() {
        const status = this.gpuInstance?.status || 'idle';
        const labels = {
            idle: 'Not running',
            provisioning: 'Provisioning GPU…',
            running: 'Billing active',
            stopping: 'Stopping…',
            error: 'Error'
        };
        return labels[status] || status;
    }

    get localViewerFriendlyLabel() {
        if (!this.useLocalFullSlicer) {
            return 'Standard Viewer';
        }
        if (this.useLocalSimplifiedViewer) {
            return 'Simplified Viewer';
        }
        return 'Full Slicer';
    }

    get gpuFriendlySummary() {
        if (this.savedGpuProviderId === 'local') {
            return 'Local';
        }
        const status = this.gpuInstance?.status || 'idle';
        if (!this.canStartBilling && status === 'idle') {
            return 'GPU not running — ask admin or collaborator';
        }
        if (status === 'provisioning') {
            if (this.remoteProvision?.failure) {
                return 'GPU start failed on Vast';
            }
            if (this.remoteProvision?.statusMessage) {
                return this.remoteProvision.statusMessage;
            }
            return 'Starting GPU…';
        }
        if (status === 'error' && this.gpuInstance?.errorMessage) {
            return this.gpuInstance.errorMessage;
        }
        const labels = {
            idle: 'GPU not running',
            running: 'Ready to open files',
            stopping: 'Shutting down…',
            error: 'GPU unavailable'
        };
        return labels[status] || 'GPU status unknown';
    }

    get showGpuInfoButton() {
        return this.savedGpuProviderId !== 'local';
    }

    getProviderConsoleUrl(providerId) {
        const fromApi = this.gpuProviders.find((p) => p.id === providerId)?.consoleUrl;
        return fromApi || GPU_PROVIDER_CONSOLE_URLS[providerId] || null;
    }

    get gpuDetailEntries() {
        if (this.savedGpuProviderId === 'local') {
            return [];
        }

        const entries = [];
        const provider = this.gpuProviders.find((p) => p.id === this.savedGpuProviderId);
        entries.push({
            label: 'Provider',
            value: provider?.label || this.savedGpuProviderId,
            href: this.getProviderConsoleUrl(this.savedGpuProviderId)
        });
        entries.push({ label: 'Status', value: this.gpuStatusLabel });

        if (this.gpuInstance?.status === 'provisioning' && this.remoteProvision) {
            if (this.remoteProvision.actualStatus) {
                entries.push({
                    label: 'Vast status',
                    value: this.remoteProvision.actualStatus
                });
            }
            if (this.remoteProvision.statusMessage) {
                entries.push({
                    label: 'Vast message',
                    value: this.remoteProvision.statusMessage
                });
            }
        }
        if (this.gpuInstance?.status === 'error' && this.gpuInstance?.errorMessage) {
            entries.push({ label: 'Error', value: this.gpuInstance.errorMessage });
        }

        if (this.gpuInstance?.metadata?.dph) {
            entries.push({
                label: 'Estimated cost',
                value: `~$${Number(this.gpuInstance.metadata.dph).toFixed(2)}/hr`
            });
        }
        if (this.gpuInstance?.status === 'running' && this.gpuInstance.gpuHost) {
            entries.push({ label: 'Host', value: this.gpuInstance.gpuHost });
        }
        if (this.gpuInstance?.status === 'running' && this.remoteActivity) {
            if (this.remoteActivity.hasActiveSession) {
                entries.push({ label: 'Viewer', value: 'Active' });
            } else if (this.remoteActivity.sessionCount === 0) {
                entries.push({ label: 'Viewer', value: 'Idle (no scene open)' });
            }
        }
        if (this.gpuInstance?.status === 'running' && this.gpuPrestageActive) {
            entries.push({
                label: 'Files',
                value: 'Preparing recent scenes on the GPU…'
            });
        }
        if (this.gpuBillingLease && this.gpuInstance?.status === 'running') {
            const lease = this.gpuBillingLease;
            let billing = `Auto-stops after ${lease.idleMinutes} min idle`;
            if (lease.idleShutdownAt) {
                billing += ` (by ${this.formatBillingTime(lease.idleShutdownAt)})`;
            }
            if (lease.wallEndsAt) {
                billing += `; max ${lease.maxWallMinutes} min (ends ${this.formatBillingTime(lease.wallEndsAt)})`;
            }
            entries.push({ label: 'Billing limits', value: billing });
            entries.push({
                label: 'Viewer sessions',
                value: `Leaving this tab stops the viewer after ${lease.viewerLeaveGraceMinutes ?? 10} min. `
                    + `Viewer and billing stop ~${lease.viewerSessionTtlMinutes ?? 30} min after last interaction. `
                    + 'Other browser tabs can stay open for side-by-side compare.'
            });
        }
        if (this.canStartBilling) {
            entries.push({
                label: 'Note',
                value: 'Start billing before opening files. Scenes copy to the GPU when opened.'
            });
        } else if (this.canManageGpu) {
            entries.push({
                label: 'Note',
                value: 'Add remote credentials, then start billing before opening files.'
            });
        } else {
            entries.push({
                label: 'Note',
                value: 'A project admin or collaborator manages GPU billing.'
            });
        }
        if (this.billingOwnership?.billingOwner?.username && this.gpuInstance?.status === 'running') {
            const ownerLabel = this.billingOwnership.youOwnBilling
                ? 'You'
                : this.billingOwnership.billingOwner.username;
            entries.push({ label: 'Billing owner', value: ownerLabel });
        }
        return entries;
    }

    get gpuPanelSummaryMeta() {
        const provider = this.configuredProviders.find((p) => p.id === this.savedGpuProviderId);
        const label = provider?.label || (this.savedGpuProviderId === 'local' ? 'Local' : this.savedGpuProviderId);
        if (this.savedGpuProviderId === 'local') {
            return `${label} · ${this.localViewerFriendlyLabel}`;
        }
        return `${label} · ${this.gpuFriendlySummary}`;
    }

    handleGpuPanelToggle(event) {
        this.gpuPanelOpen = event.target.open;
    }

    toggleGpuDetails() {
        this.gpuDetailsOpen = !this.gpuDetailsOpen;
    }

    renderGpuProviderDetailValue(entry) {
        if (!entry.href) {
            return entry.value;
        }
        return html`
            <span class="gpu-detail-value-with-link">
                <span>${entry.value}</span>
                <a
                    class="gpu-console-link"
                    href=${entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open ${entry.value} console"
                    aria-label="Open ${entry.value} console"
                    @click=${(e) => e.stopPropagation()}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-7.59 7.59L10 14.17 19.41 4.83V8h2V3h-7z"></path>
                    </svg>
                </a>
            </span>
        `;
    }

    get canStartGpuBilling() {
        return this.canStartGpuBillingNow({ ignoreBusy: false });
    }

    canStartGpuBillingNow({ ignoreBusy = false } = {}) {
        return this.canStartBilling
            && this.savedGpuProviderId !== 'local'
            && this.isGpuProviderConfigured(this.savedGpuProviderId)
            && ['idle', 'error'].includes(this.gpuInstance?.status || 'idle')
            && (ignoreBusy || !this.gpuBillingBusy)
            && !this.gpuSaving;
    }

    get canStopGpuBilling() {
        const inst = this.gpuInstance;
        if (!this.canStopBilling || this.gpuBillingBusy) return false;
        if (inst?.status === 'provisioning') return true;
        if (inst?.status === 'stopping') return true;
        if (inst?.status === 'error' && inst?.instanceId) return true;
        return inst?.status === 'running' && !!inst?.instanceId;
    }

    get showGpuBillingActions() {
        return this.savedGpuProviderId !== 'local'
            && (this.canStartBilling || this.canStopBilling);
    }

    applyBillingOwnership(ownership, { announce = false } = {}) {
        const prev = this.billingOwnership;
        const prevOwned = prev?.youOwnBilling === true;
        const hadSnapshot = prev != null;
        this.billingOwnership = ownership || null;
        const becameOwner = !prevOwned && ownership?.youOwnBilling === true;
        // Only mark transfer when ownership flips during a session — not first paint as starter/owner.
        if (becameOwner && hadSnapshot && this.gpuInstance?.status === 'running') {
            this._billingReceivedViaTransfer = true;
        }
        if (!ownership?.youOwnBilling) {
            this._billingReceivedViaTransfer = false;
        }
        if (
            announce
            && hadSnapshot
            && becameOwner
            && this.gpuInstance?.status === 'running'
        ) {
            this.showToast('You now own GPU billing on this project.');
        }
    }

    get otherActiveBillingUsers() {
        const selfId = this.billingOwnership?.billingOwner?.userId;
        const users = this.billingOwnership?.activeUsers || [];
        return users.filter((u) => u.userId !== selfId);
    }

    shouldPromptTransferredOwnerOnViewerClose() {
        if (this.savedGpuProviderId === 'local') return false;
        if (this.gpuInstance?.status !== 'running') return false;
        if (!this.billingOwnership?.youOwnBilling) return false;
        if (!this._billingReceivedViaTransfer) return false;
        if (!this.canStopBilling) return false;
        return this.otherActiveBillingUsers.length === 0;
    }

    openOwnerBillingPrompt() {
        this.ownerBillingPromptStep = 'ask';
        this._ownerPromptClosingProgrammatically = false;
        requestAnimationFrame(() => {
            const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
            if (!dialog) return;
            dialog.lightDismiss = true;
            dialog.showDefaultCloseButton = true;
            dialog.title = 'You own this GPU session';
            dialog.openDialog();
            const native = dialog.nativeDialog;
            if (native && !native._ownerPromptCloseBound) {
                native.addEventListener('close', () => this.handleOwnerBillingPromptNativeClose());
                native._ownerPromptCloseBound = true;
            }
        });
    }

    handleOwnerBillingPromptNativeClose() {
        if (this._ownerPromptClosingProgrammatically) {
            this._ownerPromptClosingProgrammatically = false;
            return;
        }
        // Dismissed ask (X / backdrop) → friendly reminder that requires acknowledgement.
        if (this.ownerBillingPromptStep === 'ask') {
            this.ownerBillingPromptStep = 'remind';
            requestAnimationFrame(() => {
                const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
                if (!dialog) return;
                dialog.lightDismiss = false;
                dialog.showDefaultCloseButton = true;
                dialog.title = 'Remember to stop billing';
                dialog.openDialog();
            });
            return;
        }
        this.ownerBillingPromptStep = '';
    }

    closeOwnerBillingPrompt() {
        this._ownerPromptClosingProgrammatically = true;
        this.renderRoot?.querySelector('#gpu-owner-billing-prompt')?.closeDialog?.();
        this.ownerBillingPromptStep = '';
    }

    handleOwnerBillingPromptKeepRunning() {
        this._ownerPromptClosingProgrammatically = true;
        const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
        dialog?.closeDialog?.();
        this.ownerBillingPromptStep = 'remind';
        requestAnimationFrame(() => {
            this._ownerPromptClosingProgrammatically = false;
            if (!dialog) return;
            dialog.lightDismiss = false;
            dialog.showDefaultCloseButton = true;
            dialog.title = 'Remember to stop billing';
            dialog.openDialog();
        });
    }

    acknowledgeOwnerBillingReminder() {
        this.closeOwnerBillingPrompt();
    }

    async handleOwnerBillingPromptStop() {
        if (!this.canStopGpuBilling) {
            this.closeOwnerBillingPrompt();
            return;
        }
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this._billingReceivedViaTransfer = false;
            this.closeOwnerBillingPrompt();
            this.showToast('Stopping GPU billing…');
            this.maybeStartGpuPolling();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    formatGpuSessionEndedMessage(reason) {
        const detail = reason ? ` (${reason})` : '';
        return `Your GPU session ended${detail}. Billing may have been stopped by another user, idle timeout, or transfer exhaustion.`;
    }

    get stopBillingImpactNames() {
        const users = this.stopBillingImpact?.activeUsers || [];
        return users.map((u) => u.username || `User ${u.userId}`).join(', ');
    }

    get stopBillingTransferLabel() {
        const target = this.stopBillingImpact?.transferTarget
            || this.billingOwnership?.transferTarget;
        if (!target) return 'Transfer ownership';
        return `Transfer to ${target.username || `User ${target.userId}`}`;
    }

    async handleStartGpuBilling() {
        if (!this.canStartGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            // Refresh first so we don't race a collaborator who already started.
            await this.loadProjectGpu();
            // Ignore busy flag here — we set it for this in-flight start.
            if (!this.canStartGpuBillingNow({ ignoreBusy: true })) {
                this.showToast(
                    this.gpuInstance?.status === 'provisioning' || this.gpuInstance?.status === 'running'
                        ? 'GPU billing was already started by someone on this project.'
                        : 'GPU billing is not available to start right now.'
                );
                return;
            }
            const data = await startProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.canStopBilling = true;
            this._billingReceivedViaTransfer = false;
            this.clearErrorAlertDedupe();
            this.showToast('GPU provisioning started.');
            this.maybeStartGpuPolling();
        } catch (error) {
            if (error.status === 409) {
                await this.loadProjectGpu().catch(() => {});
                this.showToast(error.message || 'GPU billing was already started on this project.');
                return;
            }
            this.showErrorAlert(error.message || 'Unable to start GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleStopGpuBilling() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.showToast('Stopping GPU billing…');
            this.maybeStartGpuPolling();
        } catch (error) {
            if (error.status === 409 && error.code === 'billing_stop_impact') {
                this.stopBillingImpact = error.impact || error.payload?.impact || null;
                if (error.payload?.billingOwnership) {
                    this.applyBillingOwnership(error.payload.billingOwnership);
                }
                this.renderRoot?.querySelector('#gpu-stop-billing-dialog')?.openDialog();
                return;
            }
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    closeStopBillingDialog() {
        this.renderRoot?.querySelector('#gpu-stop-billing-dialog')?.closeDialog?.();
        this.stopBillingImpact = null;
    }

    async handleConfirmStopBillingAnyway() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.closeStopBillingDialog();
            this.showToast('Stopping GPU billing…');
            this.maybeStartGpuPolling();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleTransferGpuBilling() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await transferProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.closeStopBillingDialog();
            if (data.transferred) {
                const name = data.owner?.username || 'another user';
                this.showToast(`GPU billing transferred to ${name}.`);
            } else if (data.stopped) {
                this.showToast('No active users to transfer to — stopping billing.');
                this.maybeStartGpuPolling();
            }
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to transfer GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleLaunchFile(file) {
        // Immediate feedback — remote open can wait on prestage/sync with no network logs in DevTools.
        this.launchingFileId = file.id;
        this.viewerLoading = true;
        this.viewerLoadingDetail = 'Checking GPU status…';
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        this.currentFileName = file.originalName;
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            // Skip a full reload when we already know remote billing is running.
            if (!(this.usesRemoteGpuProvider() && this.isRemoteGpuRunning())) {
                await this.loadProjectGpu();
            }
        } catch (_) {
            // launch checks below still apply with last-known state
        }

        const gpuBlock = this.getRemoteGpuLaunchBlockMessage();
        if (gpuBlock) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this.currentFileName = '';
            this.showErrorAlert(gpuBlock, { title: 'GPU not ready', force: true });
            return;
        }

        if (this.useFullSlicerViewer) {
            // Full Slicer path manages its own overlay state.
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            await this.handleLaunchFullSlicer(file);
            return;
        }

        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.viewerLoadingDetail = `Starting viewer for ${file.originalName}…`;

        try {
            this.stopTrameHeartbeat();
            if (this.isRemoteGpuRunning()) {
                this.viewerLoadingDetail = this.isFileStagedOnGpu(file)
                    ? `Opening ${file.originalName} on GPU…`
                    : `Copying ${file.originalName} to GPU (large scenes can take a few minutes)…`;
            } else {
                this.viewerLoadingDetail = `Preparing session for ${file.originalName}…`;
            }

            // Sync lives in /containers/start (waits on shared prestage job, then syncs).
            // Do not await a separate prestage here — that doubled work and delayed open.

            const response = await fetch(`${API_URL}/api/containers/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fileId: file.id, projectId: this.projectId })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(this.parseApiErrorMessage(data, 'Failed to launch file'));
            }

            this._viewerSessionToken = data.sessionToken || null;
            const url = resolveTramePageUrl(data.frontendUrl);
            if (!url) {
                throw new Error('Trame did not return a viewer URL.');
            }

            this.viewerLoadingDetail = `Loading ${file.originalName}…`;
            this.iframeUrl = url;
            markViewerActivity();
            this.showToast(`Launched ${file.originalName}`);
            this.startTrameHeartbeat();
        } catch (error) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerKind = VIEWER_KINDS.TRAME;
            this.viewerSimplified = false;
            this.currentFileName = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this.showErrorAlert(error.message || 'Unable to launch file.', {
                title: 'Unable to open file',
                force: true
            });
        }
    }

    get viewerChromeLabel() {
        return viewerDisplayName(this.viewerKind || VIEWER_KINDS.TRAME, {
            simplified: this.viewerSimplified
        });
    }

    get viewerLoadingMessage() {
        if (this.viewerLoadingDetail) {
            return this.viewerLoadingDetail;
        }
        const name = this.currentFileName || 'scene';
        if (this.isRemoteGpuRunning()) {
            return `Starting GPU viewer for ${name}… Large scenes can take 1–3 minutes on the GPU.`;
        }
        return `Opening ${name}… Large scenes can take 1–3 minutes.`;
    }

    handleViewerIframeLoad() {
        if (this.iframeUrl && this.iframeUrl !== 'about:blank') {
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            markViewerActivity();
            this.attachViewerIframeActivityTracking();
        }
    }

    attachViewerIframeActivityTracking() {
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }

        try {
            const iframe = this.renderRoot?.querySelector('.trame-iframe');
            const iframeDoc = iframe?.contentWindow?.document;
            if (!iframeDoc) return;

            const onActivity = () => markViewerActivity();
            const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
            events.forEach((eventName) => {
                iframeDoc.addEventListener(eventName, onActivity, { passive: true, capture: true });
            });

            this._viewerIframeActivityCleanup = () => {
                events.forEach((eventName) => {
                    iframeDoc.removeEventListener(eventName, onActivity, { capture: true });
                });
            };
        } catch (_) {
            // Cross-origin iframe: rely on postMessage from the viewer.
        }
    }

    async handleViewerInactivityTimeout() {
        if (!this.showIframe) return;
        this.showToast('Viewer closed after inactivity');
        // Walk-away with an open viewer: tear down the seat (do not leave warm forever).
        await this.closeIframe({ releaseMode: VIEWER_RELEASE_MODES.HARD, skipOwnerBillingPrompt: true });
        if (
            this.savedGpuProviderId !== 'local'
            && this.canStopBilling
            && this.gpuInstance?.status === 'running'
        ) {
            try {
                const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
                this.gpuInstance = data.instance;
                this.gpuBillingLease = null;
                if (data.billingOwnership) {
                    this.applyBillingOwnership(data.billingOwnership);
                }
                this.showToast('GPU billing stopped after inactivity');
                this.maybeStartGpuPolling();
            } catch (error) {
                console.warn('GPU billing stop after idle failed:', error.message);
            }
        }
    }

    startTrameHeartbeat() {
        this.stopTrameHeartbeat();
        const kind = this.viewerKind || VIEWER_KINDS.TRAME;
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind,
            projectId: this.projectId
        });
        const ping = () => {
            sendTrameContainerHeartbeat({
                sessionToken: this._viewerSessionToken,
                projectId: this.projectId,
                heartbeatUrl,
                includeUserActive: kind === VIEWER_KINDS.TRAME,
                onIdleTimeout: () => this.handleViewerInactivityTimeout()
            }).catch(() => {});
        };
        ping();
        this._trameHeartbeatInterval = setInterval(ping, kind === VIEWER_KINDS.SLICER_GUI ? 30000 : 60000);
    }

    stopTrameHeartbeat() {
        if (this._trameHeartbeatInterval) {
            clearInterval(this._trameHeartbeatInterval);
            this._trameHeartbeatInterval = null;
        }
    }

    async cleanupContainerSession(projectId = null, overrides = {}) {
        const kind = overrides.kind || this.viewerKind || VIEWER_KINDS.TRAME;
        const token = overrides.sessionToken !== undefined
            ? overrides.sessionToken
            : this._viewerSessionToken;
        const mode = overrides.mode || defaultReleaseModeForClose(kind);
        if (overrides.sessionToken === undefined) {
            this._viewerSessionToken = null;
        } else if (token && token === this._viewerSessionToken) {
            this._viewerSessionToken = null;
        }
        const { stopUrl } = getViewerSessionEndpoints({
            kind,
            projectId: projectId || this.projectId
        });
        await stopViewerSession({
            stopUrl,
            sessionToken: token,
            body: buildViewerStopBody({
                kind,
                sessionToken: token,
                projectId: projectId || this.projectId,
                mode
            })
        });
    }

    /**
     * Close overlay UI and stop heartbeats without releasing the session
     * (used when handing Full Slicer off to a standalone window).
     */
    detachViewerOverlay() {
        this.stopTrameHeartbeat();
        resetViewerActivity();
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this._viewerSessionToken = null;
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
    }

    openViewerInNewWindow() {
        if (!this.iframeUrl || this.iframeUrl === 'about:blank') return;

        let targetUrl = this.iframeUrl;
        const handoffSlicerGui = this.viewerKind === VIEWER_KINDS.SLICER_GUI;
        if (handoffSlicerGui) {
            try {
                const parsed = new URL(this.iframeUrl, window.location.href);
                parsed.searchParams.delete('embed');
                targetUrl = parsed.href;
            } catch (_) {
                /* keep as-is */
            }
        }

        const width = Math.min(1400, window.screen.width * 0.9);
        const height = Math.min(900, window.screen.height * 0.9);
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const popup = window.open(
            targetUrl,
            'slicer-viewer',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        if (!popup) {
            this.showErrorAlert('Pop-up blocked. Allow pop-ups for this site and try again.', {
                title: 'Unable to open window',
                force: true
            });
            return;
        }
        if (handoffSlicerGui) {
            // Standalone loader owns heartbeat/soft-release once embed is removed.
            this.detachViewerOverlay();
        }
    }

    async closeIframe({ releaseMode = null, skipOwnerBillingPrompt = false } = {}) {
        const kind = this.viewerKind || VIEWER_KINDS.TRAME;
        const mode = releaseMode || defaultReleaseModeForClose(kind);
        const promptAfterClose = !skipOwnerBillingPrompt
            && this.shouldPromptTransferredOwnerOnViewerClose();
        this.stopTrameHeartbeat();
        resetViewerActivity();
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        await this.cleanupContainerSession(this.projectId, { kind, mode });
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        if (this.savedGpuProviderId !== 'local' && this.gpuInstance?.status === 'running') {
            sendProjectGpuHeartbeat(this.projectId, { viewerActive: false }).catch(() => {});
        }
        if (promptAfterClose) {
            this.openOwnerBillingPrompt();
        }
    }

    async handleDownloadFile(file) {
        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                credentials: 'include'
            });
            if (!response.ok) {
                let message = 'Failed to download file';
                try {
                    const data = await response.json();
                    message = data?.error?.message || data?.message || message;
                } catch (_) {
                    // ignore
                }
                throw new Error(message);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.originalName;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to download file.', {
                title: 'Download failed',
                force: true
            });
        }
    }

    async handleDeleteFile(file) {
        if (!this.canDeleteProjectFiles) return;
        const confirmed = window.confirm(`Delete ${file.originalName}?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) {
                let message = 'Failed to delete file';
                try {
                    const data = await response.json();
                    message = data?.error?.message || data?.message || message;
                } catch (_) {
                    // ignore
                }
                throw new Error(message);
            }

            await this.loadProjectFiles();
            this.showToast('File deleted successfully.');
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to delete file.', {
                title: 'Delete failed',
                force: true
            });
        }
    }

    openCollaboratorDialog() {
        if (!this.canEditCollaborators) return;
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        const collaboratorSearch = this.renderRoot?.querySelector('collaborator-search');
        collaboratorSearch?.startSession(this.collaborators);
        dialog?.openDialog();
    }

    closeCollaboratorDialog() {
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        dialog?.closeDialog();
    }

    handleCollaboratorsDone(event) {
        this.collaborators = this.sortCollaborators(event.detail.collaborators);
        this.closeCollaboratorDialog();
    }

    handleCollaboratorRoleChange(event) {
        if (!this.canEditCollaborators) return;
        const { user, role } = event.detail;
        this.collaborators = this.sortCollaborators(this.collaborators.map((entry) => (
            entry.user.id === user.id ? { ...entry, role } : entry
        )));
    }

    handleRemoveCollaborator(event) {
        if (!this.canEditCollaborators) return;
        const { user } = event.detail;
        this.collaborators = this.sortCollaborators(this.collaborators.filter((entry) => entry.user.id !== user.id));
    }

    handleCancelCollaboratorChanges() {
        this.collaborators = this.sortCollaborators(this.originalCollaborators.map((entry) => ({ ...entry })));
    }

    async handleSaveCollaborators() {
        if (!this.canEditCollaborators || !this.hasPendingCollaboratorChanges) return;
        this.saving = true;

        try {
            const payload = this.collaborators.map((entry) => ({
                userId: entry.user.id,
                role: entry.role
            }));
            await updateProjectCollaborators(this.projectId, payload);
            this.originalCollaborators = this.sortCollaborators(this.collaborators.map((entry) => ({ ...entry })));
            this.showToast('Collaborators updated.');
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to save collaborator changes.', {
                title: 'Unable to save',
                force: true
            });
        } finally {
            this.saving = false;
        }
    }

    render() {
        return html`
            <page-layout-template
                .menuItems=${this.menuItems}
                .username=${this.username}
                selectedMenuKey="my-projects"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle=${this.projectName || 'Project'}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.loading ? html`
                    <div slot="content" class="status-note">Loading project...</div>
                ` : ''}
                ${!this.loading ? html`
                    <div slot="content" class="collaborators-panel">
                        <div class="collaborators-title">Collaborators (${this.collaborators.length})</div>
                        ${this.collaborators.length === 0 ? html`
                            <div class="empty-note">No collaborators yet.</div>
                        ` : html`
                            <div class="collaborators-list">
                                ${this.collaborators.map((entry) => html`
                                    <div class="collaborator-row">
                                        <collaborator-result-row
                                            .user=${entry.user}
                                            mode="selected"
                                            .role=${entry.role}
                                            .selectedRole=${entry.role}
                                            .isRoleEditable=${this.canEditCollaborators}
                                            .showRemoveButton=${this.canEditCollaborators}
                                            @role-change=${(event) => this.handleCollaboratorRoleChange(event)}
                                            @remove-collaborator=${(event) => this.handleRemoveCollaborator(event)}
                                        ></collaborator-result-row>
                                    </div>
                                `)}
                            </div>
                        `}
                        ${this.canEditCollaborators ? html`
                            <add-button
                                title="Add Collaborators"
                                @add-button-click=${() => this.openCollaboratorDialog()}
                            ></add-button>
                        ` : ''}
                        ${this.canEditCollaborators && this.hasPendingCollaboratorChanges ? html`
                            <div class="section-actions">
                                <button
                                    class="secondary-button"
                                    type="button"
                                    ?disabled=${this.saving}
                                    @click=${() => this.handleCancelCollaboratorChanges()}
                                >
                                    Cancel
                                </button>
                                <button
                                    class="primary-button"
                                    type="button"
                                    ?disabled=${this.saving}
                                    @click=${() => this.handleSaveCollaborators()}
                                >
                                    ${this.saving ? 'Saving...' : 'Save'}
                                </button>
                            </div>
                        ` : ''}
                    </div>
                    <div slot="content" class="gpu-panel">
                        <div class="gpu-panel-header">
                            <details
                                class="gpu-panel-details"
                                ?open=${this.gpuPanelOpen}
                                @toggle=${(e) => this.handleGpuPanelToggle(e)}
                            >
                                <summary>
                                    <span class="gpu-panel-summary-label">GPU Provider</span>
                                    <span class="gpu-panel-chevron" aria-hidden="true">▸</span>
                                    <span class="gpu-panel-summary-meta">${this.gpuPanelSummaryMeta}</span>
                                </summary>
                                <div class="gpu-panel-body">
                                    ${this.canManageGpu ? html`
                                        <div class="gpu-title-row">
                                            <div class="gpu-title" style="margin-bottom: 0;">Providers</div>
                                            <add-button
                                                title="Add Provider"
                                                @add-button-click=${() => this.openGpuProviderDialog()}
                                            ></add-button>
                                        </div>
                                    ` : ''}
                                    ${this.canManageGpu ? html`
                                        <div class="gpu-field">
                                            <label for="gpu-provider">GPU Provider to use:</label>
                                            <select
                                                id="gpu-provider"
                                                .value=${this.gpuActiveProviderId}
                                                ?disabled=${this.gpuSaving}
                                                @change=${(e) => this.handleGpuProviderChange(e)}
                                            >
                                                ${this.configuredProviders.map((provider) => html`
                                                    <option
                                                        value=${provider.id}
                                                        ?selected=${this.gpuActiveProviderId === provider.id}
                                                    >
                                                        ${provider.label}
                                                    </option>
                                                `)}
                                            </select>
                                        </div>
                                        ${this.isGpuProviderConfigured(this.gpuActiveProviderId)
                                            && this.gpuActiveProviderId !== 'local' ? html`
                                            <button
                                                class="secondary-button"
                                                type="button"
                                                ?disabled=${this.gpuSaving}
                                                @click=${() => this.openGpuProviderDialog(this.gpuActiveProviderId)}
                                            >
                                                Configure ${(this.configuredProviders.find((p) => p.id === this.gpuActiveProviderId) || {}).label || 'provider'}…
                                            </button>
                                        ` : ''}
                                        ${this.gpuSaving ? html`
                                            <div class="gpu-hint">Updating…</div>
                                        ` : ''}
                                        ${this.configuredProviders.length === 1 ? html`
                                            <div class="gpu-hint">Add a cloud GPU option to run larger files remotely.</div>
                                        ` : ''}
                                    ` : html`
                                        <div class="gpu-hint">
                                            Using ${(this.configuredProviders.find((p) => p.id === this.activeGpuProviderId) || { label: 'Local' }).label}
                                        </div>
                                    `}
                                    ${this.showGpuInfoButton ? html`
                                        <div class="gpu-status-row">
                                            <button
                                                class="gpu-info-button"
                                                type="button"
                                                aria-label="GPU details"
                                                title="GPU details"
                                                aria-expanded=${this.gpuDetailsOpen ? 'true' : 'false'}
                                                @click=${() => this.toggleGpuDetails()}
                                            >
                                                <svg class="gpu-info-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path fill="currentColor" d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"></path>
                                                </svg>
                                            </button>
                                        </div>
                                        ${this.gpuDetailsOpen ? html`
                                            <div class="gpu-details">
                                                ${this.gpuDetailEntries.map((entry) => html`
                                                    <div class="gpu-detail-row">
                                                        <div class="gpu-detail-label">${entry.label}</div>
                                                        <div class="gpu-detail-value">
                                                            ${entry.label === 'Provider'
                                                                ? this.renderGpuProviderDetailValue(entry)
                                                                : entry.value}
                                                        </div>
                                                    </div>
                                                `)}
                                            </div>
                                        ` : ''}
                                    ` : ''}
                                </div>
                            </details>
                            ${this.showGpuBillingActions ? html`
                                <div class="gpu-panel-billing-actions">
                                    <button
                                        class="primary-button"
                                        type="button"
                                        ?disabled=${!this.canStartGpuBilling}
                                        @click=${() => this.handleStartGpuBilling()}
                                    >
                                        ${this.gpuBillingBusy && this.gpuInstance?.status !== 'running' ? 'Working…' : 'Start Billing'}
                                    </button>
                                    <button
                                        class="secondary-button"
                                        type="button"
                                        ?disabled=${!this.canStopGpuBilling}
                                        @click=${() => this.handleStopGpuBilling()}
                                    >
                                        Stop Billing
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div slot="content" class="files-panel">
                        <div class="files-title">Project Files</div>
                        ${this.loadingProjectFiles ? html`
                            <div class="empty-note">Loading project files...</div>
                        ` : ''}
                        ${!this.loadingProjectFiles && this.projectFiles.length === 0 ? html`
                            <div class="empty-note">No files have been added to this project yet.</div>
                        ` : ''}
                        ${this.projectFiles.length > 0 ? html`
                            <div class="file-list">
                                ${this.projectFiles.map((file) => html`
                                    <file-list-row
                                        .fileName=${file.originalName}
                                        .metaLine=${this.formatProjectFileMetaLine(file)}
                                        .nameButtonDisabled=${this.viewerLoading || !!this.getRemoteGpuLaunchBlockMessage()}
                                        .nameButtonTitle=${this.getFileLaunchTitle(file)}
                                        @name-click=${() => this.handleLaunchFile(file)}
                                        @mouseenter=${() => this.handleFileHover(file)}
                                    >
                                        <button
                                            slot="actions"
                                            class="file-icon-button"
                                            type="button"
                                            aria-label="Download file"
                                            title="Download file"
                                            @click=${() => this.handleDownloadFile(file)}
                                        >
                                            <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h2z"></path>
                                            </svg>
                                        </button>
                                        ${this.canDeleteProjectFiles ? html`
                                            <button
                                                slot="actions"
                                                class="file-icon-button"
                                                type="button"
                                                aria-label="Delete file"
                                                title="Delete file"
                                                @click=${() => this.handleDeleteFile(file)}
                                            >
                                                <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path fill="currentColor" d="M9 3h6l1 2h4v2h-2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7H4V5h4l1-2zm7 4H8v13h8V7zm-6 3h2v7h-2v-7zm4 0h2v7h-2v-7z"></path>
                                                </svg>
                                            </button>
                                        ` : ''}
                                    </file-list-row>
                                `)}
                            </div>
                        ` : ''}
                        ${this.canUploadFiles ? html`
                            <add-button
                                title="Add Files"
                                @add-button-click=${() => this.openFileUploadDialog()}
                            ></add-button>
                        ` : ''}
                    </div>
                    <div slot="content" class="section-actions">
                        <button class="secondary-button" type="button" @click=${() => this.handleBackToProjects()}>
                            Back to My Projects
                        </button>
                    </div>
                ` : ''}
            </page-layout-template>
            <app-dialog id="error-alert-dialog" title=${this.errorAlertTitle || 'Something went wrong'}>
                <p class="error-alert-message">${this.errorAlertMessage}</p>
                <button
                    slot="actions"
                    class="primary-button"
                    type="button"
                    @click=${() => this.dismissErrorAlert()}
                >
                    ${this.errorAlertDismissLabel}
                </button>
            </app-dialog>
            <app-dialog id="collaborator-dialog" title="Add Collaborators">
                <collaborator-search
                    @collaborators-cancel=${() => this.closeCollaboratorDialog()}
                    @collaborators-done=${(event) => this.handleCollaboratorsDone(event)}
                ></collaborator-search>
            </app-dialog>
            <app-dialog id="file-upload-dialog" title="Add Files to Project">
                <div class="upload-area ${this.dragOver ? 'drag-over' : ''}"
                    @dragover=${this.handleDragOver}
                    @dragleave=${this.handleDragLeave}
                    @drop=${this.handleDrop}
                >
                    <div class="upload-message">Drag and drop a file here, or choose a file to upload.</div>
                    <input
                        type="file"
                        id="project-upload-input"
                        @change=${this.handleFileSelect}
                        ?disabled=${this.uploading}
                    />
                    <button
                        class="upload-button secondary"
                        type="button"
                        ?disabled=${this.uploading}
                        @click=${() => this.renderRoot?.querySelector('#project-upload-input')?.click()}
                    >
                        Choose File
                    </button>
                    ${this.selectedFile ? html`
                        <div class="upload-file-info">
                            Selected: ${this.selectedFile.name} (${this.formatBytes(this.selectedFile.size)})
                        </div>
                        <div class="upload-actions">
                            <button
                                class="upload-button"
                                type="button"
                                ?disabled=${this.uploading}
                                @click=${() => this.uploadFileToProject()}
                            >
                                ${this.uploading ? 'Uploading...' : 'Upload File'}
                            </button>
                            <button
                                class="upload-button secondary"
                                type="button"
                                ?disabled=${this.uploading}
                                @click=${() => this.closeFileUploadDialog()}
                            >
                                Cancel
                            </button>
                        </div>
                    ` : ''}
                </div>
            </app-dialog>
            <app-dialog id="gpu-provider-dialog" title=${this.gpuProviderDialogTitle}>
                <div class="gpu-dialog-form">
                    <div class="gpu-field">
                        <label for="gpu-dialog-provider">Provider</label>
                        <select
                            id="gpu-dialog-provider"
                            .value=${this.gpuDialogProviderId}
                            @change=${(e) => this.handleGpuDialogProviderChange(e)}
                        >
                            ${this.gpuDialogProviderOptions.map((provider) => html`
                                <option value=${provider.id}>${provider.label}</option>
                            `)}
                        </select>
                    </div>
                    <div class="gpu-field">
                        <label for="gpu-dialog-api-key">API key</label>
                        <input
                            id="gpu-dialog-api-key"
                            type="password"
                            placeholder=${this.gpuDialogApiKeyPlaceholder}
                            .value=${this.gpuDialogApiKey}
                            @input=${(e) => this.handleGpuDialogApiKeyInput(e)}
                        />
                    </div>
                    <label class="gpu-dialog-checkbox">
                        <input
                            type="checkbox"
                            .checked=${this.gpuDialogUseNow}
                            @change=${(e) => this.handleGpuDialogUseNowChange(e)}
                        />
                        Use now
                    </label>
                    <div class="gpu-dialog-actions">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuDialogSaving}
                            @click=${() => this.closeGpuProviderDialog()}
                        >
                            Cancel
                        </button>
                        <button
                            class="primary-button"
                            type="button"
                            ?disabled=${this.gpuDialogSaving}
                            @click=${() => this.handleSaveGpuProviderDialog()}
                        >
                            ${this.gpuDialogSaving ? 'Saving…' : 'Save'}
                        </button>
                    </div>
                </div>
            </app-dialog>
            <app-dialog id="gpu-stop-billing-dialog" title="Stop GPU billing?">
                <div class="gpu-dialog-form">
                    <p class="error-alert-message">
                        Stopping billing will impact
                        ${this.stopBillingImpactNames || 'other active users'}
                        and end their GPU sessions.
                    </p>
                    <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy}
                            @click=${() => this.closeStopBillingDialog()}
                        >
                            Cancel
                        </button>
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy || !(this.stopBillingImpact?.transferTarget || this.billingOwnership?.transferTarget)}
                            @click=${() => this.handleTransferGpuBilling()}
                        >
                            ${this.stopBillingTransferLabel}
                        </button>
                        <button
                            class="primary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy}
                            @click=${() => this.handleConfirmStopBillingAnyway()}
                        >
                            ${this.gpuBillingBusy ? 'Working…' : 'Stop anyway'}
                        </button>
                    </div>
                </div>
            </app-dialog>
            <app-dialog
                id="gpu-owner-billing-prompt"
                title=${this.ownerBillingPromptStep === 'remind' ? 'Remember to stop billing' : 'You own this GPU session'}
                .lightDismiss=${this.ownerBillingPromptStep !== 'remind'}
            >
                <div class="gpu-dialog-form">
                    ${this.ownerBillingPromptStep === 'remind' ? html`
                        <p class="error-alert-message">
                            Okay. Remember to stop billing when you’re done so the project isn’t charged longer than needed.
                        </p>
                        <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                            <button
                                class="primary-button"
                                type="button"
                                @click=${() => this.acknowledgeOwnerBillingReminder()}
                            >
                                Okay
                            </button>
                        </div>
                    ` : html`
                        <p class="error-alert-message">
                            Billing ownership was transferred to you, and nobody else is actively using this GPU right now.
                            Are you done for now — should we stop billing?
                        </p>
                        <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.gpuBillingBusy}
                                @click=${() => this.handleOwnerBillingPromptKeepRunning()}
                            >
                                Not yet
                            </button>
                            <button
                                class="primary-button"
                                type="button"
                                ?disabled=${this.gpuBillingBusy}
                                @click=${() => this.handleOwnerBillingPromptStop()}
                            >
                                ${this.gpuBillingBusy ? 'Stopping…' : 'Yes, stop billing'}
                            </button>
                        </div>
                    `}
                </div>
            </app-dialog>
            ${this.showIframe ? html`
                <div class="iframe-overlay">
                    <div class="iframe-header">
                        <div class="iframe-title">${this.viewerChromeLabel}: ${this.currentFileName}</div>
                        <div class="iframe-header-actions">
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.iframeUrl === 'about:blank'}
                                @click=${() => this.openViewerInNewWindow()}
                            >
                                Open in New Window
                            </button>
                            <button
                                class="primary-button"
                                type="button"
                                @click=${() => this.closeIframe()}
                            >
                                Close ${this.viewerChromeLabel}
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
                            <div class="loading-state ${this.iframeUrl !== 'about:blank' ? 'loading-overlay' : ''}">
                                <div class="viewer-loading">
                                    <div class="viewer-spinner" role="status" aria-label="Loading viewer"></div>
                                    <p>${this.viewerLoadingMessage}</p>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
            ${this.toastMessage ? html`
                <div class="toast" role="status" aria-live="polite">${this.toastMessage}</div>
            ` : ''}
        `;
    }
}

customElements.define('project-review-page', ProjectReviewPage);
