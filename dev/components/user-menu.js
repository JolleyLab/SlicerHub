import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

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
                border: 1px solid var(--color-border);
                border-radius: 50%;
                background: var(--color-accent);
                color: var(--color-text-contrast);
                padding: 12px;
                cursor: pointer;
                width: 40px;
                height: 40px;
                text-align: center;
                font-family: inherit;
                font-weight: 500;
            }

            .menu {
                position: absolute;
                top: calc(100% + 10px);
                right: 0;
                justify-content: space-around;
                width: 220px;
                background-color: var(--color-background);
                border: 1px solid var(--color-border);
                border-radius: 8px;
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
                border-bottom-color: var(--color-background);
            }

            :host-context([data-theme='dark']) .menu {
                top: calc(100% + 18px);
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
                box-shadow:
                    0 0 0 1px color-mix(in srgb, var(--color-primary) 28%, transparent),
                    0 14px 28px rgba(0, 0, 0, 0.35);
            }

            :host-context([data-theme='dark']) .menu::before {
                border-bottom-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
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
                background: var(--color-surface-muted);
            }

            .menu-title {
                color: var(--color-text-secondary);
                padding: 10px 12px;
                font-weight: 300;
            }

            hr {
                align-self: center;
                width: 90%;
                border-top: 1px solid var(--color-text-secondary);
            }

            .theme-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                padding: 10px 12px;
                color: var(--color-text-primary);
                font-weight: 300;
            }

            .theme-toggle-control {
                display: flex;
                align-items: center;
                gap: 8px;
            }

            .theme-icon {
                font-size: 14px;
                line-height: 1;
                opacity: 0.45;
                transition: opacity 0.2s ease, transform 0.2s ease;
            }

            .theme-icon.active {
                opacity: 1;
                transform: scale(1.08);
            }

            .switch {
                position: relative;
                display: inline-block;
                width: 44px;
                height: 24px;
            }

            .switch input {
                opacity: 0;
                width: 0;
                height: 0;
            }

            .slider {
                position: absolute;
                cursor: pointer;
                inset: 0;
                background-color: var(--color-border);
                border-radius: 999px;
                transition: background-color 0.2s ease;
            }

            .slider::before {
                content: '';
                position: absolute;
                width: 18px;
                height: 18px;
                left: 3px;
                top: 3px;
                border-radius: 50%;
                background-color: #fff;
                transition: transform 0.2s ease;
            }

            .switch input:checked + .slider {
                background-color: var(--color-primary);
            }

            .switch input:checked + .slider::before {
                transform: translateX(20px);
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            open: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.username = 'Guest';
        this.open = false;
    }

    #getUNFirstLetter() {
        return this.username.charAt(0).toUpperCase();
    }

    toggleMenu() {
        this.open = !this.open;
    }

    closeMenu() {
        this.open = false;
    }

    requestLogout() {
        this.dispatchEvent(new CustomEvent('logout-request', {
            bubbles: true,
            composed: true
        }));
        this.closeMenu();
    }

    //rhisey this should be cleaned up but right now it's useful for testing
    toggleTheme() {
        const currentTheme = document.documentElement.getAttribute('data-theme') || 'light';
        const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', nextTheme);
        localStorage.setItem('ui-theme', nextTheme);
        initializeTheme();
        this.requestUpdate();
    }

    render() {
        const isDarkTheme = document.documentElement.getAttribute('data-theme') === 'dark';

        return html`
            <button class="user-menu-button" @click=${this.toggleMenu}>
                ${this.#getUNFirstLetter()}
            </button>
            ${this.open ? html`
                <div class="menu">
                    <div class="menu-title">Signed in as ${this.username}</div>
                    <hr>
                    <div class="theme-toggle-row">
                        <span>Theme</span>
                        <div class="theme-toggle-control">
                            <span class="theme-icon ${isDarkTheme ? '' : 'active'}" title="Light mode">☀</span>
                            <label class="switch" aria-label="Toggle theme">
                                <input type="checkbox" .checked=${isDarkTheme} @change=${this.toggleTheme}>
                                <span class="slider"></span>
                            </label>
                            <span class="theme-icon ${isDarkTheme ? 'active' : ''}" title="Dark mode">🌙</span>
                        </div>
                    </div>
                    <button class="menu-item" @click=${this.requestLogout}>Logout</button>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('user-menu', UserMenu);
