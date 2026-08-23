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

/**
 * Client-side mirror of the backend scoring (for live feedback), including
 * the OSCE-style critical-fail rule. Must stay in step with
 * AssessmentService.scoreRubric or the live total misleads the grader:
 * the score is an average over the items actually examined, so a procedure
 * the student never drew doesn't drag them down, while an explicit 0 does.
 */
function scoreRubric(rubric: Rubric, ratings: Record<string, number>, passed: Record<string, boolean>): { total: number; criticalFailed: boolean } {
  let weightedSum = 0;
  let attemptedSectionWeight = 0;
  let criticalFailed = false;

  for (const s of rubric.sections) {
    // Weights left at 0 fall back to the full marks — mirrors the server, where
    // it stops a blank-weight rubric from scoring everyone 0.
    const examined = s.items.filter((it) => ratings[it.id] != null);
    const weightless = examined.length > 0 && examined.every((it) => it.weightPercent === 0);
    const w = (it: Item) => (weightless ? it.maxRating : it.weightPercent);

    let scored = 0;
    let attemptedItemWeight = 0;
    for (const it of s.items) {
      if (it.isCritical && passed[it.id] === false) criticalFailed = true;
      const r = ratings[it.id];
      if (r == null) continue;
      attemptedItemWeight += w(it);
      scored += w(it) * (r / it.maxRating);
    }
    if (attemptedItemWeight === 0) continue;
    weightedSum += s.weightPercent * ((scored / attemptedItemWeight) * 100);
    attemptedSectionWeight += s.weightPercent;
  }

  if (attemptedSectionWeight === 0) {
    for (const s of rubric.sections) {
      const examined = s.items.filter((it) => ratings[it.id] != null);
      if (examined.length === 0) continue;
      const useMarks = examined.every((it) => it.weightPercent === 0);
      const w = (it: Item) => (useMarks ? it.maxRating : it.weightPercent);
      const totalW = examined.reduce((a, it) => a + w(it), 0);
      if (totalW <= 0) continue;
      weightedSum += (examined.reduce((a, it) => a + w(it) * ((ratings[it.id] ?? 0) / it.maxRating), 0) / totalW) * 100;
      attemptedSectionWeight += 1;
    }
  }

  const total = attemptedSectionWeight > 0 ? weightedSum / attemptedSectionWeight : 0;
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
  // Which procedure is being examined. A checklist that holds several
  // procedures (the lab exam) is usually sat one drawn procedure at a time,
  // so showing all 172 steps at once buries the handful that matter. null =
  // show every procedure, for the sitting where the student performs them all.
  const [onlySectionId, setOnlySectionId] = useState<string | null>(null);

  const [summary, setSummary] = useState<Summary | null>(null);
  const [activeId, setActiveId] = useState<string>(rubrics[0]?.id ?? '');
  const [ratings, setRatings] = useState<Record<string, number>>({});
  const [passed, setPassed] = useState<Record<string, boolean>>({});
  const [weights, setWeights] = useState<Record<string, number>>({});
  const [weightsDirty, setWeightsDirty] = useState(false);
  // Direct entry: some components are marked outside the app (a written exam,
  // a case study) and come back as one number. Working out per-item marks to
  // fit them into a checklist is arithmetic no one should have to do.
  const [directMode, setDirectMode] = useState(false);
  const [rawScore, setRawScore] = useState<string>('');
  const [rawMax, setRawMax] = useState<string>('');
  const [directPercent, setDirectPercent] = useState<string>('');
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
    apiFetch<{ evaluation: { scores: Record<string, number>; passed: Record<string, boolean>; scorePercent: number | null; rawScore: number | null; rawMax: number | null } | null }>(`/assessment/evaluation?rubricId=${activeId}&studentId=${studentId}&sectionId=${sectionId}`)
      .then((d) => {
        const ev = d.evaluation;
        setRatings(ev?.scores ?? {});
        setPassed(ev?.passed ?? {});
        // Reopen in whichever way it was graded, so a re-save doesn't quietly
        // switch the record from one to the other.
        const wasDirect = !!ev && Object.keys(ev.scores ?? {}).length === 0 && ev.scorePercent != null;
        setDirectMode(wasDirect);
        setRawScore(ev?.rawScore != null ? String(ev.rawScore) : '');
        setRawMax(ev?.rawMax != null ? String(ev.rawMax) : '');
        setDirectPercent(wasDirect && ev?.rawScore == null && ev?.scorePercent != null ? String(ev.scorePercent) : '');
      })
      .catch(() => { setRatings({}); setPassed({}); setDirectMode(false); setRawScore(''); setRawMax(''); setDirectPercent(''); });
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
      // Send every item the grader touched, including a deliberate 0 — that
      // is a real mark and has to count. Only untouched items are omitted,
      // which is what marks a procedure as "not examined".
      const scores = directMode ? [] : Object.entries(ratings).filter(([, v]) => v != null).map(([rubricItemId, rating]) => ({
        rubricItemId, rating, ...(rubricItemId in passed ? { passed: passed[rubricItemId] } : {}),
      }));
      const direct = directMode
        ? (rawScore !== '' && rawMax !== ''
            ? { rawScore: Number(rawScore), rawMax: Number(rawMax) }
            : { scorePercent: Number(directPercent) })
        : undefined;
      await apiFetch('/assessment/evaluation', { method: 'POST', body: JSON.stringify({ rubricId: active.id, studentId, sectionId, scores, ...(direct ? { direct } : {}) }) });
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

  const directTotal = rawScore !== '' && rawMax !== '' && Number(rawMax) > 0
    ? Math.round((Number(rawScore) / Number(rawMax)) * 10000) / 100
    : directPercent !== '' ? Number(directPercent) : 0;
  const itemLive = active ? scoreRubric({ ...active, sections: active.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, weightPercent: weights[i.id] ?? i.weightPercent })) })) }, ratings, passed) : { total: 0, criticalFailed: false };
  const live = directMode ? { total: directTotal, criticalFailed: false } : itemLive;

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

                {/* How this rubric is being scored. Item by item is the default;
                    direct entry is for a component marked elsewhere. */}
                <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
                  {([false, true] as const).map((mode) => (
                    <button key={String(mode)} onClick={() => setDirectMode(mode)}
                      style={{ padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, cursor: 'pointer',
                        border: directMode === mode ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)',
                        background: directMode === mode ? 'linear-gradient(120deg, var(--brand-2), var(--brand))' : 'transparent',
                        color: directMode === mode ? '#fff' : 'var(--text-2)' }}>
                      {mode ? t('as.modeDirect') : t('as.modeItems')}
                    </button>
                  ))}
                </div>

                {directMode ? (
                  <div style={{ border: '1px solid var(--glass-hairline)', borderRadius: 14, padding: 16, marginBottom: 14 }}>
                    <div className="muted" style={{ fontSize: 12, marginBottom: 12 }}>{t('as.directHint')}</div>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10, flexWrap: 'wrap' }}>
                      <label style={{ display: 'block' }}>
                        <span className="subtle" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{t('as.rawScore')}</span>
                        <input type="number" min={0} step={0.5} className="input" style={{ width: 110 }} value={rawScore}
                          onChange={(e) => { setRawScore(e.target.value); setDirectPercent(''); }} />
                      </label>
                      <span style={{ paddingBottom: 12, fontSize: 15, color: 'var(--text-2)' }}>/</span>
                      <label style={{ display: 'block' }}>
                        <span className="subtle" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>{t('as.rawMax')}</span>
                        <input type="number" min={0} step={0.5} className="input" style={{ width: 110 }} value={rawMax}
                          onChange={(e) => { setRawMax(e.target.value); setDirectPercent(''); }} />
                      </label>
                      <span style={{ paddingBottom: 12, fontSize: 12, color: 'var(--text-2)' }}>{t('as.orPercent')}</span>
                      <label style={{ display: 'block' }}>
                        <span className="subtle" style={{ fontSize: 11, fontWeight: 600, display: 'block', marginBottom: 4 }}>%</span>
                        <input type="number" min={0} max={100} step={0.01} className="input" style={{ width: 110 }} value={directPercent}
                          onChange={(e) => { setDirectPercent(e.target.value); setRawScore(''); setRawMax(''); }} />
                      </label>
                    </div>
                    <div style={{ marginTop: 12, fontSize: 13 }}>
                      {t('as.rubricScore')}: <b style={{ fontSize: 17, color: 'var(--brand)' }}>{directTotal}</b>/100
                      {rawScore !== '' && rawMax !== '' && Number(rawMax) > 0 && (
                        <span className="muted" style={{ marginLeft: 8, fontSize: 12 }}>({rawScore}/{rawMax} · {t('as.contributes')} {Math.round(directTotal * active.weightPercent) / 100})</span>
                      )}
                    </div>
                  </div>
                ) : (
                <>
                {active.sections.length > 1 && (
                  <div style={{ marginBottom: 12 }}>
                    <div className="subtle" style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>{t('as.whichProcedure')}</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                      <button
                        onClick={() => setOnlySectionId(null)}
                        style={{
                          padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, cursor: 'pointer',
                          border: onlySectionId === null ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)',
                          background: onlySectionId === null ? 'linear-gradient(120deg, var(--brand-2), var(--brand))' : 'transparent',
                          color: onlySectionId === null ? '#fff' : 'var(--text-2)',
                        }}
                      >
                        {t('as.allProcedures')}
                      </button>
                      {active.sections.map((s) => {
                        const graded = s.items.some((it) => ratings[it.id] != null);
                        const on = onlySectionId === s.id;
                        return (
                          <button
                            key={s.id}
                            onClick={() => setOnlySectionId(s.id)}
                            title={name(s.nameEn, s.nameTh)}
                            style={{
                              padding: '6px 12px', borderRadius: 999, fontSize: 12, fontWeight: 650, cursor: 'pointer',
                              border: on ? '1px solid var(--brand)' : '1px solid var(--glass-hairline)',
                              background: on ? 'linear-gradient(120deg, var(--brand-2), var(--brand))' : 'transparent',
                              color: on ? '#fff' : 'var(--text-2)',
                            }}
                          >
                            {graded && '✓ '}{name(s.nameEn, s.nameTh)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="muted" style={{ fontSize: 11.5, marginTop: 6 }}>{t('as.procedureHint')}</div>
                  </div>
                )}

                {active.sections.filter((s) => onlySectionId === null || s.id === onlySectionId).map((s) => (
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
          </>
        )}
      </div>
    </div>
  );
}
