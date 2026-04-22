import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';

export class FileManager extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                padding: 20px;
            }

            .file-manager {
                max-width: 800px;
                margin: 0 auto;
            }

            h2 {
                margin-top: 0;
                color: #333;
            }

            .upload-area {
                border: 2px dashed #4CAF50;
                border-radius: 8px;
                padding: 40px;
                text-align: center;
                margin-bottom: 30px;
                background: #f9f9f9;
                transition: all 0.3s;
            }

            .upload-area.drag-over {
                background: #e8f5e9;
                border-color: #2e7d32;
            }

            .upload-area input[type="file"] {
                display: none;
            }

            .upload-btn {
                padding: 12px 24px;
                background: #4CAF50;
                color: white;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 16px;
                margin-top: 10px;
            }

            .upload-btn:hover {
                background: #45a049;
            }

            .upload-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
            }

            .file-info {
                margin-top: 10px;
                color: #666;
                font-size: 14px;
            }

            .storage-stats {
                background: #f5f5f5;
                padding: 15px;
                border-radius: 8px;
                margin-bottom: 20px;
                display: flex;
                justify-content: space-between;
                align-items: center;
            }

            .files-list {
                margin-top: 20px;
            }

            .file-item {
                display: flex;
                justify-content: space-between;
                align-items: center;
                padding: 15px;
                background: white;
                border: 1px solid #ddd;
                border-radius: 4px;
                margin-bottom: 10px;
            }

            .file-item:hover {
                background: #f9f9f9;
            }

            .file-details {
                flex: 1;
            }

            .file-name {
                font-weight: 500;
                color: #333;
                margin-bottom: 5px;
            }

            .file-meta {
                font-size: 12px;
                color: #777;
            }

            .file-actions {
                display: flex;
                gap: 10px;
            }

            .action-btn {
                padding: 8px 16px;
                border: none;
                border-radius: 4px;
                cursor: pointer;
                font-size: 14px;
            }

            .download-btn {
                background: #2196F3;
                color: white;
            }

            .download-btn:hover {
                background: #0b7dda;
            }

            .launch-btn {
                background: #4CAF50;
                color: white;
            }

            .launch-btn:hover {
                background: #45a049;
            }

            .delete-btn {
                background: #f44336;
                color: white;
            }

            .delete-btn:hover {
                background: #d32f2f;
            }

            .error {
                color: #f44336;
                background: #ffebee;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 15px;
            }

            .success {
                color: #4CAF50;
                background: #e8f5e9;
                padding: 10px;
                border-radius: 4px;
                margin-bottom: 15px;
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

            .empty-state {
                text-align: center;
                padding: 40px;
                color: #999;
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

            .close-iframe-btn:hover {
                background: #d32f2f;
            }

            .open-window-btn:hover {
                background: #1976D2;
            }

            .open-window-btn:disabled {
                background: #ccc;
                cursor: not-allowed;
                opacity: 0.6;
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
        `;
    }

    static get properties() {
        return {
            files: { type: Array },
            selectedFile: { type: Object },
            uploading: { type: Boolean },
            loading: { type: Boolean },
            error: { type: String },
            success: { type: String },
            stats: { type: Object },
            dragOver: { type: Boolean },
            launching: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            currentFileName: { type: String }
        };
    }

    constructor() {
        super();
        this.files = [];
        this.selectedFile = null;
        this.uploading = false;
        this.loading = false;
        this.error = '';
        this.success = '';
        this.stats = { bytesUsed: 0, megabytesUsed: '0.00', fileCount: 0 };
        this.dragOver = false;
        this.launching = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        this.heartbeatInterval = null;
    }

    connectedCallback() {
        super.connectedCallback();
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
        // Stop heartbeat if component is removed
        this.stopHeartbeat();
        // Remove event listener
        window.removeEventListener('beforeunload', this.handleBeforeUnload);
    }

    async loadFiles() {
        this.loading = true;
        try {
            const response = await fetch(`${API_URL}/api/files`, {
                credentials: 'include'
            });

            if (response.ok) {
                const data = await response.json();
                this.files = data.files;
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

    handleFileSelect(e) {
        this.selectedFile = e.target.files[0];
        this.error = '';
        this.success = '';
    }

    handleDragOver(e) {
        e.preventDefault();
        this.dragOver = true;
    }

    handleDragLeave(e) {
        e.preventDefault();
        this.dragOver = false;
    }

    handleDrop(e) {
        e.preventDefault();
        this.dragOver = false;

        const files = e.dataTransfer.files;
        if (files.length > 0) {
            this.selectedFile = files[0];
        }
    }

    async uploadFile() {
        if (!this.selectedFile) {
            this.error = 'Please select a file';
            return;
        }

        this.uploading = true;
        this.error = '';
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

                // Clear file input
                const input = this.shadowRoot.querySelector('input[type="file"]');
                if (input) input.value = '';

                // Reload files and stats
                await this.loadFiles();
                await this.loadStats();
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

                this.error = errorMsg;
            }
        } catch (err) {
            console.error('Upload error:', err);
            this.error = 'Network error during upload';
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

    async cleanupContainer() {
        try {
            await fetch(`${API_URL}/api/containers/stop`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                credentials: 'include'
            });
            console.log("Cleaned up existing container");
        } catch (err) {
            // Ignore errors - container might not exist
        }
    }

    async launchFile(file) {
        this.error = '';
        this.success = '';
        this.launching = true;

        try {
            // Clean up any existing container first
            console.log('Cleaning up existing containers...');
            await this.cleanupContainer();

            console.log('Starting Trame container for file:', file.originalName);
            // Start Trame container with the file
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
                const url = data.frontendUrl;
                console.log('Trame container started, URL:', url);

                // Show iframe immediately with loading message
                this.currentFileName = file.originalName;
                this.iframeUrl = 'about:blank';
                this.showIframe = true;

                // Wait for Trame to be ready by polling the URL
                console.log('Waiting for Trame to be ready...');
                const maxAttempts = 60; // 60 seconds max (file loading can take time)
                let attempts = 0;
                let ready = false;

                while (attempts < maxAttempts && !ready) {
                    attempts++;
                    try {
                        const checkResponse = await fetch(url, {
                            method: 'GET',
                            credentials: 'include',
                            cache: 'no-store'
                        });

                        if (checkResponse.ok) {
                            ready = true;
                            console.log('Trame server is ready!');
                            break;
                        }

                        console.log(`Attempt ${attempts}/${maxAttempts} - Trame returned HTTP ${checkResponse.status}, waiting...`);
                    } catch (e) {
                        console.log(`Attempt ${attempts}/${maxAttempts} - Trame not reachable yet: ${e.message}`);
                    }

                    await new Promise(resolve => setTimeout(resolve, 1000));
                }

                if (ready) {
                    // Update iframe with actual URL
                    console.log('Loading Trame in iframe...');
                    this.iframeUrl = url;
                    this.success = `Launched ${file.originalName} in Trame`;

                    // Start heartbeat to keep container alive
                    this.startHeartbeat();
                } else {
                    this.error = 'Trame took too long to start. Try again.';
                    this.showIframe = false;
                }
            } else {
                const data = await response.json();
                console.error('Failed to start container:', data);
                let errorMsg = 'Failed to launch Trame';
                if (data.error?.message) {
                    errorMsg = data.error.message;
                } else if (data.message) {
                    errorMsg = data.message;
                }
                this.error = errorMsg;
            }
        } catch (err) {
            console.error('Launch error:', err);
            this.error = err.message || 'Network error during launch';
        } finally {
            this.launching = false;
        }
    }

    handleIframeLoad(e) {
        console.log('Iframe loaded successfully');
    }

    handleIframeError(e) {
        console.error('Iframe error:', e);
        this.error = 'Failed to load Trame in iframe';
    }

    async closeIframe() {
        // Stop heartbeat
        this.stopHeartbeat();

        // Hide iframe
        this.showIframe = false;
        this.iframeUrl = '';

        // Cleanup container
        await this.cleanupContainer();
        this.success = `Closed Trame session for ${this.currentFileName}`;
        this.currentFileName = '';
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

    startHeartbeat() {
        // Send heartbeat every 60 seconds to keep container alive
        this.stopHeartbeat(); // Clear any existing interval
        this.heartbeatInterval = setInterval(() => {
            fetch(`${API_URL}/api/containers/heartbeat`, {
                method: 'POST',
                credentials: 'include'
            }).catch(err => console.log('Heartbeat failed:', err.message));
        }, 60000); // 60 seconds
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
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    render() {
        return html`
            <div class="file-manager">
                <h2>📁 File Manager</h2>

                ${this.error ? html`<div class="error">${this.error}</div>` : ''}
                ${this.success ? html`<div class="success">${this.success}</div>` : ''}

                <div class="storage-stats">
                    <div>
                        <strong>Storage Used:</strong> ${this.stats.megabytesUsed} MB
                    </div>
                    <div>
                        <strong>Files:</strong> ${this.stats.fileCount}
                    </div>
                </div>

                <div 
                    class="upload-area ${this.dragOver ? 'drag-over' : ''}"
                    @dragover=${this.handleDragOver}
                    @dragleave=${this.handleDragLeave}
                    @drop=${this.handleDrop}
                >
                    <div>📤 Drag & drop file here or click to browse</div>
                    <input 
                        type="file" 
                        id="fileInput"
                        @change=${this.handleFileSelect}
                        ?disabled=${this.uploading}
                    />
                    <label for="fileInput">
                        <button class="upload-btn" @click=${() => this.shadowRoot.querySelector('#fileInput').click()} ?disabled=${this.uploading}>
                            Choose File
                        </button>
                    </label>
                    
                    ${this.selectedFile ? html`
                        <div class="file-info">
                            Selected: ${this.selectedFile.name} (${this.formatBytes(this.selectedFile.size)})
                        </div>
                        <button class="upload-btn" @click=${this.uploadFile} ?disabled=${this.uploading}>
                            ${this.uploading ? html`<span class="spinner"></span>Uploading...` : 'Upload File'}
                        </button>
                    ` : ''}
                </div>

                <div class="files-list">
                    <h3>Your Files</h3>
                    ${this.loading ? html`<div>Loading files...</div>` : ''}
                    
                    ${this.files.length === 0 && !this.loading ? html`
                        <div class="empty-state">
                            No files uploaded yet. Upload your first file above!
                        </div>
                    ` : ''}

                    ${this.files.map(file => html`
                        <div class="file-item">
                            <div class="file-details">
                                <div class="file-name">${file.originalName}</div>
                                <div class="file-meta">
                                    ${this.formatBytes(file.size)} • ${file.mimeType} • ${this.formatDate(file.uploadDate)}
                                </div>
                            </div>
                            <div class="file-actions">
                                <button class="action-btn launch-btn" @click=${() => this.launchFile(file)}>
                                    🚀 Launch
                                </button>
                                <button class="action-btn download-btn" @click=${() => this.downloadFile(file)}>
                                    ⬇️ Download
                                </button>
                                <button class="action-btn delete-btn" @click=${() => this.deleteFile(file)}>
                                    🗑️ Delete
                                </button>
                            </div>
                        </div>
                    `)}
                </div>
            </div>

            ${this.showIframe ? html`
                <div class="iframe-overlay">
                    <div class="iframe-header">
                        <div class="iframe-title">🚀 Trame: ${this.currentFileName}</div>
                        <div>
                            <button class="open-window-btn" @click=${this.openInNewWindow} ?disabled=${this.iframeUrl === 'about:blank'}>
                                🗗 Open in New Window
                            </button>
                            <button class="close-iframe-btn" @click=${this.closeIframe}>
                                ✕ Close Trame
                            </button>
                        </div>
                    </div>
                    <div class="iframe-container">
                        ${this.iframeUrl === 'about:blank' ? html`
                            <div style="flex: 1; display: flex; align-items: center; justify-content: center; background: white;">
                                <div style="text-align: center;">
                                    <div class="spinner" style="width: 40px; height: 40px; border-width: 4px; margin: 0 auto 20px;"></div>
                                    <h3>Starting Trame...</h3>
                                    <p>This may take a few seconds</p>
                                </div>
                            </div>
                        ` : html`
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
                        `}
                    </div>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('file-manager', FileManager);
