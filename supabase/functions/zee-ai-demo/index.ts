const PRODUCTION_ORIGINS = new Set([
  "https://zfconsulting.com.au",
  "https://www.zfconsulting.com.au",
]);
const DEVELOPMENT_ORIGINS = new Set([
  "http://localhost:8004",
  "http://127.0.0.1:8004",
]);
const MAX_REQUEST_BYTES = 16_384;
const MAX_MESSAGE_LENGTH = 2_000;
const MAX_HISTORY_MESSAGES = 8;
const encoder = new TextEncoder();

function getAllowedOrigins() {
  const environment = Deno.env.get("ZEE_AI_ENV") ?? "production";
  if (environment === "production") return PRODUCTION_ORIGINS;
  if (environment === "development") return DEVELOPMENT_ORIGINS;
  return new Set<string>();
}

function corsHeaders(origin: string) {
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Vary": "Origin",
  };
}

function jsonResponse(
  origin: string,
  status: number,
  payload: Record<string, unknown>,
) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });
}

async function hashIdentifier(
  kind: "browser" | "ip",
  value: string,
  secret: string,
) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${kind}:${value}`),
  );

  return Array.from(
    new Uint8Array(signature),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

function normalizeIpAddress(address: string): string | null {
  const octets = address.split(".");
  if (octets.length === 4 && octets.every((octet) => /^\d{1,3}$/.test(octet))) {
    if (!octets.every((octet) => Number(octet) <= 255)) return null;
    return octets.map((octet) => String(Number(octet))).join(".");
  }

  if (!address.includes(":") || address.includes("%")) return null;
  try {
    const hostname = new URL(`http://[${address}]/`).hostname;
    return hostname.startsWith("[") && hostname.endsWith("]")
      ? hostname.slice(1, -1).toLowerCase()
      : null;
  } catch {
    return null;
  }
}

function getClientIp(request: Request) {
  const clientIp = request.headers.get("cf-connecting-ip")?.trim();
  if (!clientIp || clientIp.length > 64 || clientIp.includes(",")) return null;
  return normalizeIpAddress(clientIp);
}

async function readLimitedBody(request: Request) {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/.test(contentLength)) {
      return { ok: false as const, tooLarge: false };
    }
    if (Number(contentLength) > MAX_REQUEST_BYTES) {
      return { ok: false as const, tooLarge: true };
    }
  }

  if (!request.body) return { ok: false as const, tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_REQUEST_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // Reject the oversized body even if the request stream cannot be cancelled.
        }
        return { ok: false as const, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false as const, tooLarge: false };
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      ok: true as const,
      text: new TextDecoder("utf-8", { fatal: true }).decode(body),
    };
  } catch {
    return { ok: false as const, tooLarge: false };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateMessage(value: unknown, role: "user" | "assistant") {
  if (
    !isRecord(value) || Object.keys(value).length !== 2 ||
    !Object.hasOwn(value, "role") || !Object.hasOwn(value, "content") ||
    value.role !== role ||
    typeof value.content !== "string" ||
    value.content.trim().length === 0 ||
    value.content.length > MAX_MESSAGE_LENGTH
  ) {
    return null;
  }
  return { role, content: value.content };
}

function validatePayload(payload: unknown) {
  if (
    !isRecord(payload) ||
    (Object.keys(payload).length !== 3 && Object.keys(payload).length !== 4) ||
    (Object.keys(payload).length === 4 &&
      !Object.hasOwn(payload, "experience")) ||
    !Object.hasOwn(payload, "visitorId") ||
    !Object.hasOwn(payload, "history") ||
    !Object.hasOwn(payload, "message") ||
    (Object.hasOwn(payload, "experience") &&
      payload.experience !== "zee-ai" && payload.experience !== "agent") ||
    typeof payload.visitorId !== "string" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(payload.visitorId) ||
    typeof payload.message !== "string" ||
    payload.message.trim().length === 0 ||
    payload.message.length > MAX_MESSAGE_LENGTH ||
    !Array.isArray(payload.history) ||
    payload.history.length > MAX_HISTORY_MESSAGES ||
    payload.history.length % 2 !== 0
  ) {
    return null;
  }

  const history: Array<{ role: "user" | "assistant"; content: string }> = [];
  let totalCharacters = payload.message.length;
  for (let index = 0; index < payload.history.length; index += 1) {
    const role = index % 2 === 0 ? "user" : "assistant";
    const message = validateMessage(payload.history[index], role);
    if (!message) return null;
    totalCharacters += message.content.length;
    history.push(message);
  }

  if (totalCharacters > 10_000) return null;

  return {
    visitorId: payload.visitorId,
    history,
    message: payload.message,
    experience: payload.experience === "agent" ? "agent" : "zee-ai",
  };
}

async function callRateLimitRpc(
  supabaseUrl: string,
  serviceRoleKey: string,
  functionName: string,
  body: Record<string, string>,
) {
  return await fetch(
    `${supabaseUrl.replace(/\/+$/, "")}/rest/v1/rpc/${functionName}`,
    {
      method: "POST",
      headers: {
        "apikey": serviceRoleKey,
        "Authorization": `Bearer ${serviceRoleKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    },
  );
}

function getCountryCode(request: Request) {
  const countryCode = request.headers.get("cf-ipcountry")?.trim().toUpperCase();
  return countryCode && /^[A-Z]{2}$/.test(countryCode) && countryCode !== "XX"
    ? countryCode
    : null;
}

async function checkCountryAccess(
  supabaseUrl: string,
  serviceRoleKey: string,
  ipHash: string,
  countryCode: string | null,
) {
  if (!countryCode) {
    return {
      allowed: false,
      status: 503,
      error: "We could not verify your location. Please try again later.",
    };
  }

  try {
    const blockCheck = await callRateLimitRpc(
      supabaseUrl,
      serviceRoleKey,
      "is_zee_ai_demo_ip_blocked",
      { p_ip_hash: ipHash },
    );
    if (!blockCheck.ok) throw new Error("IP block lookup failed");

    const isBlocked = await blockCheck.json() === true;
    if (countryCode === "AU") {
      return { allowed: true, status: 200, error: "" };
    }

    if (isBlocked) {
      return {
        allowed: false,
        status: 403,
        error: "AI service is for Australians.",
      };
    }

    const blockResult = await callRateLimitRpc(
      supabaseUrl,
      serviceRoleKey,
      "remember_zee_ai_demo_ip_block",
      { p_ip_hash: ipHash, p_country_code: countryCode },
    );
    if (!blockResult.ok) throw new Error("IP block record failed");
    return {
      allowed: false,
      status: 403,
      error: "AI service is for Australians.",
    };
  } catch {
    return {
      allowed: false,
      status: 503,
      error: "The AI demo is temporarily unavailable. Please try again later.",
    };
  }
}

async function releaseReservation(
  supabaseUrl: string,
  serviceRoleKey: string,
  requestId: string,
  browserHash: string,
  ipHash: string,
) {
  try {
    const response = await callRateLimitRpc(
      supabaseUrl,
      serviceRoleKey,
      "release_zee_ai_demo_request",
      {
        p_request_id: requestId,
        p_browser_hash: browserHash,
        p_ip_hash: ipHash,
      },
    );
    if (!response.ok) {
      console.error("AI demo reservation release failed:", response.status);
    }
  } catch {
    console.error("AI demo reservation release could not reach Supabase.");
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin") ?? "";
  const isAccessCheck = new URL(request.url).pathname.endsWith("/access");
  const allowedOrigins = getAllowedOrigins();
  if (!allowedOrigins.has(origin)) {
    return new Response("Origin not allowed", { status: 403 });
  }

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  if (
    (isAccessCheck && request.method !== "GET") ||
    (!isAccessCheck && request.method !== "POST")
  ) {
    return jsonResponse(origin, 405, { error: "Method not allowed." });
  }

  const openAiApiKey = Deno.env.get("OPENAI_API_KEY");
  const rateLimitSecret = Deno.env.get("RATE_LIMIT_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (
    !openAiApiKey || !rateLimitSecret || rateLimitSecret.length < 32 ||
    !supabaseUrl || !serviceRoleKey
  ) {
    return jsonResponse(origin, 503, {
      error: "The AI demo is not configured yet. Please try again later.",
    });
  }

  const clientIp = getClientIp(request);
  if (!clientIp) {
    return jsonResponse(origin, 400, {
      error: "Your network could not be verified. Please try again later.",
    });
  }

  let ipHash: string;
  try {
    ipHash = await hashIdentifier("ip", clientIp, rateLimitSecret);
  } catch {
    return jsonResponse(origin, 503, {
      error: "The AI demo is temporarily unavailable. Please try again later.",
    });
  }

  const countryAccess = await checkCountryAccess(
    supabaseUrl,
    serviceRoleKey,
    ipHash,
    getCountryCode(request),
  );
  if (!countryAccess.allowed) {
    return jsonResponse(origin, countryAccess.status, {
      error: countryAccess.error,
      blocked: countryAccess.status === 403,
    });
  }

  if (isAccessCheck) {
    return jsonResponse(origin, 200, { allowed: true });
  }

  const bodyResult = await readLimitedBody(request);
  if (!bodyResult.ok) {
    return jsonResponse(
      origin,
      bodyResult.tooLarge ? 413 : 400,
      {
        error: bodyResult.tooLarge
          ? "Your request is too large."
          : "Invalid request.",
      },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(bodyResult.text);
  } catch {
    return jsonResponse(origin, 400, { error: "Invalid request." });
  }

  const validated = validatePayload(payload);
  if (!validated) {
    return jsonResponse(origin, 400, { error: "Invalid chat request." });
  }

  let browserHash: string;
  try {
    browserHash = await hashIdentifier(
      "browser",
      validated.visitorId,
      rateLimitSecret,
    );
  } catch {
    return jsonResponse(origin, 503, {
      error: "The AI demo is temporarily unavailable. Please try again later.",
    });
  }

  const requestId = crypto.randomUUID();
  let reserved = false;
  try {
    const response = await callRateLimitRpc(
      supabaseUrl,
      serviceRoleKey,
      "reserve_zee_ai_demo_request",
      {
        p_request_id: requestId,
        p_browser_hash: browserHash,
        p_ip_hash: ipHash,
      },
    );
    if (!response.ok) {
      console.error("AI demo rate-limit reservation failed:", response.status);
      return jsonResponse(origin, 503, {
        error:
          "The AI demo is temporarily unavailable. Please try again later.",
      });
    }
    reserved = await response.json() === true;
  } catch {
    return jsonResponse(origin, 503, {
      error: "The AI demo is temporarily unavailable. Please try again later.",
    });
  }

  if (!reserved) {
    return jsonResponse(origin, 429, {
      error:
        "The demo limit is 10 successful messages per browser and IP address each UTC day. Please try again tomorrow.",
    });
  }

  let aiResponse: Response;
  try {
    aiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${openAiApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: Deno.env.get("OPENAI_MODEL") ?? "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content: validated.experience === "agent"
              ? "You are the ZF AI Agent, a helpful website demonstration for ZF Consulting Services in Brisbane, Australia. Help visitors explore practical business, writing, research, AI automation, software testing, and cybersecurity use cases. Be concise and factual. This web demo cannot access files, run programs, or control the visitor's device; never imply that it can. Do not provide binding quotes. For tailored assessments, direct visitors to info@zfconsulting.com.au. Remind visitors not to share confidential or personal information."
              : "You are Zee AI, a helpful website demonstration for ZF Consulting Services in Brisbane, Australia. Answer general questions about AI automation, cybersecurity, software testing, and consulting. Be concise and factual. Do not claim to perform actions, access private information, or provide a binding quote. If a question needs a tailored assessment, direct the visitor to info@zfconsulting.com.au. Remind visitors not to share confidential or personal information.",
          },
          ...validated.history,
          { role: "user", content: validated.message },
        ],
        max_tokens: 500,
        temperature: 0.4,
      }),
      signal: AbortSignal.timeout(25_000),
    });
  } catch {
    await releaseReservation(
      supabaseUrl,
      serviceRoleKey,
      requestId,
      browserHash,
      ipHash,
    );
    return jsonResponse(origin, 502, {
      error: "Zee AI could not respond just now. Please try again later.",
    });
  }

  if (!aiResponse.ok) {
    console.error("AI provider request failed:", aiResponse.status);
    await releaseReservation(
      supabaseUrl,
      serviceRoleKey,
      requestId,
      browserHash,
      ipHash,
    );
    return jsonResponse(origin, 502, {
      error: "Zee AI could not respond just now. Please try again later.",
    });
  }

  let aiPayload: {
    choices?: Array<{ message?: { content?: unknown } }>;
  };
  try {
    aiPayload = await aiResponse.json();
  } catch {
    await releaseReservation(
      supabaseUrl,
      serviceRoleKey,
      requestId,
      browserHash,
      ipHash,
    );
    return jsonResponse(origin, 502, {
      error: "Zee AI returned an invalid response. Please try again later.",
    });
  }

  const reply = aiPayload.choices?.[0]?.message?.content;
  if (typeof reply !== "string" || reply.trim().length === 0) {
    await releaseReservation(
      supabaseUrl,
      serviceRoleKey,
      requestId,
      browserHash,
      ipHash,
    );
    return jsonResponse(origin, 502, {
      error: "Zee AI returned an empty response. Please try again later.",
    });
  }

  try {
    const response = await callRateLimitRpc(
      supabaseUrl,
      serviceRoleKey,
      "complete_zee_ai_demo_request",
      {
        p_request_id: requestId,
        p_browser_hash: browserHash,
        p_ip_hash: ipHash,
      },
    );
    if (!response.ok || await response.json() !== true) {
      console.error("AI demo request completion failed:", response.status);
      await releaseReservation(
        supabaseUrl,
        serviceRoleKey,
        requestId,
        browserHash,
        ipHash,
      );
      return jsonResponse(origin, 503, {
        error:
          "The AI demo is temporarily unavailable. Please try again later.",
      });
    }
  } catch {
    await releaseReservation(
      supabaseUrl,
      serviceRoleKey,
      requestId,
      browserHash,
      ipHash,
    );
    return jsonResponse(origin, 503, {
      error: "The AI demo is temporarily unavailable. Please try again later.",
    });
  }

  return jsonResponse(origin, 200, { reply: reply.trim() });
});
