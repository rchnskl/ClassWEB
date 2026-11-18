/**
 * The name a login account goes by when it has no Lecturer/Student profile
 * (e.g. a shared faculty admin account) — set by an admin in Settings → Users
 * and kept in User.metadata.displayName.
 */
export function displayNameOf(metadata: unknown): string | null {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return null;
  const v = (metadata as Record<string, unknown>).displayName;
  return typeof v === 'string' && v.trim() ? v.trim() : null;
}
