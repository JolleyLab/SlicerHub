import { css } from 'lit-element';
import { phoneMedia } from '../styles/breakpoints.js';

/** The home page on phones. Listed after homePageStyles, so these win over the wide-screen rules. */
export const homePageMobileStyles = css`
    /* A section's item count: only on phones, where a folded section shows nothing else. */
    .panel-count {
        display: none;
    }

    @media ${phoneMedia} {
        /* The gear opens the layout settings, which phones don't offer. */
        .hero-customize {
            display: none;
        }

        .hero-title {
            padding-right: 0;
        }

        .panel-count {
            display: inline-flex;
            align-items: center;
            padding: 2px 8px;
            border: 1px solid var(--color-border);
            border-radius: 999px;
            background: color-mix(in srgb, var(--color-border) 16%, transparent);
            color: var(--color-text-secondary);
            font-size: 0.75rem;
            font-weight: 650;
            line-height: 1.3;
        }

        /* Folded: just the header, without the filter. */
        .panel.is-collapsed .panel-header {
            border-bottom: none;
        }

        .panel.is-collapsed .filter-dropdown {
            display: none;
        }

        /* Open sections grow with the page instead of scrolling inside it. */
        .card-list {
            max-height: none;
            overflow-y: visible;
        }
    }
`;
