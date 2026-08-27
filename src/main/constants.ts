export const APP_PROTOCOL = 'app'
export const APP_HOST = 'bundle'
export const APP_ENTRYPOINT = `${APP_PROTOCOL}://${APP_HOST}/index.html`

export const PERSISTENCE_SCHEMA_VERSION = 1
export const MAX_PERSISTED_PROJECTION_BYTES = 256 * 1024
export const MAX_SOURCE_PACKET_BYTES = 8 * 1024 * 1024
export const MAX_SOURCE_PACKET_PREVIEW_CHARS = 20_000
