/**
 * Storage backend contract (local disk today; S3-API object store later).
 *
 * DB `files.file_path` is always an object key, e.g. userFiles/42/uuid-scene.mrb
 * — never an absolute host path.
 *
 * Required methods:
 * - relativeDbPathForUser(userId, fileName) -> key
 * - normalizeKey(filePath) -> key
 * - exists(key) -> boolean
 * - write({ key, buffer, contentType? })
 * - openReadStream(key) -> Readable
 * - stat(key) -> { size }
 * - delete(key)
 * - ensureStagedCopy({ sourceKey, userId, fileName }) -> key
 * - getPresignedReadUrl(key, expiresInSeconds?) -> url | null
 *   (null = backend must stream bytes itself, e.g. local disk)
 */

export const OBJECT_KEY_PREFIX = 'userFiles';
