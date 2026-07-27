import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { getAppMenuItems, DEFAULT_MENU_KEY } from './app-menu.js';
import { loadAppFeatures } from '../services/features.js';
import './navigation-header.js';
import './side-menu.js';

export class PageShellTemplate extends LitElement {
    static get styles() {
        return css`
            :host {
                display: block;
                min-height: 100vh;
                box-sizing: border-box;
                background: var(--color-background);
                color: var(--color-text-primary);
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
            }

            .app-shell {
                display: flex;
                flex-direction: column;
                min-height: 100vh;
                gap: 16px;
                padding: 16px;
                box-sizing: border-box;
            }

            .page-layout {
                display: grid;
                grid-template-columns: 240px minmax(0, 1fr);
                gap: 16px;
                align-items: start;
                flex: 1;
            }

            .left-rail {
                align-self: start;
            }

            .content-region {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-surface, var(--color-background));
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
                padding: 20px;
                min-height: 320px;
            }

            :host-context([data-theme='dark']) .content-region {
                border-color: var(--color-border);
                box-shadow: 0 3px 14px rgba(0, 0, 0, 0.32);
                background: var(--color-surface);
            }

            :host-context([data-theme='dark']) .content-description {
                color: var(--color-text-secondary);
            }

            .content-title {
                margin: 0 0 8px;
                font-size: 1.3rem;
            }

            .content-description {
                margin: 0;
                color: var(--color-text-secondary);
            }

            @media (max-width: 900px) {
                .page-layout {
                    grid-template-columns: 1fr;
                }
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            selectedMenuKey: { type: String },
            pageTitle: { type: String },
            pageDescription: { type: String },
            menuItems: { type: Array },
            homeHref: { type: String },
            homeLabel: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.username = 'Guest';
        this.selectedMenuKey = DEFAULT_MENU_KEY;
        this.pageTitle = '';
        this.pageDescription = '';
        this.menuItems = getAppMenuItems();
        this.homeHref = '/file-manager';
        this.homeLabel = 'Home';
    }

    connectedCallback() {
        super.connectedCallback();
        loadAppFeatures().then((flags) => {
            this.menuItems = getAppMenuItems({ directusCasesEnabled: flags.directusCases });
            this.requestUpdate();
        });
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <div class="app-shell">
                <navigation-header
                    .username=${this.username}
                    .homeHref=${this.homeHref}
                    .homeLabel=${this.homeLabel}
                ></navigation-header>

                <div class="page-layout">
                    <div class="left-rail">
                        <side-menu
                            .items=${this.menuItems}
                            .selectedKey=${this.selectedMenuKey}
                            @menu-selection-change=${this.handleMenuSelectionChange}
                        ></side-menu>
                    </div>

                    <main class="content-region">
                        ${this.pageTitle ? html`<h1 class="content-title">${this.pageTitle}</h1>` : ''}
                        ${this.pageDescription ? html`<p class="content-description">${this.pageDescription}</p>` : ''}
                        <slot name="content"></slot>
                    </main>
                </div>
            </div>
        `;
    }
}

customElements.define('page-layout-template', PageShellTemplate);
