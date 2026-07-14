import { LitElement, html, css } from 'lit-element';
import { applyTheme, initializeTheme } from './theme.js';

/**
 * Reusable light/dark theme control.
 * Emits `theme-change` with { theme: 'light' | 'dark' }.
 */
export class ThemeToggle extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .theme-toggle-row {
                display: flex;
                align-items: center;
                justify-content: space-between;
                gap: 12px;
                color: var(--color-text-primary);
                font-weight: 300;
            }

            .theme-label {
                font-weight: 500;
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
            theme: { type: String },
            label: { type: String },
            disabled: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.theme = document.documentElement.getAttribute('data-theme') || 'light';
        this.label = 'Theme';
        this.disabled = false;
    }

    connectedCallback() {
        super.connectedCallback();
        this.theme = document.documentElement.getAttribute('data-theme') || 'light';
    }

    setTheme(nextTheme) {
        const theme = nextTheme === 'dark' ? 'dark' : 'light';
        try {
            localStorage.setItem('ui-theme', theme);
        } catch (_) {
            /* ignore */
        }
        applyTheme(theme);
        this.theme = theme;
        this.dispatchEvent(new CustomEvent('theme-change', {
            detail: { theme },
            bubbles: true,
            composed: true
        }));
    }

    handleToggle(event) {
        this.setTheme(event.target.checked ? 'dark' : 'light');
    }

    render() {
        const isDarkTheme = this.theme === 'dark';
        return html`
            <div class="theme-toggle-row">
                <span class="theme-label">${this.label}</span>
                <div class="theme-toggle-control">
                    <span class="theme-icon ${isDarkTheme ? '' : 'active'}" title="Light mode">☀</span>
                    <label class="switch" aria-label="Toggle theme">
                        <input
                            type="checkbox"
                            .checked=${isDarkTheme}
                            ?disabled=${this.disabled}
                            @change=${(e) => this.handleToggle(e)}
                        >
                        <span class="slider"></span>
                    </label>
                    <span class="theme-icon ${isDarkTheme ? 'active' : ''}" title="Dark mode">🌙</span>
                </div>
            </div>
        `;
    }
}

customElements.define('theme-toggle', ThemeToggle);
