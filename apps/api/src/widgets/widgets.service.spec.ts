import { WidgetsService } from './widgets.service';

/**
 * Open-Meteo's weather and air-quality endpoints fail independently. The
 * dashboard used to show "loading…" forever when one half failed; now the
 * last good reading is served instead, and concurrent callers share one fetch.
 */
describe('WidgetsService.environment', () => {
  const weatherJson = { current: { temperature_2m: 31, apparent_temperature: 35, relative_humidity_2m: 70, wind_speed_10m: 8, weather_code: 2, is_day: 1 } };
  const airJson = { current: { pm2_5: 12, pm10: 12.5, us_aqi: 47 } };
  const ok = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(body) } as Response);
  const fail = () => Promise.resolve({ ok: false, status: 503, json: () => Promise.resolve({}) } as Response);
  let fetchMock: jest.SpyInstance;

  afterEach(() => { fetchMock.mockRestore(); jest.useRealTimers(); });

  it('serves the last good weather when the weather call fails, and shares one fetch between callers', async () => {
    const svc = new WidgetsService();
    let weatherUp = true;
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url) =>
      String(url).includes('air-quality') ? ok(airJson) : weatherUp ? ok(weatherJson) : fail());

    const first = await svc.environment();
    expect(first.weather?.temperature).toBe(31);
    expect(first.air?.usAqi).toBe(47);

    // Past the cache: the weather endpoint is now down.
    jest.useFakeTimers({ now: Date.now() + 11 * 60_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
    weatherUp = false;
    fetchMock.mockClear();
    const [a, b] = await Promise.all([svc.environment(), svc.environment()]);
    expect(a).toBe(b); // one shared refresh
    expect(fetchMock).toHaveBeenCalledTimes(2); // weather + air, once
    expect(a.weather?.temperature).toBe(31); // last good reading
    expect(a.errors.some((e) => e.startsWith('weather'))).toBe(true);
  });

  it('reports no weather (not endless loading) when there has never been a good reading', async () => {
    const svc = new WidgetsService();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation((url) => (String(url).includes('air-quality') ? ok(airJson) : fail()));
    const env = await svc.environment();
    expect(env.weather).toBeNull();
    expect(env.air?.usAqi).toBe(47);
  });
});
