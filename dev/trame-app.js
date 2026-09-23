import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import { t } from './i18n/index.js';
import {
  APP_VIEWS,
  DEFAULT_APP_VIEW,
  readAppViewFromUrl,
  writeAppViewToUrl
} from './components/app-views.js';
import { loadAppFeatures, isDirectusCasesEnabled, areAppFeaturesLoaded } from './services/features.js';
import {
  setDirectusLinkGate,
  clearDirectusLinkGate,
  canAccessAccountSettings
} from './utils/directusLinkGate.js';
import './login-form.js';
import './register-form.js';
import './invite-accept-form.js';
import './change-password-form.js';
import './file-manager.js';
import './components/status-card.js';
import './MyProjects/myProjectsEmptyState.js';
import './MyProjects/projectReviewPage.js';
import './user-settings-page.js';
import './directus-cases-page.js';
import { resolveTramePageUrl } from './utils/trameViewerUrl.js';
import { buildSlicerGuiLoaderUrl, VIEWER_KINDS } from './utils/viewerLaunch.js';
import {
  installViewerActivityListeners,
  markViewerActivity,
  resetViewerActivity
} from './utils/viewerActivity.js';
import { sendTrameContainerHeartbeat } from './utils/trameHeartbeat.js';
import {
  hydrateUserPreferencesFromUser,
  clearCachedUserPreferences
} from './utils/userPreferences.js';
import { watchSystemColorScheme } from './components/theme.js';
import './components/app-dialog.js';
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

export class TrameApp extends LitElement {
  static get styles() {
    return css`
      :host {
        display: block;
        padding: 0;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
        margin: 0 0 16px 0;
      }

      .user-info {
        display: flex;
        align-items: center;
        gap: 15px;
      }

      .user-name {
        font-weight: 500;
        color: #333;
      }

      .logout-btn {
        padding: 8px 16px;
        background: #f44336;
        color: white;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 14px;
      }

      .logout-btn:hover {
        background: #d32f2f;
      }

      .controls {
        border: solid 1px gray;
        padding: 16px;
        margin-bottom: 10px;
      }

      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 3px solid rgba(0, 0, 0, 0.2);
        border-top-color: rgba(0, 0, 0, 0.8);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        vertical-align: middle;
        margin-right: 8px;
      }

      iframe {
        width: 100%;
        height: calc(100vh - 200px);
        border: 1px solid #ccc;
        margin-top: 10px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .auth-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        box-sizing: border-box;
        background: var(--color-background, #ecf4f9);
        color: var(--color-text-primary, #040316);
        font-family: var(--font-family-base, Inter, system-ui, sans-serif);
      }

      .logout-billing-dialog {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: min(420px, 85vw);
        max-width: 520px;
      }

      .logout-billing-dialog p {
        margin: 0;
        line-height: 1.45;
        color: var(--color-text-primary, #333);
      }

      .logout-billing-auto-hint {
        font-size: 13px;
        color: var(--color-text-secondary, #666);
      }

      .logout-billing-sessions {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 240px;
        overflow: auto;
      }

      .logout-billing-session {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border, #ddd);
        border-radius: var(--radius-md);
        background: var(--color-panel, var(--color-surface, var(--color-background, #fafafa)));
      }

      .logout-billing-session-name {
        font-weight: 600;
        color: var(--color-text-primary, #222);
      }

      .logout-billing-session-meta {
        font-size: 12px;
        color: var(--color-text-secondary, #666);
      }

      .logout-billing-actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
      }

      .secondary-button,
      .primary-button {
        border: 1px solid var(--color-border, #ddd);
        border-radius: var(--radius-md);
        min-height: 40px;
        padding: 8px 14px;
        font: inherit;
        font-weight: 600;
        cursor: pointer;
      }

      .secondary-button {
        background: transparent;
        color: var(--color-text-primary, #333);
      }

      .primary-button {
        background: var(--color-primary, #1976d2);
        color: var(--color-on-primary, #fff);
      }

      .primary-button:disabled,
      .secondary-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `;
  }

  static get properties() {
    return {
      name: { type: String },
      output: { type: String },
      loading: { type: Boolean },
      useIframe: { type: Boolean },
      showIframe: { type: Boolean },
      iframeUrl: { type: String },
      // Auth properties
      isAuthenticated: { type: Boolean },
      user: { type: Object },
      showLogin: { type: Boolean },
      currentView: { type: String },
      selectedProjectId: { type: Number },
      shareToken: { type: String },
      inviteToken: { type: String },
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
      logoutBillingAutoSeconds: { type: Number }
    };
  }

  constructor() {
    super();
    this.name = "World";
    this.output = "";
    this.loading = false;
    this.useIframe = false;
    this.showIframe = false;
    this.iframeUrl = "";

    // Auth state
    this.isAuthenticated = false;
    this.user = null;
    this.showLogin = true; // Show login by default
    this.currentView = DEFAULT_APP_VIEW;
    this.selectedProjectId = null;
    this.inactivityTimeout = null;
    this.shareToken = new URLSearchParams(window.location.search).get('share') || '';
    this.inviteToken = new URLSearchParams(window.location.search).get('invite') || '';
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
    this._logoutQueueWithOthers = [];
    this._logoutQueueSole = [];
    this._logoutBillingAutoTimer = null;
    this._logoutBillingAutoInterval = null;
    this._trameHeartbeatInterval = null;
    this._onPopState = () => this.handlePopState();

    if (!this.shareToken && !this.inviteToken) {
      this.initializeAppView();
      this.checkExistingSession();
    }

    window.addEventListener('popstate', this._onPopState);
  }

  async initializeAppView() {
    await loadAppFeatures();
    this.restoreViewFromUrl({ writeBack: false });
    this.guardCasesView();
    this.guardCreateProjectView();
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

  guardCasesView() {
    if (!areAppFeaturesLoaded()) return;
    if (!isDirectusCasesEnabled() && this.currentView === APP_VIEWS.CASES) {
      this.currentView = DEFAULT_APP_VIEW;
      this.syncViewToUrl();
    }
  }

  /** CUTOVER: new projects are Cases-only; block create-project deep links. */
  guardCreateProjectView() {
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
    this.guardCasesView();
    this.guardCreateProjectView();
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
        this.name = this.user.username;
        this.applyIdentityGate(data.identity);
        await hydrateUserPreferencesFromUser(this.user);
        this.startInactivityTimer();
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
    this._syncAuthThemeWatch();
  }

  handleLoginSuccess(e) {
    const { user, identity } = e.detail || {};
    this.user = user;
    this.isAuthenticated = true;
    this.name = user.username;
    this.applyIdentityGate(identity);
    this._stopAuthThemeWatch();
    hydrateUserPreferencesFromUser(user);
    this.startInactivityTimer();
  }

  handleRegisterSuccess(e) {
    const { user } = e.detail;
    this.user = user;
    this.isAuthenticated = true;
    this.name = user.username;
    this._stopAuthThemeWatch();
    hydrateUserPreferencesFromUser(user);
    this.startInactivityTimer();
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
      this.name = user.username;
      this._stopAuthThemeWatch();
      hydrateUserPreferencesFromUser(user);
      this.startInactivityTimer();
      // Invite redeem creates/links Directus — refresh gate from /me.
      this.checkExistingSession();
    }
    this.initializeAppView();
  }

  handleNotificationOpen(e) {
    const caseId = e.detail?.caseId;
    if (!caseId || !isDirectusCasesEnabled()) return;
    if (!this.confirmLeaveCurrentView()) return;
    const inviteId = e.detail?.inviteId || null;
    const type = String(e.detail?.type || '');
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
      const page = this.renderRoot?.querySelector('directus-cases-page');
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
      this.name = userDisplayName(this.user);
    } else if (this.user) {
      this.user = { ...this.user, mustChangePassword: false };
    }
  }

  handleProfileUpdated(e) {
    const { user } = e.detail || {};
    if (!user) return;
    this.user = { ...(this.user || {}), ...user };
    this.name = userDisplayName(this.user);
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
    const projectId = Number(e.detail?.projectId);
    if (!Number.isInteger(projectId) || projectId <= 0) return;
    this.selectedProjectId = projectId;
    this.currentView = APP_VIEWS.PROJECT_REVIEW;
    this.syncViewToUrl({ replace: false });
  }

  handleProjectsMenuSelection(e) {
    if (!this.confirmLeaveCurrentView()) return;
    const selectedKey = e.detail?.selectedKey;
    if (selectedKey === 'my-files') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.FILES;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'my-projects') {
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.PROJECTS;
      this.syncViewToUrl();
      return;
    }
    if (selectedKey === 'cases') {
      if (!isDirectusCasesEnabled()) return;
      this.selectedProjectId = null;
      this.currentView = APP_VIEWS.CASES;
      const caseId = e.detail?.caseId ? String(e.detail.caseId).trim() : '';
      if (caseId) {
        const url = new URL(window.location.href);
        url.searchParams.set('view', 'cases');
        url.searchParams.set('case', caseId);
        history.pushState({ caseId }, '', `${url.pathname}?${url.searchParams}`);
        this.updateComplete.then(() => {
          const page = this.renderRoot?.querySelector('directus-cases-page');
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

  /**
   * Explicit logout (menu button). If the user owns remote GPU billing, remind them
   * to transfer or stop before signing out.
   */
  async handleLogout() {
    if (this.logoutBillingBusy || this.logoutBillingMode) return;
    if (!this.confirmLeaveCurrentView()) return;

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
    if (this._onPopState) {
      window.removeEventListener('popstate', this._onPopState);
    }
    this._stopAuthThemeWatch();
    this.stopTrameHeartbeat();
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

  async handleViewerInactivityTimeout() {
    if (!this.showIframe) return;
    this.output = t('gpu.viewerClosedInactivity');
    await this.closeIframe();
  }

  startTrameHeartbeat() {
    this.stopTrameHeartbeat();
    const ping = () => {
      sendTrameContainerHeartbeat({
        onIdleTimeout: () => this.handleViewerInactivityTimeout()
      }).catch(() => {});
    };
    ping();
    this._trameHeartbeatInterval = setInterval(ping, 60000);
  }

  stopTrameHeartbeat() {
    if (this._trameHeartbeatInterval) {
      clearInterval(this._trameHeartbeatInterval);
      this._trameHeartbeatInterval = null;
    }
  }

  async cleanupContainer() {
    if (!this.isAuthenticated) return;

    this.stopTrameHeartbeat();
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

    // Show auth forms if not authenticated
    if (!this.isAuthenticated) {
      return html`
        <div class="auth-container">
          ${this.showLogin
          ? html`<login-form 
                @login-success=${this.handleLoginSuccess}
                @show-register=${this.handleShowRegister}>
              </login-form>`
          : html`<register-form 
                @register-success=${this.handleRegisterSuccess}
                @show-login=${this.handleShowLogin}>
              </register-form>`
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
      <!-- Old Trame controls - commented out but kept for reference
      <div class="controls">
        <h1>Hello, ${this.name}!</h1>
        
        <div>
          <label>
            <input type="checkbox" ?checked=${this.useIframe} @change=${this.toggleMode}>
            Open in iframe (embedded)
          </label>
        </div>
        
        <button @click=${this.startTrame} ?disabled=${this.loading}>
          ${this.loading
        ? html`<span class="spinner"></span>Starting Trame…`
        : 'Start Trame'}
        </button>
        
        ${this.showIframe ? html`
          <button @click=${this.closeIframe}>Close Trame</button>
        ` : ''}

        <pre>${this.output}</pre>
      </div>
      
      ${this.showIframe ? html`
        <iframe src="${this.iframeUrl}"></iframe>
      ` : ''}
      -->

      ${this.currentView === APP_VIEWS.FILES ? html`
        <file-manager
          .username=${userDisplayName(this.user)}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></file-manager>
      ` : ''}
      ${this.currentView === APP_VIEWS.PROJECTS ? html`
        <my-projects-landing-page
          .username=${userDisplayName(this.user)}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @project-selected=${this.openProjectReviewFlow}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></my-projects-landing-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.PROJECT_REVIEW ? html`
        <project-review-page
          .username=${userDisplayName(this.user)}
          .projectId=${this.selectedProjectId}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></project-review-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.SETTINGS && canAccessAccountSettings() ? html`
        <user-settings-page
          .username=${userDisplayName(this.user)}
          .user=${this.user}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
          @profile-updated=${this.handleProfileUpdated}
        ></user-settings-page>
      ` : ''}
      ${this.currentView === APP_VIEWS.CASES && isDirectusCasesEnabled() ? html`
        <directus-cases-page
          .username=${userDisplayName(this.user)}
          @menu-selection-change=${this.handleProjectsMenuSelection}
          @settings-request=${this.openSettingsFlow}
          @logout-request=${this.handleLogout}
        ></directus-cases-page>
      ` : ''}

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
    `;
  }

  toggleMode(e) {
    this.useIframe = e.target.checked;
  }

  startTrame() {
    if (this.useIframe) {
      this._startTrameAsync(null);
    } else {
      const newWindow = window.open("", "_blank");
      if (!newWindow) {
        this.output = "Popup blocked! Please allow popups for this site.";
        return;
      }
      newWindow.document.write("<h2>Starting Trame… please wait</h2>");
      this._startTrameAsync(newWindow);
    }
  }

  async closeIframe() {
    this.stopTrameHeartbeat();
    resetViewerActivity();
    this.showIframe = false;
    this.iframeUrl = "";

    // Stop the container
    try {
      await fetch(`${API_URL}/api/containers/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      });
      this.output = "Trame container stopped";
    } catch (err) {
      console.error("Error stopping container:", err);
    }
  }

  monitorWindowClosed(windowRef) {
    const checkInterval = setInterval(() => {
      if (windowRef.closed) {
        clearInterval(checkInterval);
        console.log("Trame window closed, cleaning up container...");
        this.cleanupContainer();
        this.output = "Trame window closed, container stopped";
      }
    }, 1000); // Check every second
  }

  async _startTrameAsync(newWindow) {
    this.loading = true;
    try {
      // Clean up any existing container first
      await this.cleanupContainer();

      const res = await fetch(`${API_URL}/api/containers/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to start job: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      const url = resolveTramePageUrl(data.frontendUrl);

      if (this.useIframe) {
        // Wait a moment for Trame to fully start, then show iframe
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.iframeUrl = url;
        markViewerActivity();
        this.showIframe = true;
        this.startTrameHeartbeat();
        this.output = "Trame app loaded in iframe";
      } else {
        // Wait for Trame to start, then redirect new window
        newWindow.document.write("<h2>Starting Trame, please wait a few seconds...</h2>");
        await new Promise(resolve => setTimeout(resolve, 3000));
        newWindow.location.href = url;
        this.output = "Trame app opened in new tab";

        // Monitor the new window and cleanup when it closes
        this.monitorWindowClosed(newWindow);
      }
    } catch (err) {
      console.error(err);
      this.output = err.message;
      if (newWindow) {
        newWindow.document.write(`<p style="color:red;">${err.message}</p>`);
      }
    } finally {
      this.loading = false;
    }
  }

  async pollUrl(url, timeout = 60000, interval = 1000) {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeout) {
      try {
        attempts++;
        console.log(`Polling attempt ${attempts}: ${url}`);
        const r = await fetch(url, { mode: 'cors' });
        console.log(`Poll response: ${r.status} ${r.statusText}`);
        if (r.ok || r.status === 200) {
          console.log('Polling successful!');
          return;
        }
      } catch (e) {
        console.log(`Poll error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error("Trame app did not become ready in time");
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

customElements.define('trame-app', TrameApp);
