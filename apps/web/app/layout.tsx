import type { Metadata, Viewport } from 'next';
import './globals.css';
import AuroraBackground from '@/components/AuroraBackground';
import SessionGuard from '@/components/SessionGuard';
import { I18nProvider } from '@/lib/i18n';
import { UIProvider } from '@/lib/ui';

export const metadata: Metadata = {
  title: 'ClassWeb — Faculty of Nursing',
  description: 'Classroom & attendance platform, Faculty of Nursing, Assumption University',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

// Set theme before first paint to avoid a flash.
const themeInit = `(function(){try{var t=localStorage.getItem('theme');if(!t){t=window.matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light';}document.documentElement.setAttribute('data-theme',t);}catch(e){}})();`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <AuroraBackground />
        <I18nProvider>
          <UIProvider>
            <SessionGuard>{children}</SessionGuard>
          </UIProvider>
        </I18nProvider>
      </body>
    </html>
  );
}
