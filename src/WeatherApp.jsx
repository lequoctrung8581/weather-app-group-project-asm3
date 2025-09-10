import React, { useEffect, useMemo, useState } from "react";

// QUICK START
// 1) Data source: Open‑Meteo (no API key required).
// 2) This component can run in any React app.
// 3) Features: GPS location, city search, current weather, hourly (next 24h) & daily (5 days) forecast, °C/°F toggle, recent searches.
// 4) APIs used: Open‑Meteo Forecast + Geocoding.

const OM_FORECAST = "https://api.open-meteo.com/v1/forecast"; // ?latitude&longitude&hourly=...&current=...&daily=...&timezone=auto
const OM_GEOCODING = "https://geocoding-api.open-meteo.com/v1/search"; // ?name=Hanoi&count=1&language=en
const OM_REVERSE = "https://geocoding-api.open-meteo.com/v1/reverse"; // ?latitude&longitude&language=en

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

// Map WMO weather codes to quick emoji hints
const wmoToEmoji = (code) => {
  const n = Number(code);
  if ([0].includes(n)) return "☀️"; // Clear
  if ([1,2,3].includes(n)) return "⛅"; // Mainly clear / partly cloudy
  if ([45,48].includes(n)) return "🌫️"; // Fog
  if ([51,53,55].includes(n)) return "🌦️"; // Drizzle
  if ([56,57].includes(n)) return "🌧️"; // Freezing drizzle
  if ([61,63,65].includes(n)) return "🌧️"; // Rain
  if ([66,67].includes(n)) return "🌧️❄️"; // Freezing rain
  if ([71,73,75,77].includes(n)) return "❄️"; // Snow
  if ([80,81,82].includes(n)) return "🌧️"; // Rain showers
  if ([85,86].includes(n)) return "🌨️"; // Snow showers
  if ([95].includes(n)) return "⛈️"; // Thunderstorm
  if ([96,99].includes(n)) return "⛈️🌧️"; // Thunderstorm + hail
  return "☁️";
};

export default function WeatherApp() {
  const [cityInput, setCityInput] = useState("");
  const [coords, setCoords] = useState(null); // { lat, lon }
  const [place, setPlace] = useState(null);   // { name, country }
  const [units, setUnits] = useState("metric"); // "metric" (°C) | "imperial" (°F)

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [current, setCurrent] = useState(null);   // Open‑Meteo current block
  const [forecast, setForecast] = useState(null); // Full Open‑Meteo response

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

  // --- CITY → GEOCODE (Open‑Meteo Geocoding)
  async function resolveCity(q) {
    const url = new URL(OM_GEOCODING);
    url.searchParams.set("name", q);
    url.searchParams.set("count", "1");
    url.searchParams.set("language", "en");
    const res = await fetch(url);
    if (!res.ok) throw new Error("Could not find the location.");
    const data = await res.json();
    if (!data?.results?.length) throw new Error("Could not find the location.");
    const r = data.results[0];
    const lat = r.latitude, lon = r.longitude;
    const name = r.name;
    const country = r.country_code || r.country || "";
    const state = r.admin1;
    return { coords: { lat, lon }, place: { name: state ? `${name}, ${state}` : name, country } };
  }

  // --- REVERSE GEO: coords → place name (Open‑Meteo Reverse)
async function reverseGeo(lat, lon) {
  try {
    const url = new URL(OM_REVERSE);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("language", "en");

    const res = await fetch(url);
    if (!res.ok) throw new Error("Reverse Geo API failed");
    const data = await res.json();
    console.log("ReverseGeo raw:", data);

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


  // --- FETCH: current + hourly + daily from Open‑Meteo
  async function fetchAll(lat, lon) {
    const isMetric = units === "metric";
    const url = new URL(OM_FORECAST);
    url.searchParams.set("latitude", lat);
    url.searchParams.set("longitude", lon);
    url.searchParams.set("timezone", "auto");
    url.searchParams.set("temperature_unit", isMetric ? "celsius" : "fahrenheit");
    url.searchParams.set("windspeed_unit", isMetric ? "ms" : "mph");
    // current variables
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
    // hourly variables (your list + weather_code)
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
    // daily: sunrise/sunset & min/max
    url.searchParams.set("daily", [
      "temperature_2m_min",
      "temperature_2m_max",
      "sunrise",
      "sunset",
      "weather_code"
    ].join(","));

    const res = await fetch(url);
    if (!res.ok) throw new Error("Failed to fetch weather data.");
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
      setError(err.message || "Unknown error");
    } finally {
      setLoading(false);
    }
  }

async function onUseMyLocation() {
  setError("");
  if (!navigator.geolocation) {
    setError("Your browser does not support geolocation.");
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
        setError(err.message || "Failed to get data from your location.");
      } finally {
        setLoading(false);
      }
    },
    (err) => {
      setLoading(false);
      setError("Unable to access your location (check GPS permissions).");
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
        setError(err.message || "Failed to fetch data.");
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
    <div className="min-h-screen w-full bg-gradient-to-b from-sky-100 to-white text-gray-900">
      <div className="max-w-4xl mx-auto px-4 py-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">☀️ Weather App</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleUnits}
              className="px-3 py-2 rounded-2xl bg-white/70 shadow border hover:bg-white transition"
              title="Toggle °C/°F"
            >
              Unit: <span className="font-semibold ml-1">{isMetric ? "°C" : "°F"}</span>
            </button>
            <button
              onClick={onUseMyLocation}
              className="px-3 py-2 rounded-2xl bg-sky-600 text-white shadow hover:bg-sky-700 transition"
            >📍 Use my location</button>
          </div>
        </header>

        <form onSubmit={onSearchCity} className="mt-4 flex gap-2">
          <input
            value={cityInput}
            onChange={(e) => setCityInput(e.target.value)}
            placeholder="Enter city (e.g., Hanoi, Ho Chi Minh City, Da Nang)"
            className="flex-1 px-4 py-3 rounded-2xl bg-white/80 border shadow focus:outline-none focus:ring-2 focus:ring-sky-400"
          />
          <button
            type="submit"
            disabled={!cityInput.trim() || loading}
            className={cls(
              "px-5 py-3 rounded-2xl shadow transition",
              loading ? "bg-gray-300 text-gray-500" : "bg-gray-900 text-white hover:bg-black"
            )}
          >Search</button>
        </form>

        {history.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {history.map((h, i) => (
              <button
                key={i}
                className="px-3 py-1 rounded-full bg-white/70 border shadow hover:bg-white text-sm"
                onClick={() => { setCityInput(h); setTimeout(() => onSearchCity(), 0); }}
              >{h}</button>
            ))}
          </div>
        )}

        {error && (
          <div className="mt-4 p-3 rounded-xl bg-red-50 border border-red-200 text-red-700">
            ⚠️ {error}
          </div>
        )}

        {loading && (
          <div className="mt-6 animate-pulse text-gray-600">Loading weather…</div>
        )}

        {/* CURRENT */}
        {current && (
          <section className="mt-6 grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-5 rounded-3xl bg-white shadow border">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-sm text-gray-500">Location</div>
                  <div className="text-xl font-semibold">
                    {place?.name}{place?.country ? `, ${place.country}` : ""}
                  </div>
                </div>
                <div className="text-4xl" title={`WMO ${current.weather_code}`}>{wmoToEmoji(current.weather_code)}</div>
              </div>
              <div className="mt-4 flex items-end gap-3">
                <div className="text-5xl font-semibold leading-none">
                  {Math.round(current.temperature_2m)}{tempUnit}
                </div>
                <div className="text-gray-500">
                  Feels like: {Math.round(current.apparent_temperature)}{tempUnit}
                </div>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-2 text-sm text-gray-700">
                <div>💧 Humidity: {current.relative_humidity_2m}%</div>
                <div>🌬️ Wind: {Math.round(current.wind_speed_10m)} {windUnit}</div>
                <div>🧭 Wind dir: {current.wind_direction_10m}°</div>
                <div>☔ Rain prob: {current.precipitation_probability ?? 0}%</div>
              </div>
            </div>

            {/* Extras */}
            <div className="p-5 rounded-3xl bg-white shadow border">
              <div className="text-sm text-gray-500">Extras</div>
              <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                <div>🌅 Sunrise: {dailyGroups?.[0]?.sunrise ? formatTimeISO(dailyGroups[0].sunrise) : "-"}</div>
                <div>🌇 Sunset: {dailyGroups?.[0]?.sunset ? formatTimeISO(dailyGroups[0].sunset) : "-"}</div>
                <div>🌧️ Precip (this hour): {current.precipitation ?? 0} mm</div>
                <div>🌧️🌡️ Rain chance: {current.precipitation_probability ?? 0}%</div>
              </div>
              <div className="mt-3 text-xs text-gray-500">Updated: {new Date().toLocaleString("en-US")}</div>
            </div>
          </section>
        )}

        {/* HOURLY (1h steps) */}
        {hourlyBlocks?.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold mb-2">⏱️ Next 24 hours</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-8 gap-3">
              {hourlyBlocks.map((h, idx) => (
                <div key={idx} className="p-3 rounded-2xl bg-white border shadow text-center">
                  <div className="text-sm text-gray-500">{formatTimeISO(h.time)}</div>
                  <div className="text-2xl" title={`WMO ${h.wmo}`}>{wmoToEmoji(h.wmo)}</div>
                  <div className="font-semibold">{Math.round(h.temp)}{tempUnit}</div>
                  <div className="text-xs text-gray-600 truncate">💧RH {h.rh}% • POP {h.pop ?? 0}%</div>
                  <div className="text-xs text-gray-500">🌬 {Math.round(h.ws ?? 0)} {windUnit} • 🧭 {h.wdir ?? "-"}°</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* DAILY (compact) */}
        {dailyGroups?.length > 0 && (
          <section className="mt-6">
            <h2 className="text-lg font-semibold mb-2">📅 5‑day forecast</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 md:grid-cols-5 gap-3">
              {dailyGroups.map((d, idx) => (
                <div key={idx} className="p-4 rounded-2xl bg-white border shadow text-center">
                  <div className="text-sm text-gray-500">{formatDateISO(d.date)}</div>
                  <div className="text-3xl" title={`WMO ${d.wmo}`}>{wmoToEmoji(d.wmo)}</div>
                  <div className="mt-1 font-semibold">{Math.round(d.min)}{tempUnit} • {Math.round(d.max)}{tempUnit}</div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* FOOTER */}
        <footer className="mt-10 text-center text-xs text-gray-500">
          Data from Open‑Meteo. Demo app for learning purposes.
        </footer>
      </div>
    </div>
  );
}
