import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Bell, Check, X, Sparkles, MapPin, Calendar, Lightbulb } from "lucide-react";
import { useSuggestions, useUnreadCount, useUpdateSuggestionStatus, type Suggestion } from "@/hooks/use-suggestions";
import { formatDistanceToNow } from "date-fns";
import { useState } from "react";

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

function SuggestionCard({ s, onAction }: { s: Suggestion; onAction: (id: number, status: Suggestion["status"]) => void }) {
  const meta = TYPE_META[s.type] ?? TYPE_META.other;
  const Icon = meta.icon;
  const dimmed = s.status === "dismissed" || s.status === "acted";

  return (
    <Card className={`border-l-2 border-l-${meta.color.replace("text-", "")} ${dimmed ? "opacity-50" : ""}`}>
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
          <div className="flex items-center gap-2 pt-1">
            {s.actionUrl && (
              <Button
                size="sm"
                variant="default"
                className="h-7 text-xs"
                onClick={() => onAction(s.id, "acted")}
                asChild
              >
                <a href={s.actionUrl}>{s.actionLabel ?? "Act on it"}</a>
              </Button>
            )}
            {!s.actionUrl && s.status === "unread" && (
              <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAction(s.id, "read")}>
                <Check className="h-3 w-3 mr-1" /> Mark read
              </Button>
            )}
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

export function CoachingFeed() {
  const { data: suggestions, isLoading } = useSuggestions();
  const unread = useUnreadCount();
  const updateStatus = useUpdateSuggestionStatus();
  const [open, setOpen] = useState(false);

  const sorted = [...(suggestions ?? [])].sort((a, b) => {
    const statusOrder = { unread: 0, read: 1, acted: 2, dismissed: 3 };
    if (statusOrder[a.status] !== statusOrder[b.status]) return statusOrder[a.status] - statusOrder[b.status];
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

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

        <div className="space-y-3 mt-4">
          {isLoading && <p className="text-sm text-muted-foreground text-center py-8">Loading...</p>}
          {!isLoading && sorted.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              <Sparkles className="h-8 w-8 mx-auto mb-2 opacity-40" />
              <p className="text-sm">No coaching suggestions yet.</p>
              <p className="text-xs mt-1">Suggestions appear as you log visits and notes.</p>
            </div>
          )}
          {sorted.map((s) => (
            <SuggestionCard key={s.id} s={s} onAction={(id, status) => updateStatus.mutate({ id, status })} />
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}
