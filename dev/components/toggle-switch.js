import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

/**
 * On/off switch. Shows trueLabel/falseLabel after it (leave both empty for none), and
 * optional icons either side via <slot name="off"> and <slot name="on">: the current side's
 * icon is full strength, the other faded (like the theme toggle). Emits `toggle-change`
 * with { checked }.
 */
export class ToggleSwitch extends LitElement {
    static get styles() {
        return css`
            :host {
                display: inline-flex;
                align-items: center;
                gap: 8px;
                font-family: var(--font-family-base);
                font-feature-settings: var(--font-feature-defaults);
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

            .switch input:focus-visible + .slider {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 2px;
            }

            :host-context([data-theme='dark']) .slider {
                box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--color-text-secondary) 55%, var(--color-panel));
            }

            .switch input:checked + .slider {
                background-color: var(--color-primary);
            }

            .switch input:checked + .slider::before {
                transform: translateX(20px);
            }

            .switch-label {
                color: var(--color-text-primary);
                font-weight: 500;
            }

            .side {
                display: inline-flex;
                color: var(--color-text-secondary);
                opacity: 0.5;
                transition: opacity 0.2s ease, transform 0.2s ease, color 0.2s ease;
            }

            .side.active {
                opacity: 1;
                color: var(--color-text-primary);
                transform: scale(1.08);
            }

            .side:not(.has-icon) {
                display: none;
            }
        `;
    }

    static get properties() {
        return {
            checked: { type: Boolean },
            trueLabel: { type: String },
            falseLabel: { type: String },
            disabled: { type: Boolean },
            ariaLabel: { type: String, attribute: 'aria-label' }
        };
    }

    constructor() {
        super();
        initializeTheme();
        this.checked = false;
        this.trueLabel = 'On';
        this.falseLabel = 'Off';
        this.disabled = false;
        this.ariaLabel = 'Toggle switch';
    }

    _hasSlot(name) {
        return Boolean(this.querySelector(`[slot="${name}"]`));
    }

    handleChange(event) {
        this.checked = event.target.checked;
        this.dispatchEvent(new CustomEvent('toggle-change', {
            detail: { checked: this.checked },
            bubbles: true,
            composed: true
        }));
    }

    render() {
        return html`
            <span class="side ${this.checked ? '' : 'active'} ${this._hasSlot('off') ? 'has-icon' : ''}"><slot name="off"></slot></span>
            <label class="switch">
                <input
                    type="checkbox"
                    role="switch"
                    aria-label=${this.ariaLabel}
                    .checked=${this.checked}
                    ?disabled=${this.disabled}
                    @change=${this.handleChange}
                >
                <span class="slider"></span>
            </label>
            <span class="side ${this.checked ? 'active' : ''} ${this._hasSlot('on') ? 'has-icon' : ''}"><slot name="on"></slot></span>
            ${this.trueLabel || this.falseLabel
                ? html`<span class="switch-label">${this.checked ? this.trueLabel : this.falseLabel}</span>`
                : ''}
        `;
    }
}

customElements.define('toggle-switch', ToggleSwitch);
