import { LitElement, html } from 'lit-element';
import { userSettingsStyles } from './user-settings-page.styles.js';
import { API_URL } from '../config.js';
import { t } from '../i18n/index.js';
import '../components/page-layout-template.js';
import '../components/theme-toggle.js';
import '../components/change-password-dialog.js';
import '../components/local-slicer-viewer-options.js';
import '../components/home-layout-settings.js';
import '../components/page-content-message.js';
import {
    getCachedUserPreferences,
    saveUserPreferences
} from '../utils/userPreferences.js';
import { isSlicerWebDevModeEnabled } from '../services/features.js';

export class UserSettingsPage extends LitElement {
    static get styles() {
        return userSettingsStyles;
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
