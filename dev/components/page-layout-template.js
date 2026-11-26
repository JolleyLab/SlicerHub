import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import { getAppMenuItems, DEFAULT_MENU_KEY } from './app-menu.js';
import { loadAppFeatures } from '../services/features.js';
import { phoneMedia } from '../styles/breakpoints.js';
import './navigation-header.js';
import './side-menu.js';
import './nav-back-button.js';
import './announcement-banner.js';

/** Keep in sync with side-menu desktop/compact split. */
const COMPACT_NAV_MQ = '(max-width: 1024px)';

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
                min-width: 0;
                width: 100%;
            }

            .left-rail {
                align-self: start;
                min-width: 0;
            }

            .main-column {
                display: flex;
                flex-direction: column;
                gap: 12px;
                min-width: 0;
                width: 100%;
            }

            .compact-nav {
                display: none;
            }

            .content-region {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-surface, var(--color-background));
                box-shadow: 0 6px 18px var(--color-shadow, rgba(0, 0, 0, 0.08));
                /* Published to the page content, so edge-to-edge bars (e.g. Settings' sticky Save) can match it. */
                --content-pad-top: 20px;
                --content-pad-x: 20px;
                --content-pad-bottom: 20px;
                padding: var(--content-pad-top) var(--content-pad-x) var(--content-pad-bottom);
                min-height: 320px;
                min-width: 0;
                width: 100%;
                max-width: 100%;
                box-sizing: border-box;
            }

            :host-context([data-theme='dark']) .content-region {
                border-color: var(--color-border);
                box-shadow: 0 3px 14px rgba(0, 0, 0, 0.32);
                background: var(--color-surface);
            }

            :host-context([data-theme='dark']) .content-description {
                color: var(--color-text-secondary);
            }

            .page-heading {
                display: flex;
                flex-direction: column;
                align-items: flex-start;
                gap: 4px;
                margin: 0 0 8px;
            }

            .content-title {
                margin: 0;
                font-size: 1.3rem;
            }

            .content-description {
                margin: 0;
                color: var(--color-text-secondary);
            }

            /* ☰ sits in the top bar (navigation-header's start slot), styled like its bell and avatar buttons. */
            .hamburger-button {
                display: none;
                align-items: center;
                justify-content: center;
                width: 40px;
                height: 40px;
                padding: 0;
                border: 1px solid color-mix(in srgb, var(--color-on-primary) 40%, transparent);
                border-radius: var(--radius-md, 8px);
                background: color-mix(in srgb, var(--color-on-primary) 12%, transparent);
                color: var(--color-on-primary);
                cursor: pointer;
                flex-shrink: 0;
            }

            .hamburger-button:hover,
            .hamburger-button:focus-visible,
            .hamburger-button[aria-expanded='true'] {
                background: color-mix(in srgb, var(--color-on-primary) 24%, transparent);
            }

            /* On the coloured bar: the bar's text colour (the usual focus blue is 1.6:1 on the light theme's navy). */
            .hamburger-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-on-primary);
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .hamburger-icon {
                display: flex;
                flex-direction: column;
                gap: 5px;
                width: 18px;
            }

            .hamburger-icon span {
                display: block;
                height: 2px;
                width: 100%;
                border-radius: 1px;
                background: currentColor;
            }

            .compact-nav-panel {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                background: var(--color-surface, var(--color-background));
                padding: 8px;
                box-shadow: 0 8px 24px rgba(0, 0, 0, 0.1);
            }

            .compact-menu-list {
                display: flex;
                flex-direction: column;
                gap: 6px;
                margin: 0;
                padding: 0;
                list-style: none;
            }

            .compact-menu-button {
                width: 100%;
                box-sizing: border-box;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md, 8px);
                background: var(--color-background);
                color: var(--color-text-primary);
                padding: 10px 12px;
                text-align: left;
                font: inherit;
                font-weight: 500;
                cursor: pointer;
            }

            .compact-menu-button:hover,
            .compact-menu-button:focus-visible {
                background: var(--color-accent, color-mix(in srgb, var(--color-border) 40%, transparent));
                border-color: var(--color-primary);
            }

            .compact-menu-button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: var(--focus-ring-offset, 2px);
            }

            .compact-menu-button[aria-current='page'] {
                background: var(--color-primary);
                border-color: var(--color-primary);
                color: var(--color-on-primary);
                cursor: default;
            }

            /* Compact: hide sidebar, show hamburger — same breakpoint as layout wrap */
            @media (max-width: 1024px) {
                .page-layout {
                    grid-template-columns: minmax(0, 1fr);
                }

                .left-rail {
                    display: none;
                }

                .compact-nav:not([hidden]) {
                    display: block;
                }

                .hamburger-button {
                    display: inline-flex;
                }

                .content-region {
                    width: 100%;
                    min-height: 240px;
                    --content-pad-top: 16px;
                    --content-pad-x: 16px;
                    --content-pad-bottom: 16px;
                }
            }

            /* Phone width: no box around the content (its panels have their own), and less padding. */
            @media ${phoneMedia} {
                .app-shell {
                    gap: 12px;
                    padding: 8px;
                }

                .content-region,
                :host-context([data-theme='dark']) .content-region {
                    min-height: 0;
                    --content-pad-top: 4px;
                    --content-pad-x: 4px;
                    --content-pad-bottom: 12px;
                    border: none;
                    border-radius: 0;
                    background: transparent;
                    box-shadow: none;
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
            homeLabel: { type: String },
            compactNavOpen: { type: Boolean },
            displayName: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean },
            showBackButton: { type: Boolean },
            _announcement: { type: Object, state: true }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.username = t('common.guest');
        this.displayName = '';
        this.avatarUrl = '';
        this.selectedMenuKey = DEFAULT_MENU_KEY;
        this.pageTitle = '';
        this.pageDescription = '';
        this.menuItems = getAppMenuItems();
        this.homeHref = '/file-manager';
        this.homeLabel = t('common.home');
        this.compactNavOpen = false;
        this.isOrgAdmin = false;
        this.isRegistrationReviewer = false;
        this.showBackButton = false;
        this._announcement = null;
        this._featureFlags = {};
        this._compactMq = null;
        this._onCompactMqChange = () => {
            if (!this._compactMq?.matches) {
                this.compactNavOpen = false;
            }
        };
        this._onDocPointerDown = (event) => this.handleDocPointerDown(event);
        this._onDocKeyDown = (event) => this.handleDocKeyDown(event);
    }

    _rebuildMenu() {
        this.menuItems = getAppMenuItems({
            filesEnabled: this._featureFlags.myFiles !== false
        });
    }

    updated(changedProps) {
        if (changedProps.has('isOrgAdmin')) {
            this._rebuildMenu();
        }
    }

    connectedCallback() {
        super.connectedCallback();
        loadAppFeatures().then((flags) => {
            this._featureFlags = flags || {};
            this._rebuildMenu();
            this.requestUpdate();
        });
        fetch('/api/announcement', { credentials: 'include' })
            .then(r => r.ok ? r.json() : null)
            .then(body => { this._announcement = body?.announcement ?? null; })
            .catch(() => {});
        this._compactMq = window.matchMedia(COMPACT_NAV_MQ);
        this._compactMq.addEventListener?.('change', this._onCompactMqChange);
        document.addEventListener('pointerdown', this._onDocPointerDown, true);
        document.addEventListener('keydown', this._onDocKeyDown, true);
    }

    disconnectedCallback() {
        this._compactMq?.removeEventListener?.('change', this._onCompactMqChange);
        document.removeEventListener('pointerdown', this._onDocPointerDown, true);
        document.removeEventListener('keydown', this._onDocKeyDown, true);
        super.disconnectedCallback();
    }

    handleMenuSelectionChange(event) {
        this.compactNavOpen = false;
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    handleCompactSelect(item) {
        if (item.key === this.selectedMenuKey) {
            this.compactNavOpen = false;
            return;
        }
        this.selectedMenuKey = item.key;
        this.compactNavOpen = false;
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey: item.key, item },
            bubbles: true,
            composed: true
        }));
    }

    toggleCompactNav() {
        this.compactNavOpen = !this.compactNavOpen;
    }

    handleDocPointerDown(event) {
        if (!this.compactNavOpen) return;
        const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
        if (path.includes(this)) {
            const inside = this.renderRoot?.querySelectorAll('.compact-nav, .hamburger-button') || [];
            if ([...inside].some((el) => path.includes(el))) return;
        }
        this.compactNavOpen = false;
    }

    handleDocKeyDown(event) {
        if (!this.compactNavOpen) return;
        if (event.key === 'Escape') {
            this.compactNavOpen = false;
        }
    }

    /** ☰ for the top bar: opens the side menu's items as a list above the content (when the side menu is hidden). */
    renderMenuButton() {
        return html`
            <button
                slot="start"
                class="hamburger-button"
                type="button"
                aria-label=${this.compactNavOpen ? t('nav.closeMenu') : t('nav.openMenu')}
                aria-expanded=${this.compactNavOpen ? 'true' : 'false'}
                aria-controls="compact-nav-panel"
                @click=${() => this.toggleCompactNav()}
            >
                <span class="hamburger-icon" aria-hidden="true">
                    <span></span><span></span><span></span>
                </span>
            </button>
        `;
    }

    renderCompactNav() {
        const items = Array.isArray(this.menuItems) ? this.menuItems : [];
        return html`
            <div class="compact-nav" ?hidden=${!this.compactNavOpen}>
                <div id="compact-nav-panel" class="compact-nav-panel">
                    <ul class="compact-menu-list">
                        ${items.map((item) => {
                            const selected = item.key === this.selectedMenuKey;
                            return html`
                                <li>
                                    <button
                                        class="compact-menu-button"
                                        type="button"
                                        aria-current=${selected ? 'page' : 'false'}
                                        ?disabled=${selected}
                                        @click=${() => this.handleCompactSelect(item)}
                                    >
                                        ${item.label}
                                    </button>
                                </li>
                            `;
                        })}
                    </ul>
                </div>
            </div>
        `;
    }

    render() {
        return html`
            <div class="app-shell">
                <navigation-header
                    .username=${this.username}
                    .displayName=${this.displayName || this.username}
                    .avatarUrl=${this.avatarUrl}
                    .homeHref=${this.homeHref}
                    .homeLabel=${this.homeLabel}
                    .isOrgAdmin=${this.isOrgAdmin || false}
                    .isRegistrationReviewer=${this.isRegistrationReviewer || false}
                >${this.renderMenuButton()}</navigation-header>

                ${this._announcement ? html`
                    <announcement-banner
                        .message=${this._announcement.message}
                        .severity=${this._announcement.severity || 'info'}
                    ></announcement-banner>
                ` : ''}

                <div class="page-layout">
                    <div class="left-rail">
                        <side-menu
                            .items=${this.menuItems}
                            .selectedKey=${this.selectedMenuKey}
                            @menu-selection-change=${(e) => this.handleMenuSelectionChange(e)}
                        ></side-menu>
                    </div>

                    <div class="main-column">
                        ${this.renderCompactNav()}
                        <main class="content-region">
                            ${this.pageTitle ? html`
                                <div class="page-heading">
                                    ${this.showBackButton ? html`
                                        <nav-back-button></nav-back-button>
                                    ` : ''}
                                    <h1 class="content-title">${this.pageTitle}</h1>
                                </div>
                            ` : ''}
                            ${this.pageDescription ? html`<p class="content-description">${this.pageDescription}</p>` : ''}
                            <slot name="content"></slot>
                        </main>
                    </div>
                </div>
            </div>
        `;
    }
}

customElements.define('page-layout-template', PageShellTemplate);
