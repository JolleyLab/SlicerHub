import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { API_URL } from '../config.js';
import '../components/page-layout-template.js';
import '../components/add-button.js';
import '../components/file-list-row.js';
import '../components/app-dialog.js';
import '../components/dropdown-select.js';
import './collaboratorSearch.js';
import './collaboratorResultRow.js';
import {
    getProjectById,
    updateProjectCollaborators,
    listProjectFiles,
    updateProjectFileTitle
} from '../services/projects.js';
import {
    getProjectGpu,
    listGpuProviders,
    configureProjectGpuProvider,
    setActiveProjectGpuProvider,
    openFullSlicerViewer,
    prepareFullSlicerViewer,
    startProjectGpuBilling,
    stopProjectGpuBilling,
    transferProjectGpuBilling,
    acknowledgeProjectGpuError,
    sendProjectGpuHeartbeat,
    prestageProjectGpu
} from '../services/projectGpu.js';
import { resolveTramePageUrl } from '../utils/trameViewerUrl.js';
import {
    getCachedLocalSlicerViewerOptions,
    fetchUserPreferences
} from '../utils/userPreferences.js';
import {
    scheduleViewerStopOnLeave,
    cancelViewerStopOnLeave
} from '../utils/viewerGraceStop.js';
import {
    installViewerActivityListeners,
    markViewerActivity,
    resetViewerActivity,
    setViewerIdleMs,
    isViewerUserActive
} from '../utils/viewerActivity.js';
import { sendTrameContainerHeartbeat } from '../utils/trameHeartbeat.js';
import { stopViewerSession } from '../utils/viewerSessionLifecycle.js';
import {
    VIEWER_KINDS,
    VIEWER_RELEASE_MODES,
    defaultReleaseModeForClose,
    getViewerSessionEndpoints,
    buildViewerStopBody,
    buildSlicerGuiLoaderUrl,
    viewerDisplayName
} from '../utils/viewerLaunch.js';

const GPU_PROVIDER_CONSOLE_URLS = {
    vast: 'https://cloud.vast.ai/instances/'
};

const FULLSCREEN_TIP_DISMISSED_KEY = 'slicer-web:fullscreen-tip-dismissed';

export class ProjectReviewPage extends LitElement {
    static get styles() {
        return css`
            .status-note {
                margin-top: 14px;
                color: var(--color-text-secondary);
            }

            .form-error {
                margin-top: 12px;
                color: #c62828;
            }

            .success-note {
                margin-top: 12px;
                color: #2e7d32;
            }

            .toast {
                position: fixed;
                right: 20px;
                bottom: 20px;
                z-index: 1200;
                background: #2e7d32;
                color: #fff;
                border-radius: var(--radius-md);
                padding: 10px 14px;
                box-shadow: 0 10px 28px var(--color-shadow, rgba(0, 0, 0, 0.2));
                max-width: min(360px, calc(100vw - 40px));
                font-weight: 500;
            }

            .error-alert-message {
                margin: 0;
                line-height: 1.5;
                color: var(--color-text-primary);
                white-space: pre-wrap;
                word-break: break-word;
            }

            .collaborators-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                padding: 10px;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            }

            .files-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                padding: 12px;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            }

            :host-context([data-theme='dark']) .collaborators-panel,
            :host-context([data-theme='dark']) .files-panel,
            :host-context([data-theme='dark']) .gpu-panel {
                border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
            }

            .file-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            file-list-row .file-action-icon {
                width: 16px;
                height: 16px;
                display: block;
            }

            .iframe-overlay {
                position: fixed;
                inset: 0;
                z-index: 1000;
                display: flex;
                flex-direction: column;
                gap: 12px;
                padding: 16px;
                box-sizing: border-box;
                background: var(--color-background);
                color: var(--color-text-primary);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .iframe-overlay:fullscreen,
            .iframe-overlay.is-fullscreen {
                gap: 0;
                padding: 0;
                background: #090b14;
            }

            .iframe-header {
                display: flex;
                justify-content: space-between;
                align-items: center;
                gap: 16px;
                flex-shrink: 0;
                padding: 12px 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-primary);
                color: var(--color-on-primary);
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
                position: relative;
                z-index: 3;
            }

            /* Fullscreen: hide all app chrome so the viewer owns the whole surface.
               Desktop: Exit with Escape. Touch: use the bottom Exit control. */
            .iframe-overlay:fullscreen .iframe-header,
            .iframe-overlay.is-fullscreen .iframe-header {
                display: none;
            }

            .iframe-fs-exit {
                display: none;
            }

            .fullscreen-tip-backdrop {
                display: none;
            }

            .iframe-overlay:fullscreen .fullscreen-tip-backdrop,
            .iframe-overlay.is-fullscreen .fullscreen-tip-backdrop {
                display: flex;
                align-items: center;
                justify-content: center;
                position: absolute;
                inset: 0;
                z-index: 6;
                padding: max(20px, env(safe-area-inset-top, 0px)) 20px max(20px, env(safe-area-inset-bottom, 0px));
                box-sizing: border-box;
                background: rgba(8, 10, 18, 0.52);
            }

            .fullscreen-tip {
                width: min(380px, 100%);
                padding: 20px 20px 16px;
                border-radius: var(--radius-lg);
                border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                box-shadow: 0 16px 40px rgba(0, 0, 0, 0.35);
            }

            .fullscreen-tip-title {
                margin: 0 0 8px;
                font-size: 1.1rem;
                font-weight: 700;
                line-height: 1.3;
            }

            .fullscreen-tip-body {
                margin: 0;
                font-size: 0.95rem;
                line-height: 1.5;
                color: var(--color-text-secondary, var(--color-text-primary));
            }

            .fullscreen-tip-body + .fullscreen-tip-body {
                margin-top: 8px;
            }

            .fullscreen-tip-check {
                display: flex;
                align-items: flex-start;
                gap: 10px;
                margin: 16px 0 18px;
                font-size: 0.9rem;
                line-height: 1.35;
                color: var(--color-text-primary);
                cursor: pointer;
                user-select: none;
            }

            .fullscreen-tip-check input {
                margin: 2px 0 0;
                flex: 0 0 auto;
            }

            .fullscreen-tip-actions {
                display: flex;
                justify-content: flex-end;
            }

            .fullscreen-tip-actions .primary-button {
                min-width: 96px;
            }

            @media (pointer: coarse), (hover: none) {
                .iframe-overlay:fullscreen .iframe-fs-exit,
                .iframe-overlay.is-fullscreen .iframe-fs-exit {
                    display: inline-flex;
                    align-items: center;
                    justify-content: center;
                    position: absolute;
                    left: 50%;
                    bottom: max(12px, env(safe-area-inset-bottom, 0px));
                    transform: translateX(-50%);
                    z-index: 5;
                    min-height: 40px;
                    padding: 8px 16px;
                    border: none;
                    border-radius: 999px;
                    background: rgba(12, 16, 28, 0.78);
                    color: #f4f6fb;
                    font: inherit;
                    font-size: 0.92rem;
                    font-weight: 600;
                    cursor: pointer;
                    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.35);
                    backdrop-filter: blur(6px);
                }

                .iframe-overlay:fullscreen .iframe-fs-exit:hover,
                .iframe-overlay.is-fullscreen .iframe-fs-exit:hover,
                .iframe-overlay:fullscreen .iframe-fs-exit:focus-visible,
                .iframe-overlay.is-fullscreen .iframe-fs-exit:focus-visible {
                    background: rgba(12, 16, 28, 0.92);
                    outline: none;
                }

                .iframe-overlay:fullscreen .iframe-fs-exit:focus-visible,
                .iframe-overlay.is-fullscreen .iframe-fs-exit:focus-visible {
                    outline: 2px solid var(--color-focus, #8eb6ff);
                    outline-offset: 2px;
                }
            }

            :host-context([data-theme='dark']) .iframe-header {
                background: color-mix(in srgb, var(--color-primary) 72%, #000);
                border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
            }

            .iframe-title-group {
                display: flex;
                align-items: center;
                gap: 6px;
                min-width: 0;
                flex: 1;
            }

            .iframe-title {
                min-width: 0;
                font-size: 1rem;
                font-weight: 600;
                overflow: hidden;
                text-overflow: ellipsis;
                white-space: nowrap;
            }

            .iframe-more {
                position: relative;
                flex-shrink: 0;
            }

            .iframe-more-backdrop {
                position: absolute;
                inset: 0;
                z-index: 2;
                background: transparent;
            }

            .iframe-more-button {
                border: none;
                border-radius: var(--radius-md);
                background: transparent;
                color: inherit;
                width: 32px;
                height: 32px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                opacity: 0.82;
            }

            .iframe-more-button:hover,
            .iframe-more-button:focus-visible,
            .iframe-more-button[aria-expanded='true'] {
                opacity: 1;
                background: color-mix(in srgb, var(--color-on-primary) 16%, transparent);
            }

            .iframe-more-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-on-primary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .iframe-more-button:disabled {
                opacity: 0.45;
                cursor: not-allowed;
            }

            .iframe-more-button svg {
                width: 18px;
                height: 18px;
                display: block;
            }

            .iframe-more-menu {
                position: absolute;
                top: calc(100% + 6px);
                left: 0;
                z-index: 4;
                min-width: 190px;
                padding: 4px;
                border: 1px solid color-mix(in srgb, var(--color-border) 70%, transparent);
                border-radius: var(--radius-md);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                box-shadow: 0 10px 28px rgba(0, 0, 0, 0.28);
            }

            .iframe-more-item {
                display: block;
                width: 100%;
                border: none;
                border-radius: var(--radius-sm);
                background: transparent;
                color: inherit;
                font: inherit;
                font-size: 0.92rem;
                text-align: left;
                padding: 8px 10px;
                cursor: pointer;
            }

            .iframe-more-item:hover,
            .iframe-more-item:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 14%, transparent);
                outline: none;
            }

            .iframe-more-item:disabled {
                opacity: 0.5;
                cursor: not-allowed;
            }

            .iframe-header-actions {
                display: flex;
                flex-shrink: 0;
                gap: 10px;
                align-items: center;
            }

            .iframe-header .secondary-button {
                background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
                color: var(--color-primary);
                border-color: color-mix(in srgb, #c5cce6 45%, var(--color-border));
            }

            .iframe-header .secondary-button:hover:not(:disabled) {
                background: color-mix(in srgb, #c5cce6 80%, #6b8cff);
                color: var(--color-primary);
            }

            .iframe-header .primary-button {
                background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
                color: var(--color-primary);
                border-color: color-mix(in srgb, #c5cce6 45%, var(--color-border));
            }

            .iframe-header .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, #c5cce6 80%, #6b8cff);
                color: var(--color-primary);
            }

            :host-context([data-theme='light']) .iframe-header .secondary-button {
                background: var(--color-secondary);
                color: var(--color-on-secondary);
                border-color: var(--color-border);
            }

            :host-context([data-theme='light']) .iframe-header .secondary-button:hover:not(:disabled) {
                background: var(--color-accent);
                color: var(--color-text-primary);
            }

            :host-context([data-theme='light']) .iframe-header .primary-button {
                background: var(--color-background);
                color: var(--color-primary);
                border-color: var(--color-border);
            }

            :host-context([data-theme='light']) .iframe-header .primary-button:hover:not(:disabled) {
                background: var(--color-accent);
                color: var(--color-text-primary);
            }

            .iframe-container {
                flex: 1;
                display: flex;
                position: relative;
                min-height: 0;
                overflow: hidden;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-surface, var(--color-background));
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
            }

            .iframe-overlay:fullscreen .iframe-container,
            .iframe-overlay.is-fullscreen .iframe-container {
                border: none;
                border-radius: 0;
                box-shadow: none;
                background: #090b14;
            }

            .trame-iframe {
                flex: 1;
                border: none;
                background: var(--color-surface, var(--color-background));
                width: 100%;
                height: 100%;
            }

            .iframe-overlay:fullscreen .trame-iframe,
            .iframe-overlay.is-fullscreen .trame-iframe {
                background: #090b14;
            }

            .loading-state {
                flex: 1;
                display: flex;
                align-items: center;
                justify-content: center;
                background: var(--color-surface, var(--color-background));
                text-align: center;
            }

            .loading-state.slicer-gui-splash {
                background: #0c0c14;
            }

            .loading-state.slicer-gui-splash .viewer-loading {
                color: #9aa0b4;
            }

            .loading-state.slicer-gui-splash .viewer-loading p {
                color: #e8e8ef;
                font-size: 1.05rem;
                font-weight: 600;
            }

            .loading-state.slicer-gui-splash .viewer-spinner {
                border-color: #2a2a3a;
                border-top-color: #c7c9d9;
            }

            .loading-state.loading-overlay {
                position: absolute;
                inset: 0;
                z-index: 2;
            }

            .viewer-loading {
                color: var(--color-text-secondary);
            }

            .viewer-loading p {
                margin: 0;
                font-size: 0.95rem;
            }

            .viewer-spinner {
                width: 40px;
                height: 40px;
                border: 4px solid color-mix(in srgb, var(--color-primary) 18%, transparent);
                border-top-color: var(--color-primary);
                border-radius: 50%;
                animation: viewer-spin 0.8s linear infinite;
                margin: 0 auto 16px;
            }

            @keyframes viewer-spin {
                to { transform: rotate(360deg); }
            }

            .files-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 10px;
            }

            .upload-area {
                border: 2px dashed var(--color-border);
                border-radius: var(--radius-md);
                padding: 22px 16px;
                text-align: center;
                background: color-mix(in srgb, var(--color-primary) 6%, var(--color-surface, var(--color-background)));
                transition: border-color 0.2s ease, background-color 0.2s ease;
            }

            .upload-area.drag-over {
                border-color: var(--color-primary);
                background: color-mix(in srgb, var(--color-primary) 12%, var(--color-surface, var(--color-background)));
            }

            .upload-area input[type="file"] {
                display: none;
            }

            .upload-message {
                color: var(--color-text-secondary);
                margin-bottom: 10px;
            }

            .upload-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                min-height: 38px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .upload-button.secondary {
                background: transparent;
                color: var(--color-text-primary);
            }

            .upload-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            .upload-file-info {
                margin-top: 10px;
                color: var(--color-text-secondary);
                font-size: 0.95rem;
            }

            .upload-actions {
                margin-top: 10px;
                display: flex;
                justify-content: center;
                gap: 8px;
            }

            .collaborators-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 0;
            }

            .collaborators-details {
                margin: 0;
            }

            .collaborators-summary {
                cursor: pointer;
                list-style: none;
                padding: 6px 2px;
                margin-bottom: 4px;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .collaborators-summary::-webkit-details-marker {
                display: none;
            }

            .collaborators-summary:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                border-radius: var(--radius-lg);
            }

            .collaborators-chevron {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--color-text-primary);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                transition: transform 0.15s ease, background-color 0.15s ease;
                flex-shrink: 0;
            }

            .collaborators-details[open] .collaborators-chevron {
                transform: rotate(90deg);
            }

            .collaborators-summary:hover .collaborators-chevron,
            .collaborators-summary:focus-visible .collaborators-chevron {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-panel, var(--color-surface, var(--color-background))));
            }

            .collaborators-body {
                margin-top: 8px;
            }

            .collaborators-list {
                display: flex;
                flex-direction: column;
                gap: 8px;
            }

            .collaborator-row {
                border-radius: var(--radius-md);
                padding: 10px 12px;
            }

            .empty-note {
                color: var(--color-text-secondary);
                font-size: 0.95rem;
            }

            .section-actions {
                margin-top: 14px;
                display: flex;
                justify-content: flex-end;
                gap: 12px;
                padding: 2px 0;
            }

            .secondary-button,
            .primary-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                min-height: 40px;
                padding: 8px 14px;
                font: inherit;
                font-weight: 600;
                cursor: pointer;
            }

            .secondary-button {
                background: transparent;
                color: var(--color-text-primary);
            }

            .secondary-button:focus-visible,
            .primary-button:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .primary-button {
                background: var(--color-primary);
                color: var(--color-on-primary);
            }

            .primary-button:hover:not(:disabled) {
                background: color-mix(in srgb, var(--color-primary) 78%, #5b7cff);
            }

            :host-context([data-theme='light']) .primary-button:hover:not(:disabled) {
                background: var(--color-accent);
                color: var(--color-text-primary);
            }

            .primary-button:disabled,
            .secondary-button:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            add-button {
                margin-top: 16px;
            }

            .gpu-panel {
                margin-top: 16px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                padding: 4px 10px 10px;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
            }

            .gpu-panel-header {
                display: flex;
                align-items: center;
                gap: 14px;
                flex-wrap: wrap;
                padding: 2px 0;
            }

            .gpu-panel-details {
                flex: 1;
                min-width: min(220px, 100%);
                margin: 0;
            }

            .gpu-panel summary {
                cursor: pointer;
                list-style: none;
                font-weight: 600;
                color: var(--color-text-primary);
                padding: 10px 2px;
                margin-bottom: 0;
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .gpu-panel details[open] summary {
                margin-bottom: 6px;
            }

            .gpu-panel summary::-webkit-details-marker {
                display: none;
            }

            .gpu-panel-summary-label {
                flex-shrink: 0;
            }

            .gpu-panel-summary-meta {
                flex: 1;
                min-width: 0;
                font-size: 0.85rem;
                font-weight: 500;
                color: var(--color-text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }

            .gpu-panel-chevron {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 20px;
                height: 20px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                font-size: 0.95rem;
                font-weight: 700;
                color: var(--color-text-primary);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                transition: transform 0.15s ease, background-color 0.15s ease;
                flex-shrink: 0;
            }

            .gpu-panel details[open] .gpu-panel-chevron {
                transform: rotate(90deg);
            }

            .gpu-panel summary:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                border-radius: var(--radius-lg);
            }

            .gpu-panel summary:hover .gpu-panel-chevron,
            .gpu-panel summary:focus-visible .gpu-panel-chevron {
                background: color-mix(in srgb, var(--color-primary) 14%, var(--color-panel, var(--color-surface, var(--color-background))));
            }

            .gpu-panel-billing-actions {
                display: flex;
                gap: 8px;
                flex-shrink: 0;
                padding: 4px 0;
                margin-left: 2px;
            }

            .gpu-panel-billing-actions .primary-button,
            .gpu-panel-billing-actions .secondary-button {
                padding: 6px 12px;
                font-size: 0.9rem;
            }

            .gpu-panel-body {
                padding: 6px 2px 4px;
            }

            .gpu-title {
                font-weight: 600;
                color: var(--color-text-primary);
                margin-bottom: 10px;
            }

            .gpu-field {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin-bottom: 12px;
            }

            .gpu-field label {
                font-size: 0.9rem;
                color: var(--color-text-secondary);
            }

            .gpu-field input,
            .gpu-field textarea {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm);
                padding: 8px 10px;
                font: inherit;
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                box-sizing: border-box;
                width: 100%;
                max-width: 100%;
            }

            .gpu-field dropdown-select {
                width: 100%;
                max-width: 100%;
            }

            .gpu-field input:focus-visible,
            .gpu-field textarea:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
                border-color: var(--color-focus, var(--color-primary));
                box-shadow: none;
            }

            .gpu-field textarea {
                min-height: 72px;
                resize: vertical;
            }

            .gpu-status {
                font-size: 0.95rem;
                color: var(--color-text-secondary);
                margin-bottom: 10px;
            }

            .gpu-status-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 8px;
                margin-bottom: 10px;
            }

            .gpu-status-row .gpu-status {
                margin-bottom: 0;
                flex: 1;
                min-width: 0;
            }

            .gpu-info-button {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: transparent;
                color: var(--color-text-secondary);
                width: 32px;
                height: 32px;
                padding: 0;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                cursor: pointer;
                flex-shrink: 0;
            }

            .gpu-info-button:hover,
            .gpu-info-button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
                color: var(--color-text-primary);
            }

            .gpu-info-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .gpu-info-button[aria-expanded="true"] {
                background: color-mix(in srgb, var(--color-primary) 18%, transparent);
                color: var(--color-text-primary);
            }

            .gpu-info-icon {
                width: 18px;
                height: 18px;
            }

            .gpu-details {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                padding: 10px 12px;
                margin-bottom: 10px;
                background: color-mix(in srgb, var(--color-border) 25%, transparent);
            }

            .gpu-detail-row {
                display: grid;
                grid-template-columns: minmax(88px, 34%) 1fr;
                gap: 6px 10px;
                padding: 4px 0;
            }

            .gpu-detail-row + .gpu-detail-row {
                border-top: 1px solid color-mix(in srgb, var(--color-border) 60%, transparent);
            }

            .gpu-detail-label {
                font-weight: 600;
                color: var(--color-text-primary);
            }

            .gpu-detail-value {
                line-height: 1.4;
                word-break: break-word;
            }

            .gpu-detail-value-with-link {
                display: inline-flex;
                align-items: center;
                gap: 6px;
            }

            .gpu-console-link {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                width: 22px;
                height: 22px;
                border-radius: var(--radius-sm);
                color: var(--color-text-secondary);
                text-decoration: none;
                flex-shrink: 0;
            }

            .gpu-console-link:hover,
            .gpu-console-link:focus-visible {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-border) 50%, transparent);
            }

            .gpu-console-link svg {
                width: 16px;
                height: 16px;
            }

            .gpu-status strong {
                color: var(--color-text-primary);
            }

            .gpu-hint {
                font-size: 0.85rem;
                color: var(--color-text-secondary);
                margin-top: 6px;
            }

            .gpu-title-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                margin-bottom: 10px;
                padding-top: 2px;
            }

            .gpu-title-row add-button {
                margin-top: 0;
            }

            .gpu-title-row .gpu-title {
                margin-bottom: 0;
            }

            .gpu-dialog-form {
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-width: min(360px, 100%);
            }

            .gpu-dialog-actions {
                display: flex;
                gap: 8px;
                justify-content: flex-end;
                margin-top: 4px;
            }

            .gpu-dialog-checkbox {
                display: flex;
                align-items: center;
                gap: 8px;
                font-size: 0.9rem;
                color: var(--color-text-secondary);
                cursor: pointer;
            }

            .gpu-dialog-checkbox input {
                margin: 0;
            }

            .gpu-local-option {
                margin-top: 8px;
            }

            .gpu-local-option .gpu-hint {
                margin-top: 4px;
            }

            .share-dialog-overlay {
                position: fixed;
                inset: 0;
                background: rgba(0, 0, 0, 0.45);
                z-index: 1100;
                display: flex;
                align-items: center;
                justify-content: center;
                padding: 16px;
            }

            .share-dialog {
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                color: var(--color-text-primary);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                width: min(520px, 100%);
                padding: 16px;
                box-shadow: 0 8px 30px var(--color-shadow, rgba(0, 0, 0, 0.25));
            }

            .share-dialog h3 {
                margin: 0 0 12px;
            }

            .share-field {
                margin: 10px 0;
            }

            .share-field label {
                display: block;
                margin-bottom: 6px;
                font-size: 0.9rem;
            }

            .share-field input {
                width: 100%;
                box-sizing: border-box;
                min-height: 40px;
                padding: 8px 10px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                background: var(--color-surface, var(--color-background));
                color: var(--color-text-primary);
                font: inherit;
            }

            .share-help {
                margin-top: 6px;
                font-size: 0.8rem;
                color: var(--color-text-secondary);
            }

            .share-dialog-error {
                margin: 8px 0;
                color: var(--color-danger, #b00020);
                font-size: 0.9rem;
            }

            .share-dialog-actions {
                display: flex;
                justify-content: flex-end;
                gap: 8px;
                margin-top: 14px;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            projectId: { type: Number },
            loading: { type: Boolean },
            saving: { type: Boolean },
            toastMessage: { type: String },
            errorAlertTitle: { type: String },
            errorAlertMessage: { type: String },
            projectName: { type: String },
            collaborators: { type: Array },
            originalCollaborators: { type: Array },
            canEditCollaborators: { type: Boolean },
            canUploadFiles: { type: Boolean },
            canDeleteProjectFiles: { type: Boolean },
            projectFiles: { type: Array },
            loadingProjectFiles: { type: Boolean },
            showIframe: { type: Boolean },
            iframeUrl: { type: String },
            viewerKind: { type: String },
            viewerSimplified: { type: Boolean },
            viewerLoading: { type: Boolean },
            viewerLoadingDetail: { type: String },
            viewerFullscreen: { type: Boolean },
            viewerMenuOpen: { type: Boolean },
            launchingFileId: { type: Number },
            currentFileName: { type: String },
            selectedFile: { type: Object },
            uploading: { type: Boolean },
            dragOver: { type: Boolean },
            uploadSuccess: { type: String },
            gpuProviders: { type: Array },
            configuredProviders: { type: Array },
            gpuSettings: { type: Object },
            gpuActiveProviderId: { type: String },
            gpuInstance: { type: Object },
            canManageGpu: { type: Boolean },
            canStartBilling: { type: Boolean },
            canStopBilling: { type: Boolean },
            billingOwnership: { type: Object },
            stopBillingImpact: { type: Object },
            ownerBillingPromptStep: { type: String },
            gpuSaving: { type: Boolean },
            gpuDialogProviderId: { type: String },
            gpuDialogApiKey: { type: String },
            gpuDialogUseNow: { type: Boolean },
            gpuDialogSaving: { type: Boolean },
            gpuBillingBusy: { type: Boolean },
            gpuBillingLease: { type: Object },
            stagedFileIds: { type: Array },
            gpuPrestageActive: { type: Boolean },
            vastGpuMode: { type: String },
            remoteActivity: { type: Object },
            remoteProvision: { type: Object },
            gpuDetailsOpen: { type: Boolean },
            gpuPanelOpen: { type: Boolean },
            collaboratorsPanelOpen: { type: Boolean },
            savingFileTitleId: { type: Number },
            editTitleFileId: { type: Number },
            editTitleDraft: { type: String },
            editTitleOriginalName: { type: String },
            fullscreenTipDontShowAgain: { type: Boolean },
            showFullscreenTip: { type: Boolean },
            showShareDialog: { type: Boolean },
            shareTargetFile: { type: Object },
            shareDurationHours: { type: Number },
            shareAllowedEmails: { type: String },
            shareDialogError: { type: String },
            sharingFileId: { type: Number }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.projectId = null;
        this.loading = false;
        this.saving = false;
        this.toastMessage = '';
        this.errorAlertTitle = '';
        this.errorAlertMessage = '';
        this.projectName = '';
        this.collaborators = [];
        this.originalCollaborators = [];
        this.canEditCollaborators = false;
        this.canUploadFiles = false;
        this.canDeleteProjectFiles = false;
        this.projectFiles = [];
        this.loadingProjectFiles = false;
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerFullscreen = false;
        this.viewerMenuOpen = false;
        this.launchingFileId = null;
        this.currentFileName = '';
        this.selectedFile = null;
        this.uploading = false;
        this.dragOver = false;
        this.uploadSuccess = '';
        this.gpuProviders = [];
        this.configuredProviders = [{ id: 'local', label: 'Local', configured: true }];
        this.gpuSettings = null;
        this.gpuActiveProviderId = 'local';
        this.gpuInstance = null;
        this.canManageGpu = false;
        this.canStartBilling = false;
        this.canStopBilling = false;
        this.billingOwnership = null;
        this.stopBillingImpact = null;
        this.ownerBillingPromptStep = '';
        this._billingReceivedViaTransfer = false;
        this.gpuSaving = false;
        this.gpuDialogProviderId = 'vast';
        this.gpuDialogApiKey = '';
        this.gpuDialogUseNow = true;
        this.gpuDialogSaving = false;
        this.gpuBillingBusy = false;
        this.gpuBillingLease = null;
        this.stagedFileIds = [];
        this.gpuPrestageActive = false;
        this.vastGpuMode = null;
        this.remoteActivity = null;
        this.remoteProvision = null;
        this.gpuDetailsOpen = false;
        this.gpuPanelOpen = false;
        this.collaboratorsPanelOpen = false;
        this.savingFileTitleId = null;
        this.editTitleFileId = null;
        this.editTitleDraft = '';
        this.editTitleOriginalName = '';
        this.fullscreenTipDontShowAgain = false;
        this.showFullscreenTip = false;
        this.showShareDialog = false;
        this.shareTargetFile = null;
        this.shareDurationHours = 72;
        this.shareAllowedEmails = '';
        this.shareDialogError = '';
        this.sharingFileId = null;
        this._prestageHoverTimer = null;
        this._autoPrestageDone = false;
        this._fullSlicerWarmPromise = null;
        this.toastTimeout = null;
        this._lastErrorAlertKey = '';
        this._errorAlertKind = null;
        this._trameHeartbeatInterval = null;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this._gpuPollInterval = null;
        this._gpuBillingHeartbeatInterval = null;
    }

    updated(changedProperties) {
        if (changedProperties.has('projectId') && this.projectId) {
            this.loadProject();
            return;
        }
        if (changedProperties.has('gpuSettings') || changedProperties.has('configuredProviders')) {
            this.syncGpuProviderSelect();
        }
        if (changedProperties.has('loading') && !this.loading) {
            this.syncGpuProviderSelect();
        }
    }

    applyGpuSettings(settings) {
        this.gpuSettings = settings;
        this.gpuActiveProviderId = settings?.providerId || 'local';
    }

    connectedCallback() {
        super.connectedCallback();
        installViewerActivityListeners();
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this._handleBeforeUnload = () => {
            if (!this.showIframe || !this._viewerSessionToken) return;
            const kind = this.viewerKind || VIEWER_KINDS.TRAME;
            const { stopUrl } = getViewerSessionEndpoints({
                kind,
                projectId: this.projectId
            });
            stopViewerSession({
                stopUrl,
                sessionToken: this._viewerSessionToken,
                body: buildViewerStopBody({
                    kind,
                    sessionToken: this._viewerSessionToken,
                    projectId: this.projectId,
                    seatId: this._viewerSeatId,
                    // Soft-park Full Slicer so refresh/reopen can reuse the warm seat.
                    mode: defaultReleaseModeForClose(kind)
                }),
                keepalive: true
            });
        };
        window.addEventListener('beforeunload', this._handleBeforeUnload);
        this.attachViewerFullscreenListener();
    }

    disconnectedCallback() {
        window.removeEventListener('beforeunload', this._handleBeforeUnload);
        this._handleBeforeUnload = null;
        this.detachViewerFullscreenListener();
        this.stopTrameHeartbeat();
        this.stopGpuBillingHeartbeat();
        this.stopGpuPolling();
        const hadViewer = this.showIframe || (this.iframeUrl && this.iframeUrl !== 'about:blank');
        const projectId = this.projectId;
        const viewerKind = this.viewerKind || VIEWER_KINDS.TRAME;
        const sessionToken = this._viewerSessionToken;
        const seatId = this._viewerSeatId;
        if (hadViewer && projectId) {
            scheduleViewerStopOnLeave(projectId, () => {
                this.cleanupContainerSession(projectId, {
                    kind: viewerKind,
                    sessionToken,
                    seatId,
                    mode: defaultReleaseModeForClose(viewerKind)
                });
            });
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this.currentFileName = '';
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
            this.toastTimeout = null;
        }
        super.disconnectedCallback();
    }

    showToast(message) {
        this.toastMessage = message || '';
        if (this.toastTimeout) {
            clearTimeout(this.toastTimeout);
        }
        this.toastTimeout = setTimeout(() => {
            this.toastMessage = '';
            this.toastTimeout = null;
        }, 3000);
    }

    showErrorAlert(message, { title = null, force = false, kind = null } = {}) {
        const resolvedTitle = title || t('common.somethingWentWrong');
        const text = String(message || '').trim();
        if (!text) return;

        const key = `${resolvedTitle}\0${text}`;
        if (!force && key === this._lastErrorAlertKey) {
            return;
        }
        this._lastErrorAlertKey = key;
        this.errorAlertTitle = resolvedTitle;
        this.errorAlertMessage = text;
        this._errorAlertKind = kind;
        this.requestUpdate();
        queueMicrotask(() => {
            this.renderRoot?.querySelector('#error-alert-dialog')?.openDialog();
        });
    }

    gpuErrorTitle(errorSource, message) {
        if (errorSource === 'vast' || String(message || '').startsWith('Vast.ai: ')) {
            return 'Problem on Vast.ai';
        }
        return 'GPU problem in Slicer Web';
    }

    showGpuErrorAlert(message, errorSource = null) {
        this.showErrorAlert(message, {
            title: this.gpuErrorTitle(errorSource, message),
            kind: 'gpu',
            force: true
        });
    }

    get shouldCleanupGpuOnErrorDismiss() {
        if (this._errorAlertKind !== 'gpu' || !this.canManageGpu) return false;
        return this.gpuInstance?.status === 'error' && !!this.gpuInstance?.instanceId;
    }

    get errorAlertDismissLabel() {
        if (this._errorAlertKind === 'gpu' && this.gpuInstance?.instanceId) {
            return 'OK — remove instance';
        }
        if (this._errorAlertKind === 'gpu') {
            return 'OK — dismiss';
        }
        return 'OK';
    }

    async dismissErrorAlert() {
        const cleanupGpu = this.shouldCleanupGpuOnErrorDismiss;

        this.renderRoot?.querySelector('#error-alert-dialog')?.closeDialog();
        this.errorAlertMessage = '';
        this.errorAlertTitle = '';
        this._errorAlertKind = null;

        if (!cleanupGpu) return;

        this.gpuBillingBusy = true;
        try {
            const data = await acknowledgeProjectGpuError(this.projectId);
            this.gpuInstance = data.instance || this.gpuInstance;
            this.remoteProvision = null;
            this.clearErrorAlertDedupe();
            if (data.status === 'stopping') {
                this.showToast(t('common.working'));
                this.maybeStartGpuPolling();
            } else {
                this.showToast(t('gpu.statusIdle'));
            }
            await this.loadProjectGpu();
        } catch (error) {
            this.showErrorAlert(error.message || 'Could not remove the GPU instance.', {
                title: 'GPU cleanup',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    clearErrorAlertDedupe() {
        this._lastErrorAlertKey = '';
    }

    pickGpuStatusError(data, prevStatus) {
        if (data.settings?.credentialsUnreadable) {
            return 'Saved GPU API key could not be read. Re-enter your Vast API key and save.';
        }
        if (data.remoteProvision?.failure) {
            return `Vast.ai: ${data.remoteProvision.failure}`;
        }
        if (data.reconcileChanged && (data.reconcileReason || data.instance?.errorMessage)) {
            return data.reconcileReason || data.instance.errorMessage;
        }
        if (data.instance?.status === 'error' && data.instance?.errorMessage) {
            if (prevStatus !== 'error' || data.reconcileChanged) {
                return data.instance.errorMessage;
            }
        }
        return '';
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    handleBackToProjects() {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: {
                selectedKey: 'my-projects',
                item: { key: 'my-projects', label: 'My Projects' }
            },
            bubbles: true,
            composed: true
        }));
    }

    collaboratorSnapshot(collaborators) {
        return collaborators
            .map((entry) => ({
                userId: Number(entry.user?.id),
                role: entry.role
            }))
            .filter((entry) => Number.isInteger(entry.userId) && entry.userId > 0 && typeof entry.role === 'string')
            .sort((a, b) => a.userId - b.userId);
    }

    getRoleSortValue(role) {
        if (role === 'admin') return 0;
        if (role === 'collaborator') return 1;
        return 2;
    }

    sortCollaborators(collaborators = []) {
        return [...collaborators].sort((a, b) => {
            const roleDiff = this.getRoleSortValue(a.role) - this.getRoleSortValue(b.role);
            if (roleDiff !== 0) return roleDiff;
            const userA = (a.user?.username || '').toLowerCase();
            const userB = (b.user?.username || '').toLowerCase();
            return userA.localeCompare(userB);
        });
    }

    get hasPendingCollaboratorChanges() {
        const current = this.collaboratorSnapshot(this.collaborators);
        const original = this.collaboratorSnapshot(this.originalCollaborators);
        return JSON.stringify(current) !== JSON.stringify(original);
    }

    async loadProject() {
        this.loading = true;
        this.toastMessage = '';
        try {
            const data = await getProjectById(this.projectId);
            this.projectName = data.project?.name || '';
            const role = data.project?.role;
            this.canEditCollaborators = role === 'admin';
            this.canUploadFiles = role === 'admin' || role === 'collaborator';
            this.canDeleteProjectFiles = role === 'admin' || role === 'collaborator';
            const collaborators = data.collaborators || [];
            this.collaborators = this.sortCollaborators(collaborators.map((entry) => ({ ...entry })));
            this.originalCollaborators = this.sortCollaborators(collaborators.map((entry) => ({ ...entry })));
            await Promise.all([this.loadProjectFiles(), this.loadProjectGpu()]);
            this.maybeWarmLocalFullSlicer();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to load project.', {
                title: 'Unable to load project',
                force: true
            });
            this.projectName = '';
            this.collaborators = [];
            this.originalCollaborators = [];
            this.canEditCollaborators = false;
            this.canUploadFiles = false;
            this.canDeleteProjectFiles = false;
            this.projectFiles = [];
        } finally {
            this.loading = false;
        }
    }

    formatDate(dateString) {
        if (!dateString) return '';
        return new Date(dateString).toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    }

    formatBytes(bytes) {
        if (!bytes) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
    }

    formatProjectFileMetaLine(file) {
        const modifiedAt = file.lastModifiedAt || file.uploadDate;
        const parts = [
            this.formatBytes(file.size),
            `Modified ${this.formatDate(modifiedAt)}`
        ];
        if (file.lastViewedAt) {
            parts.push(`Viewed ${this.formatDate(file.lastViewedAt)}`);
        }
        return parts.join(' · ');
    }

    isMrbFile(file) {
        const name = String(file?.originalName || '').toLowerCase();
        return name.endsWith('.mrb');
    }

    defaultDisplayTitleForFile(file) {
        const rawName = String(file?.originalName || '');
        const noExtension = rawName.replace(/\.mrb$/i, '');
        const cleaned = noExtension.replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim();
        return cleaned || rawName || 'Untitled';
    }

    displayTitleForFile(file) {
        if (!this.isMrbFile(file)) return file.originalName;
        const explicit = String(file.displayTitle || '').trim();
        return explicit || this.defaultDisplayTitleForFile(file);
    }

    isFileStagedOnGpu(file) {
        return (this.stagedFileIds || []).includes(file.id);
    }

    isRemoteGpuRunning() {
        if (this.savedGpuProviderId === 'local') return false;
        return this.gpuInstance?.status === 'running';
    }

    usesRemoteGpuProvider() {
        return this.savedGpuProviderId !== 'local';
    }

    syncConfiguredProvidersFromSettings(settings) {
        const providers = settings?.configuredProviders;
        if (Array.isArray(providers) && providers.length) {
            this.configuredProviders = providers.map((entry) => ({ ...entry }));
            return;
        }
        this.configuredProviders = [{ id: 'local', label: 'Local', configured: true, isDefault: true }];
    }

    ensureConfiguredProviderListed(providerId) {
        if (providerId === 'local' || this.isGpuProviderConfigured(providerId)) {
            return;
        }
        const meta = this.gpuProviders.find((provider) => provider.id === providerId);
        if (!meta) return;
        this.configuredProviders = [
            ...this.configuredProviders,
            { id: providerId, label: meta.label, configured: true }
        ];
    }

    syncGpuProviderSelect() {
        if (this.loading || !this.gpuSettings) return;
        const value = this.gpuActiveProviderId || this.savedGpuProviderId;
        const apply = () => {
            const select = this.renderRoot?.querySelector('#gpu-provider');
            if (!select) return;
            if (select.value !== value) {
                select.value = value;
            }
        };
        if (typeof requestAnimationFrame === 'function') {
            requestAnimationFrame(apply);
        } else {
            apply();
        }
    }

    async handleGpuProviderChange(event) {
        const next = event.target.value;
        const prev = this.savedGpuProviderId;
        if (next === prev) return;

        if (next === 'local') {
            this.gpuDetailsOpen = false;
            this.stopGpuBillingHeartbeat();
        }
        await this.persistActiveGpuProvider(next);
    }

    async persistActiveGpuProvider(providerId) {
        if (!this.canManageGpu) return;

        this.gpuSaving = true;
        try {
            const data = await setActiveProjectGpuProvider(this.projectId, providerId);
            this.applyGpuSettings(data.settings);
            this.syncConfiguredProvidersFromSettings(data.settings);
            this.syncGpuProviderSelect();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to switch GPU provider.', {
                title: 'GPU settings',
                force: true
            });
            this.requestUpdate();
        } finally {
            this.gpuSaving = false;
        }
    }

    async handleLaunchFullSlicer(file) {
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        // Keep the warm seat attached when switching files — soft-park between
        // opens races the new stage request and can leave the loader waiting forever.
        const switchingInPlace = this.showIframe
            && this.viewerKind === VIEWER_KINDS.SLICER_GUI
            && !!this._viewerSessionToken;
        if (this.showIframe && !switchingInPlace) {
            await this.closeIframe();
        } else if (switchingInPlace) {
            this.stopTrameHeartbeat();
            if (this._viewerIframeActivityCleanup) {
                this._viewerIframeActivityCleanup();
                this._viewerIframeActivityCleanup = null;
            }
        }

        try {
            await fetchUserPreferences();
        } catch (_) {
            /* use cached prefs if refresh fails */
        }

        const simplified = this.useLocalSimplifiedViewer;
        const label = this.savedGpuProviderId === 'vast'
            ? 'Full Slicer (Vast)'
            : viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified });
        const sceneTitle = this.displayTitleForFile(file);
        this.currentFileName = sceneTitle;
        this.launchingFileId = file.id;
        this.viewerKind = VIEWER_KINDS.SLICER_GUI;
        this.viewerSimplified = simplified;
        this.viewerLoading = true;
        this.viewerLoadingDetail = switchingInPlace
            ? `Switching to ${sceneTitle}…`
            : (this.savedGpuProviderId === 'vast'
                ? `Copying ${sceneTitle} to Vast Full Slicer…`
                : `Starting ${label} for ${sceneTitle}…`);
        this.showIframe = true;
        // Blank only when replacing an open VNC (avoids about:blank on fresh open).
        if (switchingInPlace) {
            this.iframeUrl = 'about:blank';
        }

        try {
            this.stopTrameHeartbeat();
            const data = await openFullSlicerViewer(this.projectId, file.id, {
                useSimplifiedViewer: simplified,
                // Stick to this seat when switching files in the same overlay.
                ...(switchingInPlace && this._viewerSeatId
                    ? { seatId: this._viewerSeatId }
                    : {})
            });

            this._viewerSessionToken = data.sessionToken || null;
            this._viewerSeatId = data.seatId != null ? Number(data.seatId) : null;
            this.viewerSimplified = data.useSimplifiedViewer === true;
            this.currentFileName = sceneTitle;

            // Quick splash only when this scene is already warm in the seat.
            const quickReconnect = data.sessionReused === true && data.sceneReloaded === false;
            const url = buildSlicerGuiLoaderUrl({
                projectId: this.projectId,
                fileId: file.id,
                fileName: sceneTitle,
                vncPath: data.vncPath || data.slicerGuiUrl || '',
                sessionToken: this._viewerSessionToken,
                seatId: this._viewerSeatId,
                simplified: this.viewerSimplified,
                embed: true,
                quick: quickReconnect
            });

            this.viewerLoadingDetail = quickReconnect
                ? `Reconnecting to ${sceneTitle}…`
                : (data.sessionReused
                    ? `Loading ${sceneTitle}…`
                    : `Loading ${sceneTitle}… First launch can take 1–2 minutes.`);
            this.iframeUrl = url;
            markViewerActivity();
            this.showToast(t('files.launchedIn', { title: sceneTitle, viewer: viewerDisplayName(VIEWER_KINDS.SLICER_GUI, { simplified: this.viewerSimplified }) }));
            this.startTrameHeartbeat();
        } catch (error) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerKind = VIEWER_KINDS.TRAME;
            this.viewerSimplified = false;
            this.currentFileName = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this._viewerSessionToken = null;
            this._viewerSeatId = null;
            this.showErrorAlert(error.message || 'Unable to open Full Slicer.', {
                title: 'Unable to open file',
                force: true
            });
        }
    }

    get gpuDialogProviderOptions() {
        return (this.gpuProviders || []).filter((provider) => provider.id !== 'local');
    }

    isGpuProviderConfigured(providerId) {
        return (this.configuredProviders || []).some(
            (entry) => entry.id === providerId && entry.configured
        );
    }

    get gpuDialogApiKeyPlaceholder() {
        const entry = (this.configuredProviders || []).find((p) => p.id === this.gpuDialogProviderId);
        if (entry?.apiKeyMasked) {
            return `Saved (${entry.apiKeyMasked}) — leave blank to keep`;
        }
        return 'Paste API key';
    }

    updateGpuDialogUseNowCheckbox() {
        const providerId = this.gpuDialogProviderId;
        const isNew = !this.isGpuProviderConfigured(providerId);
        const isActive = (this.gpuActiveProviderId || 'local') === providerId;
        // New providers default to Use now; reconfigure keeps checked only if already active.
        this.gpuDialogUseNow = isNew || isActive;
    }

    openGpuProviderDialog(providerId = null) {
        if (!this.canManageGpu) return;
        const options = this.gpuDialogProviderOptions;
        const unconfigured = options.find((provider) => !this.isGpuProviderConfigured(provider.id));
        this.gpuDialogProviderId = providerId
            || unconfigured?.id
            || this.gpuActiveProviderId
            || options[0]?.id
            || 'vast';
        this.gpuDialogApiKey = '';
        this.updateGpuDialogUseNowCheckbox();
        this.renderRoot?.querySelector('#gpu-provider-dialog')?.openDialog();
    }

    get gpuProviderDialogTitle() {
        return this.isGpuProviderConfigured(this.gpuDialogProviderId)
            ? 'Configure GPU Provider'
            : 'Add GPU Provider';
    }

    closeGpuProviderDialog() {
        this.renderRoot?.querySelector('#gpu-provider-dialog')?.closeDialog();
    }

    handleGpuDialogProviderChange(event) {
        this.gpuDialogProviderId = event.target.value;
        this.gpuDialogApiKey = '';
        this.updateGpuDialogUseNowCheckbox();
    }

    handleGpuDialogUseNowChange(event) {
        this.gpuDialogUseNow = event.target.checked;
    }

    handleGpuDialogApiKeyInput(event) {
        this.gpuDialogApiKey = event.target.value;
    }

    async handleSaveGpuProviderDialog() {
        if (!this.canManageGpu || this.gpuDialogSaving) return;

        const providerId = this.gpuDialogProviderId;
        const configured = this.isGpuProviderConfigured(providerId);
        if (!this.gpuDialogApiKey.trim() && !configured) {
            this.showErrorAlert('API key is required for this provider.', {
                title: 'GPU provider',
                force: true
            });
            return;
        }

        this.gpuDialogSaving = true;
        try {
            const payload = {
                providerId,
                useNow: this.gpuDialogUseNow
            };
            if (this.gpuDialogApiKey.trim()) {
                payload.apiKey = this.gpuDialogApiKey.trim();
            }
            const data = await configureProjectGpuProvider(this.projectId, payload);
            this.applyGpuSettings(data.settings);
            this.syncConfiguredProvidersFromSettings(data.settings);
            this.ensureConfiguredProviderListed(providerId);
            this.gpuDialogApiKey = '';
            this.closeGpuProviderDialog();
            this.showToast(
                this.gpuDialogUseNow
                    ? 'GPU provider saved and selected for Using now.'
                    : 'GPU provider saved.'
            );
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to save GPU provider.', {
                title: 'GPU provider',
                force: true
            });
        } finally {
            this.gpuDialogSaving = false;
        }
    }

    getRemoteGpuLaunchBlockMessage() {
        if (this.gpuSaving) {
            return t('gpu.updating');
        }
        if (!this.projectId || !this.usesRemoteGpuProvider()) return null;
        if (this.isRemoteGpuRunning()) return null;

        const status = this.gpuInstance?.status || 'idle';
        if (status === 'provisioning') {
            return t('gpu.startInProgress');
        }
        if (status === 'stopping') {
            return t('gpu.shutdownInProgress');
        }
        if (status === 'error') {
            return this.gpuInstance?.errorMessage
                || t('gpu.billingUnavailable');
        }
        if (!this.canManageGpu) {
            return t('gpu.billingNotRunning');
        }
        return t('gpu.startBillingFirst');
    }

    getFileLaunchTitle(file) {
        // Kept for later revisit (e.g. hover filename / launch hints). Not shown in UI now.
        if (this.launchingFileId === file.id) return 'Opening…';
        const block = this.getRemoteGpuLaunchBlockMessage();
        if (block) return block;
        const originalName = file.originalName || 'file';
        return `Open file (${originalName})`;
    }

    parseApiErrorMessage(data, fallback) {
        if (typeof data?.error === 'string') return data.error;
        if (data?.error?.message) return data.error.message;
        if (typeof data?.message === 'string') return data.message;
        return fallback;
    }

    maybePrestageRecentFiles() {
        if (!this.isRemoteGpuRunning()) {
            this._autoPrestageDone = false;
            return;
        }
        if (this._autoPrestageDone || this.gpuPrestageActive) return;
        this._autoPrestageDone = true;
        prestageProjectGpu(this.projectId)
            .then((data) => {
                this.stagedFileIds = data.stagedFileIds || this.stagedFileIds;
                this.gpuPrestageActive = false;
            })
            .catch(() => {
                this._autoPrestageDone = false;
            });
    }

    /**
     * Background-warm the local Full Slicer seat so the first Open skips cold boot.
     * Safe to call repeatedly; no-ops when not using local Full Slicer or when a viewer is open.
     */
    maybeWarmLocalFullSlicer() {
        if (!this.projectId || this.showIframe || !this.useLocalFullSlicer) {
            return;
        }
        if (this._fullSlicerWarmPromise) {
            return;
        }
        const simplified = this.useLocalSimplifiedViewer;
        this._fullSlicerWarmPromise = prepareFullSlicerViewer(this.projectId, {
            useSimplifiedViewer: simplified
        })
            .catch(() => {
                /* warm is best-effort */
            })
            .finally(() => {
                this._fullSlicerWarmPromise = null;
            });
    }

    handleFileHover(file) {
        if (!this.isRemoteGpuRunning()) return;
        if (this.isFileStagedOnGpu(file)) return;
        clearTimeout(this._prestageHoverTimer);
        this._prestageHoverTimer = setTimeout(() => {
            prestageProjectGpu(this.projectId, { fileIds: [file.id] })
                .then((data) => {
                    this.stagedFileIds = data.stagedFileIds || this.stagedFileIds;
                })
                .catch(() => {});
        }, 100);
    }

    handleFileSelect(event) {
        this.selectedFile = event.target.files?.[0] || null;
    }

    handleDragOver(event) {
        event.preventDefault();
        this.dragOver = true;
    }

    handleDragLeave(event) {
        event.preventDefault();
        this.dragOver = false;
    }

    handleDrop(event) {
        event.preventDefault();
        this.dragOver = false;
        const files = event.dataTransfer?.files;
        if (files?.length > 0) {
            this.selectedFile = files[0];
        }
    }

    async loadProjectFiles() {
        if (!this.projectId) {
            this.projectFiles = [];
            return;
        }
        this.loadingProjectFiles = true;
        try {
            const data = await listProjectFiles(this.projectId);
            this.projectFiles = data.files || [];
        } catch (error) {
            this.projectFiles = [];
        } finally {
            this.loadingProjectFiles = false;
        }
    }

    openFileUploadDialog() {
        if (!this.canUploadFiles) return;
        this.selectedFile = null;
        this.dragOver = false;
        const input = this.renderRoot?.querySelector('#project-upload-input');
        if (input) input.value = '';
        this.renderRoot?.querySelector('#file-upload-dialog')?.openDialog();
    }

    closeFileUploadDialog() {
        this.renderRoot?.querySelector('#file-upload-dialog')?.closeDialog();
    }

    async uploadFileToProject() {
        if (!this.selectedFile || !this.canUploadFiles || !this.projectId) {
            this.showErrorAlert('Please choose a file.', { title: 'Upload file', force: true });
            return;
        }

        this.uploading = true;

        try {
            const formData = new FormData();
            formData.append('file', this.selectedFile);
            formData.append('projectId', String(this.projectId));

            const response = await fetch(`${API_URL}/api/files/upload`, {
                method: 'POST',
                credentials: 'include',
                body: formData
            });

            const data = await response.json();
            if (response.ok) {
                this.showToast(t('files.uploadFile'));
                this.selectedFile = null;
                const input = this.renderRoot?.querySelector('#project-upload-input');
                if (input) input.value = '';
                await this.loadProjectFiles();
                this.closeFileUploadDialog();
                return;
            }

            let errorMsg = 'Upload failed';
            if (typeof data.error === 'string') {
                errorMsg = data.error;
            } else if (data.error?.message) {
                errorMsg = data.error.message;
            } else if (data.message) {
                errorMsg = data.message;
            } else if (response.statusText) {
                errorMsg = `Upload failed: ${response.statusText}`;
            }
            this.showErrorAlert(errorMsg, { title: 'Upload failed', force: true });
        } catch (error) {
            this.showErrorAlert(error.message || 'Network error during upload', {
                title: 'Upload failed',
                force: true
            });
        } finally {
            this.uploading = false;
        }
    }

    async loadProjectGpu() {
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        const prevStatus = this.gpuInstance?.status;
        const prevProviderId = this.gpuSettings ? this.savedGpuProviderId : null;
        try {
            const providerData = await listGpuProviders();
            this.gpuProviders = providerData.providers || [];
            const data = await getProjectGpu(this.projectId);
            this.applyGpuSettings(data.settings);
            this.gpuInstance = data.instance;
            this.gpuBillingLease = data.billingLease || null;
            this.stagedFileIds = data.stagedFileIds || [];
            this.gpuPrestageActive = !!data.prestageActive;
            this.vastGpuMode = data.vastGpuMode || null;
            this.remoteActivity = data.remoteActivity || null;
            this.remoteProvision = data.remoteProvision || null;
            if (data.billingLease?.viewerLeaveGraceMinutes) {
                window.__GPU_VIEWER_LEAVE_GRACE_MINUTES__ = data.billingLease.viewerLeaveGraceMinutes;
            }
            if (data.billingLease?.viewerSessionTtlMinutes) {
                setViewerIdleMs(data.billingLease.viewerSessionTtlMinutes * 60 * 1000);
            }
            this.canManageGpu = !!data.canManage;
            this.canStartBilling = !!data.canStartBilling;
            this.canStopBilling = !!data.canStopBilling;
            this.applyBillingOwnership(data.billingOwnership, { announce: true });
            this.syncConfiguredProvidersFromSettings(data.settings);

            this.syncGpuProviderSelect();

            const nextProviderId = this.savedGpuProviderId;
            if (
                prevProviderId
                && nextProviderId
                && prevProviderId !== nextProviderId
            ) {
                const label = (this.configuredProviders.find((p) => p.id === nextProviderId) || {}).label
                    || nextProviderId;
                this.showToast(t('gpu.providerSwitched', { label }));
            }

            const gpuErr = this.pickGpuStatusError(data, prevStatus);
            if (gpuErr) {
                this.showGpuErrorAlert(gpuErr, data.instance?.errorSource);
            } else if (prevStatus === 'error' && data.instance?.status !== 'error') {
                this.clearErrorAlertDedupe();
            }

            this.maybeStartGpuPolling();
            this.maybeStartGpuBillingHeartbeat();
            this.maybePrestageRecentFiles();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to load GPU settings.', {
                title: 'GPU problem'
            });
        }
    }

    stopGpuPolling() {
        if (this._gpuPollInterval) {
            clearInterval(this._gpuPollInterval);
            this._gpuPollInterval = null;
        }
    }

    maybeStartGpuPolling() {
        this.stopGpuPolling();
        if (!this.projectId) return;

        const providerId = this.savedGpuProviderId || 'local';
        const status = this.gpuInstance?.status || 'idle';
        // Always poll on the project page so collaborator provider/billing changes show up
        // without a hard refresh (including Local → Vast).
        const intervalMs = ['provisioning', 'stopping'].includes(status)
            ? 5000
            : (providerId !== 'local' && status === 'running')
                ? 20000
                : 12000;
        this._gpuPollInterval = setInterval(() => {
            this.loadProjectGpu().catch(() => {});
        }, intervalMs);
    }

    stopGpuBillingHeartbeat() {
        if (this._gpuBillingHeartbeatInterval) {
            clearInterval(this._gpuBillingHeartbeatInterval);
            this._gpuBillingHeartbeatInterval = null;
        }
    }

    maybeStartGpuBillingHeartbeat() {
        this.stopGpuBillingHeartbeat();
        const isRemoteRunning = this.gpuInstance?.status === 'running'
            && this.savedGpuProviderId !== 'local';
        if (!isRemoteRunning) return;

        const ping = () => {
            const viewerOpen = this.showIframe && !!this.iframeUrl && this.iframeUrl !== 'about:blank';
            const viewerActive = viewerOpen && isViewerUserActive();
            sendProjectGpuHeartbeat(this.projectId, { viewerActive })
                .then((data) => {
                    if (data.billingOwnership) {
                        this.applyBillingOwnership(data.billingOwnership);
                    }
                    if (data.ownershipTransferred && data.billingOwnership?.youOwnBilling) {
                        this._billingReceivedViaTransfer = true;
                        this.showToast(t('gpu.billingStillActive'));
                    }
                    if (data.billingStopped) {
                        this.gpuInstance = data.instance || this.gpuInstance;
                        this.gpuBillingLease = null;
                        this.canStopBilling = false;
                        this.showErrorAlert(
                            this.formatGpuSessionEndedMessage(data.reason || data.instance?.errorMessage),
                            { title: 'GPU session ended', force: true }
                        );
                        this.stopGpuBillingHeartbeat();
                        this.stopGpuPolling();
                        return;
                    }
                    if (data.remoteActivity) {
                        this.remoteActivity = data.remoteActivity;
                    }
                    if (data.billingLease) {
                        this.gpuBillingLease = data.billingLease;
                    }
                })
                .catch((error) => {
                    if (error.status === 404) {
                        this.stopGpuBillingHeartbeat();
                        this.loadProjectGpu().catch(() => {});
                    }
                });
        };
        ping();
        this._gpuBillingHeartbeatInterval = setInterval(ping, 60000);
    }

    formatBillingTime(iso) {
        if (!iso) return '';
        try {
            return new Date(iso).toLocaleString();
        } catch (_) {
            return iso;
        }
    }

    /** Persisted provider from the server — gates file open and billing. */
    get savedGpuProviderId() {
        return this.gpuActiveProviderId || this.gpuSettings?.providerId || 'local';
    }

    get useLocalFullSlicer() {
        return this.savedGpuProviderId === 'local'
            && getCachedLocalSlicerViewerOptions().useFullSlicer === true;
    }

    /**
     * Full desktop Slicer: local when pref is on, or Vast when server mode is full-slicer.
     * Soft-warm prepare stays local-only (useLocalFullSlicer).
     */
    get useFullSlicerViewer() {
        if (this.useLocalFullSlicer) return true;
        return this.savedGpuProviderId === 'vast' && this.vastGpuMode === 'full-slicer';
    }

    get useLocalSimplifiedViewer() {
        return this.useLocalFullSlicer
            && getCachedLocalSlicerViewerOptions().useSimplifiedViewer === true;
    }

    get selectedGpuProvider() {
        return this.gpuProviders.find((p) => p.id === this.savedGpuProviderId) || null;
    }

    /** Active provider — always matches persisted server settings. */
    get activeGpuProviderId() {
        return this.savedGpuProviderId;
    }

    get gpuStatusLabel() {
        const status = this.gpuInstance?.status || 'idle';
        const labels = {
            idle: t('gpu.statusIdle'),
            provisioning: t('gpu.statusProvisioning'),
            running: t('gpu.statusRunning'),
            stopping: t('gpu.statusStopping'),
            error: t('gpu.statusError')
        };
        return labels[status] || status;
    }

    get localViewerFriendlyLabel() {
        if (!this.useLocalFullSlicer) {
            return t('viewers.trame');
        }
        if (this.useLocalSimplifiedViewer) {
            return t('viewers.simplified');
        }
        return t('viewers.fullSlicer');
    }

    get gpuFriendlySummary() {
        if (this.savedGpuProviderId === 'local') {
            return t('viewers.local');
        }
        const status = this.gpuInstance?.status || 'idle';
        if (!this.canStartBilling && status === 'idle') {
            return t('gpu.notRunning');
        }
        if (status === 'provisioning') {
            if (this.remoteProvision?.failure) {
                return t('gpu.startFailed');
            }
            if (this.remoteProvision?.statusMessage) {
                return this.remoteProvision.statusMessage;
            }
            return t('gpu.starting');
        }
        if (status === 'error' && this.gpuInstance?.errorMessage) {
            return this.gpuInstance.errorMessage;
        }
        const labels = {
            idle: t('gpu.gpuNotRunning'),
            running: t('gpu.readyToOpen'),
            stopping: t('gpu.shutdownStatus'),
            error: t('gpu.gpuUnavailable')
        };
        return labels[status] || t('gpu.statusUnknown');
    }

    get showGpuInfoButton() {
        return this.savedGpuProviderId !== 'local';
    }

    getProviderConsoleUrl(providerId) {
        const fromApi = this.gpuProviders.find((p) => p.id === providerId)?.consoleUrl;
        return fromApi || GPU_PROVIDER_CONSOLE_URLS[providerId] || null;
    }

    get gpuDetailEntries() {
        if (this.savedGpuProviderId === 'local') {
            return [];
        }

        const entries = [];
        const provider = this.gpuProviders.find((p) => p.id === this.savedGpuProviderId);
        entries.push({
            label: 'Provider',
            value: provider?.label || this.savedGpuProviderId,
            href: this.getProviderConsoleUrl(this.savedGpuProviderId)
        });
        entries.push({ label: 'Status', value: this.gpuStatusLabel });

        if (this.gpuInstance?.status === 'provisioning' && this.remoteProvision) {
            if (this.remoteProvision.actualStatus) {
                entries.push({
                    label: 'Vast status',
                    value: this.remoteProvision.actualStatus
                });
            }
            if (this.remoteProvision.statusMessage) {
                entries.push({
                    label: 'Vast message',
                    value: this.remoteProvision.statusMessage
                });
            }
        }
        if (this.gpuInstance?.status === 'error' && this.gpuInstance?.errorMessage) {
            entries.push({ label: 'Error', value: this.gpuInstance.errorMessage });
        }

        if (this.gpuInstance?.metadata?.dph) {
            entries.push({
                label: 'Estimated cost',
                value: `~$${Number(this.gpuInstance.metadata.dph).toFixed(2)}/hr`
            });
        }
        if (this.gpuInstance?.status === 'running' && this.gpuInstance.gpuHost) {
            entries.push({ label: 'Host', value: this.gpuInstance.gpuHost });
        }
        if (this.gpuInstance?.status === 'running' && this.remoteActivity) {
            if (this.remoteActivity.hasActiveSession) {
                entries.push({ label: 'Viewer', value: 'Active' });
            } else if (this.remoteActivity.sessionCount === 0) {
                entries.push({ label: 'Viewer', value: 'Idle (no scene open)' });
            }
        }
        if (this.gpuInstance?.status === 'running' && this.gpuPrestageActive) {
            entries.push({
                label: 'Files',
                value: 'Preparing recent scenes on the GPU…'
            });
        }
        if (this.gpuBillingLease && this.gpuInstance?.status === 'running') {
            const lease = this.gpuBillingLease;
            let billing = `Auto-stops after ${lease.idleMinutes} min idle`;
            if (lease.idleShutdownAt) {
                billing += ` (by ${this.formatBillingTime(lease.idleShutdownAt)})`;
            }
            if (lease.wallEndsAt) {
                billing += `; max ${lease.maxWallMinutes} min (ends ${this.formatBillingTime(lease.wallEndsAt)})`;
            }
            entries.push({ label: 'Billing limits', value: billing });
            entries.push({
                label: 'Viewer sessions',
                value: `Leaving this tab stops the viewer after ${lease.viewerLeaveGraceMinutes ?? 10} min. `
                    + `Viewer and billing stop ~${lease.viewerSessionTtlMinutes ?? 30} min after last interaction. `
                    + 'Other browser tabs can stay open for side-by-side compare.'
            });
        }
        if (this.canStartBilling) {
            entries.push({
                label: 'Note',
                value: 'Start billing before opening files. Scenes copy to the GPU when opened.'
            });
        } else if (this.canManageGpu) {
            entries.push({
                label: 'Note',
                value: 'Add remote credentials, then start billing before opening files.'
            });
        } else {
            entries.push({
                label: 'Note',
                value: 'A project admin or collaborator manages GPU billing.'
            });
        }
        if (this.billingOwnership?.billingOwner?.username && this.gpuInstance?.status === 'running') {
            const ownerLabel = this.billingOwnership.youOwnBilling
                ? 'You'
                : this.billingOwnership.billingOwner.username;
            entries.push({ label: 'Billing owner', value: ownerLabel });
        }
        return entries;
    }

    get gpuPanelSummaryMeta() {
        const provider = this.configuredProviders.find((p) => p.id === this.savedGpuProviderId);
        const label = provider?.label || (this.savedGpuProviderId === 'local' ? 'Local' : this.savedGpuProviderId);
        if (this.savedGpuProviderId === 'local') {
            return `${label} · ${this.localViewerFriendlyLabel}`;
        }
        return `${label} · ${this.gpuFriendlySummary}`;
    }

    handleGpuPanelToggle(event) {
        this.gpuPanelOpen = event.target.open;
    }

    handleCollaboratorsPanelToggle(event) {
        this.collaboratorsPanelOpen = event.target.open;
    }

    toggleGpuDetails() {
        this.gpuDetailsOpen = !this.gpuDetailsOpen;
    }

    renderGpuProviderDetailValue(entry) {
        if (!entry.href) {
            return entry.value;
        }
        return html`
            <span class="gpu-detail-value-with-link">
                <span>${entry.value}</span>
                <a
                    class="gpu-console-link"
                    href=${entry.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Open ${entry.value} console"
                    aria-label="Open ${entry.value} console"
                    @click=${(e) => e.stopPropagation()}
                >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                        <path fill="currentColor" d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7zM14 3v2h3.59l-7.59 7.59L10 14.17 19.41 4.83V8h2V3h-7z"></path>
                    </svg>
                </a>
            </span>
        `;
    }

    get canStartGpuBilling() {
        return this.canStartGpuBillingNow({ ignoreBusy: false });
    }

    canStartGpuBillingNow({ ignoreBusy = false } = {}) {
        return this.canStartBilling
            && this.savedGpuProviderId !== 'local'
            && this.isGpuProviderConfigured(this.savedGpuProviderId)
            && ['idle', 'error'].includes(this.gpuInstance?.status || 'idle')
            && (ignoreBusy || !this.gpuBillingBusy)
            && !this.gpuSaving;
    }

    get canStopGpuBilling() {
        const inst = this.gpuInstance;
        if (!this.canStopBilling || this.gpuBillingBusy) return false;
        if (inst?.status === 'provisioning') return true;
        if (inst?.status === 'stopping') return true;
        if (inst?.status === 'error' && inst?.instanceId) return true;
        return inst?.status === 'running' && !!inst?.instanceId;
    }

    get showGpuBillingActions() {
        return this.savedGpuProviderId !== 'local'
            && (this.canStartBilling || this.canStopBilling);
    }

    applyBillingOwnership(ownership, { announce = false } = {}) {
        const prev = this.billingOwnership;
        const prevOwned = prev?.youOwnBilling === true;
        const hadSnapshot = prev != null;
        this.billingOwnership = ownership || null;
        const becameOwner = !prevOwned && ownership?.youOwnBilling === true;
        // Only mark transfer when ownership flips during a session — not first paint as starter/owner.
        if (becameOwner && hadSnapshot && this.gpuInstance?.status === 'running') {
            this._billingReceivedViaTransfer = true;
        }
        if (!ownership?.youOwnBilling) {
            this._billingReceivedViaTransfer = false;
        }
        if (
            announce
            && hadSnapshot
            && becameOwner
            && this.gpuInstance?.status === 'running'
        ) {
            this.showToast(t('gpu.billingStillActive'));
        }
    }

    get otherActiveBillingUsers() {
        const selfId = this.billingOwnership?.billingOwner?.userId;
        const users = this.billingOwnership?.activeUsers || [];
        return users.filter((u) => u.userId !== selfId);
    }

    shouldPromptTransferredOwnerOnViewerClose() {
        if (this.savedGpuProviderId === 'local') return false;
        if (this.gpuInstance?.status !== 'running') return false;
        if (!this.billingOwnership?.youOwnBilling) return false;
        if (!this._billingReceivedViaTransfer) return false;
        if (!this.canStopBilling) return false;
        return this.otherActiveBillingUsers.length === 0;
    }

    openOwnerBillingPrompt() {
        this.ownerBillingPromptStep = 'ask';
        this._ownerPromptClosingProgrammatically = false;
        requestAnimationFrame(() => {
            const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
            if (!dialog) return;
            dialog.lightDismiss = true;
            dialog.showDefaultCloseButton = true;
            dialog.title = t('projects.youOwnSession');
            dialog.openDialog();
            const native = dialog.nativeDialog;
            if (native && !native._ownerPromptCloseBound) {
                native.addEventListener('close', () => this.handleOwnerBillingPromptNativeClose());
                native._ownerPromptCloseBound = true;
            }
        });
    }

    handleOwnerBillingPromptNativeClose() {
        if (this._ownerPromptClosingProgrammatically) {
            this._ownerPromptClosingProgrammatically = false;
            return;
        }
        // Dismissed ask (X / backdrop) → friendly reminder that requires acknowledgement.
        if (this.ownerBillingPromptStep === 'ask') {
            this.ownerBillingPromptStep = 'remind';
            requestAnimationFrame(() => {
                const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
                if (!dialog) return;
                dialog.lightDismiss = false;
                dialog.showDefaultCloseButton = true;
                dialog.title = t('projects.rememberStopBilling');
                dialog.openDialog();
            });
            return;
        }
        this.ownerBillingPromptStep = '';
    }

    closeOwnerBillingPrompt() {
        this._ownerPromptClosingProgrammatically = true;
        this.renderRoot?.querySelector('#gpu-owner-billing-prompt')?.closeDialog?.();
        this.ownerBillingPromptStep = '';
    }

    handleOwnerBillingPromptKeepRunning() {
        this._ownerPromptClosingProgrammatically = true;
        const dialog = this.renderRoot?.querySelector('#gpu-owner-billing-prompt');
        dialog?.closeDialog?.();
        this.ownerBillingPromptStep = 'remind';
        requestAnimationFrame(() => {
            this._ownerPromptClosingProgrammatically = false;
            if (!dialog) return;
            dialog.lightDismiss = false;
            dialog.showDefaultCloseButton = true;
            dialog.title = t('projects.rememberStopBilling');
            dialog.openDialog();
        });
    }

    acknowledgeOwnerBillingReminder() {
        this.closeOwnerBillingPrompt();
    }

    async handleOwnerBillingPromptStop() {
        if (!this.canStopGpuBilling) {
            this.closeOwnerBillingPrompt();
            return;
        }
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this._billingReceivedViaTransfer = false;
            this.closeOwnerBillingPrompt();
            this.showToast(t('gpu.statusStopping'));
            this.maybeStartGpuPolling();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    formatGpuSessionEndedMessage(reason) {
        const detail = reason ? ` (${reason})` : '';
        return `Your GPU session ended${detail}. Billing may have been stopped by another user, idle timeout, or transfer exhaustion.`;
    }

    get stopBillingImpactNames() {
        const users = this.stopBillingImpact?.activeUsers || [];
        return users.map((u) => u.username || `User ${u.userId}`).join(', ');
    }

    get stopBillingTransferLabel() {
        const target = this.stopBillingImpact?.transferTarget
            || this.billingOwnership?.transferTarget;
        if (!target) return 'Transfer ownership';
        return `Transfer to ${target.username || `User ${target.userId}`}`;
    }

    async handleStartGpuBilling() {
        if (!this.canStartGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            // Refresh first so we don't race a collaborator who already started.
            await this.loadProjectGpu();
            // Ignore busy flag here — we set it for this in-flight start.
            if (!this.canStartGpuBillingNow({ ignoreBusy: true })) {
                this.showToast(
                    this.gpuInstance?.status === 'provisioning' || this.gpuInstance?.status === 'running'
                        ? 'GPU billing was already started by someone on this project.'
                        : 'GPU billing is not available to start right now.'
                );
                return;
            }
            const data = await startProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.canStopBilling = true;
            this._billingReceivedViaTransfer = false;
            this.clearErrorAlertDedupe();
            this.showToast(t('gpu.statusProvisioning'));
            this.maybeStartGpuPolling();
        } catch (error) {
            if (error.status === 409) {
                await this.loadProjectGpu().catch(() => {});
                this.showToast(error.message || t('gpu.billingAlreadyStarted'));
                return;
            }
            this.showErrorAlert(error.message || 'Unable to start GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleStopGpuBilling() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.showToast(t('gpu.statusStopping'));
            this.maybeStartGpuPolling();
        } catch (error) {
            if (error.status === 409 && error.code === 'billing_stop_impact') {
                this.stopBillingImpact = error.impact || error.payload?.impact || null;
                if (error.payload?.billingOwnership) {
                    this.applyBillingOwnership(error.payload.billingOwnership);
                }
                this.renderRoot?.querySelector('#gpu-stop-billing-dialog')?.openDialog();
                return;
            }
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    closeStopBillingDialog() {
        this.renderRoot?.querySelector('#gpu-stop-billing-dialog')?.closeDialog?.();
        this.stopBillingImpact = null;
    }

    async handleConfirmStopBillingAnyway() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.closeStopBillingDialog();
            this.showToast(t('gpu.statusStopping'));
            this.maybeStartGpuPolling();
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to stop GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleTransferGpuBilling() {
        if (!this.canStopGpuBilling) return;
        this.gpuBillingBusy = true;
        try {
            const data = await transferProjectGpuBilling(this.projectId);
            this.gpuInstance = data.instance;
            if (data.billingOwnership) {
                this.applyBillingOwnership(data.billingOwnership);
            }
            this.closeStopBillingDialog();
            if (data.transferred) {
                const name = data.owner?.username || 'another user';
                this.showToast(t('gpu.billingTransferred', { name }));
            } else if (data.stopped) {
                this.showToast(t('gpu.statusStopping'));
                this.maybeStartGpuPolling();
            }
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to transfer GPU billing.', {
                title: 'GPU billing',
                force: true
            });
        } finally {
            this.gpuBillingBusy = false;
        }
    }

    async handleLaunchFile(file) {
        // Immediate feedback — remote open can wait on prestage/sync with no network logs in DevTools.
        const sceneTitle = this.displayTitleForFile(file);
        this.launchingFileId = file.id;
        this.viewerLoading = true;
        this.viewerLoadingDetail = 'Checking GPU status…';
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        this.currentFileName = sceneTitle;
        this.showIframe = true;
        this.iframeUrl = 'about:blank';

        try {
            // Skip a full reload when we already know remote billing is running.
            if (!(this.usesRemoteGpuProvider() && this.isRemoteGpuRunning())) {
                await this.loadProjectGpu();
            }
        } catch (_) {
            // launch checks below still apply with last-known state
        }

        const gpuBlock = this.getRemoteGpuLaunchBlockMessage();
        if (gpuBlock) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this.currentFileName = '';
            this.showErrorAlert(gpuBlock, { title: 'GPU not ready', force: true });
            return;
        }

        if (this.useFullSlicerViewer) {
            // Full Slicer path manages its own overlay state.
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            await this.handleLaunchFullSlicer(file);
            return;
        }

        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.viewerLoadingDetail = `Starting viewer for ${sceneTitle}…`;

        try {
            this.stopTrameHeartbeat();
            if (this.isRemoteGpuRunning()) {
                this.viewerLoadingDetail = this.isFileStagedOnGpu(file)
                    ? `Opening ${sceneTitle} on GPU…`
                    : `Copying ${sceneTitle} to GPU (large scenes can take a few minutes)…`;
            } else {
                this.viewerLoadingDetail = `Preparing session for ${sceneTitle}…`;
            }

            // Sync lives in /containers/start (waits on shared prestage job, then syncs).
            // Do not await a separate prestage here — that doubled work and delayed open.

            const response = await fetch(`${API_URL}/api/containers/start`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                credentials: 'include',
                body: JSON.stringify({ fileId: file.id, projectId: this.projectId })
            });

            const data = await response.json();
            if (!response.ok) {
                throw new Error(this.parseApiErrorMessage(data, 'Failed to launch file'));
            }

            this._viewerSessionToken = data.sessionToken || null;
            const url = resolveTramePageUrl(data.frontendUrl);
            if (!url) {
                throw new Error('Trame did not return a viewer URL.');
            }

            this.viewerLoadingDetail = `Loading ${sceneTitle}…`;
            this.iframeUrl = url;
            markViewerActivity();
            this.showToast(t('files.launched', { title: sceneTitle }));
            this.startTrameHeartbeat();
        } catch (error) {
            this.showIframe = false;
            this.iframeUrl = '';
            this.viewerKind = VIEWER_KINDS.TRAME;
            this.viewerSimplified = false;
            this.currentFileName = '';
            this.viewerLoading = false;
            this.viewerLoadingDetail = '';
            this.launchingFileId = null;
            this.showErrorAlert(error.message || 'Unable to launch file.', {
                title: 'Unable to open file',
                force: true
            });
        }
    }

    get viewerChromeLabel() {
        return viewerDisplayName(this.viewerKind || VIEWER_KINDS.TRAME, {
            simplified: this.viewerSimplified
        });
    }

    get viewerLoadingMessage() {
        if (this.viewerLoadingDetail) {
            return this.viewerLoadingDetail;
        }
        const name = this.currentFileName || 'scene';
        if (this.isRemoteGpuRunning()) {
            return `Starting GPU viewer for ${name}… Large scenes can take 1–3 minutes on the GPU.`;
        }
        return `Opening ${name}… Large scenes can take 1–3 minutes.`;
    }

    handleViewerIframeLoad() {
        if (!this.iframeUrl || this.iframeUrl === 'about:blank') {
            return;
        }
        // Keep overlay until loader posts slicer-viewer-ready.
        if (this.viewerKind === VIEWER_KINDS.SLICER_GUI) {
            markViewerActivity();
            this.attachViewerIframeActivityTracking();
            if (this._slicerReadyFallbackTimer) {
                clearTimeout(this._slicerReadyFallbackTimer);
            }
            this._slicerReadyFallbackTimer = setTimeout(() => {
                if (this.viewerKind === VIEWER_KINDS.SLICER_GUI && this.viewerLoading) {
                    this.viewerLoading = false;
                    this.viewerLoadingDetail = '';
                    this.launchingFileId = null;
                }
            }, 120000);
            return;
        }
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        markViewerActivity();
        this.attachViewerIframeActivityTracking();
    }

    syncViewerFullscreenState() {
        const overlay = this.renderRoot?.querySelector('.iframe-overlay');
        const nativeActive = Boolean(document.fullscreenElement);
        if (this._nativeFullscreenActive && !nativeActive) {
            // Browser exited fullscreen (often Escape).
            this._nativeFullscreenActive = false;
            overlay?.classList.remove('is-fullscreen');
            this.viewerFullscreen = false;
            this.closeFullscreenTip();
            return;
        }
        if (nativeActive) {
            this._nativeFullscreenActive = true;
            this.viewerFullscreen = true;
        }
    }

    async toggleViewerFullscreen() {
        if (this.viewerFullscreen) {
            await this.exitViewerFullscreen();
            return;
        }

        this.closeViewerMenu();
        await this.enterViewerFullscreen();
        if (!this.hasDismissedFullscreenTip()) {
            this.openFullscreenTip();
        }
    }

    hasDismissedFullscreenTip() {
        try {
            return localStorage.getItem(FULLSCREEN_TIP_DISMISSED_KEY) === '1';
        } catch (_) {
            return false;
        }
    }

    openFullscreenTip() {
        this.fullscreenTipDontShowAgain = false;
        this.showFullscreenTip = true;
    }

    closeFullscreenTip() {
        this.showFullscreenTip = false;
    }

    acknowledgeFullscreenTip() {
        if (this.fullscreenTipDontShowAgain) {
            try {
                localStorage.setItem(FULLSCREEN_TIP_DISMISSED_KEY, '1');
            } catch (_) {
                /* ignore quota / private mode */
            }
        }
        this.closeFullscreenTip();
    }

    async enterViewerFullscreen() {
        const overlay = this.renderRoot?.querySelector('.iframe-overlay');
        if (!overlay) return;

        this.closeViewerMenu();

        // Always apply the edge-to-edge layout. Native fullscreen alone is easy to miss
        // because this overlay is already viewport-sized.
        this.viewerFullscreen = true;
        overlay.classList.add('is-fullscreen');

        const requestFs = overlay.requestFullscreen
            || overlay.webkitRequestFullscreen
            || overlay.msRequestFullscreen;

        try {
            if (typeof requestFs === 'function') {
                await requestFs.call(overlay);
                this._nativeFullscreenActive = Boolean(document.fullscreenElement);
            }
        } catch (_) {
            // CSS fullscreen still applies if the native API is blocked.
            this._nativeFullscreenActive = false;
        }
    }

    async exitViewerFullscreen() {
        const overlay = this.renderRoot?.querySelector('.iframe-overlay');
        try {
            const exitFs = document.exitFullscreen
                || document.webkitExitFullscreen
                || document.msExitFullscreen;
            if (document.fullscreenElement && typeof exitFs === 'function') {
                await exitFs.call(document);
            }
        } catch (_) {
            /* ignore */
        }
        overlay?.classList.remove('is-fullscreen');
        this.viewerFullscreen = false;
        this._nativeFullscreenActive = false;
        this.closeFullscreenTip();
    }

    toggleViewerMenu(event) {
        event?.stopPropagation?.();
        if (this.iframeUrl === 'about:blank') return;
        this.viewerMenuOpen = !this.viewerMenuOpen;
    }

    closeViewerMenu() {
        this.viewerMenuOpen = false;
    }

    handleViewerMenuAction(action, event) {
        event?.preventDefault?.();
        event?.stopPropagation?.();
        // Run while still in the user-gesture stack (needed for window.open / requestFullscreen).
        if (action === 'fullscreen') {
            this.toggleViewerFullscreen();
        } else if (action === 'new-window') {
            this.openViewerInNewWindow();
            this.closeViewerMenu();
        }
    }

    attachViewerFullscreenListener() {
        if (this._onFullscreenChange) return;
        this._onFullscreenChange = () => this.syncViewerFullscreenState();
        this._onFullscreenKeydown = (event) => {
            if (event.key !== 'Escape') return;
            if (this.showFullscreenTip) {
                this.acknowledgeFullscreenTip();
                event.preventDefault();
                return;
            }
            if (this.viewerMenuOpen) {
                this.closeViewerMenu();
                return;
            }
            // Native fullscreen is already exited by the browser; this covers CSS-only mode.
            if (this.viewerFullscreen && !document.fullscreenElement) {
                this.exitViewerFullscreen();
            }
        };
        document.addEventListener('fullscreenchange', this._onFullscreenChange);
        document.addEventListener('keydown', this._onFullscreenKeydown);
    }

    detachViewerFullscreenListener() {
        if (this._onFullscreenChange) {
            document.removeEventListener('fullscreenchange', this._onFullscreenChange);
            this._onFullscreenChange = null;
        }
        if (this._onFullscreenKeydown) {
            document.removeEventListener('keydown', this._onFullscreenKeydown);
            this._onFullscreenKeydown = null;
        }
    }

    attachViewerIframeActivityTracking() {
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }

        try {
            const iframe = this.renderRoot?.querySelector('.trame-iframe');
            const iframeDoc = iframe?.contentWindow?.document;
            if (!iframeDoc) return;

            const onActivity = () => markViewerActivity();
            const events = ['pointerdown', 'keydown', 'wheel', 'touchstart'];
            events.forEach((eventName) => {
                iframeDoc.addEventListener(eventName, onActivity, { passive: true, capture: true });
            });

            this._viewerIframeActivityCleanup = () => {
                events.forEach((eventName) => {
                    iframeDoc.removeEventListener(eventName, onActivity, { capture: true });
                });
            };
        } catch (_) {
            // Cross-origin iframe: rely on postMessage from the viewer.
        }
    }

    async handleViewerInactivityTimeout() {
        if (!this.showIframe) return;
        this.showToast(t('gpu.viewerClosedInactivity'));
        // Walk-away with an open viewer: tear down the seat (do not leave warm forever).
        await this.closeIframe({ releaseMode: VIEWER_RELEASE_MODES.HARD, skipOwnerBillingPrompt: true });
        if (
            this.savedGpuProviderId !== 'local'
            && this.canStopBilling
            && this.gpuInstance?.status === 'running'
        ) {
            try {
                const data = await stopProjectGpuBilling(this.projectId, { acknowledgeImpact: true });
                this.gpuInstance = data.instance;
                this.gpuBillingLease = null;
                if (data.billingOwnership) {
                    this.applyBillingOwnership(data.billingOwnership);
                }
                this.showToast(t('projects.stopBilling'));
                this.maybeStartGpuPolling();
            } catch (error) {
                console.warn('GPU billing stop after idle failed:', error.message);
            }
        }
    }

    startTrameHeartbeat() {
        this.stopTrameHeartbeat();
        const kind = this.viewerKind || VIEWER_KINDS.TRAME;
        const { heartbeatUrl } = getViewerSessionEndpoints({
            kind,
            projectId: this.projectId
        });
        const ping = () => {
            sendTrameContainerHeartbeat({
                sessionToken: this._viewerSessionToken,
                projectId: this.projectId,
                heartbeatUrl,
                includeUserActive: kind === VIEWER_KINDS.TRAME,
                onIdleTimeout: () => this.handleViewerInactivityTimeout()
            }).catch((err) => {
                if (kind === VIEWER_KINDS.SLICER_GUI && err?.status === 404) {
                    this.handleViewerSupersededElsewhere();
                }
            });
        };
        ping();
        // Full Slicer: shorter cadence — Edge Sleeping Tabs can pause timers for minutes.
        this._trameHeartbeatInterval = setInterval(ping, kind === VIEWER_KINDS.SLICER_GUI ? 20000 : 60000);
        this._onViewerWakeHeartbeat = () => {
            if (document.hidden || !this.showIframe) return;
            markViewerActivity();
            ping();
        };
        document.addEventListener('visibilitychange', this._onViewerWakeHeartbeat);
        window.addEventListener('focus', this._onViewerWakeHeartbeat);
        this._onSlicerViewerMessage = (event) => {
            if (event?.origin && event.origin !== window.location.origin) return;
            if (event?.data?.type === 'slicer-viewer-disconnected') {
                this.showToast(t('common.networkError'));
            }
            if (event?.data?.type === 'slicer-viewer-superseded') {
                this.handleViewerSupersededElsewhere();
            }
            if (event?.data?.type === 'slicer-viewer-loading') {
                if (this.viewerKind !== VIEWER_KINDS.SLICER_GUI || !this.viewerLoading) return;
                const heading = event.data.heading || '';
                const detail = event.data.detail || '';
                if (detail) {
                    this.viewerLoadingDetail = detail;
                } else if (heading) {
                    this.viewerLoadingDetail = heading;
                }
            }
            if (event?.data?.type === 'slicer-viewer-ready') {
                if (this.viewerKind !== VIEWER_KINDS.SLICER_GUI) return;
                if (this._slicerReadyFallbackTimer) {
                    clearTimeout(this._slicerReadyFallbackTimer);
                    this._slicerReadyFallbackTimer = null;
                }
                this.viewerLoading = false;
                this.viewerLoadingDetail = '';
                this.launchingFileId = null;
            }
        };
        window.addEventListener('message', this._onSlicerViewerMessage);
    }

    /**
     * This seat's lease was rotated (another client took the same seat, or the
     * seat cap forced LRU reuse). Drop this window's VNC; other seats keep running.
     */
    handleViewerSupersededElsewhere() {
        if (!this.showIframe) return;
        if (this.viewerKind !== VIEWER_KINDS.SLICER_GUI) return;
        this.stopTrameHeartbeat();
        this.showIframe = false;
        this.iframeUrl = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.viewerFullscreen = false;
        this.viewerMenuOpen = false;
        this.showFullscreenTip = false;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.showErrorAlert(
            'This Full Slicer seat was taken by another browser window. '
            + 'Concurrent desktops are limited per account; opening beyond that limit '
            + 'replaces the least-recently used seat.',
            { title: 'Viewer opened elsewhere', force: true }
        );
    }

    stopTrameHeartbeat() {
        if (this._trameHeartbeatInterval) {
            clearInterval(this._trameHeartbeatInterval);
            this._trameHeartbeatInterval = null;
        }
        if (this._onViewerWakeHeartbeat) {
            document.removeEventListener('visibilitychange', this._onViewerWakeHeartbeat);
            window.removeEventListener('focus', this._onViewerWakeHeartbeat);
            this._onViewerWakeHeartbeat = null;
        }
        if (this._onSlicerViewerMessage) {
            window.removeEventListener('message', this._onSlicerViewerMessage);
            this._onSlicerViewerMessage = null;
        }
    }

    async cleanupContainerSession(projectId = null, overrides = {}) {
        const kind = overrides.kind || this.viewerKind || VIEWER_KINDS.TRAME;
        const token = overrides.sessionToken !== undefined
            ? overrides.sessionToken
            : this._viewerSessionToken;
        const mode = overrides.mode || defaultReleaseModeForClose(kind);
        if (overrides.sessionToken === undefined) {
            this._viewerSessionToken = null;
            this._viewerSeatId = null;
        } else if (token && token === this._viewerSessionToken) {
            this._viewerSessionToken = null;
            this._viewerSeatId = null;
        }
        const seatId = overrides.seatId !== undefined
            ? overrides.seatId
            : this._viewerSeatId;
        const { stopUrl } = getViewerSessionEndpoints({
            kind,
            projectId: projectId || this.projectId
        });
        await stopViewerSession({
            stopUrl,
            sessionToken: token,
            body: buildViewerStopBody({
                kind,
                sessionToken: token,
                projectId: projectId || this.projectId,
                seatId,
                mode
            })
        });
    }

    /**
     * Close overlay UI and stop heartbeats without releasing the session
     * (used when handing Full Slicer off to a standalone window).
     */
    detachViewerOverlay() {
        this.exitViewerFullscreen();
        this.closeViewerMenu();
        this.stopTrameHeartbeat();
        resetViewerActivity();
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        this._viewerSessionToken = null;
        this._viewerSeatId = null;
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
    }

    openViewerInNewWindow() {
        if (!this.iframeUrl || this.iframeUrl === 'about:blank') return;

        let targetUrl = this.iframeUrl;
        const handoffSlicerGui = this.viewerKind === VIEWER_KINDS.SLICER_GUI;
        if (handoffSlicerGui) {
            try {
                const parsed = new URL(this.iframeUrl, window.location.href);
                parsed.searchParams.delete('embed');
                targetUrl = parsed.href;
            } catch (_) {
                /* keep as-is */
            }
        }

        const width = Math.min(1400, window.screen.width * 0.9);
        const height = Math.min(900, window.screen.height * 0.9);
        const left = (window.screen.width - width) / 2;
        const top = (window.screen.height - height) / 2;
        const popup = window.open(
            targetUrl,
            'slicer-viewer',
            `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`
        );
        if (!popup) {
            this.showErrorAlert('Pop-up blocked. Allow pop-ups for this site and try again.', {
                title: 'Unable to open window',
                force: true
            });
            return;
        }
        if (handoffSlicerGui) {
            // Standalone loader owns heartbeat/soft-release once embed is removed.
            this.detachViewerOverlay();
        }
    }

    async closeIframe({ releaseMode = null, skipOwnerBillingPrompt = false } = {}) {
        const kind = this.viewerKind || VIEWER_KINDS.TRAME;
        const mode = releaseMode || defaultReleaseModeForClose(kind);
        const promptAfterClose = !skipOwnerBillingPrompt
            && this.shouldPromptTransferredOwnerOnViewerClose();
        await this.exitViewerFullscreen();
        this.closeViewerMenu();
        this.stopTrameHeartbeat();
        resetViewerActivity();
        if (this._viewerIframeActivityCleanup) {
            this._viewerIframeActivityCleanup();
            this._viewerIframeActivityCleanup = null;
        }
        if (this.projectId) {
            cancelViewerStopOnLeave(this.projectId);
        }
        this.showIframe = false;
        this.iframeUrl = '';
        this.currentFileName = '';
        this.viewerLoading = false;
        this.viewerLoadingDetail = '';
        this.launchingFileId = null;
        await this.cleanupContainerSession(this.projectId, { kind, mode });
        this.viewerKind = VIEWER_KINDS.TRAME;
        this.viewerSimplified = false;
        if (this.savedGpuProviderId !== 'local' && this.gpuInstance?.status === 'running') {
            sendProjectGpuHeartbeat(this.projectId, { viewerActive: false }).catch(() => {});
        }
        if (promptAfterClose) {
            this.openOwnerBillingPrompt();
        }
    }

    openEditFileTitleDialog(file) {
        if (!this.canUploadFiles || !this.isMrbFile(file) || this.savingFileTitleId === file.id) return;
        this.editTitleFileId = file.id;
        this.editTitleDraft = this.displayTitleForFile(file);
        this.editTitleOriginalName = file.originalName || '';
        const dialogHost = this.renderRoot?.querySelector('#edit-file-title-dialog');
        dialogHost?.openDialog();
        const native = dialogHost?.nativeDialog;
        if (native && !this._editTitleCloseBound) {
            this._editTitleCloseBound = true;
            native.addEventListener('close', () => {
                this.editTitleFileId = null;
                this.editTitleDraft = '';
                this.editTitleOriginalName = '';
                if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                }
            });
        }
        requestAnimationFrame(() => {
            const input = this.renderRoot?.querySelector('#edit-file-title-input');
            if (!input) return;
            input.focus();
            input.select();
        });
    }

    closeEditFileTitleDialog() {
        this.renderRoot?.querySelector('#edit-file-title-dialog')?.closeDialog();
    }

    handleEditTitleDraftInput(event) {
        this.editTitleDraft = event.target.value;
    }

    async handleSaveFileTitle() {
        const fileId = this.editTitleFileId;
        if (!fileId || this.savingFileTitleId === fileId) return;

        const file = this.projectFiles.find((entry) => entry.id === fileId);
        if (!file) {
            this.closeEditFileTitleDialog();
            return;
        }

        const current = this.displayTitleForFile(file);
        const normalized = String(this.editTitleDraft || '').trim();
        if (!normalized) {
            this.showErrorAlert('Title cannot be empty.', {
                title: 'Edit Scene Title',
                force: true
            });
            return;
        }
        if (normalized === current) {
            this.closeEditFileTitleDialog();
            return;
        }

        this.savingFileTitleId = fileId;
        try {
            const data = await updateProjectFileTitle(this.projectId, fileId, normalized);
            const savedTitle = data?.file?.displayTitle || null;
            this.projectFiles = this.projectFiles.map((entry) => (
                entry.id === fileId
                    ? { ...entry, displayTitle: savedTitle }
                    : entry
            ));
            this.closeEditFileTitleDialog();
            this.showToast(t('projects.editSceneTitle'));
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to update file title.', {
                title: 'Unable to save',
                force: true
            });
        } finally {
            this.savingFileTitleId = null;
        }
    }

    handleEditFileTitle(file) {
        this.openEditFileTitleDialog(file);
    }

    async handleDownloadFile(file) {
        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                credentials: 'include'
            });
            if (!response.ok) {
                let message = 'Failed to download file';
                try {
                    const data = await response.json();
                    message = data?.error?.message || data?.message || message;
                } catch (_) {
                    // ignore
                }
                throw new Error(message);
            }

            const blob = await response.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = file.originalName;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to download file.', {
                title: 'Download failed',
                force: true
            });
        }
    }

    openShareDialog(file) {
        if (!this.canUploadFiles || !this.isMrbFile(file)) return;
        this.shareTargetFile = file;
        this.shareDurationHours = 72;
        this.shareAllowedEmails = '';
        this.shareDialogError = '';
        this.showShareDialog = true;
    }

    closeShareDialog() {
        this.showShareDialog = false;
        this.shareTargetFile = null;
        this.shareDialogError = '';
    }

    async createShareLink() {
        const file = this.shareTargetFile;
        if (!file?.id) return;
        this.shareDialogError = '';
        this.sharingFileId = file.id;
        try {
            const rawEmails = this.shareAllowedEmails
                .split(',')
                .map((email) => email.trim())
                .filter((email) => email.length > 0);
            const uniqueEmails = [...new Set(rawEmails)];
            const allowedUserIds = [];
            for (const email of uniqueEmails) {
                const userResponse = await fetch(
                    `${API_URL}/api/users/lookup?email=${encodeURIComponent(email)}`,
                    { credentials: 'include' }
                );
                const userData = await userResponse.json().catch(() => ({}));
                if (!userResponse.ok) {
                    const msg = userData?.error?.message
                        || userData?.message
                        || `Could not resolve user: ${email}`;
                    throw new Error(msg);
                }
                if (userData?.user?.id) {
                    allowedUserIds.push(userData.user.id);
                }
            }

            const response = await fetch(`${API_URL}/api/files/${file.id}/share-links`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    expiresInHours: Number(this.shareDurationHours || 72),
                    allowedUserIds,
                    shareMode: 'whole_file',
                    viewerKind: 'slicer-gui'
                })
            });
            const data = await response.json().catch(() => ({}));
            if (!response.ok) {
                this.shareDialogError = data?.error?.message
                    || data?.message
                    || 'Failed to create share link';
                return;
            }

            const shareUrl = data?.shareLink?.url;
            if (!shareUrl) {
                this.shareDialogError = t('files.shareNoUrl');
                return;
            }

            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(shareUrl);
                this.showToast(t('files.simplifiedShareCopied', { name: this.displayTitleForFile(file) }));
            } else {
                this.showToast(`Share link: ${shareUrl}`);
            }
            this.closeShareDialog();
        } catch (err) {
            console.error('Share link creation error:', err);
            this.shareDialogError = err.message || 'Failed to create share link';
        } finally {
            this.sharingFileId = null;
        }
    }

    async handleDeleteFile(file) {
        if (!this.canDeleteProjectFiles) return;
        const confirmed = window.confirm(`Delete ${file.originalName}?`);
        if (!confirmed) return;

        try {
            const response = await fetch(`${API_URL}/api/files/${file.id}`, {
                method: 'DELETE',
                credentials: 'include'
            });
            if (!response.ok) {
                let message = 'Failed to delete file';
                try {
                    const data = await response.json();
                    message = data?.error?.message || data?.message || message;
                } catch (_) {
                    // ignore
                }
                throw new Error(message);
            }

            await this.loadProjectFiles();
            this.showToast(t('files.deleteFile'));
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to delete file.', {
                title: 'Delete failed',
                force: true
            });
        }
    }

    openCollaboratorDialog() {
        if (!this.canEditCollaborators) return;
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        const collaboratorSearch = this.renderRoot?.querySelector('collaborator-search');
        collaboratorSearch?.startSession(this.collaborators);
        dialog?.openDialog();
    }

    closeCollaboratorDialog() {
        const dialog = this.renderRoot?.querySelector('#collaborator-dialog');
        dialog?.closeDialog();
    }

    async handleCollaboratorsDone(event) {
        this.collaborators = this.sortCollaborators(event.detail.collaborators);
        this.closeCollaboratorDialog();
        // Dialog "Done" used to only update local state — easy to miss the separate Save.
        if (this.hasPendingCollaboratorChanges) {
            await this.handleSaveCollaborators();
        }
    }

    handleCollaboratorRoleChange(event) {
        if (!this.canEditCollaborators) return;
        const { user, role } = event.detail;
        this.collaborators = this.sortCollaborators(this.collaborators.map((entry) => (
            entry.user.id === user.id ? { ...entry, role } : entry
        )));
    }

    handleRemoveCollaborator(event) {
        if (!this.canEditCollaborators) return;
        const { user } = event.detail;
        this.collaborators = this.sortCollaborators(this.collaborators.filter((entry) => entry.user.id !== user.id));
    }

    handleCancelCollaboratorChanges() {
        this.collaborators = this.sortCollaborators(this.originalCollaborators.map((entry) => ({ ...entry })));
    }

    async handleSaveCollaborators() {
        if (!this.canEditCollaborators || !this.hasPendingCollaboratorChanges) return;
        this.saving = true;

        try {
            const payload = this.collaborators.map((entry) => ({
                userId: entry.user.id,
                role: entry.role
            }));
            await updateProjectCollaborators(this.projectId, payload);
            this.originalCollaborators = this.sortCollaborators(this.collaborators.map((entry) => ({ ...entry })));
            this.showToast(t('projects.collaborators', { n: this.collaborators.length }));
        } catch (error) {
            this.showErrorAlert(error.message || 'Unable to save collaborator changes.', {
                title: 'Unable to save',
                force: true
            });
        } finally {
            this.saving = false;
        }
    }

    render() {
        return html`
            <page-layout-template
                .username=${this.username}
                selectedMenuKey="my-projects"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle=${this.projectName || 'Project'}
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.loading ? html`
                    <div slot="content" class="status-note">Loading project...</div>
                ` : ''}
                ${!this.loading ? html`
                    <div slot="content" class="collaborators-panel">
                        <details
                            class="collaborators-details"
                            ?open=${this.collaboratorsPanelOpen}
                            @toggle=${(e) => this.handleCollaboratorsPanelToggle(e)}
                        >
                            <summary class="collaborators-summary">
                                <span class="collaborators-title">${t('projects.collaborators', { n: this.collaborators.length })}</span>
                                <span class="collaborators-chevron" aria-hidden="true">▸</span>
                            </summary>
                            <div class="collaborators-body">
                                ${this.collaborators.length === 0 ? html`
                                    <div class="empty-note">${t('projects.noCollaborators')}</div>
                                ` : html`
                                    <div class="collaborators-list">
                                        ${this.collaborators.map((entry) => html`
                                            <div class="collaborator-row">
                                                <collaborator-result-row
                                                    .user=${entry.user}
                                                    mode="selected"
                                                    .role=${entry.role}
                                                    .selectedRole=${entry.role}
                                                    .isRoleEditable=${this.canEditCollaborators}
                                                    .showRemoveButton=${this.canEditCollaborators}
                                                    @role-change=${(event) => this.handleCollaboratorRoleChange(event)}
                                                    @remove-collaborator=${(event) => this.handleRemoveCollaborator(event)}
                                                ></collaborator-result-row>
                                            </div>
                                        `)}
                                    </div>
                                `}
                                ${this.canEditCollaborators ? html`
                                    <add-button
                                        title=${t('projects.addCollaborators')}
                                        @add-button-click=${() => this.openCollaboratorDialog()}
                                    ></add-button>
                                ` : ''}
                                ${this.canEditCollaborators && this.hasPendingCollaboratorChanges ? html`
                                    <div class="section-actions">
                                        <button
                                            class="secondary-button"
                                            type="button"
                                            ?disabled=${this.saving}
                                            @click=${() => this.handleCancelCollaboratorChanges()}
                                        >
                                            ${t('common.cancel')}
                                        </button>
                                        <button
                                            class="primary-button"
                                            type="button"
                                            ?disabled=${this.saving}
                                            @click=${() => this.handleSaveCollaborators()}
                                        >
                                            ${this.saving ? t('common.saving') : t('common.save')}
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        </details>
                    </div>
                    <div slot="content" class="gpu-panel">
                        <div class="gpu-panel-header">
                            <details
                                class="gpu-panel-details"
                                ?open=${this.gpuPanelOpen}
                                @toggle=${(e) => this.handleGpuPanelToggle(e)}
                            >
                                <summary>
                                    <span class="gpu-panel-summary-label">${t('projects.gpuProvider')}</span>
                                    <span class="gpu-panel-chevron" aria-hidden="true">▸</span>
                                    <span class="gpu-panel-summary-meta">${this.gpuPanelSummaryMeta}</span>
                                </summary>
                                <div class="gpu-panel-body">
                                    ${this.canManageGpu ? html`
                                        <div class="gpu-title-row">
                                            <div class="gpu-title" style="margin-bottom: 0;">${t('projects.addProvider')}s</div>
                                            <add-button
                                                title=${t('projects.addProvider')}
                                                @add-button-click=${() => this.openGpuProviderDialog()}
                                            ></add-button>
                                        </div>
                                    ` : ''}
                                    ${this.canManageGpu ? html`
                                        <div class="gpu-field">
                                            <label for="gpu-provider">${t('projects.gpuProviderToUse')}</label>
                                            <dropdown-select
                                                id="gpu-provider"
                                                fullwidth
                                                .value=${this.gpuActiveProviderId}
                                                .options=${this.configuredProviders.map((provider) => ({
                                                    value: provider.id,
                                                    label: provider.label
                                                }))}
                                                ?disabled=${this.gpuSaving}
                                                aria-label=${t('projects.gpuProviderToUse')}
                                                @change=${(e) => this.handleGpuProviderChange(e)}
                                            ></dropdown-select>
                                        </div>
                                        ${this.isGpuProviderConfigured(this.gpuActiveProviderId)
                                            && this.gpuActiveProviderId !== 'local' ? html`
                                            <button
                                                class="secondary-button"
                                                type="button"
                                                ?disabled=${this.gpuSaving}
                                                @click=${() => this.openGpuProviderDialog(this.gpuActiveProviderId)}
                                            >
                                                Configure ${(this.configuredProviders.find((p) => p.id === this.gpuActiveProviderId) || {}).label || 'provider'}…
                                            </button>
                                        ` : ''}
                                        ${this.gpuSaving ? html`
                                            <div class="gpu-hint">Updating…</div>
                                        ` : ''}
                                        ${this.configuredProviders.length === 1 ? html`
                                            <div class="gpu-hint">Add a cloud GPU option to run larger files remotely.</div>
                                        ` : ''}
                                    ` : html`
                                        <div class="gpu-hint">
                                            Using ${(this.configuredProviders.find((p) => p.id === this.activeGpuProviderId) || { label: 'Local' }).label}
                                        </div>
                                    `}
                                    ${this.showGpuInfoButton ? html`
                                        <div class="gpu-status-row">
                                            <button
                                                class="gpu-info-button"
                                                type="button"
                                                aria-label=${t('gpu.gpuDetails')}
                                                title=${t('gpu.gpuDetails')}
                                                aria-expanded=${this.gpuDetailsOpen ? 'true' : 'false'}
                                                @click=${() => this.toggleGpuDetails()}
                                            >
                                                <svg class="gpu-info-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path fill="currentColor" d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"></path>
                                                </svg>
                                            </button>
                                        </div>
                                        ${this.gpuDetailsOpen ? html`
                                            <div class="gpu-details">
                                                ${this.gpuDetailEntries.map((entry) => html`
                                                    <div class="gpu-detail-row">
                                                        <div class="gpu-detail-label">${entry.label}</div>
                                                        <div class="gpu-detail-value">
                                                            ${entry.label === 'Provider'
                                                                ? this.renderGpuProviderDetailValue(entry)
                                                                : entry.value}
                                                        </div>
                                                    </div>
                                                `)}
                                            </div>
                                        ` : ''}
                                    ` : ''}
                                </div>
                            </details>
                            ${this.showGpuBillingActions ? html`
                                <div class="gpu-panel-billing-actions">
                                    <button
                                        class="primary-button"
                                        type="button"
                                        ?disabled=${!this.canStartGpuBilling}
                                        @click=${() => this.handleStartGpuBilling()}
                                    >
                                        ${this.gpuBillingBusy && this.gpuInstance?.status !== 'running' ? t('common.working') : t('projects.startBilling')}
                                    </button>
                                    <button
                                        class="secondary-button"
                                        type="button"
                                        ?disabled=${!this.canStopGpuBilling}
                                        @click=${() => this.handleStopGpuBilling()}
                                    >
                                        ${t('projects.stopBilling')}
                                    </button>
                                </div>
                            ` : ''}
                        </div>
                    </div>
                    <div slot="content" class="files-panel">
                        <div class="files-title">${t('projects.projectFiles')}</div>
                        ${this.loadingProjectFiles ? html`
                            <div class="empty-note">${t('projects.loadingProjectFiles')}</div>
                        ` : ''}
                        ${!this.loadingProjectFiles && this.projectFiles.length === 0 ? html`
                            <div class="empty-note">${t('projects.noProjectFiles')}</div>
                        ` : ''}
                        ${this.projectFiles.length > 0 ? html`
                            <div class="file-list">
                                ${this.projectFiles.map((file) => html`
                                    <file-list-row
                                        .fileName=${this.displayTitleForFile(file)}
                                        .metaLine=${this.formatProjectFileMetaLine(file)}
                                        .nameButtonDisabled=${this.viewerLoading || !!this.getRemoteGpuLaunchBlockMessage()}
                                        .nameButtonTitle=${''}
                                        ?showEditTitle=${this.isMrbFile(file) && this.canUploadFiles}
                                        .editTitleDisabled=${this.savingFileTitleId === file.id}
                                        editTitleLabel="Edit scene title"
                                        @name-click=${() => this.handleLaunchFile(file)}
                                        @edit-title-click=${() => this.handleEditFileTitle(file)}
                                        @mouseenter=${() => this.handleFileHover(file)}
                                    >
                                        <button
                                            slot="actions"
                                            class="file-icon-button"
                                            type="button"
                                            aria-label=${t('files.download')}
                                            title=${t('files.download')}
                                            @click=${() => this.handleDownloadFile(file)}
                                        >
                                            <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                <path fill="currentColor" d="M5 20h14v-2H5v2zm7-18v10.17l3.59-3.58L17 10l-5 5-5-5 1.41-1.41L11 12.17V2h2z"></path>
                                            </svg>
                                        </button>
                                        ${this.canUploadFiles && this.isMrbFile(file) ? html`
                                            <button
                                                slot="actions"
                                                class="file-icon-button"
                                                type="button"
                                                aria-label=${t('files.shareSimplifiedAria')}
                                                title=${t('files.shareSimplifiedTitle')}
                                                ?disabled=${this.sharingFileId === file.id}
                                                @click=${() => this.openShareDialog(file)}
                                            >
                                                <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"></path>
                                                </svg>
                                            </button>
                                        ` : ''}
                                        ${this.canDeleteProjectFiles ? html`
                                            <button
                                                slot="actions"
                                                class="file-icon-button"
                                                type="button"
                                                aria-label=${t('files.deleteFile')}
                                                title=${t('files.deleteFile')}
                                                @click=${() => this.handleDeleteFile(file)}
                                            >
                                                <svg class="file-action-icon" viewBox="0 0 24 24" aria-hidden="true">
                                                    <path fill="currentColor" d="M9 3h6l1 2h4v2h-2v13a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V7H4V5h4l1-2zm7 4H8v13h8V7zm-6 3h2v7h-2v-7zm4 0h2v7h-2v-7z"></path>
                                                </svg>
                                            </button>
                                        ` : ''}
                                    </file-list-row>
                                `)}
                            </div>
                        ` : ''}
                        ${this.canUploadFiles ? html`
                            <add-button
                                title=${t('projects.addFiles')}
                                @add-button-click=${() => this.openFileUploadDialog()}
                            ></add-button>
                        ` : ''}
                    </div>
                    <div slot="content" class="section-actions">
                        <button class="secondary-button" type="button" @click=${() => this.handleBackToProjects()}>
                            ${t('projects.backToProjects')}
                        </button>
                    </div>
                ` : ''}
            </page-layout-template>
            <app-dialog id="error-alert-dialog" title=${this.errorAlertTitle || t('common.somethingWentWrong')}>
                <p class="error-alert-message">${this.errorAlertMessage}</p>
                <button
                    slot="actions"
                    class="primary-button"
                    type="button"
                    @click=${() => this.dismissErrorAlert()}
                >
                    ${this.errorAlertDismissLabel}
                </button>
            </app-dialog>
            <app-dialog id="collaborator-dialog" title=${t('projects.addCollaboratorsTitle')}>
                <collaborator-search
                    @collaborators-cancel=${() => this.closeCollaboratorDialog()}
                    @collaborators-done=${(event) => this.handleCollaboratorsDone(event)}
                ></collaborator-search>
            </app-dialog>
            <app-dialog id="file-upload-dialog" title=${t('projects.addFilesToProject')}>
                <div class="upload-area ${this.dragOver ? 'drag-over' : ''}"
                    @dragover=${this.handleDragOver}
                    @dragleave=${this.handleDragLeave}
                    @drop=${this.handleDrop}
                >
                    <div class="upload-message">${t('files.dragDrop')}</div>
                    <input
                        type="file"
                        id="project-upload-input"
                        @change=${this.handleFileSelect}
                        ?disabled=${this.uploading}
                    />
                    <button
                        class="upload-button secondary"
                        type="button"
                        ?disabled=${this.uploading}
                        @click=${() => this.renderRoot?.querySelector('#project-upload-input')?.click()}
                    >
                        ${t('files.chooseFile')}
                    </button>
                    ${this.selectedFile ? html`
                        <div class="upload-file-info">
                            Selected: ${this.selectedFile.name} (${this.formatBytes(this.selectedFile.size)})
                        </div>
                        <div class="upload-actions">
                            <button
                                class="upload-button"
                                type="button"
                                ?disabled=${this.uploading}
                                @click=${() => this.uploadFileToProject()}
                            >
                                ${this.uploading ? t('files.uploading') : t('files.uploadFile')}
                            </button>
                            <button
                                class="upload-button secondary"
                                type="button"
                                ?disabled=${this.uploading}
                                @click=${() => this.closeFileUploadDialog()}
                            >
                                ${t('common.cancel')}
                            </button>
                        </div>
                    ` : ''}
                </div>
            </app-dialog>
            <app-dialog id="edit-file-title-dialog" title=${t('projects.editSceneTitle')}>
                <div class="gpu-dialog-form">
                    <div class="gpu-field">
                        <label for="edit-file-title-input">${t('files.editTitle')}</label>
                        <input
                            id="edit-file-title-input"
                            type="text"
                            maxlength="120"
                            .value=${this.editTitleDraft}
                            ?disabled=${this.savingFileTitleId === this.editTitleFileId}
                            @input=${(e) => this.handleEditTitleDraftInput(e)}
                            @keydown=${(e) => {
                                if (e.key === 'Enter') {
                                    e.preventDefault();
                                    this.handleSaveFileTitle();
                                }
                            }}
                        />
                    </div>
                    ${false && this.editTitleOriginalName ? html`
                        <div class="gpu-hint">File: ${this.editTitleOriginalName}</div>
                    ` : ''}
                    <div class="gpu-dialog-actions">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.savingFileTitleId === this.editTitleFileId}
                            @click=${() => this.closeEditFileTitleDialog()}
                        >
                            ${t('common.cancel')}
                        </button>
                        <button
                            class="primary-button"
                            type="button"
                            ?disabled=${this.savingFileTitleId === this.editTitleFileId}
                            @click=${() => this.handleSaveFileTitle()}
                        >
                            ${this.savingFileTitleId === this.editTitleFileId ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                </div>
            </app-dialog>
            <app-dialog id="gpu-provider-dialog" title=${this.gpuProviderDialogTitle}>
                <div class="gpu-dialog-form">
                    <div class="gpu-field">
                        <label for="gpu-dialog-provider">${t('projects.gpuProvider')}</label>
                        <dropdown-select
                            id="gpu-dialog-provider"
                            fullwidth
                            .value=${this.gpuDialogProviderId}
                            .options=${this.gpuDialogProviderOptions.map((provider) => ({
                                value: provider.id,
                                label: provider.label
                            }))}
                            aria-label="Provider"
                            @change=${(e) => this.handleGpuDialogProviderChange(e)}
                        ></dropdown-select>
                    </div>
                    <div class="gpu-field">
                        <label for="gpu-dialog-api-key">API key</label>
                        <input
                            id="gpu-dialog-api-key"
                            type="password"
                            placeholder=${this.gpuDialogApiKeyPlaceholder}
                            .value=${this.gpuDialogApiKey}
                            @input=${(e) => this.handleGpuDialogApiKeyInput(e)}
                        />
                    </div>
                    <label class="gpu-dialog-checkbox">
                        <input
                            type="checkbox"
                            .checked=${this.gpuDialogUseNow}
                            @change=${(e) => this.handleGpuDialogUseNowChange(e)}
                        />
                        ${t('common.default')}
                    </label>
                    <div class="gpu-dialog-actions">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuDialogSaving}
                            @click=${() => this.closeGpuProviderDialog()}
                        >
                            ${t('common.cancel')}
                        </button>
                        <button
                            class="primary-button"
                            type="button"
                            ?disabled=${this.gpuDialogSaving}
                            @click=${() => this.handleSaveGpuProviderDialog()}
                        >
                            ${this.gpuDialogSaving ? t('common.saving') : t('common.save')}
                        </button>
                    </div>
                </div>
            </app-dialog>
            <app-dialog id="gpu-stop-billing-dialog" title=${t('projects.stopGpuBilling')}>
                <div class="gpu-dialog-form">
                    <p class="error-alert-message">
                        Stopping billing will impact
                        ${this.stopBillingImpactNames || t('projects.stopBillingImpactDefault')}
                        and end their GPU sessions.
                    </p>
                    <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy}
                            @click=${() => this.closeStopBillingDialog()}
                        >
                            ${t('common.cancel')}
                        </button>
                        <button
                            class="secondary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy || !(this.stopBillingImpact?.transferTarget || this.billingOwnership?.transferTarget)}
                            @click=${() => this.handleTransferGpuBilling()}
                        >
                            ${this.stopBillingTransferLabel}
                        </button>
                        <button
                            class="primary-button"
                            type="button"
                            ?disabled=${this.gpuBillingBusy}
                            @click=${() => this.handleConfirmStopBillingAnyway()}
                        >
                            ${this.gpuBillingBusy ? t('common.working') : t('gpu.stopAnyway')}
                        </button>
                    </div>
                </div>
            </app-dialog>
            <app-dialog
                id="gpu-owner-billing-prompt"
                title=${this.ownerBillingPromptStep === 'remind' ? t('projects.rememberStopBilling') : t('projects.youOwnSession')}
                .lightDismiss=${this.ownerBillingPromptStep !== 'remind'}
            >
                <div class="gpu-dialog-form">
                    ${this.ownerBillingPromptStep === 'remind' ? html`
                        <p class="error-alert-message">
                            ${t('projects.rememberStopMessage')}
                        </p>
                        <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px;">
                            <button
                                class="primary-button"
                                type="button"
                                @click=${() => this.acknowledgeOwnerBillingReminder()}
                            >
                                ${t('projects.okay')}
                            </button>
                        </div>
                    ` : html`
                        <p class="error-alert-message">
                            ${t('projects.transferredOwnershipMessage')}
                        </p>
                        <div class="dialog-actions" style="display: flex; justify-content: flex-end; gap: 8px; margin-top: 16px; flex-wrap: wrap;">
                            <button
                                class="secondary-button"
                                type="button"
                                ?disabled=${this.gpuBillingBusy}
                                @click=${() => this.handleOwnerBillingPromptKeepRunning()}
                            >
                                ${t('projects.notYet')}
                            </button>
                            <button
                                class="primary-button"
                                type="button"
                                ?disabled=${this.gpuBillingBusy}
                                @click=${() => this.handleOwnerBillingPromptStop()}
                            >
                                ${this.gpuBillingBusy ? t('gpu.statusStopping') : t('projects.yesStopBilling')}
                            </button>
                        </div>
                    `}
                </div>
            </app-dialog>
            ${this.showIframe ? html`
                <div class="iframe-overlay ${this.viewerFullscreen ? 'is-fullscreen' : ''}">
                    ${this.viewerMenuOpen ? html`
                        <div
                            class="iframe-more-backdrop"
                            @click=${() => this.closeViewerMenu()}
                        ></div>
                    ` : ''}
                    <div class="iframe-header">
                        <div class="iframe-title-group">
                            <div class="iframe-title">${this.viewerChromeLabel}: ${this.currentFileName}</div>
                            <div class="iframe-more">
                                <button
                                    class="iframe-more-button"
                                    type="button"
                                    aria-label=${t('projects.viewerOptions')}
                                    title=${t('projects.viewerOptions')}
                                    aria-haspopup="menu"
                                    aria-expanded=${this.viewerMenuOpen ? 'true' : 'false'}
                                    ?disabled=${this.iframeUrl === 'about:blank'}
                                    @click=${(e) => this.toggleViewerMenu(e)}
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true">
                                        <circle cx="12" cy="5" r="1.8" fill="currentColor"></circle>
                                        <circle cx="12" cy="12" r="1.8" fill="currentColor"></circle>
                                        <circle cx="12" cy="19" r="1.8" fill="currentColor"></circle>
                                    </svg>
                                </button>
                                ${this.viewerMenuOpen ? html`
                                    <div class="iframe-more-menu" role="menu">
                                        <button
                                            class="iframe-more-item"
                                            type="button"
                                            role="menuitem"
                                            @click=${(e) => this.handleViewerMenuAction('fullscreen', e)}
                                        >
                                            ${this.viewerFullscreen ? t('projects.exitFullscreen') : t('projects.fullscreen')}
                                        </button>
                                        <button
                                            class="iframe-more-item"
                                            type="button"
                                            role="menuitem"
                                            @click=${(e) => this.handleViewerMenuAction('new-window', e)}
                                        >
                                            ${t('projects.openNewWindow')}
                                        </button>
                                    </div>
                                ` : ''}
                            </div>
                        </div>
                        <div class="iframe-header-actions">
                            <button
                                class="primary-button"
                                type="button"
                                @click=${() => this.closeIframe()}
                            >
                                ${t('projects.viewerClosedTitle', { viewer: this.viewerChromeLabel })}
                            </button>
                        </div>
                    </div>
                    <button
                        class="iframe-fs-exit"
                        type="button"
                        aria-label=${t('projects.exitFullscreen')}
                        @click=${() => this.exitViewerFullscreen()}
                    >
                        ${t('projects.exitFullscreen')}
                    </button>
                    ${this.showFullscreenTip ? html`
                        <div
                            class="fullscreen-tip-backdrop"
                            @click=${(e) => {
                                if (e.target === e.currentTarget) this.acknowledgeFullscreenTip();
                            }}
                        >
                            <div
                                class="fullscreen-tip"
                                role="dialog"
                                aria-modal="true"
                                aria-labelledby="fullscreen-tip-title"
                                @click=${(e) => e.stopPropagation()}
                            >
                                <h2 class="fullscreen-tip-title" id="fullscreen-tip-title">${t('projects.leavingFullscreen')}</h2>
                                <p class="fullscreen-tip-body">
                                    ${t('projects.pressEscHint')}
                                </p>
                                <p class="fullscreen-tip-body">
                                    ${t('projects.touchFullscreenHint')}
                                </p>
                                <label class="fullscreen-tip-check">
                                    <input
                                        type="checkbox"
                                        .checked=${this.fullscreenTipDontShowAgain}
                                        @change=${(e) => {
                                            this.fullscreenTipDontShowAgain = Boolean(e.target.checked);
                                        }}
                                    />
                                    <span>Don't show this again</span>
                                </label>
                                <div class="fullscreen-tip-actions">
                                    <button
                                        class="primary-button"
                                        type="button"
                                        @click=${() => this.acknowledgeFullscreenTip()}
                                    >
                                        Got it
                                    </button>
                                </div>
                            </div>
                        </div>
                    ` : ''}
                    <div class="iframe-container">
                        ${this.iframeUrl !== 'about:blank' ? html`
                            <iframe
                                class="trame-iframe"
                                src="${this.iframeUrl}"
                                allow="clipboard-read; clipboard-write; cross-origin-isolated; fullscreen"
                                allowfullscreen
                                frameborder="0"
                                referrerpolicy="origin"
                                @load=${() => this.handleViewerIframeLoad()}
                            ></iframe>
                        ` : ''}
                        ${this.viewerLoading ? html`
                            <div class="loading-state ${this.iframeUrl !== 'about:blank' ? 'loading-overlay' : ''} ${this.viewerKind === VIEWER_KINDS.SLICER_GUI ? 'slicer-gui-splash' : ''}">
                                <div class="viewer-loading">
                                    <div class="viewer-spinner" role="status" aria-label="Loading viewer"></div>
                                    <p>${this.viewerLoadingMessage}</p>
                                </div>
                            </div>
                        ` : ''}
                    </div>
                </div>
            ` : ''}
            ${this.toastMessage ? html`
                <div class="toast" role="status" aria-live="polite">${this.toastMessage}</div>
            ` : ''}
            ${this.showShareDialog ? html`
                <div class="share-dialog-overlay" @click=${(e) => { if (e.target === e.currentTarget) this.closeShareDialog(); }}>
                    <div class="share-dialog">
                        <h3>Share Simplified Viewer</h3>
                        <div><strong>File:</strong> ${this.displayTitleForFile(this.shareTargetFile) || ''}</div>
                        <p class="share-help">
                            Recipients open Simplified Viewer (developer mode) for this scene.
                            Current-view sharing is not included in this pass.
                        </p>
                        ${this.shareDialogError ? html`
                            <div class="share-dialog-error">${this.shareDialogError}</div>
                        ` : ''}
                        <div class="share-field">
                            <label for="projectShareDuration">Link duration</label>
                            <dropdown-select
                                id="projectShareDuration"
                                fullwidth
                                .value=${String(this.shareDurationHours)}
                                .options=${[
                                    { value: '1', label: '1 hour' },
                                    { value: '24', label: '24 hours' },
                                    { value: '72', label: '3 days' },
                                    { value: '168', label: '7 days' },
                                    { value: '720', label: '30 days' }
                                ]}
                                aria-label="Link duration"
                                @change=${(e) => { this.shareDurationHours = Number(e.target.value); }}
                            ></dropdown-select>
                        </div>
                        <div class="share-field">
                            <label for="projectShareEmails">Restrict to users (optional, comma-separated emails)</label>
                            <input
                                id="projectShareEmails"
                                type="text"
                                .value=${this.shareAllowedEmails}
                                @input=${(e) => { this.shareAllowedEmails = e.target.value; }}
                                placeholder="alice@example.com, bob@example.com"
                            />
                            <div class="share-help">Leave empty for anyone with the link. If set, recipients must sign in.</div>
                        </div>
                        <div class="share-dialog-actions">
                            <button class="secondary-button" type="button" @click=${() => this.closeShareDialog()}>Cancel</button>
                            <button
                                class="primary-button"
                                type="button"
                                @click=${() => this.createShareLink()}
                                ?disabled=${this.sharingFileId === this.shareTargetFile?.id}
                            >
                                ${this.sharingFileId === this.shareTargetFile?.id ? 'Creating…' : 'Create link'}
                            </button>
                        </div>
                    </div>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('project-review-page', ProjectReviewPage);
