'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiFetch, type Paginated } from '@/lib/api';
import { useI18n } from '@/lib/i18n';
import { IconSearch } from './icons';

interface StudentHit { id: string; studentCode: string; nameEn: string; nameTh: string | null; yearLevel: number | null }
interface SectionHit { id: string; sectionNo: string; subject: { code: string; nameEn: string } }
interface RoomHit { id: string; roomNumber: string }

type Result =
  | { kind: 'student'; id: string; primary: string; secondary: string }
  | { kind: 'section'; id: string; primary: string; secondary: string }
  | { kind: 'room'; id: string; primary: string; secondary: string };

/**
 * The Topbar search box used to be a static <span> — no input, no handler,
 * completely decorative. This is the real thing: type-ahead across students,
 * sections, and rooms, each result routing to where it actually lives.
 */
export default function GlobalSearch() {
  const router = useRouter();
  const { t } = useI18n();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [cursor, setCursor] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const [students, sections, rooms] = await Promise.allSettled([
          apiFetch<StudentHit[]>(`/students/lookup?q=${encodeURIComponent(term)}&take=6`),
          apiFetch<Paginated<SectionHit>>(`/sections?search=${encodeURIComponent(term)}&take=6`),
          apiFetch<RoomHit[] | Paginated<RoomHit>>(`/rooms?search=${encodeURIComponent(term)}&take=6`),
        ]);
        const out: Result[] = [];
        if (students.status === 'fulfilled') {
          out.push(...students.value.map((s) => ({
            kind: 'student' as const, id: s.id, primary: `${s.studentCode} — ${s.nameTh ?? s.nameEn}`,
            secondary: s.yearLevel != null ? `${t('common.year')} ${s.yearLevel}` : '',
          })));
        }
        if (sections.status === 'fulfilled') {
          out.push(...sections.value.items.map((s) => ({
            kind: 'section' as const, id: s.id, primary: `${s.subject.code} — ${s.subject.nameEn}`,
            secondary: `${t('sec.sectionNo')} ${s.sectionNo}`,
          })));
        }
        if (rooms.status === 'fulfilled') {
          const items = Array.isArray(rooms.value) ? rooms.value : rooms.value.items;
          out.push(...items.map((r) => ({ kind: 'room' as const, id: r.id, primary: r.roomNumber, secondary: t('nav.timetable') })));
        }
        setResults(out);
        setCursor(0);
        setOpen(true);
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  function go(r: Result) {
    setOpen(false);
    setQ('');
    if (r.kind === 'student') router.push(`/students?search=${encodeURIComponent(r.primary.split(' — ')[0])}`);
    else if (r.kind === 'section') router.push('/sections');
    else router.push('/timetable');
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || results.length === 0) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setCursor((c) => Math.min(c + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setCursor((c) => Math.max(c - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[cursor]); }
    else if (e.key === 'Escape') setOpen(false);
  }

  const iconFor = { student: '🎓', section: '📚', room: '🏫' } as const;

  return (
    <div ref={boxRef} className="hide-mobile" style={{ position: 'relative', flex: '1 1 180px', minWidth: 0, maxWidth: 420 }}>
      <div
        className="glass hairline"
        style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderRadius: 14, color: 'var(--text-2)' }}
      >
        <IconSearch style={{ flexShrink: 0 }} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onFocus={() => { if (results.length) setOpen(true); }}
          onKeyDown={onKeyDown}
          placeholder={t('top.search')}
          role="combobox"
          aria-expanded={open}
          aria-controls="global-search-list"
          aria-autocomplete="list"
          autoComplete="off"
          style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--text-0)', fontSize: 14, width: '100%' }}
        />
      </div>

      {open && (
        <ul
          id="global-search-list"
          role="listbox"
          className="glass"
          style={{
            position: 'absolute', top: 'calc(100% + 6px)', left: 0, right: 0, zIndex: 60,
            maxHeight: 320, overflowY: 'auto', borderRadius: 12, padding: 6, margin: 0, listStyle: 'none',
            boxShadow: '0 12px 32px rgba(0,0,0,0.28)',
          }}
        >
          {loading && <li className="muted" style={{ padding: '10px 12px', fontSize: 13 }}>{t('common.loading')}</li>}
          {!loading && results.length === 0 && <li className="muted" style={{ padding: '10px 12px', fontSize: 13 }}>{t('picker.noResults')}</li>}
          {results.map((r, i) => (
            <li key={`${r.kind}-${r.id}`} role="option" aria-selected={i === cursor}>
              <button
                type="button"
                onMouseEnter={() => setCursor(i)}
                onClick={() => go(r)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, width: '100%', textAlign: 'left',
                  padding: '9px 11px', borderRadius: 9, border: 'none', cursor: 'pointer',
                  background: i === cursor ? 'var(--glass-hairline)' : 'transparent', color: 'var(--text-0)',
                }}
              >
                <span aria-hidden style={{ fontSize: 15 }}>{iconFor[r.kind]}</span>
                <span style={{ flex: 1, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.primary}</span>
                {r.secondary && <span className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap' }}>{r.secondary}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
