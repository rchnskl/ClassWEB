'use client';

import { use, useEffect, useState } from 'react';
import Logo from '@/components/Logo';
import ThemeToggle from '@/components/ThemeToggle';
import LanguageToggle from '@/components/LanguageToggle';
import { API_BASE, apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface VerifyResult {
  valid: boolean;
  hasFile: boolean;
  reportNumber: string;
  title: string;
  format: string;
  generatedByName: string | null;
  createdAt: string;
  checksum: string | null;
  university: { nameEn: string; nameTh: string | null };
}

export default function VerifyPage({ params }: { params: Promise<{ reportNumber: string }> }) {
  const { reportNumber } = use(params);
  const { t, lang } = useI18n();
  const [result, setResult] = useState<VerifyResult | null>(null);
  const [invalid, setInvalid] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiFetch<VerifyResult>(`/reports/verify/${reportNumber}`)
      .then(setResult)
      .catch(() => setInvalid(true))
      .finally(() => setLoading(false));
  }, [reportNumber]);

  const fileUrl = `${API_BASE}/reports/file/${reportNumber}`;

  return (
    <main style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '20px 16px 40px', gap: 20 }}>
      <div style={{ position: 'fixed', top: 20, right: 20, display: 'flex', gap: 10, zIndex: 10 }}>
        <LanguageToggle /><ThemeToggle />
      </div>

      <div className="glass glass-strong rise" style={{ width: '100%', maxWidth: result?.hasFile ? 760 : 440, padding: 32, textAlign: 'center', marginTop: 8 }}>
        <Logo size={54} float />
        <h1 style={{ fontSize: 19, fontWeight: 750, margin: '12px 0 18px' }}>{t('verify.title')}</h1>

        {loading ? (
          <p className="muted">{t('verify.checking')}</p>
        ) : invalid || !result ? (
          <div className="chip chip-danger" style={{ fontSize: 15, padding: '16px 20px', borderRadius: 16, flexDirection: 'column', gap: 6 }}>
            <div style={{ fontSize: 36 }}>❌</div>
            {t('verify.invalid')}
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, opacity: 0.8 }}>{reportNumber}</div>
          </div>
        ) : (
          <>
            <div className="chip chip-success" style={{ fontSize: 15, padding: '14px 20px', borderRadius: 16, flexDirection: 'column', gap: 4, marginBottom: 18 }}>
              <div style={{ fontSize: 36 }}>✅</div>
              {t('verify.valid')}
            </div>
            <div style={{ textAlign: 'left', display: 'flex', flexDirection: 'column', gap: 10, marginBottom: result.hasFile ? 20 : 0 }}>
              <Row label={t('verify.reportNo')} value={result.reportNumber} mono />
              <Row label="University" value={lang === 'th' ? result.university.nameTh ?? result.university.nameEn : result.university.nameEn} />
              <Row label={t('verify.generatedBy')} value={result.generatedByName ?? '—'} />
              <Row label={t('verify.generatedAt')} value={new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { dateStyle: 'long', timeStyle: 'short' }).format(new Date(result.createdAt))} />
              {result.checksum && <Row label={t('verify.checksum')} value={result.checksum.slice(0, 24) + '…'} mono />}
            </div>

            {result.hasFile ? (
              <div style={{ textAlign: 'left' }}>
                <div className="muted" style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>{t('verify.document')}</div>
                <div className="hairline" style={{ borderRadius: 14, overflow: 'hidden', border: '1px solid var(--glass-hairline)' }}>
                  <iframe src={fileUrl} title={result.title} style={{ width: '100%', height: '70vh', minHeight: 420, border: 'none', display: 'block' }} />
                </div>
                <a
                  href={fileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="btn-primary"
                  style={{ display: 'inline-block', marginTop: 14, padding: '11px 20px', fontSize: 14, textDecoration: 'none' }}
                >
                  ⬇ {t('verify.downloadFile')}
                </a>
              </div>
            ) : (
              <p className="muted" style={{ fontSize: 12.5, marginTop: 4 }}>{t('verify.noFile')}</p>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="glass hairline" style={{ padding: '10px 14px', borderRadius: 12 }}>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2, fontFamily: mono ? 'ui-monospace, monospace' : undefined, wordBreak: 'break-all' }}>{value}</div>
    </div>
  );
}
