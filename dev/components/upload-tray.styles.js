import { css } from 'lit-element';

export const uploadTrayStyles = css`
    :host {
        position: fixed;
        right: 16px;
        bottom: 16px;
        z-index: 9000;
        font-family: var(--font-family-base);
        font-feature-settings: var(--font-feature-defaults);
    }

    .tray {
        width: min(360px, calc(100vw - 32px));
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg, 10px);
        background: var(--color-panel, var(--color-surface, #fff));
        color: var(--color-text-primary);
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
        overflow: hidden;
    }

    .tray-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border: 0;
        width: 100%;
        background: transparent;
        color: inherit;
        font: inherit;
        font-weight: 700;
        font-size: 0.9rem;
        cursor: pointer;
        text-align: left;
    }

    .tray-header:focus-visible,
    .icon-button:focus-visible,
    .text-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: 2px;
    }

    .chevron {
        transition: transform 0.15s ease;
    }

    .collapsed .chevron {
        transform: rotate(180deg);
    }

    .tray-body {
        max-height: min(50vh, 360px);
        overflow-y: auto;
        border-top: 1px solid var(--color-border);
    }

    .jobs {
        list-style: none;
        margin: 0;
        padding: 0;
    }

    .tray-footer {
        padding: 8px 12px;
        border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    }

    .job {
        display: flex;
        flex-direction: column;
        gap: 4px;
        padding: 10px 12px;
    }

    .job + .job {
        border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
    }

    .job-head {
        display: flex;
        align-items: baseline;
        justify-content: space-between;
        gap: 8px;
    }

    .job-name {
        font-size: 0.85rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        min-width: 0;
    }

    .job-case,
    .job-status,
    .job-rate {
        font-size: 0.78rem;
        color: var(--color-text-secondary);
    }

    .job-case {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    .job-status.is-error {
        color: var(--color-status-error-fg, #c62828);
    }

    progress {
        width: 100%;
        height: 6px;
        /* focus is the theme's on-panel blue: readable in both light and dark */
        accent-color: var(--color-focus, var(--color-primary));
    }

    .job-actions {
        display: flex;
        gap: 12px;
        margin-top: 2px;
    }

    .text-button {
        border: 0;
        padding: 0;
        background: transparent;
        color: var(--color-focus, var(--color-primary));
        font: inherit;
        font-size: 0.78rem;
        font-weight: 600;
        cursor: pointer;
    }

    .text-button:hover {
        text-decoration: underline;
    }

    .details-intro {
        margin: 0 0 14px;
        font-size: 0.875rem;
        color: var(--color-text-secondary);
    }

    .details-row {
        display: flex;
        flex-direction: column;
        gap: 4px;
        margin-bottom: 12px;
    }

    .details-row label {
        font-size: 0.8rem;
        font-weight: 600;
    }

    .details-row input {
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 8px 10px;
        font: inherit;
        font-size: 0.9rem;
        background: var(--color-surface, var(--color-background));
        color: var(--color-text-primary);
    }

    .details-row input:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    .details-file {
        font-size: 0.75rem;
        color: var(--color-text-secondary);
    }
`;
