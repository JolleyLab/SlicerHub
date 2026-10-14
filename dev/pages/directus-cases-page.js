import { LitElement, html } from 'lit-element';
import { casesPageStyles } from './directus-cases-page.styles.js';
import { buttonStyles } from '../styles/buttons.js';
import { formStyles } from '../styles/forms.js';
import { utilStyles } from '../styles/utils.js';
import { t } from '../i18n/index.js';
import '../components/page-layout-template.js';
import '../components/page-content-message.js';
import '../components/file-list-row.js';
import '../components/comments-panel.js';
import '../components/audit-log.js';
import {
    listCases,
    createCase,
    updateCase,
    postComment,
    lookupUserByEmail,
    updateCollaborators,
    listInvites,
    inviteUser,
    approveInvite,
    rejectInvite,
    fetchCaseActivity,
    friendlyError,
} from '../services/cases.js';
import {
    openAttachmentInViewer,
    fetchAttachmentContent,
    checkAttachmentDownload,
    getAttachmentDownloadUrl,
    deleteAttachment,
    saveAttachmentScene,
    saveSlicerWebScene,
} from '../services/files.js';
import { invalidateNotifications } from '../services/notifications.js';
import '../components/people-dialog.js';
import '../components/app-dialog.js';
import '../components/list-filter-tools.js';
import '../components/attachment-open-menu.js';
import { uploadManager } from '../services/uploadManager.js';
import { saveWithDirectusReconnect } from '../services/directusRetry.js';
import { formatBytes } from '../utils/formatBytes.js';
import { getCaseRole, canManageCollaborators, canInvite, canEditCase, isAttachmentOwner } from '../utils/casePermissions.js';
import { deepActiveElement } from '../utils/focus.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    VIEWER_SESSION_SCOPES,
    defaultReleaseModeForClose,
    getViewerSessionEndpoints,
    buildViewerStopBody,
    buildSlicerGuiLoaderUrl,
    buildSlicerWebUrl,
    viewerDisplayName
} from '../utils/viewerLaunch.js';
import { getCachedLocalSlicerViewerOptions, getCachedUserPreferences } from '../utils/userPreferences.js';
import { resolveSimplifiedViewerChoice } from '../utils/localSlicerViewerOptions.js';
import { isInviteEmailEnabled, isSlicerWebDevModeEnabled, loadAppFeatures } from '../services/features.js';
import { sendViewerHeartbeat } from '../utils/viewerHeartbeat.js';
import { stopViewerSession } from '../utils/viewerSessionLifecycle.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity
} from '../utils/viewerActivity.js';

const CASE_INVITE_ROLE_OPTIONS = Object.freeze([
    Object.freeze({ value: '', label: t('roles.selectRole'), disabled: true }),
    Object.freeze({ value: 'collaborator', label: t('roles.collaborator') }),
    Object.freeze({ value: 'read_only', label: t('roles.readOnly') })
]);

const LIST_SORT_OPTIONS = Object.freeze([
    Object.freeze({
        value: 'newest',
        label: t('cases.sortNewest'),
        ariaLabel: t('cases.sortNewestAria')
    }),
    Object.freeze({
        value: 'oldest',
        label: t('cases.sortOldest'),
        ariaLabel: t('cases.sortOldestAria')
    }),
    Object.freeze({
        value: 'title',
        label: t('cases.sortTitle'),
        ariaLabel: t('cases.sortTitleAria')
    })
]);

const attachmentFileName = (attachment) => attachment?.filenameDownload || attachment?.name || 'attachment';

function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const CASE_COMMENT_SEEN_STORAGE_KEY = 'slicer.caseCommentSeen.v1';

function readCaseCommentSeenMap() {
    try {
        const raw = localStorage.getItem(CASE_COMMENT_SEEN_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeCaseCommentSeenMap(map) {
    try {
        localStorage.setItem(CASE_COMMENT_SEEN_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) {
        /* ignore quota / private mode */
    }
}

/**
 * Cases UI: case cards landing, detail with attachments + comments + people.
 */
export class DirectusCasesPage extends LitElement {
    static get styles() {
        return [buttonStyles, formStyles, utilStyles, casesPageStyles];
    }

    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean },
            loading: { type: Boolean },
            errorMessage: { type: String },
            cases: { type: Array },
            sessionMeta: { type: Object },
            savingCollaborators: { type: Boolean },
            selectedCaseId: { type: String },
            openingAttachmentId: { type: String },
            postingComment: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            toastMessage: { type: String },
            viewerSimplified: { type: Boolean },
            viewerKind: { type: String },
            viewerClosing: { type: Boolean },
            currentFileName: { type: String },
            currentAttachmentId: { type: String },
            hasUnsavedChanges: { type: Boolean },
            isSavingScene: { type: Boolean },
            _backgroundSave: { type: Object },
            saveIndicatorMessage: { type: String },
            _saveAsNewName: { type: String },
            closePromptMode: { type: String },
            // Audit view
            _auditRows: { type: Array },
            _auditLoading: { type: Boolean },
            _auditError: { type: String },
            _auditHasMore: { type: Boolean },
            _auditOffset: { type: Number },
            _toolbarMenuOpen: { type: Boolean },
            // New Case form
            showNewCaseForm: { type: Boolean },
            newCaseTitle: { type: String },
            newCaseDescription: { type: String },
            creatingCase: { type: Boolean },
            newCaseError: { type: String },
            // Archive
            archivingCase: { type: Boolean },
            // Inline case edit
            editingCase: { type: Boolean },
            editCaseTitle: { type: String },
            editCaseDesc: { type: String },
            savingCaseEdit: { type: Boolean },
            caseEditError: { type: String },
            // File upload
            uploadingFile: { type: Boolean },
            uploadError: { type: String },
            uploadStatusText: { type: String },
            uploadProgress: { type: Number },
            attachmentDragOver: { type: Boolean },
            // Attachment delete
            deletingAttachmentId: { type: String },
            downloadingAttachmentIds: { type: Object },
            downloadStatusText: { type: String },
            // Attachment sort / search
            attachmentSortOrder: { type: String },
            attachmentSearchQuery: { type: String },
            // Cases list sort / search
            caseSortOrder: { type: String },
            caseSearchQuery: { type: String },
            /** Unresolved invites for the open case (People button badge). */
            pendingInviteCount: { type: Number }
        };
    }

    constructor() {
        super();
        this.username = t('common.guest');
        this.avatarUrl = '';
        this.loading = false;
        this.errorMessage = '';
        this.cases = [];
        this.sessionMeta = null;
        this.savingCollaborators = false;
        this.selectedCaseId = '';
        this.openingAttachmentId = '';
        this.postingComment = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.currentFileName = '';
        this.currentAttachmentId = '';
        this.hasUnsavedChanges = false;
        this.isSavingScene = false;
        this._lastSavedAttachmentId = null;
        this.saveIndicatorMessage = '';
        this.saveIndicatorTimeout = null;
        this.saveIndicatorActivityCleanup = null;
        this.iframeActivityCleanup = null;
        this.closePromptMode = null;
        this._closePromptResolver = null;
        this._auditRows = [];
        this._auditLoading = false;
        this._auditError = null;
        this._auditHasMore = false;
        this._auditOffset = 0;
        this._toolbarMenuOpen = false;
        this._saveAsNewName = '';
        this._saveAsNewResolver = null;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerClosing = false;
        this._viewerOpenId = 0;
        this._focusBeforeViewer = null;
        this._slicerWebRun = 0;
        this._slicerWebPending = null;
        this._slicerWebDownloadPromise = null;
        this.toastMessage = '';
        this._toastTimeout = null;
        this._heartbeatInterval = null;
        this._handleBeforeUnload = null;
        this._popStateHandler = null;
        this._viewerPushedState = false;
        this._detailLayoutRo = null;
        this._detailLayoutEl = null;
        // New Case form
        this.showNewCaseForm = false;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.creatingCase = false;
        this.newCaseError = '';
        // Archive
        this.archivingCase = false;
        // Inline case edit
        this.editingCase = false;
        this.editCaseTitle = '';
        this.editCaseDesc = '';
        this.savingCaseEdit = false;
        this.caseEditError = '';
        // File upload
        this.uploadingFile = false;
        this.uploadError = '';
        this.uploadStatusText = '';
        this.uploadProgress = 0;
        this.attachmentDragOver = false;
        this._attachmentDragDepth = 0;
        // Attachment delete / download
        this.deletingAttachmentId = '';
        this.downloadingAttachmentIds = new Set();
        this.downloadStatusText = '';
        // Attachment sort / search
        this.attachmentSortOrder = 'newest';
        this.attachmentSearchQuery = '';
        // Cases list sort / search
        this.caseSortOrder = 'newest';
        this.caseSearchQuery = '';
        this.pendingInviteCount = 0;
    }

    get selectedCase() {
        return this.cases.find((row) => row.id === this.selectedCaseId) || null;
    }

    // ── URL / history helpers ──────────────────────────────────────────────
    _getCaseIdFromUrl() {
        return new URLSearchParams(location.search).get('case') || '';
    }

    _buildCaseUrl(caseId) {
        const url = new URL(location.href);
        if (caseId) {
            url.searchParams.set('case', caseId);
        } else {
            url.searchParams.delete('case');
        }
        url.searchParams.delete('viewer');
        url.searchParams.delete('view');
        return url.toString();
    }

    _buildAuditUrl(caseId) {
        const url = new URL(location.href);
        url.searchParams.set('case', caseId);
        url.searchParams.set('view', 'history');
        url.searchParams.delete('viewer');
        return url.toString();
    }

    _getViewFromUrl() {
        return new URLSearchParams(location.search).get('view') || '';
    }

    _buildViewerUrl() {
        const url = new URL(location.href);
        url.searchParams.set('case', this.selectedCaseId);
        url.searchParams.set('viewer', '1');
        return url.toString();
    }

    /** Add the viewer's history entry, so the browser Back button closes it. */
    _pushViewerHistory(caseId) {
        this._viewerPushedState = true;
        history.pushState({ caseId, viewer: true }, '', this._buildViewerUrl());
    }

    /** Point the address bar back at the plain case URL (drops the viewer entry) without a history step. */
    _replaceUrlWithCase() {
        history.replaceState({ caseId: this.selectedCaseId }, '', this._buildCaseUrl(this.selectedCaseId));
    }

    _handlePopState(event) {
        const newHasViewer = event.state?.viewer === true
            || new URLSearchParams(location.search).has('viewer');

        // If the viewer was open and we've navigated away from it, close it cleanly.
        // _doCloseViewer handles the stop request; history has already moved.
        if (this.showIframe && !newHasViewer) {
            this._viewerPushedState = false;
            this._doCloseViewer();
        }

        const caseId = event.state?.caseId ?? this._getCaseIdFromUrl();
        this.selectedCaseId = caseId || '';
        this.errorMessage = '';

        // If navigating to history view, load it; if navigating away, clear state.
        const view = event.state?.view || new URLSearchParams(location.search).get('view') || '';
        if (view === 'history' && caseId) {
            if (!this._auditRows.length && !this._auditLoading) {
                this._loadAuditLog(caseId);
            }
        } else {
            this._auditRows = [];
            this._auditOffset = 0;
            this._auditHasMore = false;
            this._auditError = null;
        }
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();

        // Restore case from URL; strip ?viewer — the container is gone after a reload
        const initialCaseId = this._getCaseIdFromUrl();
        if (initialCaseId) this.selectedCaseId = initialCaseId;
        const initialParams = new URLSearchParams(location.search);
        if (initialParams.has('viewer') || initialParams.has('view')) {
            history.replaceState({ caseId: initialCaseId }, '', this._buildCaseUrl(initialCaseId));
        }

        this._popStateHandler = (e) => this._handlePopState(e);
        window.addEventListener('popstate', this._popStateHandler);

        this._closeToolbarMenu = () => { this._toolbarMenuOpen = false; };
        window.addEventListener('click', this._closeToolbarMenu);

        this._handleBeforeUnload = (e) => {
            // Warn if a scene is being saved in the background (file bytes only live in memory).
            if (this._backgroundSave && !this._backgroundSave.error) {
                e.preventDefault();
                e.returnValue = '';
            }
            if (!this.showIframe || !this._viewerSessionToken) return;
            const { stopUrl } = getViewerSessionEndpoints({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
            });
            stopViewerSession({
                stopUrl,
                sessionToken: this._viewerSessionToken,
                body: buildViewerStopBody({
                    kind: VIEWER_KINDS.SLICER_GUI,
                    sessionToken: this._viewerSessionToken,
                    seatId: this._viewerSeatId,
                    mode: defaultReleaseModeForClose(VIEWER_KINDS.SLICER_GUI)
                }),
                keepalive: true
            });
        };
        window.addEventListener('beforeunload', this._handleBeforeUnload);

        this._onUploadChange = () => this.syncUploadState();
        this._onUploadAttached = (event) => this.handleAttachmentUploaded(event.detail);
        uploadManager.addEventListener('change', this._onUploadChange);
        uploadManager.addEventListener('attached', this._onUploadAttached);
        this.syncUploadState();

        this.loadCases();

        // Peek for a new SlicerWeb build. If one is found, clone runs in the background
        // and a toast notifies when done. Features load async so we wait before checking.
        loadAppFeatures().then(() => {
            if (isSlicerWebDevModeEnabled() && getCachedUserPreferences().slicerWebChannel === 'latest') {
                fetch('/api/slicerweb/check-update?channel=latest', { credentials: 'include' })
                    .then(r => r.ok ? r.json() : null)
                    .then(data => {
                        if (data && !data.upToDate) {
                            this._slicerWebDownloadPromise = fetch('/api/slicerweb/check-update?channel=latest', {
                                method: 'POST', credentials: 'include'
                            })
                                .then(() => {
                                    this._slicerWebDownloadPromise = null;
                                    this.showToast(t('cases.slicerWebUpdated'));
                                })
                                .catch(() => { this._slicerWebDownloadPromise = null; });
                        }
                    })
                    .catch(() => {});
            }
        });
    }

    showToast(message) {
        this.toastMessage = message || '';
        if (this._toastTimeout) clearTimeout(this._toastTimeout);
        this._toastTimeout = setTimeout(() => {
            this.toastMessage = '';
            this._toastTimeout = null;
        }, 6000);
    }

    disconnectedCallback() {
        if (this._toastTimeout) clearTimeout(this._toastTimeout);
        uploadManager.removeEventListener('change', this._onUploadChange);
        uploadManager.removeEventListener('attached', this._onUploadAttached);
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        if (this._popStateHandler) {
            window.removeEventListener('popstate', this._popStateHandler);
            this._popStateHandler = null;
        }
        if (this._closeToolbarMenu) {
            window.removeEventListener('click', this._closeToolbarMenu);
            this._closeToolbarMenu = null;
        }
        this.closeListFilterMenus();
        this.teardownDetailLayoutObserver();
        // Stop the container if the user navigates away via the side menu
        if (this.showIframe && this._viewerSessionToken) {
            this._doCloseViewer(); // fire-and-forget
        } else {
            this.stopHeartbeat();
        }
        super.disconnectedCallback();
    }

    updated(changed) {
        if (changed.has('selectedCaseId')) this.syncUploadState();
        if (changed.has('showIframe')) this.syncViewerFocus();
        if (changed.has('selectedCaseId') || this.selectedCaseId) {
            this.syncDetailLayoutObserver();
        }
    }

    /** Stack attachments/comments when the case content column is tablet-narrow. */
    syncDetailLayoutObserver() {
        const el = this.renderRoot?.querySelector('.case-detail');
        if (!el) {
            this.teardownDetailLayoutObserver();
            return;
        }
        if (this._detailLayoutEl === el && this._detailLayoutRo) {
            this.applyDetailStackState(el);
            return;
        }
        this.teardownDetailLayoutObserver();
        this._detailLayoutEl = el;
        this._detailLayoutRo = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry?.contentRect?.width ?? el.getBoundingClientRect().width;
            el.toggleAttribute('data-stack', width > 0 && width < 720);
        });
        this._detailLayoutRo.observe(el);
        this.applyDetailStackState(el);
    }

    applyDetailStackState(el) {
        const width = el.getBoundingClientRect().width;
        el.toggleAttribute('data-stack', width > 0 && width < 720);
    }

    teardownDetailLayoutObserver() {
        if (this._detailLayoutRo) {
            this._detailLayoutRo.disconnect();
            this._detailLayoutRo = null;
        }
        this._detailLayoutEl = null;
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    userFacingError(err, fallback) {
        return friendlyError(err?.message, fallback, err?.status, err?.code);
    }

    async loadCases() {
        this.loading = true;
        this.errorMessage = '';
        const keepSelected = this.selectedCaseId;
        try {
            const data = await listCases({ limit: 50 });
            this.cases = Array.isArray(data.cases) ? data.cases : [];
            this.sessionMeta = data.meta || null;
            if (keepSelected && !this.cases.some((row) => row.id === keepSelected)) {
                this.selectedCaseId = '';
            } else if (keepSelected) {
                const openRow = this.cases.find((row) => row.id === keepSelected);
                if (openRow) this.markCaseCommentsSeen(openRow);
            }
        } catch (err) {
            this.cases = [];
            this.sessionMeta = null;
            this.errorMessage = this.userFacingError(err, t('cases.loadFailed'));
        } finally {
            this.loading = false;
        }
    }

    openCase(caseId) {
        this.selectedCaseId = caseId;
        this.errorMessage = '';
        const caseRow = this.cases.find((row) => row.id === caseId);
        if (caseRow) this.markCaseCommentsSeen(caseRow);
        history.pushState({ caseId }, '', this._buildCaseUrl(caseId));
        this.refreshPendingInviteCount(caseId);
    }

    /**
     * Open case People dialog (used by notification deep-links).
     * Retries briefly if the case list has not finished loading.
     */
    async openPeopleForCaseId(caseId) {
        const id = String(caseId || '').trim();
        if (!id) return;
        this.openCase(id);
        for (let i = 0; i < 20; i += 1) {
            const caseRow = this.cases.find((row) => String(row.id) === id);
            if (caseRow) {
                await this.updateComplete;
                await this.openPeopleDialog(caseRow);
                return;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    async refreshPendingInviteCount(caseId = this.selectedCaseId) {
        const id = String(caseId || '').trim();
        if (!id) {
            this.pendingInviteCount = 0;
            return;
        }
        try {
            const invites = await listInvites(id);
            this.pendingInviteCount = Array.isArray(invites)
                ? invites.filter((inv) => inv && inv.status !== 'expired').length
                : 0;
        } catch {
            this.pendingInviteCount = 0;
        }
    }

    caseLastModifiedAt(caseRow) {
        const times = [];
        const pushTime = (value) => {
            const ms = Date.parse(value || '');
            if (Number.isFinite(ms)) times.push(ms);
        };
        pushTime(caseRow?.updatedAt);
        pushTime(caseRow?.createdAt);
        for (const comment of caseRow?.comments || []) {
            pushTime(comment?.updatedAt || comment?.createdAt);
        }
        for (const attachment of caseRow?.attachments || []) {
            pushTime(attachment?.modifiedAt);
        }
        if (!times.length) return null;
        return new Date(Math.max(...times)).toISOString();
    }

    caseLastModifiedLabel(caseRow) {
        const at = this.caseLastModifiedAt(caseRow);
        const formatted = formatDateTime(at);
        if (!formatted) return '';

        const hasNestedActivity = (caseRow?.comments?.length || 0) > 0
            || (caseRow?.attachments?.length || 0) > 0;
        const createdMs = Date.parse(caseRow?.createdAt || '');
        const updatedMs = Date.parse(caseRow?.updatedAt || '');
        const onlyCreateStamp = Number.isFinite(createdMs)
            && !hasNestedActivity
            && (!Number.isFinite(updatedMs) || updatedMs <= createdMs);

        return onlyCreateStamp ? t('cases.created', { date: formatted }) : t('cases.modified', { date: formatted });
    }

    getCaseCommentSeenAt(caseId) {
        const key = String(caseId || '').trim();
        if (!key) return null;
        const value = readCaseCommentSeenMap()[key];
        if (!value) return null;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }

    markCaseCommentsSeen(caseRow) {
        const caseId = String(caseRow?.id || '').trim();
        if (!caseId) return;
        let latest = Date.now();
        for (const comment of caseRow?.comments || []) {
            const ms = Date.parse(comment?.createdAt || comment?.updatedAt || '');
            if (Number.isFinite(ms) && ms > latest) latest = ms;
        }
        const map = readCaseCommentSeenMap();
        map[caseId] = new Date(latest).toISOString();
        writeCaseCommentSeenMap(map);
        this.requestUpdate();
    }

    countNewCaseComments(caseRow) {
        const seenAt = this.getCaseCommentSeenAt(caseRow?.id);
        if (seenAt == null) return 0;
        const myId = this.currentUserId
            ? String(this.currentUserId).toLowerCase()
            : '';
        let count = 0;
        for (const comment of caseRow?.comments || []) {
            const createdMs = Date.parse(comment?.createdAt || '');
            if (!Number.isFinite(createdMs) || createdMs <= seenAt) continue;
            const authorId = comment?.author?.id
                ? String(comment.author.id).toLowerCase()
                : '';
            if (myId && authorId && authorId === myId) continue;
            count += 1;
        }
        return count;
    }

    backToCaseList() {
        this.pendingInviteCount = 0;
        this.closeListFilterMenus();
        this.attachmentSearchQuery = '';
        this.selectedCaseId = '';
        this.errorMessage = '';
        history.pushState({}, '', this._buildCaseUrl(''));
    }

    get currentUserId() {
        return this.sessionMeta?.directusViewer?.id
            || this.sessionMeta?.directusUserId
            || null;
    }

    myCaseRole(caseRow) {
        return getCaseRole(caseRow, this.currentUserId);
    }

    canManageCollaborators(caseRow) {
        return canManageCollaborators(this.myCaseRole(caseRow));
    }

    canInviteCollaborators(caseRow) {
        return canInvite(this.myCaseRole(caseRow));
    }

    canEditCaseContent(caseRow) {
        return canEditCase(this.myCaseRole(caseRow));
    }

    isMyAttachment(attachment) {
        return isAttachmentOwner(attachment, this.currentUserId);
    }

    /** Any case member (including read_only) may comment. */
    canCommentOnCase(caseRow) {
        return Boolean(this.myCaseRole(caseRow));
    }

    casePeopleCount(caseRow) {
        return this.buildPeopleMembers(caseRow).length;
    }

    buildPeopleMembers(caseRow) {
        const members = [];
        const ownerId = caseRow?.createdBy?.id ? String(caseRow.createdBy.id) : null;
        if (caseRow?.createdBy) {
            members.push({
                id: caseRow.createdBy.id,
                email: caseRow.createdBy.email || '',
                username: caseRow.createdBy.username || '',
                firstName: caseRow.createdBy.firstName || '',
                lastName: caseRow.createdBy.lastName || '',
                avatarUrl: caseRow.createdBy.avatarUrl || null,
                role: 'admin',
                locked: true
            });
        }
        for (const entry of caseRow?.collaborators || []) {
            if (!entry?.id) continue;
            if (ownerId && String(entry.id) === ownerId) continue;
            members.push({
                id: entry.id,
                email: entry.email || '',
                username: entry.username || '',
                firstName: entry.firstName || '',
                lastName: entry.lastName || '',
                avatarUrl: entry.avatarUrl || null,
                role: entry.role || 'collaborator',
                locked: false
            });
        }
        return members;
    }

    async openPeopleDialog(caseRow) {
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (!dialog) return;

        const canInvite = this.canInviteCollaborators(caseRow);
        const canManage = this.canManageCollaborators(caseRow);
        dialog.canInvite = canInvite;
        dialog.canManage = canManage;
        dialog.roleOptions = canManage ? null : CASE_INVITE_ROLE_OPTIONS;
        dialog.lookupFn = lookupUserByEmail;
        dialog.inviteFn = ({ email, role }) => inviteUser(caseRow.id, { email, role });
        dialog.currentUserId = this.currentUserId || '';
        dialog.saving = this.savingCollaborators;
        dialog.error = '';
        let pendingInvites = [];
        try {
            pendingInvites = await listInvites(caseRow.id);
        } catch {
            pendingInvites = [];
        }
        await dialog.open(this.buildPeopleMembers(caseRow), { pendingInvites });
        this.pendingInviteCount = pendingInvites.filter((inv) => inv && inv.status !== 'expired').length;
    }

    closePeopleDialog() {
        this.renderRoot?.querySelector('#case-people-dialog')?.close?.();
    }

    async handlePeopleInvited(event) {
        const caseRow = this.selectedCase;
        const detail = event.detail || {};
        if (!caseRow?.id) return;
        if (detail.status === 'added' && Array.isArray(detail.collaborators)) {
            this.cases = this.cases.map((row) => (
                row.id === caseRow.id ? { ...row, collaborators: detail.collaborators } : row
            ));
        }
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (dialog && detail.inviteUrl) {
            dialog.lastInviteUrl = detail.inviteUrl;
        }
        if (dialog && caseRow) {
            let pendingInvites = [];
            try {
                pendingInvites = await listInvites(caseRow.id);
            } catch {
                pendingInvites = [];
            }
            const next = this.cases.find((r) => r.id === caseRow.id) || caseRow;
            dialog.members = dialog.sortMembers(this.buildPeopleMembers(next));
            dialog.pendingInvites = pendingInvites;
            this.pendingInviteCount = pendingInvites.filter((inv) => inv && inv.status !== 'expired').length;
        }
        invalidateNotifications();
    }

    async handlePeopleApproveInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        const kind = event.detail?.kind;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;
        try {
            const data = await approveInvite(caseRow.id, inviteId, { kind });
            if (Array.isArray(data.collaborators)) {
                this.cases = this.cases.map((row) => (
                    row.id === caseRow.id ? { ...row, collaborators: data.collaborators } : row
                ));
            }
            await this.handlePeopleInvited({
                detail: {
                    status: data.status || 'approved',
                    inviteUrl: data.inviteUrl || null,
                    collaborators: data.collaborators
                }
            });
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog && data.inviteUrl) {
                dialog.lookupMessage = (data.emailSent && isInviteEmailEnabled())
                    ? t('people.inviteApprovedEmailed')
                    : t('people.inviteApprovedCopyLink');
            }
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, "Couldn't approve that invite.");
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleRejectInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        const kind = event.detail?.kind;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;
        try {
            await rejectInvite(caseRow.id, inviteId, { kind });
            await this.handlePeopleInvited({ detail: { status: 'rejected' } });
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, "Couldn't reject that invite.");
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleSave(event) {
        const caseRow = this.selectedCase;
        if (!caseRow?.id || this.savingCollaborators) return;
        if (!this.canManageCollaborators(caseRow)) return;

        const members = Array.isArray(event.detail?.members) ? event.detail.members : [];
        const collaborators = members
            .map((entry) => ({
                userId: entry?.userId,
                role: entry?.role || 'collaborator'
            }))
            .filter((entry) => entry.userId);

        this.savingCollaborators = true;
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (dialog) {
            dialog.saving = true;
            dialog.error = '';
        }
        try {
            const data = await updateCollaborators(caseRow.id, collaborators);
            const next = Array.isArray(data.collaborators) ? data.collaborators : [];
            this.cases = this.cases.map((row) => (
                row.id === caseRow.id ? { ...row, collaborators: next } : row
            ));
            this.closePeopleDialog();
        } catch (err) {
            if (dialog) {
                dialog.error = this.userFacingError(err, "Couldn't update people. Please try again.");
            }
        } finally {
            this.savingCollaborators = false;
            if (dialog) dialog.saving = false;
        }
    }

    async handlePostComment(event, caseRow) {
        const text = String(event.detail?.text || '').trim();
        if (!caseRow?.id || !text || this.postingComment) return;
        if (!this.canCommentOnCase(caseRow)) return;

        // currentTarget is only set during sync dispatch; keep it across await.
        const panel = event.currentTarget;

        this.postingComment = true;
        this.errorMessage = '';
        try {
            const data = await postComment(caseRow.id, text);
            const created = data.comment;
            panel?.clearDraft?.();
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                const comments = Array.isArray(row.comments) ? [...row.comments] : [];
                if (created?.id) comments.push(created);
                return { ...row, comments };
            });
            const updated = this.cases.find((row) => row.id === caseRow.id);
            if (updated) this.markCaseCommentsSeen(updated);
        } catch (err) {
            this.errorMessage = this.userFacingError(err, "Couldn't send your comment. Please try again.");
        } finally {
            this.postingComment = false;
        }
    }

    // ── New Case form ──────────────────────────────────────────────────────
    openNewCaseForm() {
        this.showNewCaseForm = true;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.newCaseError = '';
        // Focus the title input after render
        this.updateComplete.then(() => {
            this.shadowRoot?.querySelector('#new-case-title')?.focus();
        });
    }

    handleCancelNewCase() {
        this.showNewCaseForm = false;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.newCaseError = '';
        this.creatingCase = false;
    }

    async handleNewCaseSubmit(e) {
        e.preventDefault();
        if (this.creatingCase) return;

        const title = this.newCaseTitle.trim();
        if (!title) {
            this.newCaseError = t('cases.titleRequired');
            return;
        }

        this.creatingCase = true;
        this.newCaseError = '';
        try {
            const data = await createCase({
                title,
                description: this.newCaseDescription.trim() || undefined,
                status: 'active'
            });
            const created = data.case;
            // Prepend to list and open immediately
            this.cases = [created, ...this.cases];
            this.handleCancelNewCase();
            this.openCase(created.id);
        } catch (err) {
            this.newCaseError = this.userFacingError(err, "Couldn't create the case. Please try again.");
        } finally {
            this.creatingCase = false;
        }
    }

    mergeCaseUpdate(caseRow, updated = {}) {
        // updateCase remaps with empty nested collections — keep local arrays.
        const next = { ...caseRow, ...updated };
        next.attachments = Array.isArray(caseRow.attachments) ? caseRow.attachments : [];
        next.comments = Array.isArray(caseRow.comments) ? caseRow.comments : [];
        next.collaborators = Array.isArray(updated.collaborators)
            ? updated.collaborators
            : (Array.isArray(caseRow.collaborators) ? caseRow.collaborators : []);
        return next;
    }

    async handleArchiveCase(caseRow) {
        if (!caseRow?.id || this.archivingCase) return;
        if (!this.canManageCollaborators(caseRow)) return;
        this.archivingCase = true;
        this.errorMessage = '';
        try {
            const data = await updateCase(caseRow.id, { status: 'archived' });
            const updated = data.case;
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id ? this.mergeCaseUpdate(row, updated) : row
            );
            this.cancelEditCase();
        } catch (err) {
            this.errorMessage = this.userFacingError(err, "Couldn't archive this case. Please try again.");
        } finally {
            this.archivingCase = false;
        }
    }

    // ── Inline case edit ───────────────────────────────────────────────────
    startEditCase(caseRow) {
        if (!this.canEditCaseContent(caseRow)) return;
        this.editingCase = true;
        this.editCaseTitle = caseRow.title || '';
        this.editCaseDesc = caseRow.description || '';
        this.caseEditError = '';
        this.updateComplete.then(() => {
            this.shadowRoot?.querySelector('#edit-case-title')?.focus();
        });
    }

    cancelEditCase() {
        this.editingCase = false;
        this.editCaseTitle = '';
        this.editCaseDesc = '';
        this.caseEditError = '';
        this.savingCaseEdit = false;
    }

    async saveEditCase(caseRow) {
        if (this.savingCaseEdit) return;
        if (!this.canEditCaseContent(caseRow)) return;
        const title = this.editCaseTitle.trim();
        if (!title) { this.caseEditError = t('cases.titleRequired'); return; }

        this.savingCaseEdit = true;
        this.caseEditError = '';
        try {
            const data = await updateCase(caseRow.id, {
                title,
                description: this.editCaseDesc.trim() || null
            });
            const updated = data.case;
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id ? this.mergeCaseUpdate(row, updated) : row
            );
            this.cancelEditCase();
        } catch (err) {
            this.caseEditError = this.userFacingError(err, "Couldn't save your changes. Please try again.");
        } finally {
            this.savingCaseEdit = false;
        }
    }

    // ── Attachment download ────────────────────────────────────────────────
    async handleDownloadAttachment(caseRow, attachment) {
        if (!attachment?.id || this.downloadingAttachmentIds.has(attachment.id)) return;
        if (!this.canEditCaseContent(caseRow)) return;

        const name = attachmentFileName(attachment);
        this.setDownloading(attachment.id, true);
        this.downloadStatusText = t('cases.downloadStarting', { name });
        this.uploadError = '';
        try {
            // A quick access check (it does not wait for the file), so a refusal is a message and not a
            // saved error page. Then the browser takes over and shows the download's progress itself.
            await checkAttachmentDownload(caseRow.id, attachment.id);
            if (!this.isConnected) return; // user left the page during the check
            const link = document.createElement('a');
            link.href = getAttachmentDownloadUrl(caseRow.id, attachment.id);
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            this.downloadStatusText = t('cases.downloadStarted', { name });
        } catch (err) {
            this.downloadStatusText = '';
            this.uploadError = this.userFacingError(err, t('cases.downloadFailed'));
        } finally {
            this.setDownloading(attachment.id, false);
        }
    }

    /** Track which rows have a download starting: only that row's button is busy, everything else stays usable. */
    setDownloading(attachmentId, on) {
        const next = new Set(this.downloadingAttachmentIds);
        if (on) next.add(attachmentId);
        else next.delete(attachmentId);
        this.downloadingAttachmentIds = next;
    }

    // ── Attachment delete ──────────────────────────────────────────────────
    async handleDeleteAttachment(caseRow, attachment) {
        if (!attachment?.id || this.deletingAttachmentId) return;
        if (!this.isMyAttachment(attachment) && this.myCaseRole(caseRow) !== 'admin') return;
        if (!confirm(t('cases.confirmDeleteAttachment', { name: attachment.name || attachment.filenameDownload }))) return;

        this.deletingAttachmentId = attachment.id;
        this.uploadError = '';
        try {
            await deleteAttachment(caseRow.id, attachment.id);
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                return {
                    ...row,
                    attachments: (row.attachments || []).filter((a) => a.id !== attachment.id)
                };
            });
        } catch (err) {
            this.uploadError = this.userFacingError(err, "Couldn't remove that file. Please try again.");
        } finally {
            this.deletingAttachmentId = '';
        }
    }

    // ── File upload ────────────────────────────────────────────────────────
    triggerFileUpload() {
        this.shadowRoot?.querySelector('#attach-file-input')?.click();
    }

    async handleFileSelected(event, caseRow) {
        const file = event.target?.files?.[0];
        // Reset input so the same file can be re-selected if needed
        if (event.target) event.target.value = '';
        if (file) await this.uploadFiles(caseRow, [file]);
    }

    /**
     * Hand files to the background upload manager. Uploading continues if the user navigates away;
     * progress and per-file controls live in the Uploads panel, and the attachment appears on the
     * case when each file finishes.
     */
    uploadFiles(caseRow, files) {
        if (!files.length || !caseRow?.id) return;
        if (!this.canEditCaseContent(caseRow)) return;
        this.uploadError = '';
        uploadManager.enqueue({ caseId: caseRow.id, caseTitle: caseRow.title || '', files });
    }

    /** Keyboard focus follows the viewer overlay: into it when it opens, back to where the user was when it closes. */
    syncViewerFocus() {
        if (this.showIframe) {
            this.shadowRoot?.querySelector('.iframe-header .primary-button')?.focus();
            return;
        }
        const previous = this._focusBeforeViewer;
        this._focusBeforeViewer = null;
        // Wait a frame: nested components (the "Open with" button re-enables) finish updating a tick
        // after this page does, and a disabled control cannot take focus.
        requestAnimationFrame(() => {
            if (previous?.isConnected) previous.focus();
        });
    }

    /** Mirror the manager's state for the selected case into the inline progress row. */
    syncUploadState() {
        const summary = uploadManager.summary(this.selectedCaseId);
        this.uploadingFile = summary.count > 0;
        this.uploadProgress = summary.progress;
        if (summary.count === 0) {
            this.uploadStatusText = '';
        } else if (summary.awaitingDetails && summary.progress >= 1) {
            this.uploadStatusText = t('cases.uploadNeedsDetails');
        } else if (summary.count === 1) {
            this.uploadStatusText = t('cases.uploadingFile', { name: summary.names[0] });
        } else {
            this.uploadStatusText = t('cases.uploadingNFiles', { count: summary.count });
        }
    }

    /** A background upload finished: show the new attachment without reloading the list. */
    handleAttachmentUploaded({ caseId, attachment }) {
        if (!attachment?.id) return;
        this.cases = this.cases.map((row) => {
            if (row.id !== caseId) return row;
            const others = (row.attachments || []).filter((a) => a.id !== attachment.id);
            return { ...row, attachments: [...others, attachment] };
        });
    }

    // ── Drag-and-drop attach ───────────────────────────────────────────────
    isFileDrag(event) {
        return Array.from(event.dataTransfer?.types || []).includes('Files');
    }

    canDropAttachments(caseRow) {
        return this.canEditCaseContent(caseRow) && !this.openingAttachmentId;
    }

    handleAttachmentDragEnter(event, caseRow) {
        if (!this.isFileDrag(event)) return;
        event.preventDefault();
        this._attachmentDragDepth += 1;
        if (this.canDropAttachments(caseRow)) this.attachmentDragOver = true;
    }

    handleAttachmentDragOver(event, caseRow) {
        if (!this.isFileDrag(event)) return;
        // Always claim file drags so the browser doesn't navigate to a dropped file.
        event.preventDefault();
        const allowed = this.canDropAttachments(caseRow);
        event.dataTransfer.dropEffect = allowed ? 'copy' : 'none';
        this.attachmentDragOver = allowed;
    }

    handleAttachmentDragLeave(event) {
        if (!this.isFileDrag(event)) return;
        this._attachmentDragDepth = Math.max(0, this._attachmentDragDepth - 1);
        if (this._attachmentDragDepth === 0) this.attachmentDragOver = false;
    }

    handleAttachmentDrop(event, caseRow) {
        if (!this.isFileDrag(event)) return;
        event.preventDefault();
        this._attachmentDragDepth = 0;
        this.attachmentDragOver = false;
        if (!this.canDropAttachments(caseRow)) return;

        // Folders arrive as zero-byte "files"; skip them (entries must be read synchronously).
        const items = Array.from(event.dataTransfer.items || []).filter((item) => item.kind === 'file');
        const dropped = Array.from(event.dataTransfer.files || []);
        const files = dropped.filter((_, i) => !items[i]?.webkitGetAsEntry?.()?.isDirectory);
        if (files.length === 0) {
            if (dropped.length > 0) this.uploadError = t('cases.foldersNotSupported');
            return;
        }
        this.uploadFiles(caseRow, files);
    }

    startHeartbeat() {
        this.stopHeartbeat();
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
        });
        const ping = () => {
            sendViewerHeartbeat({
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                heartbeatUrl,
                includeUserActive: false,
                onIdleTimeout: () => this._handleViewerIdleTimeout()
            }).catch(() => {});
        };
        ping();
        this._heartbeatInterval = setInterval(ping, 20000);
    }

    stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    // Internal: cleans up UI + sends stop request. Does NOT touch history.
    async _doCloseViewer() {
        this.stopHeartbeat();
        resetViewerActivity();
        const token = this._viewerSessionToken;
        const seatId = this._viewerSeatId;
        this.clearViewerUiState();

        if (!token) return;
        await this._releaseViewerSession(token, seatId);
    }

    _releaseViewerSession(sessionToken, seatId) {
        const { stopUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
        });
        return stopViewerSession({
            stopUrl,
            sessionToken,
            body: buildViewerStopBody({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionToken,
                seatId,
                mode: VIEWER_RELEASE_MODES.SOFT
            })
        });
    }

    // Public: called by the Close button. Full Slicer uses history.back() so the browser back button
    // and the button are indistinguishable to the user; SlicerWeb closes directly (see below).
    async closeViewer() {
        if (
            (this.viewerKind === VIEWER_KINDS.SLICER_GUI || this.viewerKind === VIEWER_KINDS.SLICERWEB)
            && this.hasUnsavedChanges
            && !this._backgroundSave
            && this.iframeUrl && this.iframeUrl !== 'about:blank'
        ) {
            const choice = await this.promptCloseChoice('unsaved');
            if (choice === 'save') {
                const saved = await this.saveCurrentScene('overwrite');
                if (!saved) {
                    const failedChoice = await this.promptCloseChoice('save-failed');
                    if (failedChoice !== 'close-anyway') return;
                }
            }
            // 'discard' falls through to close
        }
        if (this.viewerKind === VIEWER_KINDS.SLICERWEB) {
            // SlicerWeb's own frame navigation adds shared history entries, so history.back()
            // may only step the iframe. Close directly and fix the URL in place.
            this._viewerPushedState = false;
            this._replaceUrlWithCase();
            // Tearing down the same-origin SlicerWeb frame (WASM heap, workers) blocks the shared
            // main thread, so hide the overlay and let it paint before removing the iframe.
            this._slicerWebPending = null;
            this.viewerClosing = true;
            const openId = this._viewerOpenId;
            requestAnimationFrame(() => setTimeout(() => {
                if (openId === this._viewerOpenId) this._doCloseViewer();
            }, 0));
        } else if (this._viewerPushedState) {
            this._viewerPushedState = false;
            history.back(); // popstate fires → _handlePopState → _doCloseViewer
        } else {
            this._doCloseViewer();
        }
    }

    // Called by the heartbeat idle timeout: clean up + fix URL in place (no back step).
    async _handleViewerIdleTimeout() {
        this._viewerPushedState = false;
        await this._doCloseViewer();
        this._replaceUrlWithCase();
    }

    attachmentMetaLine(attachment) {
        const originalName = attachment.filenameDownload || '';
        const size = formatBytes(attachment.filesize);
        const modified = formatDateTime(attachment.modifiedAt);
        return [originalName, size, modified].filter(Boolean).join(' - ');
    }

    attachmentTitle(attachment) {
        return String(attachment?.name || attachment?.filenameDownload || 'Attachment');
    }

    filterAttachments(attachments = [], query = this.attachmentSearchQuery) {
        const needle = String(query || '').trim().toLowerCase();
        const list = Array.isArray(attachments) ? attachments : [];
        if (!needle) return [...list];
        return list.filter((row) => {
            const title = this.attachmentTitle(row).toLowerCase();
            const original = String(row?.filenameDownload || '').toLowerCase();
            return title.includes(needle) || original.includes(needle);
        });
    }

    sortAttachments(attachments = [], order = this.attachmentSortOrder) {
        const list = Array.isArray(attachments) ? [...attachments] : [];
        const titleOf = (row) => this.attachmentTitle(row).toLowerCase();
        const timeOf = (row) => {
            const value = Date.parse(row?.modifiedAt || '');
            return Number.isFinite(value) ? value : null;
        };

        if (order === 'title') {
            return list.sort((a, b) => {
                const byTitle = titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
                return byTitle || String(a.id || '').localeCompare(String(b.id || ''));
            });
        }

        const newestFirst = order !== 'oldest';
        return list.sort((a, b) => {
            const timeA = timeOf(a);
            const timeB = timeOf(b);
            if (timeA == null && timeB == null) {
                return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
            }
            if (timeA == null) return 1;
            if (timeB == null) return -1;
            const diff = newestFirst ? timeB - timeA : timeA - timeB;
            return diff || titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
        });
    }

    caseTitle(caseRow) {
        return String(caseRow?.title || t('cases.untitled'));
    }

    filterCases(cases = [], query = this.caseSearchQuery) {
        const needle = String(query || '').trim().toLowerCase();
        const list = Array.isArray(cases) ? cases : [];
        if (!needle) return [...list];
        return list.filter((row) => {
            const title = this.caseTitle(row).toLowerCase();
            const description = String(row?.description || '').toLowerCase();
            return title.includes(needle) || description.includes(needle);
        });
    }

    sortCases(cases = [], order = this.caseSortOrder) {
        const list = Array.isArray(cases) ? [...cases] : [];
        const titleOf = (row) => this.caseTitle(row).toLowerCase();
        const timeOf = (row) => {
            const value = Date.parse(this.caseLastModifiedAt(row) || '');
            return Number.isFinite(value) ? value : null;
        };

        if (order === 'title') {
            return list.sort((a, b) => {
                const byTitle = titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
                return byTitle || String(a.id || '').localeCompare(String(b.id || ''));
            });
        }

        const newestFirst = order !== 'oldest';
        return list.sort((a, b) => {
            const timeA = timeOf(a);
            const timeB = timeOf(b);
            if (timeA == null && timeB == null) {
                return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
            }
            if (timeA == null) return 1;
            if (timeB == null) return -1;
            const diff = newestFirst ? timeB - timeA : timeA - timeB;
            return diff || titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
        });
    }

    closeListFilterMenus() {
        this.renderRoot?.querySelectorAll('list-filter-tools').forEach((el) => {
            el.closeMenus?.();
        });
    }

    handleAttachmentSearchChange(event) {
        this.attachmentSearchQuery = String(event.detail?.query || '');
    }

    handleAttachmentSortChange(event) {
        const order = String(event.detail?.order || '');
        if (!LIST_SORT_OPTIONS.some((opt) => opt.value === order)) return;
        this.attachmentSortOrder = order;
    }

    handleCaseSearchChange(event) {
        this.caseSearchQuery = String(event.detail?.query || '');
    }

    handleCaseSortChange(event) {
        const order = String(event.detail?.order || '');
        if (!LIST_SORT_OPTIONS.some((opt) => opt.value === order)) return;
        this.caseSortOrder = order;
    }

    attachmentOpenTitle(attachment) {
        if (attachment?.canOpenInSlicer) {
            const dv = this.accountDefaultViewer();
            const label = dv === 'web'
                ? viewerDisplayName(VIEWER_KINDS.SLICERWEB)
                : viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified: dv === 'simplified' });
            return t('cases.openInDefault', { viewer: label });
        }
        if (attachment?.canPreviewInBrowser) return t('cases.browserPreviewSoon');
        return t('cases.fileTypeUnsupported');
    }

    attachmentCanActivate(attachment) {
        return Boolean(attachment?.canOpenInSlicer || attachment?.canPreviewInBrowser);
    }

    accountDefaultViewer() {
        const { useFullSlicer, useSimplifiedViewer } = getCachedLocalSlicerViewerOptions();
        if (useFullSlicer && useSimplifiedViewer) return 'simplified';
        if (useFullSlicer) return 'full';
        return 'web';
    }

    clearViewerUiState() {
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerClosing = false;
        this.currentFileName = '';
        this.currentAttachmentId = '';
        this.hasUnsavedChanges = false;
        this.isSavingScene = false;
        this._lastSavedAttachmentId = null;
        this.saveIndicatorMessage = '';
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        if (this.saveIndicatorActivityCleanup) {
            this.saveIndicatorActivityCleanup();
            this.saveIndicatorActivityCleanup = null;
        }
        if (this.iframeActivityCleanup) {
            this.iframeActivityCleanup();
            this.iframeActivityCleanup = null;
        }
        this._slicerWebRun += 1; // cancels any in-flight SlicerWeb load
        this._viewerOpenId += 1; // orphans any in-flight open request
        this._slicerWebPending = null;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.openingAttachmentId = '';
    }

    async handleOpenAttachment(caseRow, attachment, { simplified } = {}) {
        if (this.openingAttachmentId) return;

        if (attachment?.canPreviewInBrowser && !attachment?.canOpenInSlicer) {
            this.errorMessage = t('cases.browserPreviewNote');
            return;
        }
        if (!attachment?.canOpenInSlicer) return;

        const useSimplified = resolveSimplifiedViewerChoice(
            simplified,
            this.accountPrefersSimplifiedViewer()
        );
        const viewerLabel = viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified: useSimplified });

        this._focusBeforeViewer = deepActiveElement();
        // Closing the viewer while this request is in flight bumps _viewerOpenId; a superseded
        // request must not touch the UI, and must release the seat it started.
        const openId = ++this._viewerOpenId;
        const isSuperseded = () => openId !== this._viewerOpenId;

        this.openingAttachmentId = attachment.id;
        this.errorMessage = '';
        this.currentFileName = attachmentFileName(attachment);
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerSimplified = useSimplified;
        this.viewerLoading = true;
        this.viewerLoadingDetail = attachment.filesize && attachment.filesize > 50 * 1024 * 1024
            ? t('cases.preparingFileLarge', { name: this.currentFileName, mb: Math.round(attachment.filesize / (1024 * 1024)) })
            : t('cases.preparingFile', { name: this.currentFileName });
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            this.stopHeartbeat();
            const data = await openAttachmentInViewer(caseRow.id, attachment.id, {
                useSimplifiedViewer: useSimplified
            });
            if (isSuperseded()) {
                if (data.sessionToken) {
                    this._releaseViewerSession(
                        data.sessionToken,
                        data.seatId != null ? Number(data.seatId) : null
                    ).catch(() => {});
                }
                return;
            }

            this._viewerSessionToken = data.sessionToken || null;
            this._viewerSeatId = data.seatId != null ? Number(data.seatId) : null;
            this.currentFileName = data.fileName || this.currentFileName;
            this.viewerSimplified = data.useSimplifiedViewer === true || useSimplified;

            this.iframeUrl = buildSlicerGuiLoaderUrl({
                fileId: data.stagedKey || attachment.fileId,
                fileName: this.currentFileName,
                vncPath: data.vncPath || data.slicerGuiUrl || '',
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS,
                simplified: this.viewerSimplified,
                embed: true,
                quick: false
            });
            markViewerActivity();
            this.startHeartbeat();
            this.viewerLoading = true;
            this.viewerLoadingDetail = t('cases.openingViewerReady', { viewer: viewerLabel });
            this.currentAttachmentId = attachment.id;
            this.hasUnsavedChanges = false;
            this.openingAttachmentId = '';

            this._pushViewerHistory(caseRow.id);
        } catch (err) {
            if (isSuperseded()) return;
            this.clearViewerUiState();
            this.errorMessage = this.userFacingError(err, "Couldn't open the viewer. Please try again.");
        }
    }

    /** "Open with" choice: 'full' | 'simplified' (Full Slicer) or 'web' (in-browser SlicerWeb). */
    handleOpenViewer(caseRow, attachment, viewer) {
        if (viewer === 'web') return this.handleOpenSlicerWeb(caseRow, attachment);
        return this.handleOpenAttachment(caseRow, attachment, { simplified: viewer === 'simplified' });
    }

    async handleOpenSlicerWeb(caseRow, attachment) {
        if (this.openingAttachmentId || !attachment?.canOpenInSlicer) return;

        this._viewerOpenId += 1;
        this._focusBeforeViewer = deepActiveElement();
        this.errorMessage = '';
        this.currentFileName = attachmentFileName(attachment);
        this.currentAttachmentId = attachment.id;
        this.viewerKind = VIEWER_KINDS.SLICERWEB;
        this.viewerSimplified = false;
        this.viewerLoading = true;
        this.showIframe = true;
        this.currentAttachmentId = attachment.id;
        this.selectedCaseId = caseRow.id;

        const channel = (isSlicerWebDevModeEnabled() && getCachedUserPreferences().slicerWebChannel === 'latest')
            ? 'latest' : 'stable';

        // For the latest channel: open immediately with whatever is installed.
        // A background download may already be in progress (started on page load).
        // When it finishes, a toast notifies the user so they can reopen for the new version.

        this.viewerLoadingDetail = t('cases.openingSlicerWeb');
        this.showIframe = true;
        this._slicerWebRun += 1;
        // Download while the runtime starts; both are awaited in loadPendingIntoSlicerWeb.
        const download = fetchAttachmentContent(caseRow.id, attachment.id);
        download.catch(() => {}); // surfaced when awaited
        this._slicerWebPending = { download, fileName: this.currentFileName };

        // Fetch installed SHA to include as ?v= in the iframe URL, which breaks any
        // stale service-worker cache when a new build lands.
        const statusData = await fetch('/api/slicerweb/status', { credentials: 'include' })
            .then((r) => r.ok ? r.json() : null)
            .catch(() => null);
        const sha = statusData?.[channel] ?? null;
        this.iframeUrl = buildSlicerWebUrl({ channel, sha });

        this._pushViewerHistory(caseRow.id);
    }

    /**
     * Wait for the same-origin SlicerWeb bridge, then hand it the downloaded file.
     * SlicerWeb may reload its own frame once mid-start, so each frame load restarts this.
     */
    async loadPendingIntoSlicerWeb(frame) {
        const pending = this._slicerWebPending;
        if (!pending) return;
        const run = ++this._slicerWebRun;
        const cancelled = () => run !== this._slicerWebRun || !this.showIframe;
        const readyBridge = () => {
            try {
                const bridge = frame.contentWindow?.slicerWeb;
                return bridge?.store?.status === 'ready' ? bridge : null;
            } catch (_) {
                return null; // cross-origin: cannot reach the bridge
            }
        };

        try {
            const deadline = Date.now() + 5 * 60 * 1000;
            let slicer = readyBridge();
            while (!slicer) {
                if (cancelled()) return;
                if (Date.now() > deadline) throw new Error(t('cases.slicerWebStartFailed'));
                await new Promise((resolve) => setTimeout(resolve, 200));
                slicer = readyBridge();
            }

            this.viewerLoadingDetail = t('cases.loadingIntoSlicerWeb', { name: pending.fileName });
            const blob = await pending.download;
            if (cancelled()) return;
            // Wait for any session-restore scene load to complete before clearing.
            // The bridge reports ready before the restore finishes, so we use a two-phase
            // poll: first wait for nodes to appear (restore started), then wait for the
            // count to stabilize (restore done). Skips waiting entirely if no restore runs.
            // Phase 1: wait for restore to start producing nodes (max 15s)
            let hasRestore = false;
            for (let i = 0; i < 30; i++) {
                await new Promise((r) => setTimeout(r, 500));
                if (cancelled()) return;
                try {
                    const nodes = await slicer.bridge.call('getNodes', [{}]);
                    if (Array.isArray(nodes) && nodes.length > 0) { hasRestore = true; break; }
                } catch (_) { break; }
            }
            // Phase 2: wait for node count to stabilize (restore fully loaded)
            if (hasRestore) {
                let prevCount = -1;
                for (let i = 0; i < 60; i++) {
                    await new Promise((r) => setTimeout(r, 500));
                    if (cancelled()) return;
                    try {
                        const nodes = await slicer.bridge.call('getNodes', [{}]);
                        const count = Array.isArray(nodes) ? nodes.length : 0;
                        if (count === prevCount) break;
                        prevCount = count;
                    } catch (_) { break; }
                }
            }
            await slicer.bridge.call('closeScene', []);
            const [path] = await slicer.writeFiles([new File([blob], pending.fileName)]);

            let loadError;
            for (let attempt = 0, delay = 500; attempt < 5; attempt++, delay *= 2) {
                if (cancelled()) return;
                try {
                    await slicer.bridge.call('loadFiles', [[path]]);
                    loadError = null;
                    break;
                } catch (err) {
                    loadError = err;
                    if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, delay));
                }
            }
            if (loadError) throw loadError;
            if (cancelled()) return;
            // Fit all views to the loaded data. loadFiles with a .mrb restores the saved
            // camera state, which may not match the data extent — reset to center it.
            await new Promise((r) => setTimeout(r, 1000));
            if (!cancelled()) {
                try {
                    await slicer.bridge.call('resetViews', []);
                } catch (e) {
                    console.warn('[SlicerWeb] resetViews failed:', e);
                    try { await slicer.bridge.call('fitSlicesToBackground', []); } catch (e2) {
                        console.warn('[SlicerWeb] fitSlicesToBackground failed:', e2);
                    }
                }
            }
            this._slicerWebPending = null;
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.hasUnsavedChanges = true;
            this._attachSlicerWebSaveHandler(slicer);
        } catch (err) {
            if (cancelled()) return;
            const message = this.userFacingError(err, t('errors.openViewerFailed'));
            this._viewerPushedState = false;
            await this._doCloseViewer();
            this._replaceUrlWithCase();
            this.errorMessage = message;
        }
    }

    handleViewerIframeLoad(event) {
        if (this.viewerKind === VIEWER_KINDS.SLICERWEB) {
            // SlicerWeb shows a confirm() on startup ("restore session?"). We suppress it by
            // overriding window.confirm to return false — same net effect as blocking allow-modals,
            // but explicit. Returning false causes forgetSession() + sample data load; our
            // two-phase poll in loadPendingIntoSlicerWeb waits for that to settle, then loads
            // the real file.
            try {
                const cw = event?.target?.contentWindow;
                if (cw) cw.confirm = () => false;
            } catch (_) {}
            this.loadPendingIntoSlicerWeb(event?.target);
            return;
        }
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        markViewerActivity();
        this.attachIframeActivityTracking();
    }

    attachIframeActivityTracking() {
        if (this.iframeActivityCleanup) {
            this.iframeActivityCleanup();
            this.iframeActivityCleanup = null;
        }
        try {
            const iframe = this.renderRoot?.querySelector('.viewer-iframe');
            const iframeDoc = iframe?.contentWindow?.document;
            if (!iframeDoc) return;
            const markDirty = () => {
                this.hasUnsavedChanges = true;
                markViewerActivity();
            };
            const events = ['pointerdown', 'keydown', 'input', 'change', 'wheel'];
            events.forEach((ev) => iframeDoc.addEventListener(ev, markDirty, true));
            this.iframeActivityCleanup = () => {
                events.forEach((ev) => iframeDoc.removeEventListener(ev, markDirty, true));
            };
        } catch (_) {
            // Cross-origin iframes will throw; best-effort only.
        }
    }

    async _loadAuditLog(caseId, { append = false } = {}) {
        if (this._auditLoading) return;
        const offset = append ? this._auditOffset : 0;
        this._auditLoading = true;
        this._auditError = null;
        try {
            const result = await fetchCaseActivity(caseId, { limit: 50, offset });
            const rows = Array.isArray(result?.activity) ? result.activity : [];
            this._auditRows = append ? [...this._auditRows, ...rows] : rows;
            this._auditOffset = offset + rows.length;
            this._auditHasMore = rows.length === 50;
        } catch (err) {
            this._auditError = this.userFacingError?.(err, t('audit.caseHistory')) ?? err.message;
        } finally {
            this._auditLoading = false;
        }
    }

    _openAuditView(caseId) {
        history.pushState({ caseId, view: 'history' }, '', this._buildAuditUrl(caseId));
        this._auditRows = [];
        this._auditOffset = 0;
        this._loadAuditLog(caseId);
    }

    _closeAuditView() {
        history.pushState({ caseId: this.selectedCaseId }, '', this._buildCaseUrl(this.selectedCaseId));
        this._auditRows = [];
        this._auditOffset = 0;
        this._auditHasMore = false;
        this._auditError = null;
    }

    _attachSlicerWebSaveHandler(slicer) {
        // Override prompt so the built-in Slicer save button doesn't show a filename dialog.
        // SlicerWeb calls prompt() to ask for a filename before invoking saveHandler; returning
        // the current filename here lets the save proceed silently to our handler.
        try {
            const iframe = this.renderRoot?.querySelector('.viewer-iframe');
            if (iframe?.contentWindow) {
                iframe.contentWindow.prompt = () => this.currentFileName || 'scene.mrb';
            }
        } catch (_) {}

        slicer.saveHandler = async (path) => {
if (!this.selectedCaseId || !this.currentAttachmentId || this.isSavingScene) return;
            const caseId = this.selectedCaseId;
            const attachmentId = this.currentAttachmentId;
            this.isSavingScene = true;
            try {
                // readFiles copies bytes into JS memory — once it returns the iframe is no longer needed.
                const [file] = await slicer.readFiles([path]);
                this.isSavingScene = false;
                this._runBackgroundSave(file, { caseId, attachmentId, saveMode: 'overwrite' });
            } catch (err) {
                this.errorMessage = this.userFacingError(err, t('errors.saveSceneFailed'));
            } finally {
                this.isSavingScene = false;
            }
        };
    }

    /** Phase 1: trigger WASM scene serialization and copy bytes into JS. Returns the File. */
    async _writeSlicerWebScene() {
        const iframe = this.renderRoot?.querySelector('.viewer-iframe');
        const slicer = iframe?.contentWindow?.slicerWeb;
        if (!slicer) throw new Error(t('errors.saveSceneFailed'));
        const savePath = '/data/save/scene.mrb';
        // callYielding is required for IO — it yields control until Slicer finishes writing.
        // call() may return before the file is flushed, producing a truncated bundle.
        if (typeof slicer.bridge.callYielding !== 'function') {
            console.warn('[SlicerWeb] callYielding not available; save may be incomplete');
        }
        await (slicer.bridge.callYielding ?? slicer.bridge.call).call(slicer.bridge, 'saveScene', [savePath]);
        const [file] = await slicer.readFiles([savePath]);
        if (!file || file.size < 1024) {
            throw new Error(`saveScene produced an unexpectedly small file (${file?.size ?? 0} bytes) — the scene may not have been written yet`);
        }
        return file;
    }

    /** Phase 2: upload the serialized file in the background. Safe to call after closing the viewer. */
    _runBackgroundSave(file, { caseId, attachmentId, saveMode, name, _attempt = 1 } = {}) {
        // Abort an in-flight overwrite for the same attachment — the newer data supersedes it.
        // SaveAsNew is independent (creates a new attachment) so let both run concurrently.
        const prev = this._backgroundSave;
        if (prev?.abortCtrl && saveMode === 'overwrite' && prev.saveMode === 'overwrite' && prev.attachmentId === attachmentId) {
            prev.abortCtrl.abort();
        }
        const abortCtrl = new AbortController();
        // Keep file + params so the error banner can offer a retry.
        this._backgroundSave = { file, caseId, attachmentId, saveMode, name, error: null, abortCtrl };
        this.hasUnsavedChanges = false;
        saveWithDirectusReconnect(() => saveSlicerWebScene(caseId, attachmentId, file, { saveMode, name, signal: abortCtrl.signal }))
            .then((result) => {
                if (abortCtrl.signal.aborted) return; // superseded — a newer save already owns _backgroundSave
                this._backgroundSave = null;
                if (result?.attachment) {
                    this.cases = this.cases.map((c) => {
                        if (c.id !== caseId) return c;
                        if (!Array.isArray(c.attachments)) return c;
                        const attachments = saveMode === 'saveAsNew'
                            ? [...c.attachments, result.attachment]
                            : c.attachments.map((a) => a.id === attachmentId ? result.attachment : a);
                        return { ...c, attachments };
                    });
                }
                if (saveMode === 'overwrite') this._lastSavedAttachmentId = attachmentId;
                const msg = saveMode === 'saveAsNew' ? t('files.savedAsNew') : t('files.saved');
                if (this.showIframe) {
                    this.showSaveIndicator(msg);
                } else {
                    this.showToast(msg);
                }
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return; // superseded by a newer save — discard silently
                // Session errors mean the user explicitly cancelled reconnect — don't auto-retry,
                // as that would immediately re-open the reconnect dialog.
                const isSessionError = err.code === 'DIRECTUS_SESSION_EXPIRED' || err.code === 'DIRECTUS_SESSION_REQUIRED';
                if (_attempt < 2 && !isSessionError) {
                    setTimeout(() => {
                        if (this._backgroundSave && !this._backgroundSave.error) {
                            this._runBackgroundSave(file, { caseId, attachmentId, saveMode, name, _attempt: _attempt + 1 });
                        }
                    }, 2000);
                    return;
                }
                this._backgroundSave = {
                    ...this._backgroundSave,
                    error: this.userFacingError(err, t('errors.saveSceneFailed'))
                };
            });
    }

    _retryBackgroundSave() {
        if (!this._backgroundSave) return;
        const { file, caseId, attachmentId, saveMode, name } = this._backgroundSave;
        // Reset attempt counter so the manual retry also gets one silent auto-retry.
        this._runBackgroundSave(file, { caseId, attachmentId, saveMode, name, _attempt: 1 });
    }

    async saveCurrentScene(mode = 'overwrite', name) {
        if (!this.selectedCaseId || !this.currentAttachmentId) return false;
        if (this.isSavingScene) return false;
        this.isSavingScene = true;
        try {
            if (this.viewerKind === VIEWER_KINDS.SLICERWEB) {
                // Skip if nothing has changed since the last successful save.
                if (mode === 'overwrite' && !this.hasUnsavedChanges && this._lastSavedAttachmentId === this.currentAttachmentId) {
                    this.isSavingScene = false;
                    this.showSaveIndicator(t('files.saved'));
                    return true;
                }
                // Phase 1: WASM serialization (requires the viewer iframe).
                const caseId = this.selectedCaseId;
                const attachmentId = this.currentAttachmentId;
                const file = await this._writeSlicerWebScene();
                // Phase 2: upload runs in the background; viewer is unblocked immediately.
                this.isSavingScene = false;
                this._runBackgroundSave(file, { caseId, attachmentId, saveMode: mode, name });
                return true;
            }

            // SLICER_GUI: flush pending UI edits before saving via trame.
            try {
                const iframe = this.renderRoot?.querySelector('.viewer-iframe');
                iframe?.contentWindow?.focus?.();
                const active = iframe?.contentWindow?.document?.activeElement;
                if (active && typeof active.blur === 'function') active.blur();
            } catch (_) { /* cross-origin, best effort */ }
            await new Promise((r) => setTimeout(r, 350));
            const result = await saveWithDirectusReconnect(() =>
                saveAttachmentScene(
                    this.selectedCaseId,
                    this.currentAttachmentId,
                    { saveMode: mode }
                )
            );

            if (result?.attachment) {
                this.cases = this.cases.map((c) => {
                    if (c.id !== this.selectedCaseId) return c;
                    if (!Array.isArray(c.attachments)) return c;
                    const attachments = mode === 'saveAsNew'
                        ? [...c.attachments, result.attachment]
                        : c.attachments.map((a) => a.id === this.currentAttachmentId ? result.attachment : a);
                    return { ...c, attachments };
                });
            }

            this.hasUnsavedChanges = false;
            this.showSaveIndicator(mode === 'saveAsNew' ? t('files.savedAsNew') : t('files.saved'));
            return true;
        } catch (err) {
            this.errorMessage = this.userFacingError(err, t('errors.saveSceneFailed'));
            return false;
        } finally {
            this.isSavingScene = false;
        }
    }

    async saveCurrentSceneAsNew() {
        const defaultName = this.currentFileName
            ? this.currentFileName.replace(/\.[^.]+$/, '')
            : '';
        const name = await this.promptSaveAsNewName(defaultName);
        if (name === null) return;
        return this.saveCurrentScene('saveAsNew', name);
    }

    promptSaveAsNewName(defaultName = '') {
        this._saveAsNewName = defaultName;
        this._saveAsNewResolver = null;
        const dialog = this.renderRoot?.querySelector('#save-as-new-dialog');
        dialog?.openDialog();
        // Focus and select the input after the dialog is visible.
        requestAnimationFrame(() => {
            const input = dialog?.querySelector('#save-as-new-name');
            if (input) { input.focus(); input.select(); }
        });
        return new Promise((resolve) => {
            this._saveAsNewResolver = resolve;
        });
    }

    finishSaveAsNew(confirmed) {
        const name = confirmed ? (this._saveAsNewName || '').trim() : null;
        this.renderRoot?.querySelector('#save-as-new-dialog')?.closeDialog();
        const resolver = this._saveAsNewResolver;
        this._saveAsNewResolver = null;
        if (resolver) resolver(name);
    }

    showSaveIndicator(message) {
        this.saveIndicatorMessage = message;
        if (this.saveIndicatorTimeout) {
            clearTimeout(this.saveIndicatorTimeout);
            this.saveIndicatorTimeout = null;
        }
        const scheduleHide = () => {
            if (this.saveIndicatorTimeout) clearTimeout(this.saveIndicatorTimeout);
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
            events.forEach((ev) => window.addEventListener(ev, onActivity, true));
            this.saveIndicatorActivityCleanup = () => {
                events.forEach((ev) => window.removeEventListener(ev, onActivity, true));
            };
        }
        scheduleHide();
    }

    promptCloseChoice(mode) {
        return new Promise((resolve) => {
            this._closePromptResolver = resolve;
            this.closePromptMode = mode;
            this.updateComplete.then(() => {
                this.renderRoot?.querySelector('#viewer-close-prompt')?.openDialog();
            });
        });
    }

    finishClosePrompt(choice) {
        this.renderRoot?.querySelector('#viewer-close-prompt')?.closeDialog();
        this.closePromptMode = null;
        const resolver = this._closePromptResolver;
        this._closePromptResolver = null;
        resolver?.(choice);
    }

    renderLanding() {
        const filteredCases = this.sortCases(this.filterCases(this.cases));
        return html`
            <page-layout-template
                ?inert=${this.showIframe}
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin || false}
                .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="page-header-row">
                    <h1 class="page-heading">${t('cases.title')}</h1>
                    <div class="page-header-actions">
                        ${this.cases.length > 0 && !this.showNewCaseForm ? html`
                            <list-filter-tools
                                .searchQuery=${this.caseSearchQuery}
                                .sortOrder=${this.caseSortOrder}
                                .sortOptions=${LIST_SORT_OPTIONS}
                                searchLabel=${t('cases.searchAria')}
                                sortLabel=${t('cases.sortAria')}
                                searchPlaceholder=${t('cases.filterPlaceholder')}
                                @search-change=${(e) => this.handleCaseSearchChange(e)}
                                @sort-change=${(e) => this.handleCaseSortChange(e)}
                            ></list-filter-tools>
                        ` : ''}
                        <button
                            class=${this.showNewCaseForm ? 'primary-button is-cancel' : 'primary-button'}
                            type="button"
                            ?disabled=${this.loading || this.creatingCase}
                            @click=${() => this.showNewCaseForm ? this.handleCancelNewCase() : this.openNewCaseForm()}
                        >
                            ${this.showNewCaseForm ? t('common.cancel') : t('cases.newCase')}
                        </button>
                    </div>
                </div>

                ${this.loading ? html`
                    <div slot="content" class="status-note">${t('cases.loading')}</div>
                ` : ''}

                ${this.errorMessage ? html`
                    <page-content-message
                        slot="content"
                        variant="error"
                        .message=${this.errorMessage}
                    ></page-content-message>
                ` : ''}

                ${this.showNewCaseForm ? html`
                    <form slot="content" class="new-case-form" @submit=${(e) => this.handleNewCaseSubmit(e)} novalidate>
                        <h3>${t('cases.newCase')}</h3>

                        <div class="form-group">
                            <label class="form-label" for="new-case-title">${t('cases.createTitle')}</label>
                            <input
                                id="new-case-title"
                                class="form-input"
                                type="text"
                                placeholder=${t('cases.titlePlaceholder')}
                                .value=${this.newCaseTitle}
                                @input=${(e) => { this.newCaseTitle = e.target.value; }}
                                ?disabled=${this.creatingCase}
                                autocomplete="off"
                                required
                            />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="new-case-desc">${t('cases.description')}</label>
                            <textarea
                                id="new-case-desc"
                                class="form-textarea"
                                placeholder=${t('cases.descriptionPlaceholder')}
                                .value=${this.newCaseDescription}
                                @input=${(e) => { this.newCaseDescription = e.target.value; }}
                                ?disabled=${this.creatingCase}
                            ></textarea>
                        </div>

                        ${this.newCaseError ? html`
                            <div class="form-error-msg">${this.newCaseError}</div>
                        ` : ''}

                        <div class="form-actions">
                            <button
                                class="primary-button"
                                type="submit"
                                ?disabled=${this.creatingCase}
                            >
                                ${this.creatingCase ? t('cases.creating') : t('cases.create')}
                            </button>
                        </div>
                    </form>
                ` : ''}

                ${!this.loading && !this.errorMessage && this.cases.length === 0 && !this.showNewCaseForm ? html`
                    <page-content-message
                        slot="content"
                        variant="empty"
                        message=${t('cases.empty')}
                    ></page-content-message>
                ` : ''}

                ${!this.loading && this.cases.length > 0 && filteredCases.length === 0 && !this.showNewCaseForm ? html`
                    <p slot="content" class="cases-empty-filter">No cases match “${this.caseSearchQuery.trim()}”.</p>
                ` : ''}

                ${!this.loading && filteredCases.length > 0 ? html`
                    <div slot="content" class="case-grid">
                        ${filteredCases.map((row) => {
                            const isArchived = row.status === 'archived';
                            const modifiedLabel = this.caseLastModifiedLabel(row);
                            const newCommentCount = this.countNewCaseComments(row);
                            return html`
                                <button
                                    class=${isArchived ? 'case-card is-archived' : 'case-card'}
                                    type="button"
                                    @click=${() => this.openCase(row.id)}
                                >
                                    <div class="case-card-title-row">
                                        <span class="case-card-title">${row.title || t('cases.untitled')}</span>
                                        ${newCommentCount > 0 ? html`
                                            <span
                                                class="case-card-new-badge"
                                                title=${newCommentCount === 1
                                                    ? t('cases.oneNewComment')
                                                    : t('cases.nNewComments', { n: newCommentCount })}
                                            >${newCommentCount === 1 ? t('cases.badgeNew') : t('cases.badgeNNew', { n: newCommentCount })}</span>
                                        ` : ''}
                                    </div>
                                    ${row.description ? html`
                                        <p class="case-card-desc">${row.description}</p>
                                    ` : ''}
                                    ${modifiedLabel ? html`
                                        <div class="case-card-meta-row">
                                            <span class="case-card-meta-item">${modifiedLabel}</span>
                                        </div>
                                    ` : ''}
                                    ${isArchived ? html`
                                        <span class="status-chip">${t('cases.archived')}</span>
                                    ` : ''}
                                </button>
                            `;
                        })}
                    </div>
                ` : ''}

            </page-layout-template>
        `;
    }

    renderCaseDetail(caseRow) {
        const allAttachments = Array.isArray(caseRow.attachments) ? caseRow.attachments : [];
        const attachments = this.sortAttachments(this.filterAttachments(allAttachments));
        const searchActive = !!this.attachmentSearchQuery.trim();
        const comments = Array.isArray(caseRow.comments) ? caseRow.comments : [];
        const canEdit = this.canEditCaseContent(caseRow);
        const canManage = this.canManageCollaborators(caseRow);
        const canComment = this.canCommentOnCase(caseRow);
        const peopleCount = this.casePeopleCount(caseRow);
        const pendingInvites = Number(this.pendingInviteCount) || 0;
        const peopleLabel = peopleCount
            ? t('cases.people', { n: peopleCount })
            : t('cases.peopleLabel');
        return html`
            <page-layout-template
                ?inert=${this.showIframe}
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin || false}
                .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="case-detail">
                    <div class="detail-toolbar">
                        <button class="back-link" type="button" @click=${() => this.backToCaseList()}>
                            ${t('cases.backToList')}
                        </button>
                        ${this._getViewFromUrl() === 'history' ? html`
                            <button class="back-link" type="button" @click=${() => this._closeAuditView()}>
                                ${caseRow.title || t('cases.untitledCase')}
                            </button>
                        ` : ''}
                        <div class="detail-toolbar-actions">
                            <button
                                class="quiet-button"
                                type="button"
                                ?disabled=${this.savingCollaborators}
                                @click=${() => this.openPeopleDialog(caseRow)}
                            >
                                ${peopleLabel}${pendingInvites
                                    ? html` <span class="people-pending-badge" title=${t('people.pendingInvites')}>${pendingInvites}</span>`
                                    : ''}
                            </button>
                            ${canEdit && !this.editingCase ? html`
                                <button
                                    class="quiet-button"
                                    type="button"
                                    ?disabled=${this.archivingCase}
                                    @click=${() => this.startEditCase(caseRow)}
                                >${t('cases.editDetails')}</button>
                            ` : ''}
                            <div class="toolbar-more-menu">
                                <button
                                    class="quiet-button toolbar-more-btn"
                                    type="button"
                                    aria-label=${t('common.moreOptions')}
                                    @click=${(e) => { e.stopPropagation(); this._toolbarMenuOpen = !this._toolbarMenuOpen; }}
                                >⋯</button>
                                ${this._toolbarMenuOpen ? html`
                                    <div class="toolbar-more-dropdown" @click=${(e) => e.stopPropagation()}>
                                        <button
                                            class="toolbar-more-item"
                                            type="button"
                                            @click=${() => { this._toolbarMenuOpen = false; this._openAuditView(caseRow.id); }}
                                        >${t('audit.viewHistory')}</button>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                    </div>

                    ${this._getViewFromUrl() === 'history' ? html`
                        <div class="audit-view-container">
                            <audit-log
                                .rows=${this._auditRows}
                                .loading=${this._auditLoading}
                                .error=${this._auditError || ''}
                                .hasMore=${this._auditHasMore}
                                @load-more=${() => this._loadAuditLog(caseRow.id, { append: true })}
                            ></audit-log>
                        </div>
                    ` : html`

                    ${this.editingCase ? html`
                        <form class="new-case-form" @submit=${(e) => { e.preventDefault(); this.saveEditCase(caseRow); }} novalidate>
                            <div class="form-group">
                                <label class="form-label" for="edit-case-title">${t('cases.createTitle').replace(' *', '')}</label>
                                <input
                                    id="edit-case-title"
                                    class="form-input"
                                    type="text"
                                    .value=${this.editCaseTitle}
                                    @input=${(e) => { this.editCaseTitle = e.target.value; }}
                                    ?disabled=${this.savingCaseEdit}
                                    autocomplete="off"
                                    required
                                />
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="edit-case-desc">${t('cases.description')}</label>
                                <textarea
                                    id="edit-case-desc"
                                    class="form-textarea"
                                    .value=${this.editCaseDesc}
                                    @input=${(e) => { this.editCaseDesc = e.target.value; }}
                                    ?disabled=${this.savingCaseEdit}
                                ></textarea>
                            </div>
                            ${this.caseEditError ? html`<div class="form-error-msg">${this.caseEditError}</div>` : ''}
                            <div class="form-actions">
                                ${canManage && caseRow.status !== 'archived' ? html`
                                    <button
                                        class="quiet-button form-actions-spacer"
                                        type="button"
                                        ?disabled=${this.savingCaseEdit || this.archivingCase}
                                        @click=${() => this.handleArchiveCase(caseRow)}
                                    >${this.archivingCase ? t('cases.archiving') : t('cases.archive')}</button>
                                ` : html`<span class="form-actions-spacer"></span>`}
                                <button class="secondary-button" type="button" ?disabled=${this.savingCaseEdit} @click=${() => this.cancelEditCase()}>${t('common.cancel')}</button>
                                <button class="primary-button" type="submit" ?disabled=${this.savingCaseEdit}>
                                    ${this.savingCaseEdit ? t('common.saving') : t('common.save')}
                                </button>
                            </div>
                        </form>
                    ` : html`
                        <div class="detail-header">
                            <div class="detail-title-row">
                                <h2 class="detail-title">${caseRow.title || t('cases.untitledCase')}</h2>
                                ${caseRow.status && caseRow.status !== 'active' ? html`
                                    <span class="status-chip">${caseRow.status}</span>
                                ` : ''}
                            </div>
                            ${caseRow.description ? html`
                                <p class="detail-desc">${caseRow.description}</p>
                            ` : ''}
                        </div>
                    `}

                    ${this.errorMessage ? html`
                        <page-content-message
                            variant="error"
                            .message=${this.errorMessage}
                        ></page-content-message>
                    ` : ''}

                    <div class="case-detail-grid">
                        <div class="files-panel">
                            <div class="panel-header">
                                <div class="panel-header-start">
                                    <h3 class="panel-title">${t('cases.attachments')}</h3>
                                    <span
                                        class="panel-count"
                                        title=${searchActive
                                            ? `${attachments.length} of ${allAttachments.length} shown`
                                            : `${allAttachments.length} attachments`}
                                    >${searchActive
                                        ? `${attachments.length}/${allAttachments.length}`
                                        : allAttachments.length}</span>
                                </div>
                                ${allAttachments.length > 0 ? html`
                                    <list-filter-tools
                                        .searchQuery=${this.attachmentSearchQuery}
                                        .sortOrder=${this.attachmentSortOrder}
                                        .sortOptions=${LIST_SORT_OPTIONS}
                                        searchLabel=${t('cases.searchAttachments')}
                                        sortLabel=${t('cases.sortAttachments')}
                                        searchPlaceholder=${t('listFilter.filterPlaceholder')}
                                        @search-change=${(e) => this.handleAttachmentSearchChange(e)}
                                        @sort-change=${(e) => this.handleAttachmentSortChange(e)}
                                    ></list-filter-tools>
                                ` : ''}
                            </div>
                            <div
                                class="files-body ${this.attachmentDragOver ? 'drag-over' : ''}"
                                @dragenter=${(e) => this.handleAttachmentDragEnter(e, caseRow)}
                                @dragover=${(e) => this.handleAttachmentDragOver(e, caseRow)}
                                @dragleave=${(e) => this.handleAttachmentDragLeave(e)}
                                @drop=${(e) => this.handleAttachmentDrop(e, caseRow)}
                            >
                                ${this.attachmentDragOver ? html`
                                    <div class="drop-hint">${t('cases.dropToAttach')}</div>
                                ` : ''}
                                <div class="visually-hidden" role="status" aria-live="polite" aria-atomic="true">${this.downloadStatusText}</div>
                                ${allAttachments.length === 0 ? html`
                                    <div class="empty-note">${t('cases.noFiles')}</div>
                                ` : attachments.length === 0 ? html`
                                    <div class="empty-note">No attachments match “${this.attachmentSearchQuery.trim()}”.</div>
                                ` : html`
                                    <div class="file-list">
                                        ${attachments.map((attachment) => html`
                                            <file-list-row
                                                .fileName=${this.attachmentTitle(attachment)}
                                                .metaLine=${this.attachmentMetaLine(attachment)}
                                                .nameButtonDisabled=${!this.attachmentCanActivate(attachment)
                                                    || !!this.openingAttachmentId
                                                    || this.viewerLoading}
                                                .nameButtonTitle=${this.attachmentOpenTitle(attachment)}
                                                @name-click=${() => this.handleOpenViewer(caseRow, attachment, this.accountDefaultViewer())}
                                            >
                                                ${attachment?.canOpenInSlicer ? html`
                                                    <attachment-open-menu
                                                        slot="title-trailing"
                                                        .fileName=${this.attachmentTitle(attachment)}
                                                        .defaultViewer=${this.accountDefaultViewer()}
                                                        ?disabled=${!!this.openingAttachmentId || this.viewerLoading}
                                                        @open-viewer=${(e) => this.handleOpenViewer(caseRow, attachment, e.detail?.viewer)}
                                                    ></attachment-open-menu>
                                                ` : ''}
                                                ${canEdit ? html`
                                                    <button
                                                        slot="actions"
                                                        class="file-icon-button"
                                                        type="button"
                                                        title=${t('cases.downloadFileNamed', { name: this.attachmentTitle(attachment) })}
                                                        aria-label=${t('cases.downloadFileNamed', { name: this.attachmentTitle(attachment) })}
                                                        aria-busy=${this.downloadingAttachmentIds.has(attachment.id) ? 'true' : 'false'}
                                                        aria-disabled=${this.downloadingAttachmentIds.has(attachment.id) ? 'true' : 'false'}
                                                        @click=${() => this.handleDownloadAttachment(caseRow, attachment)}
                                                    >
                                                        ${this.downloadingAttachmentIds.has(attachment.id) ? html`
                                                            <span class="download-spinner" aria-hidden="true"></span>
                                                        ` : html`
                                                            <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                                                                <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/>
                                                            </svg>
                                                        `}
                                                    </button>
                                                ` : ''}
                                                ${(this.isMyAttachment(attachment) || this.myCaseRole(caseRow) === 'admin') ? html`
                                                    <button
                                                        slot="actions"
                                                        class="file-icon-button"
                                                        type="button"
                                                        title=${t('cases.removeFileNamed', { name: this.attachmentTitle(attachment) })}
                                                        aria-label=${t('cases.removeFileNamed', { name: this.attachmentTitle(attachment) })}
                                                        ?disabled=${!!this.deletingAttachmentId}
                                                        @click=${() => this.handleDeleteAttachment(caseRow, attachment)}
                                                    >
                                                        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                                        </svg>
                                                    </button>
                                                ` : ''}
                                            </file-list-row>
                                        `)}
                                    </div>
                                `}

                                <input
                                    id="attach-file-input"
                                    type="file"
                                    hidden
                                    @change=${(e) => this.handleFileSelected(e, caseRow)}
                                />

                                ${canEdit ? html`
                                    <div class="upload-action-row">
                                        ${this.uploadingFile ? html`
                                            <div class="upload-progress">
                                                <span class="upload-status">
                                                    ${this.uploadStatusText}
                                                    ${Math.round(this.uploadProgress * 100)}%
                                                </span>
                                                <progress
                                                    max="1"
                                                    .value=${this.uploadProgress}
                                                    aria-label=${this.uploadStatusText}
                                                ></progress>
                                            </div>
                                        ` : this.uploadStatusText ? html`
                                            <span class="upload-status">${this.uploadStatusText}</span>
                                        ` : this.uploadError ? html`
                                            <span class="upload-error">${this.uploadError}</span>
                                        ` : html`<span></span>`}
                                        <button
                                            class="secondary-button"
                                            type="button"
                                            ?disabled=${!!this.openingAttachmentId}
                                            @click=${() => this.triggerFileUpload()}
                                        >
                                            ${t('cases.addFile')}
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        </div>

                        <comments-panel
                            .comments=${comments}
                            .collaborators=${(caseRow.collaborators || [])
                                .filter((c) => c.id && c.username)
                                .map((c) => ({ id: c.id, name: c.username }))}
                            emptyMessage=${this.sessionMeta?.comments?.loaded === false
                                ? t('cases.commentsLoadFailed')
                                : t('cases.noComments')}
                            placeholder=${t('cases.writeComment')}
                            ?posting=${this.postingComment}
                            ?allowCompose=${canComment}
                            @post-comment=${(e) => this.handlePostComment(e, caseRow)}
                        ></comments-panel>
                    </div>
                `}
                </div>
            </page-layout-template>
        `;
    }

    renderViewerOverlay() {
        if (!this.showIframe) return html``;
        const viewerLabel = viewerDisplayName(this.viewerKind, {
            simplified: this.viewerSimplified
        });
        const viewerTitle = `${viewerLabel}: ${this.currentFileName || t('common.loading')}`;
        return html`
            <div
                class="iframe-overlay"
                role="dialog"
                aria-modal="true"
                aria-labelledby="viewer-title"
                style=${this.viewerClosing ? 'display:none' : ''}
            >
                <div class="iframe-header">
                    <div class="iframe-title" id="viewer-title">${viewerTitle}</div>
                    <div class="iframe-header-actions">
                        ${this.saveIndicatorMessage ? html`
                            <span class="save-indicator">${this.saveIndicatorMessage}</span>
                        ` : ''}
                        ${this.errorMessage ? html`
                            <span class="viewer-error-message">${this.errorMessage}</span>
                        ` : ''}
                        ${(this.viewerKind === VIEWER_KINDS.SLICER_GUI || this.viewerKind === VIEWER_KINDS.SLICERWEB) ? html`
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.viewerLoading || this.iframeUrl === 'about:blank' || this.isSavingScene}
                                @click=${() => this.saveCurrentScene('overwrite')}
                            >
                                ${this.isSavingScene ? t('common.saving') : t('files.saveScene')}
                            </button>
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.viewerLoading || this.iframeUrl === 'about:blank' || this.isSavingScene}
                                @click=${() => this.saveCurrentSceneAsNew()}
                            >
                                ${t('files.saveAsNew')}
                            </button>
                        ` : ''}
                        <button
                            class="primary-button"
                            type="button"
                            @click=${() => this.closeViewer()}
                        >
                            ${t('common.close')}
                        </button>
                    </div>
                </div>
                <app-dialog
                    id="save-as-new-dialog"
                    title=${t('files.saveAsNewTitle')}
                    .lightDismiss=${false}
                >
                    <div class="form-group">
                        <label class="form-label" for="save-as-new-name">${t('files.saveAsNewLabel')}</label>
                        <input
                            id="save-as-new-name"
                            type="text"
                            class="form-input"
                            autocomplete="off"
                            .value=${this._saveAsNewName}
                            @input=${(e) => { this._saveAsNewName = e.target.value; }}
                            @keydown=${(e) => { if (e.key === 'Enter' && this._saveAsNewName.trim()) this.finishSaveAsNew(true); if (e.key === 'Escape') this.finishSaveAsNew(false); }}
                        />
                    </div>
                    <button slot="actions" class="secondary-button" type="button"
                        @click=${() => this.finishSaveAsNew(false)}>
                        ${t('common.cancel')}
                    </button>
                    <button slot="actions" class="primary-button" type="button"
                        ?disabled=${!this._saveAsNewName.trim()}
                        @click=${() => this.finishSaveAsNew(true)}>
                        ${t('common.save')}
                    </button>
                </app-dialog>
                ${this.closePromptMode ? html`
                    <app-dialog
                        id="viewer-close-prompt"
                        title=${this.closePromptMode === 'save-failed' ? 'Save failed' : 'Unsaved changes'}
                        .showDefaultCloseButton=${false}
                    >
                        <p>${this.closePromptMode === 'save-failed'
                            ? 'Your changes could not be saved. Close anyway?'
                            : 'Save your changes before closing?'
                        }</p>
                        ${this.closePromptMode === 'unsaved' ? html`
                            <button slot="actions" class="secondary-button" type="button"
                                @click=${() => this.finishClosePrompt('discard')}>
                                ${t('files.dontSave')}
                            </button>
                            <button slot="actions" class="primary-button" type="button"
                                @click=${() => this.finishClosePrompt('save')}>
                                ${t('common.save')}
                            </button>
                        ` : html`
                            <button slot="actions" class="secondary-button" type="button"
                                @click=${() => this.finishClosePrompt('keep-open')}>
                                ${t('files.keepOpen')}
                            </button>
                            <button slot="actions" class="primary-button" type="button"
                                @click=${() => this.finishClosePrompt('close-anyway')}>
                                ${t('files.closeAnyway')}
                            </button>
                        `}
                    </app-dialog>
                ` : ''}
                <div class="iframe-container">
                    ${this.iframeUrl !== 'about:blank' ? html`
                        <iframe
                            class="viewer-iframe"
                            title=${viewerTitle}
                            src="${this.iframeUrl}"
                            allow="clipboard-read; clipboard-write; cross-origin-isolated"
                            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads allow-popups allow-popups-to-escape-sandbox allow-pointer-lock allow-storage-access-by-user-activation"
                            allowfullscreen
                            frameborder="0"
                            referrerpolicy="origin"
                            @load=${(e) => this.handleViewerIframeLoad(e)}
                        ></iframe>
                    ` : ''}
                    ${this.viewerLoading ? html`
                        <div class="loading-overlay">
                            <div class="viewer-loading" role="status">
                                <p>${this.viewerLoadingDetail || t('cases.loadingViewer')}</p>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    render() {
        const detail = this.selectedCase;
        return html`
            ${detail ? this.renderCaseDetail(detail) : this.renderLanding()}
            ${this.renderViewerOverlay()}
            ${this._backgroundSave ? html`
                <div class="background-save-banner" role="status" aria-live="polite">
                    ${this._backgroundSave.error ? html`
                        <span class="background-save-spinner background-save-spinner--error" aria-hidden="true"></span>
                        <span class="background-save-error">${this._backgroundSave.error}</span>
                        <button class="secondary-button" type="button" style="padding:2px 10px;font-size:0.8rem"
                            @click=${() => this._retryBackgroundSave()}>${t('common.tryAgain')}</button>
                        <button class="link-button" type="button"
                            @click=${() => { this._backgroundSave = null; }}>${t('common.dismiss')}</button>
                    ` : html`
                        <span class="background-save-spinner" aria-hidden="true"></span>
                        <span>${t('files.savingBackground')}</span>
                    `}
                </div>
            ` : ''}
            ${this.toastMessage ? html`<div class="toast" role="status">${this.toastMessage}</div>` : ''}
            <people-dialog
                id="case-people-dialog"
                title=${t('cases.peopleDialog')}
                @people-save=${(e) => this.handlePeopleSave(e)}
                @people-cancel=${() => this.closePeopleDialog()}
                @people-invited=${(e) => this.handlePeopleInvited(e)}
                @people-approve-invite=${(e) => this.handlePeopleApproveInvite(e)}
                @people-reject-invite=${(e) => this.handlePeopleRejectInvite(e)}
            ></people-dialog>
        `;
    }
}

customElements.define('directus-cases-page', DirectusCasesPage);
