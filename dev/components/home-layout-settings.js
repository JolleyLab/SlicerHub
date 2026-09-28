import { LitElement, html, css } from 'lit-element';
import { repeat } from 'lit-html/directives/repeat.js';
import Sortable from 'sortablejs';
import { t } from '../i18n/index.js';
import './home-layout-thumbnail.js';
import {
    HOME_WIDGETS,
    HOME_PRESETS,
    normalizeHomeLayout,
    matchPreset,
    presetLayout,
    widgetsInColumn,
    moveWidget,
    moveToColumn,
    placeWidget,
    setWidgetHidden
} from '../utils/homeLayout.js';

const COLUMN_LABEL_KEYS = { main: 'homeLayout.mainColumn', side: 'homeLayout.sideColumn' };

/**
 * Settings for the Home page: a preset, and for each section whether it shows, which column it is in
 * (wide or narrow) and where in that column. Reordering and moving use buttons, so all of it works from
 * the keyboard; each change is announced. Emits `layout-change` with { layout }.
 */
export class HomeLayoutSettings extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            fieldset {
                margin: 0 0 16px;
                padding: 0;
                border: 0;
                min-width: 0;
            }

            legend {
                padding: 0;
                margin-bottom: 8px;
                font-weight: 600;
                font-size: 0.9rem;
                color: var(--color-text-primary);
            }

            .presets {
                display: flex;
                flex-wrap: wrap;
                gap: 12px;
            }

            .preset {
                position: relative;
            }

            .preset input {
                position: absolute;
                opacity: 0;
                width: 100%;
                height: 100%;
                margin: 0;
                cursor: pointer;
            }

            .preset-body {
                display: flex;
                flex-direction: column;
                gap: 6px;
                align-items: center;
                padding: 8px;
                border: 2px solid transparent;
                border-radius: var(--radius-md, 8px);
                color: var(--color-text-primary);
                font-size: 0.9rem;
                text-align: center;
            }

            .preset input:hover + .preset-body {
                background: color-mix(in srgb, var(--color-primary) 6%, transparent);
            }

            .preset input:checked + .preset-body,
            .preset.is-custom .preset-body {
                border-color: var(--color-primary);
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
                font-weight: 600;
            }

            :host-context([data-theme='dark']) .preset input:checked + .preset-body,
            :host-context([data-theme='dark']) .preset.is-custom .preset-body {
                border-color: var(--color-accent);
            }

            .preset input:focus-visible + .preset-body {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .column-group + .column-group {
                margin-top: 12px;
            }

            .column-heading {
                margin: 0 0 6px;
                font-size: 0.85rem;
                font-weight: 700;
                color: var(--color-text-secondary);
            }

            .column-heading .width {
                font-weight: 400;
            }

            .sections {
                margin: 0;
                padding: 0;
                list-style: none;
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .section-row {
                display: flex;
                align-items: center;
                flex-wrap: wrap;
                gap: 10px 12px;
                padding: 8px 12px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                background: var(--color-surface, var(--color-background));
            }

            .sections {
                min-height: 44px;
            }

            .grip {
                flex: 0 0 auto;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                align-self: stretch;
                margin: -8px 0 -8px -6px;
                color: var(--color-text-secondary);
                font-size: 1.1rem;
                letter-spacing: -3px;
                cursor: grab;
                touch-action: none;
                user-select: none;
            }

            .grip:hover {
                color: var(--color-text-primary);
            }

            /* SortableJS state classes */
            .section-row.is-ghost {
                opacity: 0.45;
                border-style: dashed;
            }

            .section-row.is-dragging {
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.25));
                cursor: grabbing;
            }

            .empty-column {
                list-style: none;
                margin: 0;
                padding: 8px 12px;
                border: 1px dashed var(--color-border);
                border-radius: var(--radius-md, 8px);
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .hint {
                margin: 0 0 10px;
                font-size: 0.85rem;
                color: var(--color-text-secondary);
            }

            .choice {
                display: inline-flex;
                align-items: center;
                gap: 7px;
                flex: 1;
                min-width: 150px;
                color: var(--color-text-primary);
                font-size: 0.95rem;
                font-weight: 600;
                cursor: pointer;
            }

            .choice input {
                width: 1.05rem;
                height: 1.05rem;
                accent-color: var(--color-primary);
                cursor: pointer;
            }

            .position {
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                white-space: nowrap;
            }

            .move,
            .relocate {
                border: 1px solid var(--color-border);
                border-radius: 6px;
                background: transparent;
                color: var(--color-text-primary);
                font: inherit;
                cursor: pointer;
            }

            .move {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 34px;
                height: 34px;
                padding: 0;
                font-size: 1rem;
            }

            .relocate {
                padding: 6px 10px;
                font-size: 0.85rem;
                font-weight: 600;
            }

            .move:hover:not([aria-disabled='true']),
            .relocate:hover {
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
            }

            .move[aria-disabled='true'] {
                opacity: 0.4;
                cursor: not-allowed;
            }

            .move:focus-visible,
            .relocate:focus-visible,
            .choice input:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .visually-hidden {
                position: absolute;
                width: 1px;
                height: 1px;
                margin: -1px;
                padding: 0;
                overflow: hidden;
                clip: rect(0, 0, 0, 0);
                white-space: nowrap;
                border: 0;
            }
        `;
    }

    static get properties() {
        return {
            layout: { type: Object },
            announcement: { type: String }
        };
    }

    constructor() {
        super();
        this.layout = normalizeHomeLayout(null);
        this.announcement = '';
    }

    firstUpdated() {
        // One group across both columns, so a row can be dragged between them. Dragging starts only from
        // the grip, so the checkbox and buttons keep working, and touch scrolling is not hijacked.
        // forceFallback uses plain pointer events (mouse, touch, pen) instead of native drag and drop.
        const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        this._sortables = [...this.renderRoot.querySelectorAll('.sections')].map((list) => Sortable.create(list, {
            group: 'home-widgets',
            draggable: '.section-row',
            handle: '.grip',
            forceFallback: true,
            fallbackTolerance: 3,
            emptyInsertThreshold: 16,
            animation: reduceMotion ? 0 : 150,
            ghostClass: 'is-ghost',
            dragClass: 'is-dragging',
            onStart: (event) => this.handleDragStart(event),
            onEnd: (event) => this.handleDrop(event)
        }));
    }

    disconnectedCallback() {
        this._sortables?.forEach((sortable) => sortable.destroy());
        this._sortables = null;
        super.disconnectedCallback();
    }

    /** Remember exactly where the row sits in the DOM, comment markers included, so it can be put back. */
    handleDragStart(event) {
        this._dragOrigin = { parent: event.item.parentNode, next: event.item.nextSibling };
    }

    /**
     * SortableJS has already moved the row in the DOM. Put it back exactly where it was (Lit tracks its
     * rows with hidden comment nodes, so inserting by element index would break its bookkeeping), and
     * record the drop in the layout instead; Lit then redraws from the new layout.
     */
    handleDrop(event) {
        const { item, from, to, oldIndex, newIndex } = event;
        const origin = this._dragOrigin;
        this._dragOrigin = null;
        this.clearStuckClickGuard();
        item.parentNode?.removeChild(item);
        (origin?.parent || from).insertBefore(item, origin ? origin.next : null);
        if (!this.releasedOverALists(event.originalEvent)) return;
        const column = to.dataset.column;
        if (from === to && oldIndex === newIndex) return;
        const id = item.dataset.widget;
        const next = placeWidget(this.layout, id, column, newIndex);
        const total = widgetsInColumn(next, column).length;
        this.emit(next, t('homeLayout.dropped', {
            title: this.titleOf(id),
            column: t(COLUMN_LABEL_KEYS[column]),
            n: next.widgets.filter((w) => w.column === column).findIndex((w) => w.id === id) + 1,
            total
        }));
    }

    /**
     * In pointer-event mode SortableJS makes the page ignore the next click after a drag, and only clears
     * that once the row moves over another row (sortablejs issue 1184). A drag that never does, such as
     * one let go outside the lists, would leave the next real click swallowed. Send it one click that
     * nothing acts on, so the guard is spent before the user's own click arrives.
     */
    clearStuckClickGuard() {
        setTimeout(() => document.dispatchEvent(new MouseEvent('click', { cancelable: true })), 0);
    }

    /**
     * A drop counts only if the pointer was let go over one of the lists (with a little margin). Let go
     * anywhere else, it cancels; SortableJS alone would keep the row wherever it last hovered.
     */
    releasedOverALists(pointerEvent) {
        const point = pointerEvent?.changedTouches?.[0] || pointerEvent;
        if (typeof point?.clientX !== 'number') return true;
        const margin = 16;
        return [...this.renderRoot.querySelectorAll('.sections')].some((list) => {
            const box = list.getBoundingClientRect();
            return point.clientX >= box.left - margin && point.clientX <= box.right + margin
                && point.clientY >= box.top - margin && point.clientY <= box.bottom + margin;
        });
    }

    titleOf(id) {
        const widget = HOME_WIDGETS.find((entry) => entry.id === id);
        return widget ? t(widget.titleKey) : id;
    }

    emit(layout, announcement = '') {
        this.layout = layout;
        this.announcement = announcement;
        this.dispatchEvent(new CustomEvent('layout-change', { detail: { layout }, bubbles: true, composed: true }));
    }

    choosePreset(presetId) {
        const layout = presetLayout(presetId);
        if (layout) this.emit(layout, t('homeLayout.presetChosen', { name: t(HOME_PRESETS.find((p) => p.id === presetId).labelKey) }));
    }

    /** Reordering or moving relocates the row in the page, which drops focus; put it back. */
    async refocus(selector) {
        await this.updateComplete;
        this.renderRoot.querySelector(selector)?.focus();
    }

    move(id, delta) {
        const before = normalizeHomeLayout(this.layout);
        const inColumn = widgetsInColumn(before, before.widgets.find((w) => w.id === id).column);
        const to = inColumn.findIndex((w) => w.id === id) + delta;
        if (to < 0 || to >= inColumn.length) return;
        this.emit(moveWidget(before, id, delta), t('homeLayout.moved', { title: this.titleOf(id), n: to + 1, total: inColumn.length }));
        this.refocus(`[data-move="${id}:${delta}"]`);
    }

    relocate(id, column) {
        const target = column === 'main' ? 'side' : 'main';
        this.emit(moveToColumn(this.layout, id, target), t('homeLayout.relocated', { title: this.titleOf(id), column: t(COLUMN_LABEL_KEYS[target]) }));
        this.refocus(`[data-relocate="${id}"]`);
    }

    renderRow(widget, index, total) {
        const layout = normalizeHomeLayout(this.layout);
        const title = this.titleOf(widget.id);
        const otherColumn = widget.column === 'main' ? 'side' : 'main';
        return html`
            <li class="section-row" data-widget="${widget.id}">
                <span class="grip" aria-hidden="true" title="${t('homeLayout.dragTitle')}">⋮⋮</span>
                <label class="choice">
                    <input type="checkbox" .checked=${!widget.hidden}
                        @change=${(e) => this.emit(
                            setWidgetHidden(layout, widget.id, !e.target.checked),
                            t(e.target.checked ? 'homeLayout.shown' : 'homeLayout.hidden', { title })
                        )} />
                    ${t('homeLayout.show', { title })}
                </label>
                <span class="position">${t('homeLayout.position', { n: index + 1, total })}</span>
                <button type="button" class="move" data-move="${widget.id}:-1"
                    aria-disabled=${index === 0 ? 'true' : 'false'}
                    aria-label=${t('homeLayout.moveUp', { title })}
                    @click=${() => this.move(widget.id, -1)}><span aria-hidden="true">↑</span></button>
                <button type="button" class="move" data-move="${widget.id}:1"
                    aria-disabled=${index === total - 1 ? 'true' : 'false'}
                    aria-label=${t('homeLayout.moveDown', { title })}
                    @click=${() => this.move(widget.id, 1)}><span aria-hidden="true">↓</span></button>
                <button type="button" class="relocate" data-relocate="${widget.id}"
                    aria-label=${t('homeLayout.relocateAria', { title, column: t(COLUMN_LABEL_KEYS[otherColumn]) })}
                    @click=${() => this.relocate(widget.id, widget.column)}>${t(otherColumn === 'side' ? 'homeLayout.toSide' : 'homeLayout.toMain')}</button>
            </li>
        `;
    }

    render() {
        const layout = normalizeHomeLayout(this.layout);
        const current = matchPreset(layout);
        return html`
            <fieldset>
                <legend>${t('homeLayout.layoutLabel')}</legend>
                <div class="presets">
                    ${HOME_PRESETS.map((preset) => html`
                        <label class="preset">
                            <input type="radio" name="home-preset" .checked=${current === preset.id}
                                @change=${() => this.choosePreset(preset.id)} />
                            <span class="preset-body">
                                <home-layout-thumbnail .layout=${preset.layout}></home-layout-thumbnail>
                                ${t(preset.labelKey)}
                            </span>
                        </label>
                    `)}
                    ${current === 'custom' ? html`
                        <div class="preset is-custom">
                            <span class="preset-body">
                                <home-layout-thumbnail .layout=${layout}></home-layout-thumbnail>
                                ${t('homeLayout.custom')}
                            </span>
                        </div>
                    ` : ''}
                </div>
            </fieldset>

            <fieldset>
                <legend>${t('homeLayout.sectionsLabel')}</legend>
                <p class="hint">${t('homeLayout.dragHint')}</p>
                ${['main', 'side'].map((column) => {
                    const widgets = widgetsInColumn(layout, column);
                    return html`
                        <div class="column-group">
                            <h4 class="column-heading">
                                ${t(COLUMN_LABEL_KEYS[column])}
                                <span class="width">${t(column === 'main' ? 'homeLayout.wide' : 'homeLayout.narrow')}</span>
                            </h4>
                            <ul class="sections" data-column="${column}">
                                ${repeat(widgets, (widget) => widget.id, (widget, index) => this.renderRow(widget, index, widgets.length))}
                                ${widgets.length === 0 ? html`<li class="empty-column">${t(column === 'side' ? 'homeLayout.emptySide' : 'homeLayout.emptyMain')}</li>` : ''}
                            </ul>
                        </div>
                    `;
                })}
            </fieldset>
            <div class="visually-hidden" role="status" aria-live="polite">${this.announcement}</div>
        `;
    }
}

customElements.define('home-layout-settings', HomeLayoutSettings);
