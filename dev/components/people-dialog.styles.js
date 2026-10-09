import { css } from 'lit-element';

export const peopleDialogStyles = css`
    :host {
        display: contents;
    }

    app-dialog {
        --app-dialog-width: min(560px, calc(100vw - 32px));
    }

    .body {
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .error {
        margin: 0;
        color: var(--color-status-error-fg, #c62828);
        font-size: 0.875rem;
    }

    .list {
        display: flex;
        flex-direction: column;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 8px);
        overflow: hidden;
        background: var(--color-background);
        box-shadow: inset 0 1px 0 color-mix(in srgb, #fff 4%, transparent);
    }

    .list-scroll {
        /* ~5 rows at min-height 52px, then scroll; invite stays pinned below */
        max-height: calc((52px * 5) + 1px);
        overflow-y: auto;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
    }

    .row {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        min-height: 52px;
        box-sizing: border-box;
    }

    .row + .row {
        border-top: 1px solid var(--color-border);
    }

    .invite-footer {
        border-top: 1px solid var(--color-border);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: color-mix(in srgb, var(--color-border) 12%, transparent);
        flex-shrink: 0;
    }

    person-chip {
        flex: 1;
        min-width: 0;
        --person-chip-size: 36px;
    }

    .meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    .meta dropdown-select {
        min-width: 140px;
    }

    .empty {
        margin: 0;
        padding: 18px 14px;
        text-align: center;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

    .invite-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
    }

    .invite-link-row {
        display: flex;
        gap: 8px;
        align-items: stretch;
        margin-top: 8px;
    }

    .invite-input {
        flex: 1;
        min-width: 0;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 9px 12px;
        font: inherit;
        font-size: 0.9rem;
        background: var(--color-background);
        color: var(--color-text-primary);
        box-sizing: border-box;
    }

    .invite-input:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
    }

    .invite-match {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
    }

    .invite-match person-chip {
        --person-chip-size: 36px;
    }

    .invite-match .meta {
        margin-left: auto;
    }

    .invite-status {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
    }

    .invite-status.error {
        color: var(--color-status-error-fg, #c62828);
    }

    .pending-block {
        margin-top: 4px;
        border: 1px dashed var(--color-border);
        border-radius: var(--radius-md, 8px);
        overflow: hidden;
    }

    .pending-heading {
        margin: 0;
        padding: 8px 12px;
        font-size: 0.8rem;
        font-weight: 600;
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-border) 35%, transparent);
    }

    .pending-actions {
        display: flex;
        gap: 6px;
        flex-shrink: 0;
    }

    .saving {
        margin: 0;
        font-size: 0.85rem;
        color: var(--color-text-secondary);
    }
`;
