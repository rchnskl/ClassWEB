/**
 * Base URL of the API, baked into the browser bundle at build time.
 *
 * The localhost fallback is deliberately restricted to non-production builds.
 * It used to apply everywhere, which meant a production build run without
 * NEXT_PUBLIC_API_URL exported shipped a site that pointed every request at
 * the developer's own machine — it deployed cleanly, served every asset, and
 * only failed once a real user tried to log in. Failing the build is the
 * cheaper place to find that out, so a production build without the variable
 * now throws during static generation instead of shipping.
 *
 * The value lives in apps/web/.env.production (committed — it is public by
 * definition, since it ends up in the client bundle), so a normal build picks
 * it up without anyone having to remember.
 */
function resolveApiBase(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL;
  if (configured) return configured;
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. A production build must not fall back to ' +
        'http://localhost:3001 — that ships a site nobody but the person who built ' +
        'it can use. Set it in apps/web/.env.production (or the deploy environment).',
    );
  }
  return 'http://localhost:3001/api/v1';
}

export const API_BASE = resolveApiBase();

// ---------------------------------------------------------------------------
// In-flight request tracking, for a global "something is happening" status
// bar (see components/GlobalLoadingBar.tsx). Every apiFetch call counts
// itself while in flight so no page has to wire this up individually.
// ---------------------------------------------------------------------------
let activeRequests = 0;
const loadingListeners = new Set<() => void>();

export function subscribeApiLoading(listener: () => void): () => void {
  loadingListeners.add(listener);
  return () => { loadingListeners.delete(listener); };
}

export function isApiLoading(): boolean {
  return activeRequests > 0;
}

function beginRequest() {
  activeRequests += 1;
  if (activeRequests === 1) loadingListeners.forEach((l) => l());
}
function endRequest() {
  activeRequests = Math.max(0, activeRequests - 1);
  if (activeRequests === 0) loadingListeners.forEach((l) => l());
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function token(): string | null {
  return typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
}

/** Single in-flight refresh so concurrent 401s don't stampede /auth/refresh. */
let refreshInFlight: Promise<string | null> | null = null;

/**
 * Exchange the stored refresh token for a fresh access token.
 * Returns the new access token, or null if the session can no longer be refreshed
 * (invalid/expired refresh token, or the server's absolute 3-hour cap was reached).
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (typeof window === 'undefined') return null;
  if (refreshInFlight) return refreshInFlight;

  const refreshToken = localStorage.getItem('refreshToken');
  if (!refreshToken) return null;

  refreshInFlight = (async () => {
    try {
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ refreshToken }),
      });
      if (!res.ok) return null;
      const data = (await res.json()) as { accessToken: string; refreshToken: string };
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('refreshToken', data.refreshToken);
      return data.accessToken;
    } catch {
      return null;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, init: RequestInit = {}, _retried = false): Promise<T> {
  beginRequest();
  try {
    const accessToken = token();
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(init.headers ?? {}),
      },
    });

    // Access token likely expired — try one silent refresh, then replay the request once.
    // Never do this for the refresh call itself, and never loop.
    if (res.status === 401 && !_retried && !path.startsWith('/auth/')) {
      const fresh = await refreshAccessToken();
      if (fresh) return await apiFetch<T>(path, init, true);
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
      throw new ApiError(res.status, message ?? res.statusText);
    }
    return body as T;
  } finally {
    endRequest();
  }
}

/**
 * POST multipart/form-data (file uploads). Deliberately does NOT set a
 * content-type header: the browser has to add its own multipart boundary,
 * and setting it by hand produces a body the server cannot parse.
 */
export async function uploadFile<T>(path: string, form: FormData): Promise<T> {
  beginRequest();
  try {
    const accessToken = token();
    const res = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: accessToken ? { authorization: `Bearer ${accessToken}` } : {},
      body: form,
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
      throw new ApiError(res.status, message ?? res.statusText);
    }
    return body as T;
  } finally {
    endRequest();
  }
}

/** Fetch a protected file endpoint with auth and trigger a browser download. */
export async function downloadFile(path: string, fallbackName: string): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'Export failed');
  const blob = await res.blob();
  const cd = res.headers.get('content-disposition');
  const match = cd ? /filename="?([^"]+)"?/.exec(cd) : null;
  const name = match ? match[1] : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Fetch a protected file endpoint with auth and return an object URL for in-page preview
 * (e.g. in an <iframe>). Avoids window.open(), which popup blockers frequently kill —
 * especially once a fetch/await breaks the click's user-activation window.
 * Caller must URL.revokeObjectURL() the result when done (PdfPreviewModal does this).
 */
export async function fetchPreviewUrl(path: string): Promise<string> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
  const res = await fetch(`${API_BASE}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!res.ok) throw new ApiError(res.status, 'Preview failed');
  const blob = await res.blob();
  return URL.createObjectURL(blob);
}

export interface Paginated<T> {
  total: number;
  take: number;
  skip: number;
  items: T[];
}

export interface LoginResponse {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresIn: string;
  user: { id: string; email: string; universityId: string; roleCodes: string[] };
}

export interface DashboardSummary {
  students: number;
  lecturers: number;
  sections: number;
  enrollments: number;
  todayClasses: number;
  atRiskStudents: number;
  attendanceRate: number | null;
  generatedAt: string;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string | null;
  channel: string;
  readAt: string | null;
  createdAt: string;
}

export interface Environment {
  location: { name: string; lat: number; lng: number };
  weather: {
    temperature: number; apparentTemperature: number; humidity: number;
    windSpeed: number; code: number; isDay: boolean; description: string;
  } | null;
  air: { pm25: number | null; pm10: number | null; usAqi: number | null; category: string } | null;
  source: string;
  fetchedAt: string;
  errors: string[];
}

export interface MeResponse {
  id: string;
  email: string;
  status: string;
  lineUserId?: string | null;
  roles: { role: { code: string; nameEn: string; nameTh?: string | null } }[];
  lecturer?: { nameEn: string; nameTh?: string | null } | null;
  student?: { nameEn: string; nameTh?: string | null } | null;
}

export interface StudentNote {
  id: string;
  category: string;
  content: string;
  flagged: boolean;
  authorName: string;
  createdAt: string;
}

export function saveSession(res: LoginResponse) {
  localStorage.setItem('accessToken', res.accessToken);
  localStorage.setItem('refreshToken', res.refreshToken);
  localStorage.setItem('user', JSON.stringify(res.user));
  // Anchor the client-side absolute-timeout clock. The server enforces the same 3h cap
  // independently on refresh, so this is a UX convenience, not the security boundary.
  localStorage.setItem('sessionStartAt', String(Date.now()));
}

export function getSessionStartAt(): number | null {
  if (typeof window === 'undefined') return null;
  const v = localStorage.getItem('sessionStartAt');
  return v ? Number(v) : null;
}

export function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
  localStorage.removeItem('sessionStartAt');
}

/** Persist the working state to restore after the next login (absolute-timeout logout). */
export function saveRestoreState(route: string) {
  try { localStorage.setItem('session.restoreRoute', route); } catch { /* ignore */ }
}
export function takeRestoreRoute(): string | null {
  if (typeof window === 'undefined') return null;
  const r = localStorage.getItem('session.restoreRoute');
  if (r) localStorage.removeItem('session.restoreRoute');
  return r;
}
