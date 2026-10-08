import { css } from 'lit-element';

// Panel shell styles: bordered card with shadow. Include in a component's
// static get styles() array. The consumer applies this to a .panel element
// and adds layout rules (overflow, padding, etc.) as needed.
export const panelStyles = css`
    .panel {
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-panel, var(--color-surface, var(--color-background)));
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
        overflow: hidden;
    }
    :host-context([data-theme='dark']) .panel {
        box-shadow: 0 4px 16px rgba(0, 0, 0, 0.32);
    }
`;
