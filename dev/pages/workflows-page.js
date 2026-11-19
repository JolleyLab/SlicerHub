import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { buttonStyles } from '../styles/buttons.js';
import { listPageStyles } from '../styles/listPage.js';
import { LIST_SORT_OPTIONS, filterByText, sortRows } from '../utils/listSort.js';
import { PagedList, renderPagedList, pagedListStyles } from '../utils/pagedList.js';
import {
    getWorkflow, listMyWorkflows, listPublicWorkflows, createWorkflow, updateWorkflow, deleteWorkflow,
    loadExtensionCatalog, uploadWorkflowIcon, removeWorkflowIcon, WORKFLOW_ICON_TYPES, WORKFLOW_ICON_MAX_BYTES,
    WORKFLOW_VISIBILITY,
} from '../services/workflows.js';
import { updateUrlParams } from '../components/app-views.js';
import { setPageTitle } from '../utils/pageTitle.js';
import { ICON_PENCIL, EYE_PATH, EYE_OFF_PATH } from '../utils/icons.js';
import { extensionIcon, iconTile, iconTileStyles } from '../utils/iconTile.js';
import '../components/page-layout-template.js';
import '../components/page-content-message.js';
import '../components/list-filter-tools.js';
import '../components/extension-picker.js';
import '../components/file-list-row.js';
import '../components/toggle-switch.js';
import '../components/tag-input.js';
import '../components/info-tip.js';
import { normalizeFileExtension, formatFileExtension } from '../utils/fileTypes.js';
import { startModuleGroups, isStartModuleMissing } from '../utils/startModules.js';

const { PRIVATE, PUBLIC } = WORKFLOW_VISIBILITY;
/** The two tabs: the person's own workflows, and everyone's public ones ("All workflows", ?tab=all). */
const TAB = Object.freeze({ OWN: 'own', PUBLIC: 'public' });
const TABS = Object.values(TAB);
const blankForm = () => ({ id: null, name: '', description: '', visibility: PRIVATE, extensions: [], fileTypes: [], startupConfig: {} });
const VISIBILITY_ICONS = Object.freeze({ [PUBLIC]: EYE_PATH, [PRIVATE]: EYE_OFF_PATH });

/** Eye (public) or eye-off (just me) and its label; hovering explains who can use it. */
const visibilityIcon = (visibility) => html`<svg class="visibility-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d=${VISIBILITY_ICONS[visibility]}></path></svg>`;
const visibilityBadge = (visibility, className = '') => html`
    <span class="visibility ${className}" title=${t(`workflows.${visibility}Hint`)}>${visibilityIcon(visibility)}${t(`workflows.${visibility}`)}</span>`;

const extensionCountLabel = (n) => (n === 1 ? t('workflows.oneExtension')
    : n ? t('workflows.extensionCount', { count: n }) : t('workflows.noExtensions'));

/** Sidebar → Workflows: a card grid (own or all public), a detail view, and a create/edit form. */
export class WorkflowsPage extends LitElement {
    static get properties() {
        return {
            username: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean },
            tab: { state: true },
            owned: { state: true },      // My workflows: the requester's own, or null while loading
            query: { state: true },
            sortOrder: { state: true },
            selected: { state: true },   // workflow shown in detail
            form: { state: true },       // draft being created or edited
            nameEditing: { state: true }, // the form's title is an input
            catalog: { state: true },
            startCatalogs: { state: true }, // { stable, latest } for "Start in", or null while loading
            busy: { state: true },
            error: { state: true },
        };
    }

    static get styles() {
        return [buttonStyles, listPageStyles, iconTileStyles, pagedListStyles, css`
            :host { display: block; width: 100%; min-width: 0; }
            .tabs { display: inline-flex; gap: 2px; padding: 2px; border: 1px solid var(--color-border); border-radius: 8px; margin-bottom: 16px; }
            .tabs button {
                font: inherit; font-size: 0.875rem; font-weight: 600; padding: 7px 16px; border: 0; cursor: pointer;
                border-radius: 6px; background: transparent; color: var(--color-text-secondary);
            }
            .tabs button[aria-selected='true'] { background: var(--color-primary); color: var(--color-on-primary); }
            .tabs button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
            }
            .detail { display: flex; flex-direction: column; gap: 18px; }
            .hint { margin: 0; color: var(--color-text-secondary); font-size: 0.85rem; }
            .visibility { display: inline-flex; align-items: center; gap: 4px; cursor: help; }
            .visibility-icon { width: 1.15em; height: 1.15em; flex-shrink: 0; }
            .detail-meta { margin-top: 0; }
            .detail-meta .visibility-icon { width: 16px; height: 16px; }
            toggle-switch { align-self: flex-start; }
            .file-types { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
            .file-types-label { font-size: 0.8rem; font-weight: 600; color: var(--color-text-secondary); margin-right: 2px; }
            .type-chip {
                font-size: 0.8rem; font-weight: 600; padding: 1px 8px; border-radius: 999px;
                border: 1px solid var(--color-border); color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-border) 18%, transparent);
            }
            /* Icon in its own column; title, description and details line up beside it. */
            .with-icon { display: flex; align-items: flex-start; gap: 14px; min-width: 0; width: 100%; }
            .with-icon-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 6px; }
            .card .icon-tile { --icon-tile-size: 48px; }
            .detail-header .icon-tile { --icon-tile-size: 72px; }
            .detail-header .with-icon { gap: 18px; }
            /* Bigger titles, to sit well beside the bigger icons. */
            .with-icon .detail-title { font-size: 1.8rem; line-height: 1.2; }
            .with-icon .card-title { font-size: 1.05rem; }
            .form-title-row { display: flex; align-items: center; gap: 8px; min-width: 0; }
            .form-title-row .form-title-input { flex: 1 1 auto; min-width: 0; }
            .icon-edit { position: relative; flex-shrink: 0; margin-right: 6px; }
            .icon-edit-button {
                position: relative; display: block; padding: 0; border: 0; background: none; cursor: pointer;
                border-radius: 12px;
            }
            .icon-edit-button .icon-tile { --icon-tile-size: 56px; }
            .icon-edit-overlay {
                position: absolute; inset: 0; border-radius: 12px;
                display: flex; align-items: center; justify-content: center;
                background: rgba(0, 0, 0, 0.45); color: #fff;
                opacity: 0; transition: opacity 0.15s ease;
            }
            .icon-edit-overlay svg { width: 20px; height: 20px; }
            .icon-edit-button:hover .icon-edit-overlay,
            .icon-edit-button:focus-visible .icon-edit-overlay { opacity: 1; }
            .icon-edit-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
            }
            /* Touch has no hover: keep a small pencil in the corner instead. */
            @media (hover: none) {
                .icon-edit-overlay {
                    opacity: 1; inset: auto 3px 3px auto; width: 22px; height: 22px; border-radius: 50%;
                }
                .icon-edit-overlay svg { width: 13px; height: 13px; }
            }
            .icon-remove-button {
                position: absolute; top: -8px; right: -8px; width: 24px; height: 24px; padding: 0;
                border-radius: 50%; border: 1px solid var(--color-border); cursor: pointer;
                background: var(--color-panel, #fff); color: var(--color-text-secondary);
                font-size: 0.95rem; line-height: 1; display: inline-flex; align-items: center; justify-content: center;
                opacity: 0; transition: opacity 0.15s ease;
            }
            .icon-edit:hover .icon-remove-button, .icon-edit:focus-within .icon-remove-button { opacity: 1; }
            .icon-remove-button:hover { color: var(--color-text-primary); }
            @media (hover: none) { .icon-remove-button { opacity: 1; } }
            .form-title { margin: 0; font-size: 1.15rem; font-weight: 650; word-break: break-word; }
            .form-title-input { font-size: 1.1rem; font-weight: 600; }
            .edit-title-button {
                border: none; border-radius: var(--radius-md, 6px); background: transparent;
                color: var(--color-text-secondary); width: 30px; height: 30px; padding: 0; flex-shrink: 0;
                display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
            }
            .edit-title-button svg { width: 16px; height: 16px; }
            .edit-title-button:hover, .edit-title-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
            }
            .edit-title-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }
            toggle-switch .visibility-icon { width: 20px; height: 20px; }
            .visibility-section + .visibility-section { margin-top: 22px; }
            .section-heading { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; margin: 0 0 10px;
                font-size: 0.95rem; font-weight: 650; color: var(--color-text-primary); }
            .section-heading .visibility-icon { width: 18px; height: 18px; color: var(--color-text-secondary); }
            .section-hint { font-size: 0.8rem; font-weight: 400; color: var(--color-text-secondary); }
        `];
    }

    constructor() {
        super();
        this.tab = TAB.OWN;
        /** My workflows: all of them, searched and sorted here. */
        this.owned = null;
        /** All workflows: everyone's public ones, searched and sorted on the server, a page at a time. */
        this.everyone = new PagedList((params) => listPublicWorkflows(params), () => this.requestUpdate());
        this.query = '';
        this.sortOrder = 'newest';
        this.selected = null;
        this.form = null;
        this.nameEditing = false;
        this.catalog = null;
        this.startCatalogs = null;
        this.busy = false;
        this.error = '';
    }

    connectedCallback() {
        super.connectedCallback();
        this._onPopState = () => this._handlePopState();
        this._onBeforeUnload = (e) => {
            if (!this._isDirty()) return;
            e.preventDefault();
            e.returnValue = '';
        };
        window.addEventListener('popstate', this._onPopState);
        window.addEventListener('beforeunload', this._onBeforeUnload);
        this._syncFromUrl();
    }

    disconnectedCallback() {
        window.removeEventListener('popstate', this._onPopState);
        window.removeEventListener('beforeunload', this._onBeforeUnload);
        this.everyone.cancel();
        this._releaseIconPreview();
        setPageTitle();
        super.disconnectedCallback();
    }

    // ── Unsaved changes ──────────────────────────────────────────

    _formFields(form) {
        const { name, description, visibility, extensions, fileTypes, startupConfig } = form;
        return { name, description, visibility, extensions, fileTypes, startupConfig };
    }

    _isDirty() {
        if (!this.form) return false;
        return Boolean(this.form.iconFile || this.form.iconRemoved)
            || JSON.stringify(this._formFields(this.form)) !== this._formSnapshot;
    }

    /** True if leaving the form is fine (nothing unsaved, or discarding). The app shell calls it too. */
    confirmLeave() {
        if (!this._isDirty()) return true;
        const recent = this._leaveAnswer && Date.now() - this._leaveAnswer.at < 1000;
        if (!recent) this._leaveAnswer = { at: Date.now(), ok: window.confirm(t('workflows.unsavedWarning')) };
        return this._leaveAnswer.ok;
    }

    /** Back/Forward: ask before dropping unsaved edits; to stay, put the form's URL back. */
    _handlePopState() {
        const params = new URLSearchParams(location.search);
        if (params.get('view') !== 'workflows') return; // leaving the page: the app shell asks
        if (this._isDirty() && !params.get('edit') && !this.confirmLeave()) {
            history.pushState(null, '', this._formHref);
            return;
        }
        this._syncFromUrl();
    }

    // ── URL and page state ───────────────────────────────────────

    /** Show what the URL says: ?tab=all, ?workflow=<id> (&edit=1), ?edit=new. */
    async _syncFromUrl() {
        const params = new URLSearchParams(location.search);
        const tab = params.get('tab') === 'all' ? TAB.PUBLIC : TAB.OWN;
        if (tab !== this.tab || this._items(tab) === null) this._loadTab(tab);
        this.error = '';
        const id = params.get('workflow');
        const edit = params.get('edit');
        if (!id) {
            this.selected = null;
            if (edit === 'new') {
                if (!this.form || this.form.id) this._startForm(null);
            } else {
                this._clearForm();
            }
            return;
        }
        let workflow = String(this.selected?.id) === id ? this.selected
            : [...(this.owned || []), ...(this.everyone.items || [])].find((w) => String(w.id) === id);
        workflow = workflow || await this._run(() => getWorkflow(id));
        if (!workflow) {
            updateUrlParams({ workflow: null, edit: null }, { replace: true });
            return;
        }
        if (this.selected !== workflow) this._show(workflow);
        if (edit && workflow.isMine) {
            if (this.form?.id !== workflow.id) this._startForm(workflow);
        } else {
            if (edit) updateUrlParams({ edit: null }, { replace: true }); // only the owner can edit
            this._clearForm();
        }
    }

    _selectTab(tab) {
        updateUrlParams({ tab: tab === TAB.PUBLIC ? 'all' : null }, { replace: true });
        this._loadTab(tab);
    }

    /** Run an action with the busy flag and error handled: its result, or undefined (and this.error) on failure. */
    async _run(action) {
        this.busy = true;
        this.error = '';
        try {
            return await action();
        } catch (err) {
            this.error = err?.message || t('common.somethingWentWrong');
            return undefined;
        } finally {
            this.busy = false;
        }
    }

    /** The tab's loaded workflows, or null before they arrive. */
    _items(tab = this.tab) {
        return tab === TAB.PUBLIC ? this.everyone.items : this.owned;
    }

    _loadTab(tab) {
        this.tab = tab;
        if (tab === TAB.PUBLIC) return this._searchEveryone();
        return this._run(async () => { this.owned = await listMyWorkflows(); });
    }

    /** All workflows for the current search and sort (soon: once typing pauses). */
    _searchEveryone({ soon = false } = {}) {
        const params = { q: this.query.trim(), sort: this.sortOrder };
        return soon ? this.everyone.searchSoon(params) : this.everyone.search(params);
    }

    _onSearch(query) {
        this.query = query;
        if (this.tab === TAB.PUBLIC) this._searchEveryone({ soon: true });
    }

    _onSort(order) {
        this.sortOrder = order;
        if (this.tab === TAB.PUBLIC) this._searchEveryone();
    }

    /** Put a saved workflow in the lists it belongs to. All workflows only updates what's shown; new ones appear on the next search. */
    _remember(workflow, { removed = false } = {}) {
        if (this.owned !== null) {
            this.owned = [...this.owned.filter((w) => w.id !== workflow.id), ...(removed ? [] : [workflow])];
        }
        const keep = !removed && workflow.visibility === PUBLIC;
        if (this.everyone.items) {
            this.everyone.items = this.everyone.items.flatMap((w) => (w.id !== workflow.id ? [w] : keep ? [workflow] : []));
            this.requestUpdate();
        }
    }

    /** Open a workflow's page (a history entry, so Back returns to the list). */
    _open(workflow) {
        updateUrlParams({ workflow: workflow.id });
        this._show(workflow);
    }

    _show(workflow) {
        this.selected = workflow;
        loadExtensionCatalog().then((c) => { this.catalog = c; }, () => { this.catalog = []; });
    }

    /** Back to the list (asking first if there are unsaved changes); false if the person stays. */
    _back() {
        if (!this.confirmLeave()) return false;
        updateUrlParams({ workflow: null, edit: null });
        this.selected = null;
        this._clearForm();
        return true;
    }

    /** Open the form for a workflow, or for a new one (null). */
    _edit(workflow) {
        updateUrlParams(workflow ? { workflow: workflow.id, edit: 1 } : { workflow: null, edit: 'new' });
        this._startForm(workflow);
    }

    _startForm(workflow) {
        this._releaseIconPreview();
        this.form = workflow
            ? { ...workflow, extensions: [...workflow.extensions], fileTypes: [...workflow.fileTypes], startupConfig: { ...workflow.startupConfig } }
            : blankForm();
        this._loadStartCatalogs();
        this._formSnapshot = JSON.stringify(this._formFields(this.form));
        this._formHref = location.href;
        this.nameEditing = !workflow; // a new workflow starts by naming it
        this.error = '';
    }

    /** Both SlicerWeb channels' extension lists, for the modules "Start in" offers (a failed one counts as empty). */
    _loadStartCatalogs() {
        if (this.startCatalogs) return;
        const load = (channel) => loadExtensionCatalog(channel).catch(() => []);
        Promise.all([load('stable'), load('latest')]).then(([stable, latest]) => { this.startCatalogs = { stable, latest }; });
    }

    /** Set or clear the module a workflow starts in, keeping any other startup keys. */
    _setStartModule(module) {
        const { module: _old, ...rest } = this.form.startupConfig || {};
        this._setForm('startupConfig', module ? { ...rest, module } : rest);
    }

    _releaseIconPreview() {
        if (this.form?.iconPreview) URL.revokeObjectURL(this.form.iconPreview);
    }

    /** Close the form (whatever is unsaved is dropped; ask first with confirmLeave). */
    _clearForm() {
        this._releaseIconPreview();
        this.form = null;
        this.error = '';
    }

    /** A picked icon file (checked here for type and size; the server checks its contents). */
    _pickIcon(file) {
        if (!file) return;
        if (!WORKFLOW_ICON_TYPES.includes(file.type)) {
            this.error = t('workflows.iconWrongType');
            return;
        }
        if (file.size > WORKFLOW_ICON_MAX_BYTES) {
            this.error = t('workflows.iconTooLarge', { kb: WORKFLOW_ICON_MAX_BYTES / 1024 });
            return;
        }
        this._releaseIconPreview();
        this.error = '';
        this.form = { ...this.form, iconFile: file, iconPreview: URL.createObjectURL(file), iconRemoved: false };
    }

    _removeIcon() {
        this._releaseIconPreview();
        this.form = { ...this.form, iconFile: null, iconPreview: null, iconRemoved: true };
    }

    /** The icon beside the title: click to pick a file, × to remove it. */
    _renderIconButton(f) {
        const src = f.iconRemoved ? null : (f.iconPreview || f.iconUrl);
        const action = src ? t('workflows.changeIcon') : t('workflows.uploadIcon');
        const hint = t('workflows.iconHint', { kb: WORKFLOW_ICON_MAX_BYTES / 1024 });
        return html`
            <div class="icon-edit">
                <input id="wf-icon" type="file" hidden accept=${WORKFLOW_ICON_TYPES.join(',')}
                    @change=${(e) => { this._pickIcon(e.target.files[0]); e.target.value = ''; }} />
                <button class="icon-edit-button" type="button" title=${`${action}. ${hint}`}
                    aria-label=${action} aria-describedby="wf-icon-hint"
                    @click=${() => this.renderRoot.querySelector('#wf-icon').click()}>
                    ${iconTile(f.name, src)}
                    <span class="icon-edit-overlay" aria-hidden="true">${ICON_PENCIL}</span>
                </button>
                <span id="wf-icon-hint" hidden>${hint}</span>
                ${src ? html`
                    <button class="icon-remove-button" type="button" title=${t('workflows.removeIcon')}
                        aria-label=${t('workflows.removeIcon')} @click=${() => this._removeIcon()}>×</button>
                ` : ''}
            </div>
        `;
    }

    async _renameStart() {
        this.nameEditing = true;
        await this.updateComplete;
        const input = this.renderRoot.querySelector('#wf-name');
        input?.focus();
        input?.select();
    }

    /** Back to showing the name as the title (kept as an input while empty). */
    _renameDone() {
        if (this.form?.name.trim()) this.nameEditing = false;
    }

    _renderFormTitle(f) {
        const name = this.nameEditing ? html`
            <input id="wf-name" class="form-input form-title-input" type="text" maxlength="100" autocomplete="off"
                required aria-label=${t('workflows.name')} placeholder=${t('workflows.namePlaceholder')}
                .value=${f.name}
                @input=${(e) => this._setForm('name', e.target.value)}
                @blur=${() => this._renameDone()}
                @keydown=${(e) => { if (e.key === 'Enter') { e.preventDefault(); this._renameDone(); } }} />
        ` : html`
            ${f.id ? html`<h1 class="form-title">${f.name}</h1>` : html`<span class="form-title">${f.name}</span>`}
            <button class="edit-title-button" type="button" title=${t('workflows.rename')}
                aria-label=${t('workflows.rename')} @click=${() => this._renameStart()}>${ICON_PENCIL}</button>
        `;
        return html`<div class="form-title-row">${this._renderIconButton(f)}${name}</div>`;
    }

    /** Cancel / back link on the form (asking first if there are unsaved changes). */
    _closeForm() {
        if (!this.confirmLeave()) return;
        updateUrlParams({ edit: null });
        this._clearForm();
    }

    _setForm(field, value) {
        this.form = { ...this.form, [field]: value };
    }

    async _save(event) {
        event.preventDefault();
        const { id, iconFile, iconRemoved } = this.form;
        const fields = this._formFields(this.form);
        const saved = await this._run(async () => {
            let workflow = id ? await updateWorkflow(id, fields) : await createWorkflow(fields);
            // Saved: if the icon then fails, the list and URL already have it and Save again updates it.
            this._remember(workflow);
            if (!id) {
                this.form = { ...this.form, id: workflow.id };
                updateUrlParams({ workflow: workflow.id, edit: 1 }, { replace: true });
                this._formHref = location.href;
            }
            if (iconFile) workflow = await uploadWorkflowIcon(workflow.id, iconFile);
            else if (iconRemoved && workflow.iconUrl) workflow = await removeWorkflowIcon(workflow.id);
            return workflow;
        });
        if (!saved) return;
        this._clearForm();
        this._remember(saved);
        updateUrlParams({ workflow: saved.id, edit: null }, { replace: true });
        this._show(saved);
    }

    async _copy(workflow) {
        const saved = await this._run(() => createWorkflow({
            name: t('workflows.copyName', { name: workflow.name }).slice(0, 100),
            description: workflow.description,
            visibility: PRIVATE,
            extensions: workflow.extensions,
            fileTypes: workflow.fileTypes,
            startupConfig: workflow.startupConfig,
        }));
        if (!saved) return;
        this._selectTab(TAB.OWN);
        this._remember(saved);
        this._open(saved);
        this._edit(saved);
    }

    async _delete(workflow) {
        if (!confirm(t('workflows.confirmDelete', { name: workflow.name }))) return;
        await this._run(() => deleteWorkflow(workflow.id));
        if (this.error) return;
        this._remember(workflow, { removed: true });
        this._back();
    }

    /** Sidebar → Workflows while here: back to the list, unless the person stays to keep edits. */
    _handleMenu(e) {
        if (e.detail?.selectedKey !== 'workflows') return;
        if (!this._back()) e.stopPropagation();
    }

    _layout(content) {
        return html`
            <page-layout-template
                .username=${this.username}
                .avatarUrl=${this.avatarUrl}
                .isOrgAdmin=${this.isOrgAdmin}
                .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                selectedMenuKey="workflows"
                homeLabel=${t('common.home')}
                @menu-selection-change=${(e) => this._handleMenu(e)}
            >
                <div slot="content">
                    ${content}
                </div>
            </page-layout-template>
        `;
    }

    _renderError() {
        return this.error ? html`<page-content-message variant="error" .message=${this.error}></page-content-message>` : '';
    }

    _renderCard(w) {
        return html`
            <button class="card" type="button" @click=${() => this._open(w)}>
                <div class="with-icon">
                    ${iconTile(w.name, w.iconUrl)}
                    <div class="with-icon-body">
                        <div class="card-title-row">
                            <span class="card-title">${w.name}</span>
                            ${this.tab === TAB.PUBLIC && w.isMine ? html`<span class="card-badge">${t('workflows.yours')}</span>` : ''}
                        </div>
                        ${w.description ? html`<p class="card-desc">${w.description}</p>` : ''}
                        <div class="card-meta-row">
                            <span class="card-meta-item">${extensionCountLabel(w.extensions.length)}</span>
                        </div>
                    </div>
                </div>
            </button>
        `;
    }

    _renderList() {
        const all = this._items();
        const searching = Boolean(this.query.trim());
        return this._layout(html`
            <div class="page-header-row">
                <h1 class="page-heading">${t('workflows.title')}</h1>
                <div class="page-header-actions">
                    ${all?.length || searching ? html`
                        <list-filter-tools
                            .searchQuery=${this.query}
                            .sortOrder=${this.sortOrder}
                            .sortOptions=${LIST_SORT_OPTIONS}
                            searchLabel=${t('workflows.searchAria')}
                            sortLabel=${t('workflows.sortAria')}
                            searchPlaceholder=${t('workflows.filterPlaceholder')}
                            @search-change=${(e) => this._onSearch(e.detail.query)}
                            @sort-change=${(e) => this._onSort(e.detail.order)}
                        ></list-filter-tools>
                    ` : ''}
                    <button class="primary-button" type="button" ?disabled=${this.busy} @click=${() => this._edit(null)}>
                        ${t('workflows.create')}
                    </button>
                </div>
            </div>
            <p class="hint" style="margin-bottom:14px">${t('workflows.description')}</p>
            <div class="tabs" role="tablist" aria-label=${t('workflows.tabsLabel')} @keydown=${(e) => this._onTabKey(e)}>
                ${TABS.map((tab) => html`
                    <button role="tab" type="button" id="wf-tab-${tab}" aria-controls="wf-tabpanel"
                        aria-selected=${String(this.tab === tab)} tabindex=${this.tab === tab ? '0' : '-1'}
                        @click=${() => this._selectTab(tab)}>
                        ${t(tab === TAB.OWN ? 'workflows.tabMine' : 'workflows.tabPublic')}
                    </button>
                `)}
            </div>
            <div id="wf-tabpanel" role="tabpanel" aria-labelledby="wf-tab-${this.tab}">
            ${this._renderError()}
            ${this.tab === TAB.OWN ? this._renderOwned() : renderPagedList(this.everyone, {
                empty: searching ? this._noMatch() : html`<page-content-message variant="empty"
                    message=${t('workflows.noPublic')}></page-content-message>`,
                render: (rows) => html`<div class="card-grid">${rows.map((w) => this._renderCard(w))}</div>`,
            })}
            </div>
        `);
    }

    _noMatch() {
        return html`<p class="empty-filter">${t('workflows.noMatch', { query: this.query.trim() })}</p>`;
    }

    /** My workflows: searched and sorted here (one person's, so all are loaded). */
    _renderOwned() {
        if (this.owned === null) return html`<div class="status-note" role="status">${t('common.loading')}</div>`;
        if (!this.owned.length) return html`<page-content-message variant="empty" message=${t('workflows.none')}></page-content-message>`;
        const rows = sortRows(filterByText(this.owned, this.query, (w) => [w.name, w.description, ...w.extensions, ...w.fileTypes.map(formatFileExtension)]),
            this.sortOrder, { titleOf: (w) => w.name, timeOf: (w) => w.updatedAt });
        return rows.length ? this._renderSections(rows) : this._noMatch();
    }

    /** Tabs pattern: Left/Right (wrapping), Home, End move to and select a tab. */
    async _onTabKey(e) {
        const i = TABS.indexOf(this.tab);
        const next = { ArrowRight: (i + 1) % TABS.length, ArrowLeft: (i - 1 + TABS.length) % TABS.length,
            Home: 0, End: TABS.length - 1 }[e.key];
        if (next === undefined) return;
        e.preventDefault();
        this._selectTab(TABS[next]);
        await this.updateComplete;
        this.renderRoot.querySelector(`#wf-tab-${TABS[next]}`)?.focus();
    }

    /** My workflows, in a "Just me" and a "Public" section (each shown only when it has any). */
    _renderSections(rows) {
        return [PRIVATE, PUBLIC].map((visibility) => {
            const group = rows.filter((w) => w.visibility === visibility);
            return group.length ? html`
                <section class="visibility-section">
                    <h2 class="section-heading">
                        ${visibilityIcon(visibility)}${t(`workflows.${visibility}`)}
                        <span class="section-hint">${t(`workflows.${visibility}Hint`)}</span>
                    </h2>
                    <div class="card-grid">${group.map((w) => this._renderCard(w))}</div>
                </section>
            ` : '';
        });
    }

    _renderDetail(w) {
        const describe = (name) => this.catalog?.find((e) => e.name === name);
        return this._layout(html`
            <div class="detail">
                <div class="detail-toolbar">
                    <button class="back-link" type="button" @click=${() => this._back()}>${t('workflows.backToList')}</button>
                    <div class="detail-toolbar-actions">
                        ${w.isMine ? html`
                            <button class="quiet-button" type="button" ?disabled=${this.busy} @click=${() => this._edit(w)}>${t('workflows.edit')}</button>
                            <button class="quiet-button" type="button" ?disabled=${this.busy} @click=${() => this._delete(w)}>${t('workflows.delete')}</button>
                        ` : html`
                            <button class="quiet-button" type="button" ?disabled=${this.busy} @click=${() => this._copy(w)}>${t('workflows.copy')}</button>
                        `}
                    </div>
                </div>
                <div class="detail-header">
                    <div class="with-icon">
                        ${iconTile(w.name, w.iconUrl)}
                        <div class="with-icon-body">
                            <h1 class="detail-title">${w.name}</h1>
                            ${w.description ? html`<p class="detail-desc">${w.description}</p>` : ''}
                            <div class="file-types">
                                <span class="file-types-label">${t('workflows.fileTypes')}</span>
                                ${w.fileTypes.length
                                    ? w.fileTypes.map((ext) => html`<span class="type-chip">${formatFileExtension(ext)}</span>`)
                                    : html`<span class="hint">${t('workflows.anyFileType')}</span>`}
                            </div>
                            ${w.startupConfig?.module ? html`
                                <div class="file-types">
                                    <span class="file-types-label">${t('workflows.startIn')}</span>
                                    <span class="type-chip">${w.startupConfig.module}</span>
                                </div>` : ''}
                            <div class="card-meta-row detail-meta">
                                ${visibilityBadge(w.isMine ? w.visibility : PUBLIC, 'card-meta-item')}
                            </div>
                        </div>
                    </div>
                </div>
                ${this._renderError()}
                <div class="list-panel">
                    <div class="panel-header">
                        <div class="panel-header-start">
                            <h2 class="panel-title">${t('workflows.extensions')}</h2>
                            <span class="panel-count">${w.extensions.length}</span>
                        </div>
                    </div>
                    <div class="list-panel-body">
                        ${w.extensions.length ? html`
                            <div class="list-panel-items">
                                ${w.extensions.map((name) => html`
                                    <file-list-row plain .fileName=${name}
                                        .metaLine=${this.catalog === null ? '' : describe(name)?.description || t('workflows.notInBuild')}
                                    ><span slot="leading">${extensionIcon(name)}</span></file-list-row>`)}
                            </div>
                        ` : html`<div class="empty-note">${t('workflows.noExtensions')}</div>`}
                    </div>
                </div>
            </div>
        `);
    }

    /** "Start in": Slicer's usual first screen, or a module of Slicer's or of a ticked extension. */
    _renderStartIn(f) {
        const module = f.startupConfig?.module || '';
        const groups = startModuleGroups(f.extensions, this.startCatalogs || {});
        const missing = this.startCatalogs !== null && isStartModuleMissing(module, groups);
        const optionLabel = (m) => (m.fullSlicerOnly ? t('workflows.startInFullSlicerOnly', { module: m.name })
            : m.latestOnly ? t('workflows.startInLatestOnly', { module: m.name }) : m.name);
        return html`
            <div class="form-group">
                <span class="form-label"><label for="wf-start">${t('workflows.startIn')}</label>
                    <info-tip .text=${t('workflows.startInHint')} .label=${t('workflows.startInInfo')}></info-tip></span>
                <select id="wf-start" class="form-input" .value=${module} @change=${(e) => this._setStartModule(e.target.value)}>
                    <option value="" ?selected=${!module}>${t('workflows.startInDefault')}</option>
                    ${missing || (module && this.startCatalogs === null)
                        ? html`<option value=${module} selected>${module}</option>` : ''}
                    ${groups.map((g) => html`
                        <optgroup label=${g.extension || t('workflows.startInCore')}>
                            ${g.modules.map((m) => html`<option value=${m.name} ?selected=${m.name === module}>${optionLabel(m)}</option>`)}
                        </optgroup>`)}
                </select>
                ${missing ? html`<p class="hint" role="status">${t('workflows.startInMissing', { module })}</p>` : ''}
            </div>
        `;
    }

    _renderForm(f) {
        const cancel = () => this._closeForm();
        return this._layout(html`
            ${f.id ? html`
                <div class="detail-toolbar" style="margin-bottom:14px">
                    <button class="back-link" type="button" @click=${cancel}>${t('workflows.backToList')}</button>
                </div>
            ` : html`
                <div class="page-header-row">
                    <h1 class="page-heading">${t('workflows.create')}</h1>
                    <div class="page-header-actions">
                        <button class="primary-button is-cancel" type="button" @click=${cancel}>${t('common.cancel')}</button>
                    </div>
                </div>
            `}
            <form class="form-panel" @submit=${(e) => this._save(e)} novalidate>
                ${this._renderFormTitle(f)}
                <div class="form-group">
                    <label class="form-label" for="wf-desc">${t('workflows.descriptionLabel')}</label>
                    <textarea id="wf-desc" class="form-textarea" maxlength="1000"
                        placeholder=${t('workflows.descriptionPlaceholder')} .value=${f.description}
                        @input=${(e) => this._setForm('description', e.target.value)}></textarea>
                </div>
                <div class="form-group">
                    <span class="form-label">${t('workflows.fileTypes')}
                        <info-tip .text=${t('workflows.fileTypesHint')} .label=${t('workflows.fileTypesInfo')}></info-tip></span>
                    <tag-input
                        .values=${f.fileTypes}
                        .normalize=${normalizeFileExtension}
                        .format=${formatFileExtension}
                        label=${t('workflows.fileTypes')}
                        placeholder=${t('workflows.fileTypesPlaceholder')}
                        invalidMessage=${t('workflows.fileTypeInvalid')}
                        @values-change=${(e) => this._setForm('fileTypes', e.detail.values)}
                    ></tag-input>
                </div>
                <div class="form-group">
                    <span class="form-label">${t('workflows.visibility')}</span>
                    <toggle-switch
                        aria-label=${t('workflows.makePublic')}
                        .checked=${f.visibility === PUBLIC}
                        .trueLabel=${''}
                        .falseLabel=${''}
                        @toggle-change=${(e) => this._setForm('visibility', e.detail.checked ? PUBLIC : PRIVATE)}
                    >
                        <span slot="off" class="visibility" title=${t('workflows.private')}>${visibilityIcon(PRIVATE)}</span>
                        <span slot="on" class="visibility" title=${t('workflows.public')}>${visibilityIcon(PUBLIC)}</span>
                    </toggle-switch>
                    <p class="hint" aria-live="polite">
                        <strong>${t(`workflows.${f.visibility}`)}</strong>: ${t(`workflows.${f.visibility}Hint`)}
                    </p>
                </div>
                <div class="form-group">
                    <span class="form-label">${t('workflows.extensions')}</span>
                    <extension-picker .selected=${f.extensions}
                        @extensions-change=${(e) => this._setForm('extensions', e.detail.extensions)}></extension-picker>
                </div>
                ${this._renderStartIn(f)}
                ${this.error ? html`<div class="form-error-msg" role="alert">${this.error}</div>` : ''}
                <div class="form-actions is-sticky">
                    ${f.id ? html`<button class="secondary-button" type="button" @click=${cancel}>${t('common.cancel')}</button>` : ''}
                    <button class="primary-button" type="submit" ?disabled=${this.busy || !f.name.trim()}>
                        ${this.busy ? t('common.saving') : f.id ? t('common.save') : t('workflows.createAction')}
                    </button>
                </div>
            </form>
        `);
    }

    updated(changed) {
        super.updated?.(changed);
        const f = this.form;
        const w = this.selected;
        if (f) setPageTitle(f.id ? t('workflows.editTitle', { name: f.name }) : t('workflows.create'), t('workflows.title'));
        else if (w) setPageTitle(w.name, t('workflows.title'));
        else setPageTitle(t('workflows.title'));
    }

    render() {
        if (this.form) return this._renderForm(this.form);
        if (this.selected) return this._renderDetail(this.selected);
        return this._renderList();
    }
}

customElements.define('workflows-page', WorkflowsPage);
