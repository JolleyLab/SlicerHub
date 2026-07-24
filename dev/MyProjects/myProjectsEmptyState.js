import { LitElement, html, css } from 'lit-element';
import { APP_MENU_ITEMS } from '../components/app-menu.js';
import '../components/page-layout-template.js';
import '../components/add-button.js';
import '../components/page-content-message.js';
import { listMyProjects } from '../services/projects.js';

export class MyProjectsLandingPage extends LitElement {
    static get styles() {
        return css`
            .project-grid {
                margin-top: 16px;
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
                gap: 14px;
                padding: 2px;
            }

            .project-card {
                border: 1px solid var(--color-border);
                border-radius: var(--radius-lg);
                background: var(--color-panel, var(--color-surface, var(--color-background)));
                padding: 12px;
                display: flex;
                flex-direction: column;
                gap: 8px;
                cursor: pointer;
                transition: box-shadow 0.2s ease, transform 0.2s ease, border-color 0.2s ease;
                box-shadow: 0 2px 12px rgba(0, 0, 0, 0.06);
                text-align: left;
                font: inherit;
                color: inherit;
                width: 100%;
                appearance: none;
                -webkit-appearance: none;
            }

            .project-card:hover {
                box-shadow: 0 6px 14px var(--color-shadow, rgba(0, 0, 0, 0.12));
                transform: translateY(-1px);
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
            }

            .project-card:focus-visible {
                outline: 3px solid var(--color-focus, #0057c2);
                outline-offset: 2px;
                border-color: var(--color-focus, #0057c2);
                box-shadow: var(--focus-ring-shadow, 0 0 0 2px #fff, 0 0 0 5px #0057c2);
                transform: translateY(-1px);
            }

            :host-context([data-theme='dark']) .project-card {
                border-color: color-mix(in srgb, var(--color-border) 75%, var(--color-primary));
                box-shadow: 0 4px 16px rgba(0, 0, 0, 0.28);
            }

            :host-context([data-theme='dark']) .project-card:hover {
                border-color: color-mix(in srgb, var(--color-primary) 45%, var(--color-border));
                box-shadow: 0 6px 14px rgba(0, 0, 0, 0.32);
            }

            :host-context([data-theme='dark']) .project-card:focus-visible {
                outline: 3px solid var(--color-focus, #9db7ff);
                outline-offset: 2px;
                border-color: var(--color-focus, #9db7ff);
                box-shadow:
                    0 0 0 3px var(--color-focus, #9db7ff),
                    0 6px 14px rgba(0, 0, 0, 0.32);
            }

            .project-name {
                color: var(--color-text-primary);
                font-weight: 600;
            }

            .project-meta {
                color: var(--color-text-secondary);
                font-size: 0.92rem;
            }

            .creator-badge {
                align-self: flex-start;
                font-size: 0.78rem;
                color: var(--color-text-secondary);
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                padding: 3px 8px;
                background: color-mix(in srgb, var(--color-primary) 10%, transparent);
            }

            .load-more {
                margin-top: 14px;
                border: 1px solid var(--color-border);
                border-radius: var(--radius-md);
                background: transparent;
                color: var(--color-text-primary);
                min-height: 38px;
                padding: 8px 12px;
                font: inherit;
                cursor: pointer;
            }

            .load-more:disabled {
                opacity: 0.6;
                cursor: not-allowed;
            }

            add-button {
                margin-top: 16px;
            }
        `;
    }

    static get properties() {
        return {
            username: { type: String },
            menuItems: { type: Array },
            projects: { type: Array },
            loading: { type: Boolean },
            loadingMore: { type: Boolean },
            error: { type: String },
            hasMore: { type: Boolean },
            pageSize: { type: Number },
            offset: { type: Number }
        };
    }

    constructor() {
        super();
        this.username = 'Guest';
        this.menuItems = APP_MENU_ITEMS;
        this.projects = [];
        this.loading = false;
        this.loadingMore = false;
        this.error = '';
        this.hasMore = false;
        this.pageSize = 20;
        this.offset = 0;
    }

    connectedCallback() {
        super.connectedCallback();
        this.loadInitialProjects();
    }

    handleMenuSelectionChange(event) {
        this.dispatchEvent(new CustomEvent('menu-selection-change', {
            detail: event.detail,
            bubbles: true,
            composed: true
        }));
    }

    handleCreateProjectRequest() {
        this.dispatchEvent(new CustomEvent('create-project-request', {
            bubbles: true,
            composed: true
        }));
    }

    handleProjectSelected(project) {
        this.dispatchEvent(new CustomEvent('project-selected', {
            detail: { projectId: project.id },
            bubbles: true,
            composed: true
        }));
    }

    async loadInitialProjects() {
        this.loading = true;
        this.error = '';
        this.offset = 0;
        try {
            const data = await listMyProjects({ limit: this.pageSize, offset: 0 });
            this.projects = data.projects || [];
            this.hasMore = !!data.pagination?.hasMore;
            this.offset = this.projects.length;
        } catch (error) {
            this.error = error.message || 'Unable to load projects.';
            this.projects = [];
            this.hasMore = false;
            this.offset = 0;
        } finally {
            this.loading = false;
        }
    }

    async loadMoreProjects() {
        if (this.loadingMore || !this.hasMore) return;
        this.loadingMore = true;
        this.error = '';
        try {
            const data = await listMyProjects({ limit: this.pageSize, offset: this.offset });
            const next = data.projects || [];
            this.projects = [...this.projects, ...next];
            this.hasMore = !!data.pagination?.hasMore;
            this.offset = this.projects.length;
        } catch (error) {
            this.error = error.message || 'Unable to load more projects.';
        } finally {
            this.loadingMore = false;
        }
    }

    roleLabel(role) {
        if (role === 'admin') return 'Admin';
        if (role === 'collaborator') return 'Collaborator';
        return 'Observer';
    }

    render() {
        return html`
            <page-layout-template
                .menuItems=${this.menuItems}
                .username=${this.username}
                selectedMenuKey="my-projects"
                homeHref="/file-manager"
                homeLabel="Home"
                pageTitle="My Projects"
                pageDescription="A place to view and manage your projects."
                @menu-selection-change=${this.handleMenuSelectionChange}
            >
                ${this.loading ? html`
                    <page-content-message slot="content" variant="status" message="Loading projects..."></page-content-message>
                ` : ''}
                ${this.error ? html`
                    <page-content-message slot="content" variant="error" .message=${this.error}></page-content-message>
                ` : ''}
                ${!this.loading && this.projects.length === 0 ? html`
                    <page-content-message slot="content" variant="empty" message="Your project list is empty."></page-content-message>
                ` : ''}
                ${this.projects.length > 0 ? html`
                    <div slot="content" class="project-grid">
                        ${this.projects.map((project) => html`
                            <button
                                class="project-card"
                                type="button"
                                @click=${() => this.handleProjectSelected(project)}
                            >
                                <div class="project-name">${project.name}</div>
                                <div class="project-meta">Role: ${this.roleLabel(project.role)}</div>
                                ${project.isCreator ? html`<div class="creator-badge">Creator</div>` : ''}
                            </button>
                        `)}
                    </div>
                    ${this.hasMore ? html`
                        <button
                            slot="content"
                            class="load-more"
                            type="button"
                            ?disabled=${this.loadingMore}
                            @click=${() => this.loadMoreProjects()}
                        >
                            ${this.loadingMore ? 'Loading...' : 'Load more'}
                        </button>
                    ` : ''}
                ` : ''}
                <add-button
                    slot="content"
                    title="Create New Project"
                    @add-button-click=${() => this.handleCreateProjectRequest()}
                ></add-button>
            </page-layout-template>
        `;
    }
}

class MyProjectsEmptyStateAlias extends MyProjectsLandingPage {}

customElements.define('my-projects-landing-page', MyProjectsLandingPage);
customElements.define('my-projects-empty-state', MyProjectsEmptyStateAlias);
