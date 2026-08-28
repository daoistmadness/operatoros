import { isIP } from "node:net";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const COOKIE_NAMES = ["astyx_session", "operatoros_setup_authorization"];

export function normalizeOrigin(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error(`Invalid allowed origin: ${value}`); }
  if (!(["http:", "https:"].includes(parsed.protocol)) || parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) throw new Error(`Invalid allowed origin: ${value}`);
  return parsed.origin;
}

export function parseAllowedOrigins(value: string | undefined, fallback: string[]): string[] {
  const raw = value === undefined ? fallback : value.split(",").map((item) => item.trim()).filter(Boolean);
  return [...new Set(raw.map(normalizeOrigin))];
}

export function isAllowedOrigin(origin: string | null, allowedOrigins: string[]): boolean {
  if (!origin || origin === "null") return false;
  try { return allowedOrigins.includes(normalizeOrigin(origin)); } catch { return false; }
}

function hasCookie(request: Request): boolean {
  const cookie = request.headers.get("cookie") ?? "";
  return COOKIE_NAMES.some((name) => new RegExp(`(?:^|;)\\s*${name}=`).test(cookie));
}

function denied(message: string, status = 403): Response {
  return new Response(JSON.stringify({ detail: message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

export function installHttpSecurity(app: any, options: { allowedOrigins: string[] }): void {
  app.onRequest(({ request, set }: any) => {
    const origin = request.headers.get("origin");
    const allowed = origin !== null && isAllowedOrigin(origin, options.allowedOrigins);
    if (origin !== null && !allowed) return denied("Request origin is not allowed.");
    if (allowed) {
      set.headers["access-control-allow-origin"] = normalizeOrigin(origin);
      set.headers["access-control-allow-credentials"] = "true";
      set.headers.vary = "Origin";
      if (request.method === "OPTIONS") {
        set.headers["access-control-allow-methods"] = "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS";
        set.headers["access-control-allow-headers"] = "content-type, x-requested-with";
        set.status = 204;
        return new Response(null, { status: 204, headers: { "access-control-allow-origin": normalizeOrigin(origin), "access-control-allow-credentials": "true", "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type, x-requested-with", vary: "Origin" } });
      }
    }
    if (!UNSAFE_METHODS.has(request.method)) return;
    if (!hasCookie(request)) return;
    if (origin === null && request.headers.has("sec-fetch-site")) return denied("A valid Origin is required for this request.");
    if (origin === null) return;
    if (!allowed) return denied("Request origin is not allowed.");
  });
}

export function parseTrustedProxyAddresses(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const addresses = value.split(",").map((item) => item.trim()).filter(Boolean);
  if (addresses.some((address) => isIP(address) === 0)) throw new Error("TRUSTED_PROXY_ADDRESSES must contain IP addresses only.");
  return [...new Set(addresses)];
}
