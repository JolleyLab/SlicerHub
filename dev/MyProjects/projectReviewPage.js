import { LitElement, html, css } from 'lit-element';
import { API_URL } from '../config.js';
import '../components/page-layout-template.js';
import '../components/add-button.js';
import '../components/app-dialog.js';
import './collaboratorSearch.js';
import './collaboratorResultRow.js';
import { getProjectById, updateProjectCollaborators, listProjectFiles } from '../services/projects.js';

function resolveTramePageUrl(frontendUrl) {
    if (!frontendUrl) return '';
    try {
        const u = new URL(frontendUrl, window.location.href);
        return `${window.location.origin}${u.pathname}${u.search}${u.hash}`;
    } catch {
        return frontendUrl;
    }
}

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

            .file-row {
                border: 1px dashed var(--color-border);
                border-radius: 10px;
                padding: 10px 12px;
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 12px;
                flex-wrap: wrap;
            }

            .file-main {
                min-width: 0;
                flex: 1;
            }

            .file-name-button {
                border: none;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                color: var(--color-text-primary);
                font-weight: 600;
                padding: 0;
                cursor: pointer;
                text-align: left;
            }

            .file-meta {
                color: var(--color-text-secondary);
                font-size: 0.9rem;
            }

            .file-action-group {
                display: inline-flex;
                align-items: center;
                gap: 8px;
            }

            .file-icon-button {
                border: none;
                border-radius: 8px;
                background: transparent;
                color: var(--color-text-primary);
                width: 34px;
                height: 34px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
            }

            .file-icon-button:hover,
            .file-icon-button:focus-visible,
            .file-name-button:hover,
            .file-name-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                outline: none;
            }

            .file-action-icon {
                width: 16px;
                height: 16px;
                display: block;
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

            .close-iframe-btn {
                background: #f44336;
                color: white;
                border: none;
                padding: 8px 20px;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }

            .close-iframe-btn:hover {
                background: #d32f2f;
            }

            .iframe-container {
                flex: 1;
                display: flex;
            }

            .trame-iframe {
                flex: 1;
                border: none;
                background: white;
                width: 100%;
                height: 100%;
            }

            .loading-state {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: white;
                text-align: center;
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
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            projectId: { type: Number },
            menuItems: { type: Array },
            loading: { type: Boolean },
            saving: { type: Boolean },
            formError: { type: String },
            toastMessage: { type: String },
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
            currentFileName: { type: String },
            selectedFile: { type: Object },
            uploading: { type: Boolean },
            dragOver: { type: Boolean },
            uploadError: { type: String },
            uploadSuccess: { type: String }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.projectId = null;
        this.menuItems = [
            { key: 'my-projects', label: 'My Projects' },
            { key: 'my-files', label: 'My Files' }
        ];
        this.loading = false;
        this.saving = false;
        this.formError = '';
        this.toastMessage = '';
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
        this.currentFileName = '';
        this.selectedFile = null;
        this.uploading = false;
        this.dragOver = false;
        this.uploadError = '';
        this.uploadSuccess = '';
        this.toastTimeout = null;
    }

    updated(changedProperties) {
        if (changedProperties.has('projectId') && this.projectId) {
            this.loadProject();
        }
    }

    disconnectedCallback() {
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
        this.formError = '';
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
            await this.loadProjectFiles();
        } catch (error) {
            this.formError = error.message || 'Unable to load project.';
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

    handleFileSelect(event) {
        this.selectedFile = event.target.files?.[0] || null;
        this.uploadError = '';
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
            this.uploadError = '';
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
            // Keep the page usable even if project files endpoint is temporarily unavailable.
            this.uploadError = '';
            this.projectFiles = [];
        } finally {
            this.loadingProjectFiles = false;
        }
    }

    openFileUploadDialog() {
        if (!this.canUploadFiles) return;
        this.uploadError = '';
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
            this.uploadError = 'Please choose a file.';
            return;
        }

        this.uploading = true;
        this.uploadError = '';

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
            this.uploadError = errorMsg;
        } catch (error) {
            this.uploadError = error.message || 'Network error during upload';
        } finally {
            this.uploading = false;
        }
    }

    async handleLaunchFile(file) {
        this.uploadError = '';
        try {
            await this.cleanupContainerSession();

            const response = await fetch(`${API_URL}/api/containers/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fileId: file.id })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(data?.error || data?.message || 'Failed to launch file');
            }

            const url = resolveTramePageUrl(data.frontendUrl);
            this.currentFileName = file.originalName;
            this.iframeUrl = 'about:blank';
            this.showIframe = true;

            const maxAttempts = 60;
            let attempts = 0;
            let ready = false;

            while (attempts < maxAttempts && !ready) {
                attempts += 1;
                try {
                    const checkResponse = await fetch(url, {
                        method: 'GET',
                        credentials: 'include',
                        cache: 'no-store'
                    });
                    if (checkResponse.ok) {
                        ready = true;
                        break;
                    }
                } catch (_) {
                    // keep waiting
                }
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            if (!ready) {
                this.showIframe = false;
                this.iframeUrl = '';
                this.currentFileName = '';
                throw new Error('Trame took too long to start. Try again.');
            }

            this.iframeUrl = url;
            this.showToast(`Launched ${file.originalName}`);
        } catch (error) {
            this.uploadError = error.message || 'Unable to launch file.';
        }
    }

    async cleanupContainerSession() {
        try {
            await fetch(`${API_URL}/api/containers/stop`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include'
            });
        } catch (_) {
            // best effort
        }
    }

    async closeIframe() {
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        await this.cleanupContainerSession();
    }

    async handleDownloadFile(file) {
        this.uploadError = '';
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
            this.uploadError = error.message || 'Unable to download file.';
        }
    }

    async handleDeleteFile(file) {
        if (!this.canDeleteProjectFiles) return;
        const confirmed = window.confirm(`Delete ${file.originalName}?`);
        if (!confirmed) return;

        this.uploadError = '';
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
            this.uploadError = error.message || 'Unable to delete file.';
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
        this.formError = '';
        this.collaborators = this.sortCollaborators(this.originalCollaborators.map((entry) => ({ ...entry })));
    }

    async handleSaveCollaborators() {
        if (!this.canEditCollaborators || !this.hasPendingCollaboratorChanges) return;
        this.saving = true;
        this.formError = '';

        try {
            const payload = this.collaborators.map((entry) => ({
                userId: entry.user.id,
                role: entry.role
            }));
            await updateProjectCollaborators(this.projectId, payload);
            this.originalCollaborators = this.sortCollaborators(this.collaborators.map((entry) => ({ ...entry })));
            this.showToast('Collaborators updated.');
        } catch (error) {
            this.formError = error.message || 'Unable to save collaborator changes.';
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
                                    <div class="file-row">
                                        <div class="file-main">
                                            <button
                                                class="file-name-button"
                                                type="button"
                                                title="Launch file"
                                                @click=${() => this.handleLaunchFile(file)}
                                            >
                                                ${file.originalName}
                                            </button>
                                            <div class="file-meta">
                                                ${this.formatBytes(file.size)} • ${file.mimeType || 'Unknown type'} • ${this.formatDate(file.uploadDate)}
                                            </div>
                                        </div>
                                        <div class="file-action-group">
                                            <button
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
                                        </div>
                                    </div>
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
                ${this.formError ? html`<div slot="content" class="form-error">${this.formError}</div>` : ''}
                ${this.uploadError ? html`<div slot="content" class="form-error">${this.uploadError}</div>` : ''}
            </page-layout-template>
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
            ${this.showIframe ? html`
                <div class="iframe-overlay">
                    <div class="iframe-header">
                        <div class="iframe-title">Trame: ${this.currentFileName}</div>
                        <button class="close-iframe-btn" @click=${() => this.closeIframe()}>
                            Close Trame
                        </button>
                    </div>
                    <div class="iframe-container">
                        ${this.iframeUrl === 'about:blank' ? html`
                            <div class="loading-state">
                                <div>
                                    <h3>Starting Trame...</h3>
                                    <p>This may take a few seconds</p>
                                </div>
                            </div>
                        ` : html`
                            <iframe
                                class="trame-iframe"
                                src="${this.iframeUrl}"
                                allow="clipboard-read; clipboard-write; cross-origin-isolated"
                                allowfullscreen
                                frameborder="0"
                                referrerpolicy="origin"
                            ></iframe>
                        `}
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
