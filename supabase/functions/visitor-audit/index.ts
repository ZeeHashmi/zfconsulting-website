const ALLOWED_ORIGINS = new Set([
  "https://zfconsulting.com.au",
  "https://www.zfconsulting.com.au",
]);
const encoder = new TextEncoder();

function cors(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, authorization, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(origin: string, status: number, data: Record<string, unknown>) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(origin), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function hmac(value: string, secret: string) {
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function clientIp(request: Request) {
  const value = request.headers.get("cf-connecting-ip")?.trim();
  if (!value || value.length > 64 || value.includes(",")) return null;
  return value;
}

function uaDetails(ua: string) {
  const browser = /Edg\//.test(ua) ? "Microsoft Edge"
    : /Firefox\//.test(ua) ? "Firefox"
    : /CriOS|Chrome\//.test(ua) ? "Chrome"
    : /Safari\//.test(ua) && !/Chrome|CriOS/.test(ua) ? "Safari"
    : /OPR\//.test(ua) ? "Opera" : "Other";
  const os = /Windows NT 10/.test(ua) ? "Windows"
    : /Mac OS X/.test(ua) ? "macOS"
    : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Linux/.test(ua) ? "Linux" : "Other";
  const device = /iPad|Tablet/.test(ua) ? "Tablet"
    : /Mobile|iPhone|Android/.test(ua) ? "Mobile" : "Desktop";
  return { browser, operating_system: os, device_type: device };
}

async function rest(url: string, key: string, path: string, init: RequestInit = {}) {
  return await fetch(url.replace(/\/+$/, "") + path, {
    ...init,
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(5000),
  });
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  if (!ALLOWED_ORIGINS.has(origin)) return new Response("Origin not allowed", { status: 403 });
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(origin) });

  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const hmacSecret = Deno.env.get("VISITOR_AUDIT_HMAC_SECRET");
  const adminEmail = (Deno.env.get("VISITOR_AUDIT_ADMIN_EMAIL") ?? "").trim().toLowerCase();
  if (!url || !serviceKey || !hmacSecret || hmacSecret.length < 32) {
    return json(origin, 503, { error: "Visitor audit service is not configured." });
  }

  if (request.method === "GET") {
    const bearer = request.headers.get("authorization") ?? "";
    if (!bearer.startsWith("Bearer ") || !adminEmail) {
      return json(origin, 401, { error: "Administrator sign-in required." });
    }
    const userResponse = await fetch(url.replace(/\/+$/, "") + "/auth/v1/user", {
      headers: { apikey: serviceKey, Authorization: bearer },
      signal: AbortSignal.timeout(5000),
    }).catch(() => null);
    if (!userResponse?.ok) return json(origin, 401, { error: "Your session is invalid. Sign in again." });
    const user = await userResponse.json().catch(() => ({}));
    if (typeof user.email !== "string" || user.email.toLowerCase() !== adminEmail) {
      return json(origin, 403, { error: "This account is not authorised to view visitor records." });
    }
    const rows = await rest(url, serviceKey,
      "/rest/v1/visitor_audit_events?select=id,visitor_id,visited_path,browser,operating_system,device_type,country_code,ip_fingerprint,created_at&expires_at=gt.now()&order=created_at.desc&limit=200");
    if (!rows.ok) return json(origin, 503, { error: "Could not load visitor records." });
    return json(origin, 200, { events: await rows.json() });
  }

  if (request.method !== "POST") return json(origin, 405, { error: "Method not allowed." });

  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 2000) return json(origin, 413, { error: "Request too large." });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object" ||
      typeof body.visitorId !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.visitorId) ||
      typeof body.path !== "string" || !body.path.startsWith("/") ||
      body.path.length > 300 || body.path.startsWith("//")) {
    return json(origin, 400, { error: "Invalid visitor event." });
  }

  const ip = clientIp(request);
  let ipHash: string | null = null;
  if (ip) {
    ipHash = await hmac("ip:" + ip, hmacSecret);
    const limit = await rest(url, serviceKey, "/rest/v1/rpc/can_record_visitor_audit", {
      method: "POST", body: JSON.stringify({ p_ip_hash: ipHash }),
    }).catch(() => null);
    if (!limit?.ok || await limit.json().catch(() => false) !== true) {
      return json(origin, 429, { error: "Visitor recording limit reached. Please try again later." });
    }
  }

  const ua = request.headers.get("user-agent") ?? "";
  const details = uaDetails(ua);
  const country = request.headers.get("cf-ipcountry")?.trim().toUpperCase() ?? "";
  const countryCode = /^[A-Z]{2}$/.test(country) && country !== "XX" && country !== "T1" ? country : null;
  const record = await rest(url, serviceKey, "/rest/v1/visitor_audit_events", {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({
      visitor_id: body.visitorId,
      visited_path: body.path,
      browser: details.browser,
      operating_system: details.operating_system,
      device_type: details.device_type,
      country_code: countryCode,
      ip_fingerprint: ipHash ? ipHash.slice(0, 12) : null,
    }),
  });
  if (!record.ok) return json(origin, 503, { error: "Could not record this visit." });
  await rest(url, serviceKey, "/rest/v1/visitor_audit_events?expires_at=lt.now()", {
    method: "DELETE",
    headers: { Prefer: "return=minimal" },
  }).catch(() => null);
  await rest(url, serviceKey, "/rest/v1/visitor_audit_rate_limits?window_started_at=lt." +
    encodeURIComponent(new Date(Date.now() - 86400000).toISOString()), {
    method: "DELETE", headers: { Prefer: "return=minimal" },
  }).catch(() => null);
  return json(origin, 201, { recorded: true });
});
