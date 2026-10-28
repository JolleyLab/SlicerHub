import fs from 'fs';
import path from 'path';
import { createReadStream } from 'fs';
import { OBJECT_KEY_PREFIX, CASE_KEY_PREFIX, AVATAR_KEY_PREFIX, ALLOWED_KEY_ROOTS } from './contract.js';

class LocalStorage {
    get backend() {
        return 'local';
    }

    userDir(userId) {
        return path.join(OBJECT_KEY_PREFIX, String(userId));
    }

    ensureUserDir(userId) {
        const dir = this.userDir(userId);
        fs.mkdirSync(dir, { recursive: true });
        return dir;
    }

    relativeDbPathForUser(userId, fileName) {
        return `${OBJECT_KEY_PREFIX}/${String(userId)}/${path.basename(fileName)}`;
    }

    relativeDbPathForCase(caseId, fileName) {
        return `${CASE_KEY_PREFIX}/${String(caseId)}/${path.basename(fileName)}`;
    }

    avatarKeyForSub(kcSub, ext) {
        const safe = kcSub.replace(/[^a-zA-Z0-9_-]/g, '_');
        return `${AVATAR_KEY_PREFIX}/${safe}.${ext}`;
    }

    normalizeKey(filePath) {
        return String(filePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
    }

    resolvePath(key) {
        const normalized = this.normalizeKey(key);
        const valid = ALLOWED_KEY_ROOTS.some(root => normalized.startsWith(`${root}/`));
        if (!valid || normalized.includes('..')) {
            throw new Error('Invalid storage key');
        }
        return normalized;
    }

    async exists(key) {
        const resolved = this.resolvePath(key);
        return !!resolved && fs.existsSync(resolved);
    }

    async write({ key, buffer, contentType }) {
        const resolved = this.resolvePath(key);
        fs.mkdirSync(path.dirname(resolved), { recursive: true });
        fs.writeFileSync(resolved, buffer);
        return { key: this.normalizeKey(key), bytes: buffer.length, contentType };
    }

    async openReadStream(key) {
        return createReadStream(this.resolvePath(key));
    }

    async stat(key) {
        const resolved = this.resolvePath(key);
        const info = fs.statSync(resolved);
        return { size: info.size };
    }

    /**
     * Local disk: no presigned URLs. Object backend will return HTTPS URLs for GPU pull.
     */
    async getPresignedReadUrl() {
        return null;
    }

    async copy(sourceKey, targetKey) {
        const src = this.resolvePath(sourceKey);
        const dest = this.resolvePath(targetKey);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(src, dest);
        return this.normalizeKey(targetKey);
    }

    async ensureStagedCopy({ sourceKey, userId, fileName }) {
        const targetKey = this.relativeDbPathForUser(userId, fileName);
        if (!(await this.exists(sourceKey))) {
            throw new Error(`Source file not found: ${sourceKey}`);
        }
        if (!(await this.exists(targetKey))) {
            await this.copy(sourceKey, targetKey);
        }
        return targetKey;
    }

    async delete(key) {
        const resolved = this.resolvePath(key);
        if (fs.existsSync(resolved)) {
            fs.unlinkSync(resolved);
        }
    }

    /**
     * Returns all keys whose path starts with the given prefix.
     * An object store implements this with a prefix list/query; local disk walks the directory.
     */
    async listByPrefix(prefix) {
        const normalized = this.normalizeKey(prefix);
        const dir = path.dirname(normalized);
        const base = path.basename(normalized);
        if (!fs.existsSync(dir)) return [];
        return fs.readdirSync(dir)
            .filter(f => f.startsWith(base))
            .map(f => `${dir}/${f}`);
    }
}

export default new LocalStorage();
