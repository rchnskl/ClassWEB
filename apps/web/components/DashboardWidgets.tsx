'use client';

import { useEffect, useState } from 'react';
import { apiFetch, type Environment } from '@/lib/api';
import { useI18n } from '@/lib/i18n';

/* ----------------------------- Realtime clock ---------------------------- */
export function ClockWidget() {
  const { lang, t } = useI18n();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    setNow(new Date());
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const locale = lang === 'th' ? 'th-TH-u-ca-buddhist' : 'en-GB';
  const time = now
    ? new Intl.DateTimeFormat(lang === 'th' ? 'th-TH' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(now)
    : '—';
  const date = now
    ? new Intl.DateTimeFormat(locale, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(now)
    : '';

  return (
    <div className="glass rise" style={{ padding: 20, minWidth: 210 }}>
      <div className="muted" style={{ fontSize: 12.5, fontWeight: 600, marginBottom: 6 }}>{t('widget.localTime')}</div>
      <div style={{ fontSize: 34, fontWeight: 750, letterSpacing: -1, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>{time}</div>
      <div className="subtle" style={{ fontSize: 13, marginTop: 8 }}>{date}</div>
    </div>
  );
}

/* --------------------------- Weather + AQI ------------------------------- */
const WEATHER: Record<number, { emoji: string; en: string; th: string }> = {
  0: { emoji: '☀️', en: 'Clear sky', th: 'ท้องฟ้าแจ่มใส' },
  1: { emoji: '🌤️', en: 'Mainly clear', th: 'ส่วนใหญ่แจ่มใส' },
  2: { emoji: '⛅', en: 'Partly cloudy', th: 'มีเมฆบางส่วน' },
  3: { emoji: '☁️', en: 'Overcast', th: 'เมฆมาก' },
  45: { emoji: '🌫️', en: 'Fog', th: 'หมอก' },
  48: { emoji: '🌫️', en: 'Rime fog', th: 'หมอกน้ำแข็ง' },
  51: { emoji: '🌦️', en: 'Light drizzle', th: 'ฝนปรอยเล็กน้อย' },
  53: { emoji: '🌦️', en: 'Drizzle', th: 'ฝนปรอย' },
  55: { emoji: '🌧️', en: 'Heavy drizzle', th: 'ฝนปรอยหนัก' },
  61: { emoji: '🌦️', en: 'Light rain', th: 'ฝนเล็กน้อย' },
  63: { emoji: '🌧️', en: 'Rain', th: 'ฝนตก' },
  65: { emoji: '🌧️', en: 'Heavy rain', th: 'ฝนตกหนัก' },
  80: { emoji: '🌦️', en: 'Rain showers', th: 'ฝนซู่' },
  81: { emoji: '🌧️', en: 'Rain showers', th: 'ฝนซู่' },
  82: { emoji: '⛈️', en: 'Violent showers', th: 'ฝนซู่รุนแรง' },
  95: { emoji: '⛈️', en: 'Thunderstorm', th: 'พายุฝนฟ้าคะนอง' },
  96: { emoji: '⛈️', en: 'Thunderstorm w/ hail', th: 'พายุฝนฟ้าคะนองมีลูกเห็บ' },
  99: { emoji: '⛈️', en: 'Severe thunderstorm', th: 'พายุฝนฟ้าคะนองรุนแรง' },
};

function aqi(usAqi: number | null): { color: string; en: string; th: string } {
  if (usAqi == null) return { color: 'var(--text-2)', en: 'Unknown', th: 'ไม่ทราบ' };
  if (usAqi <= 50) return { color: '#3aa76d', en: 'Good', th: 'ดี' };
  if (usAqi <= 100) return { color: '#d9a520', en: 'Moderate', th: 'ปานกลาง' };
  if (usAqi <= 150) return { color: '#e08a2b', en: 'Unhealthy (sensitive)', th: 'มีผลต่อกลุ่มเสี่ยง' };
  if (usAqi <= 200) return { color: '#e2564d', en: 'Unhealthy', th: 'มีผลต่อสุขภาพ' };
  if (usAqi <= 300) return { color: '#a855f7', en: 'Very unhealthy', th: 'อันตราย' };
  return { color: '#8b1f1f', en: 'Hazardous', th: 'อันตรายมาก' };
}

export function EnvironmentWidgets() {
  const { lang, t } = useI18n();
  const [env, setEnv] = useState<Environment | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    apiFetch<Environment>('/widgets/environment').then(setEnv).catch(() => setFailed(true));
  }, []);

  const w = env?.weather;
  const a = env?.air;
  const wInfo = w ? WEATHER[w.code] ?? { emoji: '🌡️', en: w.description, th: w.description } : null;
  const aInfo = aqi(a?.usAqi ?? null);

  return (
    <>
      {/* Weather */}
      <div className="glass rise" style={{ padding: 20, minWidth: 220, animationDelay: '60ms' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('widget.weather')}</span>
          <span style={{ fontSize: 30, lineHeight: 1 }} className="floaty">{wInfo?.emoji ?? '⏳'}</span>
        </div>
        {w ? (
          <>
            <div style={{ fontSize: 32, fontWeight: 750, letterSpacing: -1, marginTop: 8, lineHeight: 1 }}>
              {Math.round(w.temperature)}°C
            </div>
            <div className="subtle" style={{ fontSize: 13, marginTop: 6 }}>{lang === 'th' ? wInfo?.th : wInfo?.en}</div>
            <div className="muted" style={{ fontSize: 12, marginTop: 8, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <span>{t('widget.feelsLike')} {Math.round(w.apparentTemperature)}°</span>
              <span>💧 {w.humidity}%</span>
              <span>💨 {Math.round(w.windSpeed)} km/h</span>
            </div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>{failed ? t('widget.unavailable') : t('common.loading')}</div>
        )}
      </div>

      {/* Air quality */}
      <div className="glass rise" style={{ padding: 20, minWidth: 220, animationDelay: '120ms' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <span className="muted" style={{ fontSize: 12.5, fontWeight: 600 }}>{t('widget.airQuality')}</span>
          <span className="chip" style={{ background: `${aInfo.color}22`, color: aInfo.color }}>
            {lang === 'th' ? aInfo.th : aInfo.en}
          </span>
        </div>
        {a ? (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginTop: 8 }}>
              <div style={{ fontSize: 32, fontWeight: 750, letterSpacing: -1, lineHeight: 1, color: aInfo.color }}>{a.usAqi ?? '—'}</div>
              <div className="muted" style={{ fontSize: 12 }}>{t('widget.aqi')}</div>
            </div>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 10, display: 'flex', gap: 14 }}>
              <span><b style={{ color: 'var(--text-1)' }}>PM2.5</b> {a.pm25?.toFixed(1) ?? '—'}</span>
              <span><b style={{ color: 'var(--text-1)' }}>PM10</b> {a.pm10?.toFixed(1) ?? '—'}</span>
            </div>
            <div className="muted" style={{ fontSize: 10.5, marginTop: 8 }}>{env?.source}</div>
          </>
        ) : (
          <div className="muted" style={{ fontSize: 13, marginTop: 12 }}>{failed ? t('widget.unavailable') : t('common.loading')}</div>
        )}
      </div>
    </>
  );
}
