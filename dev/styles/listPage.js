import { css } from 'lit-element';
import { stickyActionsStyles } from './stickyActions.js';

/**
 * The My Cases look, shared by list pages (Cases, Workflows): page header with actions, a grid
 * of cards that open a detail view, the detail header, and the create/edit form panel.
 *
 *   .page-header-row > .page-heading + .page-header-actions   (a primary button there gets a "+")
 *   .card-grid > button.card > .card-title-row > .card-title (+ .card-badge), .card-desc,
 *       .card-meta-row > .card-meta-item…                     (.card.is-archived dims it)
 *   .detail-toolbar > button.back-link + .detail-toolbar-actions
 *   .detail-header > .detail-title-row > .detail-title, .detail-desc
 *   form.form-panel > .form-group > .form-label + .form-input/.form-textarea, .form-actions
 *       (.form-actions.is-sticky: stays at the bottom of the screen; see stickyActions.js)
 *   .list-panel > .panel-header > .panel-header-start > .panel-title + .panel-count,
 *       .list-panel-body > .list-panel-items > file-list-row…, .empty-note
 *   .status-note, .status-chip, .empty-filter
 */
export const listPageStyles = css`
    ${stickyActionsStyles}

    .status-note {
        color: var(--color-text-secondary);
        font-size: 0.9rem;
        padding: 8px 0;
    }

    /* Page header */
    .page-header-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 20px;
        padding-bottom: 16px;
        border-bottom: 1px solid var(--color-border);
    }

    .page-header-actions {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        flex-shrink: 0;
    }

    .page-heading {
        margin: 0;
        font-size: 1.15rem;
        font-weight: 650;
        color: var(--color-text-primary);
        letter-spacing: -0.01em;
    }

    .page-header-row .primary-button::before {
        content: '+';
        margin-right: 5px;
        font-weight: 300;
        font-size: 1.15em;
        line-height: 1;
    }

    .page-header-row .primary-button.is-cancel::before {
        content: none;
    }

    .empty-filter {
        margin: 0;
        color: var(--color-text-secondary);
        font-size: 0.9rem;
    }

    /* Card grid */
    .card-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(min(260px, 100%), 1fr));
        gap: 10px;
        width: 100%;
        min-width: 0;
    }

    .card {
        position: relative;
        border: 1px solid var(--color-border);
        border-left: 3px solid var(--color-primary);
        border-radius: 8px;
        background: var(--color-surface, var(--color-background));
        padding: 14px 16px;
        display: flex;
        flex-direction: column;
        gap: 5px;
        cursor: pointer;
        transition: box-shadow 0.14s ease, transform 0.14s ease, border-color 0.14s ease;
        text-align: left;
        font: inherit;
        color: inherit;
        width: 100%;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
        appearance: none;
        -webkit-appearance: none;
    }

    .card.is-archived {
        border-left-color: var(--color-text-secondary);
        opacity: 0.7;
    }

    .card:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
        border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
        border-left-color: var(--color-primary);
    }

    .card.is-archived:hover {
        border-left-color: var(--color-text-secondary);
        border-color: var(--color-border);
    }

    .card:focus-visible {
        outline: 2px solid var(--color-primary);
        outline-offset: 2px;
        box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent);
    }

    .card-title-row {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 10px;
    }

    .card-title {
        overflow-wrap: anywhere;
        font-size: 0.925rem;
        font-weight: 600;
        color: var(--color-text-primary);
        line-height: 1.3;
        min-width: 0;
    }

    .card-badge {
        flex-shrink: 0;
        display: inline-flex;
        align-items: center;
        font-size: 0.68rem;
        font-weight: 700;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid color-mix(in srgb, var(--color-secondary) 45%, var(--color-border));
        background: color-mix(in srgb, var(--color-secondary) 16%, transparent);
        color: var(--color-primary);
        line-height: 1.3;
    }

    .card-desc {
        font-size: 0.85rem;
        color: var(--color-text-secondary);
        line-height: 1.45;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
        margin: 0;
    }

    .card-meta-row {
        display: flex;
        align-items: center;
        gap: 0;
        margin-top: 6px;
        flex-wrap: wrap;
    }

    .card-meta-item {
        font-size: 0.78rem;
        color: var(--color-text-secondary);
    }

    .card-meta-item + .card-meta-item::before {
        content: '·';
        margin: 0 5px;
        opacity: 0.45;
    }

    .status-chip {
        display: inline-flex;
        align-items: center;
        font-size: 0.7rem;
        font-weight: 650;
        letter-spacing: 0.05em;
        text-transform: uppercase;
        padding: 2px 7px;
        border-radius: 4px;
        border: 1px solid var(--color-border);
        background: color-mix(in srgb, var(--color-border) 18%, transparent);
        color: var(--color-text-secondary);
    }

    /* Detail view: back link + actions, then the header */
    .detail-toolbar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        flex-wrap: wrap;
    }

    .back-link {
        border: none;
        background: transparent;
        padding: 4px 0;
        margin: 0;
        font: inherit;
        font-size: 0.875rem;
        font-weight: 600;
        color: var(--color-focus);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        gap: 4px;
    }

    .back-link:hover,
    .back-link:focus-visible {
        color: var(--color-text-primary);
    }

    .back-link:focus-visible {
        outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
        outline-offset: var(--focus-ring-offset, 2px);
        border-radius: 4px;
    }

    .detail-toolbar-actions {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-wrap: wrap;
    }

    .detail-header {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 14px 16px 16px;
        border: 1px solid var(--color-border);
        border-radius: var(--radius-lg);
        background: var(--color-panel, #fff);
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
        border-left: 4px solid var(--color-primary);
    }

    .detail-title-row {
        display: flex;
        align-items: center;
        gap: 10px;
        flex-wrap: wrap;
    }

    .detail-title {
        overflow-wrap: anywhere;
        margin: 0;
        font-size: 1.4rem;
        font-weight: 700;
        color: var(--color-primary);
        letter-spacing: -0.02em;
        line-height: 1.25;
    }

    .detail-desc {
        margin: 0;
        font-size: 0.95rem;
        color: var(--color-text-secondary);
        line-height: 1.55;
        max-width: 46rem;
    }

    /* Panel of rows (case attachments, workflow extensions) */
    .list-panel {
        border: 1px solid var(--color-border);
        border-left: 4px solid var(--color-primary);
        border-radius: var(--radius-lg);
        background: var(--color-panel, #fff);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        box-shadow: 0 1px 4px rgba(0, 0, 0, 0.04);
    }

    .panel-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 10px;
        min-height: 44px;
        padding: 0 16px;
        border-bottom: 1px solid var(--color-border);
        background: var(--color-panel, #fff);
        box-sizing: border-box;
        flex-shrink: 0;
    }

    .panel-header-start {
        display: inline-flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
    }

    .panel-title {
        margin: 0;
        font-size: 0.72rem;
        font-weight: 700;
        letter-spacing: 0.07em;
        text-transform: uppercase;
        color: var(--color-text-secondary);
    }

    .panel-count {
        font-size: 0.72rem;
        font-weight: 650;
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-border) 16%, transparent);
        border: 1px solid var(--color-border);
        border-radius: 999px;
        padding: 2px 8px;
        line-height: 1.3;
    }

    .list-panel-body {
        position: relative;
        padding: 12px 16px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex: 1;
        min-height: 0;
        overflow: hidden;
        background: color-mix(in srgb, var(--color-background) 55%, var(--color-panel, #fff));
    }

    .list-panel-items {
        display: flex;
        flex-direction: column;
        gap: 6px;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
    }

    .list-panel file-list-row {
        --file-row-accent: var(--color-primary);
    }

    .empty-note {
        color: var(--color-text-secondary);
        font-size: 0.875rem;
        font-style: italic;
    }

    /* Create / edit form */
    .form-panel {
        border: 1px solid var(--color-border);
        border-radius: 8px;
        background: var(--color-surface, var(--color-background));
        padding: 18px 20px 16px;
        display: flex;
        flex-direction: column;
        gap: 14px;
    }

    .form-group {
        display: flex;
        flex-direction: column;
        gap: 5px;
    }

    .form-label {
        font-size: 0.72rem;
        font-weight: 650;
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
        /* White in light mode: the page background tint made editable fields look disabled. */
        background: var(--color-panel, #fff);
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
        color: #c62828;
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

    /* A sticky footer reaches the panel's edges (its padding), so it reads as the panel's footer. */
    .form-panel {
        --sticky-bar-bg: var(--color-surface, var(--color-background));
    }

    .form-panel > .form-actions.is-sticky {
        margin: 0 -20px -16px;
        padding: 10px 20px;
        border-radius: 0 0 8px 8px;
    }

    /* Dark mode: lift cards and panels above the page background */
    :host-context([data-theme='dark']) .card {
        background: var(--color-panel);
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .card.is-archived {
        border-left-color: var(--color-text-secondary);
        opacity: 0.55;
    }

    :host-context([data-theme='dark']) .card:hover {
        background: color-mix(in srgb, var(--color-panel) 80%, var(--color-accent));
        border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .card-badge {
        border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
        background: color-mix(in srgb, var(--color-accent) 18%, transparent);
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .form-panel,
    :host-context([data-theme='dark']) .list-panel,
    :host-context([data-theme='dark']) .detail-header {
        background: var(--color-panel);
        border-color: var(--color-border);
        box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
    }

    :host-context([data-theme='dark']) .detail-header {
        border-left-color: var(--color-accent);
        border-bottom-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .detail-title {
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .form-input,
    :host-context([data-theme='dark']) .form-textarea {
        background: var(--color-background);
        border-color: color-mix(in srgb, var(--color-text-secondary) 55%, var(--color-panel)); /* ≥3:1 against panel and page (WCAG 1.4.11) */
        color: var(--color-text-primary);
    }

    :host-context([data-theme='dark']) .form-input:focus,
    :host-context([data-theme='dark']) .form-textarea:focus {
        border-color: var(--color-accent);
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-accent) 22%, transparent);
    }

    :host-context([data-theme='dark']) .status-chip {
        border-color: var(--color-border);
        background: color-mix(in srgb, var(--color-border) 35%, transparent);
        color: var(--color-text-secondary);
    }

    :host-context([data-theme='dark']) .page-header-row {
        border-bottom-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .form-actions {
        border-top-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .form-panel {
        --sticky-bar-bg: var(--color-panel);
    }

    :host-context([data-theme='dark']) .list-panel {
        border-left-color: var(--color-accent);
    }

    :host-context([data-theme='dark']) .panel-header {
        background: var(--color-panel);
        border-bottom-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .panel-title,
    :host-context([data-theme='dark']) .panel-count {
        color: var(--color-text-secondary);
    }

    :host-context([data-theme='dark']) .panel-count {
        background: color-mix(in srgb, var(--color-border) 40%, transparent);
        border-color: var(--color-border);
    }

    :host-context([data-theme='dark']) .list-panel-body {
        background: var(--color-background);
    }
`;
