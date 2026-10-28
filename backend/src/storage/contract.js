/**
 * Storage backend contract (local disk today; S3-API object store later).
 *
 * DB `files.file_path` is always an object key — never an absolute host path.
 * Examples:
 *   userFiles/42/uuid-scene.mrb
 *   caseFiles/abc-123/def-456-report.pdf
 *
 * Required methods:
 * - relativeDbPathForUser(userId, fileName) -> key
 * - relativeDbPathForCase(caseId, fileName) -> key
 * - avatarKeyForSub(kcSub, ext) -> key
 * - normalizeKey(filePath) -> key
 * - exists(key) -> boolean
 * - write({ key, buffer, contentType? })
 * - openReadStream(key) -> Readable
 * - stat(key) -> { size }
 * - delete(key)
 * - copy(sourceKey, targetKey) -> targetKey
 * - listByPrefix(prefix) -> key[]   (object store: prefix list; local: readdir filter)
 * - ensureStagedCopy({ sourceKey, userId, fileName }) -> key
 * - getPresignedReadUrl(key, expiresInSeconds?) -> url | null
 *   (null = backend must stream bytes itself, e.g. local disk)
 */

export const OBJECT_KEY_PREFIX  = 'userFiles';
export const CASE_KEY_PREFIX    = 'caseFiles';
export const AVATAR_KEY_PREFIX  = 'avatars';

/** All roots that resolvePath() considers valid. */
export const ALLOWED_KEY_ROOTS = [OBJECT_KEY_PREFIX, CASE_KEY_PREFIX, AVATAR_KEY_PREFIX];
