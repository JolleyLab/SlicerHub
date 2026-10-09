import { css } from 'lit-element';

export const utilStyles = css`
    .visually-hidden {
        position: absolute;
        width: 1px;
        height: 1px;
        margin: -1px;
        padding: 0;
        overflow: hidden;
        clip: rect(0 0 0 0);
        white-space: nowrap;
        border: 0;
    }

    @keyframes spin {
        to { transform: rotate(360deg); }
    }
`;
