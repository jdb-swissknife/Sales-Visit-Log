import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  classifyFollowUp,
  daysBetween,
  deriveStageAfterVisit,
  stageTransition,
} from "../src/lib/pipeline";

const DAY = 86_400_000;

describe("deriveStageAfterVisit", () => {
  it("promotes not_contacted → contacted on a plain visit", () => {
    assert.equal(deriveStageAfterVisit("not_contacted", { outcome: "neutral" }), "contacted");
    assert.equal(deriveStageAfterVisit("not_contacted", { outcome: "positive" }), "contacted");
    assert.equal(deriveStageAfterVisit("not_contacted", { outcome: "negative" }), "contacted");
  });

  it("moves to follow_up when the rep promised to come back", () => {
    assert.equal(deriveStageAfterVisit("contacted", { outcome: "follow_up_needed" }), "follow_up");
    assert.equal(
      deriveStageAfterVisit("not_contacted", { outcome: "positive", nextActionDate: new Date() }),
      "follow_up",
    );
  });

  it("never demotes a won or lost deal (the old bug)", () => {
    assert.equal(deriveStageAfterVisit("converted", { outcome: "neutral" }), "converted");
    assert.equal(deriveStageAfterVisit("converted", { outcome: "follow_up_needed" }), "converted");
    assert.equal(deriveStageAfterVisit("not_interested", { outcome: "positive" }), "not_interested");
  });

  it("never demotes proposal_sent or follow_up to contacted", () => {
    assert.equal(deriveStageAfterVisit("proposal_sent", { outcome: "neutral" }), "proposal_sent");
    assert.equal(deriveStageAfterVisit("proposal_sent", { outcome: "follow_up_needed" }), "proposal_sent");
    assert.equal(deriveStageAfterVisit("follow_up", { outcome: "neutral" }), "follow_up");
  });

  it("treats an unknown legacy status as not_contacted", () => {
    assert.equal(deriveStageAfterVisit("weird", { outcome: "neutral" }), "contacted");
  });
});

describe("stageTransition", () => {
  const now = new Date("2026-09-22T15:00:00Z");

  it("returns null when the stage is unchanged", () => {
    assert.equal(stageTransition("contacted", "contacted", now), null);
  });

  it("stamps stageChangedAt and clears closedAt for open stages", () => {
    assert.deepEqual(stageTransition("contacted", "proposal_sent", now), {
      status: "proposal_sent",
      stageChangedAt: now,
      closedAt: null,
    });
  });

  it("stamps closedAt for terminal stages", () => {
    assert.deepEqual(stageTransition("proposal_sent", "converted", now), {
      status: "converted",
      stageChangedAt: now,
      closedAt: now,
    });
    assert.equal(stageTransition("follow_up", "not_interested", now)?.closedAt, now);
  });

  it("reopening a closed deal clears closedAt", () => {
    assert.equal(stageTransition("converted", "follow_up", now)?.closedAt, null);
  });
});

describe("classifyFollowUp", () => {
  const now = new Date("2026-09-22T15:00:00"); // local time, mid-afternoon

  it("overdue when the promised date is before today", () => {
    assert.equal(classifyFollowUp({ dueAt: new Date(now.getTime() - DAY), lastVisitAt: now, staleDays: 14, now }), "overdue");
  });

  it("today when the promised date is today (any time of day)", () => {
    const earlier = new Date(now);
    earlier.setHours(8, 0, 0, 0);
    const later = new Date(now);
    later.setHours(23, 30, 0, 0);
    assert.equal(classifyFollowUp({ dueAt: earlier, lastVisitAt: now, staleDays: 14, now }), "today");
    assert.equal(classifyFollowUp({ dueAt: later, lastVisitAt: now, staleDays: 14, now }), "today");
  });

  it("upcoming within the 7-day window, nothing beyond it", () => {
    assert.equal(classifyFollowUp({ dueAt: new Date(now.getTime() + 3 * DAY), lastVisitAt: now, staleDays: 14, now }), "upcoming");
    assert.equal(classifyFollowUp({ dueAt: new Date(now.getTime() + 30 * DAY), lastVisitAt: now, staleDays: 14, now }), null);
  });

  it("stale when there is no promise and the last visit is old", () => {
    assert.equal(classifyFollowUp({ dueAt: null, lastVisitAt: new Date(now.getTime() - 20 * DAY), staleDays: 14, now }), "stale");
    assert.equal(classifyFollowUp({ dueAt: null, lastVisitAt: new Date(now.getTime() - 5 * DAY), staleDays: 14, now }), null);
  });

  it("respects a custom staleDays", () => {
    assert.equal(classifyFollowUp({ dueAt: null, lastVisitAt: new Date(now.getTime() - 5 * DAY), staleDays: 3, now }), "stale");
  });

  it("accepts ISO strings and ignores garbage dates", () => {
    assert.equal(
      classifyFollowUp({ dueAt: new Date(now.getTime() - DAY).toISOString(), lastVisitAt: null, staleDays: 14, now }),
      "overdue",
    );
    assert.equal(classifyFollowUp({ dueAt: "not-a-date", lastVisitAt: null, staleDays: 14, now }), null);
  });
});

describe("daysBetween", () => {
  it("floors to whole days and never goes negative", () => {
    const now = new Date("2026-09-22T15:00:00Z");
    assert.equal(daysBetween(new Date(now.getTime() - 2.9 * DAY), now), 2);
    assert.equal(daysBetween(new Date(now.getTime() + DAY), now), 0);
    assert.equal(daysBetween(null, now), null);
  });
});
