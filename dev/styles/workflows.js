import { css } from 'lit-element';

/** Styles for workflow lists on a case: Case Settings and "Find more…". */
export const workflowStyles = css`
    :host { display: block; font-size: 0.9rem; color: var(--color-text-primary); }
    .stack { display: flex; flex-direction: column; gap: 10px; }
    .row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .grow { flex: 1 1 auto; min-width: 0; }
    .muted { color: var(--color-text-secondary); font-size: 0.85rem; }
    .error { color: var(--color-status-error-fg, #8a1212); font-size: 0.85rem; }
    .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
    .item {
        display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
        padding: 8px 10px; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 6px);
    }
    .item-name { font-weight: 600; }
    .pill {
        font-size: 0.75rem; padding: 1px 8px; border-radius: 999px;
        border: 1px solid var(--color-border); color: var(--color-text-secondary);
    }
    input[type='text'], textarea, select {
        font: inherit; color: inherit; box-sizing: border-box; max-width: 100%;
        padding: 6px 8px; border: 1px solid var(--color-border); border-radius: var(--radius-sm, 4px);
        background: var(--color-panel, var(--color-surface, var(--color-background)));
    }
    input[type='checkbox'], input[type='radio'] { accent-color: var(--color-primary); }
    label.field { display: flex; flex-direction: column; gap: 4px; font-weight: 600; }
    label.field > :not(span) { font-weight: normal; }
`;
