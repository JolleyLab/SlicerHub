/**
 * Application configuration
 * This file centralizes environment-specific settings for easier deployment
 */

// API Base URL - defaults to localhost for development
// Port 8080: start.ps1 script (native Node.js)
// For production, set API_URL environment variable before bundling
export const API_URL = typeof process !== 'undefined' && process.env && process.env.API_URL
    ? process.env.API_URL
    : 'http://localhost:8080';

// Trame Server URL - used for iframe previews
export const TRAME_URL = typeof process !== 'undefined' && process.env && process.env.TRAME_URL
    ? process.env.TRAME_URL
    : 'http://localhost:8000';

export default {
    API_URL,
    TRAME_URL
};
