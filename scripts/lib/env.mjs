/**
 * Shared helpers for the setup scripts (bootstrap, setup-*): reading and updating
 * the repo's .env, and asking questions on the terminal.
 *
 * migrate-from-directus.mjs keeps its own copies on purpose: it is run on its own, on
 * whichever machine holds the data.
 */

import fs from 'fs';
import readline from 'readline';

/** KEY=value pairs from an .env file ({} if it doesn't exist). Comments and blank lines skipped. */
export function readEnvFile(filePath) {
    if (!fs.existsSync(filePath)) return {};
    return Object.fromEntries(
        fs.readFileSync(filePath, 'utf8')
            .split('\n')
            .filter(line => line.includes('=') && !line.trim().startsWith('#'))
            .map(line => {
                const idx = line.indexOf('=');
                return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
            })
    );
}

/** Set KEY=value in an .env file: replaces the line (even a commented-out one), else appends. */
export function upsertEnvVar(filePath, key, value) {
    const line = `${key}=${value}`;
    if (!fs.existsSync(filePath)) {
        fs.writeFileSync(filePath, `${line}\n`, 'utf8');
        return;
    }
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    const idx = lines.findIndex(l => l.match(new RegExp(`^\\s*#?\\s*${key}\\s*=`)));
    if (idx !== -1) {
        lines[idx] = line;
        fs.writeFileSync(filePath, lines.join('\n'), 'utf8');
    } else {
        const sep = content.endsWith('\n') ? '' : '\n';
        fs.appendFileSync(filePath, `${sep}${line}\n`, 'utf8');
    }
}

/** Ask a question; resolves with the trimmed answer. */
export function prompt(question) {
    return new Promise(resolve => {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.question(`  ${question}`, answer => {
            rl.close();
            resolve(answer.trim());
        });
    });
}

/** Ask for a secret without echoing what is typed. */
export function promptSecret(question) {
    return new Promise(resolve => {
        process.stdout.write(`  ${question}`);
        const rl = readline.createInterface({ input: process.stdin, output: null }); // null output: no echo
        rl.once('line', answer => {
            process.stdout.write('\n');
            rl.close();
            resolve(answer.trim());
        });
    });
}
