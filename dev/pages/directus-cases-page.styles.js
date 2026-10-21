import { css } from 'lit-element';

export const casesPageStyles = css`
    :host {
        display: block;
        width: 100%;
        min-width: 0;
        box-sizing: border-box;
    }

    /* ─── Base ─────────────────────────────────────────────── */
    .status-note {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
        padding: 8px 0;
    }

    /* ─── Landing: page header ──────────────────────────────── */
    .page-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .page-header-actions {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .page-heading {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 600;
        color: var(--color-text-primary);
        letter-spacing: -0.01em;
    }

    .page-header-row .primary-button::before {
        content: '+';
        margin-right: 5px;
        font-weight: 300;
        font-size: 1.15em;
        line-height: 1;
    }

    .page-header-row .primary-button.is-cancel::before {
        content: none;
    }

    .cases-empty-filter {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

    /* ─── Landing: case grid ────────────────────────────────── */
    .case-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
        gap: 10px;
        width: 100%;
        min-width: 0;
    }

    .case-card {
        position: relative;
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-primary);
        border-radius: 8px;
        background: var(--color-surface, var(--color-background));
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        cursor: pointer;
        transition: box-shadow 0.14s ease, transform 0.14s ease, border-color 0.14s ease;
        text-align: left;
        font: inherit;
        color: inherit;
        width: 100%;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        appearance: none;
        -webkit-appearance: none;
    }

    .case-card.is-archived {
        border-left-color: var(--color-text-secondary);
        opacity: 0.7;
    }

    .case-card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
        border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
        border-left-color: var(--color-primary);
    }

    .case-card.is-archived:hover {
        border-left-color: var(--color-text-secondary);
        border-color: var(--color-border);
    }

    .case-card:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent);
    }

    .case-card-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
    }

    .case-card-title {
        font-size: 0.925rem;
        font-weight: 600;
        color: var(--color-text-primary);
        line-height: 1.3;
        min-width: 0;
    }

    .case-card-new-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
        background: color-mix(in srgb, var(--color-secondary) 16%, transparent);
        color: var(--color-primary);
        line-height: 1.3;
    }

    :host-context([data-theme='dark']) .case-card-new-badge {
        border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        color: var(--color-text-primary);
    }

    .case-card-desc {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 0;
    }

    .case-card-meta-row {
        display: flex;
        align-items: center;
        gap: 0;
        margin-top: 6px;
        flex-wrap: wrap;
    }

    .case-card-meta-item {
        font-size: 0.78rem;
        color: var(--color-text-secondary);
    }

    .case-card-meta-item + .case-card-meta-item::before {
        content: '·';
        margin: 0 5px;
        opacity: 0.45;
    }

    /* ─── Status chip ───────────────────────────────────────── */
    .status-chip {
        display: inline-flex;
        align-items: center;
        font-size: 0.7rem;
        font-weight: 600;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-border) 18%, transparent);
        color: var(--color-text-secondary);
    }

    /* ─── Detail: layout ────────────────────────────────────── */
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

    .case-detail-grid .files-panel {
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

    .case-detail[data-stack] .case-detail-grid .files-panel {
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

        .case-detail-grid .files-panel {
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

    /* ─── Detail: toolbar + header ──────────────────────────── */
    .detail-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }

    .back-link {
        border: none;
        background: transparent;
        padding: 4px 0;
        margin: 0;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-focus);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .back-link:hover,
    .back-link:focus-visible {
        color: var(--color-text-primary);
    }

    .back-link:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
        border-radius: 4px;
    }

    .detail-toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .toolbar-more-menu {
        position: relative;
    }

    .toolbar-more-btn {
        min-width: 0;
        padding: 5px 10px;
        letter-spacing: 0.05em;
    }

    /* ─── Split button (e.g. Save | ▾) ─────────────────────────── */
    .split-button {
        position: relative;
        display: inline-flex;
    }

    .split-button__main {
        border-radius: 6px 0 0 6px;
        border-right: 1px solid rgba(255,255,255,0.25);
    }

    .split-button__arrow {
        border-radius: 0 6px 6px 0;
        padding: 8px 10px;
    }

    .split-button__menu {
        position: absolute;
        bottom: calc(100% + 4px);
        right: 0;
        z-index: 200;
        background: var(--color-panel, #fff);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 6px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        min-width: 140px;
        padding: 4px 0;
    }

    .toolbar-more-dropdown {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        z-index: 200;
        background: var(--color-panel, #fff);
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 6px);
        box-shadow: 0 4px 12px rgba(0,0,0,0.12);
        min-width: 160px;
        padding: 4px 0;
    }

    .toolbar-more-item {
        display: block;
        width: 100%;
        padding: 8px 14px;
        text-align: left;
        background: none;
        border: none;
        font: inherit;
        font-size: 0.85rem;
        color: var(--color-text-primary, #111);
        cursor: pointer;
        white-space: nowrap;
    }

    .toolbar-more-item:hover {
        background: color-mix(in srgb, var(--color-border) 20%, transparent);
    }

    .audit-view-container {
        padding: 20px 0;
    }

    .detail-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 16px 16px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-panel, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
        border-left: 4px solid var(--color-primary);
    }

    .detail-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .detail-title {
        margin: 0;
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--color-primary);
        letter-spacing: -0.02em;
        line-height: 1.25;
    }

    .detail-desc {
        margin: 0;
        font-size: 0.95rem;
        color: var(--color-text-secondary);
        line-height: 1.55;
        max-width: 46rem;
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

    /* ─── Detail: files panel ───────────────────────────────── */
    .files-panel {
        border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-primary);
        border-radius: var(--radius-lg);
        background: var(--color-panel, #fff);
        display: flex;
        flex-direction: column;
        min-height: 360px;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 44px;
        padding: 0 16px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-panel, #fff);
        box-sizing: border-box;
        flex-shrink: 0;
    }

    .panel-header-start {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .panel-title {
        margin: 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .panel-count {
        font-size: 0.72rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-border) 16%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 2px 8px;
        line-height: 1.3;
    }

    .files-body {
        position: relative;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: color-mix(in srgb, var(--color-background) 55%, var(--color-panel, #fff));
    }

    .file-list {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .files-panel file-list-row {
        --file-row-accent: var(--color-primary);
    }

    .empty-note {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
        font-style: italic;
    }

    /* ─── File upload ───────────────────────────────────────── */
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

    /* Saving indicator on an attachment row while a background save is in progress */
    .attachment-saving-badge {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 11px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        padding: 0 4px;
    }

    /* Spinner while download access check runs */
    .download-spinner {
        width: 14px;
        height: 14px;
        box-sizing: border-box;
        border: 2px solid currentColor;
        border-right-color: transparent;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
        .download-spinner {
            animation: none;
            border-right-color: currentColor;
        }
    }

    /* Drag-and-drop attach */
    .files-body.drag-over {
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

    /* ─── New Case form ─────────────────────────────────────── */
    .new-case-form {
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-surface, var(--color-background));
        padding: 18px 20px 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    /* ─── Dark mode ─────────────────────────────────────────── */
    :host-context([data-theme='dark']) .case-card {
        background: var(--color-panel);
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .case-card.is-archived {
        border-left-color: var(--color-text-secondary);
        opacity: 0.55;
    }

    :host-context([data-theme='dark']) .case-card:hover {
        background: color-mix(in srgb, var(--color-panel) 80%, var(--color-accent));
        border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .files-panel,
    :host-context([data-theme='dark']) .new-case-form,
    :host-context([data-theme='dark']) .detail-header {
        background: var(--color-panel);
        border-color: var(--color-border);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    }

    :host-context([data-theme='dark']) .detail-header {
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .detail-title {
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .panel-header {
        background: var(--color-panel);
    }

    :host-context([data-theme='dark']) .files-panel {
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .files-body {
        background: var(--color-background);
    }

    :host-context([data-theme='dark']) .upload-action-row {
        background: var(--color-panel);
    }

    :host-context([data-theme='dark']) .status-chip {
        border-color: var(--color-border);
        background: color-mix(in srgb, var(--color-border) 35%, transparent);
        color: var(--color-text-secondary);
    }

    /* ─── Viewer overlay ────────────────────────────────────── */
    /* z-index stack: toolbar-dropdown 200, iframe-overlay 1000, toast 1200, background-save-banner 1300 */
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

    .save-indicator {
        font-size: 0.8rem;
        color: var(--color-success, #22c55e);
        padding: 2px 8px;
        background: color-mix(in srgb, var(--color-success, #22c55e) 12%, transparent);
        border-radius: 4px;
        white-space: nowrap;
    }

    .background-save-banner {
        position: fixed;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 8px 16px;
        background: var(--color-surface, #fff);
        border: 1px solid var(--color-border);
        border-radius: 8px;
        box-shadow: 0 2px 8px rgba(0,0,0,0.12);
        font-size: 0.875rem;
        color: var(--color-text-primary);
        z-index: 1300;
        white-space: nowrap;
    }

    .background-save-error {
        color: var(--color-status-error-fg, #ef4444);
    }

    .background-save-spinner {
        width: 14px;
        height: 14px;
        border: 2px solid var(--color-border);
        border-top-color: var(--color-primary);
        border-radius: 50%;
        animation: spin 0.7s linear infinite;
        flex-shrink: 0;
    }

    .background-save-spinner--error {
        border-top-color: var(--color-status-error-fg, #ef4444);
        animation: none;
    }

    .viewer-error-message {
        font-size: 0.8rem;
        color: var(--color-status-error-fg, #ef4444);
        padding: 2px 8px;
        background: color-mix(in srgb, var(--color-status-error-fg, #ef4444) 12%, transparent);
        border-radius: 4px;
        white-space: nowrap;
        max-width: 300px;
        overflow: hidden;
        text-overflow: ellipsis;
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
        background: var(--color-background);
        pointer-events: none;
        z-index: 5;
    }

    .viewer-loading {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 14px;
        text-align: center;
        padding: 16px;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

    .viewer-loading-spinner {
        width: 28px;
        height: 28px;
        border: 3px solid color-mix(in srgb, var(--color-text-secondary) 25%, transparent);
        border-top-color: var(--color-text-secondary);
        border-radius: 50%;
        animation: viewer-spin 0.8s linear infinite;
        flex-shrink: 0;
    }

    @keyframes viewer-spin {
        to { transform: rotate(360deg); }
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

`;
