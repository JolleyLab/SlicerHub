/*
 * Light/dark for SlicerHub's Keycloak pages.
 *
 * These pages are served from the app's own origin (<app>/sso/), so they can read
 * the app's localStorage. Order of preference:
 *   1. sh-account-theme — the theme of the last account signed in on this device
 *      (written by dev/utils/userPreferences.js); not identifying, just "light"/"dark"
 *   2. the system setting (prefers-color-scheme)
 *
 * Keycloak's own template also toggles dark mode from the system setting; this runs
 * again after it (DOMContentLoaded, and after any system change) so SlicerHub's
 * preference wins.
 */
(function () {
    var ACCOUNT_THEME_KEY = 'sh-account-theme';
    var DARK_CLASS = 'pf-v5-theme-dark';
    var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

    function preferredTheme() {
        try {
            var saved = window.localStorage.getItem(ACCOUNT_THEME_KEY);
            if (saved === 'dark' || saved === 'light') return saved;
        } catch (e) { /* storage blocked: fall through */ }
        return mq && mq.matches ? 'dark' : 'light';
    }

    function apply() {
        var theme = preferredTheme();
        var root = document.documentElement;
        root.setAttribute('data-sh-theme', theme);
        root.style.colorScheme = theme;
        if (theme === 'dark') root.classList.add(DARK_CLASS);
        else root.classList.remove(DARK_CLASS);
    }

    apply(); // as early as possible: no flash of the wrong theme

    document.addEventListener('DOMContentLoaded', function () {
        apply();
        if (mq && mq.addEventListener) {
            mq.addEventListener('change', function () { setTimeout(apply, 0); });
        }
    });
})();
