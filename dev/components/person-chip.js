import { LitElement, html, css } from 'lit-element';
import { avatarCircleStyles } from '../styles/avatar.js';

/**
 * Avatar circle + name + optional secondary line (email, role, etc.).
 *
 * Properties:
 *   avatarUrl     String   URL for the avatar image; falls back to initials
 *   name          String   Primary display name
 *   secondaryLine String   Email, role, or any secondary text (optional)
 *
 * CSS custom property:
 *   --person-chip-size   Avatar diameter in px  (default: 32px)
 */
export class PersonChip extends LitElement {
    static get properties() {
        return {
            avatarUrl:     { type: String },
            name:          { type: String },
            secondaryLine: { type: String }
        };
    }

    static get styles() {
        return [avatarCircleStyles, css`
            :host {
                display: flex;
                align-items: center;
                gap: 10px;
                min-width: 0;
            }
            .avatar {
                width: var(--person-chip-size, 32px);
                height: var(--person-chip-size, 32px);
                flex: 0 0 var(--person-chip-size, 32px);
                border: 1px solid var(--color-border);
                background: var(--color-primary);
                color: var(--color-on-primary, #fff);
                font-size: 0.8rem;
                font-weight: 650;
            }
            :host-context([data-theme='dark']) .avatar {
                background: color-mix(in srgb, #c5cce6 55%, #5b7cff);
                color: var(--color-primary);
            }
            .identity {
                min-width: 0;
                display: flex;
                flex-direction: column;
            }
            .name {
                font-weight: 500;
                font-size: 0.875rem;
                color: var(--color-text-primary, inherit);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
            .secondary {
                font-size: 0.8rem;
                color: var(--color-text-secondary);
                white-space: nowrap;
                overflow: hidden;
                text-overflow: ellipsis;
            }
        `];
    }

    _initial() {
        const name = String(this.name || '').trim();
        if (name) return name.charAt(0).toUpperCase();
        const sec = String(this.secondaryLine || '').trim();
        if (sec) return sec.charAt(0).toUpperCase();
        return '?';
    }

    render() {
        return html`
            <div class="avatar" aria-hidden="true">
                ${this.avatarUrl
                    ? html`<img src=${this.avatarUrl} alt="">`
                    : this._initial()}
            </div>
            <div class="identity">
                <span class="name">${this.name || ''}</span>
                ${this.secondaryLine
                    ? html`<span class="secondary">${this.secondaryLine}</span>`
                    : ''}
            </div>
        `;
    }
}

customElements.define('person-chip', PersonChip);
