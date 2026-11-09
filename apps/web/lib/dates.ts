/**
 * Today's date (YYYY-MM-DD) on the faculty's clock, Bangkok time.
 *
 * Not `new Date().toISOString().slice(0, 10)`: that is the UTC date, which
 * is still yesterday until 07:00 in Thailand — exactly when clinical
 * practice starts, so a 07:00 session went missing from "today".
 */
export function todayBangkok(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
