import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';
import { ICON_INFO } from '../utils/icons.js';

/**
 * An (i) button with an explanation: shown on hover or keyboard focus, and toggled by a click
 * or tap (touch has no hover). Escape or clicking elsewhere closes it. Screen readers get the
 * text as the button's description.
 *
 * Properties: text (the explanation), label (the button's name; default "More information").
 */
export class InfoTip extends LitElement {
    static get properties() {
        return {
            text: { type: String },
            label: { type: String },
            open: { type: Boolean, reflect: true },
        };
    }

    static get styles() {
        return css`
            :host {
                position: relative;
                display: inline-flex;
                vertical-align: middle;
                /* Don't inherit a label's caps/spacing (e.g. .form-label). */
                text-transform: none;
                letter-spacing: normal;
                font-weight: 400;
            }
            button {
                border: 0; background: transparent; padding: 0; cursor: help;
                width: 24px; height: 24px; border-radius: 50%;
                display: inline-flex; align-items: center; justify-content: center;
                color: var(--color-text-secondary);
            }
            button svg { width: 16px; height: 16px; }
            button:hover, button:focus-visible, :host([open]) button {
                color: var(--color-text-primary);
                background: color-mix(in srgb, var(--color-primary) 12%, transparent);
            }
            button:focus-visible {
                outline: var(--focus-ring-width, 3px) solid var(--color-focus, var(--color-secondary));
                outline-offset: 1px;
            }
            .bubble {
                display: none;
                position: absolute; z-index: 20; top: calc(100% + 6px); left: -8px;
                width: max-content; max-width: min(320px, 80vw);
                padding: 8px 10px; border-radius: 6px;
                font-size: 0.82rem; line-height: 1.45;
                color: var(--color-text-primary);
                background: var(--color-panel, #fff);
                border: 1px solid var(--color-border);
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
            }
            /* An invisible bridge over the gap, so moving the pointer onto the pop-up keeps it open. */
            .bubble::before { content: ''; position: absolute; left: 0; right: 0; top: -8px; height: 8px; }
            :host(:hover) .bubble, :host(:focus-within) .bubble, :host([open]) .bubble { display: block; }
        `;
    }

    constructor() {
        super();
        this.text = '';
        this.label = t('common.moreInfo');
        this.open = false;
        this._onOutside = (e) => { if (!e.composedPath().includes(this)) this.open = false; };
        this._onKey = (e) => { if (e.key === 'Escape') this.open = false; };
    }

    connectedCallback() {
        super.connectedCallback();
        document.addEventListener('click', this._onOutside, true);
        document.addEventListener('keydown', this._onKey);
    }

    disconnectedCallback() {
        document.removeEventListener('click', this._onOutside, true);
        document.removeEventListener('keydown', this._onKey);
        super.disconnectedCallback();
    }

    render() {
        return html`
            <button type="button" aria-label=${this.label} aria-describedby="tip" aria-expanded=${String(this.open)}
                @click=${() => { this.open = !this.open; }}>${ICON_INFO}</button>
            <span class="bubble" id="tip" role="tooltip">${this.text}</span>
        `;
    }
}

customElements.define('info-tip', InfoTip);
