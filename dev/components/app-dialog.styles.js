import { css } from 'lit-element';

export const appDialogStyles = css`
    :host {
        display: contents;
    }

    .dialog {
        position: relative;
        width: var(--app-dialog-width, min(560px, calc(100vw - 32px)));
        max-width: calc(100vw - 32px);
        border: 1px solid var(--color-border);
        border-radius: calc(var(--radius-lg, 12px) + 2px);
        background: var(--color-panel, var(--color-surface, var(--color-background)));
        color: var(--color-text-primary);
        padding: 22px 22px 18px;
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--color-border) 55%, transparent),
            0 8px 24px rgba(0, 0, 0, 0.12),
            0 24px 64px rgba(0, 0, 0, 0.16);
    }

    :host-context([data-theme='dark']) .dialog {
        border-color: color-mix(in srgb, var(--color-border) 65%, var(--color-primary));
        box-shadow:
            0 0 0 1px color-mix(in srgb, var(--color-primary) 22%, transparent),
            0 12px 32px rgba(0, 0, 0, 0.4),
            0 28px 72px rgba(0, 0, 0, 0.5);
    }

    .dialog::backdrop {
        background:
            linear-gradient(
                160deg,
                color-mix(in srgb, var(--color-primary, #167aac) 18%, rgba(10, 14, 22, 0.62)),
                rgba(10, 14, 22, 0.58)
            );
        backdrop-filter: blur(3px);
        -webkit-backdrop-filter: blur(3px);
    }

    .dialog-title {
        margin: 0 0 16px;
        font-size: 1.2rem;
        font-weight: 700;
        letter-spacing: -0.01em;
        padding-right: 36px;
    }

    .dialog-actions {
        display: flex;
        justify-content: flex-end;
        margin-top: 16px;
        gap: 8px;
    }

    .close-button {
        position: absolute;
        top: 12px;
        right: 12px;
        width: 32px;
        height: 32px;
        border: none;
        border-radius: 50%;
        background: transparent;
        color: var(--color-text-primary);
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 22px;
        line-height: 1;
        padding: 0;
        cursor: pointer;
    }

    .close-button:hover,
    .close-button:focus-visible {
        background: var(--color-surface, rgba(0, 0, 0, 0.08));
    }

    .close-button:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
    }
`;
