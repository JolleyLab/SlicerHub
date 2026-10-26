import { css } from 'lit-element';

export const buttonStyles = css`
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

    :host-context([data-theme='dark']) .primary-button {
        background: var(--color-secondary);
        color: var(--color-on-primary);
    }

    :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
        opacity: 0.85;
        box-shadow: 0 2px 10px color-mix(in srgb, var(--color-accent) 30%, transparent);
    }

    :host-context([data-theme='dark']) .secondary-button {
        color: var(--color-text-primary);
        border-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .secondary-button:hover:not(:disabled) {
        background: color-mix(in srgb, var(--color-accent) 10%, var(--color-panel));
        border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
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

    /* Danger button — ghost style that turns red on hover */
    .danger-button {
        background: none;
        border: 1px solid transparent;
        border-radius: 6px;
        padding: 4px 8px;
        font: inherit;
        font-size: 0.875rem;
        cursor: pointer;
        color: var(--color-text-secondary);
    }

    .danger-button:hover:not(:disabled) {
        color: var(--color-status-error, #dc2626);
        border-color: color-mix(in srgb, var(--color-status-error, #dc2626) 30%, transparent);
    }

    .danger-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: 2px;
    }

    .danger-button:disabled {
        opacity: 0.42;
        cursor: not-allowed;
    }

    /* Size modifier — apply alongside any button class for a compact variant */
    .btn-sm {
        padding: 4px 12px;
        font-size: 0.8rem;
    }
`;
