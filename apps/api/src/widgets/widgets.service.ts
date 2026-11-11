import { Injectable, Logger } from '@nestjs/common';

/**
 * Server-side proxy for dashboard environment widgets (weather + air quality).
 * Data source: Open-Meteo (open-meteo.com) — a keyless, reputable aggregator of
 * national weather services and CAMS air-quality models. Fetched server-side so
 * no third-party call or key is exposed to the browser, and cached to stay well
 * within fair-use limits.
 */

// Assumption University — Suvarnabhumi Campus, Samut Prakan.
const CAMPUS = { name: 'Suvarnabhumi Campus, Samut Prakan', lat: 13.6116, lng: 100.8425 };
const CACHE_MS = 10 * 60 * 1000;
const RETRY_MS = 60_000; // after a partial failure
const STALE_MS = 3 * 60 * 60_000; // how old a last-good reading may be

export interface EnvironmentPayload {
  location: { name: string; lat: number; lng: number };
  weather: {
    temperature: number;
    apparentTemperature: number;
    humidity: number;
    windSpeed: number;
    code: number;
    isDay: boolean;
    description: string;
  } | null;
  air: {
    pm25: number | null;
    pm10: number | null;
    usAqi: number | null;
    category: string;
  } | null;
  source: string;
  fetchedAt: string;
  errors: string[];
}

// WMO weather code → short English label (frontend localises by code).
const WMO: Record<number, string> = {
  0: 'Clear sky', 1: 'Mainly clear', 2: 'Partly cloudy', 3: 'Overcast',
  45: 'Fog', 48: 'Rime fog', 51: 'Light drizzle', 53: 'Drizzle', 55: 'Heavy drizzle',
  61: 'Light rain', 63: 'Rain', 65: 'Heavy rain', 66: 'Freezing rain', 67: 'Freezing rain',
  71: 'Light snow', 73: 'Snow', 75: 'Heavy snow', 80: 'Rain showers', 81: 'Rain showers',
  82: 'Violent rain showers', 95: 'Thunderstorm', 96: 'Thunderstorm w/ hail', 99: 'Severe thunderstorm',
};

function aqiCategory(usAqi: number | null): string {
  if (usAqi == null) return 'Unknown';
  if (usAqi <= 50) return 'Good';
  if (usAqi <= 100) return 'Moderate';
  if (usAqi <= 150) return 'Unhealthy (sensitive)';
  if (usAqi <= 200) return 'Unhealthy';
  if (usAqi <= 300) return 'Very unhealthy';
  return 'Hazardous';
}

@Injectable()
export class WidgetsService {
  private readonly logger = new Logger('Widgets');
  private cache: { data: EnvironmentPayload; expires: number } | null = null;
  // Last good reading of each part: Open-Meteo's two endpoints fail
  // independently, and an hour-old temperature beats an endless spinner.
  private lastWeather: { value: NonNullable<EnvironmentPayload['weather']>; at: number } | null = null;
  private lastAir: { value: NonNullable<EnvironmentPayload['air']>; at: number } | null = null;
  private inFlight: Promise<EnvironmentPayload> | null = null;

  async environment(): Promise<EnvironmentPayload> {
    if (this.cache && this.cache.expires > Date.now()) return this.cache.data;
    // Many dashboards opening at once share one upstream fetch.
    this.inFlight ??= this.refresh().finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  private async refresh(): Promise<EnvironmentPayload> {
    const errors: string[] = [];
    const [weather, air] = await Promise.all([
      this.fetchWeather().catch((e) => { errors.push(`weather: ${e.message}`); return null; }),
      this.fetchAir().catch((e) => { errors.push(`air: ${e.message}`); return null; }),
    ]);
    const now = Date.now();
    if (weather) this.lastWeather = { value: weather, at: now };
    if (air) this.lastAir = { value: air, at: now };
    const fresh = (x: { at: number } | null) => x && now - x.at < STALE_MS;

    const data: EnvironmentPayload = {
      location: CAMPUS,
      weather: weather ?? (fresh(this.lastWeather) ? this.lastWeather!.value : null),
      air: air ?? (fresh(this.lastAir) ? this.lastAir!.value : null),
      source: 'Open-Meteo (open-meteo.com)',
      fetchedAt: new Date().toISOString(),
      errors,
    };
    // A full success is cached for the usual period; a partial one briefly,
    // so the failed half is retried soon without every page load waiting on it.
    this.cache = { data, expires: now + (weather && air ? CACHE_MS : RETRY_MS) };
    return data;
  }

  private async getJson(url: string): Promise<any> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 5000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
    }
  }

  private async fetchWeather(): Promise<EnvironmentPayload['weather']> {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lng}&current=temperature_2m,relative_humidity_2m,apparent_temperature,weather_code,wind_speed_10m,is_day&timezone=Asia%2FBangkok`;
    const json = await this.getJson(url);
    const c = json.current;
    const code = Number(c.weather_code);
    return {
      temperature: Number(c.temperature_2m),
      apparentTemperature: Number(c.apparent_temperature),
      humidity: Number(c.relative_humidity_2m),
      windSpeed: Number(c.wind_speed_10m),
      code,
      isDay: c.is_day === 1,
      description: WMO[code] ?? 'Unknown',
    };
  }

  private async fetchAir(): Promise<EnvironmentPayload['air']> {
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${CAMPUS.lat}&longitude=${CAMPUS.lng}&current=pm2_5,pm10,us_aqi&timezone=Asia%2FBangkok`;
    const json = await this.getJson(url);
    const c = json.current;
    const usAqi = c.us_aqi != null ? Number(c.us_aqi) : null;
    return {
      pm25: c.pm2_5 != null ? Number(c.pm2_5) : null,
      pm10: c.pm10 != null ? Number(c.pm10) : null,
      usAqi,
      category: aqiCategory(usAqi),
    };
  }
}
