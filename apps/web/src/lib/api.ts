import axios, { AxiosError } from 'axios';

/**
 * Single API client. Access token lives in memory only; the refresh token
 * lives in an httpOnly SameSite=Strict cookie set by the API (rides the
 * same-origin Next proxy) — JavaScript never sees it. localStorage keeps
 * only a boolean "we have a session" hint for silent-restore on load.
 */
export const api = axios.create({ baseURL: '/api/v1' });

const LEGACY_RT_KEY = 'fiq.rt'; // pre-cookie storage; migrated then removed
const SESSION_FLAG = 'fiq.session';
let accessToken: string | null = null;

export function setTokens(tokens: { accessToken: string }): void {
  accessToken = tokens.accessToken;
  localStorage.setItem(SESSION_FLAG, '1');
}

export function clearTokens(): void {
  accessToken = null;
  localStorage.removeItem(SESSION_FLAG);
  localStorage.removeItem(LEGACY_RT_KEY);
}

export function hasSession(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SESSION_FLAG) === '1' || localStorage.getItem(LEGACY_RT_KEY) !== null;
}

export async function refreshSession(): Promise<boolean> {
  // One-time migration: send a legacy localStorage token in the body; the
  // response sets the cookie and the local copy is deleted forever.
  const legacy = localStorage.getItem(LEGACY_RT_KEY);
  try {
    const { data } = await axios.post(
      '/api/v1/auth/refresh',
      legacy ? { refreshToken: legacy } : {},
    );
    localStorage.removeItem(LEGACY_RT_KEY);
    setTokens(data);
    return true;
  } catch {
    clearTokens();
    return false;
  }
}

export async function serverLogout(): Promise<void> {
  try {
    await axios.post('/api/v1/auth/logout', {});
  } catch {
    // Best effort — local state is cleared regardless.
  }
  clearTokens();
}

api.interceptors.request.use((config) => {
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

let refreshing: Promise<boolean> | null = null;

api.interceptors.response.use(undefined, async (error: AxiosError) => {
  const original = error.config;
  if (error.response?.status === 401 && original && !(original as { _retried?: boolean })._retried) {
    (original as { _retried?: boolean })._retried = true;
    refreshing ??= refreshSession().finally(() => (refreshing = null));
    if (await refreshing) return api(original);
  }
  throw error;
});

/** Extract the API error message for display. */
export function apiError(err: unknown): string {
  if (axios.isAxiosError(err)) {
    const data = err.response?.data as { message?: string; details?: { message: string }[] };
    if (data?.details?.length) return data.details.map((d) => d.message).join('; ');
    if (data?.message) return data.message;
  }
  return 'Something went wrong. Please try again.';
}
