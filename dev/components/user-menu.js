import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

export class UserMenu extends LitElement {
    static get styles() {
        return css`
            :host {
                position: relative;
                display: inline-flex;
                align-items: center;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .user-menu-button {
                border: 1px solid color-mix(in srgb, var(--color-on-primary) 40%, transparent);
                border-radius: 50%;
                background: var(--color-secondary);
                color: var(--color-on-secondary);
                padding: 12px;
                cursor: pointer;
                width: 40px;
                height: 40px;
                text-align: center;
                font-family: inherit;
                font-weight: 650;
                box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
            }

            .user-menu-button:hover,
            .user-menu-button:focus-visible {
                background: var(--color-accent);
                color: var(--color-text-primary);
                border-color: color-mix(in srgb, var(--color-accent) 55%, var(--color-border));
            }

            :host-context([data-theme='dark']) .user-menu-button {
                background: var(--color-secondary);
                color: var(--color-on-secondary);
                border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
                font-weight: 650;
                box-shadow: 0 1px 6px rgba(0, 0, 0, 0.2);
            }

            :host-context([data-theme='dark']) .user-menu-button:hover,
            :host-context([data-theme='dark']) .user-menu-button:focus-visible {
                background: color-mix(in srgb, var(--color-secondary) 78%, #fff);
                color: var(--color-on-secondary);
                border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
            }

            .user-menu-button:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .menu {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                justify-content: space-around;
                width: max-content;
                min-width: 220px;
                /* Fit "Signed in as " + up to 35 name chars; longer names wrap inside this cap. */
                max-width: min(92vw, calc(24px + 14ch + 35ch));
                background-color: var(--color-panel, var(--color-surface, var(--color-background)));
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                overflow: hidden;
                box-shadow: 0 10px 28px var(--color-shadow, rgba(0, 0, 0, 0.16));
                z-index: 20;
            }

            .menu::before {
                content: '';
                position: absolute;
                bottom: 100%;
                right: 14px;
                border: 7px solid transparent;
                border-bottom-color: var(--color-border);
            }

            .menu::after {
                content: '';
                position: absolute;
                bottom: 100%;
                right: 14px;
                margin-bottom: -1px;
                border: 7px solid transparent;
                border-bottom-color: var(--color-panel, var(--color-surface, var(--color-background)));
            }

            :host-context([data-theme='dark']) .menu {
                top: calc(100% + 18px);
                border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
                box-shadow:
                    0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent),
                    0 14px 28px rgba(0, 0, 0, 0.35);
            }

            :host-context([data-theme='dark']) .menu::before {
                border-bottom-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
            }

            .menu-item {
                display: block;
                width: 100%;
                border: none;
                background: transparent;
                color: var(--color-text-primary);
                padding: 10px 12px;
                text-align: left;
                cursor: pointer;
                font-family: inherit;
                font-weight: 300;
            }

            .menu-item:hover {
                background: color-mix(in srgb, var(--color-primary) 10%, var(--color-panel, var(--color-surface, var(--color-background))));
            }

            .menu-title {
                color: var(--color-text-secondary);
                padding: 10px 12px;
                font-weight: 300;
                white-space: nowrap;
            }

            .menu-title strong {
                color: var(--color-text-primary);
                font-weight: 650;
            }

            .menu-title.is-long {
                white-space: normal;
                overflow-wrap: break-word;
            }

            hr {
                align-self: center;
                width: 90%;
                border-top: 1px solid var(--color-text-secondary);
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            /** Preferred label: "First Last" or email (Directus-era accounts). */
            displayName: { type: String },
            open: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.username = t('common.guest');
        this.displayName = '';
        this.open = false;
    }

    #getDisplayLabel() {
        return String(this.displayName || this.username || '').trim() || t('common.guest');
    }

    #getUNFirstLetter() {
        const label = this.#getDisplayLabel();
        // Prefer letter from name; for email use local-part initial.
        const source = label.includes('@') ? label.split('@')[0] : label;
        const ch = source.charAt(0);
        return ch ? ch.toUpperCase() : '?';
    }

    toggleMenu() {
        this.open = !this.open;
    }

    closeMenu() {
        this.open = false;
    }

    requestSettings() {
        this.dispatchEvent(new CustomEvent('settings-request', {
            bubbles: true,
            composed: true
        }));
        this.closeMenu();
    }

    requestLogout() {
        this.dispatchEvent(new CustomEvent('logout-request', {
            bubbles: true,
            composed: true
        }));
        this.closeMenu();
    }

    render() {
        const label = this.#getDisplayLabel();
        const nameIsLong = label.length > 35;
        return html`
            <button class="user-menu-button" @click=${this.toggleMenu}>
                ${this.#getUNFirstLetter()}
            </button>
            ${this.open ? html`
                <div class="menu">
                    <div class="menu-title ${nameIsLong ? 'is-long' : ''}">${t('nav.signedInAs')} <strong>${label}</strong></div>
                    <hr>
                    <button class="menu-item" @click=${this.requestSettings}>${t('nav.settings')}</button>
                    <button class="menu-item" @click=${this.requestLogout}>${t('nav.logOut')}</button>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('user-menu', UserMenu);
