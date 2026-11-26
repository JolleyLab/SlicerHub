# API message catalog

User-facing response strings (validation, auth, not-found, etc.) resolve through:

```js
import { msg } from '../i18n/index.js';
throw new ValidationError(msg('auth.invalid_credentials'), null, 'auth.invalid_credentials');
```

Or, shorter: `throw ValidationError.fromKey('workflow.icon_type', vars)`.

`errorHandler` sends `error.message`, and for keyed errors `error.key` and `error.vars`. The SPA shows
its own text for keys in the `api` section of `dev/i18n/locales/en.js` (so a new language only
touches `dev/i18n`); this catalog stays English, for logs and other clients. A `field` var is the
key of a field's name (`workflow.fields.name`), looked up on each side. Add new keys to both.

Do **not** put console / FATAL / ops-only text here.
