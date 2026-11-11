'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { cachedGet } from './api';
import { useLocalStorage } from './local-store';

interface Branding {
  systemName: string | null;
}

const BrandingContext = createContext<Branding>({ systemName: null });

interface BrandingResponse {
  'system.name'?: string;
  'theme.primaryColor'?: string;
  'theme.secondaryColor'?: string;
  'theme.mode'?: string;
}

// Derived shades (var(--brand-2), var(--brand-soft), …) are static colors in
// globals.css, not a function of --brand — color-mix() gives us a reasonable
// live derivation instead of leaving them stuck at the default orange/blue
// whenever an admin picks a custom brand color.
function applyBrandColor(varName: string, hex: string | undefined, fallback: string) {
  const color = hex && /^#[0-9a-fA-F]{6}$/.test(hex) ? hex : fallback;
  const root = document.documentElement.style;
  root.setProperty(varName, color);
  root.setProperty(`${varName}-2`, `color-mix(in srgb, ${color} 70%, white)`);
  root.setProperty(`${varName}-soft`, `color-mix(in srgb, ${color} 20%, white)`);
}

export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const [systemName, setSystemName] = useState<string | null>(null);

  // Re-read on sign-in: the provider mounts on the login page, before there is
  // a token, so a mount-only fetch never applied the branding until a reload.
  const token = useLocalStorage('accessToken');

  useEffect(() => {
    if (!token) return;
    cachedGet<BrandingResponse>('/settings/branding', 5 * 60_000)
      .then((b) => {
        if (b['system.name']) {
          setSystemName(b['system.name']);
          // Set, don't splice: replacing a "ClassWeb" prefix with a name that
          // itself starts with "ClassWeb" grew the tab title on every run.
          document.title = b['system.name'];
        }
        applyBrandColor('--brand', b['theme.primaryColor'], '#ff8a4c');
        applyBrandColor('--brand-blue', b['theme.secondaryColor'], '#6fa3d6');
      })
      .catch(() => {});
  }, [token]);

  return <BrandingContext.Provider value={{ systemName }}>{children}</BrandingContext.Provider>;
}

export function useBranding() {
  return useContext(BrandingContext);
}
