import axios, { AxiosError } from 'axios';

/**
 * Single API client. Access token lives in memory only; the refresh token is
 * kept in localStorage for now (documented tradeoff — moves to an httpOnly
 * cookie flow before production) and rotated on every refresh.
 */
export const api = axios.create({ baseURL: '/api/v1' });

const RT_KEY = 'fiq.rt';
let accessToken: string | null = null;

export function setTokens(tokens: { accessToken: string; refreshToken?: string }): void {
  accessToken = tokens.accessToken;
  if (tokens.refreshToken) localStorage.setItem(RT_KEY, tokens.refreshToken);
}

export function clearTokens(): void {
  accessToken = null;
  localStorage.removeItem(RT_KEY);
}

export function hasSession(): boolean {
  return typeof window !== 'undefined' && localStorage.getItem(RT_KEY) !== null;
}

export async function refreshSession(): Promise<boolean> {
  const rt = localStorage.getItem(RT_KEY);
  if (!rt) return false;
  try {
    const { data } = await axios.post('/api/v1/auth/refresh', { refreshToken: rt });
    setTokens(data);
    return true;
  } catch {
    clearTokens();
    return false;
  }
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
