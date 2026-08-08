const GLOBAL_BUCKETS_KEY = '__interviewPilotRateLimitBuckets';
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

export class RequestGuardError extends Error {
  constructor(message, status = 400, code = 'bad_request') {
    super(message);
    this.name = 'RequestGuardError';
    this.status = status;
    this.code = code;
  }
}

const buckets = globalThis[GLOBAL_BUCKETS_KEY] || new Map();
globalThis[GLOBAL_BUCKETS_KEY] = buckets;
let lastCleanupAt = 0;

const readHeader = (headers, name) => {
  if (!headers) return '';
  if (typeof headers.get === 'function') return String(headers.get(name) || '');
  const value = headers[name] ?? headers[name.toLowerCase()] ?? headers[name.toUpperCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
};

const firstForwardedIp = (value) => String(value || '').split(',')[0].trim();

export const getClientIp = (headers) => (
  firstForwardedIp(readHeader(headers, 'cf-connecting-ip'))
  || firstForwardedIp(readHeader(headers, 'x-real-ip'))
  || firstForwardedIp(readHeader(headers, 'x-forwarded-for'))
  || 'unknown'
);

const normalizeOrigin = (value) => {
  try {
    const url = new URL(String(value || '').trim());
    return `${url.protocol}//${url.host}`.toLowerCase();
  } catch {
    return '';
  }
};

const requestOriginForHost = (headers, protocol = 'https') => {
  const forwardedHost = readHeader(headers, 'x-forwarded-host');
  const host = forwardedHost || readHeader(headers, 'host');
  if (!host) return '';
  const forwardedProto = readHeader(headers, 'x-forwarded-proto').split(',')[0].trim();
  const scheme = forwardedProto || protocol;
  return `${scheme}://${host}`.toLowerCase();
};

const configuredOrigins = (value) => String(value || '')
  .split(',')
  .map(normalizeOrigin)
  .filter(Boolean);

export const assertAllowedOrigin = ({ headers, method, allowedOrigins = '', allowMissingOrigin = false }) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(String(method || '').toUpperCase())) return;
  const origin = normalizeOrigin(readHeader(headers, 'origin'));
  if (!origin) {
    if (allowMissingOrigin) return;
    throw new RequestGuardError('브라우저 Origin을 확인할 수 없는 요청은 허용되지 않습니다.', 403, 'origin_required');
  }

  const sameHostOrigin = requestOriginForHost(headers, origin.startsWith('http://') ? 'http' : 'https');
  const allowed = new Set([sameHostOrigin, ...configuredOrigins(allowedOrigins)].filter(Boolean));
  if (!allowed.has(origin)) {
    throw new RequestGuardError('허용되지 않은 Origin의 요청입니다.', 403, 'origin_denied');
  }
};

const cleanupBuckets = (now) => {
  if (now - lastCleanupAt < CLEANUP_INTERVAL_MS) return;
  lastCleanupAt = now;
  for (const [key, bucket] of buckets.entries()) {
    if (!bucket || bucket.resetAt + CLEANUP_INTERVAL_MS < now) buckets.delete(key);
  }
};

export const assertRateLimit = ({ headers, namespace, limit = 20, windowMs = 60_000 }) => {
  const now = Date.now();
  cleanupBuckets(now);
  const ip = getClientIp(headers);
  const key = `${namespace}:${ip}`;
  const current = buckets.get(key);

  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { remaining: Math.max(0, limit - 1), resetAt: now + windowMs, ip };
  }

  if (current.count >= limit) {
    throw new RequestGuardError('요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.', 429, 'rate_limited');
  }

  current.count += 1;
  return { remaining: Math.max(0, limit - current.count), resetAt: current.resetAt, ip };
};

export const assertJsonRequest = ({ headers, method, body, maxBytes = 4_000_000 }) => {
  if (String(method || '').toUpperCase() !== 'POST') return;
  const contentType = readHeader(headers, 'content-type').toLowerCase();
  if (!contentType.includes('application/json')) {
    throw new RequestGuardError('Content-Type은 application/json이어야 합니다.', 415, 'content_type');
  }

  const declaredLength = Number(readHeader(headers, 'content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new RequestGuardError('요청 본문이 허용 크기를 초과했습니다.', 413, 'payload_too_large');
  }

  if (body !== undefined && body !== null) {
    let encodedLength = 0;
    try {
      encodedLength = new TextEncoder().encode(JSON.stringify(body)).byteLength;
    } catch {
      throw new RequestGuardError('요청 본문이 올바른 JSON 객체가 아닙니다.', 400, 'invalid_json');
    }
    if (encodedLength > maxBytes) {
      throw new RequestGuardError('요청 본문이 허용 크기를 초과했습니다.', 413, 'payload_too_large');
    }
  }
};

export const guardRequest = ({
  headers,
  method,
  body,
  namespace,
  allowedOrigins = '',
  limit = 20,
  windowMs = 60_000,
  maxBytes = 4_000_000,
  allowMissingOrigin = false,
}) => {
  assertAllowedOrigin({ headers, method, allowedOrigins, allowMissingOrigin });
  const rate = assertRateLimit({ headers, namespace, limit, windowMs });
  assertJsonRequest({ headers, method, body, maxBytes });
  return rate;
};
