import {
  useGetPipelineStats,
  getGetPipelineStatsQueryKey,
  useGetRecentActivity,
  getGetRecentActivityQueryKey,
  useGetVisitsBySector,
  getGetVisitsBySectorQueryKey,
  type PipelineStats,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { format, parseISO } from "date-fns";
import { Link } from "wouter";
import {
  MapPin,
  Activity,
  PieChart,
  Trophy,
  Wallet,
  Target,
  CalendarCheck,
  Snowflake,
  Footprints,
  Users,
  Filter,
  ArrowRight,
  Timer,
} from "lucide-react";
import { PIPELINE_STAGES, STAGE_LABELS, STAGE_FILL, isPipelineStage, formatMoney, formatPercent } from "@/lib/pipeline";

function Stat({
  label,
  value,
  sub,
  icon: Icon,
  tone = "text-muted-foreground",
  href,
}: {
  label: string;
  value: string | number;
  sub?: string;
  icon: typeof Trophy;
  tone?: string;
  href?: string;
}) {
  const body = (
    <Card className={href ? "transition-colors hover:border-primary/50" : ""}>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-xs font-medium">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone}`} />
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-bold tabular-nums">{value}</div>
        {sub && <p className="text-[11px] text-muted-foreground mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  );
  return href ? <Link href={href}>{body}</Link> : body;
}

function Funnel({ stats }: { stats: PipelineStats }) {
  const open = stats.funnel.filter((s) => isPipelineStage(s.status) && s.status !== "converted" && s.status !== "not_interested");
  const max = Math.max(1, ...open.map((s) => s.count));
  const won = stats.funnel.find((s) => s.status === "converted");
  const lost = stats.funnel.find((s) => s.status === "not_interested");

  return (
    <div className="space-y-3">
      {open.map((stage) => {
        const status = stage.status as (typeof PIPELINE_STAGES)[number];
        return (
          <div key={stage.status} className="flex items-center gap-3">
            <div className="w-[110px] shrink-0 text-sm font-medium">{STAGE_LABELS[status]}</div>
            <div className="flex-1 flex items-center gap-2">
              <div className="h-2.5 flex-1 rounded-full bg-muted overflow-hidden">
                <div className={`h-full rounded-full ${STAGE_FILL[status]}`} style={{ width: `${Math.max(3, (stage.count / max) * 100)}%` }} />
              </div>
              <span className="w-8 text-right text-xs tabular-nums text-muted-foreground">{stage.count}</span>
            </div>
            <div className="hidden sm:block w-20 text-right text-xs tabular-nums text-muted-foreground">
              {stage.dealValue > 0 ? formatMoney(stage.dealValue) : ""}
            </div>
          </div>
        );
      })}
      <div className="flex items-center gap-4 border-t border-border pt-3 text-xs">
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${STAGE_FILL.converted}`} />
          Won <strong className="tabular-nums">{won?.count ?? 0}</strong>
          {won && won.dealValue > 0 && <span className="text-muted-foreground">({formatMoney(won.dealValue)})</span>}
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`inline-block h-2.5 w-2.5 rounded-full ${STAGE_FILL.not_interested}`} />
          Lost <strong className="tabular-nums">{lost?.count ?? 0}</strong>
        </span>
        <span className="ml-auto text-muted-foreground">
          Win rate <strong className="text-foreground">{formatPercent(stats.winRate)}</strong>
        </span>
      </div>
    </div>
  );
}

function Leaderboard({ rows }: { rows: PipelineStats["leaderboard"] }) {
  if (rows.length === 0) {
    return <div className="py-6 text-center text-sm text-muted-foreground">No rep activity this month yet.</div>;
  }
  return (
    <div className="overflow-x-auto -mx-2">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-[11px] uppercase tracking-wider text-muted-foreground">
            <th className="px-2 py-1 text-left font-medium">Rep</th>
            <th className="px-2 py-1 text-right font-medium">Won</th>
            <th className="px-2 py-1 text-right font-medium hidden sm:table-cell">Won $</th>
            <th className="px-2 py-1 text-right font-medium">Visits wk</th>
            <th className="px-2 py-1 text-right font-medium hidden sm:table-cell">Visits mo</th>
            <th className="px-2 py-1 text-right font-medium">Due</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={r.repId} className="border-t border-border">
              <td className="px-2 py-1.5 font-medium truncate max-w-[160px]">
                {i === 0 && r.wonThisMonth > 0 ? "🏆 " : ""}
                {r.repId}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.wonThisMonth}</td>
              <td className="px-2 py-1.5 text-right tabular-nums hidden sm:table-cell">{r.wonValueThisMonth > 0 ? formatMoney(r.wonValueThisMonth) : "—"}</td>
              <td className="px-2 py-1.5 text-right tabular-nums">{r.visitsThisWeek}</td>
              <td className="px-2 py-1.5 text-right tabular-nums hidden sm:table-cell">{r.visitsThisMonth}</td>
              <td className={`px-2 py-1.5 text-right tabular-nums ${r.openFollowUps > 0 ? "text-amber-600 dark:text-amber-400 font-medium" : ""}`}>
                {r.openFollowUps}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Dashboard() {
  const { data: stats, isLoading: statsLoading } = useGetPipelineStats({ query: { queryKey: getGetPipelineStatsQueryKey() } });
  const { data: activity, isLoading: activityLoading } = useGetRecentActivity({ query: { queryKey: getGetRecentActivityQueryKey() } });
  const { data: sectorCounts, isLoading: sectorsLoading } = useGetVisitsBySector({ query: { queryKey: getGetVisitsBySectorQueryKey() } });

  const isLoading = statsLoading || activityLoading || sectorsLoading;

  if (isLoading || !stats) {
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

  const totalVisits = sectorCounts?.reduce((n, s) => n + s.count, 0) ?? 0;
  const showLeaderboard = stats.leaderboard.length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
          <p className="text-sm text-muted-foreground">Where the pipeline stands and what needs doing.</p>
        </div>
        {stats.followUpsDue > 0 && (
          <Button asChild>
            <Link href="/followups">
              <CalendarCheck className="mr-2 h-4 w-4" />
              {stats.followUpsDue} follow-up{stats.followUpsDue === 1 ? "" : "s"} due
              <ArrowRight className="ml-2 h-4 w-4" />
            </Link>
          </Button>
        )}
      </div>

      {/* Closing */}
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
        <Stat
          label="Won this month"
          value={stats.wonThisMonth}
          sub={stats.wonValueThisMonth > 0 ? formatMoney(stats.wonValueThisMonth) : `${stats.wonCount} all-time`}
          icon={Trophy}
          tone="text-green-500"
        />
        <Stat
          label="Open pipeline"
          value={formatMoney(stats.openPipelineValue)}
          sub={`${formatMoney(stats.weightedPipelineValue)} weighted`}
          icon={Wallet}
          tone="text-primary"
        />
        <Stat
          label="Win rate"
          value={formatPercent(stats.winRate)}
          sub={stats.avgDaysToClose != null ? `${Math.round(stats.avgDaysToClose)}d avg to close` : "no closed deals yet"}
          icon={Target}
          tone="text-violet-500"
        />
        <Stat
          label="Follow-ups due"
          value={stats.followUpsDue}
          sub={stats.staleLeads > 0 ? `${stats.staleLeads} going cold` : "nothing going cold"}
          icon={stats.followUpsDue > 0 ? CalendarCheck : Snowflake}
          tone={stats.followUpsDue > 0 ? "text-amber-500" : "text-muted-foreground"}
          href="/followups"
        />
      </div>

      {/* Activity */}
      <div className="grid grid-cols-3 gap-4">
        <Stat label="Visits today" value={stats.visitsToday} icon={Footprints} />
        <Stat label="Visits this week" value={stats.visitsThisWeek} icon={Activity} />
        <Stat label="Contact rate" value={formatPercent(stats.contactRate)} sub="got a name, last 7d" icon={Users} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Filter className="h-4 w-4" />
              Pipeline
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Funnel stats={stats} />
          </CardContent>
        </Card>

        {showLeaderboard ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Trophy className="h-4 w-4" />
                Team this month
              </CardTitle>
            </CardHeader>
            <CardContent>
              <Leaderboard rows={stats.leaderboard} />
            </CardContent>
          </Card>
        ) : (
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
                          <div className="h-full bg-primary" style={{ width: `${Math.max(10, (sector.count / (totalVisits || 1)) * 100)}%` }} />
                        </div>
                        <span className="text-xs text-muted-foreground w-8 text-right">{sector.count}</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-center text-sm text-muted-foreground py-8">No data available.</div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold flex items-center gap-2">
            <Timer className="h-4 w-4" />
            Recent Activity
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activity && activity.length > 0 ? (
            <div className="space-y-2">
              {activity.slice(0, 6).map((item) => (
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
                  <div className="text-xs font-medium capitalize text-muted-foreground">{item.outcome.replace(/_/g, " ")}</div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-8">No recent activity. Get out there!</div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
