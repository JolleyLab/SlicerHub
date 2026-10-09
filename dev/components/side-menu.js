import { LitElement, html } from 'lit-element';
import { sideMenuStyles } from './side-menu.styles.js';
import { initializeTheme } from './theme.js';
import { t } from '../i18n/index.js';

/**
 * Desktop left-rail section menu.
 * Compact / hamburger navigation lives in page-layout-template (≤1024px).
 */
export class SideMenu extends LitElement {
    static get styles() {
        return sideMenuStyles;
    }

    static get properties() {
        return {
            items: { type: Array },
            selectedKey: { type: String }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.items = [
            { key: 'my-projects', label: t('nav.myProjects') },
            { key: 'my-files', label: t('nav.myFiles') }
        ];
        this.selectedKey = 'my-projects';
        this._boundHandleViewportChange = this.updateVisibleHeight.bind(this);
    }

    connectedCallback() {
        super.connectedCallback();
        window.addEventListener('resize', this._boundHandleViewportChange);
        requestAnimationFrame(() => this.updateVisibleHeight());
    }

    disconnectedCallback() {
        window.removeEventListener('resize', this._boundHandleViewportChange);
        super.disconnectedCallback();
    }

    firstUpdated() {
        this.updateVisibleHeight();
    }

    updateVisibleHeight() {
        // Only stretch the desktop rail. Compact nav is handled by page-layout.
        if (window.matchMedia('(max-width: 1024px)').matches) {
            this.style.setProperty('--side-menu-visible-height', 'auto');
            return;
        }
        const pagePadding = 16;
        const minimumHeight = 120;
        const topOffset = this.getBoundingClientRect().top;
        const availableHeight = Math.max(minimumHeight, window.innerHeight - topOffset - pagePadding);
        this.style.setProperty('--side-menu-visible-height', `${availableHeight}px`);
    }

    handleSelect(item) {
        if (item.key === this.selectedKey) {
            return;
        }

        this.selectedKey = item.key;
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: { selectedKey: item.key, item },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <nav aria-label=${t('nav.sectionNav')}>
                <ul class="menu-list">
                    ${this.items.map((item) => {
            const isSelected = item.key === this.selectedKey;
            return html`
                            <li class="menu-item">
                                <button
                                    class="menu-button"
                                    aria-current=${isSelected ? 'page' : 'false'}
                                    ?disabled=${isSelected}
                                    @click=${() => this.handleSelect(item)}
                                >
                                    ${item.label}
                                </button>
                            </li>
                        `;
        })}
                </ul>
            </nav>
        `;
    }
}

customElements.define('side-menu', SideMenu);
