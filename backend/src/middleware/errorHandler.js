import config from '../config/index.js';
import { AppError } from '../utils/errors.js';

/**
 * Centralized error handling middleware
 * Should be registered AFTER all routes in Express
 */
export function errorHandler(err, req, res, next) {
    // Only log unexpected errors, not auth failures (they're normal)
    const isAuthError = err.statusCode === 401 || err.statusCode === 403;

    if (!isAuthError || config.isDevelopment) {
        console.error('Error occurred:', {
            message: err.message,
            statusCode: err.statusCode,
            path: req.path,
            method: req.method,
            timestamp: new Date().toISOString()
        });
    }

    // Determine status code
    const statusCode = err.statusCode || 500;

    // Determine if we should expose error details
    const isOperationalError = err instanceof AppError && err.isOperational;

    // Build error response
    const errorResponse = {
        error: {
            message: isOperationalError ? err.message : 'Internal server error',
            status: statusCode
        }
    };

    // In development, add more details to help debugging
    if (config.isDevelopment) {
        errorResponse.error.stack = err.stack;
        errorResponse.error.details = err;
    }

    res.status(statusCode).json(errorResponse);
}

/**
 * Handles 404 errors for undefined routes
 * Should be registered AFTER all routes but BEFORE errorHandler
 */
export function notFoundHandler(req, res, next) {
    res.status(404).json({
        error: {
            message: `Route ${req.method} ${req.path} not found`,
            status: 404
        }
    });
}

/**
 * Wraps async route handlers to catch promise rejections
 * Usage: router.get('/path', asyncHandler(async (req, res) => { ... }))
 */
export function asyncHandler(fn) {
    return (req, res, next) => {
        Promise.resolve(fn(req, res, next)).catch(next);
    };
}
