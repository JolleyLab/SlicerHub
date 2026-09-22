import { LitElement, html, css } from 'lit-element';
import { t } from './i18n/index.js';
import './components/page-layout-template.js';
import './components/page-content-message.js';
import './components/file-list-row.js';
import './components/comments-panel.js';
import {
    listDirectusCases,
    openDirectusAttachmentFullSlicer,
    createDirectusCaseComment,
    createDirectusCase,
    updateDirectusCase,
    uploadDirectusCaseAttachment,
    deleteDirectusCaseAttachment,
    lookupDirectusUserByEmail,
    updateDirectusCaseCollaborators,
    inviteDirectusCaseUser,
    listDirectusCaseInvites,
    approveDirectusCaseInvite,
    rejectDirectusCaseInvite,
    invalidateNotifications,
    friendlyCasesError
} from './services/directus.js';
import './components/people-dialog.js';
import './components/list-filter-tools.js';
import './components/attachment-open-menu.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    VIEWER_SESSION_SCOPES,
    defaultReleaseModeForClose,
    getViewerSessionEndpoints,
    buildViewerStopBody,
    buildSlicerGuiLoaderUrl,
    viewerDisplayName
} from './utils/viewerLaunch.js';
import { getCachedLocalSlicerViewerOptions } from './utils/userPreferences.js';
import { resolveSimplifiedViewerChoice } from './utils/localSlicerViewerOptions.js';
import { sendTrameContainerHeartbeat } from './utils/trameHeartbeat.js';
import { stopViewerSession } from './utils/viewerSessionLifecycle.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity
} from './utils/viewerActivity.js';

const CASE_INVITE_ROLE_OPTIONS = Object.freeze([
    Object.freeze({ value: '', label: t('roles.selectRole'), disabled: true }),
    Object.freeze({ value: 'collaborator', label: t('roles.collaborator') }),
    Object.freeze({ value: 'read_only', label: t('roles.readOnly') })
]);

const LIST_SORT_OPTIONS = Object.freeze([
    Object.freeze({
        value: 'newest',
        label: t('cases.sortNewest'),
        ariaLabel: t('cases.sortNewestAria')
    }),
    Object.freeze({
        value: 'oldest',
        label: t('cases.sortOldest'),
        ariaLabel: t('cases.sortOldestAria')
    }),
    Object.freeze({
        value: 'title',
        label: t('cases.sortTitle'),
        ariaLabel: t('cases.sortTitleAria')
    })
]);

function formatBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) return '';
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function formatDateTime(value) {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    });
}

const CASE_COMMENT_SEEN_STORAGE_KEY = 'slicer.caseCommentSeen.v1';

function readCaseCommentSeenMap() {
    try {
        const raw = localStorage.getItem(CASE_COMMENT_SEEN_STORAGE_KEY);
        if (!raw) return {};
        const parsed = JSON.parse(raw);
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeCaseCommentSeenMap(map) {
    try {
        localStorage.setItem(CASE_COMMENT_SEEN_STORAGE_KEY, JSON.stringify(map || {}));
    } catch (_) {
        /* ignore quota / private mode */
    }
}

/**
 * Cases UI: case cards landing, detail with attachments + comments + people.
 */
export class DirectusCasesPage extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                width: 100%;
                min-width: 0;
                box-sizing: border-box;
            }

            /* ─── Base ─────────────────────────────────────────────── */
            .status-note {
                color: var(--color-text-secondary);
                font-size: 0.9rem;
                padding: 8px 0;
            }

            /* ─── Landing: page header ──────────────────────────────── */
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

            .cases-empty-filter {
                margin: 0;
                color: var(--color-text-secondary);
                font-size: 0.9rem;
            }

            /* ─── Landing: case grid ────────────────────────────────── */
            .case-grid {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
                gap: 10px;
                width: 100%;
                min-width: 0;
            }

            .case-card {
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

            .case-card.is-archived {
                border-left-color: var(--color-text-secondary);
                opacity: 0.7;
            }

            .case-card:hover {
                transform: translateY(-1px);
                box-shadow: 0 4px 14px rgba(0, 0, 0, 0.1);
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
                border-left-color: var(--color-primary);
            }

            .case-card.is-archived:hover {
                border-left-color: var(--color-text-secondary);
                border-color: var(--color-border);
            }

            .case-card:focus-visible {
                outline: 2px solid var(--color-primary);
                outline-offset: 2px;
                box-shadow: 0 0 0 4px color-mix(in srgb, var(--color-primary) 18%, transparent);
            }

            .case-card-title-row {
                display: flex;
                align-items: flex-start;
                justify-content: space-between;
                gap: 10px;
            }

            .case-card-title {
                font-size: 0.925rem;
                font-weight: 600;
                color: var(--color-text-primary);
                line-height: 1.3;
                min-width: 0;
            }

            .case-card-new-badge {
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

            :host-context([data-theme='dark']) .case-card-new-badge {
                border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
                background: color-mix(in srgb, var(--color-accent) 18%, transparent);
                color: var(--color-text-primary);
            }

            .case-card-desc {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                line-height: 1.45;
                display: -webkit-box;
                -webkit-line-clamp: 2;
                -webkit-box-orient: vertical;
                overflow: hidden;
                margin: 0;
            }

            .case-card-meta-row {
                display: flex;
                align-items: center;
                gap: 0;
                margin-top: 6px;
                flex-wrap: wrap;
            }

            .case-card-meta-item {
                font-size: 0.78rem;
                color: var(--color-text-secondary);
            }

            .case-card-meta-item + .case-card-meta-item::before {
                content: '·';
                margin: 0 5px;
                opacity: 0.45;
            }

            /* ─── Status chip ───────────────────────────────────────── */
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

            /* ─── Detail: layout ────────────────────────────────────── */
            .case-detail {
                display: flex;
                flex-direction: column;
                gap: 18px;
                width: 100%;
                min-width: 0;
                max-width: 100%;
                box-sizing: border-box;
            }

            .case-detail-grid {
                display: grid;
                grid-template-columns: minmax(0, 2fr) minmax(260px, 1fr);
                gap: 16px;
                align-items: stretch;
                width: 100%;
                min-width: 0;
                /* Shared pane height: both panels fill and scroll internally. */
                height: min(560px, 60vh);
                min-height: 380px;
            }

            .case-detail-grid .files-panel {
                order: 1;
                min-width: 0;
                min-height: 0;
                height: 100%;
                max-height: 100%;
            }

            .case-detail-grid comments-panel {
                --comments-panel-height: 100%;
                --comments-panel-max-height: 100%;
                min-height: 0;
                height: 100%;
                order: 2;
                min-width: 0;
            }

            /* Stacked when content column is narrow (tablet / DevTools), set via ResizeObserver */
            .case-detail[data-stack] .case-detail-grid {
                grid-template-columns: 1fr;
                align-items: start;
                height: auto;
                min-height: 0;
            }

            .case-detail[data-stack] .case-detail-grid .files-panel {
                height: auto;
                max-height: none;
                min-height: 0;
                width: 100%;
            }

            .case-detail[data-stack] .case-detail-grid comments-panel {
                --comments-panel-height: auto;
                --comments-panel-max-height: min(420px, 55vh);
                height: auto;
                min-height: 260px;
                width: 100%;
            }

            @media (max-width: 1100px) {
                .case-detail-grid {
                    grid-template-columns: 1fr;
                    align-items: start;
                    height: auto;
                    min-height: 0;
                }

                .case-detail-grid .files-panel {
                    height: auto;
                    max-height: none;
                    min-height: 0;
                    width: 100%;
                }

                .case-detail-grid comments-panel {
                    --comments-panel-height: auto;
                    --comments-panel-max-height: min(420px, 55vh);
                    height: auto;
                    min-height: 260px;
                    width: 100%;
                }
            }

            /* ─── Detail: toolbar + header ──────────────────────────── */
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
                color: var(--color-secondary);
                cursor: pointer;
                display: inline-flex;
                align-items: center;
                gap: 4px;
            }

            .back-link:hover,
            .back-link:focus-visible {
                color: var(--color-primary);
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

            .people-pending-badge {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 1.25rem;
                height: 1.25rem;
                margin-left: 6px;
                padding: 0 5px;
                border-radius: 999px;
                background: var(--color-primary);
                color: var(--color-on-primary);
                font-size: 0.7rem;
                font-weight: 700;
                line-height: 1;
                vertical-align: middle;
            }

            /* ─── Detail: files panel ───────────────────────────────── */
            .files-panel {
                border: 1px solid var(--color-border);
                border-left: 4px solid var(--color-primary);
                border-radius: var(--radius-lg);
                background: var(--color-panel, #fff);
                display: flex;
                flex-direction: column;
                min-height: 360px;
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

            .files-body {
                padding: 12px 16px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                flex: 1;
                min-height: 0;
                overflow: hidden;
                background: color-mix(in srgb, var(--color-background) 55%, var(--color-panel, #fff));
            }

            .file-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                flex: 1;
                min-height: 0;
                overflow-y: auto;
            }

            .files-panel file-list-row {
                --file-row-accent: var(--color-primary);
            }

            .empty-note {
                color: var(--color-text-secondary);
                font-size: 0.875rem;
                font-style: italic;
            }

            /* ─── File upload ───────────────────────────────────────── */
            .upload-action-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                min-height: 56px;
                margin: 0 -16px -12px;
                padding: 10px 16px;
                border-top: 1px solid var(--color-border);
                background: var(--color-panel, #fff);
                box-sizing: border-box;
                flex-shrink: 0;
            }

            .upload-action-row .secondary-button {
                min-height: 36px;
            }

            .upload-status {
                color: var(--color-text-secondary);
                font-size: 0.85rem;
                flex: 1;
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .upload-error {
                color: #c62828;
                font-size: 0.85rem;
                flex: 1;
            }

            /* ─── New Case form ─────────────────────────────────────── */
            .new-case-form {
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

            /* ─── Buttons ───────────────────────────────────────────── */
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

            /* ─── Dark mode overrides ──────────────────────────────── */

            /* Cards: lift them above the page background using --color-panel */
            :host-context([data-theme='dark']) .case-card {
                background: var(--color-panel);
                border-left-color: var(--color-accent);
            }

            :host-context([data-theme='dark']) .case-card.is-archived {
                border-left-color: var(--color-text-secondary);
                opacity: 0.55;
            }

            :host-context([data-theme='dark']) .case-card:hover {
                background: color-mix(in srgb, var(--color-panel) 80%, var(--color-accent));
                border-color: color-mix(in srgb, var(--color-accent) 45%, var(--color-border));
                border-left-color: var(--color-accent);
            }

            /* Panels: lift above page background */
            :host-context([data-theme='dark']) .files-panel,
            :host-context([data-theme='dark']) .new-case-form,
            :host-context([data-theme='dark']) .detail-header {
                background: var(--color-panel);
                border-color: var(--color-border);
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.35);
            }

            :host-context([data-theme='dark']) .detail-header {
                border-left-color: var(--color-accent);
            }

            :host-context([data-theme='dark']) .detail-title {
                color: var(--color-text-primary);
            }

            :host-context([data-theme='dark']) .panel-header {
                background: var(--color-panel);
                border-bottom-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .files-panel {
                border-left-color: var(--color-accent);
            }

            :host-context([data-theme='dark']) .panel-title,
            :host-context([data-theme='dark']) .panel-count {
                color: var(--color-text-secondary);
            }

            :host-context([data-theme='dark']) .panel-count {
                background: color-mix(in srgb, var(--color-border) 40%, transparent);
                border-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .files-body {
                background: var(--color-background);
            }

            :host-context([data-theme='dark']) .upload-action-row {
                background: var(--color-panel);
                border-top-color: var(--color-border);
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

            :host-context([data-theme='dark']) .back-link {
                color: var(--color-accent);
            }

            :host-context([data-theme='dark']) .back-link:hover,
            :host-context([data-theme='dark']) .back-link:focus-visible {
                color: var(--color-text-primary);
            }

            /* Inputs: sunken below the panel surface for legibility */
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

            /* Primary button: use the brighter accent so it doesn't vanish */
            :host-context([data-theme='dark']) .primary-button {
                background: var(--color-secondary);
                color: var(--color-on-primary);
            }

            :host-context([data-theme='dark']) .primary-button:hover:not(:disabled) {
                opacity: 0.85;
                box-shadow: 0 2px 10px color-mix(in srgb, var(--color-accent) 30%, transparent);
            }

            /* Secondary button: visible ghost on dark panel */
            :host-context([data-theme='dark']) .secondary-button {
                color: var(--color-text-primary);
                border-color: var(--color-border);
            }

            :host-context([data-theme='dark']) .secondary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-accent) 10%, var(--color-panel));
                border-color: color-mix(in srgb, var(--color-accent) 50%, var(--color-border));
            }

            /* Status chip */
            :host-context([data-theme='dark']) .status-chip {
                border-color: var(--color-border);
                background: color-mix(in srgb, var(--color-border) 35%, transparent);
                color: var(--color-text-secondary);
            }

            /* Detail header separator */
            :host-context([data-theme='dark']) .detail-header {
                border-bottom-color: var(--color-border);
            }

            /* Page header separator */
            :host-context([data-theme='dark']) .page-header-row {
                border-bottom-color: var(--color-border);
            }

            /* Upload row separator */
            :host-context([data-theme='dark']) .upload-action-row {
                border-top-color: var(--color-border);
            }

            /* Form actions separator */
            :host-context([data-theme='dark']) .form-actions {
                border-top-color: var(--color-border);
            }

            /* ─── Viewer overlay (edge-to-edge; header is the only chrome) ── */
            .iframe-overlay {
                position: fixed;
                inset: 0;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 0;
                padding: 0;
                box-sizing: border-box;
                background: #090b14;
                color: var(--color-text-primary);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .iframe-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                flex-shrink: 0;
                padding: 10px 14px;
                border: none;
                border-bottom: 1px solid var(--color-border);
                border-radius: 0;
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                box-shadow: none;
            }

            .iframe-title {
                min-width: 0;
                font-size: 0.925rem;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
                color: var(--color-text-primary);
            }

            .iframe-header-actions {
                display: flex;
                flex-shrink: 0;
                gap: 10px;
                align-items: center;
            }

            .iframe-container {
                flex: 1;
                display: flex;
                position: relative;
                min-height: 0;
                overflow: hidden;
                border: none;
                border-radius: 0;
                background: #090b14;
            }

            .trame-iframe {
                flex: 1;
                width: 100%;
                height: 100%;
                border: 0;
                background: #090b14;
            }

            .loading-overlay {
                position: absolute;
                inset: 0;
                display: flex;
                align-items: center;
                justify-content: center;
                background: color-mix(in srgb, var(--color-background) 80%, transparent);
                pointer-events: none;
            }

            .viewer-loading {
                text-align: center;
                padding: 16px;
                color: var(--color-text-secondary);
                font-size: 0.9rem;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            loading: { type: Boolean },
            errorMessage: { type: String },
            cases: { type: Array },
            sessionMeta: { type: Object },
            savingCollaborators: { type: Boolean },
            selectedCaseId: { type: String },
            openingAttachmentId: { type: String },
            postingComment: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            viewerSimplified: { type: Boolean },
            currentFileName: { type: String },
            // New Case form
            showNewCaseForm: { type: Boolean },
            newCaseTitle: { type: String },
            newCaseDescription: { type: String },
            creatingCase: { type: Boolean },
            newCaseError: { type: String },
            // Archive
            archivingCase: { type: Boolean },
            // Inline case edit
            editingCase: { type: Boolean },
            editCaseTitle: { type: String },
            editCaseDesc: { type: String },
            savingCaseEdit: { type: Boolean },
            caseEditError: { type: String },
            // File upload
            uploadingFile: { type: Boolean },
            uploadError: { type: String },
            uploadStatusText: { type: String },
            // Attachment delete
            deletingAttachmentId: { type: String },
            // Attachment sort / search
            attachmentSortOrder: { type: String },
            attachmentSearchQuery: { type: String },
            // Cases list sort / search
            caseSortOrder: { type: String },
            caseSearchQuery: { type: String },
            /** Unresolved invites for the open case (People button badge). */
            pendingInviteCount: { type: Number }
        };
    }

    constructor() {
        super();
        this.username = t('common.guest');
        this.loading = false;
        this.errorMessage = '';
        this.cases = [];
        this.sessionMeta = null;
        this.savingCollaborators = false;
        this.selectedCaseId = '';
        this.openingAttachmentId = '';
        this.postingComment = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.currentFileName = '';
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this._heartbeatInterval = null;
        this._handleBeforeUnload = null;
        this._popStateHandler = null;
        this._viewerPushedState = false;
        this._detailLayoutRo = null;
        this._detailLayoutEl = null;
        // New Case form
        this.showNewCaseForm = false;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.creatingCase = false;
        this.newCaseError = '';
        // Archive
        this.archivingCase = false;
        // Inline case edit
        this.editingCase = false;
        this.editCaseTitle = '';
        this.editCaseDesc = '';
        this.savingCaseEdit = false;
        this.caseEditError = '';
        // File upload
        this.uploadingFile = false;
        this.uploadError = '';
        this.uploadStatusText = '';
        // Attachment delete
        this.deletingAttachmentId = '';
        // Attachment sort / search
        this.attachmentSortOrder = 'newest';
        this.attachmentSearchQuery = '';
        // Cases list sort / search
        this.caseSortOrder = 'newest';
        this.caseSearchQuery = '';
        this.pendingInviteCount = 0;
    }

    get selectedCase() {
        return this.cases.find((row) => row.id === this.selectedCaseId) || null;
    }

    // ── URL / history helpers ──────────────────────────────────────────────
    _getCaseIdFromUrl() {
        return new URLSearchParams(location.search).get('case') || '';
    }

    _buildCaseUrl(caseId) {
        const url = new URL(location.href);
        if (caseId) {
            url.searchParams.set('case', caseId);
        } else {
            url.searchParams.delete('case');
        }
        url.searchParams.delete('viewer');
        return url.toString();
    }

    _buildViewerUrl() {
        const url = new URL(location.href);
        url.searchParams.set('case', this.selectedCaseId);
        url.searchParams.set('viewer', '1');
        return url.toString();
    }

    _handlePopState(event) {
        const newHasViewer = event.state?.viewer === true
            || new URLSearchParams(location.search).has('viewer');

        // If the viewer was open and we've navigated away from it, close it cleanly.
        // _doCloseViewer handles the stop request; history has already moved.
        if (this.showIframe && !newHasViewer) {
            this._viewerPushedState = false;
            this._doCloseViewer();
        }

        const caseId = event.state?.caseId ?? this._getCaseIdFromUrl();
        this.selectedCaseId = caseId || '';
        this.errorMessage = '';
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();

        // Restore case from URL; strip ?viewer — the container is gone after a reload
        const initialCaseId = this._getCaseIdFromUrl();
        if (initialCaseId) this.selectedCaseId = initialCaseId;
        if (new URLSearchParams(location.search).has('viewer')) {
            history.replaceState({ caseId: initialCaseId }, '', this._buildCaseUrl(initialCaseId));
        }

        this._popStateHandler = (e) => this._handlePopState(e);
        window.addEventListener('popstate', this._popStateHandler);

        this._handleBeforeUnload = () => {
            if (!this.showIframe || !this._viewerSessionToken) return;
            const { stopUrl } = getViewerSessionEndpoints({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
            });
            stopViewerSession({
                stopUrl,
                sessionToken: this._viewerSessionToken,
                body: buildViewerStopBody({
                    kind: VIEWER_KINDS.SLICER_GUI,
                    sessionToken: this._viewerSessionToken,
                    seatId: this._viewerSeatId,
                    mode: defaultReleaseModeForClose(VIEWER_KINDS.SLICER_GUI)
                }),
                keepalive: true
            });
        };
        window.addEventListener('beforeunload', this._handleBeforeUnload);
        this.loadCases();
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        if (this._popStateHandler) {
            window.removeEventListener('popstate', this._popStateHandler);
            this._popStateHandler = null;
        }
        this.closeListFilterMenus();
        this.teardownDetailLayoutObserver();
        // Stop the container if the user navigates away via the side menu
        if (this.showIframe && this._viewerSessionToken) {
            this._doCloseViewer(); // fire-and-forget
        } else {
            this.stopHeartbeat();
        }
        super.disconnectedCallback();
    }

    updated(changed) {
        if (changed.has('selectedCaseId') || this.selectedCaseId) {
            this.syncDetailLayoutObserver();
        }
    }

    /** Stack attachments/comments when the case content column is tablet-narrow. */
    syncDetailLayoutObserver() {
        const el = this.renderRoot?.querySelector('.case-detail');
        if (!el) {
            this.teardownDetailLayoutObserver();
            return;
        }
        if (this._detailLayoutEl === el && this._detailLayoutRo) {
            this.applyDetailStackState(el);
            return;
        }
        this.teardownDetailLayoutObserver();
        this._detailLayoutEl = el;
        this._detailLayoutRo = new ResizeObserver((entries) => {
            const entry = entries[0];
            const width = entry?.contentRect?.width ?? el.getBoundingClientRect().width;
            el.toggleAttribute('data-stack', width > 0 && width < 720);
        });
        this._detailLayoutRo.observe(el);
        this.applyDetailStackState(el);
    }

    applyDetailStackState(el) {
        const width = el.getBoundingClientRect().width;
        el.toggleAttribute('data-stack', width > 0 && width < 720);
    }

    teardownDetailLayoutObserver() {
        if (this._detailLayoutRo) {
            this._detailLayoutRo.disconnect();
            this._detailLayoutRo = null;
        }
        this._detailLayoutEl = null;
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    userFacingError(err, fallback) {
        return friendlyCasesError(err?.message, fallback, err?.status, err?.code);
    }

    async loadCases() {
        this.loading = true;
        this.errorMessage = '';
        const keepSelected = this.selectedCaseId;
        try {
            const data = await listDirectusCases({ limit: 50 });
            this.cases = Array.isArray(data.cases) ? data.cases : [];
            this.sessionMeta = data.meta || null;
            if (keepSelected && !this.cases.some((row) => row.id === keepSelected)) {
                this.selectedCaseId = '';
            } else if (keepSelected) {
                const openRow = this.cases.find((row) => row.id === keepSelected);
                if (openRow) this.markCaseCommentsSeen(openRow);
            }
        } catch (err) {
            this.cases = [];
            this.sessionMeta = null;
            this.errorMessage = this.userFacingError(err, t('cases.loadFailed'));
        } finally {
            this.loading = false;
        }
    }

    openCase(caseId) {
        this.selectedCaseId = caseId;
        this.errorMessage = '';
        const caseRow = this.cases.find((row) => row.id === caseId);
        if (caseRow) this.markCaseCommentsSeen(caseRow);
        history.pushState({ caseId }, '', this._buildCaseUrl(caseId));
        this.refreshPendingInviteCount(caseId);
    }

    /**
     * Open case People dialog (used by notification deep-links).
     * Retries briefly if the case list has not finished loading.
     */
    async openPeopleForCaseId(caseId) {
        const id = String(caseId || '').trim();
        if (!id) return;
        this.openCase(id);
        for (let i = 0; i < 20; i += 1) {
            const caseRow = this.cases.find((row) => String(row.id) === id);
            if (caseRow) {
                await this.updateComplete;
                await this.openPeopleDialog(caseRow);
                return;
            }
            await new Promise((r) => setTimeout(r, 100));
        }
    }

    async refreshPendingInviteCount(caseId = this.selectedCaseId) {
        const id = String(caseId || '').trim();
        if (!id) {
            this.pendingInviteCount = 0;
            return;
        }
        try {
            const invites = await listDirectusCaseInvites(id);
            this.pendingInviteCount = Array.isArray(invites)
                ? invites.filter((inv) => inv && inv.status !== 'expired').length
                : 0;
        } catch {
            this.pendingInviteCount = 0;
        }
    }

    caseLastModifiedAt(caseRow) {
        const times = [];
        const pushTime = (value) => {
            const ms = Date.parse(value || '');
            if (Number.isFinite(ms)) times.push(ms);
        };
        pushTime(caseRow?.updatedAt);
        pushTime(caseRow?.createdAt);
        for (const comment of caseRow?.comments || []) {
            pushTime(comment?.updatedAt || comment?.createdAt);
        }
        for (const attachment of caseRow?.attachments || []) {
            pushTime(attachment?.modifiedAt);
        }
        if (!times.length) return null;
        return new Date(Math.max(...times)).toISOString();
    }

    caseLastModifiedLabel(caseRow) {
        const at = this.caseLastModifiedAt(caseRow);
        const formatted = formatDateTime(at);
        if (!formatted) return '';

        const hasNestedActivity = (caseRow?.comments?.length || 0) > 0
            || (caseRow?.attachments?.length || 0) > 0;
        const createdMs = Date.parse(caseRow?.createdAt || '');
        const updatedMs = Date.parse(caseRow?.updatedAt || '');
        const onlyCreateStamp = Number.isFinite(createdMs)
            && !hasNestedActivity
            && (!Number.isFinite(updatedMs) || updatedMs <= createdMs);

        return onlyCreateStamp ? t('cases.created', { date: formatted }) : t('cases.modified', { date: formatted });
    }

    getCaseCommentSeenAt(caseId) {
        const key = String(caseId || '').trim();
        if (!key) return null;
        const value = readCaseCommentSeenMap()[key];
        if (!value) return null;
        const ms = Date.parse(value);
        return Number.isFinite(ms) ? ms : null;
    }

    markCaseCommentsSeen(caseRow) {
        const caseId = String(caseRow?.id || '').trim();
        if (!caseId) return;
        let latest = Date.now();
        for (const comment of caseRow?.comments || []) {
            const ms = Date.parse(comment?.createdAt || comment?.updatedAt || '');
            if (Number.isFinite(ms) && ms > latest) latest = ms;
        }
        const map = readCaseCommentSeenMap();
        map[caseId] = new Date(latest).toISOString();
        writeCaseCommentSeenMap(map);
        this.requestUpdate();
    }

    countNewCaseComments(caseRow) {
        const seenAt = this.getCaseCommentSeenAt(caseRow?.id);
        if (seenAt == null) return 0;
        const myId = this.currentDirectusUserId
            ? String(this.currentDirectusUserId).toLowerCase()
            : '';
        let count = 0;
        for (const comment of caseRow?.comments || []) {
            const createdMs = Date.parse(comment?.createdAt || '');
            if (!Number.isFinite(createdMs) || createdMs <= seenAt) continue;
            const authorId = comment?.author?.id
                ? String(comment.author.id).toLowerCase()
                : '';
            if (myId && authorId && authorId === myId) continue;
            count += 1;
        }
        return count;
    }

    backToCaseList() {
        this.pendingInviteCount = 0;
        this.closeListFilterMenus();
        this.attachmentSearchQuery = '';
        this.selectedCaseId = '';
        this.errorMessage = '';
        history.pushState({}, '', this._buildCaseUrl(''));
    }

    get currentDirectusUserId() {
        return this.sessionMeta?.directusViewer?.id
            || this.sessionMeta?.directusUserId
            || null;
    }

    canManageCollaborators(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin';
    }

    /** Owner/admin/collaborator can invite; read_only cannot. */
    canInviteCollaborators(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin' || role === 'collaborator';
    }

    myCaseRole(caseRow) {
        const me = this.currentDirectusUserId;
        if (!me || !caseRow) return null;
        if (caseRow.createdBy?.id && String(caseRow.createdBy.id) === String(me)) {
            return 'admin';
        }
        const membership = (caseRow.collaborators || []).find((c) => String(c.id) === String(me));
        return membership?.role || null;
    }

    canEditCaseContent(caseRow) {
        const role = this.myCaseRole(caseRow);
        return role === 'admin' || role === 'collaborator';
    }

    /** Any case member (including read_only) may comment. */
    canCommentOnCase(caseRow) {
        return Boolean(this.myCaseRole(caseRow));
    }

    casePeopleCount(caseRow) {
        return this.buildPeopleMembers(caseRow).length;
    }

    buildPeopleMembers(caseRow) {
        const members = [];
        const ownerId = caseRow?.createdBy?.id ? String(caseRow.createdBy.id) : null;
        if (caseRow?.createdBy) {
            members.push({
                id: caseRow.createdBy.id,
                email: caseRow.createdBy.email || '',
                username: caseRow.createdBy.username || '',
                firstName: caseRow.createdBy.firstName || '',
                lastName: caseRow.createdBy.lastName || '',
                role: 'admin',
                locked: true
            });
        }
        for (const entry of caseRow?.collaborators || []) {
            if (!entry?.id) continue;
            if (ownerId && String(entry.id) === ownerId) continue;
            members.push({
                id: entry.id,
                email: entry.email || '',
                username: entry.username || '',
                firstName: entry.firstName || '',
                lastName: entry.lastName || '',
                role: entry.role || 'collaborator',
                locked: false
            });
        }
        return members;
    }

    async openPeopleDialog(caseRow) {
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (!dialog) return;

        const canInvite = this.canInviteCollaborators(caseRow);
        const canManage = this.canManageCollaborators(caseRow);
        dialog.canInvite = canInvite;
        dialog.canManage = canManage;
        dialog.roleOptions = canManage ? null : CASE_INVITE_ROLE_OPTIONS;
        dialog.lookupFn = lookupDirectusUserByEmail;
        dialog.inviteFn = ({ email, role }) => inviteDirectusCaseUser(caseRow.id, { email, role });
        dialog.currentUserId = this.currentDirectusUserId || '';
        dialog.saving = this.savingCollaborators;
        dialog.error = '';
        let pendingInvites = [];
        try {
            pendingInvites = await listDirectusCaseInvites(caseRow.id);
        } catch {
            pendingInvites = [];
        }
        await dialog.open(this.buildPeopleMembers(caseRow), { pendingInvites });
        this.pendingInviteCount = pendingInvites.filter((inv) => inv && inv.status !== 'expired').length;
    }

    closePeopleDialog() {
        this.renderRoot?.querySelector('#case-people-dialog')?.close?.();
    }

    async handlePeopleInvited(event) {
        const caseRow = this.selectedCase;
        const detail = event.detail || {};
        if (!caseRow?.id) return;
        if (detail.status === 'added' && Array.isArray(detail.collaborators)) {
            this.cases = this.cases.map((row) => (
                row.id === caseRow.id ? { ...row, collaborators: detail.collaborators } : row
            ));
        }
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (dialog && detail.inviteUrl) {
            dialog.lastInviteUrl = detail.inviteUrl;
        }
        if (dialog && caseRow) {
            let pendingInvites = [];
            try {
                pendingInvites = await listDirectusCaseInvites(caseRow.id);
            } catch {
                pendingInvites = [];
            }
            const next = this.cases.find((r) => r.id === caseRow.id) || caseRow;
            dialog.members = dialog.sortMembers(this.buildPeopleMembers(next));
            dialog.pendingInvites = pendingInvites;
            this.pendingInviteCount = pendingInvites.filter((inv) => inv && inv.status !== 'expired').length;
        }
        invalidateNotifications();
    }

    async handlePeopleApproveInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        const kind = event.detail?.kind;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;
        try {
            const data = await approveDirectusCaseInvite(caseRow.id, inviteId, { kind });
            if (Array.isArray(data.collaborators)) {
                this.cases = this.cases.map((row) => (
                    row.id === caseRow.id ? { ...row, collaborators: data.collaborators } : row
                ));
            }
            await this.handlePeopleInvited({
                detail: {
                    status: data.status || 'approved',
                    inviteUrl: data.inviteUrl || null,
                    collaborators: data.collaborators
                }
            });
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog && data.inviteUrl) {
                dialog.lookupMessage = data.emailSent
                    ? 'Invite approved and emailed. You can still copy the link.'
                    : 'Invite approved — copy the link and send it.';
            }
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, "Couldn't approve that invite.");
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleRejectInvite(event) {
        const caseRow = this.selectedCase;
        const inviteId = event.detail?.inviteId;
        const kind = event.detail?.kind;
        if (!caseRow?.id || !inviteId || this.savingCollaborators) return;
        this.savingCollaborators = true;
        try {
            await rejectDirectusCaseInvite(caseRow.id, inviteId, { kind });
            await this.handlePeopleInvited({ detail: { status: 'rejected' } });
        } catch (err) {
            const dialog = this.renderRoot?.querySelector('#case-people-dialog');
            if (dialog) dialog.error = this.userFacingError(err, "Couldn't reject that invite.");
        } finally {
            this.savingCollaborators = false;
        }
    }

    async handlePeopleSave(event) {
        const caseRow = this.selectedCase;
        if (!caseRow?.id || this.savingCollaborators) return;
        if (!this.canManageCollaborators(caseRow)) return;

        const members = Array.isArray(event.detail?.members) ? event.detail.members : [];
        const collaborators = members
            .map((entry) => ({
                userId: entry?.userId,
                role: entry?.role || 'collaborator'
            }))
            .filter((entry) => entry.userId);

        this.savingCollaborators = true;
        const dialog = this.renderRoot?.querySelector('#case-people-dialog');
        if (dialog) {
            dialog.saving = true;
            dialog.error = '';
        }
        try {
            const data = await updateDirectusCaseCollaborators(caseRow.id, collaborators);
            const next = Array.isArray(data.collaborators) ? data.collaborators : [];
            this.cases = this.cases.map((row) => (
                row.id === caseRow.id ? { ...row, collaborators: next } : row
            ));
            this.closePeopleDialog();
        } catch (err) {
            if (dialog) {
                dialog.error = this.userFacingError(err, "Couldn't update people. Please try again.");
            }
        } finally {
            this.savingCollaborators = false;
            if (dialog) dialog.saving = false;
        }
    }

    async handlePostComment(event, caseRow) {
        const text = String(event.detail?.text || '').trim();
        if (!caseRow?.id || !text || this.postingComment) return;
        if (!this.canCommentOnCase(caseRow)) return;

        // currentTarget is only set during sync dispatch; keep it across await.
        const panel = event.currentTarget;

        this.postingComment = true;
        this.errorMessage = '';
        try {
            const data = await createDirectusCaseComment(caseRow.id, text);
            const created = data.comment;
            panel?.clearDraft?.();
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                const comments = Array.isArray(row.comments) ? [...row.comments] : [];
                if (created?.id) comments.push(created);
                return { ...row, comments };
            });
            const updated = this.cases.find((row) => row.id === caseRow.id);
            if (updated) this.markCaseCommentsSeen(updated);
        } catch (err) {
            this.errorMessage = this.userFacingError(err, "Couldn't send your comment. Please try again.");
        } finally {
            this.postingComment = false;
        }
    }

    // ── New Case form ──────────────────────────────────────────────────────
    openNewCaseForm() {
        this.showNewCaseForm = true;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.newCaseError = '';
        // Focus the title input after render
        this.updateComplete.then(() => {
            this.shadowRoot?.querySelector('#new-case-title')?.focus();
        });
    }

    handleCancelNewCase() {
        this.showNewCaseForm = false;
        this.newCaseTitle = '';
        this.newCaseDescription = '';
        this.newCaseError = '';
        this.creatingCase = false;
    }

    async handleNewCaseSubmit(e) {
        e.preventDefault();
        if (this.creatingCase) return;

        const title = this.newCaseTitle.trim();
        if (!title) {
            this.newCaseError = t('cases.titleRequired');
            return;
        }

        this.creatingCase = true;
        this.newCaseError = '';
        try {
            const data = await createDirectusCase({
                title,
                description: this.newCaseDescription.trim() || undefined,
                status: 'active'
            });
            const created = data.case;
            // Prepend to list and open immediately
            this.cases = [created, ...this.cases];
            this.handleCancelNewCase();
            this.openCase(created.id);
        } catch (err) {
            this.newCaseError = this.userFacingError(err, "Couldn't create the case. Please try again.");
        } finally {
            this.creatingCase = false;
        }
    }

    mergeCaseUpdate(caseRow, updated = {}) {
        // updateCase remaps with empty nested collections — keep local arrays.
        const next = { ...caseRow, ...updated };
        next.attachments = Array.isArray(caseRow.attachments) ? caseRow.attachments : [];
        next.comments = Array.isArray(caseRow.comments) ? caseRow.comments : [];
        next.collaborators = Array.isArray(updated.collaborators)
            ? updated.collaborators
            : (Array.isArray(caseRow.collaborators) ? caseRow.collaborators : []);
        return next;
    }

    async handleArchiveCase(caseRow) {
        if (!caseRow?.id || this.archivingCase) return;
        if (!this.canManageCollaborators(caseRow)) return;
        this.archivingCase = true;
        this.errorMessage = '';
        try {
            const data = await updateDirectusCase(caseRow.id, { status: 'archived' });
            const updated = data.case;
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id ? this.mergeCaseUpdate(row, updated) : row
            );
            this.cancelEditCase();
        } catch (err) {
            this.errorMessage = this.userFacingError(err, "Couldn't archive this case. Please try again.");
        } finally {
            this.archivingCase = false;
        }
    }

    // ── Inline case edit ───────────────────────────────────────────────────
    startEditCase(caseRow) {
        if (!this.canEditCaseContent(caseRow)) return;
        this.editingCase = true;
        this.editCaseTitle = caseRow.title || '';
        this.editCaseDesc = caseRow.description || '';
        this.caseEditError = '';
        this.updateComplete.then(() => {
            this.shadowRoot?.querySelector('#edit-case-title')?.focus();
        });
    }

    cancelEditCase() {
        this.editingCase = false;
        this.editCaseTitle = '';
        this.editCaseDesc = '';
        this.caseEditError = '';
        this.savingCaseEdit = false;
    }

    async saveEditCase(caseRow) {
        if (this.savingCaseEdit) return;
        if (!this.canEditCaseContent(caseRow)) return;
        const title = this.editCaseTitle.trim();
        if (!title) { this.caseEditError = t('cases.titleRequired'); return; }

        this.savingCaseEdit = true;
        this.caseEditError = '';
        try {
            const data = await updateDirectusCase(caseRow.id, {
                title,
                description: this.editCaseDesc.trim() || null
            });
            const updated = data.case;
            this.cases = this.cases.map((row) =>
                row.id === caseRow.id ? this.mergeCaseUpdate(row, updated) : row
            );
            this.cancelEditCase();
        } catch (err) {
            this.caseEditError = this.userFacingError(err, "Couldn't save your changes. Please try again.");
        } finally {
            this.savingCaseEdit = false;
        }
    }

    // ── Attachment delete ──────────────────────────────────────────────────
    async handleDeleteAttachment(caseRow, attachment) {
        if (!attachment?.id || this.deletingAttachmentId) return;
        if (!this.canEditCaseContent(caseRow)) return;
        if (!confirm(t('cases.confirmDeleteAttachment', { name: attachment.name || attachment.filenameDownload }))) return;

        this.deletingAttachmentId = attachment.id;
        this.uploadError = '';
        try {
            await deleteDirectusCaseAttachment(caseRow.id, attachment.id);
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                return {
                    ...row,
                    attachments: (row.attachments || []).filter((a) => a.id !== attachment.id)
                };
            });
        } catch (err) {
            this.uploadError = this.userFacingError(err, "Couldn't remove that file. Please try again.");
        } finally {
            this.deletingAttachmentId = '';
        }
    }

    // ── File upload ────────────────────────────────────────────────────────
    triggerFileUpload() {
        this.shadowRoot?.querySelector('#attach-file-input')?.click();
    }

    async handleFileSelected(event, caseRow) {
        const file = event.target?.files?.[0];
        if (!file || !caseRow?.id || this.uploadingFile) return;
        if (!this.canEditCaseContent(caseRow)) return;

        // Reset input so the same file can be re-selected if needed
        event.target.value = '';

        this.uploadingFile = true;
        this.uploadError = '';
        this.uploadStatusText = t('cases.uploadingFile', { name: file.name });
        try {
            const data = await uploadDirectusCaseAttachment(caseRow.id, file);
            const attachment = data.attachment;
            // Append to the case's attachment list in-place
            this.cases = this.cases.map((row) => {
                if (row.id !== caseRow.id) return row;
                const attachments = Array.isArray(row.attachments) ? [...row.attachments] : [];
                if (attachment?.id) attachments.push(attachment);
                return { ...row, attachments };
            });
            this.uploadStatusText = t('cases.uploadComplete', { name: file.name });
            // Clear the success message after 4 s
            setTimeout(() => {
                this.uploadStatusText = '';
            }, 4000);
        } catch (err) {
            this.uploadError = this.userFacingError(err, "Couldn't upload that file. Please try again.");
            this.uploadStatusText = '';
        } finally {
            this.uploadingFile = false;
        }
    }

    startHeartbeat() {
        this.stopHeartbeat();
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
        });
        const ping = () => {
            sendTrameContainerHeartbeat({
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                heartbeatUrl,
                includeUserActive: false,
                onIdleTimeout: () => this._handleViewerIdleTimeout()
            }).catch(() => {});
        };
        ping();
        this._heartbeatInterval = setInterval(ping, 20000);
    }

    stopHeartbeat() {
        if (this._heartbeatInterval) {
            clearInterval(this._heartbeatInterval);
            this._heartbeatInterval = null;
        }
    }

    // Internal: cleans up UI + sends stop request. Does NOT touch history.
    async _doCloseViewer() {
        this.stopHeartbeat();
        resetViewerActivity();
        const token = this._viewerSessionToken;
        const seatId = this._viewerSeatId;
        this.clearViewerUiState();

        if (!token) return;
        const { stopUrl } = getViewerSessionEndpoints({
            kind: VIEWER_KINDS.SLICER_GUI,
            sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS
        });
        await stopViewerSession({
            stopUrl,
            sessionToken: token,
            body: buildViewerStopBody({
                kind: VIEWER_KINDS.SLICER_GUI,
                sessionToken: token,
                seatId,
                mode: VIEWER_RELEASE_MODES.SOFT
            })
        });
    }

    // Public: called by the Close button. Uses history.back() so the browser
    // back button and the button are indistinguishable to the user.
    closeViewer() {
        if (this._viewerPushedState) {
            this._viewerPushedState = false;
            history.back(); // popstate fires → _handlePopState → _doCloseViewer
        } else {
            this._doCloseViewer();
        }
    }

    // Called by the heartbeat idle timeout: clean up + fix URL in place (no back step).
    async _handleViewerIdleTimeout() {
        this._viewerPushedState = false;
        await this._doCloseViewer();
        history.replaceState(
            { caseId: this.selectedCaseId },
            '',
            this._buildCaseUrl(this.selectedCaseId)
        );
    }

    attachmentMetaLine(attachment) {
        const originalName = attachment.filenameDownload || '';
        const size = formatBytes(attachment.filesize);
        const modified = formatDateTime(attachment.modifiedAt);
        return [originalName, size, modified].filter(Boolean).join(' - ');
    }

    attachmentTitle(attachment) {
        return String(attachment?.name || attachment?.filenameDownload || 'Attachment');
    }

    filterAttachments(attachments = [], query = this.attachmentSearchQuery) {
        const needle = String(query || '').trim().toLowerCase();
        const list = Array.isArray(attachments) ? attachments : [];
        if (!needle) return [...list];
        return list.filter((row) => {
            const title = this.attachmentTitle(row).toLowerCase();
            const original = String(row?.filenameDownload || '').toLowerCase();
            return title.includes(needle) || original.includes(needle);
        });
    }

    sortAttachments(attachments = [], order = this.attachmentSortOrder) {
        const list = Array.isArray(attachments) ? [...attachments] : [];
        const titleOf = (row) => this.attachmentTitle(row).toLowerCase();
        const timeOf = (row) => {
            const value = Date.parse(row?.modifiedAt || '');
            return Number.isFinite(value) ? value : null;
        };

        if (order === 'title') {
            return list.sort((a, b) => {
                const byTitle = titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
                return byTitle || String(a.id || '').localeCompare(String(b.id || ''));
            });
        }

        const newestFirst = order !== 'oldest';
        return list.sort((a, b) => {
            const timeA = timeOf(a);
            const timeB = timeOf(b);
            if (timeA == null && timeB == null) {
                return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
            }
            if (timeA == null) return 1;
            if (timeB == null) return -1;
            const diff = newestFirst ? timeB - timeA : timeA - timeB;
            return diff || titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
        });
    }

    caseTitle(caseRow) {
        return String(caseRow?.title || t('cases.untitled'));
    }

    filterCases(cases = [], query = this.caseSearchQuery) {
        const needle = String(query || '').trim().toLowerCase();
        const list = Array.isArray(cases) ? cases : [];
        if (!needle) return [...list];
        return list.filter((row) => {
            const title = this.caseTitle(row).toLowerCase();
            const description = String(row?.description || '').toLowerCase();
            return title.includes(needle) || description.includes(needle);
        });
    }

    sortCases(cases = [], order = this.caseSortOrder) {
        const list = Array.isArray(cases) ? [...cases] : [];
        const titleOf = (row) => this.caseTitle(row).toLowerCase();
        const timeOf = (row) => {
            const value = Date.parse(this.caseLastModifiedAt(row) || '');
            return Number.isFinite(value) ? value : null;
        };

        if (order === 'title') {
            return list.sort((a, b) => {
                const byTitle = titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
                return byTitle || String(a.id || '').localeCompare(String(b.id || ''));
            });
        }

        const newestFirst = order !== 'oldest';
        return list.sort((a, b) => {
            const timeA = timeOf(a);
            const timeB = timeOf(b);
            if (timeA == null && timeB == null) {
                return titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
            }
            if (timeA == null) return 1;
            if (timeB == null) return -1;
            const diff = newestFirst ? timeB - timeA : timeA - timeB;
            return diff || titleOf(a).localeCompare(titleOf(b), undefined, { sensitivity: 'base' });
        });
    }

    closeListFilterMenus() {
        this.renderRoot?.querySelectorAll('list-filter-tools').forEach((el) => {
            el.closeMenus?.();
        });
    }

    handleAttachmentSearchChange(event) {
        this.attachmentSearchQuery = String(event.detail?.query || '');
    }

    handleAttachmentSortChange(event) {
        const order = String(event.detail?.order || '');
        if (!LIST_SORT_OPTIONS.some((opt) => opt.value === order)) return;
        this.attachmentSortOrder = order;
    }

    handleCaseSearchChange(event) {
        this.caseSearchQuery = String(event.detail?.query || '');
    }

    handleCaseSortChange(event) {
        const order = String(event.detail?.order || '');
        if (!LIST_SORT_OPTIONS.some((opt) => opt.value === order)) return;
        this.caseSortOrder = order;
    }

    attachmentOpenTitle(attachment) {
        if (attachment?.canOpenInSlicer) {
            const label = viewerDisplayName(VIEWER_KINDS.SLICER_GUI, {
                simplified: this.accountPrefersSimplifiedViewer()
            });
            return t('cases.openInDefault', { viewer: label });
        }
        if (attachment?.canPreviewInBrowser) return t('cases.browserPreviewSoon');
        return t('cases.fileTypeUnsupported');
    }

    attachmentCanActivate(attachment) {
        return Boolean(attachment?.canOpenInSlicer || attachment?.canPreviewInBrowser);
    }

    accountPrefersSimplifiedViewer() {
        return getCachedLocalSlicerViewerOptions().useSimplifiedViewer === true;
    }

    clearViewerUiState() {
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerSimplified = false;
        this.currentFileName = '';
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.openingAttachmentId = '';
    }

    async handleOpenAttachment(caseRow, attachment, { simplified } = {}) {
        if (this.openingAttachmentId) return;

        if (attachment?.canPreviewInBrowser && !attachment?.canOpenInSlicer) {
            this.errorMessage = t('cases.browserPreviewNote');
            return;
        }
        if (!attachment?.canOpenInSlicer) return;

        const useSimplified = resolveSimplifiedViewerChoice(
            simplified,
            this.accountPrefersSimplifiedViewer()
        );
        const viewerLabel = viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified: useSimplified });

        this.openingAttachmentId = attachment.id;
        this.errorMessage = '';
        this.currentFileName = attachment.filenameDownload || attachment.name || 'attachment';
        this.viewerSimplified = useSimplified;
        this.viewerLoading = true;
        this.viewerLoadingDetail = attachment.filesize && attachment.filesize > 50 * 1024 * 1024
            ? t('cases.preparingFileLarge', { name: this.currentFileName, mb: Math.round(attachment.filesize / (1024 * 1024)) })
            : t('cases.preparingFile', { name: this.currentFileName });
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            this.stopHeartbeat();
            const data = await openDirectusAttachmentFullSlicer(caseRow.id, attachment.id, {
                useSimplifiedViewer: useSimplified
            });

            this._viewerSessionToken = data.sessionToken || null;
            this._viewerSeatId = data.seatId != null ? Number(data.seatId) : null;
            this.currentFileName = data.fileName || this.currentFileName;
            this.viewerSimplified = data.useSimplifiedViewer === true || useSimplified;

            this.iframeUrl = buildSlicerGuiLoaderUrl({
                fileId: data.stagedKey || attachment.fileId,
                fileName: this.currentFileName,
                vncPath: data.vncPath || data.slicerGuiUrl || '',
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                sessionScope: VIEWER_SESSION_SCOPES.DIRECTUS,
                simplified: this.viewerSimplified,
                embed: true,
                quick: false
            });
            markViewerActivity();
            this.startHeartbeat();
            this.viewerLoading = true;
            this.viewerLoadingDetail = t('cases.openingViewerReady', { viewer: viewerLabel });
            this.openingAttachmentId = '';

            this._viewerPushedState = true;
            history.pushState(
                { caseId: caseRow.id, viewer: true },
                '',
                this._buildViewerUrl()
            );
        } catch (err) {
            this.clearViewerUiState();
            this.errorMessage = this.userFacingError(err, "Couldn't open the viewer. Please try again.");
        }
    }

    handleViewerIframeLoad() {
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        markViewerActivity();
    }

    renderLanding() {
        const filteredCases = this.sortCases(this.filterCases(this.cases));
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="page-header-row">
                    <h1 class="page-heading">${t('cases.title')}</h1>
                    <div class="page-header-actions">
                        ${this.cases.length > 0 && !this.showNewCaseForm ? html`
                            <list-filter-tools
                                .searchQuery=${this.caseSearchQuery}
                                .sortOrder=${this.caseSortOrder}
                                .sortOptions=${LIST_SORT_OPTIONS}
                                searchLabel=${t('cases.searchAria')}
                                sortLabel=${t('cases.sortAria')}
                                searchPlaceholder=${t('cases.filterPlaceholder')}
                                @search-change=${(e) => this.handleCaseSearchChange(e)}
                                @sort-change=${(e) => this.handleCaseSortChange(e)}
                            ></list-filter-tools>
                        ` : ''}
                        <button
                            class=${this.showNewCaseForm ? 'primary-button is-cancel' : 'primary-button'}
                            type="button"
                            ?disabled=${this.loading || this.creatingCase}
                            @click=${() => this.showNewCaseForm ? this.handleCancelNewCase() : this.openNewCaseForm()}
                        >
                            ${this.showNewCaseForm ? t('common.cancel') : t('cases.newCase')}
                        </button>
                    </div>
                </div>

                ${this.loading ? html`
                    <div slot="content" class="status-note">${t('cases.loading')}</div>
                ` : ''}

                ${this.errorMessage ? html`
                    <page-content-message
                        slot="content"
                        variant="error"
                        .message=${this.errorMessage}
                    ></page-content-message>
                ` : ''}

                ${this.showNewCaseForm ? html`
                    <form slot="content" class="new-case-form" @submit=${(e) => this.handleNewCaseSubmit(e)} novalidate>
                        <h3>${t('cases.newCase')}</h3>

                        <div class="form-group">
                            <label class="form-label" for="new-case-title">${t('cases.createTitle')}</label>
                            <input
                                id="new-case-title"
                                class="form-input"
                                type="text"
                                placeholder=${t('cases.titlePlaceholder')}
                                .value=${this.newCaseTitle}
                                @input=${(e) => { this.newCaseTitle = e.target.value; }}
                                ?disabled=${this.creatingCase}
                                autocomplete="off"
                                required
                            />
                        </div>

                        <div class="form-group">
                            <label class="form-label" for="new-case-desc">${t('cases.description')}</label>
                            <textarea
                                id="new-case-desc"
                                class="form-textarea"
                                placeholder=${t('cases.descriptionPlaceholder')}
                                .value=${this.newCaseDescription}
                                @input=${(e) => { this.newCaseDescription = e.target.value; }}
                                ?disabled=${this.creatingCase}
                            ></textarea>
                        </div>

                        ${this.newCaseError ? html`
                            <div class="form-error-msg">${this.newCaseError}</div>
                        ` : ''}

                        <div class="form-actions">
                            <button
                                class="primary-button"
                                type="submit"
                                ?disabled=${this.creatingCase}
                            >
                                ${this.creatingCase ? t('cases.creating') : t('cases.create')}
                            </button>
                        </div>
                    </form>
                ` : ''}

                ${!this.loading && !this.errorMessage && this.cases.length === 0 && !this.showNewCaseForm ? html`
                    <page-content-message
                        slot="content"
                        variant="empty"
                        message=${t('cases.empty')}
                    ></page-content-message>
                ` : ''}

                ${!this.loading && this.cases.length > 0 && filteredCases.length === 0 && !this.showNewCaseForm ? html`
                    <p slot="content" class="cases-empty-filter">No cases match “${this.caseSearchQuery.trim()}”.</p>
                ` : ''}

                ${!this.loading && filteredCases.length > 0 ? html`
                    <div slot="content" class="case-grid">
                        ${filteredCases.map((row) => {
                            const isArchived = row.status === 'archived';
                            const modifiedLabel = this.caseLastModifiedLabel(row);
                            const newCommentCount = this.countNewCaseComments(row);
                            return html`
                                <button
                                    class=${isArchived ? 'case-card is-archived' : 'case-card'}
                                    type="button"
                                    @click=${() => this.openCase(row.id)}
                                >
                                    <div class="case-card-title-row">
                                        <span class="case-card-title">${row.title || t('cases.untitled')}</span>
                                        ${newCommentCount > 0 ? html`
                                            <span
                                                class="case-card-new-badge"
                                                title=${newCommentCount === 1
                                                    ? t('cases.oneNewComment')
                                                    : t('cases.nNewComments', { n: newCommentCount })}
                                            >${newCommentCount === 1 ? t('cases.badgeNew') : t('cases.badgeNNew', { n: newCommentCount })}</span>
                                        ` : ''}
                                    </div>
                                    ${row.description ? html`
                                        <p class="case-card-desc">${row.description}</p>
                                    ` : ''}
                                    ${modifiedLabel ? html`
                                        <div class="case-card-meta-row">
                                            <span class="case-card-meta-item">${modifiedLabel}</span>
                                        </div>
                                    ` : ''}
                                    ${isArchived ? html`
                                        <span class="status-chip">${t('cases.archived')}</span>
                                    ` : ''}
                                </button>
                            `;
                        })}
                    </div>
                ` : ''}

            </page-layout-template>
        `;
    }

    renderCaseDetail(caseRow) {
        const allAttachments = Array.isArray(caseRow.attachments) ? caseRow.attachments : [];
        const attachments = this.sortAttachments(this.filterAttachments(allAttachments));
        const searchActive = !!this.attachmentSearchQuery.trim();
        const comments = Array.isArray(caseRow.comments) ? caseRow.comments : [];
        const canEdit = this.canEditCaseContent(caseRow);
        const canManage = this.canManageCollaborators(caseRow);
        const canComment = this.canCommentOnCase(caseRow);
        const peopleCount = this.casePeopleCount(caseRow);
        const pendingInvites = Number(this.pendingInviteCount) || 0;
        const peopleLabel = peopleCount
            ? t('cases.people', { n: peopleCount })
            : t('cases.peopleLabel');
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey="cases"
                homeHref="/file-manager"
                homeLabel="Home"
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                <div slot="content" class="case-detail">
                    <div class="detail-toolbar">
                        <button class="back-link" type="button" @click=${() => this.backToCaseList()}>
                            ${t('cases.backToList')}
                        </button>
                        <div class="detail-toolbar-actions">
                            <button
                                class="quiet-button"
                                type="button"
                                ?disabled=${this.savingCollaborators}
                                @click=${() => this.openPeopleDialog(caseRow)}
                            >
                                ${peopleLabel}${pendingInvites
                                    ? html` <span class="people-pending-badge" title=${t('people.pendingInvites')}>${pendingInvites}</span>`
                                    : ''}
                            </button>
                            ${canEdit && !this.editingCase ? html`
                                <button
                                    class="quiet-button"
                                    type="button"
                                    ?disabled=${this.archivingCase}
                                    @click=${() => this.startEditCase(caseRow)}
                                >${t('cases.editDetails')}</button>
                            ` : ''}
                        </div>
                    </div>

                    ${this.editingCase ? html`
                        <form class="new-case-form" @submit=${(e) => { e.preventDefault(); this.saveEditCase(caseRow); }} novalidate>
                            <div class="form-group">
                                <label class="form-label" for="edit-case-title">${t('cases.createTitle').replace(' *', '')}</label>
                                <input
                                    id="edit-case-title"
                                    class="form-input"
                                    type="text"
                                    .value=${this.editCaseTitle}
                                    @input=${(e) => { this.editCaseTitle = e.target.value; }}
                                    ?disabled=${this.savingCaseEdit}
                                    autocomplete="off"
                                    required
                                />
                            </div>
                            <div class="form-group">
                                <label class="form-label" for="edit-case-desc">${t('cases.description')}</label>
                                <textarea
                                    id="edit-case-desc"
                                    class="form-textarea"
                                    .value=${this.editCaseDesc}
                                    @input=${(e) => { this.editCaseDesc = e.target.value; }}
                                    ?disabled=${this.savingCaseEdit}
                                ></textarea>
                            </div>
                            ${this.caseEditError ? html`<div class="form-error-msg">${this.caseEditError}</div>` : ''}
                            <div class="form-actions">
                                ${canManage && caseRow.status !== 'archived' ? html`
                                    <button
                                        class="quiet-button form-actions-spacer"
                                        type="button"
                                        ?disabled=${this.savingCaseEdit || this.archivingCase}
                                        @click=${() => this.handleArchiveCase(caseRow)}
                                    >${this.archivingCase ? t('cases.archiving') : t('cases.archive')}</button>
                                ` : html`<span class="form-actions-spacer"></span>`}
                                <button class="secondary-button" type="button" ?disabled=${this.savingCaseEdit} @click=${() => this.cancelEditCase()}>${t('common.cancel')}</button>
                                <button class="primary-button" type="submit" ?disabled=${this.savingCaseEdit}>
                                    ${this.savingCaseEdit ? t('common.saving') : t('common.save')}
                                </button>
                            </div>
                        </form>
                    ` : html`
                        <div class="detail-header">
                            <div class="detail-title-row">
                                <h2 class="detail-title">${caseRow.title || t('cases.untitledCase')}</h2>
                                ${caseRow.status && caseRow.status !== 'active' ? html`
                                    <span class="status-chip">${caseRow.status}</span>
                                ` : ''}
                            </div>
                            ${caseRow.description ? html`
                                <p class="detail-desc">${caseRow.description}</p>
                            ` : ''}
                        </div>
                    `}

                    ${this.errorMessage ? html`
                        <page-content-message
                            variant="error"
                            .message=${this.errorMessage}
                        ></page-content-message>
                    ` : ''}

                    <div class="case-detail-grid">
                        <div class="files-panel">
                            <div class="panel-header">
                                <div class="panel-header-start">
                                    <h3 class="panel-title">${t('cases.attachments')}</h3>
                                    <span
                                        class="panel-count"
                                        title=${searchActive
                                            ? `${attachments.length} of ${allAttachments.length} shown`
                                            : `${allAttachments.length} attachments`}
                                    >${searchActive
                                        ? `${attachments.length}/${allAttachments.length}`
                                        : allAttachments.length}</span>
                                </div>
                                ${allAttachments.length > 0 ? html`
                                    <list-filter-tools
                                        .searchQuery=${this.attachmentSearchQuery}
                                        .sortOrder=${this.attachmentSortOrder}
                                        .sortOptions=${LIST_SORT_OPTIONS}
                                        searchLabel=${t('cases.searchAttachments')}
                                        sortLabel=${t('cases.sortAttachments')}
                                        searchPlaceholder=${t('listFilter.filterPlaceholder')}
                                        @search-change=${(e) => this.handleAttachmentSearchChange(e)}
                                        @sort-change=${(e) => this.handleAttachmentSortChange(e)}
                                    ></list-filter-tools>
                                ` : ''}
                            </div>
                            <div class="files-body">
                                ${allAttachments.length === 0 ? html`
                                    <div class="empty-note">${t('cases.noFiles')}</div>
                                ` : attachments.length === 0 ? html`
                                    <div class="empty-note">No attachments match “${this.attachmentSearchQuery.trim()}”.</div>
                                ` : html`
                                    <div class="file-list">
                                        ${attachments.map((attachment) => html`
                                            <file-list-row
                                                .fileName=${this.attachmentTitle(attachment)}
                                                .metaLine=${this.attachmentMetaLine(attachment)}
                                                .nameButtonDisabled=${!this.attachmentCanActivate(attachment)
                                                    || !!this.openingAttachmentId
                                                    || this.viewerLoading}
                                                .nameButtonTitle=${this.attachmentOpenTitle(attachment)}
                                                @name-click=${() => this.handleOpenAttachment(caseRow, attachment)}
                                            >
                                                ${attachment?.canOpenInSlicer ? html`
                                                    <attachment-open-menu
                                                        slot="title-trailing"
                                                        .preferSimplifiedDefault=${this.accountPrefersSimplifiedViewer()}
                                                        ?disabled=${!!this.openingAttachmentId || this.viewerLoading}
                                                        @open-viewer=${(e) => this.handleOpenAttachment(
                                                            caseRow,
                                                            attachment,
                                                            { simplified: e.detail?.simplified === true }
                                                        )}
                                                    ></attachment-open-menu>
                                                ` : ''}
                                                ${canEdit ? html`
                                                    <button
                                                        slot="actions"
                                                        class="file-icon-button"
                                                        type="button"
                                                        title=${t('cases.removeFile')}
                                                        aria-label=${t('cases.removeFile')}
                                                        ?disabled=${!!this.deletingAttachmentId || this.uploadingFile}
                                                        @click=${() => this.handleDeleteAttachment(caseRow, attachment)}
                                                    >
                                                        <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
                                                            <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/>
                                                        </svg>
                                                    </button>
                                                ` : ''}
                                            </file-list-row>
                                        `)}
                                    </div>
                                `}

                                <input
                                    id="attach-file-input"
                                    type="file"
                                    hidden
                                    @change=${(e) => this.handleFileSelected(e, caseRow)}
                                />

                                ${canEdit ? html`
                                    <div class="upload-action-row">
                                        ${this.uploadStatusText ? html`
                                            <span class="upload-status">${this.uploadStatusText}</span>
                                        ` : this.uploadError ? html`
                                            <span class="upload-error">${this.uploadError}</span>
                                        ` : html`<span></span>`}
                                        <button
                                            class="secondary-button"
                                            type="button"
                                            ?disabled=${this.uploadingFile || !!this.openingAttachmentId}
                                            @click=${() => this.triggerFileUpload()}
                                        >
                                            ${this.uploadingFile ? t('cases.uploading') : t('cases.addFile')}
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        </div>

                        <comments-panel
                            .comments=${comments}
                            emptyMessage=${this.sessionMeta?.comments?.loaded === false
                                ? t('cases.commentsLoadFailed')
                                : t('cases.noComments')}
                            placeholder=${t('cases.writeComment')}
                            ?posting=${this.postingComment}
                            ?allowCompose=${canComment}
                            @post-comment=${(e) => this.handlePostComment(e, caseRow)}
                        ></comments-panel>
                    </div>
                </div>
            </page-layout-template>
        `;
    }

    renderViewerOverlay() {
        if (!this.showIframe) return html``;
        const viewerLabel = viewerDisplayName(VIEWER_KINDS.SLICER_GUI, {
            simplified: this.viewerSimplified
        });
        return html`
            <div class="iframe-overlay">
                <div class="iframe-header">
                    <div class="iframe-title">
                        ${viewerLabel}: ${this.currentFileName || t('common.loading')}
                    </div>
                    <div class="iframe-header-actions">
                        <button
                            class="primary-button"
                            type="button"
                            @click=${() => this.closeViewer()}
                        >
                            ${t('common.close')}
                        </button>
                    </div>
                </div>
                <div class="iframe-container">
                    ${this.iframeUrl !== 'about:blank' ? html`
                        <iframe
                            class="trame-iframe"
                            src="${this.iframeUrl}"
                            allow="clipboard-read; clipboard-write; cross-origin-isolated"
                            allowfullscreen
                            frameborder="0"
                            referrerpolicy="origin"
                            @load=${() => this.handleViewerIframeLoad()}
                        ></iframe>
                    ` : ''}
                    ${this.viewerLoading ? html`
                        <div class="loading-overlay">
                            <div class="viewer-loading">
                                <p>${this.viewerLoadingDetail || t('cases.loadingViewer')}</p>
                            </div>
                        </div>
                    ` : ''}
                </div>
            </div>
        `;
    }

    render() {
        const detail = this.selectedCase;
        return html`
            ${detail ? this.renderCaseDetail(detail) : this.renderLanding()}
            ${this.renderViewerOverlay()}
            <people-dialog
                id="case-people-dialog"
                title=${t('cases.peopleDialog')}
                @people-save=${(e) => this.handlePeopleSave(e)}
                @people-cancel=${() => this.closePeopleDialog()}
                @people-invited=${(e) => this.handlePeopleInvited(e)}
                @people-approve-invite=${(e) => this.handlePeopleApproveInvite(e)}
                @people-reject-invite=${(e) => this.handlePeopleRejectInvite(e)}
            ></people-dialog>
        `;
    }
}

customElements.define('directus-cases-page', DirectusCasesPage);
