import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { t } from './i18n/index.js';
import './components/page-layout-template.js';
import './components/theme-toggle.js';
import './change-password-form.js';
import './components/local-slicer-viewer-options.js';
import './components/home-layout-settings.js';
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

            .section-title-row {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .section-hint {
                position: relative;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 1.15rem;
                height: 1.15rem;
                padding: 0;
                border: 1px solid var(--color-border);
                border-radius: 50%;
                background: transparent;
                color: var(--color-text-secondary);
                font: inherit;
                font-size: 0.7rem;
                font-weight: 600;
                line-height: 1;
                cursor: help;
            }

            .section-hint:hover,
            .section-hint:focus-visible {
                color: var(--color-text-primary);
                border-color: var(--color-text-secondary);
                outline: none;
            }

            .section-hint .hint-bubble {
                position: absolute;
                left: 50%;
                bottom: calc(100% + 8px);
                transform: translateX(-50%);
                width: max-content;
                max-width: min(280px, 70vw);
                padding: 8px 10px;
                border-radius: 8px;
                background: var(--color-text-primary);
                color: var(--color-background, #fff);
                font-size: 0.8rem;
                font-weight: 400;
                line-height: 1.35;
                text-align: left;
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
                opacity: 0;
                pointer-events: none;
                transition: opacity 0.12s ease;
                z-index: 2;
            }

            .section-hint .hint-bubble::after {
                content: '';
                position: absolute;
                top: 100%;
                left: 50%;
                margin-left: -5px;
                border: 5px solid transparent;
                border-top-color: var(--color-text-primary);
            }

            .section-hint:hover .hint-bubble,
            .section-hint:focus-visible .hint-bubble {
                opacity: 1;
            }

            .section-description {
                margin: 0;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
            }

            .profile-form {
                display: flex;
                flex-direction: column;
                gap: 18px;
                margin-top: 8px;
            }

            .avatar-row {
                display: flex;
                align-items: center;
                gap: 16px;
                flex-wrap: wrap;
            }

            .avatar-preview {
                width: 56px;
                height: 56px;
                border-radius: 50%;
                background: var(--color-secondary);
                color: var(--color-on-secondary);
                display: flex;
                align-items: center;
                justify-content: center;
                font-size: 1.4rem;
                font-weight: 650;
                flex-shrink: 0;
                overflow: hidden;
                border: 1px solid var(--color-border);
            }

            .avatar-preview img {
                width: 100%;
                height: 100%;
                object-fit: cover;
                display: block;
                border-radius: 50%;
            }

            .avatar-actions {
                display: flex;
                gap: 8px;
                align-items: center;
                flex-wrap: wrap;
            }

            .avatar-hint {
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                margin-top: 4px;
            }

            .avatar-error {
                font-size: 0.85rem;
                color: #b42318;
                margin-top: 4px;
            }

            :host-context([data-theme='dark']) .avatar-error {
                color: #ff8a80;
            }

            .name-row {
                display: grid;
                grid-template-columns: 1fr 1fr;
                gap: 12px;
            }

            @media (max-width: 480px) {
                .name-row {
                    grid-template-columns: 1fr;
                }
            }

            .form-group {
                display: flex;
                flex-direction: column;
                gap: 6px;
            }

            .form-group label {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .form-group input {
                font: inherit;
                padding: 8px 10px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                background: var(--color-background);
                color: var(--color-text-primary);
            }

            .form-group input:disabled {
                opacity: 0.65;
            }

            .autosave-status {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                min-height: 1.2em;
            }

            .autosave-status[data-state='saving'] {
                color: var(--color-text-secondary);
            }

            .autosave-status[data-state='saved'] {
                color: var(--color-secondary);
            }

            .autosave-status[data-state='error'] {
                color: #b42318;
            }

            .settings-footer {
                display: flex;
                flex-wrap: wrap;
                align-items: center;
                gap: 12px;
                margin-top: 4px;
                padding-top: 4px;
            }

            .settings-footer button {
                font: inherit;
                padding: 8px 16px;
                border-radius: var(--radius-md, 8px);
                border: 1px solid var(--color-border);
                background: var(--color-primary, #2f6fed);
                color: #fff;
                cursor: pointer;
            }

            .settings-footer button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .small-button {
                display: inline-flex;
                align-items: center;
                font: inherit;
                font-size: 0.85rem;
                padding: 6px 12px;
                border-radius: var(--radius-md, 8px);
                border: 1px solid var(--color-border);
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                cursor: pointer;
                white-space: nowrap;
            }

            .small-button:hover {
                background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface, var(--color-background)));
                border-color: var(--color-primary);
            }

            .small-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .small-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .profile-status {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                min-height: 1.2em;
            }

            .profile-status[data-state='saved'] {
                color: var(--color-secondary);
            }

            .profile-status[data-state='error'] {
                color: #b42318;
            }

            .profile-status[data-state='dirty'] {
                color: var(--color-text-secondary);
            }

            :host-context([data-theme='dark']) .autosave-status[data-state='error'],
            :host-context([data-theme='dark']) .profile-status[data-state='error'] {
                color: #ff8a80;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            user: { type: Object },
            theme: { type: String },
            useFullSlicer: { type: Boolean },
            homeLayout: { type: Object },
            useSimplifiedViewer: { type: Boolean },
            saveState: { type: String },
            saveStatusMessage: { type: String },
            errorMessage: { type: String },
            firstName: { type: String },
            lastName: { type: String },
            profileLinked: { type: Boolean },
            profileLoading: { type: Boolean },
            profileSaving: { type: Boolean },
            profileState: { type: String },
            profileStatusMessage: { type: String },
            avatarUploading: { type: Boolean },
            avatarError: { type: String }
        };
    }

    constructor() {
        super();
        this.username = t('common.guest');
        this.avatarUrl = '';
        this.user = null;
        this.errorMessage = '';
        this.saveState = 'idle';
        this.saveStatusMessage = t('settings.autoSavePrefs');
        this.firstName = '';
        this.lastName = '';
        this.profileLinked = false;
        this.profileLoading = true;
        this.profileSaving = false;
        this.profileState = 'idle';
        this.profileStatusMessage = '';
        this.avatarUploading = false;
        this.avatarError = '';
        this._savedFirstName = '';
        this._savedLastName = '';
        this._saveTimer = null;
        this._savedClearTimer = null;
        this._persistGeneration = 0;
        this._onBeforeUnload = (event) => this.handleBeforeUnload(event);
        const prefs = getCachedUserPreferences();
        this.theme = prefs.theme;
        this.useFullSlicer = prefs.useFullSlicer;
        this.homeLayout = prefs.homeLayout;
        this.useSimplifiedViewer = prefs.useSimplifiedViewer;
    }

    connectedCallback() {
        super.connectedCallback();
        this.hydrateProfileFromUser(this.user);
        this.loadProfile();
        window.addEventListener('beforeunload', this._onBeforeUnload);
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._onBeforeUnload);
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

    updated(changed) {
        if (changed.has('user') && this.user && !this.isProfileDirty()) {
            this.hydrateProfileFromUser(this.user);
        }
    }

    hydrateProfileFromUser(user) {
        if (!user) return;
        if (user.firstName != null) this.firstName = String(user.firstName || '');
        if (user.lastName != null) this.lastName = String(user.lastName || '');
        this._savedFirstName = this.firstName;
        this._savedLastName = this.lastName;
    }

    setSavedProfileBaseline(firstName, lastName) {
        this._savedFirstName = String(firstName || '').trim();
        this._savedLastName = String(lastName || '').trim();
        this.firstName = this._savedFirstName;
        this.lastName = this._savedLastName;
    }

    isProfileDirty() {
        if (!this.profileLinked) return false;
        const first = String(this.firstName || '').trim();
        const last = String(this.lastName || '').trim();
        return first !== this._savedFirstName || last !== this._savedLastName;
    }

    /**
     * Used by slicer-app before leaving Settings (menu, back, logout).
     * @returns {boolean} true if navigation may proceed
     */
    confirmLeave() {
        if (!this.isProfileDirty()) return true;
        return window.confirm(t('settings.unsavedWarning'));
    }

    handleBeforeUnload(event) {
        if (!this.isProfileDirty()) return;
        event.preventDefault();
        event.returnValue = '';
    }

    async loadProfile() {
        this.profileLoading = true;
        this.profileState = 'idle';
        this.profileStatusMessage = '';
        try {
            const res = await fetch(`${API_URL}/api/auth/me`, {
                credentials: 'include',
                cache: 'no-store'
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error?.message || data.message || t('settings.profileFailed'));
            }
            this.profileLinked = Boolean(data.identity?.directusLinked);
            const u = data.user || {};
            this.setSavedProfileBaseline(u.firstName || '', u.lastName || '');
        } catch (err) {
            this.profileLinked = false;
            console.warn('Settings profile load skipped:', err.message || err);
        } finally {
            this.profileLoading = false;
        }
    }

    handleMenuSelectionChange(event) {
        if (!this.confirmLeave()) {
            event.stopPropagation();
            return;
        }
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    onProfileFieldInput(field, value) {
        this[field] = value;
        if (this.isProfileDirty()) {
            this.profileState = 'dirty';
            this.profileStatusMessage = t('settings.unsavedHint');
        } else {
            this.profileState = 'idle';
            this.profileStatusMessage = '';
        }
    }

    queuePersist(patch) {
        if (this._saveTimer) {
            clearTimeout(this._saveTimer);
        }
        this.saveState = 'saving';
        this.saveStatusMessage = t('common.saving');
        this.errorMessage = '';
        this._saveTimer = setTimeout(() => {
            this._saveTimer = null;
            this.persist(patch);
        }, AUTOSAVE_DEBOUNCE_MS);
    }

    async persist(patch) {
        const generation = ++this._persistGeneration;
        this.saveState = 'saving';
        this.saveStatusMessage = t('common.saving');
        this.errorMessage = '';
        try {
            const next = await saveUserPreferences(patch);
            if (generation !== this._persistGeneration) {
                return;
            }
            this.theme = next.theme;
            this.useFullSlicer = next.useFullSlicer;
            this.homeLayout = next.homeLayout;
            this.useSimplifiedViewer = next.useSimplifiedViewer;
            this.saveState = 'saved';
            this.saveStatusMessage = t('settings.saved');
            if (this._savedClearTimer) clearTimeout(this._savedClearTimer);
            this._savedClearTimer = setTimeout(() => {
                if (this.saveState === 'saved') {
                    this.saveState = 'idle';
                    this.saveStatusMessage = t('settings.autoSavePrefs');
                }
                this._savedClearTimer = null;
            }, 2000);
        } catch (error) {
            if (generation !== this._persistGeneration) {
                return;
            }
            this.saveState = 'error';
            this.saveStatusMessage = t('settings.saveFailed');
            this.errorMessage = error.message || t('settings.unableToSave');
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

    handleHomeLayoutChange(event) {
        this.homeLayout = event?.detail?.layout;
        this.queuePersist({
            theme: this.theme,
            useFullSlicer: this.useFullSlicer,
            useSimplifiedViewer: this.useSimplifiedViewer,
            homeLayout: this.homeLayout
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

    async handleProfileSave(e) {
        e?.preventDefault?.();
        if (!this.profileLinked || this.profileSaving) return;

        const firstName = String(this.firstName || '').trim();
        const lastName = String(this.lastName || '').trim();
        if (!firstName || !lastName) {
            this.profileState = 'error';
            this.profileStatusMessage = t('auth.changePassword.nameRequired');
            return;
        }

        this.profileSaving = true;
        this.profileState = 'saving';
        this.profileStatusMessage = t('settings.savingProfile');
        try {
            const res = await fetch(`${API_URL}/api/auth/profile`, {
                method: 'PUT',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ firstName, lastName })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                const serverMsg = data.error?.message || data.message || data.error;
                throw new Error(typeof serverMsg === 'string' ? serverMsg : t('settings.profileFailed'));
            }
            this.setSavedProfileBaseline(
                data.user?.firstName || firstName,
                data.user?.lastName || lastName
            );
            this.profileState = 'saved';
            this.profileStatusMessage = t('settings.profileSaved');
            this.dispatchEvent(new CustomEvent('profile-updated', {
                detail: { user: data.user },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.profileState = 'error';
            this.profileStatusMessage = err.message || t('settings.profileFailed');
        } finally {
            this.profileSaving = false;
        }
    }

    async handleAvatarFileChange(e) {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = '';
        this.avatarUploading = true;
        this.avatarError = '';
        try {
            const form = new FormData();
            form.append('avatar', file);
            const res = await fetch(`${API_URL}/api/auth/avatar`, {
                method: 'POST',
                credentials: 'include',
                body: form
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                throw new Error(data.error?.message || data.message || t('settings.avatarUploadFailed'));
            }
            this.avatarUrl = data.avatarUrl || '/api/auth/avatar';
            this.dispatchEvent(new CustomEvent('profile-updated', {
                detail: { user: { avatarUrl: this.avatarUrl } },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.avatarError = err.message || t('settings.avatarUploadFailed');
        } finally {
            this.avatarUploading = false;
        }
    }

    async handleAvatarRemove() {
        if (!this.avatarUrl || this.avatarUploading) return;
        this.avatarUploading = true;
        this.avatarError = '';
        try {
            const res = await fetch(`${API_URL}/api/auth/avatar`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error?.message || data.message || t('settings.avatarRemoveFailed'));
            }
            this.avatarUrl = '';
            this.dispatchEvent(new CustomEvent('profile-updated', {
                detail: { user: { avatarUrl: null } },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.avatarError = err.message || t('settings.avatarRemoveFailed');
        } finally {
            this.avatarUploading = false;
        }
    }

    render() {
        const showProfile = !this.profileLoading && this.profileLinked;
        const dirty = this.isProfileDirty();

        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin || false}
                selectedMenuKey=""
                homeHref="/file-manager"
                homeLabel=${t('common.home')}
                pageTitle=${t('settings.title')}
                pageDescription=${t('settings.description')}
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
                    ${showProfile ? html`
                    <section class="settings-section">
                        <div class="section-title-row">
                            <h2 class="section-title">${t('settings.profile')}</h2>
                            <button
                                type="button"
                                class="section-hint"
                                aria-label=${t('settings.profileHint')}
                            >
                                ?
                                <span class="hint-bubble" role="tooltip">${t('settings.profileHint')}</span>
                            </button>
                        </div>
                        <div class="profile-form">
                            <div class="avatar-row">
                                <div class="avatar-preview">
                                    ${this.avatarUrl
                                        ? html`<img src=${this.avatarUrl} alt="" aria-hidden="true">`
                                        : (this.firstName || this.username || '?').charAt(0).toUpperCase()}
                                </div>
                                <div>
                                    <div class="avatar-actions">
                                        <label class="small-button" style=${this.avatarUploading ? 'opacity:0.6;cursor:not-allowed;' : 'cursor:pointer;'}>
                                            <input
                                                type="file"
                                                accept="image/*"
                                                style="display:none"
                                                ?disabled=${this.avatarUploading}
                                                @change=${(e) => this.handleAvatarFileChange(e)}
                                            >
                                            ${this.avatarUploading ? t('settings.avatarUploading') : t('settings.avatarUpload')}
                                        </label>
                                        ${this.avatarUrl ? html`
                                            <button
                                                type="button"
                                                class="small-button"
                                                ?disabled=${this.avatarUploading}
                                                @click=${() => this.handleAvatarRemove()}
                                            >${t('settings.avatarRemove')}</button>
                                        ` : ''}
                                    </div>
                                    ${this.avatarError ? html`<p class="avatar-error">${this.avatarError}</p>` : ''}
                                </div>
                            </div>
                            <div class="name-row">
                                <div class="form-group">
                                    <label for="settings-firstName">${t('settings.firstName')}</label>
                                    <input
                                        id="settings-firstName"
                                        type="text"
                                        autocomplete="given-name"
                                        .value=${this.firstName}
                                        ?disabled=${this.profileSaving}
                                        @input=${(e) => this.onProfileFieldInput('firstName', e.target.value)}
                                    />
                                </div>
                                <div class="form-group">
                                    <label for="settings-lastName">${t('settings.lastName')}</label>
                                    <input
                                        id="settings-lastName"
                                        type="text"
                                        autocomplete="family-name"
                                        .value=${this.lastName}
                                        ?disabled=${this.profileSaving}
                                        @input=${(e) => this.onProfileFieldInput('lastName', e.target.value)}
                                    />
                                </div>
                            </div>
                        </div>
                    </section>
                    <section class="settings-section">
                        <h2 class="section-title">${t('auth.changePassword.settingsTitle')}</h2>
                        <change-password-form
                            .firstName=${this.firstName}
                            .lastName=${this.lastName}
                        ></change-password-form>
                    </section>
                    ` : ''}

                    <section class="settings-section">
                        <h2 class="section-title">${t('settings.appearance')}</h2>
                        <p class="section-description">
                            ${t('settings.appearanceHint')}
                        </p>
                        <theme-toggle
                            .theme=${this.theme}
                            @theme-change=${(e) => this.handleThemeChange(e)}
                        ></theme-toggle>
                        <div class="autosave-status" data-state=${this.saveState} aria-live="polite">
                            ${this.saveStatusMessage}
                        </div>
                    </section>

                    <section class="settings-section">
                        <h2 class="section-title">${t('homeLayout.title')}</h2>
                        <p class="section-description">${t('homeLayout.description')}</p>
                        <home-layout-settings
                            .layout=${this.homeLayout}
                            @layout-change=${(e) => this.handleHomeLayoutChange(e)}
                        ></home-layout-settings>
                    </section>

                    <section class="settings-section">
                        <h2 class="section-title">${t('settings.localViewer')}</h2>
                        <p class="section-description">
                            ${t('settings.localViewerHintFull')}
                        </p>
                        <local-slicer-viewer-options
                            .useFullSlicer=${this.useFullSlicer}
                            .useSimplifiedViewer=${this.useSimplifiedViewer}
                            .canEdit=${true}
                            .showComposeHint=${true}
                            @options-change=${(e) => this.handleViewerOptionsChange(e)}
                        ></local-slicer-viewer-options>
                    </section>

                    ${showProfile ? html`
                    <div class="settings-footer">
                        <button
                            type="button"
                            ?disabled=${this.profileSaving || !dirty}
                            @click=${(e) => this.handleProfileSave(e)}
                        >
                            ${this.profileSaving
                                ? t('settings.savingProfile')
                                : t('settings.saveProfile')}
                        </button>
                        <span
                            class="profile-status"
                            data-state=${this.profileState}
                            aria-live="polite"
                        >${this.profileStatusMessage}</span>
                    </div>
                    ` : ''}
                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('user-settings-page', UserSettingsPage);
