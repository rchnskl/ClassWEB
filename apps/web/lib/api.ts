export const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api/v1';

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

export async function apiFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = token();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = Array.isArray(body?.message) ? body.message.join(', ') : body?.message;
    throw new ApiError(res.status, message ?? res.statusText);
  }
  return body as T;
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
}

export function clearSession() {
  localStorage.removeItem('accessToken');
  localStorage.removeItem('refreshToken');
  localStorage.removeItem('user');
}
