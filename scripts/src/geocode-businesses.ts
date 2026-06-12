/**
 * Backfill latitude/longitude for businesses that have an address but no coordinates.
 * Run inside Replit (needs DATABASE_URL): pnpm --filter @workspace/scripts run geocode
 */
import { db, businessesTable } from "@workspace/db";
import { isNull, isNotNull, and } from "drizzle-orm";
import { eq } from "drizzle-orm";

interface GeoPoint { latitude: number; longitude: number }

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
  const m = body.result?.addressMatches?.[0]?.coordinates;
  return m ? { latitude: m.y, longitude: m.x } : null;
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
  return body[0] ? { latitude: parseFloat(body[0].lat), longitude: parseFloat(body[0].lon) } : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const pending = await db
    .select({ id: businessesTable.id, name: businessesTable.name, address: businessesTable.address })
    .from(businessesTable)
    .where(and(isNotNull(businessesTable.address), isNull(businessesTable.latitude)));

  console.log(`Geocoding ${pending.length} businesses...`);
  let ok = 0, fail = 0;

  for (const b of pending) {
    const address = b.address!;
    let point = await geocodeCensus(address).catch(() => null);
    if (!point) {
      await sleep(1100); // Nominatim usage policy: max 1 req/sec
      point = await geocodeNominatim(address).catch(() => null);
    }
    if (point) {
      await db
        .update(businessesTable)
        .set({ latitude: point.latitude, longitude: point.longitude, geocodedAt: new Date() })
        .where(eq(businessesTable.id, b.id));
      ok++;
      console.log(`  ✓ ${b.name}`);
    } else {
      fail++;
      console.log(`  ✗ ${b.name} — could not geocode "${address}"`);
    }
    await sleep(250);
  }
  console.log(`Done. ${ok} geocoded, ${fail} failed.`);
  process.exit(0);
}

main().catch((err) => { console.error(err); process.exit(1); });
