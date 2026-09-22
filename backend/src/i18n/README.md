# API message catalog

User-facing response strings (validation, auth, not-found, etc.) resolve through:

```js
import { msg } from '../i18n/index.js';
throw new ValidationError(msg('auth.invalid_credentials'), null, 'auth.invalid_credentials');
```

`errorHandler` exposes `error.message` and optional `error.key` (`messageKey`) for SPA remapping later.

Do **not** put console / FATAL / ops-only text here.
