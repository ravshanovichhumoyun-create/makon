"""Weather and city search through Open-Meteo (free, no API key, no account).

The browser never talks to Open-Meteo itself: the server asks, caches the answer for a few minutes
and the page keeps its strict Content-Security-Policy (connect-src 'self').
"""
import threading
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx

FORECAST_URL = "https://api.open-meteo.com/v1/forecast"
GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
TTL_SECONDS = 15 * 60


class WeatherError(Exception):
    pass


_cache: Dict[Tuple, Tuple[float, Any]] = {}
_lock = threading.Lock()


def _cached(key: Tuple, ttl: float, fetch):
    now = time.monotonic()
    with _lock:
        hit = _cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    value = fetch()
    with _lock:
        if len(_cache) > 2000:
            _cache.clear()
        _cache[key] = (now, value)
    return value


def _get(url: str, params: Dict[str, Any]) -> Dict[str, Any]:
    try:
        r = httpx.get(url, params=params, timeout=8)
        r.raise_for_status()
        return r.json()
    except (httpx.HTTPError, ValueError) as exc:
        raise WeatherError(str(exc)) from exc


def forecast(lat: float, lon: float, tz: str) -> Dict[str, Any]:
    # ~1 km grid: nearby users share one cached answer and exact positions are never stored
    lat, lon = round(lat, 2), round(lon, 2)

    def fetch() -> Dict[str, Any]:
        data = _get(FORECAST_URL, {
            "latitude": lat, "longitude": lon, "timezone": tz or "auto", "forecast_days": 1,
            "current": "temperature_2m,apparent_temperature,weather_code,is_day,wind_speed_10m,relative_humidity_2m",
            "daily": "temperature_2m_max,temperature_2m_min,sunrise,sunset",
        })
        cur = data.get("current") or {}
        daily = data.get("daily") or {}

        def first(key: str) -> Optional[Any]:
            values = daily.get(key) or []
            return values[0] if values else None

        if cur.get("temperature_2m") is None:
            raise WeatherError("no data")
        return {
            "temp": cur.get("temperature_2m"),
            "feels": cur.get("apparent_temperature"),
            "code": cur.get("weather_code"),
            "is_day": bool(cur.get("is_day", 1)),
            "wind": cur.get("wind_speed_10m"),
            "humidity": cur.get("relative_humidity_2m"),
            "max": first("temperature_2m_max"),
            "min": first("temperature_2m_min"),
            "sunrise": (first("sunrise") or "")[-5:] or None,
            "sunset": (first("sunset") or "")[-5:] or None,
            "time": cur.get("time"),
        }

    return _cached(("f", lat, lon, tz), TTL_SECONDS, fetch)


def search_city(query: str, lang: str) -> List[Dict[str, Any]]:
    query = " ".join(query.split())[:80]
    if len(query) < 2:
        return []

    def fetch() -> List[Dict[str, Any]]:
        data = _get(GEOCODE_URL, {"name": query, "count": 8, "language": lang if lang in ("uz", "en", "ru") else "en",
                                  "format": "json"})
        out = []
        for r in data.get("results") or []:
            if r.get("latitude") is None or r.get("longitude") is None:
                continue
            out.append({
                "name": str(r.get("name") or "")[:80],
                "region": str(r.get("admin1") or "")[:80],
                "country": str(r.get("country") or "")[:80],
                "lat": round(float(r["latitude"]), 4),
                "lon": round(float(r["longitude"]), 4),
            })
        return out

    return _cached(("g", query.lower(), lang), 24 * 3600, fetch)
