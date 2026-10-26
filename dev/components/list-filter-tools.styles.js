import { css } from 'lit-element';

export const listFilterToolsStyles = css`
    :host {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
        font-family: var(--font-family-base);
        font-feature-settings: var(--font-feature-defaults);
    }

    .tool {
        position: relative;
        flex-shrink: 0;
    }

    .tool-trigger {
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-panel, #fff);
        color: var(--color-text-secondary);
        width: 32px;
        height: 30px;
        padding: 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }

    .tool-trigger:hover {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
        background: color-mix(in srgb, var(--color-primary) 8%, var(--color-panel, #fff));
    }

    .tool-trigger:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: 2px;
        color: var(--color-primary);
    }

    .tool-trigger[aria-expanded='true'],
    .tool-trigger.is-active {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-secondary) 55%, var(--color-border));
        background: color-mix(in srgb, var(--color-secondary) 12%, var(--color-panel, #fff));
    }

    .tool-trigger svg {
        display: block;
    }

    .tool-menu {
        position: absolute;
        top: calc(100% + 6px);
        right: 0;
        z-index: 20;
        min-width: 220px;
        padding: 6px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 6px);
        background: var(--color-panel, #fff);
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.18);
        box-sizing: border-box;
    }

    .tool-heading {
        margin: 0;
        padding: 6px 10px 8px;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .sort-item {
        display: grid;
        grid-template-columns: 18px minmax(0, 1fr);
        align-items: center;
        gap: 8px;
        width: 100%;
        border: none;
        border-radius: var(--radius-sm, 4px);
        background: transparent;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 0.875rem;
        font-weight: 500;
        text-align: left;
        padding: 8px 10px;
        cursor: pointer;
        box-sizing: border-box;
    }

    .sort-item:hover,
    .sort-item:focus-visible {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        outline: none;
    }

    .sort-item[aria-checked='true'] {
        color: var(--color-primary);
        background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
    }

    .sort-check {
        width: 18px;
        height: 18px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
    }

    .sort-check svg {
        display: block;
    }

    .search-row {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 6px;
        align-items: center;
        padding: 4px 4px 6px;
    }

    .search-input {
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm, 4px);
        padding: 8px 10px;
        font: inherit;
        font-size: 0.875rem;
        color: var(--color-text-primary);
        background: var(--color-background);
    }

    .search-input:focus-visible {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
    }

    .search-clear {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm, 4px);
        background: transparent;
        color: var(--color-text-secondary);
        min-height: 34px;
        padding: 0 10px;
        font: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        cursor: pointer;
    }

    .search-clear:hover:not(:disabled),
    .search-clear:focus-visible {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
        outline: none;
    }

    .search-clear:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }

    :host-context([data-theme='dark']) .tool-trigger {
        background: var(--color-panel);
    }

    :host-context([data-theme='dark']) .tool-trigger[aria-expanded='true'],
    :host-context([data-theme='dark']) .tool-trigger.is-active {
        background: color-mix(in srgb, var(--color-accent) 14%, var(--color-panel));
        border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .tool-menu {
        background: var(--color-panel);
        box-shadow: 0 12px 32px rgba(0, 0, 0, 0.45);
    }

    :host-context([data-theme='dark']) .sort-item[aria-checked='true'] {
        color: var(--color-text-primary);
        background: color-mix(in srgb, var(--color-accent) 16%, transparent);
    }

    :host-context([data-theme='dark']) .search-input {
        background: var(--color-background);
        border-color: var(--color-border);
        color: var(--color-text-primary);
    }
`;
