/** HTTP client for the synchronisation server.
 *
 *  Three things live here and nowhere else: where the server is, how a
 *  request carries the identity, and what happens when the access token has
 *  expired. Spreading those across the call sites is how a request ends up
 *  silently unauthenticated.
 */
import Constants from 'expo-constants';

import { clearTokens, readTokens, saveTokens, type Tokens } from './session';

/**
 * Resolves the server address.
 *
 * During development the phone cannot reach `localhost`, because that is
 * the phone itself. The development machine's address is taken from the
 * Expo host, which is where the bundle came from and therefore where the
 * server runs too.
 */
export function resolveBaseUrl(): string {
  const configured = Constants.expoConfig?.extra?.['apiUrl'];
  if (typeof configured === 'string' && configured.length > 0) return configured;

  const hostUri = Constants.expoConfig?.hostUri ?? '';
  const host = hostUri.split(':')[0];
  if (host) return `http://${host}:4000`;

  return 'http://127.0.0.1:4000';
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail?: unknown,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** Thrown when there is no usable session and the caller must sign in. */
export class NotAuthenticatedError extends Error {
  constructor() {
    super('no hay sesión activa');
    this.name = 'NotAuthenticatedError';
  }
}

const TIMEOUT_MS = 15_000;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH';
  body?: unknown;
  token?: string;
}

async function send(path: string, options: RequestOptions = {}): Promise<Response> {
  // Without a timeout a request made as coverage drops hangs until the
  // platform gives up, which on a walk means a spinner that never resolves.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(`${resolveBaseUrl()}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  const payload = text.length > 0 ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new ApiError(response.status, payload.error ?? 'unknown', payload);
  }
  return payload as T;
}

/** A request that needs no session, used for signing up and signing in. */
export async function requestPublic<T>(path: string, options: RequestOptions = {}): Promise<T> {
  return parse<T>(await send(path, options));
}

/**
 * A request that carries the identity, renewing the access token once if
 * the server rejects it.
 *
 * The retry happens here rather than at the call sites because the access
 * token lasts fifteen minutes and a synchronisation can easily straddle
 * that boundary. If the renewal also fails the session is dropped, since
 * the refresh token is either expired or was revoked.
 */
export async function requestAuthenticated<T>(
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const tokens = await readTokens();
  if (!tokens) throw new NotAuthenticatedError();

  const first = await send(path, { ...options, token: tokens.accessToken });
  if (first.status !== 401) return parse<T>(first);

  const renewed = await renew(tokens);
  if (!renewed) {
    await clearTokens();
    throw new NotAuthenticatedError();
  }

  return parse<T>(await send(path, { ...options, token: renewed.accessToken }));
}

async function renew(tokens: Tokens): Promise<Tokens | null> {
  try {
    const response = await send('/api/auth/refresh', {
      method: 'POST',
      body: { refreshToken: tokens.refreshToken },
    });
    if (!response.ok) return null;
    const next = (await response.json()) as Tokens;
    await saveTokens(next);
    return next;
  } catch {
    return null;
  }
}

/** True when the server answers, used to decide whether to offer a sync. */
export async function serverReachable(): Promise<boolean> {
  try {
    const response = await send('/health');
    return response.ok;
  } catch {
    return false;
  }
}
