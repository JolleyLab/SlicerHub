import { LitElement, html } from 'lit-element';
import { appShellStyles } from './app-shell.styles.js';
import { buttonStyles } from './styles/buttons.js';
import { API_URL } from './config.js';
import { t } from './i18n/index.js';
import {
  APP_VIEWS,
  DEFAULT_APP_VIEW,
  MY_FILES_VISIBLE,
  MY_PROJECTS_VISIBLE,
  PROJECT_VIEWS,
  readAppViewFromUrl,
  writeAppViewToUrl
} from './components/app-views.js';
import { loadAppFeatures, areAppFeaturesLoaded } from './services/features.js';
import {
  setDirectusLinkGate,
  clearDirectusLinkGate,
  canAccessAccountSettings
} from './utils/directusLinkGate.js';
import './auth/login-form.js';
import './auth/registration-request-form.js';
import './auth/complete-registration-form.js';
import './auth/invite-accept-form.js';
import './kc-invite-accept-form.js';
import './auth/change-password-form.js';
import './pages/admin-registrations-page.js';
import './pages/admin-task-groups-page.js';
import './pages/file-manager.js';
import './components/status-card.js';
import './MyProjects/myProjectsEmptyState.js';
import './MyProjects/projectReviewPage.js';
import './pages/user-settings-page.js';
import './pages/cases-page.js';
import './pages/home-page.js';
import { buildSlicerGuiLoaderUrl, VIEWER_KINDS } from './utils/viewerLaunch.js';
import {
  installViewerActivityListeners
} from './utils/viewerActivity.js';
import {
  hydrateUserPreferencesFromUser,
  clearCachedUserPreferences
} from './utils/userPreferences.js';
import { watchSystemColorScheme } from './components/theme.js';
import './components/app-dialog.js';
import './components/upload-tray.js';
import { uploadManager } from './services/uploadManager.js';
import {
  listOwnedGpuBillingSessions,
  stopProjectGpuBilling,
  transferProjectGpuBilling
} from './services/projectGpu.js';

function userDisplayName(user) {
  if (!user) return t('common.guest');
  const first = String(user.firstName || user.first_name || '').trim();
  const last = String(user.lastName || user.last_name || '').trim();
  const full = `${first} ${last}`.trim();
  if (full) return full;
  const display = String(user.displayName || '').trim();
  if (display && !display.includes('@')) return display;
  if (user.email) return String(user.email).trim();
  if (display) return display;
  if (user.username) return String(user.username).trim();
  return t('common.guest');
}

export class SlicerApp extends LitElement {
  static get styles() {
    return [buttonStyles, appShellStyles];
  }

  static get properties() {
    return {
      // Auth properties
      isAuthenticated: { type: Boolean },
      user: { type: Object },
      showLogin: { type: Boolean },
      currentView: { type: String },
      selectedProjectId: { type: Number },
      shareToken:    { type: String },
      inviteToken:   { type: String },
      kcInviteToken: { type: String },
      registerToken: { type: String },
      isOrgAdmin: { type: Boolean },
      isRegistrationReviewer: { type: Boolean },
      directusUserId:         { type: String },
      keycloakSub:            { type: String },
      shareLoading: { type: Boolean },
      shareError: { type: String },
      shareErrorStatus: { type: Number },
      shareIframeUrl: { type: String },
      shareFileName: { type: String },
      shareViewerKind: { type: String },
      shareReplayStatus: { type: String },
      logoutBillingBusy: { type: Boolean },
      logoutBillingMode: { type: String },
      logoutTransferSession: { type: Object },
      logoutSoleSessions: { type: Array },
      logoutBillingAutoSeconds: { type: Number },
      _directusReconnectBusy: { type: Boolean },
      _directusReconnectError: { type: String },
      _directusReconnectOpen: { type: Boolean },
      _canGoBack: { type: Boolean }
    };
  }

  constructor() {
    super();

    // Auth state
    this.isAuthenticated = false;
    this.isOrgAdmin = false;
    this.isRegistrationReviewer = false;
    this.directusUserId = null;
    this.keycloakSub = null;
    this.user = null;
    this.showLogin = true; // Show login by default
    this.currentView = DEFAULT_APP_VIEW;
    this.selectedProjectId = null;
    this.inactivityTimeout = null;
    this.shareToken    = new URLSearchParams(window.location.search).get('share')     || '';
    this.inviteToken   = new URLSearchParams(window.location.search).get('invite')   || '';
    this.kcInviteToken = new URLSearchParams(window.location.search).get('kc-invite') || '';
    this.registerToken = new URLSearchParams(window.location.search).get('register') || '';
    this.shareLoading = false;
    this.shareError = '';
    this.shareErrorStatus = 0;
    this.shareIframeUrl = '';
    this.shareFileName = '';
    this.shareViewerKind = '';
    this.shareReplayStatus = '';
    this.shareReplayPollTimer = null;
    this.shareReplayAttempts = 0;
    this.shareReplayInFlight = false;
    this.logoutBillingBusy = false;
    this.logoutBillingMode = '';
    this.logoutTransferSession = null;
    this.logoutSoleSessions = [];
    this.logoutBillingAutoSeconds = 0;
    this._directusReconnectBusy = false;
    this._directusReconnectError = '';
    this._directusReconnectOpen = false;
    this._canGoBack = false;
    this._navHistory = [];
    this._navigatingBack = false;
    this._logoutQueueWithOthers = [];
    this._logoutQueueSole = [];
    this._logoutBillingAutoTimer = null;
    this._logoutBillingAutoInterval = null;
    this._trameHeartbeatInterval = null;
    this._directusKeepaliveTimer = null;
    this._onPopState = () => this.handlePopState();

    if (!this.shareToken && !this.inviteToken && !this.kcInviteToken) {
      this.initializeAppView();
      this.checkExistingSession();
    }

    window.addEventListener('popstate', this._onPopState);
    this._onDirectusSessionExpired = () => {
      if (!this._directusReconnectOpen && this.isAuthenticated && this.directusUserId) {
        this._directusReconnectOpen = true;
        this._directusReconnectError = '';
        this.requestUpdate();
        this.updateComplete.then(() => {
          this.renderRoot?.querySelector('#directus-reconnect-dialog')?.openDialog?.();
        });
      }
    };
    window.addEventListener('directus-session-expired', this._onDirectusSessionExpired);
  }

  updated(changedProps) {
    if (changedProps.has('currentView')) {
      if (this._navigatingBack) {
        this._navigatingBack = false;
      } else {
        const prev = changedProps.get('currentView');
        if (prev) {
          this._navHistory = [...this._navHistory.slice(-9), { view: prev }];
          this._canGoBack = true;
        }
      }
    }
  }

  _handleNavigateBack() {
    if (!this._navHistory.length) return;
    const history = [...this._navHistory];
    const prev = history.pop();
    this._navHistory = history;
    this._canGoBack = history.length > 0;
    this._navigatingBack = true;
    this.currentView = prev.view;
    this.syncViewToUrl();
  }

  async initializeAppView() {
    await loadAppFeatures();
    this.restoreViewFromUrl({ writeBack: false });
    this.guardProjectViews();
    this.guardSettingsView();
  }

  applyIdentityGate(identity) {
    if (!identity || typeof identity !== 'object') return;
    setDirectusLinkGate({
      required: identity.directusLinkRequired === true,
      linked: identity.directusLinked === true
    });
    this.guardSettingsView();
  }


  /**
   * My Projects is hidden (MY_PROJECTS_VISIBLE): send deep links (?view=projects, project review,
   * create-project) to Cases, or to the default view until features have loaded.
   * When visible again, new projects stay Cases-only, so create-project still redirects.
   */
  guardProjectViews() {
    if (!PROJECT_VIEWS.has(this.currentView)) return;
    if (!MY_PROJECTS_VISIBLE) {
      this.currentView = areAppFeaturesLoaded() ? APP_VIEWS.CASES : DEFAULT_APP_VIEW;
      this.selectedProjectId = null;
      this.syncViewToUrl();
      return;
    }
    if (this.currentView !== APP_VIEWS.CREATE_PROJECT) return;
    this.currentView = APP_VIEWS.PROJECTS;
    this.selectedProjectId = null;
    this.syncViewToUrl();
  }

  guardSettingsView() {
    if (this.currentView !== APP_VIEWS.SETTINGS) return;
    if (canAccessAccountSettings()) return;
    this.currentView = DEFAULT_APP_VIEW;
    this.selectedProjectId = null;
    this.syncViewToUrl();
  }

  _settingsPage() {
    return this.renderRoot?.querySelector('user-settings-page')
      || this.shadowRoot?.querySelector('user-settings-page')
      || null;
  }

  _projectReviewPage() {
    return this.renderRoot?.querySelector('project-review-page')
      || this.shadowRoot?.querySelector('project-review-page')
      || null;
  }

  /** @returns {boolean} true if leave is allowed */
  confirmLeaveSettings() {
    const page = this._settingsPage();
    if (page && typeof page.confirmLeave === 'function') {
      return page.confirmLeave();
    }
    return true;
  }

  /** CUTOVER (project-case-migrate): block nav while migrate is running. */
  confirmLeaveProjectMigrate() {
    if (this.currentView !== APP_VIEWS.PROJECT_REVIEW) return true;
    const page = this._projectReviewPage();
    if (page && typeof page.confirmLeave === 'function') {
      return page.confirmLeave();
    }
    return true;
  }

  /** @returns {boolean} true if leave is allowed */
  confirmLeaveCurrentView() {
    if (this.currentView === APP_VIEWS.SETTINGS && !this.confirmLeaveSettings()) {
      return false;
    }
    if (!this.confirmLeaveProjectMigrate()) {
      return false;
    }
    return true;
  }

  handlePopState() {
    if (!this.confirmLeaveCurrentView()) {
      // Browser already moved the URL — put the guarded view back.
      this.syncViewToUrl({ replace: true });
      return;
    }
    this.restoreViewFromUrl({ writeBack: false });
  }

  restoreViewFromUrl({ writeBack = true } = {}) {
    if (this.shareToken) return;
    const { currentView, selectedProjectId } = readAppViewFromUrl();
    if (currentView === APP_VIEWS.PROJECT_REVIEW && selectedProjectId) {
      this.currentView = APP_VIEWS.PROJECT_REVIEW;
      this.selectedProjectId = selectedProjectId;
    } else if (currentView && currentView !== APP_VIEWS.PROJECT_REVIEW) {
      this.currentView = currentView;
      this.selectedProjectId = null;
    } else {
      this.currentView = DEFAULT_APP_VIEW;
      this.selectedProjectId = null;
    }
    this.guardProjectViews();
    this.guardSettingsView();
    if (writeBack) {
      this.syncViewToUrl();
    }
  }

  syncViewToUrl({ replace = true, clearCaseDeepLink = false } = {}) {
    if (this.shareToken) return;
    writeAppViewToUrl({
      currentView: this.currentView,
      selectedProjectId: this.selectedProjectId,
      replace,
      clearCaseDeepLink
    });
  }


  async checkExistingSession() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include' // Send cookies
      });

      if (res.ok) {
        const data = await res.json();
        this.user = data.user;
        this.isAuthenticated = true;
        this.isOrgAdmin = data.isOrgAdmin === true;
        this.isRegistrationReviewer = data.isRegistrationReviewer === true;
        this.directusUserId = data.directusUserId || null;
        this.keycloakSub = data.keycloakSub || null;
        this.applyIdentityGate(data.identity);
        await hydrateUserPreferencesFromUser(this.user);
        this.startInactivityTimer();
        this._startDirectusKeepalive();
        return;
      }

      if (res.status === 401 || res.status === 403) {
        await this.clearStaleSession();
      }
    } catch (err) {
      // No valid session - stay logged out
      console.log('No existing session');
    }
  }

  /**
   * The login response carries the local account only; /api/auth/me adds the Directus profile
   * (first and last name). Without this, the header shows the email until the next page load.
   */
  async refreshUserProfile() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, { credentials: 'include' });
      if (!res.ok) return;
      const data = await res.json();
      if (data.user) this.user = { ...(this.user || {}), ...data.user };
      if (typeof data.isOrgAdmin === 'boolean') this.isOrgAdmin = data.isOrgAdmin;
      if (typeof data.isRegistrationReviewer === 'boolean') this.isRegistrationReviewer = data.isRegistrationReviewer;
      if (data.directusUserId) this.directusUserId = data.directusUserId;
      if (data.keycloakSub) this.keycloakSub = data.keycloakSub;
    } catch (_) {
      // keep the login payload; the profile fills in on the next load
    }
  }

  async clearStaleSession() {
    try {
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (_) {
      // best effort — logout clears invalid cookies server-side
    }
    this.user = null;
    this.isAuthenticated = false;
    this.showLogin = true;
    clearDirectusLinkGate();
    this.stopInactivityTimer();
    this._stopDirectusKeepalive();
    this._syncAuthThemeWatch();
  }

  handleLoginSuccess(e) {
    const { user, identity } = e.detail || {};
    this.user = user;
    this.isAuthenticated = true;
    this.applyIdentityGate(identity);
    // Signing in always starts on Home, whatever view was open before.
    this.selectedProjectId = null;
    this.currentView = APP_VIEWS.HOME;
    this.syncViewToUrl();
    this._stopAuthThemeWatch();
    hydrateUserPreferencesFromUser(user);
    this.startInactivityTimer();
    this._startDirectusKeepalive();
    this.refreshUserProfile();
  }

  handleRegisterSuccess(e) {
    const { user } = e.detail;
    this.user = user;
    this.isAuthenticated = true;
    this._stopAuthThemeWatch();
    hydrateUserPreferencesFromUser(user);
    this.startInactivityTimer();
    this._startDirectusKeepalive();
  }

  handleRegistrationComplete(e) {
    const { user } = e.detail || {};
    this.registerToken = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('register');
    history.replaceState(null, '', `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}`);
    if (user) {
      this.user = user;
      this.isAuthenticated = true;
      this._stopAuthThemeWatch();
      hydrateUserPreferencesFromUser(user);
      this.startInactivityTimer();
      this._startDirectusKeepalive();
      this.checkExistingSession();
    }
  }

  handleKcInviteAccepted(e) {
    const { caseId } = e.detail || {};
    this.kcInviteToken = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('kc-invite');
    if (caseId) {
      url.searchParams.set('view', 'cases');
      url.searchParams.set('case', String(caseId));
    }
    history.replaceState(null, '', `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}`);
    // Account is now active — go to login so the user can sign in
    this.initializeAppView();
  }

  handleInviteAccepted(e) {
    const { user, caseId } = e.detail || {};
    this.inviteToken = '';
    const url = new URL(window.location.href);
    url.searchParams.delete('invite');
    if (caseId) {
      url.searchParams.set('view', 'cases');
      url.searchParams.set('case', String(caseId));
    }
    history.replaceState(null, '', `${url.pathname}${url.searchParams.toString() ? `?${url.searchParams}` : ''}`);
    if (user) {
      this.user = user;
      this.isAuthenticated = true;
      this._stopAuthThemeWatch();
      hydrateUserPreferencesFromUser(user);
      this.startInactivityTimer();
      this._startDirectusKeepalive();
      // Invite redeem creates/links Directus — refresh gate from /me.
      this.checkExistingSession();
    }
    this.initializeAppView();
  }

  handleNotificationOpen(e) {
    const type = String(e.detail?.type || '');
    if (type === 'pending_registration') {
      if (!this.confirmLeaveCurrentView()) return;
      this.currentView = APP_VIEWS.ADMIN_REGISTRATIONS;
      this.syncViewToUrl();
      return;
    }
    const caseId = e.detail?.caseId;
    if (!caseId) return;
    if (!this.confirmLeaveCurrentView()) return;
    const inviteId = e.detail?.inviteId || null;
    const openPeople = Boolean(inviteId)
      || type === 'case_invite_pending'
      || type === 'case_invite_accepted';
    this.selectedProjectId = null;
    this.currentView = APP_VIEWS.CASES;
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'cases');
    url.searchParams.set('case', String(caseId));
    history.pushState({ caseId: String(caseId) }, '', `${url.pathname}?${url.searchParams}`);
    this.updateComplete.then(() => {
      const page = this.renderRoot?.querySelector('cases-page');
      if (!page) return;
      if (typeof page.openCase === 'function') {
        page.openCase(String(caseId));
      }
      if (openPeople && typeof page.openPeopleForCaseId === 'function') {
        page.openPeopleForCaseId(String(caseId));
      }
    });
  }

  handlePasswordChanged(e) {
    const { user } = e.detail || {};
    if (user) {
      this.user = { ...(this.user || {}), ...user, mustChangePassword: false };
    } else if (this.user) {
      this.user = { ...this.user, mustChangePassword: false };
    }
  }

  handleProfileUpdated(e) {
    const { user } = e.detail || {};
    if (!user) return;
    this.user = { ...(this.user || {}), ...user };
  }

  handleShowRegister() {
    this.showLogin = false;
  }

  handleShowLogin() {
    this.showLogin = true;
  }

  openSettingsFlow() {
    if (!canAccessAccountSettings()) return;
    if (!this.confirmLeaveProjectMigrate()) return;
    this.selectedProjectId = null;
    this.currentView = APP_VIEWS.SETTINGS;
    this.syncViewToUrl();
  }

  openProjectReviewFlow(e) {
    if (!MY_PROJECTS_VISIBLE) return;
    const projectId = Number(e.detail?.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) return;
    this.selectedProjectId = projectId;
    this.currentView = APP_VIEWS.PROJECT_REVIEW;
    this.syncViewToUrl({ replace: false });
  }

  handleProjectsMenuSelection(e) {
    if (!this.confirmLeaveCurrentView()) return;
    const selectedKey = e.detail?.selectedKey;
    if (selectedKey === 'home') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.HOME;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'my-files') {
      if (!MY_FILES_VISIBLE) return;
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.FILES;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'my-projects') {
      if (!MY_PROJECTS_VISIBLE) return;
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.PROJECTS;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'admin-registrations') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.ADMIN_REGISTRATIONS;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'my-groups') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.MY_GROUPS;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'cases') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.CASES;
      const caseId = e.detail?.caseId ? String(e.detail.caseId).trim() : '';
      if (caseId) {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'cases');
        url.searchParams.set('case', caseId);
        history.pushState({ caseId }, '', `${url.pathname}?${url.searchParams}`);
        this.updateComplete.then(() => {
          const page = this.renderRoot?.querySelector('cases-page');
          if (page && typeof page.openCase === 'function') {
            page.openCase(caseId);
          }
        });
        return;
      }
      // Menu → Cases always means the list, not a stale ?case= deep link
      this.syncViewToUrl({ clearCaseDeepLink: true });
    }
  }

  startInactivityTimer() {
    // Clear any existing timer
    this.stopInactivityTimer();

    const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    // Reset timer on any user activity
    const resetTimer = () => {
      this.stopInactivityTimer();
      this.inactivityTimeout = setTimeout(() => {
        console.log('User inactive for 30 minutes, logging out...');
        // Skip billing dialog — user is already gone; idle auto-stop still applies.
        this.performLogout();
      }, INACTIVITY_TIMEOUT);
    };

    // Track various user activities
    this.activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    this.resetTimer = resetTimer;

    this.activityEvents.forEach(event => {
      document.addEventListener(event, resetTimer, true);
    });

    // Start initial timer
    resetTimer();
  }

  stopInactivityTimer() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    // Remove event listeners
    if (this.resetTimer && this.activityEvents) {
      this.activityEvents.forEach(event => {
        document.removeEventListener(event, this.resetTimer, true);
      });
    }
  }

  // Fires every 10 minutes while signed in to silently rotate Directus tokens before
  // they expire. Always swallows errors — the reconnect modal handles genuine failures.
  _startDirectusKeepalive() {
    this._stopDirectusKeepalive();
    const INTERVAL_MS = 10 * 60 * 1000;
    this._directusKeepaliveTimer = setInterval(() => {
      fetch(`${API_URL}/api/auth/directus/keepalive`, {
        method: 'POST',
        credentials: 'include'
      }).catch(() => { /* silent */ });
    }, INTERVAL_MS);
  }

  _stopDirectusKeepalive() {
    if (this._directusKeepaliveTimer) {
      clearInterval(this._directusKeepaliveTimer);
      this._directusKeepaliveTimer = null;
    }
  }

  /**
   * Explicit logout (menu button). If the user owns remote GPU billing, remind them
   * to transfer or stop before signing out.
   */
  async handleLogout() {
    if (this.logoutBillingBusy || this.logoutBillingMode) return;
    if (!this.confirmLeaveCurrentView()) return;
    if (uploadManager.hasActive() && !confirm(t('uploads.confirmLogout'))) return;

    try {
      const data = await listOwnedGpuBillingSessions();
      const sessions = Array.isArray(data?.sessions) ? data.sessions : [];
      if (!sessions.length) {
        await this.performLogout();
        return;
      }

      this._logoutQueueWithOthers = sessions.filter((s) => s.othersActive);
      this._logoutQueueSole = sessions.filter((s) => !s.othersActive);
      this.advanceLogoutBillingFlow();
    } catch (err) {
      console.warn('Owned billing check on logout failed:', err?.message || err);
      await this.performLogout();
    }
  }

  advanceLogoutBillingFlow() {
    if (this._logoutQueueWithOthers.length > 0) {
      this.logoutTransferSession = this._logoutQueueWithOthers[0];
      this.logoutSoleSessions = [];
      this.logoutBillingMode = 'transfer';
      this.openLogoutBillingDialog();
      return;
    }
    if (this._logoutQueueSole.length > 0) {
      this.logoutTransferSession = null;
      this.logoutSoleSessions = [...this._logoutQueueSole];
      this.logoutBillingMode = 'sole';
      this.openLogoutBillingDialog();
      return;
    }
    this.clearLogoutBillingState();
    this.performLogout();
  }

  openLogoutBillingDialog() {
    this.startLogoutBillingAutoTimer();
    requestAnimationFrame(() => {
      this.renderRoot?.querySelector('#logout-billing-dialog')?.openDialog?.();
    });
  }

  closeLogoutBillingDialog() {
    this.clearLogoutBillingAutoTimer();
    this.renderRoot?.querySelector('#logout-billing-dialog')?.closeDialog?.();
  }

  async _submitDirectusReconnect(e) {
    e.preventDefault();
    if (this._directusReconnectBusy) return;
    const password = e.target.elements.password?.value || '';
    if (!password) return;
    this._directusReconnectBusy = true;
    this._directusReconnectError = '';
    try {
      const res = await fetch(`${API_URL}/api/auth/directus/reconnect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ password })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        this._directusReconnectError = data.error?.message || data.message || t('common.requestFailed');
        return;
      }
      this._directusReconnectOpen = false;
      this.renderRoot?.querySelector('#directus-reconnect-dialog')?.closeDialog?.();
      window.dispatchEvent(new CustomEvent('directus-session-restored'));
    } catch {
      this._directusReconnectError = t('errors.serverUnreachable');
    } finally {
      this._directusReconnectBusy = false;
    }
  }

  clearLogoutBillingState() {
    this.clearLogoutBillingAutoTimer();
    this.logoutBillingBusy = false;
    this.logoutBillingMode = '';
    this.logoutTransferSession = null;
    this.logoutSoleSessions = [];
    this.logoutBillingAutoSeconds = 0;
    this._logoutQueueWithOthers = [];
    this._logoutQueueSole = [];
  }

  /** 2 minutes — if the user walks away after clicking log out, auto transfer or stop. */
  static get LOGOUT_BILLING_AUTO_MS() {
    return 2 * 60 * 1000;
  }

  clearLogoutBillingAutoTimer() {
    if (this._logoutBillingAutoTimer) {
      clearTimeout(this._logoutBillingAutoTimer);
      this._logoutBillingAutoTimer = null;
    }
    if (this._logoutBillingAutoInterval) {
      clearInterval(this._logoutBillingAutoInterval);
      this._logoutBillingAutoInterval = null;
    }
    this.logoutBillingAutoSeconds = 0;
  }

  startLogoutBillingAutoTimer() {
    this.clearLogoutBillingAutoTimer();
    const totalMs = this.constructor.LOGOUT_BILLING_AUTO_MS;
    const deadline = Date.now() + totalMs;
    this.logoutBillingAutoSeconds = Math.ceil(totalMs / 1000);

    this._logoutBillingAutoInterval = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      this.logoutBillingAutoSeconds = left;
      if (left <= 0) {
        clearInterval(this._logoutBillingAutoInterval);
        this._logoutBillingAutoInterval = null;
      }
    }, 1000);

    this._logoutBillingAutoTimer = setTimeout(() => {
      this._logoutBillingAutoTimer = null;
      this.handleLogoutBillingAutoDefault();
    }, totalMs);
  }

  get logoutBillingAutoHint() {
    const secs = this.logoutBillingAutoSeconds;
    if (!secs || this.logoutBillingBusy) return '';
    const action = this.logoutBillingMode === 'transfer'
      ? (this.logoutTransferSession?.transferTarget ? 'transfer ownership' : 'stop billing')
      : t('gpu.stopBillingAndLogOutAction');
    const time = secs >= 60
      ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`
      : `${secs}s`;
    return `If you walk away, we’ll ${action} automatically in ${time}.`;
  }

  async handleLogoutBillingAutoDefault() {
    if (this.logoutBillingBusy || !this.logoutBillingMode) return;
    this.clearLogoutBillingAutoTimer();
    if (this.logoutBillingMode === 'transfer') {
      if (this.logoutTransferSession?.transferTarget) {
        await this.handleLogoutTransfer();
      } else {
        await this.handleLogoutStopAnyway();
      }
      return;
    }
    if (this.logoutBillingMode === 'sole') {
      await this.handleLogoutStopAllSole();
    }
  }

  cancelLogoutBilling() {
    this.closeLogoutBillingDialog();
    this.clearLogoutBillingState();
  }

  get logoutTransferImpactNames() {
    const users = this.logoutTransferSession?.activeUsers || [];
    return users.map((u) => u.username || t('gpu.userId', { id: u.userId })).join(', ');
  }

  get logoutTransferLabel() {
    const target = this.logoutTransferSession?.transferTarget;
    if (!target) return t('gpu.transferOwnership');
    return t('gpu.transferTo', { user: target.username || t('gpu.userId', { id: target.userId }) });
  }

  async handleLogoutTransfer() {
    const session = this.logoutTransferSession;
    if (!session?.projectId || this.logoutBillingBusy) return;
    this.clearLogoutBillingAutoTimer();
    this.logoutBillingBusy = true;
    try {
      await transferProjectGpuBilling(session.projectId);
      this._logoutQueueWithOthers = this._logoutQueueWithOthers.filter(
        (s) => s.projectId !== session.projectId
      );
      this.closeLogoutBillingDialog();
      this.logoutBillingBusy = false;
      this.advanceLogoutBillingFlow();
    } catch (err) {
      console.error('Logout transfer failed:', err);
      this.logoutBillingBusy = false;
      this.startLogoutBillingAutoTimer();
      window.alert(err.message || t('gpu.unableTransfer'));
    }
  }

  async handleLogoutStopAnyway() {
    const session = this.logoutTransferSession;
    if (!session?.projectId || this.logoutBillingBusy) return;
    this.clearLogoutBillingAutoTimer();
    this.logoutBillingBusy = true;
    try {
      await stopProjectGpuBilling(session.projectId, { acknowledgeImpact: true });
      this._logoutQueueWithOthers = this._logoutQueueWithOthers.filter(
        (s) => s.projectId !== session.projectId
      );
      this.closeLogoutBillingDialog();
      this.logoutBillingBusy = false;
      this.advanceLogoutBillingFlow();
    } catch (err) {
      console.error('Logout stop billing failed:', err);
      this.logoutBillingBusy = false;
      this.startLogoutBillingAutoTimer();
      window.alert(err.message || t('gpu.unableStop'));
    }
  }

  async handleLogoutStopProject(projectId) {
    if (!projectId || this.logoutBillingBusy) return;
    this.clearLogoutBillingAutoTimer();
    this.logoutBillingBusy = true;
    try {
      await stopProjectGpuBilling(projectId, { acknowledgeImpact: true });
      this._logoutQueueSole = this._logoutQueueSole.filter((s) => s.projectId !== projectId);
      this.logoutSoleSessions = [...this._logoutQueueSole];
      if (!this.logoutSoleSessions.length) {
        this.closeLogoutBillingDialog();
        this.logoutBillingBusy = false;
        this.advanceLogoutBillingFlow();
        return;
      }
      this.startLogoutBillingAutoTimer();
    } catch (err) {
      console.error('Logout stop project failed:', err);
      this.startLogoutBillingAutoTimer();
      window.alert(err.message || t('gpu.unableStop'));
    } finally {
      this.logoutBillingBusy = false;
    }
  }

  async handleLogoutStopAllSole() {
    if (this.logoutBillingBusy || !this.logoutSoleSessions.length) return;
    this.clearLogoutBillingAutoTimer();
    this.logoutBillingBusy = true;
    const remaining = [];
    for (const session of this._logoutQueueSole) {
      try {
        await stopProjectGpuBilling(session.projectId, { acknowledgeImpact: true });
      } catch (err) {
        console.error('Logout stop-all failed for project', session.projectId, err);
        remaining.push(session);
      }
    }
    this._logoutQueueSole = remaining;
    this.logoutSoleSessions = [...remaining];
    this.logoutBillingBusy = false;
    if (remaining.length) {
      this.startLogoutBillingAutoTimer();
      window.alert(t('gpu.someCouldNotStop'));
      return;
    }
    this.closeLogoutBillingDialog();
    this.advanceLogoutBillingFlow();
  }

  handleLogoutLeaveBillingRunning() {
    this.closeLogoutBillingDialog();
    this.clearLogoutBillingState();
    this.performLogout();
  }

  async performLogout() {
    uploadManager.cancelAll();
    try {
      // Stop any running containers before logout
      await fetch(`${API_URL}/api/containers/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      }).catch(err => console.log('Container cleanup on logout:', err.message));

      // Call logout API (this clears the cookie)
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Logout error:', err);
    }

    // Clear state
    this.user = null;
    this.isAuthenticated = false;
    this.showLogin = true;
    this._navHistory = [];
    this._canGoBack = false;
    clearCachedUserPreferences();
    this.clearLogoutBillingState();

    // Stop inactivity timer
    this.stopInactivityTimer();
    this._syncAuthThemeWatch();

    // Cleanup any running containers
    await this.cleanupContainer();
  }

  connectedCallback() {
    super.connectedCallback();
    installViewerActivityListeners();
    this._onNotificationOpen = (e) => this.handleNotificationOpen(e);
    this.addEventListener('notification-open', this._onNotificationOpen);
    this._onPendingRegistrations = () => { this.currentView = APP_VIEWS.ADMIN_REGISTRATIONS; this.syncViewToUrl(); };
    this.addEventListener('pending-registrations-request', this._onPendingRegistrations);
    this._onNavigateBack = () => this._handleNavigateBack();
    this.addEventListener('navigate-back', this._onNavigateBack);
    this._syncAuthThemeWatch();
    if (this.shareToken) {
      this.launchSharedViewer();
      return;
    }
    // Cleanup any existing containers when page loads
    if (this.isAuthenticated) {
      this.cleanupContainer();
    }

    // Don't cleanup on main page unload anymore - only when Trame window closes
  }

  disconnectedCallback() {
    if (this._onNotificationOpen) {
      this.removeEventListener('notification-open', this._onNotificationOpen);
    }
    if (this._onPendingRegistrations) {
      this.removeEventListener('pending-registrations-request', this._onPendingRegistrations);
    }
    if (this._onNavigateBack) {
      this.removeEventListener('navigate-back', this._onNavigateBack);
    }
    if (this._onPopState) {
      window.removeEventListener('popstate', this._onPopState);
    }
    if (this._onDirectusSessionExpired) {
      window.removeEventListener('directus-session-expired', this._onDirectusSessionExpired);
    }
    this._stopDirectusKeepalive();
    this._stopAuthThemeWatch();
    this.stopSharedReplayPolling();
    super.disconnectedCallback();
  }

  _stopAuthThemeWatch() {
    if (this._unwatchSystemTheme) {
      this._unwatchSystemTheme();
      this._unwatchSystemTheme = null;
    }
  }

  /** Auth screens follow OS light/dark; signed-in UI uses account theme prefs. */
  _syncAuthThemeWatch() {
    this._stopAuthThemeWatch();
    if (!this.isAuthenticated) {
      this._unwatchSystemTheme = watchSystemColorScheme();
    }
  }

  async cleanupContainer() {
    if (!this.isAuthenticated) return;

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

  render() {
    if (this.shareToken) {
      if (this.shareLoading) {
        return html`<div class="auth-container">${t('share.loadingViewer')}</div>`;
      }
      if (this.shareError) {
        const requiresSignIn = this.shareErrorStatus === 403 && this.shareError.toLowerCase().includes('sign in');
        const signInUrl = `${window.location.pathname}${window.location.search}`;
        return html`
          <div class="auth-container">
            <status-card
              tone="error"
              title=${t('share.unableOpen')}
              .message=${this.shareError}
            >
              ${requiresSignIn ? html`
                <button
                  slot="actions"
                  class="primary"
                  @click=${() => { window.location.href = signInUrl; }}
                >
                  Sign in and retry
                </button>
              ` : ''}
              <button
                slot="actions"
                @click=${() => this.launchSharedViewer()}
              >
                Try again
              </button>
              <button
                slot="actions"
                @click=${() => { window.location.href = '/'; }}
              >
                Back to app
              </button>
            </status-card>
          </div>
        `;
      }
      return html`
        <div class="header">
          <div class="user-info">
            <span class="user-name">${this.shareViewerKind === VIEWER_KINDS.SLICER_GUI
          ? t('share.simplifiedHeader', { file: this.shareFileName || t('share.fileFallback') })
          : t('share.readonlyHeader', { file: this.shareFileName || t('share.fileFallback') })}</span>
            ${this.shareReplayStatus ? html`<span style="margin-left:10px; color:#666; font-size:12px;">${this.shareReplayStatus}</span>` : ''}
          </div>
        </div>
        <iframe src="${this.shareIframeUrl}" @load=${this.handleSharedIframeLoad}></iframe>
      `;
    }

    if (this.registerToken) {
      return html`
        <div class="auth-container">
          <complete-registration-form
            .token=${this.registerToken}
            @registration-complete=${this.handleRegistrationComplete}
          ></complete-registration-form>
        </div>
      `;
    }

    if (this.inviteToken) {
      return html`
        <div class="auth-container">
          <invite-accept-form
            .token=${this.inviteToken}
            @invite-accepted=${this.handleInviteAccepted}
          ></invite-accept-form>
        </div>
      `;
    }

    if (this.kcInviteToken) {
      return html`
        <div class="auth-container">
          <kc-invite-accept-form
            .token=${this.kcInviteToken}
            @kc-invite-accepted=${this.handleKcInviteAccepted}
          ></kc-invite-accept-form>
        </div>
      `;
    }

    // Show auth forms if not authenticated
    if (!this.isAuthenticated) {
      return html`
        <div class="auth-container">
          ${this.showLogin
          ? html`<login-form
                @login-success=${this.handleLoginSuccess}
                @show-register=${this.handleShowRegister}>
              </login-form>`
          : html`<registration-request-form
                @show-login=${this.handleShowLogin}>
              </registration-request-form>`
        }
        </div>
      `;
    }

    // Provisioned accounts must set a personal password before using the product
    if (this.user?.mustChangePassword) {
      return html`
        <div class="auth-container">
          <change-password-form
            @password-changed=${this.handlePasswordChanged}>
          </change-password-form>
        </div>
      `;
    }

    // Show main app if authenticated
    return html`
      ${this.currentView === APP_VIEWS.HOME ? html`
        <home-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .isOrgAdmin=${this.isOrgAdmin}
          .isRegistrationReviewer=${this.isRegistrationReviewer}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
          @pending-registrations-request=${() => { this.currentView = APP_VIEWS.ADMIN_REGISTRATIONS; this.syncViewToUrl(); }}
        ></home-page>
      ` : ''}
      ${MY_FILES_VISIBLE && this.currentView === APP_VIEWS.FILES ? html`
        <file-manager
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .isOrgAdmin=${this.isOrgAdmin}
          .isRegistrationReviewer=${this.isRegistrationReviewer}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></file-manager>
      ` : ''}
      ${this.currentView === APP_VIEWS.PROJECTS ? html`
        <my-projects-landing-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @project-selected=${this.openProjectReviewFlow}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></my-projects-landing-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.PROJECT_REVIEW ? html`
        <project-review-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .projectId=${this.selectedProjectId}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></project-review-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.SETTINGS && canAccessAccountSettings() ? html`
        <user-settings-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .user=${this.user}
          .isOrgAdmin=${this.isOrgAdmin}
          .isRegistrationReviewer=${this.isRegistrationReviewer}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
          @profile-updated=${this.handleProfileUpdated}
        ></user-settings-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.ADMIN_REGISTRATIONS && this.isRegistrationReviewer ? html`
        <admin-registrations-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .isOrgAdmin=${this.isOrgAdmin}
          .canGoBack=${this._canGoBack}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></admin-registrations-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.MY_GROUPS ? html`
        <admin-task-groups-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .isOrgAdmin=${this.isOrgAdmin}
          .isRegistrationReviewer=${this.isRegistrationReviewer}
          .currentDirectusUserId=${this.directusUserId || ''}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></admin-task-groups-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.CASES ? html`
        <cases-page
          .username=${userDisplayName(this.user)}
          .avatarUrl=${this.user?.avatarUrl || ''}
          .currentUserId=${this.user?.id || null}
          .currentKeycloakSub=${this.keycloakSub || null}
          .isOrgAdmin=${this.isOrgAdmin}
          .isRegistrationReviewer=${this.isRegistrationReviewer}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></cases-page>
      ` : ''}

      <upload-tray></upload-tray>

      <app-dialog
        id="logout-billing-dialog"
        title=${this.logoutBillingMode === 'transfer'
        ? t('gpu.billingStillActive')
        : t('gpu.stopBeforeLogout')}
        .lightDismiss=${false}
      >
        ${this.logoutBillingMode === 'transfer' && this.logoutTransferSession ? html`
          <div class="logout-billing-dialog">
            <p>
              You own GPU billing on
              <strong>${this.logoutTransferSession.projectName}</strong>.
              Other users are still active
              (${this.logoutTransferImpactNames || 'collaborators'}).
              Transfer ownership or stop billing before you log out.
            </p>
            ${this.logoutBillingAutoHint ? html`
              <p class="logout-billing-auto-hint">${this.logoutBillingAutoHint}</p>
            ` : ''}
            <div class="logout-billing-actions">
              <button
                class="secondary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy}
                @click=${() => this.cancelLogoutBilling()}
              >
                Cancel
              </button>
              <button
                class="secondary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy || !this.logoutTransferSession?.transferTarget}
                @click=${() => this.handleLogoutTransfer()}
              >
                ${this.logoutTransferLabel}
              </button>
              <button
                class="primary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy}
                @click=${() => this.handleLogoutStopAnyway()}
              >
                ${this.logoutBillingBusy ? 'Working…' : 'Stop anyway'}
              </button>
            </div>
          </div>
        ` : ''}
        ${this.logoutBillingMode === 'sole' ? html`
          <div class="logout-billing-dialog">
            <p>
              You still own GPU billing on
              ${this.logoutSoleSessions.length === 1 ? 'this project' : 'these projects'}.
              Stop billing so the project isn’t charged after you leave, or log out and leave billing running.
            </p>
            ${this.logoutBillingAutoHint ? html`
              <p class="logout-billing-auto-hint">${this.logoutBillingAutoHint}</p>
            ` : ''}
            <ul class="logout-billing-sessions">
              ${this.logoutSoleSessions.map((session) => html`
                <li class="logout-billing-session">
                  <div>
                    <div class="logout-billing-session-name">${session.projectName}</div>
                    <div class="logout-billing-session-meta">
                      ${session.providerId || 'remote'} · billing active
                    </div>
                  </div>
                  <button
                    class="secondary-button"
                    type="button"
                    ?disabled=${this.logoutBillingBusy}
                    @click=${() => this.handleLogoutStopProject(session.projectId)}
                  >
                    Stop billing
                  </button>
                </li>
              `)}
            </ul>
            <div class="logout-billing-actions">
              <button
                class="secondary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy}
                @click=${() => this.cancelLogoutBilling()}
              >
                Cancel
              </button>
              <button
                class="secondary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy}
                @click=${() => this.handleLogoutLeaveBillingRunning()}
              >
                ${t('gpu.logOutWithoutStopping')}
              </button>
              <button
                class="primary-button"
                type="button"
                ?disabled=${this.logoutBillingBusy || !this.logoutSoleSessions.length}
                @click=${() => this.handleLogoutStopAllSole()}
              >
                ${this.logoutBillingBusy ? t('common.working') : t('gpu.stopAllAndLogOut')}
              </button>
            </div>
          </div>
        ` : ''}
      </app-dialog>

      ${this._directusReconnectOpen ? html`
        <app-dialog
          id="directus-reconnect-dialog"
          title=${t('directusReconnect.title')}
          .lightDismiss=${false}
          .showDefaultCloseButton=${false}
        >
          <form class="directus-reconnect-form" @submit=${(e) => this._submitDirectusReconnect(e)}>
            <p class="directus-reconnect-hint">${t('directusReconnect.hint')}</p>
            <div class="directus-reconnect-field">
              <label for="dx-reconnect-pw">${t('directusReconnect.passwordLabel')}</label>
              <input
                id="dx-reconnect-pw"
                name="password"
                type="password"
                autocomplete="current-password"
                ?disabled=${this._directusReconnectBusy}
                autofocus
              />
            </div>
            ${this._directusReconnectError ? html`
              <p class="directus-reconnect-error" role="alert">${this._directusReconnectError}</p>
            ` : ''}
            <div class="directus-reconnect-actions">
              <button
                type="button"
                class="secondary-button"
                ?disabled=${this._directusReconnectBusy}
                @click=${() => {
          this._directusReconnectOpen = false;
          this.renderRoot?.querySelector('#directus-reconnect-dialog')?.closeDialog?.();
          window.dispatchEvent(new CustomEvent('directus-session-reconnect-cancelled'));
        }}
              >${t('directusReconnect.cancel')}</button>
              <button
                type="submit"
                class="primary-button"
                ?disabled=${this._directusReconnectBusy}
              >${this._directusReconnectBusy ? t('common.working') : t('directusReconnect.submit')}</button>
            </div>
          </form>
        </app-dialog>

      ` : ''}

    `;
  }

  async launchSharedViewer() {
    if (!this.shareToken) return;
    this.shareLoading = true;
    this.shareError = '';
    this.shareErrorStatus = 0;

    try {
      const response = await fetch(`${API_URL}/api/share-links/${encodeURIComponent(this.shareToken)}/launch`, {
        credentials: 'include'
      });
      const data = await response.json();
      if (!response.ok) {
        this.shareErrorStatus = response.status;
        const backendMessage = data?.error?.message || data?.message || '';
        if (response.status === 404) {
          this.shareError = t('share.invalidExpired');
        } else if (response.status === 403 && backendMessage.toLowerCase().includes('sign in')) {
          this.shareError = t('share.restrictedSignIn');
        } else if (response.status === 403) {
          this.shareError = t('share.accessDenied');
        } else {
          this.shareError = backendMessage || t('share.failedOpen');
        }
        return;
      }

      this.shareFileName = data?.file?.title
        || data?.file?.displayTitle
        || data?.file?.originalName
        || 'Shared file';
      this.shareReplayStatus = '';
      this.shareViewerKind = data?.viewerKind === VIEWER_KINDS.SLICER_GUI
        ? VIEWER_KINDS.SLICER_GUI
        : VIEWER_KINDS.TRAME;

      if (this.shareViewerKind === VIEWER_KINDS.SLICER_GUI) {
        if (!data?.vncPath || !data?.sessionToken) {
          this.shareError = t('share.unableSimplified');
          return;
        }
        this.shareIframeUrl = buildSlicerGuiLoaderUrl({
          fileId: data.file?.id,
          fileName: this.shareFileName,
          vncPath: data.vncPath,
          sessionToken: data.sessionToken,
          seatId: data.seatId,
          shareToken: this.shareToken,
          simplified: true,
          embed: true,
          quick: data.sessionReused === true && data.sceneReloaded === false
        });
        return;
      }

      const url = data?.frontendUrl;
      if (!url) {
        this.shareError = t('share.unableViewer');
        return;
      }

      this.shareIframeUrl = url;
    } catch (err) {
      console.error('Shared viewer launch error:', err);
      this.shareError = t('share.failedLoad');
      this.shareErrorStatus = 0;
    } finally {
      this.shareLoading = false;
    }
  }

  async handleSharedIframeLoad() {
    if (!this.shareToken) return;
    if (this.shareViewerKind === VIEWER_KINDS.SLICER_GUI) return;
    this.startSharedReplayPolling();
  }

  startSharedReplayPolling() {
    if (!this.shareToken) return;
    this.stopSharedReplayPolling();
    this.shareReplayAttempts = 0;
    this.shareReplayInFlight = false;
    this.shareReplayStatus = t('share.applyingView');

    const scheduleNext = (delayMs) => {
      this.shareReplayPollTimer = setTimeout(() => {
        this.shareReplayPollTimer = null;
        tick();
      }, delayMs);
    };

    const tick = async () => {
      if (!this.shareToken) return;
      if (this.shareReplayInFlight) {
        scheduleNext(2000);
        return;
      }

      this.shareReplayInFlight = true;
      this.shareReplayAttempts += 1;
      try {
        const response = await fetch(`${API_URL}/api/share-links/${encodeURIComponent(this.shareToken)}/replay-view-state`, {
          method: 'POST'
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
          throw new Error(data?.error?.message || data?.message || 'Replay request failed');
        }
        if (data?.applied) {
          this.shareReplayStatus = t('share.viewApplied');
          this.stopSharedReplayPolling();
          setTimeout(() => {
            if (this.shareReplayStatus === t('share.viewApplied')) this.shareReplayStatus = '';
          }, 3000);
          return;
        }

        if (this.shareReplayAttempts >= 24) {
          this.shareReplayStatus = data?.error || t('share.viewFailed');
          this.stopSharedReplayPolling();
        } else {
          this.shareReplayStatus = t('share.applyingProgress', { n: this.shareReplayAttempts });
          scheduleNext(5000);
        }
      } catch (err) {
        console.error('Shared replay error:', err);
        if (this.shareReplayAttempts >= 24) {
          this.shareReplayStatus = t('share.viewFailed');
          this.stopSharedReplayPolling();
        } else {
          this.shareReplayStatus = t('share.applyingProgress', { n: this.shareReplayAttempts });
          // Back off slightly more on transient failures.
          scheduleNext(7000);
        }
      } finally {
        this.shareReplayInFlight = false;
      }
    };

    // Start one request immediately, then schedule only after each response.
    tick();
  }

  stopSharedReplayPolling() {
    if (this.shareReplayPollTimer) {
      clearTimeout(this.shareReplayPollTimer);
      this.shareReplayPollTimer = null;
    }
    this.shareReplayInFlight = false;
  }
}

customElements.define('slicer-app', SlicerApp);
