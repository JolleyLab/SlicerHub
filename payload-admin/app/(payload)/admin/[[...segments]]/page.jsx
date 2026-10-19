import { RootPage, generatePageMetadata } from '@payloadcms/next/views'
import config from '../../../../payload.config.js'
import { importMap } from '../importMap.js'

export const generateMetadata = ({ params, searchParams }) =>
    generatePageMetadata({ config, params, searchParams })

export default function Page({ params, searchParams }) {
    return RootPage({ config, importMap, params, searchParams })
}
