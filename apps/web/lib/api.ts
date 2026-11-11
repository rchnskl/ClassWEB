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
import { showToast } from './toast';
import { writeLocalStorage } from './local-store';

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

// ---------------------------------------------------------------------------
// Save feedback. Every mutating call reports itself, so a page does not have
// to remember to tell the user whether the save landed — the app used to be
// silent on both success and failure, which leaves people re-clicking Save.
// ---------------------------------------------------------------------------

/** Overrides for the automatic toast on a single call. */
export interface FeedbackOptions {
  /** Say nothing at all — background sync, polling, a flow with its own UI. */
  silent?: boolean;
  /** Say nothing on success only; failures still surface. */
  silentSuccess?: boolean;
  /** Replace the default "Saved" wording. */
  successMessage?: string;
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE']);

/**
 * Wording lives here rather than in i18n.tsx because api.ts is not a
 * component and cannot read the provider; the language is mirrored from the
 * same localStorage key I18nProvider persists.
 */
function defaultMessages(method: string): { saved: string; failed: string } {
  const th = (() => {
    try { return (localStorage.getItem('lang') ?? 'th') !== 'en'; } catch { return true; }
  })();
  if (method === 'DELETE') return th ? { saved: 'ลบเรียบร้อย', failed: 'ลบไม่สำเร็จ' } : { saved: 'Deleted', failed: "Couldn't delete" };
  // GET here only ever reports a failure — a download or preview that never arrived.
  if (method === 'GET') return th ? { saved: '', failed: 'ดำเนินการไม่สำเร็จ' } : { saved: '', failed: "That didn't work" };
  return th ? { saved: 'บันทึกเรียบร้อย', failed: 'บันทึกไม่สำเร็จ' } : { saved: 'Saved', failed: "Couldn't save" };
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

/**
 * Short-lived cache for GETs of data that rarely changes (the signed-in
 * user, academic year, branding, weather). Every page mounts the sidebar,
 * top bar and its own copy of these, so without it each navigation re-sent
 * the same half-dozen requests to a small server. Concurrent callers share
 * one request; any change made through apiFetch, sign-in and sign-out clear
 * the cache.
 */
const getCache = new Map<string, { at: number; p: Promise<unknown> }>();
export function cachedGet<T>(path: string, ttlMs = 60_000): Promise<T> {
  const who = typeof window === 'undefined' ? '' : (localStorage.getItem('user') ?? '');
  const key = `${who}|${path}`;
  const hit = getCache.get(key);
  if (hit && Date.now() - hit.at < ttlMs) return hit.p as Promise<T>;
  const p = apiFetch<T>(path);
  getCache.set(key, { at: Date.now(), p });
  p.catch(() => getCache.delete(key));
  return p;
}
export function clearCachedGets() { getCache.clear(); }

export async function apiFetch<T>(path: string, init: RequestInit & FeedbackOptions = {}, _retried = false): Promise<T> {
  const { silent, silentSuccess, successMessage, ...request } = init;
  const method = (request.method ?? 'GET').toUpperCase();
  if (method !== 'GET') getCache.clear();
  // Auth calls own their own messaging (the login form, the lock screen), and
  // a GET has nothing to report — only mutations speak up.
  const announce = !silent && MUTATING.has(method) && !path.startsWith('/auth/');
  beginRequest();
  try {
    const accessToken = token();
    const res = await fetch(`${API_BASE}${path}`, {
      ...request,
      headers: {
        'content-type': 'application/json',
        ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
        ...(request.headers ?? {}),
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
      // The server's own message is far more useful than a generic failure
      // ("This rubric has 3 recorded evaluations and cannot be deleted"), so
      // it is what the toast shows when there is one.
      if (announce) showToast('error', message ?? defaultMessages(method).failed);
      throw new ApiError(res.status, message ?? res.statusText);
    }
    if (announce && !silentSuccess) showToast('success', successMessage ?? defaultMessages(method).saved);
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
export async function uploadFile<T>(path: string, form: FormData, feedback: FeedbackOptions = {}): Promise<T> {
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
      if (!feedback.silent) showToast('error', message ?? defaultMessages('POST').failed);
      throw new ApiError(res.status, message ?? res.statusText);
    }
    if (!feedback.silent && !feedback.silentSuccess) showToast('success', feedback.successMessage ?? defaultMessages('POST').saved);
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
  if (!res.ok) {
    // A failed export is otherwise completely silent — the browser simply
    // never starts a download and the user is left clicking the button again.
    showToast('error', defaultMessages('GET').failed);
    throw new ApiError(res.status, 'Export failed');
  }
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
  if (!res.ok) {
    showToast('error', defaultMessages('GET').failed);
    throw new ApiError(res.status, 'Preview failed');
  }
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
  getCache.clear();
  localStorage.setItem('refreshToken', res.refreshToken);
  // Through the store, so components subscribed to the session (branding,
  // sidebar, signed-in user) update immediately rather than on next reload.
  writeLocalStorage('accessToken', res.accessToken);
  writeLocalStorage('user', JSON.stringify(res.user));
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
  getCache.clear();
  writeLocalStorage('accessToken', null);
  localStorage.removeItem('refreshToken');
  writeLocalStorage('user', null);
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
