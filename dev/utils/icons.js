import { html } from 'lit-element';

/**
 * Small UI icons shared across components (24×24, currentColor).
 *
 * The drawings are from Google's Material Icons (https://github.com/google/material-design-icons),
 * Apache License 2.0 (https://www.apache.org/licenses/LICENSE-2.0). See licenses/README.md.
 */

/** Pencil: rename / edit in place. */
export const ICON_PENCIL = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M3 17.25V21h3.75l11-11.03-3.75-3.75L3 17.25zm14.81-9.06 1.83-1.83a1 1 0 0 0 0-1.41l-1.41-1.41a1 1 0 0 0-1.41 0l-1.83 1.83 2.82 2.82z"></path>
    </svg>`;

/** Trash can: remove or delete. */
export const ICON_TRASH = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"></path>
    </svg>`;

/** Arrow into a tray: download. */
export const ICON_DOWNLOAD = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path>
    </svg>`;

/** Circled "i": more information. */
export const ICON_INFO = html`
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path fill="currentColor" d="M11 7h2v2h-2V7zm0 4h2v6h-2v-6zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z"></path>
    </svg>`;

/** Eye / eye-off path data: "Public" / "Just me" (callers wrap it to size and label it). */
export const EYE_PATH = 'M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17a5 5 0 110-10 5 5 0 010 10zm0-8a3 3 0 100 6 3 3 0 000-6z';
export const EYE_OFF_PATH = 'M12 7a5 5 0 015 5c0 .65-.13 1.26-.36 1.83l2.92 2.92A11.8 11.8 0 0023 12c-1.73-4.39-6-7.5-11-7.5-1.4 0-2.74.25-3.98.7l2.16 2.16A4.85 4.85 0 0112 7zM2 4.27l2.74 2.74A11.8 11.8 0 001 12c1.73 4.39 6 7.5 11 7.5 1.55 0 3.03-.3 4.38-.84l.42.42L19.73 22 21 20.73 3.27 3 2 4.27zM7.53 9.8l1.55 1.55A3 3 0 0012 15c.22 0 .44-.03.65-.08l1.55 1.55A5 5 0 017.53 9.8zm4.31-.78l3.15 3.15.02-.16a3 3 0 00-3-3l-.17.01z';
