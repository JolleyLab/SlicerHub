import { html } from 'lit-element';
import { t } from '../i18n/index.js';
import { listCaseWorkflows, loadExtensionCatalog, setFileOpenWith } from '../services/workflows.js';
import { VIEWER_NAME_KEY, choiceFor, resolveOpen, opensInSlicer, uploadChoices } from '../utils/openWith.js';
import '../components/open-with-menu.js';
import '../components/case-workflows-panel.js';
import '../components/more-workflows-dialog.js';
import '../components/default-toolkit-dialog.js';

/** Background refreshes at most this often (focus also fires when moving in and out of the viewer). */
const REFRESH_MIN_MS = 15 * 1000;

/**
 * Workflows on the case page: loading them, what opening a file does, the Open ▾ menus, the
 * Workflows panel and "More workflows…". A plain helper object, since lit-element 2 has no
 * reactive controllers. The page passes in channel(), accountViewer(), fileName(attachment),
 * fileTitle(attachment), isBusy(), launch(caseRow, attachment, { viewer, workflow }),
 * canSetFileDefault(caseRow, attachment) and fileDefaultChanged(caseRow, attachment, openWith).
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
     * What opening a file does (attachment null: the blank viewer) and what its menu offers
     * (resolveOpen), plus `name` ("SlicerHeart · SlicerWeb") and `icon` { name, src } for its row.
     */
    openWithFor(caseRow, attachment = null) {
        const loaded = this.loaded?.caseId === String(caseRow.id) ? this.loaded : null;
        const open = resolveOpen(loaded?.data, {
            fileName: attachment ? this.options.fileName(attachment) : null,
            fileDefault: attachment?.openWith ?? null,
            slicerWebExtensions: loaded?.slicerWebExtensions ?? null,
            accountViewer: this.options.accountViewer(),
        });
        const viewerName = t(VIEWER_NAME_KEY[open.viewer]);
        return {
            ...open,
            selectedKey: open.key,
            name: open.workflow ? `${open.workflow.name} · ${viewerName}` : viewerName,
            icon: { name: open.workflow?.name ?? viewerName, src: open.workflow?.iconUrl ?? null },
        };
    }

    /** Open a file (attachment null: the blank viewer) once with a menu choice (a key); nothing is remembered. */
    openChoice(caseRow, attachment, key) {
        const open = this.openWithFor(caseRow, attachment);
        return this.options.launch(caseRow, attachment, choiceFor(open.usable, key) || open);
    }

    /**
     * Before an upload: ask each file's default, for the files that open in Slicer, unless the
     * case has no toolkit for any of them (then there's nothing to choose but a viewer). Resolves
     * to a key (or null: the case default) per file, or null if the person cancelled.
     */
    async askOpenWith(caseRow, files) {
        const data = this.dataFor(caseRow.id);
        const slicerWebExtensions = this.loaded?.slicerWebExtensions ?? null;
        const asked = files.map((file) => (opensInSlicer(data, file.name)
            ? { name: file.name, ...uploadChoices(data, { fileName: file.name, slicerWebExtensions }) }
            : null));
        const rows = asked.filter(Boolean);
        if (!rows.some((row) => row.usable.caseWorkflows.length)) return files.map(() => null);
        const keys = await this._defaultDialog()?.ask({
            title: t(rows.length > 1 ? 'viewers.uploadTitleMany' : 'viewers.uploadTitle'),
            hint: t('viewers.uploadHint'),
            action: t('viewers.uploadAction'),
            rows,
        });
        if (!keys) return null;
        let next = 0;
        return asked.map((row) => (row ? keys[next++] : null));
    }

    /** "Default for this file…": change (or clear) what a file opens with for everyone. */
    async setFileDefault(caseRow, attachment) {
        const data = this.dataFor(caseRow.id);
        const name = this.options.fileTitle(attachment);
        const row = { name, ...uploadChoices(data, { fileName: this.options.fileName(attachment), slicerWebExtensions: this.loaded?.slicerWebExtensions ?? null }) };
        // One that no longer applies (e.g. removed from the case) can't be shown: start on the case default.
        row.selectedKey = attachment.openWith && choiceFor(row.usable, attachment.openWith) ? attachment.openWith : '';
        const [key] = await this._defaultDialog()?.ask({
            title: t('viewers.defaultTitle', { name }),
            hint: t('viewers.defaultHint'),
            action: t('common.save'),
            rows: [row],
            caseDefault: this._caseDefaultLabel(data),
        }) || [];
        if (key === undefined || key === (attachment.openWith || '')) return;
        try {
            const { openWith } = await setFileOpenWith(caseRow.id, attachment.id, key || null);
            this.options.fileDefaultChanged(caseRow, attachment, openWith);
        } catch (err) {
            this.options.showError(err);
        }
    }

    /** "Case default: SlicerHeart · SlicerWeb", or the person's usual viewer when there's none. */
    _caseDefaultLabel(data) {
        const approved = (data?.approved || []).find((a) => String(a.id) === String(data?.defaultWorkflow));
        const what = approved ? `${approved.name} · ${t(VIEWER_NAME_KEY[approved.viewer])}` : t('viewers.usualViewer');
        return t('viewers.caseDefaultOption', { name: what });
    }

    _defaultDialog() {
        return this.host.renderRoot.querySelector('default-toolkit-dialog');
    }

    // ── Rendering ──────────────────────────────────────────────────────────

    /**
     * The Open ▾ menu for a file (attachment null: the blank viewer), from openWithFor().
     * `more` and `extraItems`: the ⋯ form a file row uses on phones (see open-with-menu).
     */
    renderMenu(caseRow, attachment, openWith, { slot = '', buttonLabel = '', more = false, extraItems = null, className = '' } = {}) {
        const title = attachment ? this.options.fileTitle(attachment) : t('cases.openBlankViewer');
        return html`
            <open-with-menu
                slot=${slot}
                class=${className}
                .buttonLabel=${buttonLabel}
                ?more=${more}
                .extraItems=${extraItems || []}
                .fileName=${title}
                ?grid=${Boolean(attachment)}
                ?alignEnd=${Boolean(attachment)}
                ?canSetDefault=${Boolean(attachment) && this.options.canSetFileDefault(caseRow, attachment)}
                .usable=${openWith.usable}
                .selectedKey=${openWith.selectedKey}
                .label=${openWith.name}
                ?disabled=${this.options.isBusy() && !more}
                ?busy=${this.options.isBusy()}
                @open-workflow=${(e) => this.openChoice(caseRow, attachment, e.detail.key)}
                @more-workflows=${() => this.openMore(caseRow, attachment, openWith, title)}
                @set-default=${() => this.setFileDefault(caseRow, attachment)}
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
            <default-toolkit-dialog></default-toolkit-dialog>
            <more-workflows-dialog
                @open-workflow=${(e) => this._moreFor && this.openChoice(this._moreFor.caseRow, this._moreFor.attachment, e.detail.key)}
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
