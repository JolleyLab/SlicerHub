import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { initializeTheme } from './components/theme.js';
import { APP_MENU_ITEMS } from './components/app-menu.js';
import './components/page-layout-template.js';
import './components/page-content-message.js';
import './components/file-storage-summary.js';
import './components/file-list-row.js';
import './components/add-button.js';
import './components/app-dialog.js';
import { resolveTramePageUrl } from './utils/trameViewerUrl.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity
} from './utils/viewerActivity.js';
import { sendTrameContainerHeartbeat } from './utils/trameHeartbeat.js';

export class FileManager extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                color: var(--color-text-primary);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .files-section-title {
                margin: 20px 0 0;
                font-size: 1.05rem;
                font-weight: 600;
                color: var(--color-text-primary);
            }

            .file-list {
                margin-top: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            file-list-row .file-action-icon {
                width: 16px;
                height: 16px;
                display: block;
            }

            add-button {
                margin-top: 16px;
            }

            .file-list-toolbar {
                margin-top: 12px;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
            }

            .file-list-search {
                flex: 1;
                min-width: 180px;
                max-width: 320px;
                padding: 8px 12px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                font: inherit;
                color: var(--color-text-primary);
                background: var(--color-surface, var(--color-background));
                box-sizing: border-box;
            }

            .file-list-search:focus-visible {
                outline: 2px solid var(--color-secondary);
                outline-offset: 1px;
            }

            .file-list-sort {
                padding: 8px 10px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                font: inherit;
                color: var(--color-text-primary);
                background: var(--color-surface, var(--color-background));
                min-width: 220px;
                cursor: pointer;
            }

            .file-list-pager {
                margin-top: 14px;
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
            }

            .file-list-pager-meta {
                color: var(--color-text-secondary);
                font-size: 0.92rem;
            }

            .file-list-pager-buttons {
                display: inline-flex;
                gap: 8px;
            }

            .file-list-pager-btn {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                background: transparent;
                color: var(--color-text-primary);
                min-height: 38px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .file-list-pager-btn:hover:not(:disabled),
            .file-list-pager-btn:focus-visible:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
                outline: none;
            }

            .file-list-pager-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .spinner {
                display: inline-block;
                width: 16px;
                height: 16px;
                border: 3px solid rgba(255, 255, 255, 0.3);
                border-top-color: white;
                border-radius: 50%;
                animation: spin 0.8s linear infinite;
                vertical-align: middle;
                margin-right: 8px;
            }

            @keyframes spin {
                to { transform: rotate(360deg); }
            }

            .iframe-overlay {
                position: fixed;
                top: 0;
                left: 0;
                right: 0;
                bottom: 0;
                background: rgba(0, 0, 0, 0.8);
                z-index: 1000;
                display: flex;
                flex-direction: column;
            }

            .iframe-header {
                background: #333;
                color: white;
                padding: 15px 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .iframe-title {
                font-size: 16px;
                font-weight: 500;
            }

            .iframe-status {
                margin-left: 12px;
                font-size: 13px;
                font-weight: 400;
                color: #ffc107;
            }

            .save-indicator {
                background: #2e7d32;
                color: white;
                border-radius: 4px;
                padding: 6px 10px;
                font-size: 12px;
                margin-right: 10px;
                white-space: nowrap;
            }

            .close-iframe-btn {
                background: #f44336;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }

            .open-window-btn {
                background: #2196F3;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin-right: 8px;
            }

            .save-scene-btn {
                background: #4CAF50;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin-right: 8px;
            }

            .save-as-new-btn {
                background: #FF9800;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
                margin-right: 8px;
            }

            .close-iframe-btn:hover {
                background: #d32f2f;
            }

            .open-window-btn:hover {
                background: #1976D2;
            }

            .save-scene-btn:hover {
                background: #43A047;
            }

            .save-as-new-btn:hover {
                background: #F57C00;
            }

            .open-window-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
                opacity: 0.6;
            }

            .save-scene-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
                opacity: 0.6;
            }

            .save-as-new-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
                opacity: 0.6;
            }

            .iframe-container {
                flex: 1;
                display: flex;
                position: relative;
            }

            .loading-state {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                text-align: center;
            }

            .loading-state.loading-overlay {
                position: absolute;
                inset: 0;
                z-index: 2;
            }

            .viewer-loading {
                color: var(--color-text-secondary);
                max-width: 28rem;
                padding: 0 16px;
            }

            .viewer-loading p {
                margin: 0;
                font-size: 0.95rem;
                line-height: 1.45;
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

            .trame-iframe {
                flex: 1;
                border: none;
                background: white;
                width: 100%;
                height: 100%;
            }

            .iframe-header .action-btn {
                padding: 8px 12px;
                border-radius: 4px;
                font-size: 14px;
                font: inherit;
            }

            .iframe-header select.action-btn {
                border: 1px solid #ccc;
                background: #fff;
                color: #333;
                cursor: pointer;
            }

            .iframe-header .share-btn {
                border: none;
                background: #673ab7;
                color: white;
                cursor: pointer;
            }

            .iframe-header .share-btn:hover {
                background: #5e35b1;
            }

            .share-dialog-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                z-index: 1100;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
            }

            .share-dialog {
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                border: 1px solid var(--color-border);
                border-radius: 10px;
                width: min(520px, 100%);
                padding: 16px;
                box-shadow: 0 8px 30px var(--color-shadow, rgba(0, 0, 0, 0.25));
            }

            .share-dialog h3 {
                margin: 0 0 12px;
            }

            .share-field {
                margin: 10px 0;
            }

            .share-field label {
                display: block;
                margin-bottom: 6px;
                font-size: 14px;
                color: var(--color-text-primary);
                font-weight: 500;
            }

            .share-field select,
            .share-field input {
                width: 100%;
                padding: 8px 10px;
                border: 1px solid var(--color-border);
                border-radius: 10px;
                box-sizing: border-box;
                font-size: 14px;
                font: inherit;
                color: var(--color-text-primary);
                background: var(--color-surface, var(--color-background));
            }

            .share-help {
                font-size: 12px;
                color: var(--color-text-secondary);
                margin-top: 6px;
            }

            .share-dialog-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 14px;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: 10px;
                min-height: 42px;
                padding: 8px 16px;
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

            .primary-button:hover,
            .primary-button:focus-visible {
                background: var(--color-accent);
                color: var(--color-text-primary);
                outline: none;
                transform: translateY(-1px);
            }

            .primary-button:disabled,
            .secondary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
                transform: none;
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

            .upload-dialog-error {
                margin-top: 12px;
                color: #c62828;
                font-size: 0.9rem;
            }

            .close-prompt-message {
                margin: 0;
                line-height: 1.45;
                color: var(--color-text-secondary);
            }
        `;
    }

    static get properties() {
        return {
            files: { type: Array },
            selectedFile: { type: Object },
            uploading: { type: Boolean },
            loading: { type: Boolean },
            error: { type: String },
            uploadError: { type: String },
            success: { type: String },
            stats: { type: Object },
            dragOver: { type: Boolean },
            launching: { type: Boolean },
            launchingFileId: { type: Number },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            currentFileId: { type: Number },
            currentFileName: { type: String },
            currentStoredName: { type: String },
            hasUnsavedChanges: { type: Boolean },
            saveIndicatorMessage: { type: String },
            sharingFileId: { type: Number },
            showShareDialog: { type: Boolean },
            shareTargetFile: { type: Object },
            shareDurationHours: { type: Number },
            shareAllowedEmails: { type: String },
            shareDialogError: { type: String },
            shareMode: { type: String },
            viewerShareMode: { type: String },
            username: { type: String },
            menuItems: { type: Array },
            fileListSearch: { type: String },
            fileListSearchDraft: { type: String },
            fileListOrder: { type: String },
            filePage: { type: Number },
            pageSize: { type: Number },
            totalFileCount: { type: Number },
            closePromptMode: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.files = [];
        this.selectedFile = null;
        this.uploading = false;
        this.loading = false;
        this.error = '';
        this.uploadError = '';
        this.success = '';
        this.stats = { bytesUsed: 0, megabytesUsed: '0.00', fileCount: 0 };
        this.dragOver = false;
        this.launching = false;
        this.launchingFileId = null;
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileId = null;
        this.currentFileName = '';
        this.currentStoredName = '';
        this.heartbeatInterval = null;
        this.hasUnsavedChanges = false;
        this.iframeActivityCleanup = null;
        this.saveIndicatorMessage = '';
        this.saveIndicatorTimeout = null;
        this.saveIndicatorActivityCleanup = null;
        this.sharingFileId = null;
        this.showShareDialog = false;
        this.shareTargetFile = null;
        this.shareDurationHours = 72;
        this.shareAllowedEmails = '';
        this.shareDialogError = '';
        this.shareMode = 'whole_file';
        this.viewerShareMode = 'whole_file';
        this.username = 'Guest';
        this.menuItems = APP_MENU_ITEMS;
        this.fileListSearch = '';
        this.fileListSearchDraft = '';
        this.fileListOrder = 'date-desc';
        this.filePage = 0;
        this.pageSize = 20;
        this.totalFileCount = 0;
        this._fileSearchTimer = null;
        this.closePromptMode = null;
        this._closePromptResolver = null;
    }

    get fileListTotalPages() {
        if (this.totalFileCount <= 0) return 1;
        return Math.ceil(this.totalFileCount / this.pageSize);
    }

    get fileListRangeLabel() {
        if (this.totalFileCount <= 0) return '0 files';
        const start = this.filePage * this.pageSize + 1;
        const end = Math.min((this.filePage + 1) * this.pageSize, this.totalFileCount);
        const base = `Showing ${start}–${end} of ${this.totalFileCount}`;
        if (this.totalFileCount <= this.pageSize) return base;
        return `${base} · Page ${this.filePage + 1} of ${this.fileListTotalPages}`;
    }

    get showFileListPager() {
        return this.totalFileCount > this.pageSize;
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();
        this.loadFiles();
        this.loadStats();
        // Cleanup any running containers when page loads
        this.cleanupContainer();

        // Add event listener for tab/window close
        this.handleBeforeUnload = () => {
            if (this.showIframe) {
                // Use fetch with keepalive to ensure cleanup happens
                fetch(`${API_URL}/api/containers/stop`, {
                    method: 'POST',
                    credentials: 'include',
                    keepalive: true
                }).catch(() => { }); // Ignore errors
            }
        };
        window.addEventListener('beforeunload', this.handleBeforeUnload);
    }

    disconnectedCallback() {
        super.disconnectedCallback();
        if (this._fileSearchTimer) {
            clearTimeout(this._fileSearchTimer);
            this._fileSearchTimer = null;
        }
        // Stop heartbeat if component is removed
        this.stopHeartbeat();
        // Remove event listener
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }

    async loadFiles(snapDepth = 0) {
        this.loading = true;
        try {
            const [sortBy, sortDir] = this.fileListOrder.split('-');
            const params = new URLSearchParams({
                limit: String(this.pageSize),
                offset: String(this.filePage * this.pageSize),
                search: this.fileListSearch,
                sortBy,
                sortDir
            });
            const response = await fetch(`${API_URL}/api/files?${params}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.files = data.files || [];
                this.totalFileCount = data.pagination?.total ?? 0;
                if (
                    snapDepth < 2
                    && this.files.length === 0
                    && this.filePage > 0
                    && this.totalFileCount > 0
                ) {
                    this.filePage = Math.max(0, Math.ceil(this.totalFileCount / this.pageSize) - 1);
                    await this.loadFiles(snapDepth + 1);
                    return;
                }
            } else {
                this.error = 'Failed to load files';
            }
        } catch (err) {
            console.error('Error loading files:', err);
            this.error = 'Network error loading files';
        } finally {
            this.loading = false;
        }
    }

    async loadStats() {
        try {
            const response = await fetch(`${API_URL}/api/files/stats/storage`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.stats = data;
            }
        } catch (err) {
            console.error('Error loading stats:', err);
        }
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    openFileUploadDialog() {
        this.uploadError = '';
        this.selectedFile = null;
        this.dragOver = false;
        this.updateComplete.then(() => {
            const input = this.shadowRoot?.querySelector('#my-files-upload-input');
            if (input) input.value = '';
            this.shadowRoot?.querySelector('#file-upload-dialog')?.openDialog();
        });
    }

    closeFileUploadDialog() {
        this.shadowRoot?.querySelector('#file-upload-dialog')?.closeDialog();
    }

    handleUploadDialogFileSelect(event) {
        this.selectedFile = event.target.files?.[0] || null;
        this.uploadError = '';
    }

    handleUploadDialogDragOver(event) {
        event.preventDefault();
        this.dragOver = true;
    }

    handleUploadDialogDragLeave(event) {
        event.preventDefault();
        this.dragOver = false;
    }

    handleUploadDialogDrop(event) {
        event.preventDefault();
        this.dragOver = false;
        const files = event.dataTransfer?.files;
        if (files?.length > 0) {
            this.selectedFile = files[0];
            this.uploadError = '';
        }
    }

    handleAddFileFromButton() {
        this.openFileUploadDialog();
    }

    handleFileSearchInput(e) {
        this.fileListSearchDraft = e.target.value;
        if (this._fileSearchTimer) {
            clearTimeout(this._fileSearchTimer);
        }
        this._fileSearchTimer = setTimeout(() => {
            this._fileSearchTimer = null;
            const next = this.fileListSearchDraft.trim();
            if (next === this.fileListSearch) return;
            this.fileListSearch = next;
            this.filePage = 0;
            this.loadFiles();
        }, 350);
    }

    handleFileOrderChange(e) {
        this.fileListOrder = e.target.value;
        this.filePage = 0;
        this.loadFiles();
    }

    handleFilePagerPrev() {
        if (this.filePage <= 0) return;
        this.filePage -= 1;
        this.loadFiles();
    }

    handleFilePagerNext() {
        if ((this.filePage + 1) * this.pageSize >= this.totalFileCount) return;
        this.filePage += 1;
        this.loadFiles();
    }

    async uploadFile() {
        if (!this.selectedFile) {
            this.uploadError = 'Please choose a file.';
            return;
        }

        this.uploading = true;
        this.uploadError = '';
        this.success = '';

        try {
            const formData = new FormData();
            formData.append('file', this.selectedFile);

            const response = await fetch(`${API_URL}/api/files/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            const data = await response.json();

            if (response.ok) {
                this.success = 'File uploaded successfully!';
                this.selectedFile = null;
                this.filePage = 0;
                const input = this.shadowRoot?.querySelector('#my-files-upload-input');
                if (input) input.value = '';
                await this.loadFiles();
                await this.loadStats();
                this.closeFileUploadDialog();
            } else {
                // Handle error response properly - error might be nested
                console.error('Upload error:', data);

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

                this.uploadError = errorMsg;
            }
        } catch (err) {
            console.error('Upload error:', err);
            this.uploadError = err.message || 'Network error during upload';
        } finally {
            this.uploading = false;
        }
    }

    async downloadFile(file) {
        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                credentials: 'include'
            });

            if (response.ok) {
                const blob = await response.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = file.originalName;
                a.click();
                window.URL.revokeObjectURL(url);
            } else {
                this.error = 'Failed to download file';
            }
        } catch (err) {
            console.error('Download error:', err);
            this.error = 'Network error during download';
        }
    }

    async deleteFile(file) {
        if (!confirm(`Delete ${file.originalName}?`)) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });

            if (response.ok) {
                this.success = 'File deleted successfully';
                await this.loadFiles();
                await this.loadStats();
            } else {
                this.error = 'Failed to delete file';
            }
        } catch (err) {
            console.error('Delete error:', err);
            this.error = 'Network error during delete';
        }
    }

    openShareDialog(file, options = {}) {
        this.shareTargetFile = file;
        this.shareDurationHours = 72;
        this.shareAllowedEmails = '';
        this.shareDialogError = '';
        this.shareMode = options.mode === 'current_view' ? 'current_view' : 'whole_file';
        this.showShareDialog = true;
    }

    closeShareDialog() {
        this.showShareDialog = false;
        this.shareTargetFile = null;
        this.shareDialogError = '';
    }

    async createShareLink() {
        const file = this.shareTargetFile;
        if (!file?.id) return;
        this.error = '';
        this.success = '';
        this.sharingFileId = file.id;
        try {
            const rawEmails = this.shareAllowedEmails
                .split(',')
                .map((email) => email.trim())
                .filter((email) => email.length > 0);

            const uniqueEmails = [...new Set(rawEmails)];
            const allowedUserIds = [];
            for (const email of uniqueEmails) {
                const userResponse = await fetch(`${API_URL}/api/users/lookup?email=${encodeURIComponent(email)}`, {
                    credentials: 'include'
                });
                const userData = await userResponse.json().catch(() => ({}));
                if (!userResponse.ok) {
                    const msg = userData?.error?.message || userData?.message || `Could not resolve user: ${email}`;
                    throw new Error(msg);
                }
                if (userData?.user?.id) {
                    allowedUserIds.push(userData.user.id);
                }
            }

            const response = await fetch(`${API_URL}/api/files/${file.id}/share-links`, {
                method: 'POST',
                credentials: 'include',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    expiresInHours: Number(this.shareDurationHours || 72),
                    allowedUserIds,
                    shareMode: this.shareMode,
                    viewState: this.shareMode === 'current_view' ? await this.captureCurrentViewState() : null
                })
            });
            const data = await response.json();
            if (!response.ok) {
                this.shareDialogError = data?.error?.message || data?.message || 'Failed to create share link';
                return;
            }

            const shareUrl = data?.shareLink?.url;
            if (!shareUrl) {
                this.error = 'Share link was created but no URL was returned';
                return;
            }

            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                this.success = `Read-only share link copied for ${file.originalName}`;
            } else {
                this.success = `Read-only share link: ${shareUrl}`;
            }
            this.closeShareDialog();
        } catch (err) {
            console.error('Share link creation error:', err);
            this.shareDialogError = err.message || 'Failed to create share link';
        } finally {
            this.sharingFileId = null;
        }
    }

    async captureCurrentViewState() {
        const response = await fetch(`${API_URL}/api/containers/view-state`, {
            credentials: 'include'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data?.error?.message || data?.message || 'Unable to capture current view');
        }
        return data?.viewState || { captureMode: 'fallback' };
    }

    openViewerShareDialog() {
        if (!this.currentFileId) {
            this.error = 'No active file to share';
            return;
        }
        const file = this.files.find((item) => Number(item.id) === Number(this.currentFileId)) || {
            id: this.currentFileId,
            originalName: this.currentFileName
        };
        this.openShareDialog(file, { mode: this.viewerShareMode });
    }

    async cleanupContainer() {
        try {
            const response = await fetch(`${API_URL}/api/containers/stop`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: 'include'
            });
            if (response.ok) {
                console.log("Cleaned up existing container");
            }
        } catch (err) {
            // Ignore errors - container might not exist
        }
    }

    get viewerLoadingMessage() {
        if (this.viewerLoadingDetail) {
            return this.viewerLoadingDetail;
        }
        const name = this.currentFileName || 'scene';
        return `Opening ${name}… Large scenes can take 1–3 minutes.`;
    }

    async launchFile(file) {
        this.error = '';
        this.success = '';
        this.launching = true;
        this.launchingFileId = file.id;
        this.viewerLoading = true;
        this.viewerLoadingDetail = `Starting viewer for ${file.originalName}…`;
        this.currentFileId = file.id;
        this.currentFileName = file.originalName;
        this.currentStoredName = file.storedName || file.originalName;
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            this.stopHeartbeat();
            console.log('Starting Trame container for file:', file.originalName);
            this.viewerLoadingDetail = `Preparing session for ${file.originalName}… This can take 1–3 minutes for large scenes.`;
            const response = await fetch(`${API_URL}/api/containers/start`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    fileId: file.id
                })
            });

            if (response.ok) {
                const data = await response.json();
                const url = resolveTramePageUrl(data.frontendUrl);
                console.log('Trame container started, URL:', url);

                if (!url) {
                    throw new Error('Trame did not return a viewer URL.');
                }

                // Backend already waits for the session port; load the viewer once start succeeds.
                this.viewerLoadingDetail = `Loading ${file.originalName}…`;
                this.iframeUrl = url;
                markViewerActivity();
                this.success = `Launched ${file.originalName} in Trame`;
                this.hasUnsavedChanges = false;
                this.startHeartbeat();
            } else {
                const data = await response.json();
                console.error('Failed to start container:', data);
                let errorMsg = 'Failed to launch Trame';
                if (data.error?.message) {
                    errorMsg = data.error.message;
                } else if (data.message) {
                    errorMsg = data.message;
                }
                if (response.status === 401 || response.status === 403) {
                    errorMsg = 'Session expired — please sign out and sign in again.';
                    this.dispatchEvent(new CustomEvent('logout-request', { bubbles: true, composed: true }));
                }
                throw new Error(errorMsg);
            }
        } catch (err) {
            console.error('Launch error:', err);
            this.error = err.message || 'Network error during launch';
            this.showIframe = false;
            this.iframeUrl = '';
            this.currentFileName = '';
            this.currentStoredName = '';
            this.currentFileId = null;
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
        } finally {
            this.launching = false;
        }
    }

    handleIframeLoad(e) {
        console.log('Iframe loaded successfully');
        if (this.iframeUrl && this.iframeUrl !== 'about:blank') {
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            markViewerActivity();
        }
        this.attachIframeActivityTracking();
    }
    attachIframeActivityTracking() {
        if (this.iframeActivityCleanup) {
            this.iframeActivityCleanup();
            this.iframeActivityCleanup = null;
        }

        try {
            const iframe = this.shadowRoot.querySelector('.trame-iframe');
            const iframeDoc = iframe?.contentWindow?.document;
            if (!iframeDoc) return;

            const markDirty = () => {
                this.hasUnsavedChanges = true;
                markViewerActivity();
            };
            const events = ['pointerdown', 'keydown', 'input', 'change', 'wheel'];
            events.forEach((eventName) => iframeDoc.addEventListener(eventName, markDirty, true));

            this.iframeActivityCleanup = () => {
                events.forEach((eventName) => iframeDoc.removeEventListener(eventName, markDirty, true));
            };
        } catch (err) {
            console.log('Unable to attach iframe activity tracking:', err.message);
        }
    }


    handleIframeError(e) {
        console.error('Iframe error:', e);
        this.error = 'Failed to load Trame in iframe';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
    }

    buildTimestampedFileName(originalName) {
        const baseName = originalName || 'scene.mrb';
        const dotIndex = baseName.lastIndexOf('.');
        const hasExt = dotIndex > 0;
        const namePart = hasExt ? baseName.slice(0, dotIndex) : baseName;
        const extPart = hasExt ? baseName.slice(dotIndex) : '.mrb';

        const now = new Date();
        const pad = (n) => String(n).padStart(2, '0');
        const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
        return `${namePart}-${stamp}${extPart}`;
    }

    async saveCurrentScene(mode = 'overwrite') {
        if (!this.iframeUrl || this.iframeUrl === 'about:blank') {
            this.error = 'Trame is not ready yet';
            return false;
        }

        try {
            // Flush pending UI edits inside the iframe before server-side save.
            try {
                const iframe = this.shadowRoot.querySelector('.trame-iframe');
                const iframeWin = iframe?.contentWindow;
                const iframeDoc = iframeWin?.document;
                iframeWin?.focus?.();
                const active = iframeDoc?.activeElement;
                if (active && typeof active.blur === 'function') {
                    active.blur();
                }
            } catch (_) {
                // Best effort only.
            }

            // Give Trame widgets a brief moment to commit changes.
            await new Promise(resolve => setTimeout(resolve, 350));

            const targetFileName = mode === 'saveAsNew'
                ? this.buildTimestampedFileName(this.currentFileName)
                : (this.currentStoredName || this.currentFileName || 'last-saved-scene.mrb');

            const response = await fetch(`${API_URL}/api/containers/save`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                credentials: 'include',
                body: JSON.stringify({
                    saveMode: mode,
                    targetFileName,
                    fileId: this.currentFileId
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(`Save failed: ${response.status} - ${errorText}`);
            }

            await this.loadFiles();
            await this.loadStats();

            this.success = mode === 'saveAsNew'
                ? `Scene saved as new file: ${targetFileName}`
                : `Scene saved: ${targetFileName}`;
            this.error = '';
            this.hasUnsavedChanges = false;
            this.showSaveIndicator(
                mode === 'saveAsNew'
                    ? 'Saved as new file'
                    : 'Saved'
            );
            return true;
        } catch (err) {
            console.error('Save scene error:', err);
            this.error = err.message || 'Failed to save scene';
            return false;
        }
    }

    showSaveIndicator(message) {
        this.saveIndicatorMessage = message;

        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }

        const scheduleHide = () => {
            if (this.saveIndicatorTimeout) {
                clearTimeout(this.saveIndicatorTimeout);
            }
            this.saveIndicatorTimeout = setTimeout(() => {
                this.saveIndicatorMessage = '';
                if (this.saveIndicatorActivityCleanup) {
                    this.saveIndicatorActivityCleanup();
                    this.saveIndicatorActivityCleanup = null;
                }
            }, 3000);
        };

        if (!this.saveIndicatorActivityCleanup) {
            const onActivity = () => scheduleHide();
            const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
            events.forEach((eventName) => window.addEventListener(eventName, onActivity, true));
            this.saveIndicatorActivityCleanup = () => {
                events.forEach((eventName) => window.removeEventListener(eventName, onActivity, true));
            };
        }

        scheduleHide();
    }

    async saveCurrentSceneAsNew() {
        return this.saveCurrentScene('saveAsNew');
    }

    promptCloseChoice(mode) {
        return new Promise((resolve) => {
            this._closePromptResolver = resolve;
            this.closePromptMode = mode;
            this.updateComplete.then(() => {
                this.shadowRoot?.querySelector('#close-prompt-dialog')?.openDialog();
            });
        });
    }

    finishClosePrompt(choice) {
        this.shadowRoot?.querySelector('#close-prompt-dialog')?.closeDialog();
        this.closePromptMode = null;
        const resolver = this._closePromptResolver;
        this._closePromptResolver = null;
        resolver?.(choice);
    }

    get closePromptTitle() {
        return this.closePromptMode === 'save-failed' ? 'Save failed' : 'Unsaved changes';
    }

    get closePromptMessage() {
        if (this.closePromptMode === 'save-failed') {
            return 'Your changes could not be saved. Close Trame anyway?';
        }
        return 'Save your changes before closing Trame?';
    }

    async closeIframe(withPrompt = true) {
        if (withPrompt && this.hasUnsavedChanges && this.iframeUrl && this.iframeUrl !== 'about:blank') {
            const choice = await this.promptCloseChoice('unsaved');
            if (choice === 'save') {
                const saved = await this.saveCurrentScene('overwrite');
                if (!saved) {
                    const failedChoice = await this.promptCloseChoice('save-failed');
                    if (failedChoice !== 'close-anyway') {
                        return;
                    }
                }
            }
        }

        // Stop heartbeat
        this.stopHeartbeat();
        resetViewerActivity();

        // Hide iframe
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this.hasUnsavedChanges = false;
        if (this.iframeActivityCleanup) {
            this.iframeActivityCleanup();
            this.iframeActivityCleanup = null;
        }
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        this.saveIndicatorMessage = '';
        if (this.saveIndicatorActivityCleanup) {
            this.saveIndicatorActivityCleanup();
            this.saveIndicatorActivityCleanup = null;
        }

        // Cleanup container
        await this.cleanupContainer();
        this.success = `Closed Trame session for ${this.currentFileName}`;
        this.currentFileName = '';
        this.currentStoredName = '';
        this.currentFileId = null;
    }

    openInNewWindow() {
        if (this.iframeUrl && this.iframeUrl !== 'about:blank') {
            // Open in a popup window with good dimensions for 3D visualization
            const width = Math.min(1400, window.screen.width * 0.9);
            const height = Math.min(900, window.screen.height * 0.9);
            const left = (window.screen.width - width) / 2;
            const top = (window.screen.height - height) / 2;
            
            window.open(
                this.iframeUrl,
                'TrameViewer',
                `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
            );
        }
    }

    async handleViewerInactivityTimeout() {
        if (!this.showIframe) return;
        this.success = 'Viewer closed after inactivity';
        await this.closeIframe(false);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        const ping = () => {
            sendTrameContainerHeartbeat({
                onIdleTimeout: () => this.handleViewerInactivityTimeout()
            }).catch((err) => console.log('Heartbeat failed:', err.message));
        };
        ping();
        this.heartbeatInterval = setInterval(ping, 60000);
    }

    stopHeartbeat() {
        if (this.heartbeatInterval) {
            clearInterval(this.heartbeatInterval);
            this.heartbeatInterval = null;
        }
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
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

    /** Size plus modified / viewed timestamps from API (camelCase). */
    formatFileMetaLine(file) {
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

    render() {
        return html`
            <page-layout-template
                .menuItems=${this.menuItems}
                .username=${this.username}
                selectedMenuKey="my-files"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="My Files"
                pageDescription="Upload, open, and manage your scene files."
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.error ? html`
                    <page-content-message slot="content" variant="error" .message=${this.error}></page-content-message>
                ` : ''}
                ${this.success ? html`
                    <page-content-message slot="content" variant="success" .message=${this.success}></page-content-message>
                ` : ''}

                <add-button
                    slot="content"
                    title="Add file"
                    @add-button-click=${this.handleAddFileFromButton}
                ></add-button>


                ${this.loading ? html`
                    <page-content-message slot="content" variant="status" message="Loading files..."></page-content-message>
                ` : ''}
                ${!this.loading && this.totalFileCount === 0 && !this.fileListSearch ? html`
                    <page-content-message
                        slot="content"
                        variant="empty"
                        message="No files uploaded yet. Use Add file to upload."
                    ></page-content-message>
                ` : ''}
                ${!this.loading && this.totalFileCount === 0 && this.fileListSearch ? html`
                    <page-content-message
                        slot="content"
                        variant="empty"
                        message="No files match your search."
                    ></page-content-message>
                ` : ''}

                ${!this.loading && (this.totalFileCount > 0 || this.fileListSearch) ? html`
                    <h2 slot="content" class="files-section-title">Your files</h2>
                    <div slot="content" class="file-list-toolbar">
                        <input
                            type="search"
                            class="file-list-search"
                            placeholder="Search by file name…"
                            aria-label="Search files by name"
                            .value=${this.fileListSearchDraft}
                            @input=${this.handleFileSearchInput}
                        />
                        <select
                            class="file-list-sort"
                            aria-label="Sort files"
                            .value=${this.fileListOrder}
                            @change=${this.handleFileOrderChange}
                        >
                            <option value="date-desc">Last modified (newest first)</option>
                            <option value="date-asc">Last modified (oldest first)</option>
                            <option value="viewed-desc">Recently viewed</option>
                            <option value="name-asc">Name (A–Z)</option>
                            <option value="name-desc">Name (Z–A)</option>
                        </select>
                    </div>
                    <div slot="content" class="file-list">
                        ${this.files.map((file) => html`
                            <file-list-row
                                .fileName=${file.originalName}
                                .metaLine=${this.launchingFileId === file.id ? 'Opening…' : this.formatFileMetaLine(file)}
                                .nameButtonDisabled=${this.launchingFileId === file.id}
                                .nameButtonTitle=${this.launchingFileId === file.id ? 'Opening viewer…' : 'Launch file'}
                                @name-click=${() => this.launchFile(file)}
                            >
                                <button
                                    slot="actions"
                                    class="file-icon-button"
                                    type="button"
                                    aria-label="Download file"
                                    title="Download file"
                                    @click=${() => this.downloadFile(file)}
                                >
                                    <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                        <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h2z"></path>
                                    </svg>
                                </button>
                                <button
                                    slot="actions"
                                    class="file-icon-button"
                                    type="button"
                                    aria-label="Create share link"
                                    title="Create share link"
                                    ?disabled=${this.sharingFileId === file.id}
                                    @click=${() => this.openShareDialog(file)}
                                >
                                    <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                        <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"></path>
                                    </svg>
                                </button>
                                <button
                                    slot="actions"
                                    class="file-icon-button"
                                    type="button"
                                    aria-label="Delete file"
                                    title="Delete file"
                                    @click=${() => this.deleteFile(file)}
                                >
                                    <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                        <path fill="currentColor" d="M9 3h6l1 2h4v2h-2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7H4V5h4l1-2zm7 4H8v13h8V7zm-6 3h2v7h-2v-7zm4 0h2v7h-2v-7z"></path>
                                    </svg>
                                </button>
                            </file-list-row>
                        `)}
                    </div>
                    ${this.showFileListPager ? html`
                        <div slot="content" class="file-list-pager">
                            <span class="file-list-pager-meta">${this.fileListRangeLabel}</span>
                            <div class="file-list-pager-buttons">
                                <button
                                    type="button"
                                    class="file-list-pager-btn"
                                    ?disabled=${this.filePage <= 0}
                                    @click=${this.handleFilePagerPrev}
                                >
                                    Previous
                                </button>
                                <button
                                    type="button"
                                    class="file-list-pager-btn"
                                    ?disabled=${(this.filePage + 1) * this.pageSize >= this.totalFileCount}
                                    @click=${this.handleFilePagerNext}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    ` : ''}
                ` : ''}
                <file-storage-summary
                    slot="content"
                    .megabytesUsed=${this.stats.megabytesUsed}
                    .fileCount=${this.stats.fileCount}
                ></file-storage-summary>
            </page-layout-template>

            <app-dialog id="file-upload-dialog" title="Add file">
                <div
                    class="upload-area ${this.dragOver ? 'drag-over' : ''}"
                    @dragover=${this.handleUploadDialogDragOver}
                    @dragleave=${this.handleUploadDialogDragLeave}
                    @drop=${this.handleUploadDialogDrop}
                >
                    <div class="upload-message">Drag and drop a file here, or choose a file to upload.</div>
                    <input
                        type="file"
                        id="my-files-upload-input"
                        @change=${this.handleUploadDialogFileSelect}
                        ?disabled=${this.uploading}
                    />
                    <button
                        class="upload-button secondary"
                        type="button"
                        ?disabled=${this.uploading}
                        @click=${() => this.shadowRoot?.querySelector('#my-files-upload-input')?.click()}
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
                                @click=${() => this.uploadFile()}
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
                    ${this.uploadError ? html`<div class="upload-dialog-error">${this.uploadError}</div>` : ''}
                </div>
            </app-dialog>

            ${this.closePromptMode ? html`
                <app-dialog
                    id="close-prompt-dialog"
                    title=${this.closePromptTitle}
                    .showDefaultCloseButton=${false}
                >
                    <p class="close-prompt-message">${this.closePromptMessage}</p>
                    ${this.closePromptMode === 'unsaved' ? html`
                        <button slot="actions" class="upload-button secondary" type="button" @click=${() => this.finishClosePrompt('discard')}>
                            Don't Save
                        </button>
                        <button slot="actions" class="upload-button" type="button" @click=${() => this.finishClosePrompt('save')}>
                            Save
                        </button>
                    ` : html`
                        <button slot="actions" class="upload-button secondary" type="button" @click=${() => this.finishClosePrompt('keep-open')}>
                            Keep open
                        </button>
                        <button slot="actions" class="upload-button" type="button" @click=${() => this.finishClosePrompt('close-anyway')}>
                            Close anyway
                        </button>
                    `}
                </app-dialog>
            ` : ''}

            ${this.showIframe ? html`
                <div class="iframe-overlay">
                    <div class="iframe-header">
                        <div class="iframe-title">
                            🚀 Trame: ${this.currentFileName}
                            ${this.viewerLoading ? html`
                                <span class="iframe-status">${this.viewerLoadingMessage}</span>
                            ` : ''}
                        </div>
                        <div>
                            ${this.saveIndicatorMessage ? html`
                                <span class="save-indicator">${this.saveIndicatorMessage}</span>
                            ` : ''}
                            <button class="open-window-btn" @click=${this.openInNewWindow} ?disabled=${this.iframeUrl === 'about:blank'}>
                                🗗 Open in New Window
                            </button>
                            <select
                                class="action-btn"
                                style="margin-right:8px;"
                                .value=${this.viewerShareMode}
                                @change=${(e) => { this.viewerShareMode = e.target.value; }}
                            >
                                <option value="whole_file">Share whole file</option>
                                <option value="current_view">Share current view</option>
                            </select>
                            <button class="action-btn share-btn" @click=${() => this.openViewerShareDialog()} ?disabled=${this.iframeUrl === 'about:blank'}>
                                🔗 Share
                            </button>
                            <button class="save-scene-btn" @click=${() => this.saveCurrentScene('overwrite')} ?disabled=${this.iframeUrl === 'about:blank'}>
                                💾 Save Scene
                            </button>
                            <button class="save-as-new-btn" @click=${this.saveCurrentSceneAsNew} ?disabled=${this.iframeUrl === 'about:blank'}>
                                🧾 Save As New
                            </button>
                            <button class="close-iframe-btn" @click=${this.closeIframe}>
                                ✕ Close Trame
                            </button>
                        </div>
                    </div>
                    <div class="iframe-container">
                        ${this.iframeUrl !== 'about:blank' ? html`
                            <iframe
                                class="trame-iframe"
                                src="${this.iframeUrl}"
                                @load=${this.handleIframeLoad}
                                @error=${this.handleIframeError}
                                allow="clipboard-read; clipboard-write; cross-origin-isolated"
                                allowfullscreen
                                frameborder="0"
                                referrerpolicy="origin"
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

            ${this.showShareDialog ? html`
                <div class="share-dialog-overlay" @click=${(e) => { if (e.target === e.currentTarget) this.closeShareDialog(); }}>
                    <div class="share-dialog">
                        <h3>Create Share Link</h3>
                        <div><strong>File:</strong> ${this.shareTargetFile?.originalName || ''}</div>
                        ${this.shareDialogError ? html`
                            <page-content-message variant="error" .message=${this.shareDialogError}></page-content-message>
                        ` : ''}
                        <div class="share-field">
                            <label for="shareMode">Share mode</label>
                            <select
                                id="shareMode"
                                .value=${this.shareMode}
                                @change=${(e) => { this.shareMode = e.target.value; }}
                            >
                                <option value="whole_file">Open with whole file</option>
                                <option value="current_view">Open with my current view</option>
                            </select>
                        </div>
                        <div class="share-field">
                            <label for="shareDuration">Link duration</label>
                            <select
                                id="shareDuration"
                                .value=${String(this.shareDurationHours)}
                                @change=${(e) => { this.shareDurationHours = Number(e.target.value); }}
                            >
                                <option value="1">1 hour</option>
                                <option value="24">24 hours</option>
                                <option value="72">3 days</option>
                                <option value="168">7 days</option>
                                <option value="720">30 days</option>
                            </select>
                        </div>
                        <div class="share-field">
                            <label for="shareEmails">Restrict to users (optional, comma-separated emails)</label>
                            <input
                                id="shareEmails"
                                type="text"
                                .value=${this.shareAllowedEmails}
                                @input=${(e) => { this.shareAllowedEmails = e.target.value; }}
                                placeholder="alice@example.com, bob@example.com"
                            />
                            <div class="share-help">Leave empty for anyone with the link. If set, recipients must sign in.</div>
                        </div>
                        <div class="share-dialog-actions">
                            <button class="secondary-button" @click=${this.closeShareDialog}>Cancel</button>
                            <button class="primary-button" @click=${this.createShareLink} ?disabled=${this.sharingFileId === this.shareTargetFile?.id}>
                                ${this.sharingFileId === this.shareTargetFile?.id ? 'Creating...' : 'Create Link'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('file-manager', FileManager);
