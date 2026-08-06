'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

export interface StudentHit {
  id: string;
  studentCode: string;
  nameEn: string;
  nameTh: string | null;
  yearLevel: number | null;
  status: string;
  program: { id: string; code: string };
}

/**
 * Type-ahead search over the central roster.
 *
 * Replaces the old "load 200 students into a <select>" approach, which both
 * broke once the roster grew past the page size and stopped working entirely
 * for lecturers once /students was scoped to their own sections. This hits
 * /students/lookup, which is allowed to find anyone in the faculty but only
 * ever returns identifying fields.
 */
export default function StudentPicker({
  onPick, excludeSectionId, yearLevel, disabled, placeholder,
}: {
  onPick: (student: StudentHit) => void;
  excludeSectionId?: string;
  yearLevel?: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<StudentHit[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  // Debounced lookup. The endpoint rejects anything shorter than 2 characters,
  // so don't spend a request on it.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setHits([]); setLoading(false); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const params = new URLSearchParams({ q: term, take: '15' });
        if (excludeSectionId) params.set('excludeSectionId', excludeSectionId);
        if (yearLevel !== undefined) params.set('yearLevel', String(yearLevel));
        const data = await apiFetch<StudentHit[]>(`/students/lookup?${params.toString()}`);
        setHits(data);
        setCursor(0);
        setOpen(true);
      } catch {
        setHits([]);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [q, excludeSectionId, yearLevel]);

  // Close when focus leaves the whole widget.
  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function choose(hit: StudentHit) {
    onPick(hit);
    setQ('');
    setHits([]);
    setOpen(false);
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || hits.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, hits.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); choose(hits[cursor]); }
    else if (e.key === 'Escape') { setOpen(false); }
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        className="input"
        value={q}
        disabled={disabled}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => { if (hits.length) setOpen(true); }}
        onKeyDown={onKeyDown}
        placeholder={placeholder ?? t('picker.placeholder')}
        role="combobox"
        aria-expanded={open}
        aria-controls="student-picker-list"
        aria-autocomplete="list"
        autoComplete="off"
      />

      {open && (
        <ul
          id="student-picker-list"
          role="listbox"
          className="glass"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 40,
            maxHeight: 260, overflowY: 'auto', borderRadius: 12, padding: 6, margin: 0, listStyle: 'none',
            boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          }}
        >
          {loading && <li className="muted" style={{ padding: '10px 12px', fontSize: 13 }}>{t('common.loading')}</li>}
          {!loading && hits.length === 0 && (
            <li className="muted" style={{ padding: '10px 12px', fontSize: 13 }}>{t('picker.noResults')}</li>
          )}
          {hits.map((h, i) => (
            <li key={h.id} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => choose(h)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 11px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: i === cursor ? 'var(--glass-hairline)' : 'transparent', color: 'var(--text-0)',
                }}
              >
                <span style={{ fontFamily: 'ui-monospace, monospace', fontWeight: 600, fontSize: 12.5 }}>{h.studentCode}</span>
                <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {h.nameTh ? `${h.nameTh} (${h.nameEn})` : h.nameEn}
                </span>
                {h.yearLevel != null && (
                  <span className="chip" style={{ background: 'var(--glass-hairline)', color: 'var(--text-2)', fontSize: 11.5 }}>
                    {t('common.year')} {h.yearLevel}
                  </span>
                )}
                {h.status !== 'STUDYING' && (
                  <span className="chip chip-warning" style={{ fontSize: 11.5 }}>{t(`students.status.${h.status}`)}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
