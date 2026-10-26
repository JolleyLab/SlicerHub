import { css } from 'lit-element';

export const appShellStyles = css`
    :host {
        display: block;
        padding: 0;
    }

    /* TODO: legacy header — not using CSS variables, predates the theming system */
    .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
        margin: 0 0 16px 0;
    }

    .user-info {
        display: flex;
        align-items: center;
        gap: 15px;
    }

    .user-name {
        font-weight: 500;
        color: #333;
    }

    .logout-btn {
        padding: 8px 16px;
        background: #f44336;
        color: white;
        border: none;
        border-radius: var(--radius-sm);
        cursor: pointer;
        font-size: 14px;
    }

    .logout-btn:hover {
        background: #d32f2f;
    }

    iframe {
        width: 100%;
        height: calc(100vh - 200px);
        border: 1px solid #ccc;
        margin-top: 10px;
    }

    .auth-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px 16px;
        box-sizing: border-box;
        background: var(--color-background, #ecf4f9);
        color: var(--color-text-primary, #040316);
        font-family: var(--font-family-base, Inter, system-ui, sans-serif);
    }

    .logout-billing-dialog {
        display: flex;
        flex-direction: column;
        gap: 12px;
        min-width: min(420px, 85vw);
        max-width: 520px;
    }

    .directus-reconnect-form {
        display: flex;
        flex-direction: column;
        gap: 14px;
        min-width: min(380px, 85vw);
    }

    .directus-reconnect-hint {
        margin: 0;
        line-height: 1.45;
        color: var(--color-text-secondary, #555);
        font-size: 0.93rem;
    }

    .directus-reconnect-field {
        display: flex;
        flex-direction: column;
        gap: 6px;
    }

    .directus-reconnect-field label {
        font-size: 0.85rem;
        font-weight: 600;
        color: var(--color-text-primary, #333);
    }

    .directus-reconnect-field input {
        border: 1px solid var(--color-border, #ddd);
        border-radius: var(--radius-md);
        padding: 8px 12px;
        font: inherit;
        font-size: 0.95rem;
        background: var(--color-surface, var(--color-background, #fff));
        color: var(--color-text-primary, #333);
        min-height: 40px;
        box-sizing: border-box;
        width: 100%;
    }

    .directus-reconnect-field input:focus {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
        border-color: var(--color-primary);
    }

    .directus-reconnect-error {
        margin: 0;
        font-size: 0.88rem;
        color: var(--color-status-error-fg, #c62828);
    }

    .directus-reconnect-actions {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        margin-top: 4px;
    }

    .logout-billing-dialog p {
        margin: 0;
        line-height: 1.45;
        color: var(--color-text-primary, #333);
    }

    .logout-billing-auto-hint {
        font-size: 13px;
        color: var(--color-text-secondary, #666);
    }

    .logout-billing-sessions {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 8px;
        max-height: 240px;
        overflow: auto;
    }

    .logout-billing-session {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border: 1px solid var(--color-border, #ddd);
        border-radius: var(--radius-md);
        background: var(--color-panel, var(--color-surface, var(--color-background, #fafafa)));
    }

    .logout-billing-session-name {
        font-weight: 600;
        color: var(--color-text-primary, #222);
    }

    .logout-billing-session-meta {
        font-size: 12px;
        color: var(--color-text-secondary, #666);
    }

    .logout-billing-actions {
        display: flex;
        justify-content: flex-end;
        flex-wrap: wrap;
        gap: 8px;
        margin-top: 8px;
    }
`;
