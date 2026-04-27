export const UI_COLOR_SCHEMES = {
    light: {
        background: '#ecf4f9',
        textPrimary: '#040316',
        textSecondary: '#0c0941',
        primary: '#074174',
        secondary: '#167aac',
        accent: '#5cebd8',
        border: '#224f6b'
    },
    dark: {
        background: '#060e13',
        textPrimary: '#eae9fc',
        textSecondary: '#c1bef6',
        primary: '#8bc5f8',
        secondary: '#53b7e9',
        accent: '#14a390'
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

    Object.entries(palette).forEach(([key, value]) => {
        root.style.setProperty(`--color-${toKebabCase(key)}`, value);
    });
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
