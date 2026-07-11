'use client';

import { useEffect } from 'react';
import { useI18n } from '@/lib/i18n';

export default function PdfPreviewModal({ url, onClose }: { url: string; onClose: () => void }) {
  const { t } = useI18n();

  useEffect(() => {
    return () => URL.revokeObjectURL(url);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose(); }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 2000, background: 'rgba(6, 10, 20, 0.65)',
        backdropFilter: 'blur(2px)', display: 'flex', flexDirection: 'column', padding: 20,
      }}
      onClick={onClose}
    >
      <div
        className="glass"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRadius: 18, overflow: 'hidden', maxWidth: 1000, width: '100%', margin: '0 auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', borderBottom: '1px solid var(--glass-hairline)' }}>
          <span style={{ fontWeight: 650, fontSize: 14 }}>{t('common.previewPdf')}</span>
          <button onClick={onClose} className="glass hairline icon-btn" style={{ padding: '6px 14px', borderRadius: 10, fontSize: 13, fontWeight: 600, color: 'var(--text-1)' }}>
            ✕
          </button>
        </div>
        <iframe src={url} title="PDF preview" style={{ flex: 1, border: 'none', width: '100%', background: '#fff' }} />
      </div>
    </div>
  );
}
