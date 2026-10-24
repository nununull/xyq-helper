// 本地监测、客户端和转发服务共用这一份请求预算。
export const CAPTURE_INTERVAL_MS = 250
export const STABILITY_MS = 500
export const MIN_QUERY_INTERVAL_MS = 2_000
export const RATE_LIMIT_COOLDOWN_MS = 60_000
export const UPSTREAM_TIMEOUT_MS = 12_000
export const CLIENT_TIMEOUT_MS = UPSTREAM_TIMEOUT_MS + 3_000
export const MAX_IMAGE_BYTES = 1_048_576
