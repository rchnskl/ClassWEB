'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

interface Item { id: string; textEn: string; textTh: string | null; weightPercent: number; maxRating: number; isCritical: boolean }
interface RSection { id: string; nameEn: string; nameTh: string | null; weightPercent: number; items: Item[] }
export interface Rubric { id: string; code: string; nameEn: string; nameTh: string | null; weightPercent: number; sections: RSection[] }
interface Summary {
  total: number; gradedWeight: number;
  grade: { grade: string; gpa: number; label: string } | null;
  rubrics: { rubricId: string; nameEn: string; nameTh: string | null; weightPercent: number; scorePercent: number | null; graded: boolean; criticalFailed: boolean; contribution: number }[];
}

/** Client-side mirror of the backend scoring (for live feedback), including the OSCE-style critical-fail rule. */
function scoreRubric(rubric: Rubric, ratings: Record<string, number>, passed: Record<string, boolean>): { total: number; criticalFailed: boolean } {
  let total = 0;
  let criticalFailed = false;
  for (const s of rubric.sections) {
    let sec = 0;
    for (const it of s.items) {
      const r = ratings[it.id];
      if (r) sec += it.weightPercent * (r / it.maxRating);
      if (it.isCritical && passed[it.id] === false) criticalFailed = true;
    }
    total += (s.weightPercent / 100) * sec;
  }
  return { total: criticalFailed ? 0 : Math.round(total * 100) / 100, criticalFailed };
}

export default function GradingDrawer({
  studentId, sectionId, studentName, rubrics, onClose, onSaved,
}: {
  studentId: string; sectionId: string; studentName: string; rubrics: Rubric[];
  onClose: () => void; onSaved: () => void;
}) {
  const { t, lang } = useI18n();
  const name = (en: string, th: string | null) => (lang === 'th' && th ? th : en);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeId, setActiveId] = useState<string>(rubrics[0]?.id ?? '');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [passed, setPassed] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightsDirty, setWeightsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savingW, setSavingW] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const active = rubrics.find((r) => r.id === activeId);

  const loadSummary = useCallback(async () => {
    try {
      const s = await apiFetch<Summary>(`/assessment/students/${studentId}/summary?sectionId=${sectionId}`);
      setSummary(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load summary');
    }
  }, [studentId, sectionId]);

  useEffect(() => { void loadSummary(); }, [loadSummary]);

  useEffect(() => {
    if (rubrics.length && !rubrics.some((r) => r.id === activeId)) setActiveId(rubrics[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rubrics]);

  // Load existing scores + item weights when the active rubric changes.
  useEffect(() => {
    if (!activeId) return;
    apiFetch<{ evaluation: { scores: Record<string, number>; passed: Record<string, boolean> } | null }>(`/assessment/evaluation?rubricId=${activeId}&studentId=${studentId}&sectionId=${sectionId}`)
      .then((d) => { setRatings(d.evaluation?.scores ?? {}); setPassed(d.evaluation?.passed ?? {}); })
      .catch(() => { setRatings({}); setPassed({}); });
    const r = rubrics.find((x) => x.id === activeId);
    const w: Record<string, number> = {};
    r?.sections.forEach((s) => s.items.forEach((i) => { w[i.id] = i.weightPercent; }));
    setWeights(w); setWeightsDirty(false);
  }, [activeId, studentId, sectionId, rubrics]);

  async function save() {
    if (!active) return;
    setSaving(true);
    setError(null);
    try {
      const scores = Object.entries(ratings).filter(([, v]) => v > 0).map(([rubricItemId, rating]) => ({
        rubricItemId, rating, ...(rubricItemId in passed ? { passed: passed[rubricItemId] } : {}),
      }));
      await apiFetch('/assessment/evaluation', { method: 'POST', body: JSON.stringify({ rubricId: active.id, studentId, sectionId, scores }) });
      await loadSummary();
      onSaved();
    } catch (err) {
      // Never let a failed save look like success — the grade would be lost silently.
      setError(err instanceof Error ? err.message : 'Failed to save the evaluation. Please try again.');
    } finally { setSaving(false); }
  }

  async function saveWeights() {
    if (!active) return;
    setSavingW(true);
    setError(null);
    try {
      const items = active.sections.flatMap((s) => s.items).map((i) => ({ id: i.id, weightPercent: weights[i.id] ?? i.weightPercent }));
      await apiFetch(`/assessment/rubrics/${active.id}/weights`, { method: 'PATCH', body: JSON.stringify({ items }) });
      active.sections.forEach((s) => s.items.forEach((i) => { i.weightPercent = weights[i.id] ?? i.weightPercent; }));
      setWeightsDirty(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save weights. Please try again.');
    } finally { setSavingW(false); }
  }

  const live = active ? scoreRubric({ ...active, sections: active.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, weightPercent: weights[i.id] ?? i.weightPercent })) })) }, ratings, passed) : { total: 0, criticalFailed: false };

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(6,10,20,0.5)', backdropFilter: 'blur(3px)', zIndex: 1100, display: 'flex', justifyContent: 'flex-end' }}>
      <div onClick={(e) => e.stopPropagation()} className="rise" style={{ width: 'min(640px, 100%)', height: '100%', background: 'var(--popover-bg)', borderLeft: '1px solid var(--glass-hairline)', boxShadow: 'var(--shadow-lg)', padding: 22, overflowY: 'auto' }}>
        {/* Header: student + total + grade */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
          <div>
            <div style={{ fontWeight: 750, fontSize: 18 }}>{studentName}</div>
            {summary && (
              <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>
                {t('as.total')}: <b style={{ color: 'var(--brand)' }}>{summary.total}</b>/100 · {t('as.grade')}:{' '}
                <b style={{ color: 'var(--text-0)' }}>{summary.grade?.grade ?? '—'}</b> {summary.grade ? `(${summary.grade.gpa.toFixed(2)} ${summary.grade.label})` : ''}
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label={t('common.close')} className="glass hairline icon-btn" style={{ width: 34, height: 34, fontSize: 18 }}>×</button>
        </div>

        {error && (
          <div className="chip chip-danger" role="alert" style={{ display: 'block', marginBottom: 12, width: '100%' }}>{error}</div>
        )}

        {rubrics.length === 0 ? (
          <div className="muted" style={{ textAlign: 'center', padding: 40 }}>{t('as.noneActive')}</div>
        ) : (
          <>
            {/* Rubric chips */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
              {rubrics.map((r) => {
                const row = summary?.rubrics.find((x) => x.rubricId === r.id);
                return (
                  <button key={r.id} onClick={() => setActiveId(r.id)}
                    style={{ padding: '8px 12px', borderRadius: 12, cursor: 'pointer', fontSize: 12.5, fontWeight: 600,
                      border: r.id === activeId ? '1.5px solid var(--brand)' : row?.criticalFailed ? '1px solid var(--danger)' : '1px solid var(--glass-hairline)',
                      background: r.id === activeId ? 'var(--popover-hover)' : 'transparent', color: 'var(--text-0)' }}>
                    {name(r.nameEn, r.nameTh)} · {r.weightPercent}%
                    {row?.criticalFailed ? <span style={{ color: 'var(--danger)', marginLeft: 6 }}>✕ {t('as.criticalFail')}</span>
                      : row?.graded && <span style={{ color: 'var(--success)', marginLeft: 6 }}>✓{row.scorePercent}</span>}
                  </button>
                );
              })}
            </div>

            {active && (
              <>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, position: 'sticky', top: 0, background: 'var(--popover-bg)', padding: '6px 0', zIndex: 2 }}>
                  <div style={{ fontSize: 13 }}>
                    {t('as.rubricScore')}: <b style={{ fontSize: 18, color: live.criticalFailed ? 'var(--danger)' : 'var(--brand)' }}>{live.total}</b>/100
                    {live.criticalFailed && <span className="chip chip-danger" style={{ marginLeft: 8 }}>{t('as.criticalFail')}</span>}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {weightsDirty && <button onClick={saveWeights} disabled={savingW} className="glass hairline" style={{ padding: '8px 12px', borderRadius: 10, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', color: 'var(--text-1)' }}>{savingW ? '…' : t('as.editWeights')}</button>}
                    <button onClick={save} disabled={saving} className="btn-primary" style={{ padding: '9px 18px', fontSize: 13.5 }}>{saving ? t('as.saving') : t('as.save')}</button>
                  </div>
                </div>

                {active.sections.map((s) => (
                  <div key={s.id} style={{ marginBottom: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontWeight: 700, fontSize: 13.5, padding: '6px 10px', borderRadius: 8, background: 'var(--popover-hover)', marginBottom: 6 }}>
                      <span>{name(s.nameEn, s.nameTh)}</span><span className="muted" style={{ fontSize: 12 }}>{s.weightPercent}%</span>
                    </div>
                    {s.items.map((it) => (
                      <div key={it.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderBottom: '1px solid var(--glass-hairline)', background: it.isCritical && passed[it.id] === false ? 'rgba(226,86,77,0.08)' : undefined }}>
                        <div style={{ flex: 1, fontSize: 12.5, lineHeight: 1.35 }}>
                          {it.isCritical && <span title={t('as.criticalItem')} style={{ color: 'var(--danger)', marginRight: 4 }}>★</span>}
                          {name(it.textEn, it.textTh)}
                        </div>
                        <input type="number" min={0} max={100} value={weights[it.id] ?? it.weightPercent}
                          onChange={(e) => { setWeights({ ...weights, [it.id]: Number(e.target.value) }); setWeightsDirty(true); }}
                          title={t('as.weight')}
                          style={{ width: 52, padding: '4px 6px', fontSize: 11.5, textAlign: 'right', borderRadius: 8, border: '1px solid var(--glass-hairline)', background: 'transparent', color: 'var(--text-2)' }} />
                        <span className="muted" style={{ fontSize: 10 }}>%</span>
                        {/* A short observation scale stays a row of buttons —
                            fastest to tap through a checklist. A score
                            component (full mark 25, 30, …) can't be a button
                            row, so it takes the raw mark directly. */}
                        {it.maxRating <= 5 ? (
                          <div style={{ display: 'flex', gap: 3 }}>
                            {Array.from({ length: it.maxRating }, (_, i) => i + 1).map((n) => (
                              <button key={n} onClick={() => setRatings({ ...ratings, [it.id]: n })}
                                style={{ width: 26, height: 26, borderRadius: 7, fontSize: 12, fontWeight: 700, cursor: 'pointer',
                                  border: (ratings[it.id] === n) ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)',
                                  background: (ratings[it.id] === n) ? 'linear-gradient(120deg, var(--brand-2), var(--brand))' : 'transparent',
                                  color: (ratings[it.id] === n) ? '#fff' : 'var(--text-2)' }}>{n}</button>
                            ))}
                          </div>
                        ) : (
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <input
                              type="number" min={0} max={it.maxRating} step={0.5}
                              value={ratings[it.id] ?? ''}
                              placeholder="0"
                              aria-label={`${name(it.textEn, it.textTh)} — ${t('as.score')}`}
                              onChange={(e) => {
                                const v = e.target.value;
                                if (v === '') { const next = { ...ratings }; delete next[it.id]; setRatings(next); return; }
                                setRatings({ ...ratings, [it.id]: Math.min(Number(v), it.maxRating) });
                              }}
                              style={{ width: 62, padding: '4px 6px', fontSize: 12.5, textAlign: 'right', borderRadius: 8,
                                border: '1px solid var(--glass-hairline)', background: 'transparent', color: 'var(--text-0)' }} />
                            <span className="muted" style={{ fontSize: 11 }}>/ {it.maxRating}</span>
                          </div>
                        )}
                        {it.isCritical && (
                          <div style={{ display: 'flex', gap: 3, marginLeft: 4 }}>
                            <button onClick={() => setPassed({ ...passed, [it.id]: true })} title={t('as.passed')}
                              style={{ width: 26, height: 26, borderRadius: 7, fontSize: 13, cursor: 'pointer',
                                border: passed[it.id] === true ? '1px solid var(--success)' : '1px solid var(--glass-hairline)',
                                background: passed[it.id] === true ? 'var(--success)' : 'transparent',
                                color: passed[it.id] === true ? '#fff' : 'var(--text-2)' }}>✓</button>
                            <button onClick={() => setPassed({ ...passed, [it.id]: false })} title={t('as.failed')}
                              style={{ width: 26, height: 26, borderRadius: 7, fontSize: 13, cursor: 'pointer',
                                border: passed[it.id] === false ? '1px solid var(--danger)' : '1px solid var(--glass-hairline)',
                                background: passed[it.id] === false ? 'var(--danger)' : 'transparent',
                                color: passed[it.id] === false ? '#fff' : 'var(--text-2)' }}>✕</button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
