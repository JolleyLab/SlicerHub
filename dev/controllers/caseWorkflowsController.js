import { html } from 'lit-element';
import { t } from '../i18n/index.js';
import { listCaseWorkflows, loadExtensionCatalog } from '../services/workflows.js';
import {
    VIEWER, NO_WORKFLOW, viewerFromAccount, usableWorkflows, resolveOpen, readOpenPick, saveOpenPick,
} from '../utils/openWith.js';
import '../components/open-with-menu.js';
import '../components/case-workflows-panel.js';
import '../components/more-workflows-dialog.js';

/** Background refreshes at most this often (focus also fires when moving in and out of the viewer). */
const REFRESH_MIN_MS = 15 * 1000;

/**
 * Workflows on the case page: loading them, what opening a file does, the Open ▾ menus, the
 * Workflows panel and "More workflows…". A plain helper object, since lit-element 2 has no
 * reactive controllers. The page passes in channel(), accountViewer(), fileName(attachment),
 * fileTitle(attachment), isBusy() and launch(caseRow, attachment, { viewer, workflow }).
 */
export class CaseWorkflowsController {
    constructor(host, options) {
        this.host = host;
        this.options = options;
        this.loaded = null;   // { caseId, data, slicerWebExtensions }
        this._failedCaseId = null; // the case whose workflows couldn't be loaded, while none are shown
        this._loadingCaseId = null;
        this._loadedAt = 0;
        this._moreFor = null; // the file "More workflows…" was opened for
    }

    // ── The case's workflows ──────────────────────────────────────────────

    /** GET /api/cases/:id/workflows for this case, or null while it loads (or for another case). */
    dataFor(caseId) {
        return this.loaded?.caseId === String(caseId) ? this.loaded.data : null;
    }

    /** Whether this case's workflows couldn't be loaded (Case Settings then offers "Try again"). */
    loadFailed(caseId) {
        return this._failedCaseId === String(caseId);
    }

    /**
     * Load a case's workflows and the SlicerWeb build's extensions (`refresh` keeps what's shown
     * meanwhile). On failure the menus offer no workflows, and loadFailed() is true.
     */
    async load(caseId, { refresh = false } = {}) {
        this._loadingCaseId = caseId ? String(caseId) : null;
        this._failedCaseId = null;
        if (!refresh) this.loaded = null;
        this.host.requestUpdate();
        if (!caseId) return;
        this._loadedAt = Date.now();
        try {
            const [data, catalog] = await Promise.all([
                listCaseWorkflows(caseId),
                loadExtensionCatalog(this.options.channel()).catch(() => null), // unknown: SlicerWeb counts as having everything
            ]);
            if (String(caseId) !== this._loadingCaseId) return;
            this.loaded = { caseId: String(caseId), data, slicerWebExtensions: catalog ? catalog.map((e) => e.name) : null };
            this.host.requestUpdate();
        } catch (err) {
            console.warn('[cases] workflows load failed; files open with no workflow:', err);
            if (String(caseId) !== this._loadingCaseId || this.dataFor(caseId)) return;
            this._failedCaseId = String(caseId);
            this.host.requestUpdate();
        }
    }

    /** On the page's periodic check: reload if it's been a while (others' requests, for the badge). */
    refreshIfStale(caseId) {
        if (caseId && Date.now() - this._loadedAt >= REFRESH_MIN_MS) this.load(caseId, { refresh: true });
    }

    // ── Opening a file ─────────────────────────────────────────────────────

    /**
     * What opening a file does (attachment null: the blank viewer) and what its menu offers.
     * `label`: what differs from the person's usual viewer with no workflow; `name`: all of it;
     * `icon`: { name, src } for the row's icon (the workflow's, else the viewer's initial).
     */
    openWithFor(caseRow, attachment = null) {
        const loaded = this.loaded?.caseId === String(caseRow.id) ? this.loaded : null;
        const accountViewer = this.options.accountViewer();
        const options = {
            fileName: attachment ? this.options.fileName(attachment) : null,
            slicerWebExtensions: loaded?.slicerWebExtensions ?? null,
        };
        const pick = attachment ? readOpenPick(caseRow.id, attachment.id) : null;
        const open = resolveOpen(loaded?.data, { ...options, accountViewer, pick });
        const viewerName = t(open.viewer === VIEWER.FULL ? 'viewers.fullSlicer' : 'viewers.slicerWeb');
        const otherViewer = attachment && open.viewer !== viewerFromAccount(accountViewer);
        return {
            ...open,
            usable: usableWorkflows(loaded?.data, { ...options, viewer: open.viewer }),
            selectedKey: open.workflow?.key ?? NO_WORKFLOW,
            name: open.workflow ? `${open.workflow.name} · ${viewerName}` : viewerName,
            label: [open.workflow?.name, otherViewer ? viewerName : null].filter(Boolean).join(' · '),
            icon: { name: open.workflow?.name ?? viewerName, src: open.workflow?.iconUrl ?? null },
        };
    }

    /** A menu pick (workflow key or NO_WORKFLOW): files remember it, the blank viewer doesn't. */
    pickAndOpen(caseRow, attachment, key) {
        if (attachment) {
            saveOpenPick(caseRow.id, attachment.id, { workflow: key });
            return this.options.launch(caseRow, attachment, this.openWithFor(caseRow, attachment));
        }
        const { usable } = this.openWithFor(caseRow);
        const workflow = [...usable.caseWorkflows, ...usable.mine].find((e) => e.key === key) || null;
        return this.options.launch(caseRow, null, { viewer: VIEWER.SLICERWEB, workflow });
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    /** The Open ▾ menu for a file (attachment null: the blank viewer), from openWithFor(). */
    renderMenu(caseRow, attachment, openWith, { slot = '', buttonLabel = '' } = {}) {
        const title = attachment ? this.options.fileTitle(attachment) : t('cases.openBlankViewer');
        return html`
            <open-with-menu
                slot=${slot}
                .buttonLabel=${buttonLabel}
                .fileName=${title}
                .viewer=${openWith.viewer}
                ?canSwitchViewer=${Boolean(attachment)}
                ?grid=${Boolean(attachment)}
                .usable=${openWith.usable}
                .selectedKey=${openWith.selectedKey}
                .label=${openWith.label}
                ?disabled=${this.options.isBusy()}
                @switch-viewer=${(e) => { saveOpenPick(caseRow.id, attachment.id, { viewer: e.detail.viewer }); this.host.requestUpdate(); }}
                @open-workflow=${(e) => this.pickAndOpen(caseRow, attachment, e.detail.key)}
                @more-workflows=${() => this.openMore(caseRow, attachment, openWith, title)}
            ></open-with-menu>
        `;
    }

    /** "Open blank viewer ▾": a button that opens the menu, with the case default checked. */
    renderBlankViewerButton(caseRow) {
        return this.renderMenu(caseRow, null, this.openWithFor(caseRow), { buttonLabel: t('cases.openBlankViewer') });
    }

    /** The Workflows panel and "More workflows…" dialog, once per page (caseRow: the open case, or null). */
    renderDialogs(caseRow) {
        return html`
            <case-workflows-panel
                .caseId=${caseRow ? String(caseRow.id) : ''}
                .data=${caseRow ? this.dataFor(caseRow.id) : null}
                .slicerWebExtensions=${this.loaded?.slicerWebExtensions ?? null}
                @workflows-changed=${() => caseRow && this.load(caseRow.id, { refresh: true })}
            ></case-workflows-panel>
            <more-workflows-dialog
                @open-workflow=${(e) => this._moreFor && this.pickAndOpen(this._moreFor.caseRow, this._moreFor.attachment, e.detail.key)}
            ></more-workflows-dialog>
        `;
    }

    /** The case toolbar's ⋯ menu item, with the count of requests waiting (admins). */
    actionItem(caseRow) {
        return { key: 'workflows', label: t('caseWorkflows.title'), badge: (this.dataFor(caseRow.id)?.requests || []).length };
    }

    /** The Workflows panel, after a reload so it shows others' requests (tab: PANEL_TAB, or by default). */
    async openPanel(caseRow, tab) {
        await this.load(caseRow.id, { refresh: true });
        this.host.renderRoot.querySelector('case-workflows-panel')?.open({ tab });
    }

    /** "More workflows…": the searchable list of `usable` ({ caseWorkflows, mine }); picking one opens the file. */
    openMore(caseRow, attachment, { usable, selectedKey }, title) {
        this._moreFor = { caseRow, attachment };
        this.host.renderRoot.querySelector('more-workflows-dialog')?.open({
            title: t('viewers.moreWorkflowsTitle', { name: title }),
            usable,
            selectedKey,
        });
    }
}
