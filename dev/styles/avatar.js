import { css } from 'lit-element';

// Structural styles for a circular avatar chip. Include in a component's
// static get styles() array alongside component-specific size and colour rules.
export const avatarCircleStyles = css`
    .avatar {
        border-radius: 50%;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        user-select: none;
    }
    .avatar img {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
        border-radius: 50%;
    }

    :host-context([data-theme='dark']) .avatar {
        background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
        color: var(--color-primary);
    }
`;
