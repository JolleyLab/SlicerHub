import { LitElement, html } from 'lit-element';
import { navigationHeaderStyles } from './navigation-header.styles.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';
import './user-menu.js';
import './notification-bell.js';

export class NavigationHeader extends LitElement {
    static get styles() {
        return navigationHeaderStyles;
    }

    static get properties() {
        return {
            username: { type: String },
            homeHref: { type: String },
            homeLabel: { type: String },
            displayName: { type: String },
            avatarUrl: { type: String },
            isOrgAdmin: { type: Boolean },
            isRegistrationReviewer: { type: Boolean }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.username = t('common.guest');
        this.displayName = '';
        this.avatarUrl = '';
        this.homeHref = '/file-manager';
        this.homeLabel = t('common.home');
        this.isOrgAdmin = false;
        this.isRegistrationReviewer = false;
    }

    handleHomeClick(event) {
        // App is an SPA — avoid navigating to a non-existent /file-manager route.
        event.preventDefault();
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey: 'home' },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <header class="nav-shell">
                <a
                    class="home-link"
                    href=${this.homeHref}
                    aria-label=${t('nav.goHome')}
                    @click=${this.handleHomeClick}
                >
                    <span class="home-icon" aria-hidden="true">
                        <svg viewBox="0 0 24 24" role="img" focusable="false" aria-hidden="true">
                            <path
                                fill="currentColor"
                                d="M12 3.5L3.5 10.2a1 1 0 001.2 1.6L6 10.9V20a1 1 0 001 1h3.7a1 1 0 001-1v-4.2h.6V20a1 1 0 001 1H17a1 1 0 001-1v-9.1l1.3.9a1 1 0 001.2-1.6L12 3.5z"
                            ></path>
                        </svg>
                    </span>
                    <span class="home-text">${this.homeLabel}</span>
                </a>
                <div class="menu-region">
                    <notification-bell .isRegistrationReviewer=${this.isRegistrationReviewer || false}></notification-bell>
                    <user-menu
                        .username=${this.username}
                        .displayName=${this.displayName || this.username}
                        .avatarUrl=${this.avatarUrl}
                        .isOrgAdmin=${this.isOrgAdmin}
                    ></user-menu>
                </div>
            </header>
        `;
    }
}

customElements.define('navigation-header', NavigationHeader);
