import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

export class UserMenu extends LitElement {
    static get styles() {
        return css`
            :host {
                display: flex;
                flex-direction: column;
                gap: 10px;
                align-items: center;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .user-menu-button {
                border: 1px solid var(--color-border);
                border-radius: 50%;
                background: var(--color-accent);
                color: var(--color-text-primary);
                padding: 12px;
                cursor: pointer;
                width: 40px;
                height: 40px;
                text-align: center;
                font-family: inherit;
                font-weight: 500;
            }

            .menu {
                justify-content: space-around;
                width: 220px;
                background-color: var(--color-background);
                border-radius: 8px;
                overflow: hidden;
                z-index: 2;
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

            .theme-toggle-label {
                font-size: 14px;
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
                        <span class="theme-toggle-label">Enable Dark Mode</span>
                        <label class="switch" aria-label="Toggle theme">
                            <input type="checkbox" .checked=${isDarkTheme} @change=${this.toggleTheme}>
                            <span class="slider"></span>
                        </label>
                    </div>
                    <button class="menu-item" @click=${this.requestLogout}>Logout</button>
                </div>
            ` : ''}
        `;
    }
}

customElements.define('user-menu', UserMenu);