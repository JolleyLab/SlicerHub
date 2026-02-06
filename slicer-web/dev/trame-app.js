import { LitElement, html, css } from 'lit-element';
import { API_URL } from './config.js';
import './login-form.js';
import './register-form.js';
import './file-manager.js';

export class TrameApp extends LitElement {
  static get styles() {
    return css`
      :host {
        display: block;
        padding: 16px;
      }

      .header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: #f5f5f5;
        border-bottom: 1px solid #ddd;
        margin: -16px -16px 16px -16px;
      }

      .user-info {
        display: flex;
        align-items: center;
        gap: 15px;
      }

      .user-name {
        font-weight: 500;
        color: #333;
      }

      .logout-btn {
        padding: 8px 16px;
        background: #f44336;
        color: white;
        border: none;
        border-radius: 4px;
        cursor: pointer;
        font-size: 14px;
      }

      .logout-btn:hover {
        background: #d32f2f;
      }

      .controls {
        border: solid 1px gray;
        padding: 16px;
        margin-bottom: 10px;
      }

      .spinner {
        display: inline-block;
        width: 16px;
        height: 16px;
        border: 3px solid rgba(0, 0, 0, 0.2);
        border-top-color: rgba(0, 0, 0, 0.8);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
        vertical-align: middle;
        margin-right: 8px;
      }

      iframe {
        width: 100%;
        height: calc(100vh - 200px);
        border: 1px solid #ccc;
        margin-top: 10px;
      }

      @keyframes spin {
        to { transform: rotate(360deg); }
      }

      .auth-container {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f5f5f5;
      }
    `;
  }

  static get properties() {
    return {
      name: { type: String },
      output: { type: String },
      loading: { type: Boolean },
      useIframe: { type: Boolean },
      showIframe: { type: Boolean },
      iframeUrl: { type: String },
      // Auth properties
      isAuthenticated: { type: Boolean },
      user: { type: Object },
      showLogin: { type: Boolean }
    };
  }

  constructor() {
    super();
    this.name = "World";
    this.output = "";
    this.loading = false;
    this.useIframe = false;
    this.showIframe = false;
    this.iframeUrl = "";

    // Auth state
    this.isAuthenticated = false;
    this.user = null;
    this.showLogin = true; // Show login by default
    this.inactivityTimeout = null;

    // Check for existing session
    this.checkExistingSession();
  }


  async checkExistingSession() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include' // Send cookies
      });

      if (res.ok) {
        const data = await res.json();
        this.user = data.user;
        this.isAuthenticated = true;
        this.name = this.user.username;
        this.startInactivityTimer();
      }
    } catch (err) {
      // No valid session - stay logged out
      console.log('No existing session');
    }
  }

  handleLoginSuccess(e) {
    const { user } = e.detail;
    this.user = user;
    this.isAuthenticated = true;
    this.name = user.username;
    this.startInactivityTimer();
  }

  handleRegisterSuccess(e) {
    const { user } = e.detail;
    this.user = user;
    this.isAuthenticated = true;
    this.name = user.username;
  }

  handleShowRegister() {
    this.showLogin = false;
  }

  handleShowLogin() {
    this.showLogin = true;
  }

  startInactivityTimer() {
    // Clear any existing timer
    this.stopInactivityTimer();

    const INACTIVITY_TIMEOUT = 30 * 60 * 1000; // 30 minutes

    // Reset timer on any user activity
    const resetTimer = () => {
      this.stopInactivityTimer();
      this.inactivityTimeout = setTimeout(() => {
        console.log('User inactive for 30 minutes, logging out...');
        this.handleLogout();
      }, INACTIVITY_TIMEOUT);
    };

    // Track various user activities
    this.activityEvents = ['mousedown', 'mousemove', 'keypress', 'scroll', 'touchstart', 'click'];
    this.resetTimer = resetTimer;

    this.activityEvents.forEach(event => {
      document.addEventListener(event, resetTimer, true);
    });

    // Start initial timer
    resetTimer();
  }

  stopInactivityTimer() {
    if (this.inactivityTimeout) {
      clearTimeout(this.inactivityTimeout);
      this.inactivityTimeout = null;
    }

    // Remove event listeners
    if (this.resetTimer && this.activityEvents) {
      this.activityEvents.forEach(event => {
        document.removeEventListener(event, this.resetTimer, true);
      });
    }
  }

  async handleLogout() {
    try {
      // Stop any running containers before logout
      await fetch(`${API_URL}/api/containers/stop`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include'
      }).catch(err => console.log('Container cleanup on logout:', err.message));

      // Call logout API (this clears the cookie)
      await fetch(`${API_URL}/api/auth/logout`, {
        method: 'POST',
        credentials: 'include'
      });
    } catch (err) {
      console.error('Logout error:', err);
    }

    // Clear state
    this.user = null;
    this.isAuthenticated = false;
    this.showLogin = true;

    // Stop inactivity timer
    this.stopInactivityTimer();

    // Cleanup any running containers
    await this.cleanupContainer();
  }

  connectedCallback() {
    super.connectedCallback();
    // Cleanup any existing containers when page loads
    if (this.isAuthenticated) {
      this.cleanupContainer();
    }

    // Don't cleanup on main page unload anymore - only when Trame window closes
  }

  async cleanupContainer() {
    if (!this.isAuthenticated) return;

    try {
      await fetch(`${API_URL}/api/containers/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      });
      console.log("Cleaned up existing container");
    } catch (err) {
      // Ignore errors - container might not exist
    }
  }

  render() {
    // Show auth forms if not authenticated
    if (!this.isAuthenticated) {
      return html`
        <div class="auth-container">
          ${this.showLogin
          ? html`<login-form 
                @login-success=${this.handleLoginSuccess}
                @show-register=${this.handleShowRegister}>
              </login-form>`
          : html`<register-form 
                @register-success=${this.handleRegisterSuccess}
                @show-login=${this.handleShowLogin}>
              </register-form>`
        }
        </div>
      `;
    }

    // Show main app if authenticated
    return html`
      <div class="header">
        <div class="user-info">
          <span class="user-name">Welcome, ${this.user.username}!</span>
        </div>
        <button class="logout-btn" @click=${this.handleLogout}>Logout</button>
      </div>
      
      <!-- Old Trame controls - commented out but kept for reference
      <div class="controls">
        <h1>Hello, ${this.name}!</h1>
        
        <div>
          <label>
            <input type="checkbox" ?checked=${this.useIframe} @change=${this.toggleMode}>
            Open in iframe (embedded)
          </label>
        </div>
        
        <button @click=${this.startTrame} ?disabled=${this.loading}>
          ${this.loading
        ? html`<span class="spinner"></span>Starting Trame…`
        : 'Start Trame'}
        </button>
        
        ${this.showIframe ? html`
          <button @click=${this.closeIframe}>Close Trame</button>
        ` : ''}

        <pre>${this.output}</pre>
      </div>
      
      ${this.showIframe ? html`
        <iframe src="${this.iframeUrl}"></iframe>
      ` : ''}
      -->

      <!-- File Manager Section -->
      <file-manager></file-manager>
    `;
  }

  toggleMode(e) {
    this.useIframe = e.target.checked;
  }

  startTrame() {
    if (this.useIframe) {
      this._startTrameAsync(null);
    } else {
      const newWindow = window.open("", "_blank");
      if (!newWindow) {
        this.output = "Popup blocked! Please allow popups for this site.";
        return;
      }
      newWindow.document.write("<h2>Starting Trame… please wait</h2>");
      this._startTrameAsync(newWindow);
    }
  }

  async closeIframe() {
    this.showIframe = false;
    this.iframeUrl = "";

    // Stop the container
    try {
      await fetch(`${API_URL}/api/containers/stop`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      });
      this.output = "Trame container stopped";
    } catch (err) {
      console.error("Error stopping container:", err);
    }
  }

  monitorWindowClosed(windowRef) {
    const checkInterval = setInterval(() => {
      if (windowRef.closed) {
        clearInterval(checkInterval);
        console.log("Trame window closed, cleaning up container...");
        this.cleanupContainer();
        this.output = "Trame window closed, container stopped";
      }
    }, 1000); // Check every second
  }

  async _startTrameAsync(newWindow) {
    this.loading = true;
    try {
      // Clean up any existing container first
      await this.cleanupContainer();

      const res = await fetch(`${API_URL}/api/containers/start`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        credentials: 'include'
      });

      if (!res.ok) {
        const errorText = await res.text();
        throw new Error(`Failed to start job: ${res.status} - ${errorText}`);
      }

      const data = await res.json();
      const url = data.frontendUrl;

      if (this.useIframe) {
        // Wait a moment for Trame to fully start, then show iframe
        await new Promise(resolve => setTimeout(resolve, 2000));
        this.iframeUrl = url;
        this.showIframe = true;
        this.output = "Trame app loaded in iframe";
      } else {
        // Wait for Trame to start, then redirect new window
        newWindow.document.write("<h2>Starting Trame, please wait a few seconds...</h2>");
        await new Promise(resolve => setTimeout(resolve, 3000));
        newWindow.location.href = url;
        this.output = "Trame app opened in new tab";

        // Monitor the new window and cleanup when it closes
        this.monitorWindowClosed(newWindow);
      }
    } catch (err) {
      console.error(err);
      this.output = err.message;
      if (newWindow) {
        newWindow.document.write(`<p style="color:red;">${err.message}</p>`);
      }
    } finally {
      this.loading = false;
    }
  }

  async pollUrl(url, timeout = 60000, interval = 1000) {
    const start = Date.now();
    let attempts = 0;
    while (Date.now() - start < timeout) {
      try {
        attempts++;
        console.log(`Polling attempt ${attempts}: ${url}`);
        const r = await fetch(url, { mode: 'cors' });
        console.log(`Poll response: ${r.status} ${r.statusText}`);
        if (r.ok || r.status === 200) {
          console.log('Polling successful!');
          return;
        }
      } catch (e) {
        console.log(`Poll error: ${e.message}`);
      }
      await new Promise(r => setTimeout(r, interval));
    }
    throw new Error("Trame app did not become ready in time");
  }
}

customElements.define('trame-app', TrameApp);
