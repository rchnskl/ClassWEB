'use client';

import { useMemo, useSyncExternalStore } from 'react';

/**
 * localStorage as a React external store.
 *
 * Reading localStorage in a mount effect and copying it into state renders
 * every page twice (once empty, once with the value). Subscribing to it with
 * useSyncExternalStore reads it during render instead, stays correct during
 * hydration (the server snapshot is null, as before), and updates when another
 * tab — or writeLocalStorage in this one — changes the value.
 */

const listeners = new Set<() => void>();

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  window.addEventListener('storage', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('storage', onChange);
  };
}

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}

/** The raw stored string for `key`, or null (always null during the server render). */
export function useLocalStorage(key: string): string | null {
  return useSyncExternalStore(subscribe, () => read(key), () => null);
}

/** Write (or with null, remove) a key and notify every subscribed component. */
export function writeLocalStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* storage unavailable (private mode, quota): nothing to persist */ }
  listeners.forEach((l) => l());
}

export interface StoredUser {
  id?: string;
  email?: string;
  roleCodes?: string[];
}

/** The signed-in user saved at login, or null before hydration / when signed out. */
export function useStoredUser(): StoredUser | null {
  const raw = useLocalStorage('user');
  return useMemo(() => {
    if (!raw) return null;
    try { return JSON.parse(raw) as StoredUser; } catch { return null; }
  }, [raw]);
}

const noSubscribe = () => () => {};

/** window.location.origin on the client; '' during the server render. */
export function useWindowOrigin(): string {
  return useSyncExternalStore(noSubscribe, () => window.location.origin, () => '');
}
