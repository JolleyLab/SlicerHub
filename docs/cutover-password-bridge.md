# CUTOVER: SQLite → Directus password bridge

Temporary for **one release** after `migrate-local-users-to-directus`.

## Enable

```bash
AUTH_PROVIDER=directus
AUTH_PASSWORD_BRIDGE=true
# plus DIRECTUS_URL, DIRECTUS_TOKEN, DIRECTUS_DEFAULT_ROLE_ID, Cases flags as usual
```

1. Run migrate (links + creates Directus users; temps unused while bridge is on).
2. Deploy with the flags above.
3. Users sign in with their **old app password** once → copied to Directus → local hash cleared.
4. `must_change_password` from migrate still shows the name/new-password screen (current = old password).

## Delete when the window ends

Search the repo for `CUTOVER (password-bridge)` / `CUTOVER — SQLite` and remove:

| Remove |
|--------|
| `backend/src/auth/passwordBridge.js` |
| `config.auth.passwordBridge` + startup warn in `backend/src/config/index.js` |
| Bridge block in `backend/src/auth/providers/directus.js` |
| `User.hasLocalPasswordHash` / `clearLocalPasswordHash` in `User.js` |
| `AUTH_PASSWORD_BRIDGE` from `.env` / `.env.example` |
| This doc + notes in `auth-providers.md` / migrate script |

Set `AUTH_PASSWORD_BRIDGE=false` or unset immediately when stopping the bridge; delete code in the following cleanup PR.
