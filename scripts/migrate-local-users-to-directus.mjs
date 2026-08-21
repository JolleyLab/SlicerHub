/**
 * Wrapper: prefer backend/scripts (works in Docker: /app/scripts/...).
 * Delegates to backend/scripts/migrate-local-users-to-directus.mjs
 */
import { pathToFileURL } from 'url';
import path from 'path';
import { fileURLToPath } from 'url';

const target = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../backend/scripts/migrate-local-users-to-directus.mjs'
);
await import(pathToFileURL(target).href);
