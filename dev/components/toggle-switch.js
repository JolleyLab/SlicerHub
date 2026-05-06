import { LitElement, html, css } from 'lit-element';
import { initializeTheme } from './theme.js';

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
            <label class="switch" aria-label=${this.ariaLabel}>
                <input
                    type="checkbox"
                    .checked=${this.checked}
                    ?disabled=${this.disabled}
                    @change=${this.handleChange}
                >
                <span class="slider"></span>
            </label>
            <span class="switch-label">${this.checked ? this.trueLabel : this.falseLabel}</span>
        `;
    }
}

customElements.define('toggle-switch', ToggleSwitch);
