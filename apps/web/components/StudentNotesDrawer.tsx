'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch, type Paginated, type StudentNote } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

const CATEGORIES = ['BEHAVIOR', 'INCIDENT', 'ACADEMIC', 'HEALTH', 'GENERAL'] as const;

export default function StudentNotesDrawer({
  studentId, studentName, studentCode, onClose,
}: {
  studentId: string; studentName: string; studentCode: string; onClose: () => void;
}) {
  const { t, lang } = useI18n();
  const [notes, setNotes] = useState<StudentNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<string>('BEHAVIOR');
  const [content, setContent] = useState('');
  const [flagged, setFlagged] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Paginated<StudentNote>>(`/students/${studentId}/notes`);
      setNotes(data.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load notes');
    } finally {
      setLoading(false);
    }
  }, [studentId]);
  useEffect(() => { void load(); }, [load]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!content.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await apiFetch(`/students/${studentId}/notes`, {
        method: 'POST',
        body: JSON.stringify({ category, content: content.trim(), flagged }),
      });
      setContent(''); setFlagged(false); setCategory('BEHAVIOR');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save note');
    } finally {
      setSaving(false);
    }
  }

  const fmt = (iso: string) =>
    new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', {
      day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false,
    }).format(new Date(iso));

  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, background: 'rgba(10,14,24,0.45)', backdropFilter: 'blur(3px)', zIndex: 50, display: 'flex', justifyContent: 'flex-end' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="glass glass-strong rise"
        style={{ width: 'min(440px, 100%)', height: '100%', borderRadius: '24px 0 0 24px', padding: 24, overflowY: 'auto' }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>{t('notes.title')}</h2>
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>{studentName} · {studentCode}</div>
          </div>
          <button onClick={onClose} className="glass hairline icon-btn" aria-label={t('common.close')} style={{ width: 34, height: 34, fontSize: 18 }}>×</button>
        </div>
        <div className="muted" style={{ fontSize: 11.5, marginBottom: 16 }}>🔒 {t('notes.evidence')}</div>

        {/* Add form */}
        <form onSubmit={submit} className="glass hairline" style={{ padding: 14, borderRadius: 16, marginBottom: 18 }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <select className="input" value={category} onChange={(e) => setCategory(e.target.value)} style={{ flex: 1 }}>
              {CATEGORIES.map((c) => <option key={c} value={c}>{t(`notes.cat.${c}`)}</option>)}
            </select>
          </div>
          <textarea
            className="input" value={content} onChange={(e) => setContent(e.target.value)}
            placeholder={t('notes.content')} rows={3} style={{ resize: 'vertical', marginBottom: 10 }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginBottom: 12, cursor: 'pointer' }} className="subtle">
            <input type="checkbox" checked={flagged} onChange={(e) => setFlagged(e.target.checked)} />
            {t('notes.flagged')}
          </label>
          {error && <div className="chip chip-danger" style={{ borderRadius: 10, padding: '8px 10px', marginBottom: 10 }}>{error}</div>}
          <button className="btn-primary" type="submit" disabled={saving || !content.trim()} style={{ width: '100%', padding: 11, fontSize: 14 }}>
            {saving ? t('notes.saving') : t('notes.save')}
          </button>
        </form>

        {/* Notes list */}
        {loading ? (
          <div className="muted" style={{ textAlign: 'center', padding: 20 }}>{t('common.loading')}</div>
        ) : notes.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: 24, fontSize: 13.5 }}>{t('notes.none')}</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {notes.map((n) => (
              <div key={n.id} className="glass hairline" style={{ padding: 14, borderRadius: 14, borderLeft: n.flagged ? '3px solid var(--danger)' : undefined }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                  <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>{t(`notes.cat.${n.category}`)}</span>
                  {n.flagged && <span className="chip chip-danger">⚠</span>}
                </div>
                <div style={{ fontSize: 14, lineHeight: 1.5 }}>{n.content}</div>
                <div className="muted" style={{ fontSize: 11.5, marginTop: 8 }}>
                  {t('notes.recordedBy')} <b style={{ color: 'var(--text-1)' }}>{n.authorName}</b> · {fmt(n.createdAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
