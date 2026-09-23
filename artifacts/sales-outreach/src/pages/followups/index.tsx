import { useState } from "react";
import { Link } from "wouter";
import { format, parseISO, isToday, isTomorrow } from "date-fns";
import {
  useListFollowUps,
  getListFollowUpsQueryKey,
  useUpdateVisit,
  useUpdateBusinessPipeline,
  type FollowUpItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { useToast } from "@/hooks/use-toast";
import { stageBadge, stageLabel, formatMoney } from "@/lib/pipeline";
import {
  AlertTriangle,
  CalendarCheck,
  CalendarClock,
  Phone,
  MapPin,
  Plus,
  Star,
  Clock,
  MoreHorizontal,
  Snowflake,
  CheckCircle2,
  XCircle,
  Navigation,
} from "lucide-react";

type Bucket = "overdue" | "today" | "upcoming" | "stale";

const BUCKET_META: Record<Bucket, { title: string; hint: string; icon: typeof Clock; accent: string }> = {
  overdue: {
    title: "Overdue",
    hint: "You promised to come back and haven't yet. Knock these first.",
    icon: AlertTriangle,
    accent: "text-red-600 dark:text-red-400",
  },
  today: {
    title: "Due today",
    hint: "Callbacks you scheduled for today.",
    icon: CalendarCheck,
    accent: "text-amber-600 dark:text-amber-400",
  },
  upcoming: {
    title: "This week",
    hint: "Coming up in the next 7 days — plan your route around them.",
    icon: CalendarClock,
    accent: "text-blue-600 dark:text-blue-400",
  },
  stale: {
    title: "Going cold",
    hint: "Open prospects with no visit in 2+ weeks and no plan. Re-engage or close them out.",
    icon: Snowflake,
    accent: "text-slate-500",
  },
};

const SNOOZE_PRESETS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
  { label: "In 2 weeks", days: 14 },
];

function dueLabel(item: FollowUpItem): string | null {
  if (!item.dueAt) return null;
  const d = parseISO(item.dueAt);
  if (isToday(d)) return "Today";
  if (isTomorrow(d)) return "Tomorrow";
  return format(d, "EEE, MMM d");
}

function FollowUpRow({
  item,
  onSnooze,
  onClose,
  busy,
}: {
  item: FollowUpItem;
  onSnooze: (item: FollowUpItem, days: number) => void;
  onClose: (item: FollowUpItem, status: "converted" | "not_interested") => void;
  busy: boolean;
}) {
  const due = dueLabel(item);
  const phone = item.contactPhone || item.phone;
  const mapsHref = item.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(item.address)}` : null;

  return (
    <Card className={item.bucket === "overdue" ? "border-red-500/40" : ""}>
      <CardContent className="p-3 sm:p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <Link href={`/businesses/${item.businessId}`} className="font-semibold leading-tight hover:underline truncate">
                {item.businessName}
              </Link>
              {item.priority === "high" && <Star className="h-3.5 w-3.5 shrink-0 text-red-500 fill-red-500" />}
              <Badge variant="secondary" className={`text-[10px] shadow-none ${stageBadge(item.status)}`}>
                {stageLabel(item.status)}
              </Badge>
              {item.dealValue != null && item.dealValue > 0 && (
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{formatMoney(item.dealValue)}</span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <span className="capitalize">{item.sector}</span>
              {item.contactName && <span>Ask for {item.contactName}</span>}
              {due && (
                <span className={item.bucket === "overdue" ? "font-medium text-red-600 dark:text-red-400" : ""}>
                  Due {due}
                </span>
              )}
              {item.daysSinceVisit != null && (
                <span>
                  Last visit {item.daysSinceVisit === 0 ? "today" : `${item.daysSinceVisit}d ago`}
                  {item.lastOutcome ? ` · ${item.lastOutcome.replace(/_/g, " ")}` : ""}
                </span>
              )}
            </div>

            {item.address && (
              <div className="flex items-center gap-1 text-xs text-muted-foreground truncate">
                <MapPin className="h-3 w-3 shrink-0" />
                <span className="truncate">{item.address}</span>
              </div>
            )}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" disabled={busy} aria-label="More actions">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {SNOOZE_PRESETS.map((p) => (
                <DropdownMenuItem key={p.days} onClick={() => onSnooze(item, p.days)}>
                  <CalendarClock className="mr-2 h-4 w-4" /> Reschedule: {p.label}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem onClick={() => onClose(item, "converted")}>
                <CheckCircle2 className="mr-2 h-4 w-4 text-green-600" /> Mark won
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onClose(item, "not_interested")}>
                <XCircle className="mr-2 h-4 w-4 text-red-600" /> Mark lost
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" className="h-8" asChild>
            <Link href={`/visits/new?businessId=${item.businessId}`}>
              <Plus className="mr-1.5 h-3.5 w-3.5" /> Log visit
            </Link>
          </Button>
          {phone && (
            <Button size="sm" variant="outline" className="h-8" asChild>
              <a href={`tel:${phone}`}>
                <Phone className="mr-1.5 h-3.5 w-3.5" /> Call
              </a>
            </Button>
          )}
          {mapsHref && (
            <Button size="sm" variant="outline" className="h-8" asChild>
              <a href={mapsHref} target="_blank" rel="noreferrer">
                <Navigation className="mr-1.5 h-3.5 w-3.5" /> Directions
              </a>
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export default function FollowUpsPage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const params = { staleDays: 14 };
  const { data, isLoading, isError } = useListFollowUps(params, { query: { queryKey: getListFollowUpsQueryKey(params) } });
  const updateVisit = useUpdateVisit();
  const updatePipeline = useUpdateBusinessPipeline();
  const [busyId, setBusyId] = useState<number | null>(null);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: getListFollowUpsQueryKey(params) });
    void queryClient.invalidateQueries({ queryKey: ["/api/stats/pipeline"] });
  };

  const onSnooze = async (item: FollowUpItem, days: number) => {
    if (!item.lastVisitId) {
      toast({ title: "No visit to reschedule", description: "Log a visit first, then set a callback.", variant: "destructive" });
      return;
    }
    setBusyId(item.businessId);
    const next = new Date();
    next.setDate(next.getDate() + days);
    next.setHours(9, 0, 0, 0);
    try {
      await updateVisit.mutateAsync({ id: item.lastVisitId, data: { nextActionDate: next.toISOString() } });
      toast({ title: "Rescheduled", description: `${item.businessName} · ${format(next, "EEE, MMM d")}` });
      refresh();
    } catch {
      toast({ title: "Couldn't reschedule", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const onClose = async (item: FollowUpItem, status: "converted" | "not_interested") => {
    setBusyId(item.businessId);
    try {
      await updatePipeline.mutateAsync({ id: item.businessId, data: { status } });
      toast({
        title: status === "converted" ? "Marked won" : "Marked lost",
        description: status === "converted" ? `${item.businessName} — nice work.` : `${item.businessName} closed out.`,
      });
      refresh();
    } catch {
      toast({ title: "Couldn't update", variant: "destructive" });
    } finally {
      setBusyId(null);
    }
  };

  const total = data ? data.counts.overdue + data.counts.today + data.counts.upcoming + data.counts.stale : 0;
  const actionable = data ? data.counts.overdue + data.counts.today : 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Follow-ups</h1>
          <p className="text-sm text-muted-foreground">
            {isLoading
              ? "Loading your queue…"
              : actionable > 0
                ? `${actionable} to hit today · ${total} open`
                : total > 0
                  ? `Nothing due today · ${total} open`
                  : "Nothing waiting on you."}
          </p>
        </div>
      </div>

      {isError && (
        <Card className="border-destructive/40">
          <CardContent className="p-4 text-sm text-destructive">Couldn't load follow-ups. Pull to refresh or try again.</CardContent>
        </Card>
      )}

      {isLoading && (
        <div className="space-y-3 animate-pulse">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-24 rounded-lg bg-muted" />
          ))}
        </div>
      )}

      {data && total === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-muted/30 py-14 text-center">
          <CheckCircle2 className="mx-auto mb-2 h-8 w-8 text-green-500" />
          <p className="font-medium">Queue's clear.</p>
          <p className="text-sm text-muted-foreground">Callbacks you set on visits will show up here. Go knock some new doors.</p>
          <Button className="mt-4" asChild>
            <Link href="/">Open the map</Link>
          </Button>
        </div>
      )}

      {data &&
        (["overdue", "today", "upcoming", "stale"] as Bucket[]).map((bucket) => {
          const items = data[bucket];
          if (items.length === 0) return null;
          const meta = BUCKET_META[bucket];
          const Icon = meta.icon;
          return (
            <section key={bucket} className="space-y-3">
              <div>
                <h2 className={`flex items-center gap-2 text-sm font-semibold uppercase tracking-wider ${meta.accent}`}>
                  <Icon className="h-4 w-4" />
                  {meta.title}
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">{items.length}</span>
                </h2>
                <p className="text-xs text-muted-foreground">{meta.hint}</p>
              </div>
              <div className="space-y-2">
                {items.map((item) => (
                  <FollowUpRow key={item.businessId} item={item} onSnooze={onSnooze} onClose={onClose} busy={busyId === item.businessId} />
                ))}
              </div>
            </section>
          );
        })}
    </div>
  );
}
