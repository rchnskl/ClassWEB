'use client';

import { useSyncExternalStore } from 'react';

/**
 * Global toasts.
 *
 * Deliberately a plain module store rather than a React context: the main
 * publisher is apiFetch (lib/api.ts), which is not a component and has no way
 * to reach a hook. Every save in the app goes through it, so wiring the
 * feedback there means a new page gets "saved" / "couldn't save" for free
 * instead of each one having to remember — which is how the app ended up with
 * pages that saved silently and left the user guessing.
 */
export type ToastTone = 'success' | 'error' | 'info';
export interface Toast { id: number; tone: ToastTone; message: string }

const listeners = new Set<() => void>();
let toasts: Toast[] = [];
let nextId = 1;

const DURATION: Record<ToastTone, number> = {
  // An error is the one the user may need to read twice, or copy into a
  // message to whoever maintains this — it stays up noticeably longer.
  success: 3200,
  info: 3600,
  error: 7000,
};

function emit() {
  listeners.forEach((l) => l());
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

export function showToast(tone: ToastTone, message: string) {
  if (!message) return;
  // Two identical toasts in a row (a double-click on Save, a page that fires
  // several saves at once) read as a stutter, not as more information.
  const last = toasts[toasts.length - 1];
  if (last && last.tone === tone && last.message === message) return;

  const id = nextId++;
  toasts = [...toasts, { id, tone, message }].slice(-4);
  emit();
  setTimeout(() => dismissToast(id), DURATION[tone]);
}

export const toast = {
  success: (m: string) => showToast('success', m),
  error: (m: string) => showToast('error', m),
  info: (m: string) => showToast('info', m),
};

const NO_TOASTS: Toast[] = [];

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  return () => { listeners.delete(onChange); };
}

function useToasts(): Toast[] {
  // `toasts` is replaced (never mutated) on every change, so it is a valid
  // snapshot as-is. The server render has none.
  return useSyncExternalStore(subscribe, () => toasts, () => NO_TOASTS);
}

const TONE_STYLE: Record<ToastTone, { bg: string; border: string; icon: string }> = {
  success: { bg: 'rgba(31,157,85,0.16)', border: 'rgba(31,157,85,0.55)', icon: '✓' },
  error: { bg: 'rgba(226,86,77,0.16)', border: 'rgba(226,86,77,0.55)', icon: '✕' },
  info: { bg: 'rgba(14,124,123,0.16)', border: 'rgba(14,124,123,0.55)', icon: 'i' },
};

/** Mounted once in the root layout; renders whatever the store currently holds. */
export function ToastHost() {
  const items = useToasts();
  if (items.length === 0) return null;

  return (
    <div
      // aria-live so a screen reader announces the save without the user
      // having to go looking for the toast.
      aria-live="polite"
      style={{
        position: 'fixed', zIndex: 2000, bottom: 20, right: 20, display: 'flex',
        flexDirection: 'column', gap: 8, maxWidth: 'min(420px, calc(100vw - 40px))', pointerEvents: 'none',
      }}
    >
      {items.map((t) => {
        const s = TONE_STYLE[t.tone];
        return (
          <div
            key={t.id}
            role={t.tone === 'error' ? 'alert' : 'status'}
            onClick={() => dismissToast(t.id)}
            className="glass rise"
            style={{
              pointerEvents: 'auto', cursor: 'pointer', display: 'flex', alignItems: 'flex-start', gap: 10,
              padding: '11px 14px', borderRadius: 12, background: s.bg, border: `1px solid ${s.border}`,
              boxShadow: 'var(--shadow-lg)', color: 'var(--text-0)', fontSize: 13.5, lineHeight: 1.4,
              backdropFilter: 'blur(10px)',
            }}
          >
            <span aria-hidden style={{ fontWeight: 800, opacity: 0.85 }}>{s.icon}</span>
            <span style={{ flex: 1, wordBreak: 'break-word' }}>{t.message}</span>
          </div>
        );
      })}
    </div>
  );
}
