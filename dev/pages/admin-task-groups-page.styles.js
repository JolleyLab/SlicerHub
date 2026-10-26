import { css } from 'lit-element';

export const adminTaskGroupsStyles = css`
    .layout {
        display: grid;
        grid-template-columns: 260px 1fr;
        gap: 20px;
        align-items: start;
        max-width: 900px;
    }
    @media (max-width: 640px) {
        .layout { grid-template-columns: 1fr; }
    }

    /* Dark mode: --color-primary is a dark navy, unusable as foreground text.
       Replace interactive foreground uses with high-contrast equivalents. */

    /* Active tab: text → textPrimary, indicator → accent (#5c6bb8, 3.5:1 on panel) */
    :host-context([data-theme='dark']) .tab-btn.active {
        color: var(--color-text-primary);
        border-bottom-color: var(--color-accent);
    }

    /* Manager badge: text → textPrimary, tint → accent-based */
    :host-context([data-theme='dark']) .role-badge.manager {
        color: var(--color-text-primary);
        border-color: color-mix(in srgb, var(--color-accent) 50%, transparent);
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
    }

    /* Group item hover/selected: tint off accent instead of primary */
    :host-context([data-theme='dark']) .group-item:hover,
    :host-context([data-theme='dark']) .group-item:focus-visible {
        background: color-mix(in srgb, var(--color-accent) 15%, var(--color-panel, var(--color-surface, transparent)));
    }
    :host-context([data-theme='dark']) .group-item.selected {
        background: color-mix(in srgb, var(--color-accent) 22%, var(--color-panel, var(--color-surface, transparent)));
    }

    /* Checkbox accent → accent so the tick is visible against the dark-navy fill */
    :host-context([data-theme='dark']) .perm-row input[type="checkbox"] {
        accent-color: var(--color-accent);
    }

    .sidebar-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 12px 14px;
        border-bottom: 1px solid var(--color-border);
    }
    .sidebar-title { font-weight: 600; font-size: 14px; margin: 0; }

    .group-list { list-style: none; margin: 0; padding: 0; }
    .group-item {
        padding: 10px 14px;
        cursor: pointer;
        border-bottom: 1px solid var(--color-border);
        font-size: 14px;
    }
    .group-item:last-child { border-bottom: none; }
    .group-item:hover,
    .group-item:focus-visible {
        background: color-mix(in srgb, var(--color-primary) 10%, var(--color-surface, transparent));
        outline: none;
    }
    .group-item:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: -3px;
    }
    .group-item.selected {
        background: color-mix(in srgb, var(--color-primary) 15%, var(--color-surface, transparent));
        font-weight: 600;
    }
    .group-name { display: block; color: var(--color-text-primary, inherit); }
    .group-caps {
        display: block;
        font-size: 12px;
        color: var(--color-text-secondary);
        margin-top: 2px;
    }
    .empty-sidebar {
        padding: 20px 14px;
        font-size: 13px;
        color: var(--color-text-secondary);
        text-align: center;
    }

    /* Detail panel */
    .detail-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 14px 16px;
        border-bottom: 1px solid var(--color-border);
    }
    .detail-title { font-weight: 600; font-size: 15px; margin: 0; }

    /* Tabs */
    .tab-bar {
        display: flex;
        padding: 0 16px;
        border-bottom: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-border) 10%, var(--color-surface, var(--color-background)));
    }
    .tab-btn {
        padding: 10px 16px;
        font: inherit;
        font-size: 13px;
        font-weight: 500;
        border: none;
        border-bottom: 2px solid transparent;
        background: none;
        color: var(--color-text-secondary);
        cursor: pointer;
        white-space: nowrap;
        margin-bottom: -1px;
    }
    .tab-btn:hover { color: var(--color-text-primary, inherit); }
    .tab-btn.active {
        color: var(--color-primary);
        border-bottom-color: var(--color-primary);
        font-weight: 600;
    }
    .tab-btn:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: -2px;
    }

    .tab-content { padding: 16px; }

    /* Forms */
    .form-group { margin-bottom: 14px; }
    .form-group label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        margin-bottom: 4px;
        color: var(--color-text-primary, inherit);
    }
    .form-group input[type="text"],
    .form-group input[type="email"],
    .form-group textarea {
        width: 100%;
        box-sizing: border-box;
        padding: 7px 10px;
        border: 1px solid var(--color-border);
        border-radius: 6px;
        background: var(--color-background);
        color: var(--color-text-primary, inherit);
        font-size: 14px;
        font-family: inherit;
    }
    .form-group input:focus-visible,
    .form-group textarea:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: 0;
        border-color: var(--color-primary);
    }
    .form-group textarea { min-height: 60px; resize: vertical; }

    .section-heading {
        font-size: 13px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        color: var(--color-text-secondary);
        margin: 20px 0 10px 0;
    }

    .member-list { list-style: none; margin: 0 0 12px 0; padding: 0; }
    .member-row {
        display: grid;
        grid-template-columns: 1fr auto auto;
        align-items: center;
        gap: 12px;
        padding: 8px 0;
        border-bottom: 1px solid var(--color-border);
        font-size: 13px;
    }
    .member-row:last-child { border-bottom: none; }

    .member-row person-chip {
        min-width: 0;
    }
    .member-perms {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .perm-row {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: var(--color-text-secondary);
        white-space: nowrap;
        cursor: pointer;
    }
    .perm-row input[type="checkbox"] {
        cursor: pointer;
        accent-color: var(--color-primary);
    }
    .add-member-row { display: flex; gap: 8px; margin-top: 4px; }
    .add-member-row input { flex: 1; }

    /* Role badge on member row (read-only members tab) */
    .role-badge {
        font-size: 11px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 99px;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-border) 22%, transparent);
        white-space: nowrap;
    }
    .role-badge.manager {
        color: var(--color-primary);
        border-color: color-mix(in srgb, var(--color-primary) 35%, transparent);
        background: color-mix(in srgb, var(--color-primary) 10%, transparent);
    }

    .action-row {
        display: flex;
        justify-content: space-between;
        align-items: center;
        margin-top: 20px;
        padding-top: 14px;
        border-top: 1px solid var(--color-border);
    }

    .saved-badge {
        font-size: 12px;
        color: var(--color-status-success, #16a34a);
        margin-left: 10px;
    }
    :host-context([data-theme='dark']) .saved-badge { color: #4ade80; }

    .error-msg {
        color: var(--color-status-error, #dc2626);
        font-size: 13px;
        margin: 8px 0 0 0;
    }
    .detail-error {
        color: var(--color-status-error, #dc2626);
        font-size: 13px;
        margin-bottom: 12px;
    }
    :host-context([data-theme='dark']) .error-msg,
    :host-context([data-theme='dark']) .detail-error {
        color: var(--color-status-error-light, #f87171);
    }

    .placeholder {
        padding: 40px 20px;
        text-align: center;
        font-size: 14px;
        color: var(--color-text-secondary);
    }
    .loading {
        padding: 20px;
        text-align: center;
        font-size: 13px;
        color: var(--color-text-secondary);
    }

    /* New group inline form in sidebar */
    .new-group-panel { padding: 14px 16px; border-bottom: 1px solid var(--color-border); }
    .new-group-title { font-size: 13px; font-weight: 600; margin: 0 0 10px 0; }
    .new-group-actions { display: flex; gap: 8px; margin-top: 10px; }

    /* Tasks tab */
    .task-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
    .task-item {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 10px 12px;
        border-radius: 8px;
        border: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-border) 12%, transparent);
        font-size: 13px;
    }
    .task-label { font-weight: 500; color: var(--color-text-primary, inherit); }
    .task-actions { display: flex; align-items: center; gap: 8px; }
    .task-badge {
        font-size: 11px;
        font-weight: 700;
        min-width: 20px;
        text-align: center;
        padding: 2px 7px;
        border-radius: 99px;
        background: var(--color-primary);
        color: #fff;
    }
    .task-badge.empty {
        background: none;
        border: 1px solid var(--color-border);
        color: var(--color-text-secondary);
    }
    .no-tasks {
        padding: 24px 0;
        font-size: 13px;
        color: var(--color-text-secondary);
        text-align: center;
    }
`;
