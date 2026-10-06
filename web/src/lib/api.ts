/** Thin fetch wrapper for the cafe API. Errors carry the API's own plain-language message. */
// VITE_API_URL="/" means the API is on the same origin as the site (the Cloudflare Worker serves both).
const RAW_API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';
export const API_URL = RAW_API_URL.replace(/\/$/, '');
export const HAS_API = RAW_API_URL.length > 0;

export class ApiError extends Error {
  constructor(public status: number, message: string, public code = 'error') {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string | null; json?: unknown } = {}): Promise<T> {
  if (!HAS_API) throw new ApiError(0, 'Online ordering isn’t switched on yet.', 'offline');
  const headers: Record<string, string> = { ...(init.headers as Record<string, string>) };
  if (init.json !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  let res: Response;
  try {
    res = await fetch(API_URL + path, { ...init, headers, body: init.json !== undefined ? JSON.stringify(init.json) : init.body });
  } catch {
    throw new ApiError(0, 'Can’t reach LB’s right now. Check your connection and try again.', 'network');
  }
  if (res.status === 204) return undefined as T;
  const ct = res.headers.get('content-type') ?? '';
  const body = ct.includes('json') ? await res.json() : await res.text();
  if (!res.ok) {
    const msg = typeof body === 'object' && body?.message ? body.message : 'Something went wrong. Try again in a moment.';
    throw new ApiError(res.status, msg, typeof body === 'object' ? body?.error : 'error');
  }
  return body as T;
}

export const paiseToRupees = (p: number | string) => Number(p) / 100;
