import { LitElement, html, css } from 'lit-element';
import { APP_MENU_ITEMS } from './components/app-menu.js';
import './components/page-layout-template.js';
import './components/theme-toggle.js';
import './components/local-slicer-viewer-options.js';
import './components/page-content-message.js';
import {
    getCachedUserPreferences,
    saveUserPreferences
} from './utils/userPreferences.js';

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
                border-radius: 10px;
                padding: 14px 16px;
                display: flex;
                flex-direction: column;
                gap: 10px;
                background: var(--color-surface, var(--color-background));
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
                color: var(--color-text-secondary);
                min-height: 1.2em;
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
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            menuItems: { type: Array },
            theme: { type: String },
            useFullSlicer: { type: Boolean },
            useSimplifiedViewer: { type: Boolean },
            saveState: { type: String },
            saveStatusMessage: { type: String },
            errorMessage: { type: String }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.menuItems = APP_MENU_ITEMS;
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
                .menuItems=${this.menuItems}
                .username=${this.username}
                selectedMenuKey=""
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="Settings"
                pageDescription="Appearance and Local viewer preferences for your account. Changes save automatically."
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
                        <h2 class="section-title">Local viewer</h2>
                        <p class="section-description">
                            Controls which Local viewer opens from My Projects when the active GPU provider is Local.
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
                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('user-settings-page', UserSettingsPage);
