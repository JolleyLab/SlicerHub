import { html, css } from 'lit-element';
import { API_URL } from '../config.js';

/**
 * A square icon tile: the image when there is one, else (or if it fails to load) the name's first
 * letter. Decorative: the name is always written next to it. Size it with --icon-tile-size.
 * Needs iconTileStyles.
 */
export const iconTile = (name, src) => html`
    <span class="icon-tile" aria-hidden="true">${String(name || '?').trim().charAt(0).toUpperCase()}${src ? html`<img
        src=${src} alt="" loading="lazy"
        @load=${(e) => { e.target.hidden = false; }}
        @error=${(e) => { e.target.hidden = true; }}>` : ''}</span>`;

/** An extension's icon, from SlicerHub's own copy (backend services/extensionIcons.js). */
export const extensionIconUrl = (name, channel = 'stable') =>
    `${API_URL}/api/slicerweb/extension-icon/${channel === 'latest' ? 'latest' : 'stable'}/${encodeURIComponent(name)}`;

export const extensionIcon = (name, channel) => iconTile(name, extensionIconUrl(name, channel));

export const iconTileStyles = css`
    .icon-tile {
        --_size: var(--icon-tile-size, 32px);
        position: relative;
        flex-shrink: 0;
        width: var(--_size);
        height: var(--_size);
        border-radius: calc(var(--_size) / 5);
        overflow: hidden;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-weight: 700;
        font-size: calc(var(--_size) * 0.42);
        color: var(--color-text-secondary);
        background: color-mix(in srgb, var(--color-border) 30%, transparent);
    }

    .icon-tile img {
        position: absolute;
        inset: 0;
        width: 100%;
        height: 100%;
        object-fit: contain;
        background: var(--color-panel, #fff);
    }

    .icon-tile img[hidden] {
        display: none;
    }
`;
