const PRODUCTION_ORIGINS = new Set([
  'https://zfconsulting.com.au',
  'https://www.zfconsulting.com.au',
]);
const DEVELOPMENT_ORIGINS = new Set([
  'http://localhost:8004',
  'http://127.0.0.1:8004',
]);
const PAGE_PATHS = new Set([
  'index.html',
  'ai-agent.html',
  'ai-automation.html',
  'ai-security-governance.html',
  'api-security-testing.html',
  'contact.html',
  'cyber-security-pricing.html',
  'cyber-security.html',
  'cybersecurity.html',
  'free-performance-testing.html',
  'penetration-testing.html',
  'software-testing.html',
  'zee-ai.html',
]);
const SIGNALS = new Set(['email', 'phone', 'pricing', 'contact']);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_BODY_BYTES = 4_096;
const encoder = new TextEncoder();

function allowedOrigins() {
  const environment = Deno.env.get('ZEE_AI_ENV') ?? 'production';
  if (environment === 'production') return PRODUCTION_ORIGINS;
  if (environment === 'development') return DEVELOPMENT_ORIGINS;
  return new Set<string>();
}

function headers(origin: string) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Headers': 'apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

function response(origin: string, status = 204) {
  return new Response(status === 204 ? null : JSON.stringify({ accepted: false }), {
    status,
    headers: {
      ...headers(origin),
      ...(status === 204 ? {} : { 'Content-Type': 'application/json' }),
      'Cache-Control': 'no-store',
    },
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalText(value: unknown, maximum: number) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > maximum) return false;
  const clean = value.trim();
  if ([...clean].some((character) => character.charCodeAt(0) < 32)) return false;
  return clean || null;
}

function validDomain(value: unknown) {
  const domain = optionalText(value, 160);
  if (domain === false || domain === null) return domain;
  if (!/^[a-z0-9.-]+$/i.test(domain) || domain.startsWith('.') || domain.endsWith('.')) return false;
  return domain.toLowerCase();
}

function validatePayload(value: unknown) {
  if (!isRecord(value)) return null;
  const allowedKeys = new Set([
    'sessionId', 'eventType', 'page', 'signal', 'referrerDomain',
    'utmSource', 'utmMedium', 'utmCampaign',
  ]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return null;
  if (typeof value.sessionId !== 'string' || !UUID_PATTERN.test(value.sessionId)) return null;
  if (value.eventType !== 'page_view' && value.eventType !== 'interest_click') return null;
  if (typeof value.page !== 'string' || !PAGE_PATHS.has(value.page)) return null;
  if (value.eventType === 'page_view' && value.signal !== undefined && value.signal !== null) return null;
  if (value.eventType === 'interest_click' && (typeof value.signal !== 'string' || !SIGNALS.has(value.signal))) return null;

  const referrerDomain = validDomain(value.referrerDomain);
  const utmSource = optionalText(value.utmSource, 80);
  const utmMedium = optionalText(value.utmMedium, 80);
  const utmCampaign = optionalText(value.utmCampaign, 80);
  if (referrerDomain === false || utmSource === false || utmMedium === false || utmCampaign === false) return null;

  return {
    sessionId: value.sessionId,
    eventType: value.eventType,
    page: value.page,
    signal: value.eventType === 'interest_click' ? value.signal as string : null,
    referrerDomain,
    utmSource,
    utmMedium,
    utmCampaign,
  };
}

async function readBody(request: Request) {
  const length = request.headers.get('content-length');
  if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BODY_BYTES)) return null;
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > MAX_BODY_BYTES) {
      try { await reader.cancel(); } catch { /* Best-effort cancellation. */ }
      return null;
    }
    chunks.push(value);
  }

  try {
    const bytes = new Uint8Array(byteLength);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

async function keyedHash(kind: string, value: string, secret: string) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(`${kind}:${value}`));
  return Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clientIp(request: Request) {
  const value = request.headers.get('cf-connecting-ip')?.trim();
  if (!value || value.length > 64 || value.includes(',')) return 'unavailable';
  return value;
}

function countryCode(request: Request) {
  const value = request.headers.get('cf-ipcountry')?.trim().toUpperCase();
  return value && /^[A-Z]{2}$/.test(value) && value !== 'XX' && value !== 'T1' ? value : '';
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin') ?? '';
  if (!allowedOrigins().has(origin)) return response('', 403);
  if (request.method === 'OPTIONS') return response(origin);
  if (request.method !== 'POST') return response(origin, 405);

  const body = await readBody(request);
  let payload: ReturnType<typeof validatePayload> = null;
  try {
    payload = body ? validatePayload(JSON.parse(body)) : null;
  } catch {
    payload = null;
  }
  if (!payload) return response(origin, 400);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const hashSecret = Deno.env.get('VISITOR_INTELLIGENCE_SECRET') ?? Deno.env.get('RATE_LIMIT_SECRET');
  if (!supabaseUrl || !serviceRoleKey || !hashSecret) return response(origin, 503);

  try {
    const [sessionHash, ipHash] = await Promise.all([
      keyedHash('session', payload.sessionId, hashSecret),
      keyedHash('rate', clientIp(request), hashSecret),
    ]);
    const rpcResponse = await fetch(
      `${supabaseUrl.replace(/\/+$/, '')}/rest/v1/rpc/record_zf_visitor_event`,
      {
        method: 'POST',
        headers: {
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          p_event_id: crypto.randomUUID(),
          p_session_hash: sessionHash,
          p_ip_hash: ipHash,
          p_event_type: payload.eventType,
          p_page_path: payload.page,
          p_signal: payload.signal,
          p_referrer_domain: payload.referrerDomain,
          p_country_code: countryCode(request),
          p_utm_source: payload.utmSource,
          p_utm_medium: payload.utmMedium,
          p_utm_campaign: payload.utmCampaign,
        }),
        signal: AbortSignal.timeout(5_000),
      },
    );
    if (!rpcResponse.ok) return response(origin, 503);
    if (await rpcResponse.json() !== true) return response(origin, 429);
    return response(origin);
  } catch {
    return response(origin, 503);
  }
});
