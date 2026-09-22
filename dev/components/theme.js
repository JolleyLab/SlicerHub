export const UI_COLOR_SCHEMES = {
    light: {
        background: '#ecf4f9',
        surface: '#ecf4f9',
        panel: '#ffffff',
        textPrimary: '#040316',
        textSecondary: '#0c0941',
        textContrast: '#040316',
        primary: '#074174',
        secondary: '#167aac',
        accent: '#b8cfe0',
        onPrimary: '#ecf4f9',
        onSecondary: '#ecf4f9',
        border: '#224f6b',
        focus: '#0057c2',
        // Status banners: fg/bg pairs ≥ 4.5:1 (WCAG 2.0 AA normal text)
        statusErrorBg: '#fde8e6',
        statusErrorFg: '#8a1212',
        statusErrorBorder: '#c43c32',
        statusSuccessBg: '#e6f6ed',
        statusSuccessFg: '#0b5c38',
        statusSuccessBorder: '#2f8f63'
    },
    dark: {
        // Same hierarchy as light (shared page base + lifted panels), cooler slate-indigo.
        background: '#090b14',
        surface: '#090b14',
        panel: '#161b2c',
        textPrimary: '#f0f2f8',
        textSecondary: '#c2c8d8',
        textContrast: '#090b14',
        primary: '#2c3878',
        secondary: '#3d4d9a',
        accent: '#5c6bb8',
        onPrimary: '#f2f4fa',
        onSecondary: '#f2f4fa',
        border: '#343e58',
        focus: '#8fa3d4',
        statusErrorBg: '#3a1418',
        statusErrorFg: '#ffc9c2',
        statusErrorBorder: '#e06b5f',
        statusSuccessBg: '#0f2a1c',
        statusSuccessFg: '#b6f0cf',
        statusSuccessBorder: '#3d9a6a'
    }
};

const INTER_STYLESHEET_ID = 'inter-font-stylesheet';
const INTER_STYLESHEET_URL = 'https://rsms.me/inter/inter.css';
const INTER_PRECONNECT_ID = 'inter-font-preconnect';
const INTER_PRECONNECT_URL = 'https://rsms.me/';

export function applyTheme(theme = 'light') {
    const selectedTheme = UI_COLOR_SCHEMES[theme] ? theme : 'light';
    const root = document.documentElement;
    const palette = UI_COLOR_SCHEMES[selectedTheme];

    applyTypographyDefaults(root);
    root.setAttribute('data-theme', selectedTheme);
    root.style.colorScheme = selectedTheme;

    Object.entries(palette).forEach(([key, value]) => {
        root.style.setProperty(`--color-${toKebabCase(key)}`, value);
    });

    // Squared-off clinical radii (soft corners, not pills).
    root.style.setProperty('--radius-sm', '4px');
    root.style.setProperty('--radius-md', '6px');
    root.style.setProperty('--radius-lg', '8px');

    // Strong keyboard focus ring (WCAG-friendly contrast on light and dark chrome).
    root.style.setProperty('--focus-ring-width', '3px');
    root.style.setProperty('--focus-ring-offset', '2px');
    root.style.setProperty(
        '--focus-ring',
        '0 0 0 var(--focus-ring-width) var(--color-focus)'
    );
    // Light mode: white halo under the ring so it stays visible on pale panels.
    root.style.setProperty(
        '--focus-ring-shadow',
        selectedTheme === 'light'
            ? '0 0 0 2px #ffffff, 0 0 0 5px var(--color-focus)'
            : '0 0 0 3px var(--color-focus)'
    );
}

export function initializeTheme() {
    ensureInterFontLoaded();

    let savedTheme = null;
    try {
        savedTheme = localStorage.getItem('ui-theme');
    } catch (_) {
        savedTheme = null;
    }

    const preferredTheme = savedTheme
        || (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');

    applyTheme(preferredTheme);
}

/** OS/browser light or dark preference. */
export function getSystemColorScheme() {
    if (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) {
        return 'dark';
    }
    return 'light';
}

function cacheThemeHint(theme) {
    try {
        localStorage.setItem('ui-theme', theme === 'dark' ? 'dark' : 'light');
    } catch (_) {
        /* ignore */
    }
}

/** Apply light/dark from the OS/browser preference (ignores saved account theme). */
export function applySystemColorScheme() {
    ensureInterFontLoaded();
    const theme = getSystemColorScheme();
    applyTheme(theme);
    // Hint for first-login preference migration / registration defaults.
    cacheThemeHint(theme);
}

/**
 * Keep the document theme aligned with prefers-color-scheme.
 * @returns {() => void} unsubscribe
 */
export function watchSystemColorScheme() {
    applySystemColorScheme();
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return () => {};

    const onChange = () => applySystemColorScheme();
    if (typeof mq.addEventListener === 'function') {
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }
    mq.addListener(onChange);
    return () => mq.removeListener(onChange);
}

function toKebabCase(value) {
    return value.replace(/[A-Z]/g, letter => `-${letter.toLowerCase()}`);
}

function applyTypographyDefaults(root) {
    const isVariableFontSupported = CSS && CSS.supports && CSS.supports('font-variation-settings', 'normal');
    const baseFamily = isVariableFontSupported
        ? 'InterVariable, Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif'
        : 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';

    root.style.setProperty('--font-family-base', baseFamily);
    root.style.setProperty('--font-feature-defaults', '"liga" 1, "calt" 1');
    root.style.setProperty('font-family', 'var(--font-family-base)');
    root.style.setProperty('font-feature-settings', 'var(--font-feature-defaults)');
}

function ensureInterFontLoaded() {
    const head = document.head;
    if (!head) return;

    if (!document.getElementById(INTER_PRECONNECT_ID)) {
        const preconnect = document.createElement('link');
        preconnect.id = INTER_PRECONNECT_ID;
        preconnect.rel = 'preconnect';
        preconnect.href = INTER_PRECONNECT_URL;
        head.appendChild(preconnect);
    }

    if (!document.getElementById(INTER_STYLESHEET_ID)) {
        const stylesheet = document.createElement('link');
        stylesheet.id = INTER_STYLESHEET_ID;
        stylesheet.rel = 'stylesheet';
        stylesheet.href = INTER_STYLESHEET_URL;
        head.appendChild(stylesheet);
    }
}
