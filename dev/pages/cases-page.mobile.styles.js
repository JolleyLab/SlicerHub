import { css } from 'lit-element';
import { phoneMedia } from '../styles/breakpoints.js';

/** The case pages on phones. Listed after casesPageStyles, so these win over the wide-screen rules. */
export const casesPageMobileStyles = css`
    /* Controls drawn twice, one shown per screen size: a file row's icon buttons or its ⋯ menu (Open with, Download,
       Remove), and the case toolbar's Share button + ⋯ or a single ⋯ that includes Share. */
    .narrow-only {
        display: none;
    }

    @media ${phoneMedia} {
        .wide-only {
            display: none;
        }

        .narrow-only {
            display: inline-flex;
        }

        /* Case top: "← My Cases" on its own line, then the title with Share and ⋯ beside it, without the title's card.
           The toolbar and the card step aside (display: contents) so their parts can share the grid's rows. */
        .case-detail {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            column-gap: 8px;
            row-gap: 14px;
        }

        .case-detail > * {
            grid-column: 1 / -1;
        }

        .detail-toolbar,
        .detail-header {
            display: contents;
        }

        .back-link {
            grid-column: 1 / -1;
            grid-row: 1;
            justify-self: start;
            margin-bottom: -8px;
        }

        .detail-title-row {
            grid-column: 1;
            grid-row: 2;
            align-self: center;
        }

        .detail-toolbar-actions {
            grid-column: 2;
            grid-row: 2;
            align-self: start;
            flex-wrap: nowrap;
        }

        .detail-desc {
            grid-column: 1 / -1;
            margin-top: -6px;
        }

        /* Collapsed Attachments: just its header, without the search and filter buttons. */
        .list-panel.is-collapsed .panel-header {
            border-bottom: none;
        }

        .list-panel.is-collapsed list-filter-tools {
            display: none;
        }

        /* Collapsed Comments: drop the panel's minimum height so only its header shows. */
        .case-detail .case-detail-grid comments-panel[collapsed] {
            min-height: 0;
        }

        /* Viewer overlay: the title takes its own line and the actions wrap below it. */
        .iframe-header {
            flex-wrap: wrap;
            gap: 6px 10px;
            padding: 8px 10px;
        }

        .iframe-title {
            flex: 1 1 100%;
        }

        .iframe-header-actions {
            flex-shrink: 1;
            flex-wrap: wrap;
            justify-content: flex-end;
            gap: 6px;
            margin-left: auto;
        }

        .iframe-header-actions .primary-button,
        .iframe-header-actions .secondary-button {
            padding: 6px 12px;
        }
    }
`;
