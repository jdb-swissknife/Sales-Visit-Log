import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Calendar, Clock, ChevronRight, Search } from "lucide-react";
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
  if (g.nextActionDate) {
    const days = differenceInDays(parseISO(g.nextActionDate), new Date());
    if (days < 0) return 0; // overdue callback
    if (days <= 3) return 1; // due soon
    if (days <= 7) return 2; // this week
    return 3; // scheduled later
  }
  if (g.lastOutcome === "follow_up_needed") return 4;
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
