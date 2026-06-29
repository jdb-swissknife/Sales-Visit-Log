import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, X, Sparkles, MapPin, Calendar, Lightbulb } from "lucide-react";
import { useLocation } from "wouter";
import { useSuggestionStream, useSuggestions, useUnreadCount, useUpdateSuggestionStatus, type Suggestion } from "@/hooks/use-suggestions";
import { formatDistanceToNow } from "date-fns";
import { useState, useMemo } from "react";

const TYPE_META: Record<string, { icon: typeof Sparkles; color: string; label: string }> = {
  coaching: { icon: Lightbulb, color: "text-violet-500", label: "Coaching" },
  callback_reminder: { icon: Calendar, color: "text-amber-500", label: "Callback" },
  nearby_prospect: { icon: MapPin, color: "text-blue-500", label: "Nearby" },
  debrief: { icon: Sparkles, color: "text-emerald-500", label: "Debrief" },
  other: { icon: Bell, color: "text-slate-500", label: "Update" },
};

const PRIORITY_BADGE: Record<string, string> = {
  urgent: "bg-red-500/15 text-red-600 dark:text-red-400 border-red-500/30",
  high: "bg-orange-500/15 text-orange-600 dark:text-orange-400 border-orange-500/30",
  normal: "",
  low: "opacity-50",
};

function SuggestionCard({ s, onAction, onNavigate }: { s: Suggestion; onAction: (id: number, status: Suggestion["status"]) => void; onNavigate: () => void }) {
  const meta = TYPE_META[s.type] ?? TYPE_META.other;
  const Icon = meta.icon;
  const dimmed = s.status === "dismissed" || s.status === "acted";
  const isPending = s.status !== "acted" && s.status !== "dismissed";
  const [, setLocation] = useLocation();

  const handleClick = () => {
    if (s.actionUrl) {
      if (isPending) onAction(s.id, "acted");
      onNavigate();
      setLocation(s.actionUrl);
    }
  };

  return (
    <Card
      className={`border-l-2 border-l-${meta.color.replace("text-", "")} ${dimmed ? "opacity-50" : ""} ${s.actionUrl ? "cursor-pointer hover:border-primary/50 transition-colors" : ""}`}
      onClick={handleClick}
    >
      <CardContent className="p-3 space-y-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2">
            <Icon className={`h-4 w-4 shrink-0 ${meta.color}`} />
            <span className="text-xs font-medium text-muted-foreground">{meta.label}</span>
          </div>
          <div className="flex items-center gap-1">
            {(s.priority === "urgent" || s.priority === "high") && (
              <Badge variant="outline" className={`text-[10px] px-1.5 py-0 ${PRIORITY_BADGE[s.priority]}`}>
                {s.priority}
              </Badge>
            )}
            <span className="text-[10px] text-muted-foreground">
              {formatDistanceToNow(new Date(s.createdAt), { addSuffix: true })}
            </span>
          </div>
        </div>

        <h4 className="text-sm font-semibold leading-tight">{s.title}</h4>
        <p className="text-xs text-muted-foreground leading-relaxed whitespace-pre-wrap">{s.body}</p>

        {s.status !== "acted" && s.status !== "dismissed" && (
          <div className="flex items-center gap-2 pt-1" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="ghost" className="h-7 text-xs text-muted-foreground" onClick={() => onAction(s.id, "dismissed")}>
              <X className="h-3 w-3 mr-1" /> Dismiss
            </Button>
          </div>
        )}

        {s.status === "acted" && (
          <div className="flex items-center gap-1 text-xs text-emerald-500">
            <Check className="h-3 w-3" /> Acted on
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const GROUP_ORDER = ["coaching", "callback_reminder", "nearby_prospect", "debrief", "other"];

export function CoachingFeed() {
  useSuggestionStream();
  const { data: suggestions, isLoading } = useSuggestions();
  const unread = useUnreadCount();
  const updateStatus = useUpdateSuggestionStatus();
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"active" | "history">("active");

  const now = Date.now();

  const isActive = useMemo(() => {
    return (s: Suggestion) => {
      if (s.status === "unread" || s.status === "read") return true;
      const ageHours = (now - new Date(s.createdAt).getTime()) / 3_600_000;
      return ageHours < 24;
    };
  }, [now]);

  const filtered = useMemo(() => {
    const sorted = [...(suggestions ?? [])].sort((a, b) => {
      const statusOrder = { unread: 0, read: 1, acted: 2, dismissed: 3 };
      if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
    if (tab === "active") return sorted.filter(isActive);
    return sorted;
  }, [suggestions, tab, isActive]);

  const activeCount = useMemo(
    () => (suggestions ?? []).filter(isActive).length,
    [suggestions, isActive],
  );

  // Group by type within the active tab
  const grouped = useMemo(() => {
    const groups: Record<string, Suggestion[]> = {};
    for (const s of filtered) {
      const key = s.type;
      if (!groups[key]) groups[key] = [];
      groups[key].push(s);
    }
    return groups;
  }, [filtered]);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative rounded-full p-1.5 hover:bg-muted transition-colors"
          aria-label="Coaching suggestions"
        >
          <Bell className="h-5 w-5 text-muted-foreground" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold text-primary-foreground">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader className="pb-4 border-b">
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            AI Coaching
          </SheetTitle>
          {unread > 0 && (
            <p className="text-sm text-muted-foreground">{unread} new suggestion{unread !== 1 ? "s" : ""}</p>
          )}
        </SheetHeader>

        <div className="flex gap-1 mt-4 mb-3">
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
              {tab === "active" && <p className="text-xs mt-1">Suggestions appear as you log visits and notes.</p>}
            </div>
          )}

          {tab === "active"
            ? GROUP_ORDER.filter((g) => grouped[g]?.length).map((type) => (
                <div key={type} className="space-y-2">
                  <div className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground uppercase tracking-wide pt-2">
                    {TYPE_META[type]?.label ?? type}
                    <Badge variant="secondary" className="text-[10px]">{grouped[type].length}</Badge>
                  </div>
                  {grouped[type].map((s) => (
                    <SuggestionCard key={s.id} s={s} onAction={(id, status) => updateStatus.mutate({ id, status })} onNavigate={() => setOpen(false)} />
                  ))}
                </div>
              ))
            : filtered.map((s) => (
                <SuggestionCard key={s.id} s={s} onAction={(id, status) => updateStatus.mutate({ id, status })} onNavigate={() => setOpen(false)} />
              ))
          }
        </div>
      </SheetContent>
    </Sheet>
  );
}
