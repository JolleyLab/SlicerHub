import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

/**
 * Throws an error in production if a required value is missing
 * In development, returns a default value with a warning
 */
function requireInProduction(envVar, defaultValue, errorMessage) {
    const value = process.env[envVar];

    if (!value) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error(errorMessage || `${envVar} is required in production`);
        }
        console.warn(`⚠️  WARNING: ${envVar} not set. Using default: "${defaultValue}"`);
        console.warn(`   Set this in production for security!`);
        return defaultValue;
    }

    return value;
}

/**
 * Central configuration for the application
 * All environment-dependent values should be defined here
 */
const config = {
    // Environment
    env: process.env.NODE_ENV || 'development',
    isDevelopment: (process.env.NODE_ENV || 'development') === 'development',
    isProduction: process.env.NODE_ENV === 'production',

    // Server
    server: {
        port: parseInt(process.env.PORT || '8080', 10),
        host: process.env.HOST || '0.0.0.0',
        corsOrigins: process.env.CORS_ORIGINS
            ? process.env.CORS_ORIGINS.split(',')
            : ['http://localhost:8000', 'http://localhost:8082']
    },

    // JWT Authentication
    jwt: {
        secret: requireInProduction(
            'JWT_SECRET',
            'dev-secret-CHANGE-IN-PRODUCTION',
            'JWT_SECRET must be set in production for security'
        ),
        expiresIn: process.env.JWT_EXPIRES_IN || '7d',
        algorithm: 'HS256'
    },

    // Database
    database: {
        path: process.env.DB_PATH || path.join(__dirname, '../../data/users.db')
    },

    // Docker
    docker: {
        socketPath: os.platform() === 'win32'
            ? '//./pipe/docker_engine'
            : '/var/run/docker.sock',
        network: process.env.DOCKER_NETWORK || 'trame-net',
        defaultImage: process.env.DOCKER_IMAGE || 'slicer-web-trame:local'
    },

    // Security
    security: {
        bcryptRounds: parseInt(process.env.BCRYPT_ROUNDS || '10', 10),
        passwordMinLength: parseInt(process.env.PASSWORD_MIN_LENGTH || '8', 10),
        sessionIdleMinutes: parseInt(process.env.SESSION_IDLE_MINUTES || '30', 10)
    }
};

// Validate configuration on startup
if (config.isProduction && config.jwt.secret.includes('dev-secret')) {
    throw new Error('FATAL: Cannot use default JWT secret in production!');
}

export default config;
