import { css } from 'lit-element';

/**
 * Sticky Save/Cancel row (add class "is-sticky" to it): pinned to the bottom of the screen while
 * the end of its form is out of view, back in its place once that's reached. The bar's background
 * is --sticky-bar-bg (set it to the surface it sits on). On phones it lets go while someone is
 * typing, since the keyboard already covers half the screen.
 *
 * Used by the workflow form, the case forms (via listPageStyles) and Settings.
 */
export const stickyActionsStyles = css`
    .is-sticky {
        position: sticky;
        bottom: 0;
        z-index: 5;
        flex-wrap: nowrap;
        background: var(--sticky-bar-bg, var(--color-surface, var(--color-background)));
        box-shadow: 0 -6px 14px -8px rgba(0, 0, 0, 0.18);
    }

    .is-sticky > * {
        min-width: 0;
    }

    :host-context([data-theme='dark']) .is-sticky {
        box-shadow: 0 -6px 14px -8px rgba(0, 0, 0, 0.5);
    }

    @media (max-width: 640px) {
        :has(> .is-sticky):has(input:not([type='checkbox']):not([type='radio']):focus, textarea:focus, tag-input:focus-within) > .is-sticky {
            position: static;
            box-shadow: none;
        }
    }
`;
