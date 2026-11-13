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
 * Workflows on the case page (docs/workflows-design.md › Workflows in cases), as a Lit reactive
 * controller: the open case's workflows (GET /api/cases/:id/workflows) and the SlicerWeb build's
 * extensions; what opening a file does and the person's picks; the Open ▾ menus and "Open blank
 * viewer ▾"; and the Workflows panel and "More workflows…" dialog.
 *
 * The page keeps what's its own and passes it in:
 *   channel()            the SlicerWeb channel this person launches
 *   accountViewer()      their account viewer setting ('web' | 'full' | 'simplified')
 *   fileName(attachment) / fileTitle(attachment)
 *   isBusy()             a viewer is opening (menus are disabled)
 *   launch(caseRow, attachment, { viewer, workflow })   open it (attachment null: the blank viewer)
 */
export class CaseWorkflowsController {
    constructor(host, options) {
        this.host = host;
        this.options = options;
        this.loaded = null;   // { caseId, data, slicerWebExtensions }
        this._loadingCaseId = null;
        this._loadedAt = 0;
        this._moreFor = null; // the file "More workflows…" was opened for
        host.addController(this);
    }

    // ── The case's workflows ──────────────────────────────────────────────

    /** GET /api/cases/:id/workflows for this case, or null while it loads (or for another case). */
    dataFor(caseId) {
        return this.loaded?.caseId === String(caseId) ? this.loaded.data : null;
    }

    /**
     * Load a case's workflows and the SlicerWeb build's extensions. `refresh` keeps what's shown
     * until the new data arrives. A failure is logged; the menus then offer no workflows.
     */
    async load(caseId, { refresh = false } = {}) {
        this._loadingCaseId = caseId ? String(caseId) : null;
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
        }
    }

    /** On the page's periodic check: reload if it's been a while (others' requests, for the badge). */
    refreshIfStale(caseId) {
        if (caseId && Date.now() - this._loadedAt >= REFRESH_MIN_MS) this.load(caseId, { refresh: true });
    }

    // ── Opening a file ─────────────────────────────────────────────────────

    /**
     * What opening a file does (attachment null: the blank viewer), and what its Open ▾ menu
     * offers: { viewer, workflow, usable, selectedKey, name, label }. `label` is what differs from
     * the person's own viewer with no workflow; `name` describes the whole thing. The blank viewer
     * remembers no pick: it starts on the case default each time, chosen from its menu.
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
        };
    }

    /**
     * A pick from a menu (a workflow key or NO_WORKFLOW): for a file, remember it and open; for
     * the blank viewer, just open with it.
     */
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
                .usable=${openWith.usable}
                .selectedKey=${openWith.selectedKey}
                .label=${openWith.label}
                ?disabled=${this.options.isBusy()}
                @switch-viewer=${(e) => { saveOpenPick(caseRow.id, attachment.id, { viewer: e.detail.viewer }); this.host.requestUpdate(); }}
                @open-workflow=${(e) => this.pickAndOpen(caseRow, attachment, e.detail.key)}
                @more-workflows=${() => this._openMore(caseRow, attachment, openWith, title)}
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

    _openMore(caseRow, attachment, openWith, title) {
        this._moreFor = { caseRow, attachment };
        this.host.renderRoot.querySelector('more-workflows-dialog')?.open({
            title: t('viewers.moreWorkflowsTitle', { name: title }),
            usable: openWith.usable,
            selectedKey: openWith.selectedKey,
        });
    }
}
