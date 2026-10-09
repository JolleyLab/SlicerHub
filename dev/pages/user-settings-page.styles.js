import { css } from 'lit-element';

export const userSettingsStyles = css`
    .settings-stack {
        display: flex;
        flex-direction: column;
        gap: 20px;
    }

    /* ── Tabs ── */
    .tabs-bar {
        display: flex;
        gap: 4px;
        padding: 4px;
        overflow-x: auto;
        scrollbar-width: none;
        background: var(--color-surface, var(--color-background));
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg, 12px);
        margin-bottom: 4px;
    }
    .tabs-bar::-webkit-scrollbar { display: none; }

    .tab-btn {
        flex: 1;
        padding: 9px 18px;
        font: inherit;
        font-size: 0.9rem;
        background: none;
        border: none;
        border-radius: calc(var(--radius-lg, 12px) - 4px);
        color: var(--color-text-secondary);
        cursor: pointer;
        white-space: nowrap;
        transition: color 0.12s, background 0.12s;
        text-align: center;
    }
    .tab-btn:hover {
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
        color: var(--color-text-primary);
    }
    .tab-btn:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: 2px;
    }
    .tab-btn[aria-selected='true'] {
        background: var(--color-primary, #2f6fed);
        color: #fff;
        font-weight: 600;
        box-shadow: 0 1px 4px rgba(0,0,0,0.18);
    }

    /* ── Sections ── */
    .settings-section {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 10px;
        background: var(--color-panel, var(--color-surface, var(--color-background)));
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
    }

    :host-context([data-theme='dark']) .settings-section {
        border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
    }

    .section-title {
        margin: 0;
        font-size: 1.05rem;
        color: var(--color-text-primary);
    }

    .section-title-row {
        display: flex;
        align-items: center;
        gap: 8px;
    }

    .section-hint {
        position: relative;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 1.15rem;
        height: 1.15rem;
        padding: 0;
        border: 1px solid var(--color-border);
        border-radius: 50%;
        background: transparent;
        color: var(--color-text-secondary);
        font: inherit;
        font-size: 0.7rem;
        font-weight: 600;
        line-height: 1;
        cursor: help;
    }

    .section-hint:hover,
    .section-hint:focus-visible {
        color: var(--color-text-primary);
        border-color: var(--color-text-secondary);
        outline: none;
    }

    .section-hint .hint-bubble {
        position: absolute;
        left: 50%;
        bottom: calc(100% + 8px);
        transform: translateX(-50%);
        width: max-content;
        max-width: min(280px, 70vw);
        padding: 8px 10px;
        border-radius: 8px;
        background: var(--color-text-primary);
        color: var(--color-background, #fff);
        font-size: 0.8rem;
        font-weight: 400;
        line-height: 1.35;
        text-align: left;
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
        opacity: 0;
        pointer-events: none;
        transition: opacity 0.12s ease;
        z-index: 2;
    }

    .section-hint .hint-bubble::after {
        content: '';
        position: absolute;
        top: 100%;
        left: 50%;
        margin-left: -5px;
        border: 5px solid transparent;
        border-top-color: var(--color-text-primary);
    }

    .section-hint:hover .hint-bubble,
    .section-hint:focus-visible .hint-bubble {
        opacity: 1;
    }

    .section-description {
        margin: 0;
        font-size: 0.9rem;
        color: var(--color-text-secondary);
    }

    .profile-form {
        display: flex;
        flex-direction: column;
        gap: 18px;
        margin-top: 8px;
    }

    .avatar-row {
        display: flex;
        align-items: center;
        gap: 16px;
        flex-wrap: wrap;
    }

    .avatar-preview {
        width: 56px;
        height: 56px;
        border-radius: 50%;
        background: var(--color-secondary);
        color: var(--color-on-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 1.4rem;
        font-weight: 600;
        flex-shrink: 0;
        overflow: hidden;
        border: 1px solid var(--color-border);
    }

    .avatar-preview img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        border-radius: 50%;
    }

    .avatar-actions {
        display: flex;
        gap: 8px;
        align-items: center;
        flex-wrap: wrap;
    }

    .avatar-hint {
        font-size: 0.8rem;
        color: var(--color-text-secondary);
        margin-top: 4px;
    }

    .avatar-error {
        font-size: 0.85rem;
        color: var(--color-status-error-fg, #b42318);
        margin-top: 4px;
    }

    :host-context([data-theme='dark']) .avatar-error {
        color: #ff8a80;
    }

    .name-row {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px;
    }

    @media (max-width: 480px) {
        .name-row {
            grid-template-columns: 1fr;
        }
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .form-group label {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
    }

    .form-group input {
        font: inherit;
        padding: 8px 10px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md, 8px);
        background: var(--color-background);
        color: var(--color-text-primary);
    }

    .form-group input:disabled {
        opacity: 0.65;
    }

    .settings-save-bar {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 12px;
        padding: 12px 0 4px;
        border-top: 1px solid var(--color-border);
    }

    .save-status {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        min-height: 1.2em;
    }

    .save-status[data-state='saved'] { color: var(--color-secondary); }
    .save-status[data-state='error'] { color: var(--color-status-error-fg, #b42318); }

    :host-context([data-theme='dark']) .save-status[data-state='error'] {
        color: #ff8a80;
    }

    .btn-save-profile {
        font: inherit;
        font-size: 0.9rem;
        padding: 8px 20px;
        width: fit-content;
        border-radius: var(--radius-md, 8px);
        border: none;
        background: var(--color-primary, #2f6fed);
        color: #fff;
        cursor: pointer;
        font-weight: 500;
    }

    .btn-save-profile:disabled {
        opacity: 0.5;
        cursor: not-allowed;
    }

    .checkbox-row {
        display: flex;
        align-items: flex-start;
        gap: 10px;
        cursor: pointer;
        font-size: 0.9rem;
    }

    .checkbox-row input[type='checkbox'] {
        margin-top: 3px;
        flex-shrink: 0;
        width: 16px;
        height: 16px;
        cursor: pointer;
        accent-color: var(--color-primary);
    }

    .small-button {
        display: inline-flex;
        align-items: center;
        font: inherit;
        font-size: 0.85rem;
        padding: 6px 12px;
        border-radius: var(--radius-md, 8px);
        border: 1px solid var(--color-border);
        background: var(--color-surface, var(--color-background));
        color: var(--color-text-primary);
        cursor: pointer;
        white-space: nowrap;
    }

    .small-button:hover {
        background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface, var(--color-background)));
        border-color: var(--color-primary);
    }

    .small-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }

    .small-button:disabled {
        opacity: 0.6;
        cursor: not-allowed;
    }
`;
