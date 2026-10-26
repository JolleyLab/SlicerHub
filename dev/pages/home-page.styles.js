import { css } from 'lit-element';

export const homePageStyles = css`
    :host {
        display: block;
        --card-accent: var(--color-primary);
        --action: #92400e;
        --on-action: #ffffff;
    }

    :host-context([data-theme='dark']) {
        --card-accent: var(--color-accent);
        --action: #fcd34d;
        --on-action: #1f1300;
    }

    /* ─── Layout ────────────────────────────────────────────── */
    .home-stack {
        position: relative;
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* A wide main column (2/3) and a narrow side column (1/3). A lone column, or a narrow window,
       gets the full width. Cards adapt to the width of their own column (container queries). */
    .widgets {
        container-type: inline-size;
    }

    .columns {
        display: grid;
        grid-template-columns: minmax(0, 1fr);
        gap: 20px;
        align-items: start;
    }

    @container (min-width: 800px) {
        .columns.two {
            grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
        }
    }

    .column {
        display: flex;
        flex-direction: column;
        gap: 20px;
        min-width: 0;
    }

    .widget {
        min-width: 0;
        container-type: inline-size;
    }

    .widgets-empty {
        margin: 0;
        padding: 18px;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-lg);
        color: var(--color-text-secondary);
        text-align: center;
    }

    /* ─── Hero ──────────────────────────────────────────────── */
    .hero {
        padding: 4px;
    }

    .hero-customize {
        position: absolute;
        top: -12px;
        right: -12px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 36px;
        height: 36px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 50%;
        background: transparent;
        color: var(--color-text-secondary);
        cursor: pointer;
    }

    .hero-customize svg {
        width: 19px;
        height: 19px;
        display: block;
    }

    .hero-customize:hover {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-text-primary);
    }

    .hero-customize:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    .hero-title {
        margin: 0;
        padding-right: 44px;
        font-size: 1.6rem;
        font-weight: 600;
        letter-spacing: -0.01em;
        color: var(--color-text-primary);
    }

    /* ─── Panel ─────────────────────────────────────────────── */
    .panel {
        display: flex;
        flex-direction: column;
        min-width: 0;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-panel, var(--color-surface, var(--color-background)));
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
    }

    :host-context([data-theme='dark']) .panel {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
    }

    .panel-header {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 14px 18px;
        border-bottom: 1px solid var(--color-border);
    }

    .panel-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 30px;
        height: 30px;
        flex: 0 0 30px;
        border-radius: var(--radius-md, 8px);
        background: color-mix(in srgb, var(--color-primary) 12%, transparent);
        color: var(--color-primary);
    }

    :host-context([data-theme='dark']) .panel-icon {
        color: var(--color-text-primary);
    }

    .panel-icon svg {
        width: 18px;
        height: 18px;
        display: block;
    }

    .panel-title {
        margin: 0;
        font-size: 1.05rem;
        color: var(--color-text-primary);
    }

    .panel-body {
        display: flex;
        padding: 18px;
    }

    .panel-clear {
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 10px;
        margin: 0;
        padding: 14px 18px;
        color: var(--color-text-secondary);
    }

    .panel-clear svg {
        width: 20px;
        height: 20px;
        flex: 0 0 20px;
    }

    /* ─── Empty state ───────────────────────────────────────── */
    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 6px;
        min-height: 120px;
        padding: 12px;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md, 8px);
        text-align: center;
    }

    .empty-title {
        margin: 0;
        font-weight: 600;
        color: var(--color-text-primary);
    }

    .empty-hint {
        margin: 0;
        max-width: 42ch;
        font-size: 0.9rem;
        line-height: 1.45;
        color: var(--color-text-secondary);
    }

    /* ─── Filter dropdown ───────────────────────────────────── */
    .filter-dropdown {
        position: relative;
        margin-left: auto;
    }

    .filter-toggle {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 4px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-sm, 6px);
        background: transparent;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 0.85rem;
        cursor: pointer;
        white-space: nowrap;
    }

    .filter-toggle:hover {
        background: color-mix(in srgb, var(--color-primary) 8%, transparent);
        border-color: var(--color-primary);
    }

    .filter-toggle:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    .filter-chevron {
        width: 14px;
        height: 14px;
        flex-shrink: 0;
    }

    .filter-menu {
        position: absolute;
        top: calc(100% + 4px);
        right: 0;
        min-width: 180px;
        padding: 6px;
        background: var(--color-panel, var(--color-surface));
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 8px);
        box-shadow: 0 4px 12px color-mix(in srgb, var(--color-text-primary) 12%, transparent);
        z-index: 50;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }

    .filter-option {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 7px 10px;
        border-radius: var(--radius-sm, 6px);
        font-size: 0.9rem;
        cursor: pointer;
        user-select: none;
    }

    .filter-option:hover {
        background: color-mix(in srgb, var(--color-primary) 8%, transparent);
    }

    .filter-option input[type='checkbox'] {
        width: 15px;
        height: 15px;
        flex-shrink: 0;
        accent-color: var(--color-primary);
        cursor: pointer;
    }

    .filter-option-icon {
        display: inline-flex;
        width: 16px;
        flex-shrink: 0;
        color: var(--color-text-secondary);
    }

    .filter-option-icon svg {
        width: 14px;
        height: 14px;
        display: block;
    }

    .filter-option-count {
        margin-left: auto;
        font-size: 0.8rem;
        color: var(--color-text-secondary);
    }

    /* ─── Activity cards ────────────────────────────────────── */
    .card-list {
        margin: 0;
        padding: 14px 18px 16px;
        list-style: none;
        display: flex;
        flex-direction: column;
        gap: 10px;
    }

    .card {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        column-gap: 16px;
        row-gap: 8px;
        align-items: start;
        padding: 12px 16px 12px 14px;
        border: 1px solid var(--color-border);
        border-left: 5px solid var(--card-accent);
        border-radius: var(--radius-md, 8px);
        background: color-mix(in srgb, var(--card-accent) 6%, var(--color-panel, var(--color-surface)));
    }

    .card-meta {
        grid-column: 1;
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 8px;
    }

    .card-category {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .card-category svg {
        width: 14px;
        height: 14px;
        display: block;
    }

    .card-action {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        padding: 1px 9px 1px 7px;
        border-radius: 999px;
        background: var(--action);
        color: var(--on-action);
        font-size: 0.72rem;
        font-weight: 700;
    }

    .card-action::before {
        content: '';
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: currentColor;
    }

    .card-time {
        grid-column: 2;
        grid-row: 1;
        justify-self: end;
        font-size: 0.8rem;
        color: var(--color-text-secondary);
        white-space: nowrap;
    }

    .card-main {
        grid-column: 1;
        min-width: 0;
    }

    .card-title {
        margin: 0;
        font-size: 0.98rem;
        font-weight: 600;
        line-height: 1.35;
        color: var(--color-text-primary);
    }

    .card-detail {
        margin: 2px 0 0;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
    }

    .card .update-actions {
        grid-column: 2;
        grid-row: 2;
        align-self: end;
        justify-self: end;
    }

    button.card {
        width: 100%;
        text-align: left;
        border: 1px solid var(--color-border);
        border-left: 5px solid var(--card-accent);
        cursor: pointer;
    }

    button.card:hover {
        background: color-mix(in srgb, var(--card-accent) 12%, var(--color-panel, var(--color-surface)));
        border-color: var(--card-accent);
    }

    button.card:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    @container (max-width: 560px) {
        .card {
            grid-template-columns: minmax(0, 1fr);
        }

        .card-time,
        .card .update-actions {
            grid-column: 1;
            grid-row: auto;
            justify-self: start;
        }
    }

    .update-actions {
        display: inline-flex;
        gap: 8px;
    }

    .update-status {
        margin: 0;
        padding: 0 18px 12px;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
    }

    .update-status:empty {
        display: none;
    }

    .update-status.is-error {
        color: var(--color-status-error-fg, #8a1212);
    }

    /* ─── Small action buttons (invite approve/reject) ──────── */
    .small-button {
        padding: 5px 14px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: transparent;
        color: var(--color-text-primary);
        font: inherit;
        font-size: 0.85rem;
        font-weight: 600;
        cursor: pointer;
    }

    .small-button.is-primary {
        border-color: transparent;
        background: var(--color-primary);
        color: var(--color-on-primary);
    }

    .small-button:hover:not([aria-disabled='true']) {
        opacity: 0.87;
    }

    .small-button[aria-disabled='true'] {
        opacity: 0.5;
        cursor: progress;
    }

    .small-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }
`;
