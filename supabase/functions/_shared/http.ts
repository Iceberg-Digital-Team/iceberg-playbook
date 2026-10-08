// HTTP helpers: CORS, JSON responses, body parsing, routing.
import { ApiError } from './errors.ts';
import { safeLog } from './log.ts';

const ALLOWED_HEADERS = 'authorization, apikey, content-type, x-client-info';
const ALLOWED_METHODS = 'GET, POST, PATCH, DELETE, OPTIONS';
export const MAX_BODY_BYTES = 16 * 1024;

export interface CorsCheck {
  ok: boolean;
  headers: Record<string, string>;
}

// Browser requests (with an Origin header) must come from ALLOWED_ORIGINS.
// Empty list = not configured = fail closed. Never '*', never credentials.
export function evaluateCors(request: Request, allowedOrigins: string[]): CorsCheck {
  const origin = request.headers.get('Origin');
  if (!origin) return { ok: true, headers: {} };
  if (allowedOrigins.length === 0) {
    safeLog('cors_not_configured');
    return { ok: false, headers: {} };
  }
  if (!allowedOrigins.includes(origin)) {
    safeLog('cors_origin_rejected');
    return { ok: false, headers: {} };
  }
  return {
    ok: true,
    headers: {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Headers': ALLOWED_HEADERS,
      'Access-Control-Allow-Methods': ALLOWED_METHODS,
      'Access-Control-Max-Age': '600',
      'Vary': 'Origin',
    },
  };
}

export function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  const base = { ...headers, 'Cache-Control': 'no-store' };
  if (status === 204) return new Response(null, { status, headers: base });
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...base, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export function errorResponse(error: ApiError, headers: Record<string, string> = {}): Response {
  return json(
    error.status,
    { error: { code: error.code, message: error.message, suggestion: error.suggestion } },
    { ...headers, ...error.headers },
  );
}

// JSON object body, at most MAX_BODY_BYTES. Empty body -> {}.
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) {
    throw new ApiError('invalid_input', 'The request is too large.');
  }
  if (!text.trim()) return {};
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ApiError('invalid_input', 'The request body is not valid JSON.');
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiError('invalid_input', 'The request body must be a JSON object.');
  }
  return value as Record<string, unknown>;
}

// Supabase serves a function at /functions/v1/<name>/<rest>; returns "/<rest>".
export function routePath(url: URL, functionName: string): string {
  const segments = url.pathname.split('/').filter(Boolean);
  const index = segments.indexOf(functionName);
  const rest = index >= 0 ? segments.slice(index + 1) : segments;
  return `/${rest.join('/')}`;
}

export interface RouteDefinition<Action extends string> {
  pattern: RegExp;
  methods: Partial<Record<string, Action>>;
}

// Unknown path -> 404 not_found; known path with another method -> 405 (code invalid_input).
export function matchRoute<Action extends string>(
  routes: RouteDefinition<Action>[],
  method: string,
  path: string,
): { action: Action; params: string[] } {
  for (const route of routes) {
    const match = route.pattern.exec(path);
    if (!match) continue;
    const action = route.methods[method];
    if (!action) {
      const allow = [...Object.keys(route.methods), 'OPTIONS'].join(', ');
      throw new ApiError('invalid_input', 'This method is not allowed for this path.', null, {
        status: 405,
        headers: { Allow: allow },
      });
    }
    try {
      return { action, params: match.slice(1).map(part => decodeURIComponent(part)) };
    } catch {
      throw new ApiError('invalid_input', 'The path is not valid.');
    }
  }
  throw new ApiError('not_found', 'This endpoint does not exist.');
}
