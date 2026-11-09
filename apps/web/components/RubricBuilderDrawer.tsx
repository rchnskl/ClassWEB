'use client';

import { useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface ItemForm { id?: string; textEn: string; textTh: string; weightPercent: number; maxRating: number; isCritical: boolean }
interface SectionForm { id?: string; nameEn: string; nameTh: string; weightPercent: number; items: ItemForm[] }
interface RubricForm { code: string; nameEn: string; nameTh: string; description: string; weightPercent: number; perSession: boolean; sections: SectionForm[] }

interface RubricListItem { id: string; code: string | null; nameEn: string; nameTh: string | null; weightPercent: number; sections: { items: unknown[] }[] }

/**
 * Full marks and weight are two different numbers and are entered separately:
 * the full mark is the scale a step is scored on (out of 5, out of 50), the
 * weight is what that score is worth toward the grade. A 50-mark midterm at
 * 15% contributes at most 15 — its marks never inflate its share. splitByMarks
 * is the convenience for the common case where they *should* line up.
 */
const totalMarks = (items: ItemForm[]) => items.reduce((a, it) => a + (it.maxRating || 0), 0);

/** Weights that mirror the full marks, as a starting point the user can edit. */
function splitByMarks<T>(parts: T[], marks: (p: T) => number): number[] {
  const total = parts.reduce((a, p) => a + marks(p), 0);
  if (total <= 0) return parts.map(() => 0);
  return parts.map((p) => Math.round((marks(p) / total) * 1000) / 10);
}

/**
 * Advisory status for a set of weights that is *meant* to total 100%.
 * >100 is a hard error (the server rejects it); <100 is a soft warning —
 * a perfect performance would then max out below 100%, skewing the grade
 * bands — so we surface it in amber without blocking.
 */
function weightStatus(sum: number): { tone: 'ok' | 'over' | 'under' | 'empty'; color: string; bg: string } {
  if (sum > 100.001) return { tone: 'over', color: 'var(--danger)', bg: 'rgba(226,86,77,0.15)' };
  if (sum > 0 && sum < 99.999) return { tone: 'under', color: '#c98a1a', bg: 'rgba(201,138,26,0.16)' };
  if (sum >= 99.999) return { tone: 'ok', color: 'var(--ok, #1f9d55)', bg: 'rgba(31,157,85,0.14)' };
  return { tone: 'empty', color: 'var(--text-1)', bg: 'var(--glass-hairline)' };
}

const EMPTY_ITEM = (): ItemForm => ({ textEn: '', textTh: '', weightPercent: 0, maxRating: 5, isCritical: false });
const EMPTY_SECTION = (): SectionForm => ({ nameEn: '', nameTh: '', weightPercent: 0, items: [EMPTY_ITEM()] });
const EMPTY_RUBRIC = (): RubricForm => ({ code: '', nameEn: '', nameTh: '', description: '', weightPercent: 0, perSession: false, sections: [EMPTY_SECTION()] });

export default function RubricBuilderDrawer({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [rubrics, setRubrics] = useState<RubricListItem[]>([]);
  const [mode, setMode] = useState<'list' | 'form'>('list');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<RubricForm>(EMPTY_RUBRIC());
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => apiFetch<RubricListItem[]>('/assessment/rubrics').then(setRubrics).catch(() => {});
  useEffect(() => { void load(); }, []);

  function startCreate() {
    setForm(EMPTY_RUBRIC());
    setEditingId(null);
    setError(null);
    setMode('form');
  }

  async function startEdit(id: string) {
    const r = await apiFetch<{ code: string | null; nameEn: string; nameTh: string | null; description: string | null; weightPercent: number; perSession?: boolean; sections: { id: string; nameEn: string; nameTh: string | null; weightPercent: number; items: { id: string; textEn: string; textTh: string | null; weightPercent: number; maxRating: number; isCritical: boolean }[] }[] }>(`/assessment/rubrics/${id}`);
    setForm({
      code: r.code ?? '', nameEn: r.nameEn, nameTh: r.nameTh ?? '', description: r.description ?? '', weightPercent: r.weightPercent, perSession: r.perSession ?? false,
      // ids ride along so the server updates these rows in place — recreating
      // them would orphan (and, with a restricted FK, refuse to drop) the
      // scores already recorded against them.
      sections: r.sections.map((s) => ({
        id: s.id, nameEn: s.nameEn, nameTh: s.nameTh ?? '', weightPercent: s.weightPercent,
        items: s.items.map((it) => ({ id: it.id, textEn: it.textEn, textTh: it.textTh ?? '', weightPercent: it.weightPercent, maxRating: it.maxRating, isCritical: it.isCritical })),
      })),
    });
    setEditingId(id);
    setError(null);
    setMode('form');
  }

  async function remove(id: string) {
    if (!window.confirm(t('rubric.confirmDelete'))) return;
    setBusyId(id);
    try {
      await apiFetch(`/assessment/rubrics/${id}`, { method: 'DELETE' });
      await load();
      onChanged();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Failed');
    } finally { setBusyId(null); }
  }

  const sectionSum = form.sections.reduce((a, s) => a + (s.weightPercent || 0), 0);

  function updateSection(i: number, patch: Partial<SectionForm>) {
    setForm((f) => ({ ...f, sections: f.sections.map((s, si) => (si === i ? { ...s, ...patch } : s)) }));
  }
  function updateItem(si: number, ii: number, patch: Partial<ItemForm>) {
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s, i) => i !== si ? s : { ...s, items: s.items.map((it, j) => (j === ii ? { ...it, ...patch } : it)) }),
    }));
  }
  function distributeSections() {
    setForm((f) => {
      const shares = splitByMarks(f.sections, (s) => totalMarks(s.items));
      return { ...f, sections: f.sections.map((s, i) => ({ ...s, weightPercent: shares[i] })) };
    });
  }
  function distributeItems(si: number) {
    setForm((f) => ({
      ...f,
      sections: f.sections.map((s, i) => {
        if (i !== si) return s;
        const shares = splitByMarks(s.items, (it) => it.maxRating || 0);
        return { ...s, items: s.items.map((it, j) => ({ ...it, weightPercent: shares[j] })) };
      }),
    }));
  }
  function addSection() { setForm((f) => ({ ...f, sections: [...f.sections, EMPTY_SECTION()] })); }
  function removeSection(i: number) { setForm((f) => ({ ...f, sections: f.sections.filter((_, si) => si !== i) })); }
  function addItem(si: number) { setForm((f) => ({ ...f, sections: f.sections.map((s, i) => (i === si ? { ...s, items: [...s.items, EMPTY_ITEM()] } : s)) })); }
  function removeItem(si: number, ii: number) { setForm((f) => ({ ...f, sections: f.sections.map((s, i) => (i === si ? { ...s, items: s.items.filter((_, j) => j !== ii) } : s)) })); }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const body = JSON.stringify(form);
      if (editingId) await apiFetch(`/assessment/rubrics/${editingId}`, { method: 'PATCH', body });
      else await apiFetch('/assessment/rubrics', { method: 'POST', body });
      await load();
      onChanged();
      setMode('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rubric');
    } finally { setSaving(false); }
  }

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1150, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(680px, 100%)', height: '100%', background: 'var(--popover-bg)', borderLeft: '1px solid var(--glass-hairline)', boxShadow: 'var(--shadow-lg)', padding: 22, overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <div style={{ fontWeight: 750, fontSize: 18 }}>{mode === 'list' ? t('rubric.manage') : editingId ? t('rubric.edit') : t('rubric.new')}</div>
          <div style={{ display: 'flex', gap: 8 }}>
            {mode === 'form' && <button onClick={() => setMode('list')} className="glass hairline" style={{ padding: '7px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>{t('rubric.backToList')}</button>}
            <button onClick={onClose} className="glass hairline icon-btn" aria-label={t('common.close')} style={{ width: 34, height: 34, fontSize: 18 }}>×</button>
          </div>
        </div>

        {mode === 'list' && (
          <>
            <button onClick={startCreate} className="btn-primary" style={{ padding: '10px 18px', fontSize: 13.5, marginBottom: 16 }}>{t('rubric.addNew')}</button>
            {rubrics.length === 0 ? (
              <div className="muted" style={{ textAlign: 'center', padding: 40 }}>{t('rubric.none')}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {rubrics.map((r) => (
                  <div key={r.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderRadius: 12, background: 'var(--popover-hover)' }}>
                    <div>
                      <div style={{ fontWeight: 650, fontSize: 14 }}>{name(r.nameEn, r.nameTh)}</div>
                      <div className="muted" style={{ fontSize: 12 }}>{r.sections.length} {t('rubric.sections')} · {r.sections.reduce((a, s) => a + s.items.length, 0)} {t('rubric.items')} · {r.weightPercent}%</div>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button onClick={() => startEdit(r.id)} className="glass hairline icon-btn" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600 }}>✏️ {t('rubric.editBtn')}</button>
                      <button onClick={() => remove(r.id)} disabled={busyId === r.id} className="btn-danger" style={{ padding: '6px 12px', fontSize: 12.5 }}>{busyId === r.id ? '…' : `🗑 ${t('rubric.deleteBtn')}`}</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {mode === 'form' && (
          <div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
              <F label={`${t('rubric.nameEn')} *`}><input className="input" value={form.nameEn} onChange={(e) => setForm({ ...form, nameEn: e.target.value })} /></F>
              <F label={t('rubric.nameTh')}><input className="input" value={form.nameTh} onChange={(e) => setForm({ ...form, nameTh: e.target.value })} /></F>
              <F label={t('rubric.code')}><input className="input" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value })} placeholder="e.g. CLINICAL" /></F>
              <F label={t('rubric.suggestedWeight')}><input type="number" min={0} max={100} className="input" value={form.weightPercent} onChange={(e) => setForm({ ...form, weightPercent: Number(e.target.value) })} /></F>
            </div>
            <F label={t('rubric.description')}><input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></F>
            <label style={{ display: 'flex', gap: 8, alignItems: 'flex-start', fontSize: 13, margin: '4px 0 8px' }}>
              <input type="checkbox" checked={form.perSession} onChange={(e) => setForm({ ...form, perSession: e.target.checked })} style={{ marginTop: 3 }} />
              <span><b>{t('rubric.perSession')}</b><br /><span className="muted">{t('rubric.perSessionHint')}</span></span>
            </label>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '18px 0 10px' }}>
              <div style={{ fontWeight: 700, fontSize: 13.5 }}>{t('rubric.sections')}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="chip" title={t('rubric.totalFullMarksHint')} style={{ background: 'var(--glass-hairline)', color: 'var(--text-1)' }}>
                {t('rubric.totalFullMarks')}: {form.sections.reduce((a, s) => a + totalMarks(s.items), 0)}
              </span>
              <button onClick={distributeSections} className="glass hairline" title={t('rubric.splitByMarksHint')}
                style={{ padding: '5px 10px', borderRadius: 9, fontSize: 11.5, fontWeight: 600, cursor: 'pointer', color: 'var(--text-1)' }}>
                {t('rubric.splitByMarks')}
              </button>
              {(() => { const st = weightStatus(sectionSum); return (
                <span className="chip" title={st.tone === 'under' ? t('rubric.weightUnderHint') : undefined} style={{ background: st.bg, color: st.color }}>
                  {t('rubric.sumOfWeights')}: {sectionSum.toFixed(1)}%{st.tone === 'under' ? ` · ${t('rubric.weightUnder')}` : ''}
                </span>
              ); })()}
              </div>
            </div>
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 10 }}>{t('rubric.weightVsMarksHint')}</div>

            {form.sections.map((s, si) => {
              const itemSum = s.items.reduce((a, i) => a + (i.weightPercent || 0), 0);
              return (
                <div key={si} style={{ border: '1px solid var(--glass-hairline)', borderRadius: 14, padding: 14, marginBottom: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 10 }}>
                    <F label={`${t('rubric.sectionNameEn')} *`}><input className="input" value={s.nameEn} onChange={(e) => updateSection(si, { nameEn: e.target.value })} /></F>
                    <F label={t('rubric.sectionNameTh')}><input className="input" value={s.nameTh} onChange={(e) => updateSection(si, { nameTh: e.target.value })} /></F>
                    <div style={{ width: 96 }}>
                      <F label={t('rubric.sectionShare')}><input type="number" min={0} max={100} step={0.1} className="input" title={t('rubric.sectionShareHint')} value={s.weightPercent} onChange={(e) => updateSection(si, { weightPercent: Number(e.target.value) })} /></F>
                    </div>
                    <button onClick={() => removeSection(si)} className="btn-danger" style={{ padding: '10px 12px', fontSize: 12.5 }}>🗑</button>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                    <span className="muted" style={{ fontSize: 11.5 }}>{t('rubric.sectionFullMarks')}: {totalMarks(s.items)}</span>
                    {(() => { const st = weightStatus(itemSum); return (
                      <span className="muted" style={{ fontSize: 11.5, color: st.tone === 'ok' ? undefined : st.color }}>
                        · {t('rubric.itemWeightSum')}: {itemSum.toFixed(1)}%{st.tone === 'under' ? ` · ${t('rubric.weightUnder')}` : ''}
                      </span>
                    ); })()}
                    <button onClick={() => distributeItems(si)} className="glass hairline" title={t('rubric.splitByMarksHint')}
                      style={{ padding: '3px 8px', borderRadius: 8, fontSize: 11, fontWeight: 600, cursor: 'pointer', color: 'var(--text-1)' }}>
                      {t('rubric.splitByMarks')}
                    </button>
                  </div>

                  {s.items.map((it, ii) => (
                    <div key={ii} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginBottom: 8, paddingLeft: 10, borderLeft: '2px solid var(--glass-hairline)' }}>
                      <F label={`${t('rubric.itemTextEn')} *`}><input className="input" value={it.textEn} onChange={(e) => updateItem(si, ii, { textEn: e.target.value })} /></F>
                      <F label={t('rubric.itemTextTh')}><input className="input" value={it.textTh} onChange={(e) => updateItem(si, ii, { textTh: e.target.value })} /></F>
                      <div style={{ width: 74 }}>
                        <F label={t('rubric.maxRating')}><input type="number" min={2} max={100} className="input" title={t('rubric.maxRatingHint')} value={it.maxRating} onChange={(e) => updateItem(si, ii, { maxRating: Number(e.target.value) })} /></F>
                      </div>
                      <div style={{ width: 70 }}>
                        <F label="%"><input type="number" min={0} max={100} step={0.1} className="input" title={t('rubric.itemShareHint')} value={it.weightPercent} onChange={(e) => updateItem(si, ii, { weightPercent: Number(e.target.value) })} /></F>
                      </div>
                      <label title={t('as.criticalItem')} style={{ display: 'flex', alignItems: 'center', gap: 4, paddingBottom: 12, cursor: 'pointer' }}>
                        <input type="checkbox" checked={it.isCritical} onChange={(e) => updateItem(si, ii, { isCritical: e.target.checked })} style={{ width: 16, height: 16, cursor: 'pointer' }} />
                        <span style={{ fontSize: 16, color: it.isCritical ? 'var(--danger)' : 'var(--text-2)' }}>★</span>
                      </label>
                      <button onClick={() => removeItem(si, ii)} disabled={s.items.length <= 1} aria-label={t('common.removeItem')} className="glass hairline icon-btn" style={{ padding: '10px 10px', borderRadius: 10, fontSize: 12, opacity: s.items.length <= 1 ? 0.4 : 1 }}>✕</button>
                    </div>
                  ))}
                  <button onClick={() => addItem(si)} className="glass hairline" style={{ padding: '6px 12px', borderRadius: 10, fontSize: 12, fontWeight: 600, marginTop: 4 }}>{t('rubric.addItem')}</button>
                </div>
              );
            })}
            <button onClick={addSection} className="glass hairline" style={{ padding: '9px 16px', borderRadius: 12, fontSize: 13, fontWeight: 650, marginBottom: 16 }}>{t('rubric.addSection')}</button>

            {error && <div className="chip chip-danger" style={{ display: 'block', marginBottom: 12 }}>{error}</div>}
            <button onClick={save} disabled={saving} className="btn-primary" style={{ width: '100%', padding: 13, fontSize: 14.5 }}>{saving ? t('rubric.saving') : t('rubric.save')}</button>
          </div>
        )}
      </div>
    </div>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: 'block', flex: 1, minWidth: 0 }}>
      <span className="subtle" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{label}</span>
      {children}
    </label>
  );
}
