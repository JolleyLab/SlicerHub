import { css } from 'lit-element';

export const navigationHeaderStyles = css`
    :host {
        display: block;
        width: 100%;
        font-family: var(--font-family-base);
        font-feature-settings: var(--font-feature-defaults);
    }

    .nav-shell {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        width: 100%;
        box-sizing: border-box;
        padding: 12px 16px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-primary);
        color: var(--color-on-primary);
        box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
    }

    .home-link {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        min-width: 0;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-md);
        padding: 8px 14px;
        background: var(--color-secondary);
        color: var(--color-on-secondary);
        text-decoration: none;
        font-weight: 600;
        transition: background-color 0.2s ease, transform 0.2s ease;
    }

    .home-link:hover,
    .home-link:focus-visible {
        background: var(--color-accent);
        color: var(--color-text-primary);
        transform: translateY(-1px);
    }

    .home-link:focus-visible {
        outline: 3px solid var(--color-focus, #0057c2);
        outline-offset: 2px;
        box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
    }

    .home-link:hover .home-icon,
    .home-link:focus-visible .home-icon {
        background: var(--color-primary);
        color: var(--color-on-primary);
    }

    .home-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        border-radius: var(--radius-lg);
        background: var(--color-primary);
        color: var(--color-on-primary);
        line-height: 1;
        flex: 0 0 28px;
    }

    .home-icon svg {
        width: 16px;
        height: 16px;
        display: block;
    }

    .home-text {
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }

    .menu-region {
        margin-left: auto;
        display: inline-flex;
        align-items: center;
        gap: 10px;
    }

    /* Dark: solid secondary chip — clinical, not pastel. */
    :host-context([data-theme='dark']) .home-link {
        background: var(--color-secondary);
        color: var(--color-on-secondary);
        border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
        box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
    }

    :host-context([data-theme='dark']) .home-link:hover,
    :host-context([data-theme='dark']) .home-link:focus-visible {
        background: color-mix(in srgb, var(--color-secondary) 82%, #fff);
        color: var(--color-on-secondary);
    }

    :host-context([data-theme='dark']) .home-icon {
        background: color-mix(in srgb, var(--color-primary) 85%, #000);
        color: var(--color-on-primary);
    }

    :host-context([data-theme='dark']) .home-link:hover .home-icon,
    :host-context([data-theme='dark']) .home-link:focus-visible .home-icon {
        background: var(--color-primary);
        color: var(--color-on-primary);
    }

    @media (max-width: 640px) {
        .nav-shell {
            padding: 10px 12px;
            gap: 10px;
        }

        .home-link {
            padding: 7px 10px;
            gap: 8px;
        }

        .home-text {
            font-size: 0.9rem;
            max-width: 130px;
        }

        .home-icon {
            width: 24px;
            height: 24px;
            font-size: 13px;
            flex-basis: 24px;
        }
    }
`;
