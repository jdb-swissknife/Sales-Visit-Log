import { Link, useLocation } from "wouter";
import { UserButton } from "@clerk/react";
import { Briefcase, LayoutDashboard, MapPin, Route, MessageSquare, Phone, Map as MapIcon, CloudOff, RefreshCw, CalendarCheck } from "lucide-react";
import { useGetPipelineStats, getGetPipelineStatsQueryKey } from "@workspace/api-client-react";
import { useOfflineQueue } from "@/hooks/use-offline-queue";
import { CoachingFeed } from "@/components/coaching-feed";

function OfflineStatusBadge() {
  const { isOnline, queuedCount, isSyncing, syncNow } = useOfflineQueue();

  if (isOnline && queuedCount === 0 && !isSyncing) return null;

  if (!isOnline) {
    return (
      <div className="flex items-center gap-1.5 rounded-full bg-amber-500/15 px-3 py-1 text-xs font-medium text-amber-600 dark:text-amber-400">
        <CloudOff className="h-3.5 w-3.5" />
        Offline{queuedCount > 0 ? ` · ${queuedCount} queued` : ""}
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void syncNow()}
      disabled={isSyncing}
      className="flex items-center gap-1.5 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary"
    >
      <RefreshCw className={`h-3.5 w-3.5 ${isSyncing ? "animate-spin" : ""}`} />
      {isSyncing ? "Syncing..." : `Sync ${queuedCount} visit${queuedCount === 1 ? "" : "s"}`}
    </button>
  );
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navItems = [
    { href: "/", label: "Map", icon: MapIcon },
    { href: "/followups", label: "Follow-ups", icon: CalendarCheck },
    { href: "/dashboard", label: "Overview", icon: LayoutDashboard },
    { href: "/businesses", label: "Directory", icon: Briefcase },
    { href: "/visits", label: "Field Notes", icon: MapPin },
    { href: "/routes", label: "Routes", icon: Route },
    { href: "/script", label: "Script", icon: MessageSquare },
    { href: "/coldcall", label: "Cold Call", icon: Phone },
  ];

  // Bottom nav fits 5 items comfortably on a phone. Follow-ups replaces Routes
  // here: the queue is what a rep opens first each morning; Routes stays in the
  // desktop sidebar.
  const mobileNavItems = navItems.filter((i) =>
    ["/", "/followups", "/businesses", "/visits", "/dashboard"].includes(i.href)
  );

  // Badge count for the Follow-ups nav item (overdue + due today).
  const { data: pipeline } = useGetPipelineStats({
    query: { queryKey: getGetPipelineStatsQueryKey(), staleTime: 60_000, refetchInterval: 5 * 60_000 },
  });
  const dueCount = pipeline?.followUpsDue ?? 0;

  const isFullBleed = location === "/";

  return (
    <div className="flex flex-col h-screen supports-[height:100dvh]:h-[100dvh] bg-background text-foreground">
      {/* Top App Bar */}
      <header className="sticky top-0 z-10 flex h-14 items-center justify-between border-b border-border bg-card px-4 shadow-sm">
        <div className="flex items-center gap-2 font-semibold text-primary">
          <MapPin className="h-5 w-5" />
          <span>OutreachLog</span>
        </div>
        <div className="flex items-center gap-3">
          <OfflineStatusBadge />
          <CoachingFeed />
          <UserButton
            appearance={{
              elements: {
                avatarBox: "h-8 w-8",
              },
            }}
          />
        </div>
      </header>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Desktop Sidebar */}
        <aside className="hidden w-64 flex-col border-r border-border bg-card md:flex">
          <nav className="flex-1 space-y-1 p-4">
            {navItems.map((item) => {
              const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                    isActive
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-muted hover:text-foreground"
                  }`}
                >
                  <item.icon className="h-4 w-4" />
                  {item.label}
                  {item.href === "/followups" && dueCount > 0 && (
                    <span className={`ml-auto rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums ${isActive ? "bg-primary-foreground/20" : "bg-amber-500 text-white"}`}>
                      {dueCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>
        </aside>

        {/* Main Content */}
        <main
          className={
            isFullBleed
              ? "flex flex-1 flex-col min-h-0 pb-16 md:pb-0"
              : "flex-1 min-h-0 overflow-y-auto pb-16 md:pb-0"
          }
        >
          {isFullBleed ? (
            children
          ) : (
            <div className="mx-auto max-w-5xl p-4 md:p-6 lg:p-8">{children}</div>
          )}
        </main>
      </div>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 z-10 flex h-16 border-t border-border bg-card md:hidden">
        {mobileNavItems.map((item) => {
          const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex flex-1 flex-col items-center justify-center gap-1 text-[10px] font-medium ${
                isActive ? "text-primary" : "text-muted-foreground"
              }`}
            >
              <span className="relative">
                <item.icon className="h-5 w-5" />
                {item.href === "/followups" && dueCount > 0 && (
                  <span className="absolute -right-2 -top-1.5 min-w-[16px] rounded-full bg-amber-500 px-1 text-center text-[9px] font-semibold leading-4 text-white">
                    {dueCount > 99 ? "99+" : dueCount}
                  </span>
                )}
              </span>
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
