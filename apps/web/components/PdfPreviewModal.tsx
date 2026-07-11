'use client';

import { useEffect, useRef, useState } from 'react';
import { useI18n } from '@/lib/i18n';

export default function PdfPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Revoking the object URL only belongs to the explicit close action, never to a
  // mount-effect cleanup: React StrictMode double-invokes effects in dev, which would
  // revoke the URL right after the first mount — before the real mount's render (or the
  // "open in new tab" link below) ever gets a chance to use it.
  function handleClose() {
    URL.revokeObjectURL(url);
    onClose();
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') handleClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Rendered via PDF.js to <canvas> rather than <iframe>/<object>/<embed>: those rely
        // on the browser's native PDF viewer plugin, which many browsers/profiles have set
        // to "always download" instead of "view in browser" — in that mode embeds just show
        // blank with no error. Canvas rendering is independent of that setting entirely.
        const pdfjsLib = await import('pdfjs-dist');
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        const pdf = await pdfjsLib.getDocument({ url }).promise;
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = '';

        for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
          if (cancelled) return;
          const page = await pdf.getPage(pageNum);
          const viewport = page.getViewport({ scale: 1.4 });
          const canvas = document.createElement('canvas');
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          canvas.style.display = 'block';
          canvas.style.margin = '0 auto 12px';
          canvas.style.maxWidth = '100%';
          canvas.style.height = 'auto';
          canvas.style.boxShadow = '0 2px 12px rgba(0,0,0,0.15)';
          const ctx = canvas.getContext('2d');
          if (!ctx) continue;
          containerRef.current.appendChild(canvas);
          await page.render({ canvasContext: ctx, viewport, canvas }).promise;
        }
        if (!cancelled) setLoading(false);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to render PDF');
          setLoading(false);
        }
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6, 10, 20, 0.65)',
        backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', padding: 20,
      }}
      onClick={handleClose}
    >
      <div
        className="glass"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden', maxWidth: 1000, width: '100%', margin: '0 auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--glass-hairline)' }}>
          <span style={{ fontWeight: 650, fontSize: 14 }}>{t('common.previewPdf')}</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <a href={url} target="_blank" rel="noopener noreferrer" className="glass hairline icon-btn" style={{ padding: '6px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-1)', textDecoration: 'none' }}>
              {t('common.openInNewTab')}
            </a>
            <button onClick={handleClose} className="glass hairline icon-btn" style={{ padding: '6px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
              ✕
            </button>
          </div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', background: '#525659', padding: 20 }}>
          {loading && <div style={{ color: '#fff', textAlign: 'center', padding: 40 }}>{t('common.loading')}</div>}
          {error && <div className="chip chip-danger" style={{ display: 'block', maxWidth: 480, margin: '40px auto' }}>{error}</div>}
          <div ref={containerRef} />
        </div>
      </div>
    </div>
  );
}
