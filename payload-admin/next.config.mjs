import { withPayload } from '@payloadcms/next/withPayload'

/** @type {import('next').NextConfig} */
const nextConfig = {
    experimental: {
        // Allow imports from outside the project root (e.g. ../backend/src/payload/collections.js
        // which resolves to the /backend volume mount in Docker).
        externalDir: true,
    },
}

export default withPayload(nextConfig)
