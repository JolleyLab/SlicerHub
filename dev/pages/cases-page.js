import { LitElement, html } from 'lit-element';
import { listPageStyles } from '../styles/listPage.js';
import { casesPageStyles } from './cases-page.styles.js';
import { LIST_SORT_OPTIONS, filterByText, sortRows } from '../utils/listSort.js';
import { t } from '../i18n/index.js';
import '../components/page-layout-template.js';
import '../components/page-content-message.js';
import '../components/file-list-row.js';
import '../components/comments-panel.js';
import '../components/app-dialog.js';
import { friendlyCasesError } from '../services/cases.js';
import { API_URL } from '../config.js';
import { parseNodeIdsRepr, selectModulePython } from '../services/slicerBridgeUtils.js';
import {
    listCases, getCaseAccess, createCase, updateCase, listAttachments, deleteAttachment,
    uploadCaseAttachment, openPayloadAttachmentFullSlicer, fetchPayloadAttachmentContent,
    listCollaborators, inviteCollaborator, proposeGroupCollaborator, updateCollaborators, lookupCaseUser,
    listComments, createComment,
    listCaseInvites, approveCaseInvite, rejectCaseInvite,
    savePayloadSlicerWebScene,
} from '../services/cases.js';
import '../components/people-dialog.js';
import '../components/list-filter-tools.js';
import '../components/overflow-menu.js';
import '../components/case-settings.js';
import { VIEWER, SIMPLIFIED_VIEWER_MODULE, workflowsAddingExtensions } from '../utils/openWith.js';
import { CaseWorkflowsController } from '../controllers/caseWorkflowsController.js';
import { ICON_TRASH, ICON_DOWNLOAD } from '../utils/icons.js';
import { iconTile, iconTileStyles } from '../utils/iconTile.js';
import { resetSlicerWebExtensions } from '../utils/slicerWebStorage.js';
import { formatBytes } from '../utils/formatBytes.js';
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
import { resolveSlicerWebChannel } from '../services/features.js';
import { listAllGroups } from '../services/groups.js';
import { sendViewerHeartbeat } from '../utils/viewerHeartbeat.js';
import { stopViewerSession } from '../utils/viewerSessionLifecycle.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity
} from '../utils/viewerActivity.js';
import { classifySlicerLoadError, isUnrecognisedFormat, UnrecognisedFormatError } from '../services/slicerErrors.js';

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
export class CasesPage extends LitElement {
    static get styles() {
        return [listPageStyles, iconTileStyles, casesPageStyles];
    }

    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            currentUserId: { type: Number },
            currentKeycloakSub: { type: String },
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
            /** Case Settings (admins) instead of the case's files and comments */
            showCaseSettings: { state: true },
            viewerClosing: { type: Boolean },
            currentFileName: { type: String },
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
            pendingInviteCount: { type: Number },
            isSavingScene: { type: Boolean },
            hasUnsavedChanges: { type: Boolean },
            _backgroundSave: { type: Object },
            saveIndicatorMessage: { type: String },
            _saveAsNewName: { type: String },
            _mcsSaveDefaultName: { type: String },
            errorDialogTitle: { type: String },
            errorDialogMessage: { type: String },
            errorDialogOffer: { attribute: false },
        };
    }

    constructor() {
        super();
        this.username = t('common.guest');
        this.avatarUrl = '';
        this.currentUserId = null;
        this.currentKeycloakSub = null;
        this.loading = false;
        this.errorMessage = '';
        this.cases = [];
        this.sessionMeta = null;
        this.savingCollaborators = false;
        this.selectedCaseId = '';
        this.openingAttachmentId = '';
        this.postingComment = false;
        this.showIframe = false;
        this.iframeUrl = 'about:blank';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.currentFileName = '';
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.workflows = new CaseWorkflowsController(this, {
            channel: () => this.slicerWebChannel(),
            accountViewer: () => this.accountDefaultViewer(),
            fileName: attachmentFileName,
            fileTitle: (attachment) => this.attachmentTitle(attachment),
            isBusy: () => Boolean(this.openingAttachmentId) || this.viewerLoading,
            launch: (caseRow, attachment, open) => this.openWith(caseRow, attachment, open),
            // The uploader (while they can still edit the case) or an admin, as the server allows.
            canSetFileDefault: (caseRow, attachment) => this.myCaseRole(caseRow) === 'admin'
                || (this.isMyAttachment(attachment) && this.canEditCaseContent(caseRow)),
            fileDefaultChanged: (caseRow, attachment, openWith) => this._patchAttachment(caseRow.id, attachment.id, { openWith }),
            showError: (err) => { this.errorMessage = this.userFacingError(err, t('common.somethingWentWrong')); },
        });
        this.showCaseSettings = false;
        this.viewerClosing = false;
        this._viewerOpenId = 0;
        this._focusBeforeViewer = null;
        this._slicerWebRun = 0;
        this._slicerWebPending = null;
        this.isSavingScene = false;
        this.hasUnsavedChanges = false;
        this._backgroundSave = null;
        this.saveIndicatorMessage = '';
        this._saveAsNewName = '';
        this.saveIndicatorTimeout = null;
        this.saveIndicatorActivityCleanup = null;
        this._saveAsNewResolver = null;
        this._mcsSaveDefaultName = '';
        this._mcsSaveResolver = null;
        this._lastSavedAttachmentId = null;
        this.errorDialogTitle = '';
        this.errorDialogMessage = '';
        this.errorDialogOffer = null;
        this.iframeActivityCleanup = null;
        this.currentAttachmentId = '';
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
        // Access to the open case can end while it's on screen (removed from the case or
        // from a group that had it): checked every minute and when the tab comes back.
        this._accessWatchTimer = null;
        this._onAccessWake = null;
        this._lastAccessCheckAt = 0;
        this._accessCheck = null;
    }

    get selectedCase() {
        return this.cases.find((row) => String(row.id) === String(this.selectedCaseId)) || null;
    }

    // â”€â”€ URL / history helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        return url.toString();
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
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();

        // Restore case from URL; strip ?viewer â€” the container is gone after a reload
        const initialCaseId = this._getCaseIdFromUrl();
        if (initialCaseId) this.selectedCaseId = initialCaseId;
        if (new URLSearchParams(location.search).has('viewer')) {
            history.replaceState({ caseId: initialCaseId }, '', this._buildCaseUrl(initialCaseId));
        }

        this._popStateHandler = (e) => this._handlePopState(e);
        window.addEventListener('popstate', this._popStateHandler);

        this._handleBeforeUnload = () => {
            if (!this.showIframe || !this._viewerSessionToken) return;
            const { stopUrl } = getViewerSessionEndpoints({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionScope: VIEWER_SESSION_SCOPES.CASES
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

        this.loadCases();
        this._startCaseAccessWatch();
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
        this._stopCaseAccessWatch();
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        if (this._popStateHandler) {
            window.removeEventListener('popstate', this._popStateHandler);
            this._popStateHandler = null;
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
        if (changed.has('showIframe')) this.syncViewerFocus();
        if (changed.has('selectedCaseId')) {
            this.showCaseSettings = false;
            this.workflows.load(this.selectedCaseId);
        }
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
        // A 403/404 on the open case may mean access just ended: confirm and react.
        if ((err?.status === 403 || err?.status === 404) && this.selectedCaseId) {
            this._verifyCaseAccess({ force: true });
        }
        return friendlyCasesError(err?.message, fallback, err?.status, err?.code);
    }

    _startCaseAccessWatch() {
        this._stopCaseAccessWatch();
        this._accessWatchTimer = setInterval(() => {
            if (!document.hidden) this._refreshOpenCase();
        }, 60 * 1000);
        this._onAccessWake = () => { if (!document.hidden) this._refreshOpenCase(); };
        window.addEventListener('focus', this._onAccessWake);
        document.addEventListener('visibilitychange', this._onAccessWake);
    }

    _stopCaseAccessWatch() {
        if (this._accessWatchTimer) clearInterval(this._accessWatchTimer);
        this._accessWatchTimer = null;
        if (this._onAccessWake) {
            window.removeEventListener('focus', this._onAccessWake);
            document.removeEventListener('visibilitychange', this._onAccessWake);
            this._onAccessWake = null;
        }
    }

    /** On the minute and on returning to the tab: is the open case still ours, and what's new in its workflows. */
    _refreshOpenCase() {
        this._verifyCaseAccess();
        this.workflows.refreshIfStale(this.selectedCaseId);
    }

    /** Ask the server whether the open case is still ours (throttled unless forced). */
    async _verifyCaseAccess({ force = false } = {}) {
        const caseId = String(this.selectedCaseId || '');
        if (!caseId || this._accessCheck) return;
        if (!force && Date.now() - this._lastAccessCheckAt < 10 * 1000) return;
        this._lastAccessCheckAt = Date.now();
        this._accessCheck = getCaseAccess(caseId);
        try {
            if (await this._accessCheck === 'lost' && String(this.selectedCaseId) === caseId) {
                await this._handleCaseAccessLost([caseId]);
            }
        } finally {
            this._accessCheck = null;
        }
    }

    /**
     * Access to these cases ended: close the viewer (the server has stopped a Full Slicer
     * seat holding their files), leave the case if it's open, drop them from the list and
     * say why. Data already on screen can't be recalled; the server refuses everything else.
     */
    async _handleCaseAccessLost(caseIds = []) {
        const lost = new Set(caseIds.map(String));
        if (!lost.size) return;
        const openId = String(this.selectedCaseId || '');
        const openRow = this.cases.find((row) => String(row.id) === openId);
        const named = lost.has(openId) && openRow ? this.caseTitle(openRow) : '';

        if (this.showIframe || this.viewerLoading || this._viewerSessionToken) {
            this._viewerPushedState = false;
            await this._doCloseViewer();
        }
        this.cases = this.cases.filter((row) => !lost.has(String(row.id)));
        if (lost.has(openId)) {
            this.closePeopleDialog();
            this.editingCase = false;
            this.pendingInviteCount = 0;
            this.selectedCaseId = '';
            history.replaceState({}, '', this._buildCaseUrl(''));
        } else {
            this._replaceUrlWithCase();
        }
        this.errorMessage = named
            ? t('cases.accessLost', { title: `"${named}"` })
            : t('cases.accessLostUntitled');
    }

    async loadCases() {
        this.loading = true;
        this.errorMessage = '';
        const keepSelected = this.selectedCaseId;
        try {
            const data = await listCases({ limit: 50 });
            this.cases = Array.isArray(data.cases) ? data.cases : [];
            this.sessionMeta = data.meta || null;
            if (keepSelected && !this.cases.some((row) => String(row.id) === String(keepSelected))) {
                this.selectedCaseId = '';
            } else if (keepSelected) {
                const openRow = this.cases.find((row) => String(row.id) === String(keepSelected));
                if (openRow) this.markCaseCommentsSeen(openRow);
                this.loadCaseAttachments(keepSelected);
                this.loadCaseComments(keepSelected);
                this.loadCaseCollaborators(keepSelected);
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
        const caseRow = this.cases.find((row) => String(row.id) === String(caseId));
        if (caseRow) this.markCaseCommentsSeen(caseRow);
        history.pushState({ caseId }, '', this._buildCaseUrl(caseId));
        this.refreshPendingInviteCount();
        this.loadCaseAttachments(caseId);
        this.loadCaseComments(caseId);
        this.loadCaseCollaborators(caseId);
    }

    /**
     * Open a case, then `then(caseRow)` once it's in the list (notification deep-links).
     * Retries briefly if the case list has not finished loading.
     */
    async _openCaseThen(caseId, then) {
        const id = String(caseId || '').trim();
        if (!id) return;
        this.openCase(id);
        for (let i = 0; i < 20; i += 1) {
            const caseRow = this.cases.find((row) => String(row.id) === id);
            if (caseRow) {
                await this.updateComplete;
                await then(caseRow);
                return;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    /** Open case People dialog (used by notification deep-links). */
    openPeopleForCaseId(caseId) {
        return this._openCaseThen(caseId, (caseRow) => this.openPeopleDialog(caseRow));
    }

    /** Open the case's Workflows panel on `tab` (PANEL_TAB; Home's workflow request cards). */
    openWorkflowsForCaseId(caseId, tab) {
        return this._openCaseThen(caseId, (caseRow) => this.workflows.openPanel(caseRow, tab));
    }

    async refreshPendingInviteCount() {
        const caseRow = this.selectedCase;
        if (!caseRow?.id) { this.pendingInviteCount = 0; return; }
        try {
            const inv = await listCaseInvites(caseRow.id);
            this.pendingInviteCount = (inv.invites || []).length;
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
        const myId = this.currentKeycloakSub
            ? String(this.currentKeycloakSub).toLowerCase()
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

    canManageCollaborators(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin';
    }

    /** Owner/admin/collaborator can invite; read_only cannot. */
    canInviteCollaborators(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin' || role === 'collaborator';
    }

    myCaseRole(caseRow) {
        if (!caseRow) return null;
        if (caseRow.myRole) return caseRow.myRole;
        if (this.currentKeycloakSub && caseRow.owner_id === this.currentKeycloakSub) return 'admin';
        return null; // the server's myRole covers site admins; org admins get only their membership
    }

    canEditCaseContent(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin' || role === 'collaborator';
    }

    /** A loaded attachment of a case, by id. */
    _attachment(caseId, attachmentId) {
        const caseRow = this.cases.find((c) => String(c.id) === String(caseId));
        return (caseRow?.attachments || []).find((a) => String(a.id) === String(attachmentId)) || null;
    }

    /** Change fields of one loaded attachment, in place in this.cases. */
    _patchAttachment(caseId, attachmentId, fields) {
        this.cases = this.cases.map((c) => (String(c.id) !== String(caseId) || !Array.isArray(c.attachments) ? c : {
            ...c,
            attachments: c.attachments.map((a) => (String(a.id) === String(attachmentId) ? { ...a, ...fields } : a)),
        }));
    }

    isMyAttachment(attachment) {
        if (!attachment || !this.currentKeycloakSub) return false;
        return attachment.uploadedBy === this.currentKeycloakSub;
    }

    /** Any case member (including read_only) may comment. */
    canCommentOnCase(caseRow) {
        return Boolean(this.myCaseRole(caseRow));
    }

    normalizePayloadAttachment(att) {
        return {
            id: att.id,
            name: att.original_filename,
            filenameDownload: att.original_filename,
            filesize: att.size_bytes ?? null,
            mimeType: att.mime_type || 'application/octet-stream',
            modifiedAt: att.updatedAt || att.createdAt || null,
            uploadedBy: att.uploaded_by ?? null,
            openWith: att.open_with || null, // the file's default (a menu key); null: the case default
            isMrb:             att.isMrb              ?? false,
            canOpenInSlicer:    att.canOpenInSlicer    ?? false,
            canPreviewInBrowser: att.canPreviewInBrowser ?? false,
            _source: 'payload',
        };
    }

    async loadCaseAttachments(caseId) {
        try {
            const data = await listAttachments(caseId);
            const normalized = (data.attachments || []).map((a) => this.normalizePayloadAttachment(a));
            this.cases = this.cases.map((row) =>
                String(row.id) === String(caseId) ? { ...row, attachments: normalized } : row
            );
        } catch {
            // non-fatal; files panel shows empty
        }
    }

    async loadCaseCollaborators(caseId) {
        try {
            const data = await listCollaborators(caseId);
            this.cases = this.cases.map((row) =>
                String(row.id) === String(caseId)
                    ? { ...row, keycloakCollaborators: data.collaborators || [], _ownerInfo: data.owner || row._ownerInfo || null }
                    : row
            );
        } catch {
            // non-fatal; mention picker shows empty
        }
    }

    async loadCaseComments(caseId) {
        try {
            const data = await listComments(caseId);
            const comments = (data.comments || []).map((c) => ({
                id:        c.id,
                body:      c.body,
                createdAt: c.createdAt,
                author_id: c.author_id,
                author:    c.author,
                mentions:  c.mentions || {},
            }));
            this.cases = this.cases.map((row) =>
                String(row.id) === String(caseId) ? { ...row, comments } : row
            );
        } catch {
            // non-fatal; comment panel shows empty
        }
    }

    casePeopleCount(caseRow) {
        return this.buildPeopleMembers(caseRow).length;
    }

    buildPeopleMembers(caseRow) {
        const members = [];
        if (caseRow?.owner_id != null) {
            const ownerInfo = caseRow._ownerInfo || {};
            members.push({
                id: String(caseRow.owner_id),
                email: ownerInfo.email || '',
                username: ownerInfo.email || '',
                firstName: ownerInfo.firstName || '',
                lastName: ownerInfo.lastName || '',
                displayName: ownerInfo.displayName || [ownerInfo.firstName, ownerInfo.lastName].filter(Boolean).join(' ') || ownerInfo.email || '',
                avatarUrl: ownerInfo.avatarUrl || null,
                role: 'admin',
                locked: true,
            });
        }
        for (const entry of caseRow?.keycloakCollaborators || []) {
            if (!entry?.id) continue;
            if (entry.type === 'group') {
                members.push({
                    id: entry.id,
                    type: 'group',
                    displayName: entry.displayName || '',
                    memberCount: entry.memberCount ?? null,
                    groupMembers: entry.members || [],
                    hiddenMemberCount: entry.hiddenMemberCount || 0,
                    role: entry.role || 'collaborator',
                    locked: false,
                });
                continue;
            }
            members.push({
                id: entry.id,
                email: entry.email || '',
                username: entry.email || '',
                firstName: entry.firstName || '',
                lastName: entry.lastName || '',
                displayName: entry.displayName || [entry.firstName, entry.lastName].filter(Boolean).join(' ') || entry.email || '',
                avatarUrl: entry.avatarUrl || null,
                role: entry.role || 'collaborator',
                siteAdmin: entry.siteAdmin === true,
                needsRole: entry.needsRole === true,
                locked: false,
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
        dialog.saving = this.savingCollaborators;
        dialog.error = '';

        dialog.availableGroups = [];
        if (canInvite) {
            try {
                dialog.availableGroups = await listAllGroups();
            } catch { /* non-fatal; group picker just stays empty */ }
        }

        const myRole = this.myCaseRole(caseRow);
        dialog.roleOptions = (myRole === 'admin')
            ? null  // admins get all options (default)
            : [
                { value: '',             label: t('roles.selectRole'), disabled: true },
                { value: 'collaborator', label: t('roles.collaborator') },
                { value: 'read_only',    label: t('roles.readOnly') },
            ];
        dialog.currentUserId = this.currentKeycloakSub || '';
        dialog.lookupFn = async (email) => {
            const data = await lookupCaseUser(email);
            return data.user;
        };
        dialog.inviteFn = async ({ email, role }) => {
            const data = await inviteCollaborator(caseRow.id, { email, role });
            if (data.status === 'added') {
                try {
                    const fresh = await listCollaborators(caseRow.id);
                    this.cases = this.cases.map((row) =>
                        row.id === caseRow.id
                            ? { ...row, keycloakCollaborators: fresh.collaborators }
                            : row
                    );
                } catch { /* non-fatal */ }
            }
            return {
                status:    data.status,
                emailSent: data.emailSent,
                collaborator: data.collaborator,
            };
        };
        dialog.groupInviteFn = async ({ groupId, role }) => {
            const data = await proposeGroupCollaborator(caseRow.id, { groupId, role });
            if (data.status === 'added') {
                try {
                    const fresh = await listCollaborators(caseRow.id);
                    this.cases = this.cases.map((row) =>
                        row.id === caseRow.id
                            ? { ...row, keycloakCollaborators: fresh.collaborators }
                            : row
                    );
                } catch { /* non-fatal */ }
            }
            return { status: data.status, group: data.group };
        };
        let collaborators = caseRow.keycloakCollaborators || [];
        let ownerInfo = caseRow._ownerInfo || null;
        try {
            const fresh = await listCollaborators(caseRow.id);
            collaborators = fresh.collaborators || [];
            if (fresh.owner) ownerInfo = fresh.owner;
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id
                    ? { ...row, keycloakCollaborators: collaborators, _ownerInfo: ownerInfo }
                    : row
            );
        } catch { /* use cached */ }
        const enrichedRow = { ...caseRow, keycloakCollaborators: collaborators, _ownerInfo: ownerInfo };
        let pendingInvites = [];
        try {
            const inv = await listCaseInvites(caseRow.id);
            pendingInvites = inv.invites || [];
        } catch { /* non-fatal */ }
        await dialog.open(this.buildPeopleMembers(enrichedRow), { pendingInvites });
        this.pendingInviteCount = pendingInvites.length;
    }

    closePeopleDialog() {
        this.renderRoot?.querySelector('#case-people-dialog')?.close?.();
    }

    async handlePeopleInvited(event) {
        const caseRow = this.selectedCase;
        if (!caseRow?.id) return;
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');

        try {
            const fresh = await listCollaborators(caseRow.id);
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id
                    ? { ...row, keycloakCollaborators: fresh.collaborators }
                    : row
            );
            const next = this.cases.find((r) => r.id === caseRow.id) || caseRow;
            if (dialog) dialog.members = dialog.sortMembers(this.buildPeopleMembers(next));
        } catch { /* non-fatal */ }
        try {
            const inv = await listCaseInvites(caseRow.id);
            const pendingInvites = inv.invites || [];
            if (dialog) dialog.pendingInvites = pendingInvites;
            this.pendingInviteCount = pendingInvites.length;
            window.dispatchEvent(new CustomEvent('notifications-invalidate'));
        } catch { /* non-fatal */ }
    }

    async handlePeopleApproveInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;

        try {
            const data = await approveCaseInvite(caseRow.id, inviteId);
            await this.handlePeopleInvited({ detail: { status: data.status || 'approved' } });
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog && data.status === 'signup_invite') {
                // Keycloak emails the account-setup link; nobody else ever sees it.
                if (data.emailSent === false) dialog.error = t('people.inviteEmailFailed');
                else dialog.lookupMessage = t('people.inviteApprovedEmailed');
            }
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, t('errors.approveInviteFailed'));
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleRejectInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;

        try {
            await rejectCaseInvite(caseRow.id, inviteId);
            await this.handlePeopleInvited({ detail: { status: 'rejected' } });
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, t('errors.rejectInviteFailed'));
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleSave(event) {
        const caseRow = this.selectedCase;
        if (!caseRow?.id || this.savingCollaborators) return;
        if (!this.canManageCollaborators(caseRow)) return;

        const members = Array.isArray(event.detail?.members) ? event.detail.members : [];

        this.savingCollaborators = true;
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (dialog) {
            dialog.saving = true;
            dialog.error = '';
        }
        try {
            const collaborators = members
                .map((entry) => ({ id: entry?.userId, role: entry?.role || 'collaborator' }))
                .filter((entry) => entry.id);
            const data = await updateCollaborators(caseRow.id, collaborators);
            const next = Array.isArray(data.collaborators) ? data.collaborators : [];
            this.cases = this.cases.map((row) => (
                row.id === caseRow.id ? { ...row, keycloakCollaborators: next } : row
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
            const data = await createComment(caseRow.id, text);
            const c = data.comment;
            const created = c ? {
                id:        c.id,
                body:      c.body,
                createdAt: c.createdAt,
                author_id: c.author_id,
                author:    c.author,
                mentions:  c.mentions || {},
            } : null;
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

    // â”€â”€ New Case form â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
        // updateCase remaps with empty nested collections â€” keep local arrays.
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

    // â”€â”€ Inline case edit â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ Attachment download â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    async handleDownloadAttachment(caseRow, attachment) {
        if (!attachment?.id || this.downloadingAttachmentIds.has(attachment.id)) return;
        if (!this.canEditCaseContent(caseRow)) return;

        const name = attachmentFileName(attachment);
        this.setDownloading(attachment.id, true);
        this.downloadStatusText = t('cases.downloadStarting', { name });
        this.uploadError = '';
        try {
            const url = `${API_URL}/api/cases/${encodeURIComponent(caseRow.id)}/attachments/${encodeURIComponent(attachment.id)}`;
            const res = await fetch(url, { credentials: 'include' });
            if (!res.ok) throw new Error(`Download failed (${res.status})`);
            const blob = await res.blob();
            const blobUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = blobUrl;
            link.download = name;
            document.body.appendChild(link);
            link.click();
            link.remove();
            URL.revokeObjectURL(blobUrl);
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

    // â”€â”€ Attachment delete â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

    // â”€â”€ File upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
     * Upload files to the case one at a time (resumable TUS), with progress shown on the case,
     * after asking what each opens with by default (cancelling that uploads nothing).
     * The server records each attachment when its upload finishes.
     */
    async uploadFiles(caseRow, files) {
        if (!files.length || !caseRow?.id) return;
        if (!this.canEditCaseContent(caseRow)) return;
        const openWith = await this.workflows.askOpenWith(caseRow, files);
        if (!openWith) return;
        this.uploadError = '';
        this.uploadFilesPayload(caseRow, files, openWith);
    }

    async uploadFilesPayload(caseRow, files, openWith = []) {
        // Upload files one at a time, reporting inline progress.
        // The server creates the attachment record in onUploadFinish, so there's no separate attach step.
        for (const [i, file] of files.entries()) {
            if (this.uploadError) break;
            this.uploadingFile = true;
            this.uploadProgress = 0;
            this.uploadStatusText = t('cases.uploadingFile', { name: file.name });
            try {
                await uploadCaseAttachment(caseRow.id, file, {
                    openWith: openWith[i] || undefined,
                    onProgress: (sent, total) => {
                        this.uploadProgress = total > 0 ? sent / total : 0;
                    },
                });
            } catch (err) {
                this.uploadError = this.userFacingError(err, 'Upload failed. Please try again.');
            }
        }
        this.uploadingFile = false;
        this.uploadProgress = 0;
        this.uploadStatusText = '';
        if (!this.uploadError) await this.loadCaseAttachments(caseRow.id);
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

    // â”€â”€ Drag-and-drop attach â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
            sessionScope: VIEWER_SESSION_SCOPES.CASES
        });
        const ping = () => {
            sendViewerHeartbeat({
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                heartbeatUrl,
                includeUserActive: false,
                onIdleTimeout: () => this._handleViewerIdleTimeout()
            }).catch((err) => {
                // Removed from a case whose files this seat held: the server stopped it.
                if (err?.code === 'CASE_ACCESS_LOST') {
                    this._handleCaseAccessLost(err.caseIds?.length ? err.caseIds : [this.selectedCaseId]);
                }
            });
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
            sessionScope: VIEWER_SESSION_SCOPES.CASES
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
    closeViewer() {
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
            history.back(); // popstate fires â†’ _handlePopState â†’ _doCloseViewer
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

    /** Name, size and date; for a file that can't be opened, also why (else only a hover tooltip, out of reach by touch or keyboard). */
    attachmentMetaLine(attachment) {
        const originalName = attachment.filenameDownload || '';
        const size = formatBytes(attachment.filesize);
        const modified = formatDateTime(attachment.modifiedAt);
        const details = [originalName, size, modified].filter(Boolean).join(' - ');
        if (this.attachmentCanActivate(attachment)) return details;
        return [details, this.attachmentOpenTitle(attachment)].filter(Boolean).join(' · ');
    }

    attachmentTitle(attachment) {
        return String(attachment?.name || attachment?.filenameDownload || 'Attachment');
    }

    filterAttachments(attachments = [], query = this.attachmentSearchQuery) {
        return filterByText(attachments, query, (row) => [this.attachmentTitle(row), row?.filenameDownload]);
    }

    sortAttachments(attachments = [], order = this.attachmentSortOrder) {
        return sortRows(attachments, order, { titleOf: (row) => this.attachmentTitle(row), timeOf: (row) => row?.modifiedAt });
    }

    caseTitle(caseRow) {
        return String(caseRow?.title || t('cases.untitled'));
    }

    filterCases(cases = [], query = this.caseSearchQuery) {
        return filterByText(cases, query, (row) => [this.caseTitle(row), row?.description]);
    }

    sortCases(cases = [], order = this.caseSortOrder) {
        return sortRows(cases, order, { titleOf: (row) => this.caseTitle(row), timeOf: (row) => this.caseLastModifiedAt(row) });
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

    attachmentOpenTitle(attachment, openWith) {
        if (attachment?.canOpenInSlicer) return t('cases.openWithWorkflow', { name: openWith.name });
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
        this.iframeUrl = 'about:blank';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerClosing = false;
        this.currentFileName = '';
        this._slicerWebRun += 1; // cancels any in-flight SlicerWeb load
        this._viewerOpenId += 1; // orphans any in-flight open request
        this._slicerWebPending = null;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.openingAttachmentId = '';
        this.hasUnsavedChanges = false;
        this.isSavingScene = false;
        this.saveIndicatorMessage = '';
        if (this._mcsSaveResolver) { this._mcsSaveResolver(null); this._mcsSaveResolver = null; }
        this._mcsSaveDefaultName = '';
    }

    /** Open a file in Full Slicer, with the chosen workflow's startup configuration ({}: none). */
    async handleOpenAttachment(caseRow, attachment, { startupConfig = {} } = {}) {
        if (this.openingAttachmentId) return;

        if (attachment?.canPreviewInBrowser && !attachment?.canOpenInSlicer) {
            this.errorMessage = t('cases.browserPreviewNote');
            return;
        }
        if (!attachment?.canOpenInSlicer) return;

        const useSimplified = startupConfig.module === SIMPLIFIED_VIEWER_MODULE;
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
            const data = await openPayloadAttachmentFullSlicer(caseRow.id, attachment.id, {
                startupConfig
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
                sessionScope: VIEWER_SESSION_SCOPES.CASES,
                simplified: this.viewerSimplified,
                embed: true,
                quick: false
            });
            markViewerActivity();
            this.startHeartbeat();
            this.viewerLoading = true;
            this.viewerLoadingDetail = t('cases.openingViewerReady', { viewer: viewerLabel });
            this.openingAttachmentId = '';

            this._pushViewerHistory(caseRow.id);
        } catch (err) {
            if (isSuperseded()) return;
            this.clearViewerUiState();
            this.errorMessage = this.userFacingError(err, "Couldn't open the viewer. Please try again.");
        }
    }

    /** The SlicerWeb channel this person launches: their Settings choice, or the app default. */
    slicerWebChannel() {
        return resolveSlicerWebChannel(getCachedUserPreferences().slicerWebChannel);
    }

    /**
     * The case toolbar's ⋯ menu: Workflows (everyone; with the count of requests waiting for
     * admins), Edit details (editors) and Settings (admins). People keeps its own button.
     */
    caseActions(caseRow, { canEdit, canManage }) {
        return [
            this.workflows.actionItem(caseRow),
            ...(canEdit && !this.editingCase && !this.archivingCase ? [{ key: 'edit', label: t('cases.editDetails') }] : []),
            ...(canManage ? [{ key: 'settings', label: t('caseSettings.open') }] : []),
        ];
    }

    onCaseAction(caseRow, key) {
        if (key === 'workflows') this.workflows.openPanel(caseRow);
        else if (key === 'edit') this.startEditCase(caseRow);
        else if (key === 'settings') this.showCaseSettings = true;
    }

    /** Launch a file (attachment null: the blank viewer) in its viewer, with its workflow on top. */
    openWith(caseRow, attachment, { viewer, workflow }) {
        if (viewer === VIEWER.FULL) return this.handleOpenAttachment(caseRow, attachment, { startupConfig: workflow?.startupConfig || {} });
        const params = workflow ? { extensions: workflow.extensions, module: workflow.startupConfig.module } : {};
        return attachment ? this.handleOpenSlicerWeb(caseRow, attachment, params) : this.handleOpenBlankSlicerWeb(caseRow, params);
    }

    /**
     * SlicerWeb URL for this person's channel, with a workflow's extensions and start module ({}:
     * SlicerWeb's defaults). The installed build's SHA goes in as ?v= so a new build skips any
     * stale service-worker cache. Extensions earlier launches left installed are forgotten first,
     * so only the workflow's load.
     */
    async _slicerWebUrl(params = {}) {
        resetSlicerWebExtensions();
        const channel = this.slicerWebChannel();
        const statusData = await fetch('/api/slicerweb/status', { credentials: 'include' })
            .then((r) => r.ok ? r.json() : null)
            .catch(() => null);
        const sha = statusData?.[channel] ?? null;
        return buildSlicerWebUrl({ channel, sha, ...params });
    }

    async handleOpenSlicerWeb(caseRow, attachment, slicerWebParams) {
        if (this.openingAttachmentId || !attachment?.canOpenInSlicer) return;

        this._viewerOpenId += 1;
        this._focusBeforeViewer = deepActiveElement();
        this.errorMessage = '';
        this.currentFileName = attachmentFileName(attachment);
        this.viewerKind = VIEWER_KINDS.SLICERWEB;
        this.viewerSimplified = false;
        this.viewerLoading = true;
        this.showIframe = true;
        this.currentAttachmentId = attachment.id;
        this.selectedCaseId = caseRow.id;

        // For the latest channel: open immediately with whatever is installed.
        // A background download may already be in progress (started on page load).
        // When it finishes, a toast notifies the user so they can reopen for the new version.

        this.viewerLoadingDetail = t('cases.openingSlicerWeb');
        this.showIframe = true;
        this._slicerWebRun += 1;
        // Download while the runtime starts; both are awaited in loadPendingIntoSlicerWeb.
        const download = fetchPayloadAttachmentContent(caseRow.id, attachment.id);
        download.catch(() => {}); // surfaced when awaited
        this._slicerWebPending = {
            download, fileName: this.currentFileName, module: slicerWebParams?.module,
            caseRow, attachment, extensions: slicerWebParams?.extensions || [], // for a failed load's "Open with …"
        };

        this.iframeUrl = await this._slicerWebUrl(slicerWebParams);

        this._pushViewerHistory(caseRow.id);

        // If the iframe is already loaded and the bridge is ready, kick off loading
        // immediately — the @load event won't fire again since the URL hasn't changed.
        const iframe = this.renderRoot?.querySelector('.viewer-iframe');
        if (iframe) {
            try {
                const bridge = iframe.contentWindow?.slicerWeb;
                if (bridge?.store?.status === 'ready') {
                    this.loadPendingIntoSlicerWeb(iframe);
                }
            } catch (_) {}
        }
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

            // Blank mode: SlicerWeb is ready with no file to load.
            if (pending.blank) {
                if (cancelled()) return;
                await this._selectStartModule(slicer, pending.module);
                this._slicerWebPending = null;
                this.viewerLoading = false;
                this.viewerLoadingDetail = '';
                this._attachSlicerWebSaveHandler(slicer, { blank: true });
                this.attachIframeActivityTracking();
                return;
            }

            // Patch rawCall to queue behind any active JSPI call. Autosave fires sync
            // rawCall on a 1s interval; calling sync Python while JSPI is active crashes
            // Pyodide fatally. Must be applied after bridge is ready, not at iframe load.
            try {
                const rawBridge = slicer.bridge;
                if (rawBridge?.rawCall && !rawBridge._rawCallPatched) {
                    const origRawCall = rawBridge.rawCall.bind(rawBridge);
                    rawBridge.rawCall = function rawCallSafe(methodName, argsJson) {
                        if (rawBridge.suspendableCalls > 0) {
                            return new Promise((resolve) => {
                                const poll = () => {
                                    if (rawBridge.suspendableCalls === 0) {
                                        resolve(origRawCall(methodName, argsJson));
                                    } else {
                                        setTimeout(poll, 50);
                                    }
                                };
                                setTimeout(poll, 50);
                            });
                        }
                        return origRawCall(methodName, argsJson);
                    };
                    rawBridge._rawCallPatched = true;
                }
            } catch (_) {}

            this.viewerLoadingDetail = t('cases.loadingIntoSlicerWeb', { name: pending.fileName });

            // status='ready' fires before session-restore runs; give it a moment to settle.
            await new Promise((r) => setTimeout(r, 1000));
            if (cancelled()) return;

            let blob;
            try {
                blob = await pending.download;
            } catch (err) {
                throw new Error(err?.message || t('errors.slicerLoadFailed'));
            }
            if (cancelled()) return;

            const cw = frame.contentWindow;

            const writtenPaths = await cw.slicerWeb.writeFiles([new File([blob], pending.fileName)]);
            if (cancelled()) return;

            const filePaths = Array.isArray(writtenPaths) ? writtenPaths : [writtenPaths];
            // loadFiles returns [] for MRB (unknown node types) and MCS/MXP (zero confidence
            // in WASM). Use evalPython for these; everything else goes through loadFiles.
            const needsPython = /\.(mrb|mcs|mxp)$/i.test(pending.fileName);
            let loadResult;
            // What Slicer said while loading: its log and stderr (the ITK error behind an
            // unrecognised format only goes there), SlicerWeb's alert() for reader errors (caught
            // by handleViewerIframeLoad), and what the Python path collects itself.
            const loadMessages = [];
            cw._slicerAlertMessage = null;
            const stopListening = ['log', 'stderr'].map((name) => slicer.bridge.events?.on?.(name,
                (entry) => loadMessages.push(typeof entry === 'string' ? entry : entry?.message)));
            try {
                if (needsPython) {
                    const safePath = filePaths[0].replace(/\\/g, '/').replace(/'/g, "\\'");
                    // .mcs/.mxp go to SlicerHeart's MimicsProject reader by name (its confidence is
                    // zero in WASM). Only if that fails (no SlicerHeart) does Slicer pick the reader,
                    // as desktop Slicer would, so a missing extension shows up in its messages.
                    await slicer.bridge.callYielding('evalPython', [[
                        'import slicer, os, vtk',
                        'slicer.mrmlScene.Clear(False)',
                        '_sw_exc = None',
                        '_sw_ok = True',
                        '_sw_msgs = slicer.vtkMRMLMessageCollection()',
                        '_sw_io = slicer.app.coreIOManager()',
                        '_sw_fallback = False',
                        `_sw_path = '${safePath}'`,
                        'try:',
                        '    if os.path.splitext(_sw_path)[1].lower() in (".mrb", ".mrml"):',
                        '        slicer.util.loadScene(_sw_path)',
                        '    elif not _sw_io.loadNodes("MimicsProject", {"fileName": _sw_path}, vtk.vtkCollection(), _sw_msgs):',
                        '        _sw_fallback = True',
                        '        _sw_msgs = slicer.vtkMRMLMessageCollection()',
                        '        _sw_ok = bool(_sw_io.loadFiles([_sw_path], {}, _sw_msgs))',
                        'except Exception as _e:',
                        '    _sw_exc = str(_e)',
                        '_sw_ids = [n.GetID() for i in range(slicer.mrmlScene.GetNumberOfNodes()) for n in [slicer.mrmlScene.GetNthNode(i)] if n] if _sw_ok else []',
                        '_sw_messages = _sw_msgs.GetAllMessagesAsString()',
                    ].join('\n'), 'exec']);
                    const idsRepr = await slicer.bridge.call('evalPython', ['_sw_ids', 'eval']);
                    const excRepr = await slicer.bridge.call('evalPython', ['_sw_exc', 'eval']);
                    if (excRepr !== 'None') {
                        console.warn('[SW-load] warning (non-fatal):', excRepr);
                        loadMessages.push(excRepr);
                    }
                    loadMessages.push(await slicer.bridge.call('evalPython', ['_sw_messages', 'eval']));
                    if (await slicer.bridge.call('evalPython', ['_sw_fallback', 'eval']) === 'True') {
                        console.warn('[SW-load] MimicsProject reader failed or missing; let Slicer pick a reader. Said:', loadMessages.join('\n'));
                    }
                    loadResult = parseNodeIdsRepr(idsRepr);
                } else {
                    await slicer.bridge.callYielding('closeScene', []);
                    if (cancelled()) return;
                    loadResult = await slicer.bridge.callYielding('loadFiles', [filePaths]);
                }
            } catch (loadErr) {
                console.error('[SW-load] load threw:', loadErr);
                throw loadErr;
            } finally {
                stopListening.forEach((stop) => stop?.());
            }
            if (cancelled()) return;

            loadMessages.push(cw._slicerAlertMessage);
            cw._slicerAlertMessage = null;
            if (!Array.isArray(loadResult) || loadResult.length === 0) {
                const said = loadMessages.filter(Boolean).join('\n');
                console.warn('[SW-load] nothing loaded. Slicer said:', said);
                if (isUnrecognisedFormat(said)) throw new UnrecognisedFormatError(said);
                throw new Error(t('errors.slicerLoadFailed'));
            }

            await new Promise((r) => setTimeout(r, 500));
            if (!cancelled()) {
                try {
                    await slicer.bridge.call('resetViews', []);
                } catch (e) {
                    console.warn('[SlicerWeb] resetViews failed:', e);
                    try { await slicer.bridge.call('fitSlicesToBackground', []); } catch (e2) {
                        console.warn('[SlicerWeb] fitSlicesToBackground failed:', e2);
                    }
                }
                await this._selectStartModule(slicer, pending.module);
            }

            this._slicerWebPending = null;
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this._attachSlicerWebSaveHandler(slicer);
            this.attachIframeActivityTracking();
        } catch (err) {
            console.error('[SW] caught error:', err);
            if (cancelled()) return;
            const rawErr = err?.message || String(err || '');
            const errorInfo = err instanceof UnrecognisedFormatError ? this._unrecognisedFormatError(pending)
                : rawErr ? this.viewerLoadError(rawErr)
                : { title: t('errors.slicerLoadFailedTransientTitle'), message: t('errors.openViewerFailed') };
            this._viewerPushedState = false;
            await this._doCloseViewer();
            this._replaceUrlWithCase();
            this.showErrorDialog(errorInfo);
        }
    }

    /** The workflow's start module, shown once the file has loaded (see selectModulePython). Never fails the open. */
    async _selectStartModule(slicer, module) {
        const code = selectModulePython(module);
        if (!code) return;
        try {
            await slicer.bridge.call('evalPython', [code, 'exec']);
        } catch (err) {
            console.warn(`[SlicerWeb] could not open the start module ${module}:`, err);
        }
    }

    viewerLoadError(rawError) {
        return classifySlicerLoadError(rawError);
    }

    /**
     * A file whose format wasn't recognised may need an extension: offer this case's workflows
     * that add one the launch didn't have, as "Open with …" (docs/workflows-design.md › When a
     * file needs an extension).
     */
    _unrecognisedFormatError({ caseRow, attachment, extensions }) {
        const { usable } = this.workflows.openWithFor(caseRow, attachment);
        const offered = workflowsAddingExtensions(usable.caseWorkflows, extensions);
        if (!offered.length) return { title: t('errors.unrecognisedFormatTitle'), message: t('errors.unrecognisedFormatAskAdmin') };
        const offer = {
            fileName: this.attachmentTitle(attachment),
            usable: { caseWorkflows: offered, mine: [] },
            selectedKey: offered[0].key,
            open: (key) => this.workflows.openChoice(caseRow, attachment, key),
            more: () => this.workflows.openMore(caseRow, attachment, offer, offer.fileName),
        };
        return { title: t('errors.unrecognisedFormatTitle'), message: t('errors.unrecognisedFormatTryWorkflows'), offer };
    }

    /**
     * The viewer error dialog. `offer` ({ fileName, usable, selectedKey, open(key), more() }) turns
     * Close into "Open with <first>": a button, or with more than one, a menu of them with the
     * first checked, and "More workflows…" (which replaces this dialog, rather than open on top) past MENU_LIMIT.
     */
    showErrorDialog({ title, message, offer = null }) {
        this.errorDialogTitle = title || '';
        this.errorDialogMessage = message || '';
        this.errorDialogOffer = offer;
        const dialog = this.renderRoot?.querySelector('#viewer-error-dialog');
        if (dialog) {
            queueMicrotask(() => dialog.openDialog?.());
        } else {
            this.errorMessage = [title, message].filter(Boolean).join(': ');
        }
    }

    _attachSlicerWebSaveHandler(slicer, { blank = false } = {}) {
        try {
            const iframe = this.renderRoot?.querySelector('.viewer-iframe');
            if (iframe?.contentWindow) {
                iframe.contentWindow.prompt = () => this.currentFileName || 'scene.mrb';
            }
        } catch (_) {}

        slicer.saveHandler = async (path) => {
            if (!this.selectedCaseId || this.isSavingScene) return;
            if (!blank && !this.currentAttachmentId) return;
            const caseId = this.selectedCaseId;
            this.isSavingScene = true;
            try {
                const [file] = await slicer.readFiles([path]);
                if (blank && !this.currentAttachmentId) {
                    // Prompt for a filename on the first save from blank mode since we don't
                    // know what file (if any) the user loaded into the viewer themselves.
                    const defaultName = this.currentFileName
                        ? this.currentFileName.replace(/\.[^.]+$/, '')
                        : '';
                    const name = await this.promptSaveAsNewName(defaultName);
                    if (!name) return; // user cancelled
                    this._runBackgroundSave(file, {
                        caseId,
                        attachmentId: null,
                        saveMode: 'saveAsNew',
                        name,
                        onNewAttachment: (attachment) => {
                            if (!this.currentAttachmentId) {
                                this.currentAttachmentId = attachment.id;
                                this.currentFileName = attachment.filenameDownload || attachment.name || name;
                            }
                        }
                    });
                } else if (this._isMcsFileName(this.currentFileName)) {
                    const mrbName = this.currentFileName.replace(/\.mcs$/i, '.mrb');
                    const choice = await this.promptMcsSave(mrbName);
                    if (!choice) return; // user cancelled
                    const attachmentId = this.currentAttachmentId;
                    this._runBackgroundSave(file, {
                        caseId,
                        attachmentId,
                        saveMode: choice === 'overwrite' ? 'overwrite' : 'saveAsNew',
                        name: mrbName,
                        onNewAttachment: (attachment) => {
                            this.currentAttachmentId = attachment.id;
                            this.currentFileName = attachment.filenameDownload || attachment.name || mrbName;
                        },
                    });
                } else {
                    this._runBackgroundSave(file, { caseId, attachmentId: this.currentAttachmentId, saveMode: 'overwrite', name: this.currentFileName || undefined });
                }
            } catch (err) {
                this.errorMessage = this.userFacingError(err, t('errors.saveSceneFailed'));
            } finally {
                this.isSavingScene = false;
            }
        };
    }

    async _writeSlicerWebScene() {
        const iframe = this.renderRoot?.querySelector('.viewer-iframe');
        const slicer = iframe?.contentWindow?.slicerWeb;
        if (!slicer) throw new Error(t('errors.saveSceneFailed'));
        const savePath = '/data/save/scene.mrb';
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

    _runBackgroundSave(file, { caseId, attachmentId, saveMode, name, onNewAttachment, _attempt = 1 } = {}) {
        const prev = this._backgroundSave;
        if (prev?.abortCtrl && saveMode === 'overwrite' && prev.saveMode === 'overwrite' && prev.attachmentId === attachmentId) {
            prev.abortCtrl.abort();
        }
        const abortCtrl = new AbortController();
        this._backgroundSave = { file, caseId, attachmentId, saveMode, name, onNewAttachment, error: null, abortCtrl };
        this.hasUnsavedChanges = false;
        const openWith = this._attachment(caseId, attachmentId)?.openWith || undefined;
        savePayloadSlicerWebScene(caseId, attachmentId, file, { saveMode, name, openWith, signal: abortCtrl.signal })
            .then((result) => {
                if (abortCtrl.signal.aborted) return;
                this._backgroundSave = null;
                if (result?.attachment) {
                    const normalized = this.normalizePayloadAttachment(result.attachment);
                    this.cases = this.cases.map((c) => {
                        if (c.id !== caseId) return c;
                        if (!Array.isArray(c.attachments)) return c;
                        const attachments = saveMode === 'saveAsNew'
                            ? [...c.attachments, normalized]
                            : c.attachments.map((a) => a.id === attachmentId ? normalized : a);
                        return { ...c, attachments };
                    });
                    if (typeof onNewAttachment === 'function') {
                        onNewAttachment(normalized);
                    }
                }
                const msg = saveMode === 'saveAsNew' ? t('files.savedAsNew') : t('files.saved');
                if (this.showIframe) {
                    this.showSaveIndicator(msg);
                } else {
                    this.showToast(msg);
                }
            })
            .catch((err) => {
                if (err?.name === 'AbortError') return;
                if (_attempt < 2) {
                    setTimeout(() => {
                        if (this._backgroundSave && !this._backgroundSave.error) {
                            this._runBackgroundSave(file, { caseId, attachmentId, saveMode, name, onNewAttachment, _attempt: _attempt + 1 });
                        }
                    }, 2000);
                    return;
                }
                const error = this.userFacingError(err, t('errors.saveSceneFailed'));
                this._backgroundSave = { ...this._backgroundSave, error };
                // Make the failure hard to miss: the scene counts as unsaved again (Save is
                // enabled) and, if the viewer was closed meanwhile, a toast says so.
                this.hasUnsavedChanges = true;
                if (!this.showIframe) this.showToast(error);
            });
    }

    _retryBackgroundSave() {
        if (!this._backgroundSave) return;
        const { file, caseId, attachmentId, saveMode, name } = this._backgroundSave;
        this._runBackgroundSave(file, { caseId, attachmentId, saveMode, name, _attempt: 1 });
    }

    async saveCurrentScene(mode = 'overwrite', name) {
        if (!this.selectedCaseId) return false;
        const isBlankSlicerWeb = this.viewerKind === VIEWER_KINDS.SLICERWEB && !this.currentAttachmentId;
        if (!this.currentAttachmentId && !isBlankSlicerWeb) return false;
        if (this.isSavingScene) return false;

        if (this.viewerKind === VIEWER_KINDS.SLICER_GUI) {
            this.errorMessage = t('errors.saveSceneFailed');
            return false;
        }

        this.isSavingScene = true;
        try {
            if (mode === 'overwrite' && this.currentAttachmentId && !this.hasUnsavedChanges && this._lastSavedAttachmentId === this.currentAttachmentId) {
                this.isSavingScene = false;
                this.showSaveIndicator(t('files.saved'));
                return true;
            }
            const caseId = this.selectedCaseId;
            const attachmentId = this.currentAttachmentId;
            const file = await this._writeSlicerWebScene();
            if (isBlankSlicerWeb) {
                const defaultName = (this.currentFileName || name || '')
                    .replace(/\.[^.]+$/, '');
                const saveName = await this.promptSaveAsNewName(defaultName);
                if (!saveName) { this.isSavingScene = false; return false; }
                this._runBackgroundSave(file, {
                    caseId,
                    attachmentId: null,
                    saveMode: 'saveAsNew',
                    name: saveName,
                    onNewAttachment: (attachment) => {
                        if (!this.currentAttachmentId) {
                            this.currentAttachmentId = attachment.id;
                            this.currentFileName = attachment.filenameDownload || attachment.name || saveName;
                        }
                    }
                });
            } else if (mode === 'overwrite' && this._isMcsFileName(this.currentFileName)) {
                const mrbName = this.currentFileName.replace(/\.mcs$/i, '.mrb');
                const choice = await this.promptMcsSave(mrbName);
                if (!choice) { return false; }
                this._runBackgroundSave(file, {
                    caseId,
                    attachmentId,
                    saveMode: choice === 'overwrite' ? 'overwrite' : 'saveAsNew',
                    name: mrbName,
                    onNewAttachment: (attachment) => {
                        this.currentAttachmentId = attachment.id;
                        this.currentFileName = attachment.filenameDownload || attachment.name || mrbName;
                    },
                });
            } else {
                const saveName = mode === 'overwrite' ? (this.currentFileName || name) : name;
                this._runBackgroundSave(file, { caseId, attachmentId, saveMode: mode, name: saveName });
            }
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
        requestAnimationFrame(() => {
            const input = dialog?.querySelector('#save-as-new-name');
            if (input) { input.focus(); input.select(); }
        });
        return new Promise((resolve) => {
            this._saveAsNewResolver = resolve;
        });
    }

    finishSaveAsNew(confirmed) {
        let name = confirmed ? (this._saveAsNewName || '').trim() : null;
        if (name && !name.includes('.')) name = `${name}.mrb`;
        this.renderRoot?.querySelector('#save-as-new-dialog')?.closeDialog();
        const resolver = this._saveAsNewResolver;
        this._saveAsNewResolver = null;
        if (resolver) resolver(name);
    }

    _isMcsFileName(fileName) {
        return typeof fileName === 'string' && fileName.toLowerCase().endsWith('.mcs');
    }

    promptMcsSave(mrbName) {
        this._mcsSaveDefaultName = mrbName;
        this._mcsSaveResolver = null;
        this.renderRoot?.querySelector('#save-mcs-dialog')?.openDialog();
        return new Promise((resolve) => {
            this._mcsSaveResolver = resolve;
        });
    }

    finishMcsSave(choice) {
        this.renderRoot?.querySelector('#save-mcs-dialog')?.closeDialog();
        const resolver = this._mcsSaveResolver;
        this._mcsSaveResolver = null;
        if (resolver) resolver(choice ?? null);
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
            const domEvents = ['pointerdown', 'input', 'change', 'wheel'];
            domEvents.forEach((ev) => iframeDoc.addEventListener(ev, markDirty, true));
            this.iframeActivityCleanup = () => {
                domEvents.forEach((ev) => iframeDoc.removeEventListener(ev, markDirty, true));
            };
        } catch (_) {}
    }

    async handleOpenBlankSlicerWeb(caseRow, slicerWebParams) {
        if (this.viewerLoading || this.openingAttachmentId) return;

        this._viewerOpenId += 1;
        this._focusBeforeViewer = deepActiveElement();
        this.errorMessage = '';
        this.currentFileName = '';
        this.currentAttachmentId = '';
        this.viewerKind = VIEWER_KINDS.SLICERWEB;
        this.viewerSimplified = false;
        this.viewerLoading = true;
        this.showIframe = true;
        this.selectedCaseId = caseRow.id;

        this.viewerLoadingDetail = t('cases.openingSlicerWeb');
        this._slicerWebRun += 1;
        this._slicerWebPending = { blank: true, module: slicerWebParams?.module };

        this.iframeUrl = await this._slicerWebUrl(slicerWebParams);

        this._pushViewerHistory(caseRow.id);
    }

    handleViewerIframeLoad(event) {
        if (this.viewerKind === VIEWER_KINDS.SLICERWEB) {
            try {
                const cw = event?.target?.contentWindow;
                if (cw) {
                    cw.confirm = () => false;
                    cw._slicerAlertMessage = null;
                    cw.alert = (msg) => { cw._slicerAlertMessage = String(msg ?? ''); };
                }
            } catch (_) {}
            this.loadPendingIntoSlicerWeb(event?.target);
            return;
        }
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        markViewerActivity();
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
                    <form slot="content" class="form-panel" @submit=${(e) => this.handleNewCaseSubmit(e)} novalidate>
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

                        <div class="form-actions is-sticky">
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
                    <p slot="content" class="empty-filter">No cases match “${this.caseSearchQuery.trim()}”.</p>
                ` : ''}

                ${!this.loading && filteredCases.length > 0 ? html`
                    <div slot="content" class="card-grid">
                        ${filteredCases.map((row) => {
                            const isArchived = row.status === 'archived';
                            const modifiedLabel = this.caseLastModifiedLabel(row);
                            const newCommentCount = this.countNewCaseComments(row);
                            return html`
                                <button
                                    class=${isArchived ? 'card is-archived' : 'card'}
                                    type="button"
                                    @click=${() => this.openCase(row.id)}
                                >
                                    <div class="card-title-row">
                                        <span class="card-title">${row.title || t('cases.untitled')}</span>
                                        ${newCommentCount > 0 ? html`
                                            <span
                                                class="card-badge"
                                                title=${newCommentCount === 1
                                                    ? t('cases.oneNewComment')
                                                    : t('cases.nNewComments', { n: newCommentCount })}
                                            >${newCommentCount === 1 ? t('cases.badgeNew') : t('cases.badgeNNew', { n: newCommentCount })}</span>
                                        ` : ''}
                                    </div>
                                    ${row.description ? html`
                                        <p class="card-desc">${row.description}</p>
                                    ` : ''}
                                    ${modifiedLabel ? html`
                                        <div class="card-meta-row">
                                            <span class="card-meta-item">${modifiedLabel}</span>
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
        return this.renderCaseShell(html`
                <div slot="content" class="case-detail">
                    <div class="detail-toolbar">
                        <button class="back-link" type="button" @click=${() => this.backToCaseList()}>
                            ${t('cases.backToList')}
                        </button>
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
                            <overflow-menu
                                label=${t('cases.moreActions')}
                                .items=${this.caseActions(caseRow, { canEdit, canManage })}
                                @menu-select=${(e) => this.onCaseAction(caseRow, e.detail.key)}
                            ></overflow-menu>
                        </div>
                    </div>

                    ${this.editingCase ? html`
                        <form class="form-panel" @submit=${(e) => { e.preventDefault(); this.saveEditCase(caseRow); }} novalidate>
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
                            <div class="form-actions is-sticky">
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
                        <div class="list-panel">
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
                                class="list-panel-body ${this.attachmentDragOver ? 'drag-over' : ''}"
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
                                    <div class="list-panel-items">
                                        ${attachments.map((attachment) => {
                                            const openWith = this.workflows.openWithFor(caseRow, attachment);
                                            return html`
                                            <file-list-row
                                                .fileName=${this.attachmentTitle(attachment)}
                                                .metaLine=${this.attachmentMetaLine(attachment)}
                                                .nameButtonDisabled=${!this.attachmentCanActivate(attachment)
                                                    || !!this.openingAttachmentId
                                                    || this.viewerLoading}
                                                .nameButtonTitle=${this.attachmentOpenTitle(attachment, openWith)}
                                                @name-click=${() => this.openWith(caseRow, attachment, openWith)}
                                            >
                                                ${attachment?.canOpenInSlicer ? html`
                                                    <span slot="actions" class="open-with-split">
                                                        <button
                                                            class="open-with-icon"
                                                            type="button"
                                                            title=${openWith.name}
                                                            aria-label=${t('cases.openFileWith', { file: this.attachmentTitle(attachment), name: openWith.name })}
                                                            ?disabled=${!!this.openingAttachmentId || this.viewerLoading}
                                                            @click=${() => this.openWith(caseRow, attachment, openWith)}
                                                        >${iconTile(openWith.icon.name, openWith.icon.src)}</button>
                                                        ${this.workflows.renderMenu(caseRow, attachment, openWith)}
                                                    </span>
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
                                                        ` : ICON_DOWNLOAD}
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
                                                        ${ICON_TRASH}
                                                    </button>
                                                ` : ''}
                                            </file-list-row>
                                        `;
                                        })}
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
                                        <div class="upload-action-buttons">
                                            <button
                                                class="secondary-button"
                                                type="button"
                                                ?disabled=${!!this.openingAttachmentId}
                                                @click=${() => this.triggerFileUpload()}
                                            >
                                                ${t('cases.addFile')}
                                            </button>
                                            ${this.workflows.renderBlankViewerButton(caseRow)}
                                        </div>
                                    </div>
                                ` : ''}
                            </div>
                        </div>

                        <comments-panel
                            .comments=${comments}
                            .collaborators=${[
                                ...(caseRow._ownerInfo?.id ? [caseRow._ownerInfo] : []),
                                ...(caseRow.keycloakCollaborators || []),
                            ]
                                .filter((c, i, all) => c.id && c.type !== 'group' && all.findIndex((x) => x.id === c.id) === i)
                                .map((c) => ({
                                    id:        c.id,
                                    name:      c.displayName || [c.firstName, c.lastName].filter(Boolean).join(' ') || c.email || c.id,
                                    avatarUrl: c.avatarUrl || null,
                                }))}
                            emptyMessage=${this.sessionMeta?.comments?.loaded === false
                                ? t('cases.commentsLoadFailed')
                                : t('cases.noComments')}
                            placeholder=${t('cases.writeComment')}
                            ?posting=${this.postingComment}
                            ?allowCompose=${canComment}
                            @post-comment=${(e) => this.handlePostComment(e, caseRow)}
                        ></comments-panel>
                    </div>
                </div>
        `);
    }

    /** The signed-in page around a case or its settings. */
    renderCaseShell(content) {
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
            >${content}</page-layout-template>
        `;
    }

    renderCaseSettings(caseRow) {
        return this.renderCaseShell(html`
            <div slot="content" class="case-detail">
                <case-settings
                    .caseId=${String(caseRow.id)}
                    .caseTitle=${caseRow.title || ''}
                    .data=${this.workflows.dataFor(caseRow.id)}
                    ?loadFailed=${this.workflows.loadFailed(caseRow.id)}
                    @back=${() => { this.showCaseSettings = false; }}
                    @workflows-changed=${() => this.workflows.load(caseRow.id, { refresh: true })}
                    @open-workflows=${() => this.workflows.openPanel(caseRow)}
                ></case-settings>
            </div>
        `);
    }

    renderViewerOverlay() {
        if (!this.showIframe) return html``;
        const viewerLabel = viewerDisplayName(this.viewerKind, {
            simplified: this.viewerSimplified
        });
        const viewerTitle = this.currentFileName
            ? `${viewerLabel}: ${this.currentFileName}`
            : viewerLabel;
        const isSlicerWeb = this.viewerKind === VIEWER_KINDS.SLICERWEB;
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
                        ${this._backgroundSave?.error ? html`
                            <span class="viewer-error-message" role="alert">${this._backgroundSave.error}</span>
                            <button class="secondary-button" type="button" @click=${() => this._retryBackgroundSave()}>
                                ${t('files.retrySave')}
                            </button>
                        ` : ''}
                        ${isSlicerWeb ? html`
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.viewerLoading || this.iframeUrl === 'about:blank' || this.isSavingScene || (!!this.currentAttachmentId && !this.hasUnsavedChanges)}
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
                <div class="iframe-container">
                    ${this.iframeUrl !== 'about:blank' ? html`
                        <iframe
                            class="viewer-iframe"
                            title=${viewerTitle}
                            src="${this.iframeUrl}"
                            allow="clipboard-read; clipboard-write; cross-origin-isolated"
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
            <app-dialog
                id="save-mcs-dialog"
                .title=${t('files.saveMcsTitle')}
                .lightDismiss=${false}
            >
                <p style="margin:0 0 0.75rem">${t('files.saveMcsBody')}</p>
                <p style="margin:0 0 0.25rem"><strong>${this._mcsSaveDefaultName}</strong></p>
                <button slot="actions" class="secondary-button" type="button"
                    @click=${() => this.finishMcsSave(null)}>
                    ${t('common.cancel')}
                </button>
                <button slot="actions" class="secondary-button" type="button"
                    @click=${() => this.finishMcsSave('saveAsNew')}>
                    ${t('files.saveMcsPreserve')}
                </button>
                <button slot="actions" class="primary-button" type="button"
                    @click=${() => this.finishMcsSave('overwrite')}>
                    ${t('files.saveMcsReplace')}
                </button>
            </app-dialog>
            <app-dialog
                id="save-as-new-dialog"
                .title=${t('files.saveAsNewTitle')}
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
        `;
    }

    renderViewerErrorDialog() {
        const close = () => this.renderRoot?.querySelector('#viewer-error-dialog')?.closeDialog();
        const offer = this.errorDialogOffer;
        const then = (next) => { close(); next(); };
        const workflows = offer?.usable.caseWorkflows || [];
        const openFirst = workflows.length ? t('cases.openWithWorkflow', { name: workflows[0].name }) : '';
        return html`
            <app-dialog id="viewer-error-dialog" .title=${this.errorDialogTitle} .message=${this.errorDialogMessage}>
                ${workflows.length > 1 ? html`
                    <open-with-menu
                        slot="actions"
                        .buttonLabel=${openFirst}
                        .fileName=${offer.fileName}
                        .usable=${offer.usable}
                        .selectedKey=${offer.selectedKey}
                        @open-workflow=${(e) => then(() => offer.open(e.detail.key))}
                        @more-workflows=${() => then(offer.more)}
                    ></open-with-menu>
                ` : workflows.length ? html`
                    <button slot="actions" class="primary-button" type="button" @click=${() => then(() => offer.open(offer.selectedKey))}>${openFirst}</button>
                ` : html`
                    <button slot="actions" class="secondary-button" type="button" @click=${close}>${t('common.close')}</button>
                `}
            </app-dialog>
        `;
    }

    render() {
        const detail = this.selectedCase;
        return html`
            ${!detail ? this.renderLanding() : this.showCaseSettings ? this.renderCaseSettings(detail) : this.renderCaseDetail(detail)}
            ${this.renderViewerOverlay()}
            ${this.workflows.renderDialogs(detail)}
            ${this.renderViewerErrorDialog()}
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

customElements.define('cases-page', CasesPage);
