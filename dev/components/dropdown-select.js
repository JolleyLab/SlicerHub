import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * Themed native select with consistent caret spacing.
 * Emits `change` (bubbles, composed) — use event.target.value or event.detail.value.
 *
 * options: [{ value, label, disabled? }]
 * variant: 'default' | 'chip' (header/toolbar chip look)
 */
export class DropdownSelect extends LitElement {
    static get styles() {
        return css`
            :host {
                display: inline-block;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
                vertical-align: middle;
            }

            :host([fullwidth]) {
                display: block;
                width: 100%;
            }

            .wrap {
                position: relative;
                display: block;
                width: 100%;
            }

            .select {
                appearance: none;
                -webkit-appearance: none;
                -moz-appearance: none;
                display: block;
                width: 100%;
                box-sizing: border-box;
                min-height: 38px;
                margin: 0;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-sm, 4px);
                padding: 8px 36px 8px 10px;
                font: inherit;
                font-size: inherit;
                line-height: 1.2;
                color: var(--color-text-primary);
                background-color: var(--color-panel, var(--color-surface, var(--color-background)));
                cursor: pointer;
                transition: border-color 0.15s ease, background-color 0.15s ease;
            }

            .wrap::after {
                content: '';
                position: absolute;
                right: 14px;
                top: 50%;
                width: 0;
                height: 0;
                border-left: 5px solid transparent;
                border-right: 5px solid transparent;
                border-top: 6px solid var(--color-text-secondary);
                transform: translateY(-35%);
                pointer-events: none;
            }

            .select:hover:not(:disabled) {
                border-color: color-mix(in srgb, var(--color-secondary) 55%, var(--color-border));
            }

            .select:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                border-color: var(--color-focus, var(--color-primary));
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
            }

            .select:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            :host-context([data-theme='dark']) .wrap::after {
                border-top-color: color-mix(in srgb, var(--color-text-secondary) 55%, #fff);
            }

            :host([variant='chip']) .select {
                min-height: 34px;
                padding: 8px 36px 8px 12px;
                border-radius: var(--radius-md, 6px);
                font-size: 14px;
                font-weight: 600;
                border-color: color-mix(in srgb, var(--color-secondary) 70%, var(--color-border));
                background-color: var(--color-secondary);
                color: var(--color-on-secondary);
            }

            :host([variant='chip']) .wrap::after {
                border-top-color: var(--color-on-secondary);
            }

            :host([variant='chip'][data-theme-light]) .select {
                background-color: var(--color-background);
                color: var(--color-primary);
                border-color: var(--color-border);
                font-weight: 500;
            }

            :host([variant='chip'][data-theme-light]) .wrap::after {
                border-top-color: var(--color-primary);
            }
        `;
    }

    static get properties() {
        return {
            value: { type: String },
            options: { type: Array },
            disabled: { type: Boolean },
            name: { type: String },
            ariaLabel: { type: String, attribute: 'aria-label' },
            fullwidth: { type: Boolean, reflect: true },
            variant: { type: String, reflect: true },
            selectId: { type: String, attribute: 'select-id' }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.value = '';
        this.options = [];
        this.disabled = false;
        this.name = '';
        this.ariaLabel = '';
        this.fullwidth = false;
        this.variant = 'default';
        this.selectId = '';
    }

    /**
     * Delegate host focus to the inner <select> so keyboard users get a single
     * tab stop (and label/for on the host still reaches the control).
     */
    createRenderRoot() {
        return this.attachShadow({ mode: 'open', delegatesFocus: true });
    }

    connectedCallback() {
        super.connectedCallback();
        this._syncThemeLightAttr();
        this._themeObserver = new MutationObserver(() => this._syncThemeLightAttr());
        this._themeObserver.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ['data-theme']
        });
    }

    disconnectedCallback() {
        this._themeObserver?.disconnect();
        this._themeObserver = null;
        super.disconnectedCallback();
    }

    _syncThemeLightAttr() {
        const isLight = document.documentElement.getAttribute('data-theme') === 'light';
        if (isLight) {
            this.setAttribute('data-theme-light', '');
        } else {
            this.removeAttribute('data-theme-light');
        }
    }

    updated(changedProperties) {
        if (changedProperties.has('value')) {
            const select = this.renderRoot?.querySelector('select');
            if (select && select.value !== String(this.value ?? '')) {
                select.value = this.value ?? '';
            }
        }
    }

    focus(options) {
        this.renderRoot?.querySelector('select')?.focus(options);
    }

    handleChange(event) {
        const next = event.target.value;
        this.value = next;
        this.dispatchEvent(new CustomEvent('change', {
            detail: { value: next },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        const options = Array.isArray(this.options) ? this.options : [];
        return html`
            <div class="wrap">
                <select
                    id=${this.selectId || ''}
                    class="select"
                    name=${this.name || ''}
                    aria-label=${this.ariaLabel || ''}
                    .value=${this.value ?? ''}
                    ?disabled=${this.disabled}
                    @change=${(e) => this.handleChange(e)}
                >
                    ${options.map((option) => html`
                        <option
                            value=${option.value}
                            ?disabled=${option.disabled === true}
                            ?selected=${String(option.value) === String(this.value)}
                        >
                            ${option.label}
                        </option>
                    `)}
                </select>
            </div>
        `;
    }
}

customElements.define('dropdown-select', DropdownSelect);
