import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  gradeHvacScore,
  scoreHvacTarget,
  summarizeHvacClusters,
  type HvacTargetInput,
} from "../src/lib/hvac-scoring";

describe("HVAC target scoring", () => {
  it("scores an older owner-occupied home with no recent HVAC permit as an A door", () => {
    const target: HvacTargetInput = {
      address: "101 Maple Dr",
      zip: "30318",
      yearBuilt: 2004,
      lastHvacPermitYear: null,
      ownerOccupied: true,
      livingAreaSqft: 2400,
      amiBand: "80-150",
      utilityProvider: "Georgia Power",
      subdivision: "Maple Ridge",
    };

    const scored = scoreHvacTarget(target, { currentYear: 2026 });

    assert.equal(scored.priorityGrade, "A");
    assert.ok(scored.replacementScore >= 80, `expected A-level score, got ${scored.replacementScore}`);
    assert.ok(scored.scoreReasons.some((reason) => reason.includes("No recent HVAC permit")));
    assert.match(scored.recommendedPitch, /Georgia rebate pre-check/i);
    assert.equal(scored.clusterKey, "30318 | Maple Ridge");
  });

  it("scores a newer home with a recent HVAC permit as a low-priority door", () => {
    const scored = scoreHvacTarget(
      {
        address: "202 New Build Ln",
        zip: "30318",
        yearBuilt: 2021,
        lastHvacPermitYear: 2023,
        ownerOccupied: true,
        livingAreaSqft: 1800,
        amiBand: ">150",
        subdivision: "Maple Ridge",
      },
      { currentYear: 2026 },
    );

    assert.ok(scored.replacementScore < 45, `expected low score, got ${scored.replacementScore}`);
    assert.ok(["C", "D"].includes(scored.priorityGrade));
    assert.ok(scored.scoreReasons.some((reason) => reason.includes("Recent HVAC permit")));
  });

  it("keeps grade boundaries stable", () => {
    assert.equal(gradeHvacScore(90), "A");
    assert.equal(gradeHvacScore(75), "B");
    assert.equal(gradeHvacScore(55), "C");
    assert.equal(gradeHvacScore(20), "D");
  });

  it("promotes clusters with dense A and B doors", () => {
    const rows = [
      scoreHvacTarget({ address: "1 A St", zip: "30318", subdivision: "Oak", yearBuilt: 1999, ownerOccupied: true, lastHvacPermitYear: null, amiBand: "80-150" }, { currentYear: 2026 }),
      scoreHvacTarget({ address: "2 A St", zip: "30318", subdivision: "Oak", yearBuilt: 2002, ownerOccupied: true, lastHvacPermitYear: null, amiBand: "80-150" }, { currentYear: 2026 }),
      scoreHvacTarget({ address: "3 A St", zip: "30318", subdivision: "Oak", yearBuilt: 2012, ownerOccupied: true, lastHvacPermitYear: null, amiBand: "unknown" }, { currentYear: 2026 }),
      scoreHvacTarget({ address: "1 B St", zip: "30310", subdivision: "Pine", yearBuilt: 2021, ownerOccupied: true, lastHvacPermitYear: 2024 }, { currentYear: 2026 }),
    ];

    const clusters = summarizeHvacClusters(rows);

    assert.equal(clusters[0].clusterKey, "30318 | Oak");
    assert.equal(clusters[0].priorityDoors, 3);
    assert.ok(clusters[0].averageScore > 80, `expected strong average, got ${clusters[0].averageScore}`);
  });
});
