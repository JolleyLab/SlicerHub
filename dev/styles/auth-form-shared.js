import { css } from 'lit-element';

/**
 * Shared look for login / register / invite / change-password cards.
 * Forms stay light-DOM where needed; inject via styleText helper.
 */
export const authFormSharedStyles = css`
  :host,
  login-form,
  register-form,
  invite-accept-form,
  change-password-form {
    display: block;
    width: 100%;
    max-width: 420px;
    margin: 0 auto;
    font-family: var(--font-family-base);
    font-feature-settings: var(--font-feature-defaults);
  }

  .auth-card {
    background: var(--color-panel, var(--color-surface, #fff));
    border: 1px solid var(--color-border);
    border-radius: var(--radius-lg);
    box-shadow: 0 2px 12px color-mix(in srgb, var(--color-text-primary) 8%, transparent);
    padding: 30px;
  }

  h2 {
    margin: 0 0 20px 0;
    text-align: center;
    color: var(--color-text-primary);
    font-size: 1.35rem;
    font-weight: 600;
  }

  .form-group {
    margin-bottom: 20px;
  }

  label {
    display: block;
    margin-bottom: 5px;
    color: var(--color-text-secondary);
    font-weight: 500;
    font-size: 0.9rem;
  }

  input {
    width: 100%;
    padding: 10px 12px;
    border: 1px solid var(--color-border);
    border-radius: var(--radius-sm);
    font-size: 14px;
    box-sizing: border-box;
    background: var(--color-panel, var(--color-surface, #fff));
    color: var(--color-text-primary);
    font-family: inherit;
  }

  input::placeholder {
    color: color-mix(in srgb, var(--color-text-secondary) 65%, transparent);
  }

  input:focus {
    outline: none;
    border-color: var(--color-focus, var(--color-primary));
    box-shadow: var(--focus-ring-shadow, 0 0 0 3px var(--color-focus));
  }

  input:disabled {
    background: color-mix(in srgb, var(--color-surface) 85%, var(--color-border));
    color: var(--color-text-secondary);
  }

  button {
    width: 100%;
    padding: 12px;
    background: var(--color-primary);
    color: var(--color-on-primary);
    border: none;
    border-radius: var(--radius-sm);
    font-size: 16px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    transition: background 0.2s ease, opacity 0.2s ease;
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-primary) 88%, var(--color-text-primary));
  }

  button:focus-visible {
    outline: none;
    box-shadow: var(--focus-ring-shadow, 0 0 0 3px var(--color-focus));
  }

  button:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }

  button.secondary {
    background: transparent;
    color: var(--color-text-secondary);
    border: 1px solid var(--color-border);
    margin-top: 10px;
  }

  button.secondary:hover:not(:disabled) {
    background: color-mix(in srgb, var(--color-secondary) 12%, transparent);
    color: var(--color-text-primary);
  }

  .auth-alert {
    margin: 0 0 16px 0;
    padding: 10px 12px;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    font-size: 14px;
    font-weight: 500;
    line-height: 1.45;
    text-align: left;
  }

  .auth-alert--error {
    background: var(--color-status-error-bg, #fde8e6);
    color: var(--color-status-error-fg, #8a1212);
    border-color: var(--color-status-error-border, #c43c32);
  }

  .auth-alert--success {
    background: var(--color-status-success-bg, #e6f6ed);
    color: var(--color-status-success-fg, #0b5c38);
    border-color: var(--color-status-success-border, #2f8f63);
  }

  /* Legacy plain text class kept for any stray markup */
  .error {
    color: var(--color-status-error-fg, #8a1212);
    font-size: 14px;
    margin-top: 10px;
    text-align: center;
  }

  .success {
    color: var(--color-status-success-fg, #0b5c38);
    font-size: 14px;
    margin-top: 10px;
    text-align: center;
  }

  .hint {
    color: var(--color-text-secondary);
    font-size: 13px;
    margin: 0 0 16px 0;
    text-align: center;
    line-height: 1.4;
  }

  .spinner {
    display: inline-block;
    width: 16px;
    height: 16px;
    border: 3px solid color-mix(in srgb, var(--color-on-primary) 35%, transparent);
    border-top-color: var(--color-on-primary);
    border-radius: 50%;
    animation: auth-spin 0.8s linear infinite;
    vertical-align: middle;
    margin-right: 8px;
  }

  @keyframes auth-spin {
    to { transform: rotate(360deg); }
  }

  .switch-link {
    text-align: center;
    margin-top: 20px;
    color: var(--color-text-secondary);
    font-size: 0.9rem;
  }

  .switch-link a {
    color: var(--color-secondary);
    text-decoration: none;
    cursor: pointer;
    font-weight: 500;
  }

  .switch-link a:hover {
    text-decoration: underline;
    color: var(--color-primary);
  }
`;

/** Flatten Lit CSSResult(s) for light-DOM `<style>` injection. */
export function authFormStyleText(...extras) {
    return [authFormSharedStyles, ...extras]
        .filter(Boolean)
        .map((s) => s.cssText || '')
        .join('\n');
}
