import { LitElement, html, css } from 'lit-element';
import './components/page-layout-template.js';
import './components/theme-toggle.js';
import './components/local-slicer-viewer-options.js';
import './components/page-content-message.js';
import {
    getCachedUserPreferences,
    saveUserPreferences
} from './utils/userPreferences.js';
import { loadAppFeatures, getAppFeatures } from './services/features.js';
import {
    listPasskeys,
    registerPasskey,
    revokePasskey,
    supportsWebAuthn
} from './services/webauthn.js';

const AUTOSAVE_DEBOUNCE_MS = 250;

export class UserSettingsPage extends LitElement {
    static get styles() {
        return css`
            .settings-stack {
                display: flex;
                flex-direction: column;
                gap: 20px;
                margin-top: 16px;
            }

            .settings-section {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            }

            :host-context([data-theme='dark']) .settings-section {
                border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
            }

            .section-title {
                margin: 0;
                font-size: 1.05rem;
                color: var(--color-text-primary);
            }

            .section-description {
                margin: 0;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
            }

            .save-status {
                font-size: 0.85rem;
                color: var(--color-text-primary);
                min-height: 1.2em;
                font-weight: 500;
            }

            .save-status[data-state='saving'] {
                color: var(--color-text-secondary);
            }

            .save-status[data-state='saved'] {
                color: var(--color-secondary);
            }

            .save-status[data-state='error'] {
                color: #b42318;
            }

            :host-context([data-theme='dark']) .save-status {
                color: color-mix(in srgb, var(--color-text-primary) 92%, #fff);
            }

            :host-context([data-theme='dark']) .save-status[data-state='saving'] {
                color: color-mix(in srgb, var(--color-text-secondary) 70%, #fff);
            }

            :host-context([data-theme='dark']) .save-status[data-state='saved'] {
                color: color-mix(in srgb, #9db7ff 75%, #fff);
            }

            :host-context([data-theme='dark']) .save-status[data-state='error'] {
                color: #ff8a80;
            }

            .passkey-list {
                list-style: none;
                margin: 0;
                padding: 0;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .passkey-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                padding: 8px 0;
                border-bottom: 1px solid var(--color-border);
                font-size: 0.9rem;
            }

            .passkey-row:last-child {
                border-bottom: none;
            }

            .passkey-meta {
                color: var(--color-text-secondary);
                font-size: 0.8rem;
            }

            .passkey-actions {
                display: flex;
                flex-wrap: wrap;
                gap: 8px;
                margin-top: 8px;
            }

            .settings-btn {
                padding: 8px 12px;
                border-radius: var(--radius-sm);
                border: 1px solid var(--color-border);
                background: var(--color-primary, #4CAF50);
                color: #fff;
                cursor: pointer;
                font-size: 0.9rem;
            }

            .settings-btn:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .settings-btn.danger {
                background: transparent;
                color: #b42318;
                border-color: #b42318;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            theme: { type: String },
            useFullSlicer: { type: Boolean },
            useSimplifiedViewer: { type: Boolean },
            saveState: { type: String },
            saveStatusMessage: { type: String },
            errorMessage: { type: String },
            webauthnEnabled: { type: Boolean },
            passkeys: { type: Array },
            passkeyBusy: { type: Boolean },
            passkeyMessage: { type: String }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.errorMessage = '';
        this.saveState = 'idle';
        this.saveStatusMessage = 'Changes save automatically.';
        this._saveTimer = null;
        this._savedClearTimer = null;
        this._persistGeneration = 0;
        const prefs = getCachedUserPreferences();
        this.theme = prefs.theme;
        this.useFullSlicer = prefs.useFullSlicer;
        this.useSimplifiedViewer = prefs.useSimplifiedViewer;
        this.webauthnEnabled = false;
        this.passkeys = [];
        this.passkeyBusy = false;
        this.passkeyMessage = '';
    }

    connectedCallback() {
        super.connectedCallback();
        this._loadPasskeySection();
    }

    async _loadPasskeySection() {
        try {
            await loadAppFeatures();
            const auth = getAppFeatures()?.auth;
            this.webauthnEnabled = auth?.webauthn?.enabled === true
                && supportsWebAuthn();
            if (this.webauthnEnabled) {
                this.passkeys = await listPasskeys();
            }
        } catch {
            this.webauthnEnabled = false;
        }
    }

    async handleAddPasskey() {
        this.passkeyBusy = true;
        this.passkeyMessage = '';
        this.errorMessage = '';
        try {
            await registerPasskey({ friendlyName: 'This device' });
            this.passkeys = await listPasskeys();
            this.passkeyMessage = 'Passkey added. You can use it on the sign-in screen.';
        } catch (err) {
            if (err?.name === 'NotAllowedError') {
                this.passkeyMessage = 'Passkey setup was cancelled.';
            } else {
                this.errorMessage = err.message || 'Could not add passkey.';
            }
        } finally {
            this.passkeyBusy = false;
        }
    }

    async handleRemovePasskey(id) {
        if (!window.confirm('Remove this passkey from your account?')) return;
        this.passkeyBusy = true;
        this.passkeyMessage = '';
        try {
            await revokePasskey(id);
            this.passkeys = await listPasskeys();
            this.passkeyMessage = 'Passkey removed.';
        } catch (err) {
            this.errorMessage = err.message || 'Could not remove passkey.';
        } finally {
            this.passkeyBusy = false;
        }
    }

    disconnectedCallback() {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
            this._saveTimer = null;
        }
        if (this._savedClearTimer) {
            clearTimeout(this._savedClearTimer);
            this._savedClearTimer = null;
        }
        super.disconnectedCallback();
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    queuePersist(patch) {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this.saveState = 'saving';
        this.saveStatusMessage = 'Saving…';
        this.errorMessage = '';
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.persist(patch);
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    async persist(patch) {
        const generation = ++this._persistGeneration;
        this.saveState = 'saving';
        this.saveStatusMessage = 'Saving…';
        this.errorMessage = '';
        try {
            const next = await saveUserPreferences(patch);
            if (generation !== this._persistGeneration) {
                return;
            }
            this.theme = next.theme;
            this.useFullSlicer = next.useFullSlicer;
            this.useSimplifiedViewer = next.useSimplifiedViewer;
            this.saveState = 'saved';
            this.saveStatusMessage = 'Saved to your account.';
            if (this._savedClearTimer) clearTimeout(this._savedClearTimer);
            this._savedClearTimer = setTimeout(() => {
                if (this.saveState === 'saved') {
                    this.saveState = 'idle';
                    this.saveStatusMessage = 'Changes save automatically.';
                }
                this._savedClearTimer = null;
            }, 2000);
        } catch (error) {
            if (generation !== this._persistGeneration) {
                return;
            }
            this.saveState = 'error';
            this.saveStatusMessage = 'Could not save.';
            this.errorMessage = error.message || 'Unable to save settings.';
        }
    }

    handleThemeChange(event) {
        const theme = event?.detail?.theme === 'dark' ? 'dark' : 'light';
        this.theme = theme;
        this.queuePersist({
            theme,
            useFullSlicer: this.useFullSlicer,
            useSimplifiedViewer: this.useSimplifiedViewer
        });
    }

    handleViewerOptionsChange(event) {
        const next = event?.detail || {};
        this.useFullSlicer = next.useFullSlicer === true;
        this.useSimplifiedViewer = next.useSimplifiedViewer === true;
        this.queuePersist({
            theme: this.theme,
            useFullSlicer: this.useFullSlicer,
            useSimplifiedViewer: this.useSimplifiedViewer
        });
    }

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey=""
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="Settings"
                pageDescription="Appearance and Local Viewer preferences for your account. Changes save automatically."
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.errorMessage ? html`
                    <page-content-message
                        slot="content"
                        variant="error"
                        .message=${this.errorMessage}
                    ></page-content-message>
                ` : ''}

                <div slot="content" class="settings-stack">
                    <div class="save-status" data-state=${this.saveState} aria-live="polite">
                        ${this.saveStatusMessage}
                    </div>

                    <section class="settings-section">
                        <h2 class="section-title">Appearance</h2>
                        <p class="section-description">
                            Choose light or dark mode for the app shell.
                        </p>
                        <theme-toggle
                            .theme=${this.theme}
                            @theme-change=${(e) => this.handleThemeChange(e)}
                        ></theme-toggle>
                    </section>

                    <section class="settings-section">
                        <h2 class="section-title">Local Viewer</h2>
                        <p class="section-description">
                            Controls which local viewer opens from My Projects when the active GPU provider is Local.
                            Settings follow your account across devices.
                        </p>
                        <local-slicer-viewer-options
                            .useFullSlicer=${this.useFullSlicer}
                            .useSimplifiedViewer=${this.useSimplifiedViewer}
                            .canEdit=${true}
                            .showComposeHint=${true}
                            @options-change=${(e) => this.handleViewerOptionsChange(e)}
                        ></local-slicer-viewer-options>
                    </section>

                    ${this.webauthnEnabled ? html`
                    <section class="settings-section">
                        <h2 class="section-title">Passkeys</h2>
                        <p class="section-description">
                            Sign in with Face ID, Windows Hello, or a security key after you register a passkey.
                            Password (and MFA when required) remains available as a backup.
                        </p>
                        ${this.passkeys?.length ? html`
                        <ul class="passkey-list">
                            ${this.passkeys.map((pk) => html`
                            <li class="passkey-row">
                                <div>
                                    <div>${pk.friendlyName || 'Passkey'}</div>
                                    <div class="passkey-meta">
                                        ${pk.deviceType || 'device'}
                                        ${pk.createdAt ? ` · added ${pk.createdAt}` : ''}
                                    </div>
                                </div>
                                <button
                                    type="button"
                                    class="settings-btn danger"
                                    ?disabled=${this.passkeyBusy}
                                    @click=${() => this.handleRemovePasskey(pk.id)}
                                >Remove</button>
                            </li>
                            `)}
                        </ul>
                        ` : html`
                        <p class="section-description">No passkeys on this account yet.</p>
                        `}

                        <div class="passkey-actions">
                            <button
                                type="button"
                                class="settings-btn"
                                ?disabled=${this.passkeyBusy}
                                @click=${() => this.handleAddPasskey()}
                            >
                                ${this.passkeyBusy ? 'Working…' : 'Add passkey'}
                            </button>
                        </div>
                        ${this.passkeyMessage ? html`
                            <p class="section-description">${this.passkeyMessage}</p>
                        ` : ''}
                    </section>
                    ` : ''}
                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('user-settings-page', UserSettingsPage);
