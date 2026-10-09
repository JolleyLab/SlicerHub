import { css } from 'lit-element';

export const formStyles = css`
    .form-group {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .form-label {
        font-size: 0.72rem;
        font-weight: 600;
        letter-spacing: 0.06em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .form-input,
    .form-textarea {
        border: 1px solid var(--color-border);
        border-radius: 6px;
        padding: 9px 12px;
        font: inherit;
        font-size: 0.925rem;
        background: var(--color-background);
        color: var(--color-text-primary);
        width: 100%;
        box-sizing: border-box;
        transition: border-color 0.14s, box-shadow 0.14s;
    }

    .form-input:focus,
    .form-textarea:focus {
        outline: none;
        border-color: var(--color-primary);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
    }

    .form-textarea {
        resize: vertical;
        min-height: 76px;
    }

    .form-error-msg {
        color: var(--color-status-error-fg, #c62828);
        font-size: 0.875rem;
    }

    .form-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 8px;
        padding-top: 6px;
        border-top: 1px solid var(--color-border);
    }

    .form-actions-spacer {
        margin-right: auto;
    }

    :host-context([data-theme='dark']) .form-input,
    :host-context([data-theme='dark']) .form-textarea {
        background: var(--color-background);
        border-color: color-mix(in srgb, var(--color-border) 140%, transparent);
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .form-input:focus,
    :host-context([data-theme='dark']) .form-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
    }
`;
