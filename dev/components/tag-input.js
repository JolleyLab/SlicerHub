import { LitElement, html, css } from 'lit-element';
import { t } from '../i18n/index.js';

/**
 * A list of short values entered as chips: type one and press Enter or comma (pasting
 * "a, b c" adds several), Backspace in the empty box removes the last, × removes any.
 *
 * Properties:
 *   values        string[]
 *   normalize     (text) => value | null   null: not allowed (shows invalidMessage)
 *   format        (value) => chip text
 *   label         accessible name of the box; placeholder; invalidMessage ("{value}" is replaced)
 * Events:
 *   values-change — detail: { values }
 */
export class TagInput extends LitElement {
    static get properties() {
        return {
            values: { type: Array },
            label: { type: String },
            placeholder: { type: String },
            invalidMessage: { type: String },
            normalize: { attribute: false },
            format: { attribute: false },
            draft: { state: true },
            invalid: { state: true },
        };
    }

    static get styles() {
        return css`
            :host { display: block; }
            .box {
                display: flex; flex-wrap: wrap; align-items: center; gap: 6px;
                border: 1px solid var(--color-border); border-radius: 6px; padding: 6px 8px;
                background: var(--color-panel, #fff); cursor: text;
            }
            :host-context([data-theme='dark']) .box { background: var(--color-background); border-color: color-mix(in srgb, var(--color-text-secondary) 55%, var(--color-panel)); }
            .box:focus-within {
                border-color: var(--color-primary);
                box-shadow: 0 0 0 3px color-mix(in srgb, var(--color-primary) 16%, transparent);
            }
            .chip {
                display: inline-flex; align-items: center; gap: 2px; padding: 2px 4px 2px 9px;
                border-radius: 999px; font-size: 0.85rem; font-weight: 600; line-height: 1.4;
                border: 1px solid color-mix(in srgb, var(--color-primary) 35%, var(--color-border));
                background: color-mix(in srgb, var(--color-primary) 8%, transparent);
                color: var(--color-text-primary);
            }
            .chip button {
                border: 0; background: transparent; color: var(--color-text-secondary); cursor: pointer;
                font: inherit; font-size: 1rem; line-height: 1; width: 24px; height: 24px; border-radius: 50%;
                display: inline-flex; align-items: center; justify-content: center; padding: 0;
            }
            .chip button:hover, .chip button:focus-visible {
                background: color-mix(in srgb, var(--color-primary) 16%, transparent);
                color: var(--color-text-primary);
            }
            input {
                flex: 1 1 120px; min-width: 80px; border: 0; outline: none; background: transparent;
                font: inherit; font-size: 0.925rem; color: var(--color-text-primary); padding: 3px 2px;
            }
            .invalid { margin: 4px 0 0; color: var(--color-status-error-fg, #8a1212); font-size: 0.8rem; }
        `;
    }

    constructor() {
        super();
        this.values = [];
        this.label = '';
        this.placeholder = '';
        this.invalidMessage = '';
        this.normalize = (s) => String(s || '').trim() || null;
        this.format = (v) => v;
        this.draft = '';
        this.invalid = '';
    }

    _emit(values) {
        this.dispatchEvent(new CustomEvent('values-change', { detail: { values }, bubbles: true, composed: true }));
    }

    /** Add what's typed (several if separated by commas, semicolons or spaces); keep anything not allowed in the box. */
    _commit(text = this.draft) {
        const parts = String(text).split(/[\s,;]+/).filter(Boolean);
        if (!parts.length) return;
        const added = [];
        const rejected = [];
        for (const part of parts) {
            const value = this.normalize(part);
            if (value == null) rejected.push(part);
            else if (!this.values.includes(value) && !added.includes(value)) added.push(value);
        }
        if (added.length) this._emit([...this.values, ...added]);
        this.draft = rejected.join(' ');
        this.invalid = rejected.length ? this.invalidMessage.replace('{value}', rejected[0]) : '';
    }

    _onKeyDown(e) {
        if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
            e.preventDefault();
            this._commit();
        } else if (e.key === 'Backspace' && !this.draft && this.values.length) {
            this._emit(this.values.slice(0, -1));
        }
    }

    _onPaste(e) {
        const text = e.clipboardData?.getData('text') || '';
        if (!/[\s,;]/.test(text.trim())) return; // a single value: let it paste normally
        e.preventDefault();
        this._commit(`${this.draft} ${text}`);
    }

    render() {
        return html`
            <div class="box" @click=${() => this.renderRoot.querySelector('input').focus()}>
                ${this.values.map((v) => html`
                    <span class="chip">${this.format(v)}<button type="button"
                        aria-label=${t('common.removeItem', { item: this.format(v) })}
                        @click=${() => this._emit(this.values.filter((x) => x !== v))}>×</button></span>
                `)}
                <input type="text" autocomplete="off" spellcheck="false"
                    aria-label=${this.label} placeholder=${this.values.length ? '' : this.placeholder}
                    aria-invalid=${this.invalid ? 'true' : 'false'}
                    .value=${this.draft}
                    @input=${(e) => { this.draft = e.target.value; this.invalid = ''; }}
                    @keydown=${(e) => this._onKeyDown(e)}
                    @paste=${(e) => this._onPaste(e)}
                    @blur=${() => this._commit()} />
            </div>
            ${this.invalid ? html`<p class="invalid" role="alert">${this.invalid}</p>` : ''}
        `;
    }
}

customElements.define('tag-input', TagInput);
