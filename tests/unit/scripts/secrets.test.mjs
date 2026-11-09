import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// bootstrap.mjs: secrets generated into .env before the first `docker compose up`.
const { ensureSecrets, secretsOnKnownDefaults, SECRETS } = await import('../../../scripts/lib/secrets.mjs');
const { readEnvFile } = await import('../../../scripts/lib/env.mjs');

function tempEnv(content) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-'));
    const file = path.join(dir, '.env');
    fs.writeFileSync(file, content, 'utf8');
    return file;
}

test('a fresh install gets a random value for every secret', () => {
    const file = tempEnv('COMPOSE_PROFILES=keycloak,payload\n');
    const written = ensureSecrets(file, () => false);
    assert.deepEqual(written.map((w) => w.how), SECRETS.map(() => 'generated'));
    const env = readEnvFile(file);
    for (const s of SECRETS) {
        assert.match(env[s.key], /^[0-9a-f]{32,}$/, s.key);
        assert.notEqual(env[s.key], s.legacyDefault);
    }
    assert.equal(env.COMPOSE_PROFILES, 'keycloak,payload', 'other settings are kept');
    assert.deepEqual(secretsOnKnownDefaults(file), []);
});

test('values already in .env are never replaced', () => {
    const file = tempEnv('PAYLOAD_SECRET=mine\nAUTH_TOKEN_KEY=also-mine\n');
    const written = ensureSecrets(file, () => false);
    assert.ok(!written.some((w) => ['PAYLOAD_SECRET', 'AUTH_TOKEN_KEY'].includes(w.key)));
    assert.equal(readEnvFile(file).PAYLOAD_SECRET, 'mine');
    assert.deepEqual(ensureSecrets(file, () => false), [], 'a second run changes nothing');
});

test('an existing database keeps the password it was created with', () => {
    const file = tempEnv('');
    ensureSecrets(file, (volume) => volume === 'keycloak-db-data');
    const env = readEnvFile(file);
    assert.equal(env.KEYCLOAK_DB_PASSWORD, 'keycloak-dev-password');
    assert.equal(env.KEYCLOAK_ADMIN_PASSWORD, 'admin');
    assert.notEqual(env.PAYLOAD_DB_PASSWORD, 'payload-dev-password', 'no Payload volume yet: random');
    assert.deepEqual(secretsOnKnownDefaults(file).sort(), ['KEYCLOAK_ADMIN_PASSWORD', 'KEYCLOAK_DB_PASSWORD']);
});
