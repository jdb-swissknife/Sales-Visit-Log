import { inArray, sql } from "drizzle-orm";
import { db, businessesTable } from "@workspace/db";
import { OPEN_STAGES, classifyFollowUp, daysBetween, type FollowUpBucket } from "./pipeline";

export interface FollowUpItem {
  businessId: number;
  businessName: string;
  sector: string;
  address: string | null;
  phone: string | null;
  status: string;
  priority: string;
  dealValue: number | null;
  contactName: string | null;
  contactPhone: string | null;
  lastVisitId: number | null;
  lastVisitAt: string | null;
  lastOutcome: string | null;
  repId: string | null;
  dueAt: string | null;
  bucket: FollowUpBucket;
  daysSinceVisit: number | null;
  daysInStage: number | null;
}

export interface FollowUpQueue {
  overdue: FollowUpItem[];
  today: FollowUpItem[];
  upcoming: FollowUpItem[];
  stale: FollowUpItem[];
  counts: Record<FollowUpBucket, number>;
}

export interface FollowUpQueryOptions {
  /** Restrict to prospects whose latest visit belongs to this rep. */
  repId?: string | null;
  staleDays?: number;
  now?: Date;
}

const PRIORITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2 };

/**
 * Build the follow-up queue: every open prospect that has been visited at
 * least once, classified by the promise made on its latest visit (or by how
 * long it has gone untouched).
 */
export async function buildFollowUpQueue(opts: FollowUpQueryOptions = {}): Promise<FollowUpQueue> {
  const now = opts.now ?? new Date();
  const staleDays = opts.staleDays ?? 14;

  const rows = await db
    .select({
      businessId: businessesTable.id,
      businessName: businessesTable.name,
      sector: businessesTable.sector,
      address: businessesTable.address,
      phone: businessesTable.phone,
      status: businessesTable.status,
      priority: businessesTable.priority,
      dealValue: businessesTable.dealValue,
      stageChangedAt: businessesTable.stageChangedAt,
      lastVisitId: sql<number | null>`lv.id`,
      lastVisitAt: sql<string | null>`lv.visited_at::text`,
      lastOutcome: sql<string | null>`lv.outcome`,
      contactName: sql<string | null>`lv.contact_name`,
      contactPhone: sql<string | null>`lv.contact_phone`,
      repId: sql<string | null>`lv.rep_id`,
      dueAt: sql<string | null>`lv.next_action_date::text`,
    })
    .from(businessesTable)
    // Latest visit per business (LATERAL keeps it one round-trip).
    .innerJoin(
      sql`LATERAL (
        SELECT id, visited_at, outcome, contact_name, contact_phone, rep_id, next_action_date
        FROM visits
        WHERE visits.business_id = ${businessesTable.id}
        ORDER BY visited_at DESC
        LIMIT 1
      ) AS lv`,
      sql`true`,
    )
    .where(inArray(businessesTable.status, [...OPEN_STAGES]));

  const items: FollowUpItem[] = [];
  for (const r of rows) {
    if (opts.repId && r.repId !== opts.repId) continue;
    const bucket = classifyFollowUp({ dueAt: r.dueAt, lastVisitAt: r.lastVisitAt, staleDays, now });
    if (!bucket) continue;
    items.push({
      businessId: r.businessId,
      businessName: r.businessName,
      sector: r.sector,
      address: r.address ?? null,
      phone: r.phone ?? null,
      status: r.status,
      priority: r.priority,
      dealValue: r.dealValue ?? null,
      contactName: r.contactName ?? null,
      contactPhone: r.contactPhone ?? null,
      lastVisitId: r.lastVisitId ?? null,
      lastVisitAt: r.lastVisitAt ? new Date(r.lastVisitAt).toISOString() : null,
      lastOutcome: r.lastOutcome ?? null,
      repId: r.repId ?? null,
      dueAt: r.dueAt ? new Date(r.dueAt).toISOString() : null,
      bucket,
      daysSinceVisit: daysBetween(r.lastVisitAt, now),
      daysInStage: daysBetween(r.stageChangedAt, now),
    });
  }

  // Within a bucket: soonest due first, then high priority, then biggest deal.
  const byUrgency = (a: FollowUpItem, b: FollowUpItem): number => {
    const ad = a.dueAt ? Date.parse(a.dueAt) : Number.POSITIVE_INFINITY;
    const bd = b.dueAt ? Date.parse(b.dueAt) : Number.POSITIVE_INFINITY;
    if (ad !== bd) return ad - bd;
    const ap = PRIORITY_RANK[a.priority] ?? 9;
    const bp = PRIORITY_RANK[b.priority] ?? 9;
    if (ap !== bp) return ap - bp;
    return (b.dealValue ?? 0) - (a.dealValue ?? 0);
  };
  // Stale: longest-untouched first.
  const byStaleness = (a: FollowUpItem, b: FollowUpItem): number =>
    (b.daysSinceVisit ?? 0) - (a.daysSinceVisit ?? 0) || byUrgency(a, b);

  const queue: FollowUpQueue = {
    overdue: items.filter((i) => i.bucket === "overdue").sort(byUrgency),
    today: items.filter((i) => i.bucket === "today").sort(byUrgency),
    upcoming: items.filter((i) => i.bucket === "upcoming").sort(byUrgency),
    stale: items.filter((i) => i.bucket === "stale").sort(byStaleness),
    counts: { overdue: 0, today: 0, upcoming: 0, stale: 0 },
  };
  queue.counts = {
    overdue: queue.overdue.length,
    today: queue.today.length,
    upcoming: queue.upcoming.length,
    stale: queue.stale.length,
  };
  return queue;
}
