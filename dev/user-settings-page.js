import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { t } from './i18n/index.js';
import './components/page-layout-template.js';
import './components/theme-toggle.js';
import './components/change-password-dialog.js';
import './components/local-slicer-viewer-options.js';
import './components/home-layout-settings.js';
import './components/page-content-message.js';
import {
    getCachedUserPreferences,
    saveUserPreferences
} from './utils/userPreferences.js';
import { isSlicerWebDevModeEnabled } from './services/features.js';

export class UserSettingsPage extends LitElement {
    static get styles() {
        return css`
            .settings-stack {
                display: flex;
                flex-direction: column;
                gap: 20px;
            }

            /* ── Tabs ── */
            .tabs-bar {
                display: flex;
                gap: 4px;
                padding: 4px;
                overflow-x: auto;
                scrollbar-width: none;
                background: var(--color-surface, var(--color-background));
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg, 12px);
                margin-bottom: 4px;
            }
            .tabs-bar::-webkit-scrollbar { display: none; }

            .tab-btn {
                flex: 1;
                padding: 9px 18px;
                font: inherit;
                font-size: 0.9rem;
                background: none;
                border: none;
                border-radius: calc(var(--radius-lg, 12px) - 4px);
                color: var(--color-text-secondary);
                cursor: pointer;
                white-space: nowrap;
                transition: color 0.12s, background 0.12s;
                text-align: center;
            }
            .tab-btn:hover {
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
                color: var(--color-text-primary);
            }
            .tab-btn:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
            }
            .tab-btn[aria-selected='true'] {
                background: var(--color-primary, #2f6fed);
                color: #fff;
                font-weight: 600;
                box-shadow: 0 1px 4px rgba(0,0,0,0.18);
            }

            /* ── Sections ── */
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

            .settings-save-bar {
                display: flex;
                align-items: center;
                justify-content: flex-end;
                gap: 12px;
                padding: 12px 0 4px;
                border-top: 1px solid var(--color-border);
            }

            .save-status {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                min-height: 1.2em;
            }

            .save-status[data-state='saved'] { color: var(--color-secondary); }
            .save-status[data-state='error'] { color: #b42318; }

            :host-context([data-theme='dark']) .save-status[data-state='error'] {
                color: #ff8a80;
            }

            .btn-save-profile {
                font: inherit;
                font-size: 0.9rem;
                padding: 8px 20px;
                width: fit-content;
                border-radius: var(--radius-md, 8px);
                border: none;
                background: var(--color-primary, #2f6fed);
                color: #fff;
                cursor: pointer;
                font-weight: 500;
            }

            .btn-save-profile:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .checkbox-row {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                cursor: pointer;
                font-size: 0.9rem;
            }

            .checkbox-row input[type='checkbox'] {
                margin-top: 3px;
                flex-shrink: 0;
                width: 16px;
                height: 16px;
                cursor: pointer;
                accent-color: var(--color-primary);
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

        `;
    }

    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean },
            user: { type: Object },
            theme: { type: String },
            useFullSlicer: { type: Boolean },
            homeLayout: { type: Object },
            useSimplifiedViewer: { type: Boolean },
            slicerWebChannel: { type: String },
            notifyRegistrationApproval: { type: Boolean },
            saveState: { type: String },
            saveStatusMessage: { type: String },
            errorMessage: { type: String },
            firstName: { type: String },
            lastName: { type: String },
            profileLinked: { type: Boolean },
            profileLoading: { type: Boolean },
            profileSaving: { type: Boolean },
            avatarUploading: { type: Boolean },
            avatarError: { type: String },
            _activeTab: { type: String },
            _prefsDirty: { type: Boolean }
        };
    }

    constructor() {
        super();
        this.username = t('common.guest');
        this.avatarUrl = '';
        this.user = null;
        this.errorMessage = '';
        this.saveState = 'idle';
        this.saveStatusMessage = '';
        this.firstName = '';
        this.lastName = '';
        this.profileLinked = false;
        this.profileLoading = true;
        this.profileSaving = false;
        this.avatarUploading = false;
        this.avatarError = '';
        this._activeTab = 'account';
        this._savedFirstName = '';
        this._savedLastName = '';
        this._prefsDirty = false;
        this._savedClearTimer = null;
        this._onBeforeUnload = (event) => this.handleBeforeUnload(event);
        const prefs = getCachedUserPreferences();
        this.theme = prefs.theme;
        this.useFullSlicer = prefs.useFullSlicer;
        this.homeLayout = prefs.homeLayout;
        this.useSimplifiedViewer = prefs.useSimplifiedViewer;
        this.slicerWebChannel = prefs.slicerWebChannel ?? 'stable';
        this.notifyRegistrationApproval = prefs.notifyRegistrationApproval !== false;
    }

    connectedCallback() {
        super.connectedCallback();
        this.hydrateProfileFromUser(this.user);
        this.loadProfile();
        window.addEventListener('beforeunload', this._onBeforeUnload);
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._onBeforeUnload);
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
    isAnythingDirty() {
        return this.isProfileDirty() || this._prefsDirty;
    }

    confirmLeave() {
        if (!this.isAnythingDirty()) return true;
        return window.confirm(t('settings.unsavedWarning'));
    }

    handleBeforeUnload(event) {
        if (!this.isAnythingDirty()) return;
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
    }

    async persist(patch) {
        try {
            const next = await saveUserPreferences(patch);
            this.theme = next.theme;
            this.useFullSlicer = next.useFullSlicer;
            this.homeLayout = next.homeLayout;
            this.useSimplifiedViewer = next.useSimplifiedViewer;
            this.slicerWebChannel = next.slicerWebChannel ?? 'stable';
            this.notifyRegistrationApproval = next.notifyRegistrationApproval !== false;
            this._prefsDirty = false;
        } catch (error) {
            this.saveState = 'error';
            this.saveStatusMessage = t('settings.saveFailed');
            this.errorMessage = error.message || t('settings.unableToSave');
            throw error;
        }
    }

    async handleSaveAll() {
        if (this.profileSaving) return;
        this.saveState = 'saving';
        this.saveStatusMessage = t('common.saving');
        this.errorMessage = '';
        try {
            const saves = [];
            if (this.isProfileDirty()) saves.push(this.handleProfileSave());
            if (this._prefsDirty) saves.push(this.persist({
                theme: this.theme,
                useFullSlicer: this.useFullSlicer,
                useSimplifiedViewer: this.useSimplifiedViewer,
                homeLayout: this.homeLayout,
                slicerWebChannel: this.slicerWebChannel,
                notifyRegistrationApproval: this.notifyRegistrationApproval
            }));
            await Promise.all(saves);
            if (this.saveState !== 'error') {
                this.saveState = 'saved';
                this.saveStatusMessage = t('settings.saved');
                if (this._savedClearTimer) clearTimeout(this._savedClearTimer);
                this._savedClearTimer = setTimeout(() => {
                    if (this.saveState === 'saved') {
                        this.saveState = 'idle';
                        this.saveStatusMessage = '';
                    }
                    this._savedClearTimer = null;
                }, 2000);
            }
        } catch {
            // errors already set on saveState by persist/handleProfileSave
        }
    }

    handleThemeChange(event) {
        this.theme = event?.detail?.theme === 'dark' ? 'dark' : 'light';
        this._prefsDirty = true;
    }

    handleHomeLayoutChange(event) {
        this.homeLayout = event?.detail?.layout;
        this._prefsDirty = true;
    }

    handleViewerOptionsChange(event) {
        const next = event?.detail || {};
        this.useFullSlicer = next.useFullSlicer === true;
        this.useSimplifiedViewer = next.useSimplifiedViewer === true;
        this._prefsDirty = true;
    }

    handleSlicerWebChannelChange(wantsLatest) {
        this.slicerWebChannel = wantsLatest ? 'latest' : 'stable';
        this._prefsDirty = true;
    }

    async handleProfileSave(e) {
        e?.preventDefault?.();
        if (!this.profileLinked || this.profileSaving) return;

        const firstName = String(this.firstName || '').trim();
        const lastName = String(this.lastName || '').trim();
        if (!firstName || !lastName) {
            this.saveState = 'error';
            this.saveStatusMessage = t('auth.changePassword.nameRequired');
            return;
        }

        this.profileSaving = true;
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
            this.dispatchEvent(new CustomEvent('profile-updated', {
                detail: { user: data.user },
                bubbles: true,
                composed: true
            }));
        } catch (err) {
            this.saveState = 'error';
            this.saveStatusMessage = err.message || t('settings.profileFailed');
            throw err;
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
        const tab = this._activeTab;

        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin || false}
                .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                selectedMenuKey=""
                homeHref="/file-manager"
                homeLabel=${t('common.home')}
                pageTitle=${t('settings.title')}
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

                    <!-- Tab bar -->
                    <div class="tabs-bar" role="tablist" aria-label=${t('settings.title')}>
                        <button role="tab" class="tab-btn"
                            aria-selected=${tab === 'account' ? 'true' : 'false'}
                            @click=${() => { this._activeTab = 'account'; }}>
                            ${t('settings.tabAccount')}
                        </button>
                        <button role="tab" class="tab-btn"
                            aria-selected=${tab === 'appearance' ? 'true' : 'false'}
                            @click=${() => { this._activeTab = 'appearance'; }}>
                            ${t('settings.tabAppearance')}
                        </button>
                        <button role="tab" class="tab-btn"
                            aria-selected=${tab === 'viewer' ? 'true' : 'false'}
                            @click=${() => { this._activeTab = 'viewer'; }}>
                            ${t('settings.tabViewer')}
                        </button>
                    </div>

                    <!-- Account tab -->
                    ${tab === 'account' ? html`
                        ${this.profileLoading ? html`
                            <p class="section-description" style="padding:8px 0">${t('common.loading')}</p>
                        ` : showProfile ? html`
                            <section class="settings-section">
                                <div class="section-title-row">
                                    <h2 class="section-title">${t('settings.profile')}</h2>
                                    <button type="button" class="section-hint" aria-label=${t('settings.profileHint')}>
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
                                                    <button type="button" class="small-button"
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
                                            <input id="settings-firstName" type="text" autocomplete="given-name"
                                                .value=${this.firstName}
                                                ?disabled=${this.profileSaving}
                                                @input=${(e) => this.onProfileFieldInput('firstName', e.target.value)} />
                                        </div>
                                        <div class="form-group">
                                            <label for="settings-lastName">${t('settings.lastName')}</label>
                                            <input id="settings-lastName" type="text" autocomplete="family-name"
                                                .value=${this.lastName}
                                                ?disabled=${this.profileSaving}
                                                @input=${(e) => this.onProfileFieldInput('lastName', e.target.value)} />
                                        </div>
                                    </div>
                                </div>
                            </section>

                            <section class="settings-section">
                                <h2 class="section-title">${t('settings.security')}</h2>
                                <p class="section-description">${t('settings.securityHint')}</p>
                                <button type="button" class="btn-save-profile"
                                    @click=${() => this.renderRoot?.querySelector('change-password-dialog')?.open()}>
                                    ${t('auth.changePassword.settingsTitle')}
                                </button>
                                <change-password-dialog
                                    .firstName=${this.firstName}
                                    .lastName=${this.lastName}
                                ></change-password-dialog>
                            </section>

                            <section class="settings-section">
                                <h2 class="section-title">${t('settings.notifications')}</h2>
                                <p class="section-description">${t('settings.notificationsHint')}</p>
                                <label class="checkbox-row">
                                    <input type="checkbox"
                                        .checked=${this.notifyRegistrationApproval}
                                        @change=${(e) => { this.notifyRegistrationApproval = e.target.checked; this._prefsDirty = true; }} />
                                    <span>
                                        ${t('settings.notifyRegistrationApproval')}
                                        <span class="section-description" style="display:block;margin-top:2px">
                                            ${t('settings.notifyRegistrationApprovalHint')}
                                        </span>
                                    </span>
                                </label>
                            </section>
                        ` : ''}
                    ` : ''}

                    <!-- Appearance tab -->
                    ${tab === 'appearance' ? html`
                        <section class="settings-section">
                            <h2 class="section-title">${t('settings.appearance')}</h2>
                            <p class="section-description">${t('settings.appearanceHint')}</p>
                            <theme-toggle
                                .theme=${this.theme}
                                @theme-change=${(e) => this.handleThemeChange(e)}
                            ></theme-toggle>
                        </section>

                        <section class="settings-section">
                            <h2 class="section-title">${t('homeLayout.title')}</h2>
                            <p class="section-description">${t('homeLayout.description')}</p>
                            <home-layout-settings
                                .layout=${this.homeLayout}
                                @layout-change=${(e) => this.handleHomeLayoutChange(e)}
                            ></home-layout-settings>
                        </section>
                    ` : ''}

                    <!-- Viewer tab -->
                    ${tab === 'viewer' ? html`
                        <section class="settings-section">
                            <h2 class="section-title">${t('settings.localViewer')}</h2>
                            <p class="section-description">${t('settings.localViewerHintFull')}</p>
                            <local-slicer-viewer-options
                                .useFullSlicer=${this.useFullSlicer}
                                .useSimplifiedViewer=${this.useSimplifiedViewer}
                                .canEdit=${true}
                                .showComposeHint=${true}
                                @options-change=${(e) => this.handleViewerOptionsChange(e)}
                            ></local-slicer-viewer-options>
                        </section>

                        ${isSlicerWebDevModeEnabled() ? html`
                            <section class="settings-section">
                                <h2 class="section-title">${t('settings.slicerWebChannel')}</h2>
                                <p class="section-description">${t('settings.slicerWebChannelHint')}</p>
                                <label class="checkbox-row">
                                    <input type="checkbox"
                                        .checked=${this.slicerWebChannel === 'latest'}
                                        @change=${(e) => this.handleSlicerWebChannelChange(e.target.checked)} />
                                    ${t('settings.slicerWebLatestLabel')}
                                </label>
                                ${this.slicerWebChannel === 'latest' ? html`
                                    <p class="section-description" style="color:var(--color-warning,#b45309)">
                                        ${t('settings.slicerWebLatestWarning')}
                                    </p>
                                ` : ''}
                            </section>
                        ` : ''}
                    ` : ''}

                    <!-- Unified save bar -->
                    <div class="settings-save-bar">
                        <span class="save-status" data-state=${this.saveState} aria-live="polite">
                            ${this.saveStatusMessage}
                        </span>
                        <button type="button" class="btn-save-profile"
                            ?disabled=${!this.isAnythingDirty() || this.profileSaving}
                            @click=${() => this.handleSaveAll()}>
                            ${this.profileSaving ? t('settings.savingProfile') : t('settings.saveChanges')}
                        </button>
                    </div>

                </div>
            </page-layout-template>
        `;
    }
}

customElements.define('user-settings-page', UserSettingsPage);
