import { html, css } from 'lit-element';
import { phoneMedia } from './breakpoints.js';
import { ICON_EXPAND } from '../utils/icons.js';

/**
 * A panel that collapses to its header on phones only; on wider screens it is always open.
 *
 * Put collapsibleTitle() inside the panel's heading and mark what hides with `.collapse-body`. Collapsed is
 * `.is-collapsed` on an ancestor of the body (the panel), or the `collapsed` attribute on a component's host.
 * The title renders twice and CSS shows one: plain text on wide screens, a toggle button on phones.
 */
export const collapsibleStyles = css`
    .collapse-toggle {
        display: none;
    }

    @media ${phoneMedia} {
        .collapse-label {
            display: none;
        }

        .collapse-toggle {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            min-height: var(--tap-target-min, 32px);
            margin-left: -6px;
            padding: 0 6px;
            border: none;
            border-radius: var(--radius-sm, 4px);
            background: transparent;
            color: inherit;
            font: inherit;
            letter-spacing: inherit;
            text-transform: inherit;
            cursor: pointer;
        }

        .collapse-toggle:focus-visible {
            outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
            outline-offset: var(--focus-ring-offset, 2px);
        }

        .collapse-toggle svg {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
            transition: transform 0.15s ease;
        }

        .collapse-toggle[aria-expanded='false'] svg {
            transform: rotate(-90deg);
        }

        .is-collapsed .collapse-body,
        :host([collapsed]) .collapse-body {
            display: none;
        }
    }

    @media ${phoneMedia} and (prefers-reduced-motion: reduce) {
        .collapse-toggle svg {
            transition: none;
        }
    }
`;

/** The heading's text: plain on wide screens, a show/hide toggle for `controls` (an id) on phones. */
export function collapsibleTitle({ label, collapsed, controls, onToggle }) {
    return html`<span class="collapse-label">${label}</span><button
        type="button"
        class="collapse-toggle"
        aria-expanded=${collapsed ? 'false' : 'true'}
        aria-controls=${controls}
        @click=${onToggle}
    >${ICON_EXPAND}${label}</button>`;
}
