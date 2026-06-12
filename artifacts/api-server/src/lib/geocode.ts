import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, businessesTable } from "@workspace/db";
import { logger } from "./logger";

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let backfillRunning = false;

/**
 * Backfill coordinates for every business that has an address but no latitude.
 * Runs in the background on server startup so a freshly seeded database
 * (including production after a deploy) self-heals without manual scripts.
 * Idempotent: rows that already have coordinates are skipped, so repeat
 * startups only process whatever is still missing.
 */
export async function backfillMissingGeocodes(): Promise<void> {
  if (backfillRunning) return;
  backfillRunning = true;
  try {
    const pending = await db
      .select({ id: businessesTable.id, address: businessesTable.address })
      .from(businessesTable)
      .where(and(isNotNull(businessesTable.address), isNull(businessesTable.latitude)));

    if (pending.length === 0) {
      logger.info("Geocode backfill: nothing to do");
      return;
    }

    logger.info({ count: pending.length }, "Geocode backfill: starting");
    let ok = 0;
    let fail = 0;

    for (const b of pending) {
      const address = b.address;
      if (!address) continue;
      try {
        const point = await geocodeAddress(address);
        if (point) {
          await db
            .update(businessesTable)
            .set({ latitude: point.latitude, longitude: point.longitude, geocodedAt: new Date() })
            .where(eq(businessesTable.id, b.id));
          ok++;
        } else {
          fail++;
        }
      } catch (err) {
        fail++;
        logger.warn({ err, businessId: b.id }, "Geocode backfill: row failed");
      }
      // Keep under the OpenStreetMap Nominatim usage policy (max 1 req/sec)
      // since each row may fall back to it after a Census miss.
      await sleep(1100);
    }

    logger.info({ ok, fail }, "Geocode backfill: complete");
  } catch (err) {
    logger.error({ err }, "Geocode backfill: failed");
  } finally {
    backfillRunning = false;
  }
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
