# UI localization

User-visible copy lives in `locales/en.js`. Resolve with:

```js
import { t } from '../i18n/index.js';
t('auth.login.title');
t('cases.noMatch', { query });
```

## Brand / locale packs later

```js
import { setLocaleMessages } from '../i18n/index.js';
setLocaleMessages(brandOrLocaleOverrides); // deep-merge
```

Console / internal diagnostics stay hardcoded at call sites.
API errors may also arrive as `error.message` / `error.key` from the BFF catalog (`backend/src/i18n`).
