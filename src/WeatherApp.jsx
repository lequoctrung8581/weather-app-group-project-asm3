import React, { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

// QUICK START
// 1) Data source: Open-Meteo (no API key required).
// 2) This component can run in any React app.
// 3) Features: GPS location, city search, current weather, hourly (next 24h) & daily (5 days) forecast, °C/°F toggle, recent searches.
// 4) APIs used: Open-Meteo Forecast + Geocoding.

const OM_FORECAST = "https://api.open-meteo.com/v1/forecast";
const OM_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search";
const OM_REVERSE = "https://geocoding-api.open-meteo.com/v1/reverse";

function cls(...s) {
  return s.filter(Boolean).join(" ");
}

function formatTimeISO(iso, locale = "en-US", opts = {}) {
  if (!iso) return "";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit", ...opts }).format(d);
}

function formatDateISO(iso, locale = "en-US") {
  if (!iso) return "";
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  return new Intl.DateTimeFormat(locale, { weekday: "short", day: "2-digit", month: "2-digit" }).format(d);
}

const wmoToEmoji = (code) => {
  const n = Number(code);
  if ([0].includes(n)) return "☀️";
  if ([1,2,3].includes(n)) return "⛅";
  if ([45,48].includes(n)) return "🌫️";
  if ([51,53,55].includes(n)) return "🌦️";
  if ([56,57].includes(n)) return "🌧️";
  if ([61,63,65].includes(n)) return "🌧️";
  if ([66,67].includes(n)) return "🌧️❄️";
  if ([71,73,75,77].includes(n)) return "❄️";
  if ([80,81,82].includes(n)) return "🌧️";
  if ([85,86].includes(n)) return "🌨️";
  if ([95].includes(n)) return "⛈️";
  if ([96,99].includes(n)) return "⛈️🌧️";
  return "☁️";
};

export default function WeatherApp() {
  const { t, i18n } = useTranslation();

  // locale for formatting dates/times
  const locale = i18n.language === "vi" ? "vi-VN" : "en-US";

  const [cityInput, setCityInput] = useState("");
  const [coords, setCoords] = useState(null);
  const [place, setPlace] = useState(null);
  const [units, setUnits] = useState("metric");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState(null);
  const [forecast, setForecast] = useState(null);

  const [history, setHistory] = useState(() => {
    try {
      const raw = localStorage.getItem("weather_history_v2");
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem("weather_history_v2", JSON.stringify(history.slice(0,8)));
  }, [history]);

  // --- CITY → GEOCODE (Open-Meteo Geocoding)
  async function resolveCity(q) {
    const url = new URL(OM_GEOCODING);
    url.searchParams.set("name", q);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", i18n.language === "vi" ? "vi" : "en");
    const res = await fetch(url);
    if (!res.ok) throw new Error(t("couldNotFind") || "Could not find the location.");
    const data = await res.json();
    if (!data?.results?.length) throw new Error(t("couldNotFind") || "Could not find the location.");
    const r = data.results[0];
    const lat = r.latitude, lon = r.longitude;
    const name = r.name;
    const country = r.country_code || r.country || "";
    const state = r.admin1;
    return { coords: { lat, lon }, place: { name: state ? `${name}, ${state}` : name, country } };
  }

  // --- REVERSE GEO: coords → place name (Open-Meteo Reverse)
  async function reverseGeo(lat, lon) {
    try {
      const url = new URL(OM_REVERSE);
      url.searchParams.set("latitude", lat);
      url.searchParams.set("longitude", lon);
      url.searchParams.set("language", i18n.language === "vi" ? "vi" : "en");

      const res = await fetch(url);
      if (!res.ok) throw new Error("Reverse Geo API failed");
      const data = await res.json();

      const r = data?.results?.[0];
      if (!r) throw new Error("No location found from coords");

      const name = r.name;
      const country = r.country_code || r.country || "";
      const state = r.admin1;

      return state ? `${name}, ${state}, ${country}` : `${name}, ${country}`;
    } catch (err) {
      console.error("reverseGeo error:", err);
      return null;
    }
  }

  // --- FETCH: current + hourly + daily from Open-Meteo
  async function fetchAll(lat, lon) {
    const isMetric = units === "metric";
    const url = new URL(OM_FORECAST);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("temperature_unit", isMetric ? "celsius" : "fahrenheit");
    url.searchParams.set("windspeed_unit", isMetric ? "ms" : "mph");

    url.searchParams.set("current", [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "precipitation",
      "precipitation_probability",
      "rain",
      "showers",
      "wind_speed_10m",
      "wind_direction_10m",
      "weather_code"
    ].join(","));

    url.searchParams.set("hourly", [
      "temperature_2m",
      "relative_humidity_2m",
      "dew_point_2m",
      "apparent_temperature",
      "precipitation_probability",
      "precipitation",
      "rain",
      "showers",
      "wind_direction_10m",
      "temperature_120m",
      "soil_moisture_27_to_81cm",
      "wind_speed_10m",
      "weather_code"
    ].join(","));

    url.searchParams.set("daily", [
      "temperature_2m_min",
      "temperature_2m_max",
      "sunrise",
      "sunset",
      "weather_code"
    ].join(","));

    const res = await fetch(url);
    if (!res.ok) throw new Error(t("failedFetch") || "Failed to fetch weather data.");
    return res.json();
  }

  // --- TRANSFORM: hourly (next 24h) & daily (5 days)
  const hourlyBlocks = useMemo(() => {
    if (!forecast?.hourly?.time?.length) return [];
    const now = Date.now();
    const arr = [];
    for (let i = 0; i < forecast.hourly.time.length; i++) {
      const tISO = forecast.hourly.time[i];
      const tMs = Date.parse(tISO);
      if (tMs >= now && arr.length < 24) {
        arr.push({
          time: tISO,
          temp: forecast.hourly.temperature_2m?.[i],
          rh: forecast.hourly.relative_humidity_2m?.[i],
          app: forecast.hourly.apparent_temperature?.[i],
          pop: forecast.hourly.precipitation_probability?.[i],
          prcp: forecast.hourly.precipitation?.[i],
          rain: forecast.hourly.rain?.[i],
          showers: forecast.hourly.showers?.[i],
          wdir: forecast.hourly.wind_direction_10m?.[i],
          ws: forecast.hourly.wind_speed_10m?.[i],
          wmo: forecast.hourly.weather_code?.[i],
        });
      }
    }
    return arr;
  }, [forecast]);

  const dailyGroups = useMemo(() => {
    if (!forecast?.daily?.time?.length) return [];
    const days = [];
    for (let i = 0; i < Math.min(5, forecast.daily.time.length); i++) {
      days.push({
        date: forecast.daily.time[i],
        min: forecast.daily.temperature_2m_min?.[i],
        max: forecast.daily.temperature_2m_max?.[i],
        sunrise: forecast.daily.sunrise?.[i],
        sunset: forecast.daily.sunset?.[i],
        wmo: forecast.daily.weather_code?.[i],
      });
    }
    return days;
  }, [forecast]);

  // --- EVENTS
  async function onSearchCity(e) {
    e?.preventDefault?.();
    setError("");
    if (!cityInput.trim()) return;
    setLoading(true);
    try {
      const { coords: c, place: p } = await resolveCity(cityInput.trim());
      setCoords(c);
      setPlace(p);
      const all = await fetchAll(c.lat, c.lon);
      setCurrent(all.current);
      setForecast(all);
      setHistory((h) => {
        const tag = `${p.name}, ${p.country}`;
        const next = [tag, ...h.filter((x) => x !== tag)];
        return next.slice(0,8);
      });
    } catch (err) {
      setError(err.message || (t("unknownError") || "Unknown error"));
    } finally {
      setLoading(false);
    }
  }

  async function onUseMyLocation() {
    setError("");
    if (!navigator.geolocation) {
      setError(t("noGeolocation") || "Your browser does not support geolocation.");
      return;
    }
    setLoading(true);
    navigator.geolocation.getCurrentPosition(
        async (pos) => {
          try {
            const { latitude: lat, longitude: lon } = pos.coords;
            setCoords({ lat, lon });

            const p = await reverseGeo(lat, lon);
            if (p) setPlace(p);

            const all = await fetchAll(lat, lon);
            setCurrent(all.current);
            setForecast(all);
          } catch (err) {
            setError(err.message || (t("failedLocationFetch") || "Failed to get data from your location."));
          } finally {
            setLoading(false);
          }
        },
        (err) => {
          setLoading(false);
          setError(t("gpsPermission") || "Unable to access your location (check GPS permissions).");
        }
    );
  }

  function toggleUnits() {
    setUnits((u) => (u === "metric" ? "imperial" : "metric"));
  }

  const [darkMode, setDarkMode] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem("dark_mode")) ?? false;
    } catch {
      return false;
    }
  });
  useEffect(() => {
    localStorage.setItem("dark_mode", JSON.stringify(darkMode));
  }, [darkMode]);

  // Re-fetch when units change
  useEffect(() => {
    (async () => {
      if (!coords) return;
      try {
        setLoading(true);
        const all = await fetchAll(coords.lat, coords.lon);
        setCurrent(all.current);
        setForecast(all);
      } catch (err) {
        setError(err.message || (t("failedFetch") || "Failed to fetch data."));
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units]);

  // --- RENDER
  const isMetric = units === "metric";
  const tempUnit = isMetric ? "°C" : "°F";
  const windUnit = isMetric ? "m/s" : "mph";

  return (
      <div className={darkMode ? "dark" : ""}>
        <div className="min-h-screen w-full
                      bg-gradient-to-b from-sky-100 to-white text-gray-900
                      dark:from-gray-900 dark:to-gray-800 dark:text-gray-100
                      transition-colors duration-300">
          <div className="max-w-4xl mx-auto px-4 py-6">
            {/* HEADER */}
            <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">☀️ {t("title")}</h1>

              <div className="flex items-center gap-2">
                <button
                    onClick={toggleUnits}
                    className="px-3 py-2 rounded-2xl bg-white/70 dark:bg-gray-700 shadow border hover:bg-white dark:hover:bg-gray-600 transition"
                    title={t("unit")}
                >
                  {t("unit")}: <span className="font-semibold ml-1">{isMetric ? "°C" : "°F"}</span>
                </button>

                <button
                    onClick={onUseMyLocation}
                    className="px-3 py-2 rounded-2xl bg-sky-600 text-white shadow hover:bg-sky-700 transition"
                >📍 {t("useLocation")}</button>

                <button
                    onClick={() => setDarkMode(!darkMode)}
                    className="px-3 py-2 rounded-2xl bg-gray-200 dark:bg-gray-700 shadow hover:bg-gray-300 dark:hover:bg-gray-600 transition"
                >
                  {darkMode ? `☀ ${t("lightMode")}` : `🌙 ${t("darkMode")}`}
                </button>

                <select
                    value={i18n.language}
                    onChange={(e) => i18n.changeLanguage(e.target.value)}
                    className="px-2 py-1 rounded-lg border text-black dark:text-white dark:bg-gray-700"
                >
                  <option value="en">English</option>
                  <option value="vi">Tiếng Việt</option>
                </select>
              </div>
            </header>

            {/* SEARCH */}
            <form onSubmit={onSearchCity} className="mt-4 flex gap-2">
              <input
                  value={cityInput}
                  onChange={(e) => setCityInput(e.target.value)}
                  placeholder={t("searchPlaceholder")}
                  className="flex-1 px-4 py-3 rounded-2xl bg-white/80 dark:bg-gray-800 border shadow focus:outline-none focus:ring-2 focus:ring-sky-400"
              />
              <button
                  type="submit"
                  disabled={!cityInput.trim() || loading}
                  className={cls(
                      "px-5 py-3 rounded-2xl shadow transition",
                      loading
                          ? "bg-gray-300 text-gray-500 dark:bg-gray-600 dark:text-gray-400"
                          : "bg-gray-900 text-white hover:bg-black dark:bg-sky-600 dark:hover:bg-sky-700"
                  )}
              >
                {t("search")}
              </button>
            </form>

            {/* HISTORY */}
            {history.length > 0 ? (
                <div className="mt-3 flex flex-wrap gap-2">
                  {history.map((h, i) => (
                      <button
                          key={i}
                          className="px-3 py-1 rounded-full bg-white/70 dark:bg-gray-700 border dark:border-gray-600 shadow hover:bg-white dark:hover:bg-gray-600 text-sm text-gray-800 dark:text-gray-200"
                          onClick={() => { setCityInput(h); setTimeout(() => onSearchCity(), 0); }}
                      >
                        {h}
                      </button>
                  ))}
                </div>
            ) : (
                <div className="mt-3 text-sm text-gray-600 dark:text-gray-400">{t("searchHistoryEmpty")}</div>
            )}

            {/* ERROR */}
            {error && (
                <div className="mt-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/40 border border-red-200 dark:border-red-700 text-red-700 dark:text-red-300">
                  ⚠️ {error}
                </div>
            )}

            {/* LOADING */}
            {loading && (
                <div className="mt-6 animate-pulse text-gray-600 dark:text-gray-300">{t("loading")}</div>
            )}

            {/* CURRENT */}
            {current && (
                <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-5 rounded-3xl bg-white dark:bg-gray-800 shadow border dark:border-gray-600">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-sm text-gray-500 dark:text-gray-400">{t("location")}</div>
                        <div className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                          {place?.name}{place?.country ? `, ${place.country}` : ""}
                        </div>
                      </div>
                      <div className="text-4xl" title={`WMO ${current.weather_code}`}>{wmoToEmoji(current.weather_code)}</div>
                    </div>

                    <div className="mt-4 flex items-end gap-3">
                      <div className="text-5xl font-semibold leading-none text-gray-900 dark:text-white">
                        {Math.round(current.temperature_2m)}{tempUnit}
                      </div>
                      <div className="text-gray-500 dark:text-gray-300">{t("feelsLike")}: {Math.round(current.apparent_temperature)}{tempUnit}</div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <div>💧 {t("humidity")}: {current.relative_humidity_2m}%</div>
                      <div>🌬️ {t("wind")}: {Math.round(current.wind_speed_10m)} {windUnit}</div>
                      <div>🧭 {t("windDir")}: {current.wind_direction_10m}°</div>
                      <div>☔ {t("rainProb")}: {current.precipitation_probability ?? 0}%</div>
                    </div>
                  </div>

                  {/* Extras */}
                  <div className="p-5 rounded-3xl bg-white dark:bg-gray-800 shadow border dark:border-gray-600">
                    <div className="text-sm text-gray-500 dark:text-gray-400">{t("extras")}</div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <div>🌅 {t("sunrise")}: {dailyGroups?.[0]?.sunrise ? formatTimeISO(dailyGroups[0].sunrise, locale) : "-"}</div>
                      <div>🌇 {t("sunset")}: {dailyGroups?.[0]?.sunset ? formatTimeISO(dailyGroups[0].sunset, locale) : "-"}</div>
                      <div>🌧️ {t("prcp") || "Precip"} (this hour): {current.precipitation ?? 0} mm</div>
                      <div>🌧️🌡️ {t("rainProb")}: {current.precipitation_probability ?? 0}%</div>
                    </div>
                    <div className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                      {t("updated")}: {new Date().toLocaleString(locale)}
                    </div>
                  </div>
                </section>
            )}

            {/* HOURLY */}
            {hourlyBlocks?.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{t("next24h")}</h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
                    {hourlyBlocks.map((h, idx) => (
                        <div key={idx} className="p-3 rounded-2xl bg-white dark:bg-gray-800 border dark:border-gray-600 shadow text-center">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatTimeISO(h.time, locale)}</div>
                          <div className="text-2xl" title={`WMO ${h.wmo}`}>{wmoToEmoji(h.wmo)}</div>
                          <div className="font-semibold text-gray-900 dark:text-gray-100">{Math.round(h.temp)}{tempUnit}</div>
                          <div className="text-xs text-gray-600 dark:text-gray-400 truncate">💧RH {h.rh}% • POP {h.pop ?? 0}%</div>
                          <div className="text-xs text-gray-500 dark:text-gray-400">🌬 {Math.round(h.ws ?? 0)} {windUnit} • 🧭 {h.wdir ?? "-"}°</div>
                        </div>
                    ))}
                  </div>
                </section>
            )}

            {/* DAILY */}
            {dailyGroups?.length > 0 && (
                <section className="mt-6">
                  <h2 className="text-lg font-semibold mb-2 text-gray-900 dark:text-gray-100">{t("forecast5d")}</h2>
                  <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
                    {dailyGroups.map((d, idx) => (
                        <div key={idx} className="p-4 rounded-2xl bg-white dark:bg-gray-800 border dark:border-gray-600 shadow text-center">
                          <div className="text-sm text-gray-500 dark:text-gray-400">{formatDateISO(d.date, locale)}</div>
                          <div className="text-3xl" title={`WMO ${d.wmo}`}>{wmoToEmoji(d.wmo)}</div>
                          <div className="mt-1 font-semibold text-gray-900 dark:text-gray-100">{Math.round(d.min)}{tempUnit} • {Math.round(d.max)}{tempUnit}</div>
                        </div>
                    ))}
                  </div>
                </section>
            )}

            {/* FOOTER */}
            <footer className="mt-10 text-center text-xs text-gray-500 dark:text-gray-400">
              {t("footer")}
            </footer>
          </div>
        </div>
      </div>
  );
}
