/**
 * Custom error classes for consistent error handling
 */

import { msg } from '../i18n/index.js';

/**
 * Base class for application errors
 */
export class AppError extends Error {
    constructor(message, statusCode = 500, code = null, messageKey = null) {
        super(message);
        this.statusCode = statusCode;
        this.isOperational = true; // Distinguishes operational errors from programming errors
        this.code = code || null;
        /** Optional i18n catalog key (see backend/src/i18n). */
        this.messageKey = messageKey || null;
        Error.captureStackTrace(this, this.constructor);
    }

    /**
     * An error with a catalog message (backend/src/i18n) and its key, e.g.
     * ValidationError.fromKey('workflow.startup_config_key', { key }). For the subclasses below,
     * which all take (message, code, messageKey).
     */
    static fromKey(key, vars) {
        return new this(msg(key, vars), null, key);
    }
}

/**
 * 400 Bad Request - Invalid input from client
 */
export class ValidationError extends AppError {
    constructor(message = 'Invalid input', code = null, messageKey = null) {
        super(message, 400, code, messageKey);
    }
}

/**
 * 401 Unauthorized - Authentication required or failed
 */
export class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized', code = null, messageKey = null) {
        super(message, 401, code, messageKey);
    }
}

/**
 * 403 Forbidden - Authenticated but not allowed
 */
export class ForbiddenError extends AppError {
    constructor(message = 'Forbidden', code = null, messageKey = null) {
        super(message, 403, code, messageKey);
    }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
export class NotFoundError extends AppError {
    constructor(message = 'Resource not found', code = null, messageKey = null) {
        super(message, 404, code, messageKey);
    }
}

/**
 * 409 Conflict - Resource already exists
 */
export class ConflictError extends AppError {
    constructor(message = 'Resource already exists', code = null, messageKey = null) {
        super(message, 409, code, messageKey);
    }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
export class TooManyRequestsError extends AppError {
    constructor(message = 'Too many requests', code = null, messageKey = null) {
        super(message, 429, code, messageKey);
    }
}

/**
 * 500 Internal Server Error - Unexpected server errors
 */
export class InternalError extends AppError {
    constructor(message = 'Internal server error', code = null, messageKey = null) {
        super(message, 500, code, messageKey);
    }
}
