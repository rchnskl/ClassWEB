'use client';

import { useSyncExternalStore } from 'react';
import { subscribeApiLoading, isApiLoading } from '@/lib/api';

/**
 * A thin animated bar fixed to the top of the viewport whenever any apiFetch
 * request is in flight — a visible "something is happening" signal so users
 * don't wonder whether a click registered and press it again. Wired in
 * automatically for every request (see lib/api.ts), no per-page setup needed.
 */
export default function GlobalLoadingBar() {
  const loading = useSyncExternalStore(subscribeApiLoading, isApiLoading, () => false);

  return (
    <div
      aria-hidden={!loading}
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: 3, zIndex: 3000,
        opacity: loading ? 1 : 0, transition: 'opacity 180ms ease',
        pointerEvents: 'none', overflow: 'hidden',
      }}
    >
      {loading && (
        <div
          className="brand-gradient"
          style={{ position: 'absolute', inset: 0, width: '40%', animation: 'loading-sweep 1.1s ease-in-out infinite' }}
        />
      )}
    </div>
  );
}
