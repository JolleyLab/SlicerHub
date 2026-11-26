import { css } from 'lit-element';

/** The case pages (list, detail, settings, viewer overlay): the styles not shared through styles/listPage.js. */
export const casesPageStyles = css`
    :host {
        display: block;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
    }

    /* â”€â”€â”€ Detail: layout â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    .case-detail {
        display: flex;
        flex-direction: column;
        gap: 18px;
        width: 100%;
        min-width: 0;
        max-width: 100%;
        box-sizing: border-box;
    }

    .case-detail-grid {
        display: grid;
        grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
        gap: 16px;
        align-items: stretch;
        width: 100%;
        min-width: 0;
        /* Shared pane height: both panels fill and scroll internally. */
        height: min(560px, 60vh);
        min-height: 380px;
    }

    .case-detail-grid .list-panel {
        order: 1;
        min-width: 0;
        min-height: 0;
        height: 100%;
        max-height: 100%;
    }

    .case-detail-grid comments-panel {
        --comments-panel-height: 100%;
        --comments-panel-max-height: 100%;
        min-height: 0;
        height: 100%;
        order: 2;
        min-width: 0;
    }

    /* Stacked when content column is narrow (tablet / DevTools), set via ResizeObserver */
    .case-detail[data-stack] .case-detail-grid {
        grid-template-columns: 1fr;
        align-items: start;
        height: auto;
        min-height: 0;
    }

    .case-detail[data-stack] .case-detail-grid .list-panel {
        height: auto;
        max-height: none;
        min-height: 0;
        width: 100%;
    }

    .case-detail[data-stack] .case-detail-grid comments-panel {
        --comments-panel-height: auto;
        --comments-panel-max-height: min(420px, 55vh);
        height: auto;
        min-height: 260px;
        width: 100%;
    }

    @media (max-width: 1100px) {
        .case-detail-grid {
            grid-template-columns: 1fr;
            align-items: start;
            height: auto;
            min-height: 0;
        }

        .case-detail-grid .list-panel {
            height: auto;
            max-height: none;
            min-height: 0;
            width: 100%;
        }

        .case-detail-grid comments-panel {
            --comments-panel-height: auto;
            --comments-panel-max-height: min(420px, 55vh);
            height: auto;
            min-height: 260px;
            width: 100%;
        }
    }

    /* â”€â”€â”€ Detail: toolbar + header â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    .quiet-button {
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 6px 12px;
        font: inherit;
        font-size: 0.8rem;
        font-weight: 600;
        background: var(--color-panel, #fff);
        color: var(--color-text-primary);
        cursor: pointer;
    }

    .quiet-button:hover:not(:disabled),
    .quiet-button:focus-visible {
        color: var(--color-on-secondary);
        background: var(--color-secondary);
        border-color: var(--color-secondary);
    }

    .quiet-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    .quiet-button:disabled {
        opacity: 0.55;
        cursor: not-allowed;
    }

    .people-pending-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-width: 1.25rem;
        height: 1.25rem;
        margin-left: 6px;
        padding: 0 5px;
        border-radius: 999px;
        background: var(--color-primary);
        color: var(--color-on-primary);
        font-size: 0.7rem;
        font-weight: 700;
        line-height: 1;
        vertical-align: middle;
    }

    /* â”€â”€â”€ File upload â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    .upload-action-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        min-height: 56px;
        margin: 0 -16px -12px;
        padding: 10px 16px;
        border-top: 1px solid var(--color-border);
        background: var(--color-panel, #fff);
        box-sizing: border-box;
        flex-shrink: 0;
    }

    .upload-action-row .secondary-button {
        min-height: 36px;
    }

    .upload-action-buttons {
        display: flex;
        gap: 8px;
        flex-shrink: 0;
    }


    .upload-status {
        color: var(--color-text-secondary);
        font-size: 0.85rem;
        flex: 1;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .upload-progress {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .upload-progress progress {
        width: 100%;
        height: 8px;
        accent-color: var(--color-focus, var(--color-primary));
    }

    .upload-error {
        color: var(--color-status-error-fg, #8a1212);
        font-size: 0.85rem;
        flex: 1;
    }

    /* Download button: a spinner while the access check runs (still, if reduced motion is asked for) */
    .download-spinner {
        width: 14px;
        height: 14px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: download-spin 0.8s linear infinite;
    }

    @keyframes download-spin {
        to { transform: rotate(360deg); }
    }

    @media (prefers-reduced-motion: reduce) {
        .download-spinner {
            animation: none;
            border-right-color: currentColor;
        }
    }

    /* Read by screen readers only */
    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
    }

    /* Drag-and-drop attach */
    .list-panel-body.drag-over {
        outline: 2px dashed var(--color-focus, var(--color-primary));
        outline-offset: -6px;
    }

    .drop-hint {
        position: absolute;
        inset: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        /* text-primary on a lightly tinted panel keeps AA contrast in both themes */
        background: color-mix(in srgb, var(--color-focus, var(--color-primary)) 14%, var(--color-panel, #fff));
        color: var(--color-text-primary);
        font-weight: 600;
        pointer-events: none;
    }

    /* â”€â”€â”€ Buttons â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
    .primary-button,
    .secondary-button {
        border-radius: 6px;
        padding: 8px 18px;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        cursor: pointer;
        transition: opacity 0.14s, box-shadow 0.14s, background 0.14s;
        display: inline-flex;
        align-items: center;
        line-height: 1.2;
        white-space: nowrap;
    }

    .primary-button {
        background: var(--color-primary);
        color: var(--color-on-primary);
        border: 1px solid transparent;
    }

    .primary-button:hover:not(:disabled) {
        opacity: 0.87;
        box-shadow: 0 2px 8px color-mix(in srgb, var(--color-primary) 32%, transparent);
    }

    .secondary-button {
        background: transparent;
        color: var(--color-text-primary);
        border: 1px solid var(--color-border);
    }

    .secondary-button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface, var(--color-background)));
        border-color: color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
    }

    .primary-button:focus-visible,
    .secondary-button:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
    }

    .primary-button:disabled,
    .secondary-button:disabled {
        opacity: 0.42;
        cursor: not-allowed;
    }

    /* â”€â”€â”€ Dark mode overrides â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */

    :host-context([data-theme='dark']) .upload-action-row {
        background: var(--color-panel);
        border-top-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .quiet-button {
        color: var(--color-text-primary);
        border-color: var(--color-border);
        background: var(--color-panel);
    }

    :host-context([data-theme='dark']) .quiet-button:hover:not(:disabled),
    :host-context([data-theme='dark']) .quiet-button:focus-visible {
        color: var(--color-on-secondary);
        background: var(--color-accent);
        border-color: var(--color-accent);
    }

    /* Primary button: use the brighter accent so it doesn't vanish */
    :host-context([data-theme='dark']) .primary-button {
        background: var(--color-secondary);
        color: var(--color-on-primary);
    }

    :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
        opacity: 0.85;
        box-shadow: 0 2px 10px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    /* Secondary button: visible ghost on dark panel */
    :host-context([data-theme='dark']) .secondary-button {
        color: var(--color-text-primary);
        border-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .secondary-button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 10%, var(--color-panel));
        border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
    }

    /* Detail header separator */
    :host-context([data-theme='dark']) .detail-header {
        border-bottom-color: var(--color-border);
    }

    /* Upload row separator */
    :host-context([data-theme='dark']) .upload-action-row {
        border-top-color: var(--color-border);
    }

    /* â”€â”€â”€ Viewer overlay (edge-to-edge; header is the only chrome) â”€â”€ */
    .iframe-overlay {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: flex;
        flex-direction: column;
        gap: 0;
        padding: 0;
        box-sizing: border-box;
        background: #090b14;
        color: var(--color-text-primary);
        font-family: var(--font-family-base);
        font-feature-settings: var(--font-feature-defaults);
    }

    .iframe-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 16px;
        flex-shrink: 0;
        padding: 10px 14px;
        border: none;
        border-bottom: 1px solid var(--color-border);
        border-radius: 0;
        background: var(--color-surface, var(--color-background));
        color: var(--color-text-primary);
        box-shadow: none;
    }

    .iframe-title {
        min-width: 0;
        font-size: 0.925rem;
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--color-text-primary);
    }

    .iframe-header-actions {
        display: flex;
        flex-shrink: 0;
        gap: 10px;
        align-items: center;
    }

    /* Phone width: the title takes its own line and the actions wrap below it. */
    @media (max-width: 600px) {
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

    .iframe-container {
        flex: 1;
        display: flex;
        position: relative;
        min-height: 0;
        overflow: hidden;
        border: none;
        border-radius: 0;
        background: #090b14;
    }

    .viewer-iframe {
        flex: 1;
        width: 100%;
        height: 100%;
        border: 0;
        background: #090b14;
    }

    .loading-overlay {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        background: color-mix(in srgb, var(--color-background) 80%, transparent);
        pointer-events: none;
    }

    .viewer-loading {
        text-align: center;
        padding: 16px;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

    .toast {
        position: fixed;
        right: 20px;
        bottom: 20px;
        z-index: 1200;
        background: var(--color-success, #2e7d32);
        color: #fff;
        border-radius: var(--radius-md, 6px);
        padding: 10px 16px;
        box-shadow: 0 10px 28px rgba(0, 0, 0, 0.2);
        max-width: min(380px, calc(100vw - 40px));
        font-weight: 500;
        font-size: 0.9rem;
        line-height: 1.4;
    }

    .save-indicator {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .viewer-error-message {
        font-size: 0.85rem;
        color: var(--color-status-error-fg, #8a1212);
        white-space: nowrap;
        max-width: 220px;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .file-icon-button svg { width: 18px; height: 18px; } /* balances the 24px toolkit icon beside them */
    /* The toolkit icon and its chevron: one split button, open with the default | choose another.
       Like the other row actions, its outline (and the divider) only shows on hover or focus. */
    .open-with-split {
        box-sizing: border-box;
        display: inline-flex;
        align-items: stretch;
        height: 34px;
        border: 1px solid transparent;
        border-radius: var(--radius-lg);
    }
    .open-with-split:hover,
    .open-with-split:focus-within {
        border-color: var(--color-border);
    }
    .open-with-icon {
        width: 30px; /* 3px around the 24px icon: room for the hover tint, not so wide it drifts from the ▾ */
        padding: 0;
        border: none;
        border-radius: var(--radius-lg) 0 0 var(--radius-lg);
        background: transparent;
        color: inherit;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        cursor: pointer;
    }
    .open-with-icon .icon-tile { --icon-tile-size: 24px; }
    .open-with-split open-with-menu::part(trigger) {
        height: 100%;
        min-width: 24px;
        border-left: 1px solid transparent;
        border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
    }
    /* A smaller ▾ to look at; the button stays 24px wide (WCAG 2.5.8: it touches the icon button). */
    .open-with-split open-with-menu::part(chevron) {
        width: 12px;
        height: 12px;
    }
    .open-with-split:hover open-with-menu::part(trigger),
    .open-with-split:focus-within open-with-menu::part(trigger) {
        border-left-color: var(--color-border);
    }
    .open-with-icon:hover:not(:disabled),
    .open-with-icon:focus-visible {
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
    }
    .open-with-icon:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }
    .open-with-icon:disabled {
        opacity: 0.45;
        cursor: not-allowed;
    }
`;
