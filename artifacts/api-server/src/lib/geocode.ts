import { logger } from "./logger";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Geocode a US street address.
 * Primary: US Census Bureau geocoder (free, no key, no hard rate limit).
 * Fallback: OpenStreetMap Nominatim (free, requires identifying User-Agent).
 * Returns null if the address cannot be resolved.
 */
export async function geocodeAddress(address: string): Promise<GeoPoint | null> {
  const trimmed = address.trim();
  if (!trimmed) return null;

  const fromCensus = await geocodeCensus(trimmed).catch((err) => {
    logger.warn({ err, address: trimmed }, "census geocode failed");
    return null;
  });
  if (fromCensus) return fromCensus;

  return geocodeNominatim(trimmed).catch((err) => {
    logger.warn({ err, address: trimmed }, "nominatim geocode failed");
    return null;
  });
}

async function geocodeCensus(address: string): Promise<GeoPoint | null> {
  const url = new URL("https://geocoding.geo.census.gov/geocoder/locations/onelineaddress");
  url.searchParams.set("address", address);
  url.searchParams.set("benchmark", "Public_AR_Current");
  url.searchParams.set("format", "json");

  const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) return null;
  const body = (await res.json()) as {
    result?: { addressMatches?: Array<{ coordinates?: { x: number; y: number } }> };
  };
  const match = body.result?.addressMatches?.[0]?.coordinates;
  if (!match) return null;
  return { latitude: match.y, longitude: match.x };
}

async function geocodeNominatim(address: string): Promise<GeoPoint | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("q", address);
  url.searchParams.set("format", "json");
  url.searchParams.set("limit", "1");

  const res = await fetch(url, {
    headers: { "User-Agent": "SalesVisitLog/1.0 (field sales visit tracker)" },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  const body = (await res.json()) as Array<{ lat: string; lon: string }>;
  if (!body[0]) return null;
  return { latitude: parseFloat(body[0].lat), longitude: parseFloat(body[0].lon) };
}
