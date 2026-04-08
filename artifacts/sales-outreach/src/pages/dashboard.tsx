import { useGetSummaryStats, useGetRecentActivity, useGetVisitsBySector, getGetSummaryStatsQueryKey, getGetRecentActivityQueryKey, getGetVisitsBySectorQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { format, parseISO } from "date-fns";
import { MapPin, Briefcase, Activity, CheckCircle2, AlertCircle, Clock, CalendarDays, PieChart } from "lucide-react";
import { Link } from "wouter";

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetSummaryStats({ query: { queryKey: getGetSummaryStatsQueryKey() } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: sectorCounts, isLoading: sectorsLoading } = useGetVisitsBySector({ query: { queryKey: getGetVisitsBySectorQueryKey() } });

  const isLoading = statsLoading || activityLoading || sectorsLoading;

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          {[1, 2, 3, 4].map((i) => (
            <Card key={i} className="animate-pulse">
              <CardHeader className="h-10 pb-2" />
              <CardContent className="h-10" />
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-sm text-muted-foreground">Summary of your field activity.</p>
      </div>

      {stats && (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Total Businesses</CardTitle>
              <Briefcase className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.totalBusinesses}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Visits This Week</CardTitle>
              <CalendarDays className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.visitsThisWeek}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Conversions</CardTitle>
              <CheckCircle2 className="h-4 w-4 text-primary" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.convertedCount}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-xs font-medium">Follow-ups</CardTitle>
              <Clock className="h-4 w-4 text-accent" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.followUpsNeeded}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            {activity && activity.length > 0 ? (
              <div className="space-y-4">
                {activity.slice(0, 5).map((item) => (
                  <Link href={`/visits/${item.visitId}`} key={item.visitId} className="flex items-start gap-4 rounded-md p-2 transition-colors hover:bg-muted">
                    <div className="mt-1 rounded-full bg-primary/10 p-2 text-primary">
                      <MapPin className="h-4 w-4" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <p className="text-sm font-medium leading-none">{item.businessName}</p>
                      <p className="text-xs text-muted-foreground">
                        {format(parseISO(item.visitedAt), "MMM d, h:mm a")} • {item.sector}
                      </p>
                    </div>
                    <div className="text-xs font-medium capitalize text-muted-foreground">
                      {item.outcome.replace(/_/g, " ")}
                    </div>
                  </Link>
                ))}
              </div>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-8">
                No recent activity. Get out there!
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <PieChart className="h-4 w-4" />
              Visits by Sector
            </CardTitle>
          </CardHeader>
          <CardContent>
            {sectorCounts && sectorCounts.length > 0 ? (
              <div className="space-y-4">
                {sectorCounts.map((sector) => (
                  <div key={sector.sector} className="flex items-center">
                    <div className="w-[120px] text-sm font-medium">{sector.sector}</div>
                    <div className="flex-1 flex items-center gap-2">
                      <div className="h-2 flex-1 rounded-full bg-muted overflow-hidden">
                        <div 
                          className="h-full bg-primary" 
                          style={{ width: `${Math.max(10, (sector.count / (stats?.totalVisits || 1)) * 100)}%` }} 
                        />
                      </div>
                      <span className="text-xs text-muted-foreground w-8 text-right">{sector.count}</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center text-sm text-muted-foreground py-8">
                No data available.
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
