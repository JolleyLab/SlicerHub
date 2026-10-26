import { css } from 'lit-element';

export const sideMenuStyles = css`
    :host {
        --side-menu-line-inset: 12px;
        --side-menu-page-padding: 16px;
        display: block;
        width: 100%;
        max-width: 260px;
        height: var(--side-menu-visible-height, auto);
        min-height: 0;
        font-family: var(--font-family-base);
        font-feature-settings: var(--font-feature-defaults);
    }

    nav {
        position: relative;
        width: 100%;
        height: inherit;
        min-height: 0;
        box-sizing: border-box;
        padding: 12px;
        border: none;
        border-radius: 0;
        background: transparent;
        box-shadow: none;
    }

    nav::after {
        content: '';
        position: absolute;
        top: var(--side-menu-line-inset);
        right: 0;
        bottom: var(--side-menu-line-inset);
        width: 1px;
        background: var(--color-text-secondary);
    }

    .menu-list {
        display: flex;
        flex-direction: column;
        gap: 10px;
        margin: 0;
        padding: 2px;
        list-style: none;
    }

    .menu-item {
        margin: 0;
        padding: 0;
    }

    .menu-button {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        background: var(--color-background);
        color: var(--color-text-primary);
        padding: 10px 12px;
        text-align: left;
        font: inherit;
        font-weight: 500;
        cursor: pointer;
        transition: background-color 0.2s ease, border-color 0.2s ease, transform 0.2s ease;
    }

    .menu-button:hover,
    .menu-button:focus-visible {
        background: var(--color-accent);
        border-color: var(--color-primary);
        transform: translateX(2px);
    }

    .menu-button:focus-visible {
        outline: 3px solid var(--color-focus, #0057c2);
        outline-offset: 2px;
        box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
    }

    .menu-button[aria-current='page'] {
        background: var(--color-primary);
        border-color: var(--color-primary);
        color: var(--color-on-primary);
        cursor: default;
        transform: none;
    }

    .menu-button[aria-current='page']:hover,
    .menu-button[aria-current='page']:focus-visible {
        background: var(--color-primary);
        border-color: var(--color-primary);
        transform: none;
    }

    :host-context([data-theme='dark']) .menu-button:hover,
    :host-context([data-theme='dark']) .menu-button:focus-visible {
        background: color-mix(in srgb, var(--color-primary) 18%, var(--color-surface));
        border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .menu-button[aria-current='page'] {
        background: var(--color-secondary);
        border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
        color: var(--color-on-secondary);
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
    }

    :host-context([data-theme='dark']) .menu-button[aria-current='page']:hover,
    :host-context([data-theme='dark']) .menu-button[aria-current='page']:focus-visible {
        background: color-mix(in srgb, var(--color-secondary) 82%, #fff);
        border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
        color: var(--color-on-secondary);
    }
`;
