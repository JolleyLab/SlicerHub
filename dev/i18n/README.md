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
## API errors

The backend sends `error.message` (English) and, for most errors, `error.key` and `error.vars`
(`backend/src/i18n`). The `api` section of `locales/en.js` holds the browser's text for those keys
(snake_case, matching the server's); `apiErrorText()` in `services/apiResponse.js` picks it, and
`apiError()` uses it before the server's message. A `field` var is itself a key (e.g.
`workflow.fields.name`) and is translated too. Keys not yet in `api` show the server's message, so
sections move over one at a time (workflows, validation and owned_doc so far).
