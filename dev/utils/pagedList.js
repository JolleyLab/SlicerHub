/**
 * A list searched on the server and loaded a page at a time, with "Load more": the Workflows
 * page's All workflows tab and a case's "Request or Add" list. Only the latest search's replies
 * are kept, so a slow answer to an older query never replaces a newer one.
 *
 *   const list = new PagedList((params) => listSomething(params), () => this.requestUpdate());
 *   list.search({ q, sort });   // first page (searchSoon: after typing pauses)
 *   list.more();                // the next page, added on
 *   list.items / hasMore / loading / error
 */

import { html, css } from 'lit-element';
import { t } from '../i18n/index.js';

const SEARCH_DELAY_MS = 300;

/** For hosts of renderPagedList (with buttonStyles, for its secondary-button). */
export const pagedListStyles = css`
    .paged-status { margin: 8px 0; color: var(--color-text-secondary); font-size: 0.85rem; }
    .paged-error { margin: 8px 0; color: var(--color-status-error-fg, #8a1212); font-size: 0.85rem; }
    .paged-more { display: block; margin: 14px auto 0; }
    .paged-more[aria-disabled='true'] { cursor: progress; }
    .paged-announce {
        position: absolute; width: 1px; height: 1px; margin: -1px; padding: 0;
        overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
`;

/** What screen readers hear when the list changes (WCAG 4.1.3): loading, or how many are shown. */
function announcement(list) {
    if (list.loading) return t('common.loading');
    if (list.items === null) return '';
    const count = list.items.length;
    if (!count) return t('workflows.shownNone');
    const shown = count === 1 ? t('workflows.shownOne') : t('workflows.shown', { count });
    return list.hasMore ? `${shown}. ${t('workflows.shownHasMore')}` : shown;
}

/**
 * A PagedList's states, drawn the same everywhere: loading, failed, empty, or the items with a
 * "Load more" button. A live region that's always there (one added along with its text often
 * isn't read) says what changed, so a search's results are announced.
 * @param {PagedList} list
 * @param {{ render: (items: any[]) => unknown, empty: unknown }} options
 */
export function renderPagedList(list, { render, empty }) {
    const live = html`<div class="paged-announce" role="status" aria-live="polite">${announcement(list)}</div>`;
    const failed = list.error
        ? html`<p class="paged-error" role="alert">${list.error.message || t('workflows.loadFailed')}</p>` : '';
    if (list.items === null) return html`${live}${failed || html`<p class="paged-status">${t('common.loading')}</p>`}`;
    if (!list.items.length) return html`${live}${failed}${empty}`;
    // While loading, the button stays focusable (aria-disabled, not disabled), so keyboard focus
    // isn't dropped to the page; more() ignores clicks until the page arrives.
    return html`
        ${live}
        ${render(list.items)}
        ${failed}
        ${list.hasMore ? html`
            <button class="secondary-button paged-more" type="button" aria-disabled=${String(list.loading)}
                @click=${() => list.more()}>
                ${list.loading ? t('workflows.loadingMore') : t('workflows.loadMore')}
            </button>
        ` : ''}
    `;
}

export class PagedList {
    /**
     * @param {(params: object) => Promise<{ items: any[], hasMore: boolean }>} fetchPage gets the
     *     search params plus `page` (from 1)
     * @param {() => void} onChange called whenever items, loading or error change
     */
    constructor(fetchPage, onChange) {
        this._fetchPage = fetchPage;
        this._onChange = onChange;
        this._run = 0;
        this._timer = null;
        this.items = null; // null until the first page arrives
        this.hasMore = false;
        this.loading = false;
        this.error = null; // the Error from the last failed load
        this._params = {};
        this._page = 0;
    }

    /** Load the first page for `params` (e.g. { q, sort }); what's shown stays until it arrives. */
    search(params = {}) {
        clearTimeout(this._timer);
        this._params = params;
        return this._load(1, ++this._run);
    }

    /** Search once typing pauses. */
    searchSoon(params) {
        clearTimeout(this._timer);
        this._timer = setTimeout(() => this.search(params), SEARCH_DELAY_MS);
    }

    /** Load the next page and add it to the list. */
    more() {
        if (!this.hasMore || this.loading) return Promise.resolve();
        return this._load(this._page + 1, this._run);
    }

    /** Stop a pending search (e.g. when the list is closed). */
    cancel() {
        clearTimeout(this._timer);
        this._run += 1;
        this.loading = false;
    }

    async _load(page, run) {
        Object.assign(this, { loading: true, error: null });
        this._onChange();
        try {
            const { items, hasMore } = await this._fetchPage({ ...this._params, page });
            if (run !== this._run) return;
            this.items = page === 1 ? items : [...(this.items || []), ...items];
            Object.assign(this, { hasMore, _page: page });
        } catch (err) {
            if (run === this._run) this.error = err;
        } finally {
            if (run === this._run) {
                this.loading = false;
                this._onChange();
            }
        }
    }
}
