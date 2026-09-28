import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { HOME_WIDGETS, visibleColumns } from '../utils/homeLayout.js';
import { ICON_TODO, ICON_ACTIVITY, ICON_CASES } from '../utils/homeIcons.js';

const ICONS = { todo: ICON_TODO, activity: ICON_ACTIVITY, 'recent-cases': ICON_CASES };

/**
 * A small picture of a Home layout: the greeting strip, and the wide and narrow columns with a block
 * (and the widget's icon) for each section shown. The picture is decorative; its label says the same
 * thing in words for screen readers.
 */
export class HomeLayoutThumbnail extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
            }

            .thumb {
                display: flex;
                flex-direction: column;
                gap: 4px;
                box-sizing: border-box;
                width: 132px;
                height: 88px;
                padding: 6px;
                border: 1px solid var(--color-border);
                border-radius: 6px;
                background: var(--color-background);
            }

            .strip {
                flex: 0 0 9px;
                border-radius: 2px;
                background: color-mix(in srgb, var(--color-primary) 28%, transparent);
            }

            .cols {
                flex: 1;
                min-height: 0;
                display: grid;
                grid-template-columns: minmax(0, 1fr);
                gap: 4px;
            }

            .cols.two {
                grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
            }

            .col {
                display: flex;
                flex-direction: column;
                gap: 3px;
                min-height: 0;
            }

            .block {
                flex: 1;
                min-height: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px solid color-mix(in srgb, var(--color-primary) 45%, transparent);
                border-radius: 3px;
                background: color-mix(in srgb, var(--color-primary) 12%, var(--color-panel, var(--color-surface)));
                color: var(--color-primary);
            }

            :host-context([data-theme='dark']) .block {
                color: var(--color-text-primary);
            }

            .block svg {
                width: 11px;
                height: 11px;
                display: block;
            }

            .empty {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 1px dashed var(--color-border);
                border-radius: 3px;
            }
        `;
    }

    static get properties() {
        return { layout: { type: Object } };
    }

    label(columns) {
        const names = (widgets) => (widgets.length
            ? widgets.map((widget) => t(HOME_WIDGETS.find((entry) => entry.id === widget.id).titleKey)).join(', ')
            : t('homeLayout.previewNone'));
        if (!columns.main.length && !columns.side.length) return t('homeLayout.previewEmpty');
        return `${t('homeLayout.previewMain', { list: names(columns.main) })}. ${t('homeLayout.previewSide', { list: names(columns.side) })}.`;
    }

    renderColumn(widgets) {
        return html`<div class="col">${widgets.map((widget) => html`<div class="block">${ICONS[widget.id]}</div>`)}</div>`;
    }

    render() {
        const columns = visibleColumns(this.layout);
        const shown = [columns.main, columns.side].filter((widgets) => widgets.length > 0);
        return html`
            <div class="thumb" role="img" aria-label=${this.label(columns)}>
                <div class="strip"></div>
                ${shown.length === 0
                    ? html`<div class="empty"></div>`
                    : html`<div class="cols ${shown.length === 2 ? 'two' : ''}">${shown.map((widgets) => this.renderColumn(widgets))}</div>`}
            </div>
        `;
    }
}

customElements.define('home-layout-thumbnail', HomeLayoutThumbnail);
