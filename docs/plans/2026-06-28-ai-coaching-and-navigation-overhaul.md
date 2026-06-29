# AI Coaching + Navigation + Field Notes Scaling Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Fix date extraction from visit transcripts, fix broken navigation links (bell feed + AI summary cards), and redesign Field Notes + bell feed to scale as visit volume grows.

**Architecture:** Four work streams, each independently shippable. (1) AI transcript structuring gets a `callbackDate` field that auto-populates the visit's `nextActionDate`. (2) Bell feed and AI summary cards switch from `<a href>` to wouter programmatic navigation, closing the sheet panel on click. (3) Field Notes transforms from a flat visit list to a business-grouped, urgency-sorted index. (4) Bell feed gets lifecycle management: tabs, grouping, and auto-archive.

**Tech Stack:** React/Vite, wouter (router), TanStack Query, Express 5, Drizzle ORM, OpenAI GPT-4o-mini, Tailwind/shadcn.

---

## Work Stream 1: Date Extraction from Transcripts

### Task 1: Add `callbackDate` to StructuredNote interface

**Objective:** Extend the AI structuring output type to include a parsed callback date.

**Files:**
- Modify: `artifacts/api-server/src/lib/transcription.ts:12-19`

**Step 1: Update the interface**

In `transcription.ts`, add `callbackDate` to the `StructuredNote` interface:

```ts
export interface StructuredNote {
  summary: string;
  interestLevel: "hot" | "warm" | "cool" | "cold" | "unknown";
  objections: string[];
  followUpItems: string[];
  contactInfo?: string;
  nextStep?: string;
  callbackDate?: string; // ISO date (YYYY-MM-DD) when a meeting/callback/follow-up is mentioned
}
```

**Step 2: Commit**

```bash
git add artifacts/api-server/src/lib/transcription.ts
git commit -m "feat: add callbackDate field to StructuredNote interface"
```

---

### Task 2: Update STRUCTURING_PROMPT to extract dates

**Objective:** Teach the AI to parse natural-language dates ("Jul 8th", "Jan 15", "next Friday") into ISO format.

**Files:**
- Modify: `artifacts/api-server/src/lib/transcription.ts:121-129`

**Step 1: Rewrite the prompt**

Replace the existing `STRUCTURING_PROMPT` with:

```ts
const STRUCTURING_PROMPT = `You analyze transcripts of voice notes that a door-to-door sales rep records right after a business visit. Extract structured data.

Today's date is provided as context. When the rep mentions a date for a meeting, callback, appointment, or follow-up (e.g., "Jul 8th", "January 15", "next Friday", "the 23rd", "end of next week"), convert it to an ISO calendar date (YYYY-MM-DD). If the rep says "I set a meeting" or "scheduled a callback" but gives no date, set callbackDate to null.

Respond with JSON only, matching this shape:
{
  "summary": "1-2 sentence summary of the visit",
  "interestLevel": "hot" | "warm" | "cool" | "cold" | "unknown",
  "objections": ["each objection the prospect raised"],
  "followUpItems": ["each concrete follow-up action mentioned"],
  "contactInfo": "any names/phones/emails mentioned, or omit",
  "nextStep": "the single most important next action, or omit",
  "callbackDate": "YYYY-MM-DD or null"
}`;
```

**Step 2: Pass current date to the LLM**

In `structureTranscript()` (around line 131), inject today's date into the user message. Change the `messages` array:

```ts
messages: [
  { role: "system", content: systemPrompt },
  { role: "user", content: `Today is ${new Date().toISOString().slice(0, 10)}.\n\n${transcript}` },
],
```

**Step 3: Parse callbackDate from the LLM response**

In `structureTranscript()` around line 166, add callbackDate to the return:

```ts
return {
  summary: parsed.summary ?? "",
  interestLevel: parsed.interestLevel ?? "unknown",
  objections: Array.isArray(parsed.objections) ? parsed.objections : [],
  followUpItems: Array.isArray(parsed.followUpItems) ? parsed.followUpItems : [],
  ...(parsed.contactInfo ? { contactInfo: parsed.contactInfo } : {}),
  ...(parsed.nextStep ? { nextStep: parsed.nextStep } : {}),
  ...(parsed.callbackDate ? { callbackDate: parsed.callbackDate } : {}),
};
```

**Step 4: Commit**

```bash
git add artifacts/api-server/src/lib/transcription.ts
git commit -m "feat: update structuring prompt to extract callbackDate from natural language"
```

---

### Task 3: Auto-populate visit.nextActionDate from extracted callbackDate

**Objective:** When the AI extracts a callback date, write it to the visit record so the UI and coaching system can use it.

**Files:**
- Modify: `artifacts/api-server/src/lib/transcription.ts` (in `writeTranscriptResult`, around line 53-94)

**Step 1: Update writeTranscriptResult to set visit nextActionDate**

After the media update (line 71), add a conditional visit update:

```ts
// If AI extracted a callback date, set it on the visit.
if (opts.structured?.callbackDate && opts.visitId) {
  const parsed = new Date(opts.structured.callbackDate);
  if (!Number.isNaN(parsed.getTime())) {
    await db
      .update(visitsTable)
      .set({ nextActionDate: parsed })
      .where(eq(visitsTable.id, opts.visitId));
  }
}
```

Also add `callbackDate` to the event payload in `logEvent` (around line 80):

```ts
payload: {
  source: opts.source,
  summary: opts.structured?.summary,
  interestLevel: opts.structured?.interestLevel,
  objections: opts.structured?.objections ?? [],
  followUpItems: opts.structured?.followUpItems ?? [],
  nextStep: opts.structured?.nextStep,
  contactInfo: opts.structured?.contactInfo,
  callbackDate: opts.structured?.callbackDate,
  objectionCount: opts.structured?.objections.length ?? 0,
  followUpCount: opts.structured?.followUpItems.length ?? 0,
  transcriptChars: opts.transcript.length,
  transcriptionError: opts.transcriptionError,
},
```

**Step 2: Commit**

```bash
git add artifacts/api-server/src/lib/transcription.ts
git commit -m "feat: auto-populate visit nextActionDate from AI-extracted callbackDate"
```

---

### Task 4: Show callbackDate in the TranscriptionCard UI

**Objective:** Display the extracted callback date as a prominent badge in the AI summary card.

**Files:**
- Modify: `artifacts/sales-outreach/src/components/transcription-card.tsx:127-134`

**Step 1: Add callbackDate display**

After the `ai?.nextStep` block (around line 134), insert:

```tsx
{ai?.callbackDate && (
  <div className="flex items-center gap-2 text-sm bg-accent/10 rounded-md px-3 py-2">
    <Calendar className="h-4 w-4 text-accent" />
    <span className="font-medium">Callback scheduled: </span>
    <span className="text-accent font-medium">
      {format(parseISO(ai.callbackDate), "EEE, MMM d")}
    </span>
  </div>
)}
```

Add `Calendar` and `parseISO`/`format` to the imports at the top of the file:

```tsx
import { format, parseISO } from "date-fns";
import { Calendar } from "lucide-react";
```

(Check existing imports to avoid duplicates. `Sparkles, Loader2, ...` are already from lucide-react; add `Calendar` there.)

**Step 2: Commit**

```bash
git add artifacts/sales-outreach/src/components/transcription-card.tsx
git commit -m "feat: display extracted callbackDate badge in AI summary card"
```

---

### Task 5: Write test for date extraction

**Objective:** Prove that the structuring prompt + callbackDate parsing works end to end.

**Files:**
- Create: `artifacts/api-server/src/lib/__tests__/transcription.test.ts`

**Step 1: Write the test**

```ts
import { describe, it, expect } from "node:test";

describe("StructuredNote callbackDate", () => {
  it("should include callbackDate in the interface type", () => {
    const note = {
      summary: "Set a meeting for Jul 8th",
      interestLevel: "warm",
      objections: [],
      followUpItems: [],
      callbackDate: "2026-07-08",
    };
    expect(note.callbackDate).toBe("2026-07-08");
  });

  it("should allow callbackDate to be omitted", () => {
    const note = {
      summary: "No date mentioned",
      interestLevel: "cool",
      objections: [],
      followUpItems: [],
    };
    expect(note.callbackDate).toBeUndefined();
  });
});
```

**Step 2: Run the test**

```bash
corepack pnpm --filter @workspace/api-server test
```

Expected: PASS

**Step 3: Commit**

```bash
git add artifacts/api-server/src/lib/__tests__/transcription.test.ts
git commit -m "test: callbackDate field in StructuredNote"
```

---

## Work Stream 2: Fix Navigation Links

### Task 6: Fix bell feed action_url to use client-side navigation

**Objective:** Coaching suggestion "Act on it" / "Open visit" buttons currently use `<a href>` which causes a full page reload. Switch to wouter programmatic navigation so it's instant AND closes the sheet.

**Files:**
- Modify: `artifacts/sales-outreach/src/components/coaching-feed.tsx:55-64` and imports

**Step 1: Import useLocation from wouter**

Add to the top imports:

```tsx
import { useLocation } from "wouter";
```

**Step 2: Update SuggestionCard to accept onNavigate**

Change the `SuggestionCard` component signature:

```tsx
function SuggestionCard({
  s,
  onAction,
  onNavigate,
}: {
  s: Suggestion;
  onAction: (id: number, status: Suggestion["status"]) => void;
  onNavigate: () => void;
}) {
```

Replace the action button (lines 55-64) that uses `<a href>` with a button that navigates programmatically:

```tsx
{s.actionUrl && (
  <Button
    size="sm"
    variant="default"
    className="h-7 text-xs"
    onClick={() => {
      onAction(s.id, "acted");
      onNavigate();
    }}
  >
    <Link href={s.actionUrl}>{s.actionLabel ?? "Act on it"}</Link>
  </Button>
)}
```

Wait, simpler approach - import `Link` from wouter and use it properly:

Replace lines 55-64 with:

```tsx
{s.actionUrl && (
  <Button
    size="sm"
    variant="default"
    className="h-7 text-xs"
    onClick={() => onAction(s.id, "acted")}
  >
    <Link href={s.actionUrl} onClick={onNavigate}>
      {s.actionLabel ?? "Act on it"}
    </Link>
  </Button>
)}
```

Add `Link` to imports:

```tsx
import { Link } from "wouter";
```

**Step 3: Pass close handler from CoachingFeed**

In the `CoachingFeed` component (around line 87), the `setOpen` state already exists. Update the SuggestionCard rendering:

```tsx
{sorted.map((s) => (
  <SuggestionCard
    key={s.id}
    s={s}
    onAction={(id, status) => updateStatus.mutate({ id, status })}
    onNavigate={() => setOpen(false)}
  />
))}
```

**Step 4: Commit**

```bash
git add artifacts/sales-outreach/src/components/coaching-feed.tsx
git commit -m "fix: bell feed uses client-side navigation, closes sheet on click"
```

---

### Task 7: Fix visit detail back navigation

**Objective:** The visit detail page "Back to Business" link works but there's no "Back to Field Notes" option. Reps arriving from bell feed or coaching cards need a way back to the visit list.

**Files:**
- Modify: `artifacts/sales-outreach/src/pages/visits/detail.tsx:81-85`

**Step 1: Add a Field Notes breadcrumb**

Replace the back navigation block (lines 81-85):

```tsx
<div className="flex items-center gap-3 text-sm text-muted-foreground">
  <Link href="/visits" className="hover:text-foreground flex items-center gap-1">
    <ArrowLeft className="h-4 w-4" /> Field Notes
  </Link>
  <span>/</span>
  <Link href={`/businesses/${visit.businessId}`} className="hover:text-foreground">
    {visit.businessName}
  </Link>
</div>
```

**Step 2: Commit**

```bash
git add artifacts/sales-outreach/src/pages/visits/detail.tsx
git commit -m "fix: add Field Notes breadcrumb on visit detail page"
```

---

### Task 8: Make AI summary card link to its visit

**Objective:** When the TranscriptionCard appears (it's always rendered inside a visit detail page, so this is about consistency), the visit ID should be visible and the card should feel anchored to the visit.

**Note:** The TranscriptionCard is already only shown inside `visit detail.tsx`, so it already has visit context. No separate link is needed. The navigation issue is that bell feed coaching cards don't reliably reach the visit detail. Task 6 fixes that.

**Skip this task - no code change needed.**

---

## Work Stream 3: Field Notes Scaling (Business-Grouped Index)

### Task 9: Add backend endpoint for grouped visits by business

**Objective:** Create an API endpoint that returns visits grouped by business with urgency metadata (callback due, outcome, last visit date, AI summary snippet).

**Files:**
- Modify: `artifacts/api-server/src/routes/visits.ts`

**Step 1: Add GET /api/visits/grouped endpoint**

At the end of the visits router (before `export default`), add:

```ts
// GET /api/visits/grouped - visits grouped by business for Field Notes
router.get("/visits/grouped", requireAuth, async (req, res): Promise<void> => {
  const repFilter = canSeeAllReps(req) ? {} : { repId: req.userId };
  const businesses = await db
    .select({
      id: businessesTable.id,
      name: businessesTable.name,
      address: businessesTable.address,
    })
    .from(businessesTable)
    .where(/* team-readable scope */);

  const visits = await db
    .select({
      id: visitsTable.id,
      businessId: visitsTable.businessId,
      outcome: visitsTable.outcome,
      visitedAt: visitsTable.visitedAt,
      nextActionDate: visitsTable.nextActionDate,
      repId: visitsTable.repId,
      aiSummary: mediaTable.aiStructured,
    })
    .from(visitsTable)
    .leftJoin(mediaTable, eq(mediaTable.visitId, visitsTable.id))
    .where(repFilter)
    .orderBy(desc(visitsTable.visitedAt));

  // Group by business
  const grouped = new Map<number, {
    businessId: number;
    businessName: string;
    businessAddress: string | null;
    visitCount: number;
    lastVisitAt: string;
    lastOutcome: string;
    nextActionDate: string | null;
    latestSummary: string | null;
    latestVisitId: number;
  }>();

  for (const v of visits) {
    const existing = grouped.get(v.businessId);
    if (!existing) {
      grouped.set(v.businessId, {
        businessId: v.businessId,
        businessName: /* lookup */,
        businessAddress: /* lookup */,
        visitCount: 1,
        lastVisitAt: v.visitedAt,
        lastOutcome: v.outcome,
        nextActionDate: v.nextActionDate,
        latestSummary: v.aiSummary?.summary ?? null,
        latestVisitId: v.id,
      });
    } else {
      existing.visitCount++;
      if (!existing.nextActionDate && v.nextActionDate) {
        existing.nextActionDate = v.nextActionDate;
      }
    }
  }

  res.json(Array.from(grouped.values()));
});
```

**Note:** The implementer should adapt the query to match the actual Drizzle schema and auth scoping used in existing visit routes. The key shape is what matters: one row per business with visit count, last visit, next action date, and latest AI summary snippet.

**Step 2: Mount the route BEFORE /visits/:id to avoid path collision**

In `routes/index.ts`, ensure `/visits/grouped` is matched. Since Express 5 pattern matching, `/visits/:id` would match `/visits/grouped` with id="grouped". Mount the grouped route at the top of the visits router, before any `:id` routes.

**Step 3: Commit**

```bash
git add artifacts/api-server/src/routes/visits.ts
git commit -m "feat: add GET /api/visits/grouped endpoint for business-grouped Field Notes"
```

---

### Task 10: Redesign Field Notes page (business-grouped, urgency-sorted)

**Objective:** Replace the flat visit list with business cards sorted by urgency: callbacks due soon first, follow-ups next, recently visited after.

**Files:**
- Rewrite: `artifacts/sales-outreach/src/pages/visits/index.tsx`

**Step 1: Rewrite the page**

```tsx
import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, MapPin, Clock, ChevronRight, Search } from "lucide-react";
import { Link } from "wouter";
import { format, parseISO, differenceInDays } from "date-fns";
import { useState, useMemo } from "react";

type GroupedVisit = {
  businessId: number;
  businessName: string;
  businessAddress: string | null;
  visitCount: number;
  lastVisitAt: string;
  lastOutcome: string;
  nextActionDate: string | null;
  latestSummary: string | null;
  latestVisitId: number;
};

function urgencyRank(g: GroupedVisit): number {
  // 0 = most urgent
  if (g.nextActionDate) {
    const days = differenceInDays(parseISO(g.nextActionDate), new Date());
    if (days < 0) return 0; // overdue callback
    if (days <= 3) return 1; // due soon
    if (days <= 7) return 2; // this week
    return 3; // scheduled later
  }
  if (g.lastOutcome === "follow_up_needed") return 4; // needs follow-up, no date
  if (g.lastOutcome === "positive") return 5;
  return 6;
}

const OUTCOME_STYLES: Record<string, string> = {
  positive: "bg-green-500/15 text-green-600 dark:text-green-400",
  negative: "bg-red-500/15 text-red-600 dark:text-red-400",
  follow_up_needed: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  neutral: "bg-muted text-muted-foreground",
};

export default function VisitsList() {
  const [search, setSearch] = useState("");

  const { data: groups, isLoading } = useQuery({
    queryKey: ["visits-grouped"],
    queryFn: () => customFetch<GroupedVisit[]>("/api/visits/grouped"),
  });

  const filtered = useMemo(() => {
    if (!groups) return [];
    const sorted = [...groups].sort(
      (a, b) => urgencyRank(a) - urgencyRank(b) || new Date(b.lastVisitAt).getTime() - new Date(a.lastVisitAt).getTime(),
    );
    if (!search.trim()) return sorted;
    return sorted.filter((g) =>
      g.businessName.toLowerCase().includes(search.toLowerCase()),
    );
  }, [groups, search]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Field Notes</h1>
          <p className="text-sm text-muted-foreground">
            All prospects sorted by what needs attention next.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search businesses..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9 max-w-sm"
        />
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse h-20" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
          {search ? "No businesses match your search." : "No visits yet. Start visiting prospects to build your field notes."}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((g) => {
            const days = g.nextActionDate
              ? differenceInDays(parseISO(g.nextActionDate), new Date())
              : null;
            const overdue = days !== null && days < 0;
            const dueSoon = days !== null && days >= 0 && days <= 3;

            return (
              <Link key={g.businessId} href={`/visits/${g.latestVisitId}`}>
                <Card
                  className={`hover:border-primary/50 transition-colors cursor-pointer ${
                    overdue ? "border-l-4 border-l-destructive" : dueSoon ? "border-l-4 border-l-accent" : ""
                  }`}
                >
                  <CardContent className="p-4 flex items-center justify-between gap-4">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="font-semibold truncate">{g.businessName}</h3>
                        <Badge variant="outline" className={`text-[10px] uppercase shrink-0 ${OUTCOME_STYLES[g.lastOutcome] ?? ""}`}>
                          {g.lastOutcome.replace(/_/g, " ")}
                        </Badge>
                        {g.visitCount > 1 && (
                          <span className="text-[10px] text-muted-foreground shrink-0">
                            {g.visitCount} visits
                          </span>
                        )}
                      </div>
                      {g.latestSummary && (
                        <p className="text-xs text-muted-foreground truncate">{g.latestSummary}</p>
                      )}
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          {format(parseISO(g.lastVisitAt), "MMM d")}
                        </span>
                        {g.nextActionDate && (
                          <span className={`flex items-center gap-1 font-medium ${overdue ? "text-destructive" : dueSoon ? "text-accent" : ""}`}>
                            <Calendar className="h-3 w-3" />
                            {overdue
                              ? `${Math.abs(days!)}d overdue`
                              : days === 0
                                ? "Today"
                                : `in ${days}d`}
                          </span>
                        )}
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add artifacts/sales-outreach/src/pages/visits/index.tsx
git commit -m "feat: redesign Field Notes as business-grouped urgency-sorted index"
```

---

## Work Stream 4: Bell Feed Lifecycle Management

### Task 11: Add bell feed tabs (Active / History) and auto-archive

**Objective:** Split the bell feed into two tabs. "Active" shows unread + recent (within 48h) cards. "History" shows everything. Acted/dismissed cards auto-hide from Active after 24h.

**Files:**
- Modify: `artifacts/sales-outreach/src/components/coaching-feed.tsx`

**Step 1: Add tab state and filtering logic**

In the `CoachingFeed` component, replace the rendering section (around line 94+) with:

```tsx
const [tab, setTab] = useState<"active" | "history">("active");

const now = Date.now();
const filtered = useMemo(() => {
  const sorted = [...(suggestions ?? [])].sort((a, b) => {
    const statusOrder = { unread: 0, read: 1, acted: 2, dismissed: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  if (tab === "active") {
    return sorted.filter((s) => {
      // Always show unread and read
      if (s.status === "unread" || s.status === "read") return true;
      // Show acted/dismissed only within 24h
      const ageHours = (now - new Date(s.createdAt).getTime()) / 3_600_000;
      return ageHours < 24;
    });
  }
  return sorted;
}, [suggestions, tab, now]);

const activeCount = useMemo(
  () => (suggestions ?? []).filter((s) => {
    if (s.status === "unread" || s.status === "read") return true;
    const ageHours = (now - new Date(s.createdAt).getTime()) / 3_600_000;
    return ageHours < 24;
  }).length,
  [suggestions, now],
);
```

Add `useMemo` to imports.

**Step 2: Add tab UI**

Replace the suggestions rendering area with:

```tsx
<div className="flex gap-1 mb-3">
  <Button
    size="sm"
    variant={tab === "active" ? "default" : "ghost"}
    onClick={() => setTab("active")}
    className="text-xs"
  >
    Active {activeCount > 0 && <Badge variant="secondary" className="ml-1 text-[10px]">{activeCount}</Badge>}
  </Button>
  <Button
    size="sm"
    variant={tab === "history" ? "default" : "ghost"}
    onClick={() => setTab("history")}
    className="text-xs"
  >
    History
  </Button>
</div>

<div className="space-y-3">
  {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>}
  {!isLoading && filtered.length === 0 && (
    <div className="text-center py-12 text-muted-foreground">
      <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
      <p className="text-sm">{tab === "active" ? "No active suggestions." : "No history yet."}</p>
    </div>
  )}
  {filtered.map((s) => (
    <SuggestionCard
      key={s.id}
      s={s}
      onAction={(id, status) => updateStatus.mutate({ id, status })}
      onNavigate={() => setOpen(false)}
    />
  ))}
</div>
```

**Step 3: Commit**

```bash
git add artifacts/sales-outreach/src/components/coaching-feed.tsx
git commit -m "feat: bell feed tabs (Active/History) with 24h auto-archive"
```

---

### Task 12: Add type group headers in bell feed

**Objective:** Within the Active tab, group suggestions by type (Coaching, Callback, Nearby, Debrief) with small header labels.

**Files:**
- Modify: `artifacts/sales-outreach/src/components/coaching-feed.tsx`

**Step 1: Add grouping logic**

After the `filtered` memo, add:

```tsx
const grouped = useMemo(() => {
  const groups: Record<string, Suggestion[]> = {};
  for (const s of filtered) {
    const key = s.type;
    if (!groups[key]) groups[key] = [];
    groups[key].push(s);
  }
  return groups;
}, [filtered]);

const GROUP_ORDER = ["coaching", "callback_reminder", "nearby_prospect", "debrief", "other"];
```

**Step 2: Render grouped sections**

Replace the `filtered.map(...)` with:

```tsx
{GROUP_ORDER.filter((g) => grouped[g]?.length).map((type) => (
  <div key={type} className="space-y-2">
    <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
      {TYPE_META[type]?.label ?? type}
      <Badge variant="secondary" className="text-[10px]">{grouped[type].length}</Badge>
    </div>
    {grouped[type].map((s) => (
      <SuggestionCard
        key={s.id}
        s={s}
        onAction={(id, status) => updateStatus.mutate({ id, status })}
        onNavigate={() => setOpen(false)}
      />
    ))}
  </div>
))}
```

**Step 3: Commit**

```bash
git add artifacts/sales-outreach/src/components/coaching-feed.tsx
git commit -m "feat: group bell feed suggestions by type with headers"
```

---

## Work Stream 5: Build, Test, Deploy

### Task 13: Typecheck and test

**Objective:** Ensure all changes compile and pass tests.

**Step 1: Run typecheck**

```bash
cd /root/projects/sales-visit-log
corepack pnpm run typecheck
```

Expected: 0 errors.

**Step 2: Run tests**

```bash
corepack pnpm --filter @workspace/api-server test
corepack pnpm --filter @workspace/hermes-agent test
```

Expected: all pass.

**Step 3: Fix any issues found**

**Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve typecheck/test issues from coaching overhaul"
```

---

### Task 14: Rebuild frontend and restart servers

**Objective:** Deploy the changes to svl.mindvaultstudio.net.

**Step 1: Build frontend**

```bash
cd /root/projects/sales-visit-log
corepack pnpm --filter sales-outreach build
```

**Step 2: Restart proxy server**

```bash
kill $(pgrep -f "node artifacts/proxy-server.mjs") 2>/dev/null
sleep 1
/usr/local/bin/svl-server &
```

Or use the watchdog to pick it up within 2 minutes.

**Step 3: Restart API server**

```bash
kill $(pgrep -f "node artifacts/api-server/dist/index.mjs") 2>/dev/null
sleep 1
/usr/local/bin/svl-api-server &
```

**Step 4: Verify health**

```bash
curl -sS -o /dev/null -w "proxy: %{http_code}\n" http://127.0.0.1:8097/health
curl -sS -o /dev/null -w "api: %{http_code}\n" http://127.0.0.1:8090/api/healthz
```

Expected: both 200.

**Step 5: Smoke test in browser**

Navigate to https://svl.mindvaultstudio.net, sign in, verify:
- Field Notes page shows business-grouped cards sorted by urgency
- Bell feed has Active/History tabs
- Clicking a bell feed card navigates to visit detail (no page reload)
- Visit detail has Field Notes breadcrumb

---

## Summary of Changes

| Area | Problem | Fix |
|------|---------|-----|
| Date extraction | AI doesn't extract "Jul 8th" as a date | New `callbackDate` field in structuring prompt + auto-populates `nextActionDate` on visit |
| Bell feed nav | `<a href>` causes page reload, sheet stays open | wouter `<Link>` + close sheet on navigate |
| Visit detail nav | No way back to Field Notes | Breadcrumb: Field Notes / Business Name |
| Field Notes | Flat list, hard to find businesses | Business-grouped, urgency-sorted cards with search |
| Bell feed | Ever-growing flat list | Active/History tabs, type grouping, 24h auto-archive |

## File Change Summary

| File | Change |
|------|--------|
| `artifacts/api-server/src/lib/transcription.ts` | Add `callbackDate` to StructuredNote, update prompt, auto-populate visit nextActionDate |
| `artifacts/api-server/src/routes/visits.ts` | Add `GET /api/visits/grouped` endpoint |
| `artifacts/sales-outreach/src/components/transcription-card.tsx` | Display callbackDate badge |
| `artifacts/sales-outreach/src/components/coaching-feed.tsx` | wouter navigation, Active/History tabs, type grouping, close on navigate |
| `artifacts/sales-outreach/src/pages/visits/index.tsx` | Full rewrite: business-grouped urgency-sorted index |
| `artifacts/sales-outreach/src/pages/visits/detail.tsx` | Add Field Notes breadcrumb |
