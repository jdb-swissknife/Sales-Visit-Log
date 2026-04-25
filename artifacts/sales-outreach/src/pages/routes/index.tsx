import { useState } from "react";
import { useGetRoutesByDay, getGetRoutesByDayQueryKey } from "@workspace/api-client-react";
import type { DayRoute, RouteBusiness } from "@workspace/api-client-react";
import { Link } from "wouter";
import { MapPin, Phone, Star, ChevronDown, ChevronRight, Building2, Route, Mic } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

const STATUS_COLORS: Record<string, string> = {
  not_contacted: "bg-muted text-muted-foreground",
  contacted: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  follow_up: "bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-300",
  converted: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  not_interested: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300",
};

const DAY_COLORS: Record<number, string> = {
  1: "border-l-blue-500",
  2: "border-l-green-500",
  3: "border-l-orange-500",
  4: "border-l-purple-500",
};

const DAY_BG: Record<number, string> = {
  1: "bg-blue-50 dark:bg-blue-950/20",
  2: "bg-green-50 dark:bg-green-950/20",
  3: "bg-orange-50 dark:bg-orange-950/20",
  4: "bg-purple-50 dark:bg-purple-950/20",
};

const DAY_BADGE_COLORS: Record<number, string> = {
  1: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300",
  2: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300",
  3: "bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300",
  4: "bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300",
};

function BusinessStopCard({ business, stopNumber }: { business: RouteBusiness; stopNumber: number }) {
  return (
    <div className="flex items-stretch gap-2 p-3 rounded-lg border border-border hover:bg-muted/50 transition-colors">
      <Link href={`/businesses/${business.id}`} className="flex flex-1 gap-3 min-w-0 cursor-pointer">
        <div className="flex-shrink-0 w-8 h-8 rounded-full bg-muted flex items-center justify-center text-sm font-semibold text-muted-foreground">
          {stopNumber}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-semibold text-sm">{business.name}</span>
              {business.priority === "high" && <Star className="h-3.5 w-3.5 text-amber-500 fill-amber-500 flex-shrink-0" />}
              <Badge variant="outline" className="text-[10px] capitalize px-1.5 py-0">{business.sector}</Badge>
            </div>
            <Badge
              variant="secondary"
              className={`text-[10px] capitalize shadow-none flex-shrink-0 ${STATUS_COLORS[business.status] || ""}`}
            >
              {business.status.replace(/_/g, " ")}
            </Badge>
          </div>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-xs text-muted-foreground">
            {business.address && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3 flex-shrink-0" />
                <span className="truncate max-w-[220px]">{business.address}</span>
              </span>
            )}
            {business.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3 w-3 flex-shrink-0" />
                {business.phone}
              </span>
            )}
          </div>
          {(business.visitCount > 0 || business.noteCount > 0) && (
            <div className="flex gap-2 mt-1 text-xs text-muted-foreground">
              {business.visitCount > 0 && <span>{business.visitCount} visit{business.visitCount !== 1 ? "s" : ""}</span>}
              {business.noteCount > 0 && <span>{business.noteCount} note{business.noteCount !== 1 ? "s" : ""}</span>}
              {business.lastOutcome && (
                <span className="capitalize">Last: {business.lastOutcome.replace(/_/g, " ")}</span>
              )}
            </div>
          )}
        </div>
      </Link>
      <Link
        href={`/visits/new?businessId=${business.id}`}
        className="flex-shrink-0 self-center"
        onClick={(e) => e.stopPropagation()}
      >
        <Button size="sm" variant="outline" className="h-8 gap-1.5">
          <Mic className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Log Visit</span>
          <span className="sm:hidden">Log</span>
        </Button>
      </Link>
    </div>
  );
}

function BuildingGroup({ stops, startIndex }: { stops: RouteBusiness[]; startIndex: number }) {
  return (
    <div className="border border-amber-200 dark:border-amber-800 rounded-lg overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 bg-amber-50 dark:bg-amber-950/30 border-b border-amber-200 dark:border-amber-800">
        <Building2 className="h-4 w-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
        <span className="text-xs font-semibold text-amber-800 dark:text-amber-300">
          Double-stop — {stops[0].buildingGroup}
        </span>
      </div>
      <div className="divide-y divide-border">
        {stops.map((stop, i) => (
          <div key={stop.id} className="px-3 py-1">
            <BusinessStopCard business={stop} stopNumber={startIndex + i} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DayCard({ day }: { day: DayRoute }) {
  const [bonusOpen, setBonusOpen] = useState(false);

  const primaryStops = day.stops.filter((s) => !s.isBonus);
  const bonusStops = day.stops.filter((s) => s.isBonus);

  const groupBuildings = (stops: RouteBusiness[]) => {
    const result: Array<{ key: string; stops: RouteBusiness[]; startIndex: number }> = [];
    const seen = new Map<string, number>();
    let counter = 1;

    const ungrouped: Array<{ stop: RouteBusiness; index: number }> = [];

    for (const stop of stops) {
      if (stop.buildingGroup) {
        const idx = seen.get(stop.buildingGroup);
        if (idx !== undefined) {
          result[idx].stops.push(stop);
        } else {
          seen.set(stop.buildingGroup, result.length);
          result.push({ key: stop.buildingGroup, stops: [stop], startIndex: counter });
        }
        counter++;
      } else {
        ungrouped.push({ stop, index: counter++ });
      }
    }

    return { result, ungrouped };
  };

  const { result: groups, ungrouped } = groupBuildings(primaryStops);

  const allPrimary: Array<{ type: "single"; stop: RouteBusiness; index: number } | { type: "group"; key: string; stops: RouteBusiness[]; startIndex: number }> = [];

  let stopCount = 1;
  for (const stop of primaryStops) {
    if (stop.buildingGroup) {
      const existing = allPrimary.find((item) => item.type === "group" && item.key === stop.buildingGroup);
      if (existing && existing.type === "group") {
        existing.stops.push(stop);
      } else {
        allPrimary.push({ type: "group", key: stop.buildingGroup, stops: [stop], startIndex: stopCount });
      }
    } else {
      allPrimary.push({ type: "single", stop, index: stopCount });
    }
    stopCount++;
  }

  return (
    <Card className={`border-l-4 ${DAY_COLORS[day.dayNumber] || ""}`}>
      <CardContent className="p-0">
        <div className={`px-4 pt-4 pb-3 ${DAY_BG[day.dayNumber] || ""} rounded-t-lg`}>
          <div className="flex items-start justify-between gap-2">
            <div>
              <div className="flex items-center gap-2">
                <Badge
                  variant="secondary"
                  className={`text-xs font-bold shadow-none ${DAY_BADGE_COLORS[day.dayNumber] || ""}`}
                >
                  Day {day.dayNumber}
                </Badge>
                <h2 className="text-lg font-bold">{day.areaName}</h2>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{day.neighborhoods}</p>
            </div>
            <div className="text-right text-xs text-muted-foreground">
              <div className="font-semibold">{primaryStops.length} primary</div>
              {bonusStops.length > 0 && <div>{bonusStops.length} bonus</div>}
            </div>
          </div>
        </div>

        <div className="p-4 space-y-2">
          {allPrimary.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-4">No primary stops yet</p>
          )}
          {allPrimary.map((item) =>
            item.type === "group" ? (
              <BuildingGroup key={item.key} stops={item.stops} startIndex={item.startIndex} />
            ) : (
              <BusinessStopCard key={item.stop.id} business={item.stop} stopNumber={item.index} />
            )
          )}
        </div>

        {bonusStops.length > 0 && (
          <div className="border-t border-border">
            <button
              onClick={() => setBonusOpen((o) => !o)}
              className="flex items-center justify-between w-full px-4 py-3 text-sm font-medium text-muted-foreground hover:text-foreground hover:bg-muted/30 transition-colors"
            >
              <span>Bonus Stops ({bonusStops.length})</span>
              {bonusOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
            </button>
            {bonusOpen && (
              <div className="px-4 pb-4 space-y-2">
                {bonusStops.map((stop, i) => {
                  if (stop.buildingGroup) {
                    const groupStops = bonusStops.filter((s) => s.buildingGroup === stop.buildingGroup);
                    if (groupStops[0].id === stop.id) {
                      return <BuildingGroup key={stop.buildingGroup} stops={groupStops} startIndex={primaryStops.length + bonusStops.indexOf(stop) + 1} />;
                    }
                    return null;
                  }
                  return <BusinessStopCard key={stop.id} business={stop} stopNumber={primaryStops.length + i + 1} />;
                })}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function RoutesPage() {
  const { data: days, isLoading } = useGetRoutesByDay({ query: { queryKey: getGetRoutesByDayQueryKey() } });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Route className="h-6 w-6" />
          Route Plan
        </h1>
        <p className="text-sm text-muted-foreground mt-1">4-day field prospecting route with geographic clustering.</p>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse h-48" />
          ))}
        </div>
      ) : (
        <div className="space-y-6">
          {days?.map((day) => (
            <DayCard key={day.dayNumber} day={day} />
          ))}
        </div>
      )}
    </div>
  );
}
