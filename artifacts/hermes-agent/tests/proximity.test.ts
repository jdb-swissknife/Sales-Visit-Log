import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_NEARBY_CONFIG,
  buildSuggestion,
  haversineMiles,
  isEligible,
  isWithinDropInWindow,
  localDateInZone,
  rankNearby,
  type NearbyConfig,
} from "../src/proximity";
import type { BusinessCtx } from "../src/types";

const cfg: NearbyConfig = { ...DEFAULT_NEARBY_CONFIG };

function biz(p: Partial<BusinessCtx> & { id: number }): BusinessCtx {
  return {
    id: p.id,
    name: p.name ?? `Biz ${p.id}`,
    address: p.address ?? null,
    sector: p.sector ?? "retail",
    status: p.status ?? "not_contacted",
    priority: p.priority ?? "medium",
    latitude: p.latitude ?? null,
    longitude: p.longitude ?? null,
  };
}

describe("haversineMiles", () => {
  it("is ~0 for identical points", () => {
    assert.ok(haversineMiles({ latitude: 41.8, longitude: -87.6 }, { latitude: 41.8, longitude: -87.6 }) < 1e-6);
  });
  it("matches a known distance (Chicago ~1 deg lat = ~69 mi)", () => {
    const d = haversineMiles({ latitude: 41, longitude: -87 }, { latitude: 42, longitude: -87 });
    assert.ok(Math.abs(d - 69.0) < 0.5, `got ${d}`);
  });
  it("computes a sub-mile hop", () => {
    // ~0.01 deg lng at 41.8N ≈ 0.51 mi
    const d = haversineMiles({ latitude: 41.8, longitude: -87.6 }, { latitude: 41.8, longitude: -87.59 });
    assert.ok(d > 0.4 && d < 0.6, `got ${d}`);
  });
});

describe("isWithinDropInWindow", () => {
  it("true at noon Chicago", () => {
    // 2026-06-19 17:00Z = 12:00 America/Chicago (CDT, -5)
    assert.equal(isWithinDropInWindow(new Date("2026-06-19T17:00:00Z"), cfg), true);
  });
  it("false at 7am Chicago", () => {
    assert.equal(isWithinDropInWindow(new Date("2026-06-19T12:00:00Z"), cfg), false);
  });
  it("false at 6pm Chicago (window is exclusive at end)", () => {
    assert.equal(isWithinDropInWindow(new Date("2026-06-19T23:00:00Z"), cfg), false);
  });
});

describe("isEligible", () => {
  const anchorId = 1;
  it("un-visited with coords qualifies", () => {
    assert.equal(isEligible(biz({ id: 2, status: "not_contacted", latitude: 41.8, longitude: -87.6 }), anchorId, cfg), true);
  });
  it("contacted high-priority qualifies", () => {
    assert.equal(isEligible(biz({ id: 2, status: "contacted", priority: "high", latitude: 41.8, longitude: -87.6 }), anchorId, cfg), true);
  });
  it("contacted medium-priority does not qualify", () => {
    assert.equal(isEligible(biz({ id: 2, status: "contacted", priority: "medium", latitude: 41.8, longitude: -87.6 }), anchorId, cfg), false);
  });
  it("no coords never qualifies", () => {
    assert.equal(isEligible(biz({ id: 2, status: "not_contacted" }), anchorId, cfg), false);
  });
  it("the anchor itself is excluded", () => {
    assert.equal(isEligible(biz({ id: 1, status: "not_contacted", latitude: 41.8, longitude: -87.6 }), anchorId, cfg), false);
  });
  it("excludeStatuses is honored", () => {
    const c = { ...cfg, excludeStatuses: ["not_interested"] };
    assert.equal(isEligible(biz({ id: 2, status: "not_interested", priority: "high", latitude: 41.8, longitude: -87.6 }), anchorId, c), false);
  });
});

describe("rankNearby", () => {
  const anchor = { latitude: 41.8, longitude: -87.6 };
  it("drops out-of-radius prospects and sorts best-first", () => {
    const businesses = [
      biz({ id: 1, latitude: 41.8, longitude: -87.6 }), // anchor
      biz({ id: 2, name: "Close hi", priority: "high", status: "not_contacted", latitude: 41.8, longitude: -87.595 }),
      biz({ id: 3, name: "Close med", priority: "medium", status: "not_contacted", latitude: 41.8, longitude: -87.594 }),
      biz({ id: 4, name: "Far", priority: "high", status: "not_contacted", latitude: 42.5, longitude: -87.6 }),
    ];
    const out = rankNearby(anchor, 1, businesses, cfg);
    assert.deepEqual(out.map((m) => m.business.id), [2, 3]);
    assert.ok(out[0].priorityScore >= out[1].priorityScore);
    assert.ok(out.every((m) => m.distanceMi <= cfg.radiusMi));
  });
});

describe("buildSuggestion", () => {
  const now = new Date("2026-06-19T17:00:00Z"); // noon Chicago
  it("produces a grounded, well-formed card", () => {
    const match = {
      business: biz({ id: 12, name: "Acme Hardware", address: "123 Main St", status: "not_contacted", priority: "high", latitude: 41.8, longitude: -87.595 }),
      distanceMi: 0.42,
      priorityScore: 0.81,
    };
    const s = buildSuggestion(match, { repId: "rep-7", anchorName: "Bob's Diner", anchorBusinessId: 1, now, cfg });
    assert.equal(s.type, "nearby_prospect");
    assert.equal(s.businessId, 12);
    assert.equal(s.priority, "high");
    assert.equal(s.title, "Acme Hardware is 0.4 mi away");
    assert.equal(s.dedupeKey, `hermes:nearby:rep-7:12:${localDateInZone(now, cfg.timeZone)}`);
    assert.equal(s.actionUrl, "/businesses/12");
    assert.match(s.expiresAt, /T17:00:00[-+]\d{2}:\d{2}$/);
    assert.ok(s.body.includes("Bob's Diner"));
    assert.ok(s.body.includes("0.4"));
    assert.equal(s.data.distanceMi, 0.42);
  });
  it("medium-priority prospect yields a normal-priority card", () => {
    const match = {
      business: biz({ id: 5, name: "Lou's", status: "not_contacted", priority: "medium", latitude: 41.8, longitude: -87.59 }),
      distanceMi: 0.7,
      priorityScore: 0.4,
    };
    const s = buildSuggestion(match, { repId: "rep-7", anchorName: "Anchor", anchorBusinessId: 1, now, cfg });
    assert.equal(s.priority, "normal");
  });
});
