import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListBusinesses,
  useUpdateBusiness,
  getListBusinessesQueryKey,
  type Business,
} from "@workspace/api-client-react";
import {
  Phone,
  Globe,
  Star,
  Search,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  CalendarClock,
  XCircle,
  PhoneCall,
} from "lucide-react";
import { Input } from "@/components/ui/input";

const INDUSTRIES = [
  "All",
  "HVAC",
  "ELECTRICAL",
  "PLUMBING",
  "ROOFING",
  "SOLAR",
  "GARAGE DOORS",
  "PAINTING",
  "LANDSCAPING",
  "FENCING/DECKS",
  "WINDOWS",
  "RESTORATION",
  "PEST CONTROL",
  "GENERAL CONTRACTOR",
  "CONCRETE",
  "FLOORING",
];

const INDUSTRY_COLORS: Record<string, string> = {
  HVAC: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  ELECTRICAL: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
  PLUMBING: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  ROOFING: "bg-orange-500/10 text-orange-400 border-orange-500/20",
  SOLAR: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  "GARAGE DOORS": "bg-stone-500/10 text-stone-400 border-stone-500/20",
  PAINTING: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  LANDSCAPING: "bg-green-500/10 text-green-400 border-green-500/20",
  "FENCING/DECKS": "bg-lime-500/10 text-lime-400 border-lime-500/20",
  WINDOWS: "bg-sky-500/10 text-sky-400 border-sky-500/20",
  RESTORATION: "bg-teal-500/10 text-teal-400 border-teal-500/20",
  "PEST CONTROL": "bg-red-500/10 text-red-400 border-red-500/20",
  "GENERAL CONTRACTOR": "bg-slate-500/10 text-slate-400 border-slate-500/20",
  CONCRETE: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  FLOORING: "bg-rose-500/10 text-rose-400 border-rose-500/20",
};

type StatusValue = "not_contacted" | "contacted" | "follow_up" | "converted" | "not_interested";

const STATUS_BUTTONS: Array<{
  value: Exclude<StatusValue, "not_contacted">;
  label: string;
  icon: typeof PhoneCall;
  activeClass: string;
  idleClass: string;
}> = [
  {
    value: "contacted",
    label: "Called",
    icon: PhoneCall,
    activeClass: "bg-blue-500 border-blue-500 text-white",
    idleClass: "border-border text-muted-foreground hover:border-blue-500/50 hover:text-blue-400",
  },
  {
    value: "converted",
    label: "Interested",
    icon: CheckCircle2,
    activeClass: "bg-green-500 border-green-500 text-white",
    idleClass: "border-border text-muted-foreground hover:border-green-500/50 hover:text-green-400",
  },
  {
    value: "follow_up",
    label: "Follow-up",
    icon: CalendarClock,
    activeClass: "bg-amber-500 border-amber-500 text-white",
    idleClass: "border-border text-muted-foreground hover:border-amber-500/50 hover:text-amber-400",
  },
  {
    value: "not_interested",
    label: "No",
    icon: XCircle,
    activeClass: "bg-red-500 border-red-500 text-white",
    idleClass: "border-border text-muted-foreground hover:border-red-500/50 hover:text-red-400",
  },
];

function formatReviews(n: number | undefined): string {
  if (!n) return "0";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return String(n);
}

function ScriptPanel() {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 overflow-hidden">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-3 text-left"
      >
        <span className="font-semibold text-sm text-primary">Cold Call Script</span>
        {open ? <ChevronUp className="h-4 w-4 text-primary" /> : <ChevronDown className="h-4 w-4 text-primary" />}
      </button>
      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-primary/20">
          <div className="rounded-lg bg-card border border-border p-4 mt-3">
            <p className="text-xs text-muted-foreground font-semibold uppercase tracking-wider mb-2">Opening</p>
            <p className="text-sm text-foreground leading-relaxed">
              "Hey [Owner Name], this is [Your Name]. I help service businesses like yours automate their phone calls, scheduling, and follow-ups using AI. I noticed you guys have a great reputation — [reference reviews] — and I had a couple ideas that could save your team 10–15 hours a week. Do you have 2 minutes?"
            </p>
          </div>
          <div className="grid sm:grid-cols-3 gap-3">
            <div className="rounded-lg bg-green-500/10 border border-green-500/20 p-3">
              <p className="text-xs font-bold text-green-400 uppercase tracking-wider mb-1.5">If yes →</p>
              <p className="text-xs text-foreground leading-relaxed">Show the 2-min demo: <span className="text-green-400 font-medium">daily-brief-live.base44.app</span></p>
            </div>
            <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 p-3">
              <p className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-1.5">If no / not interested →</p>
              <p className="text-xs text-foreground leading-relaxed">"No worries. Can I send you a quick email with a 2-minute video? You can check it out when it's convenient." → Get email.</p>
            </div>
            <div className="rounded-lg bg-muted border border-border p-3">
              <p className="text-xs font-bold text-muted-foreground uppercase tracking-wider mb-1.5">If gatekeeper / voicemail →</p>
              <p className="text-xs text-foreground leading-relaxed">"Hey, this is [Name] calling for [Owner Name] about AI automation tools that could help with [company]'s scheduling and follow-ups. I'll try back at a better time. My number is [number]."</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusButtons({
  business,
  onChange,
  disabled,
}: {
  business: Business;
  onChange: (status: StatusValue) => void;
  disabled: boolean;
}) {
  const currentStatus = business.status as StatusValue;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {STATUS_BUTTONS.map(({ value, label, icon: Icon, activeClass, idleClass }) => {
        const isActive = currentStatus === value;
        return (
          <button
            key={value}
            type="button"
            disabled={disabled}
            onClick={() => onChange(isActive ? "not_contacted" : value)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-[11px] font-semibold transition-colors disabled:opacity-60 disabled:cursor-not-allowed ${
              isActive ? activeClass : `bg-background ${idleClass}`
            }`}
            title={isActive ? `Clear "${label}"` : `Mark as ${label}`}
          >
            <Icon className="h-3 w-3" />
            {label}
          </button>
        );
      })}
    </div>
  );
}

export default function ColdCallPage() {
  const [search, setSearch] = useState("");
  const [industry, setIndustry] = useState("All");
  const [pendingIds, setPendingIds] = useState<Set<number>>(new Set());

  const queryParams = { callType: "cold_call" as const };
  const queryKey = getListBusinessesQueryKey(queryParams);
  const queryClient = useQueryClient();
  const { data: businesses, isLoading } = useListBusinesses(queryParams, {
    query: { queryKey },
  });
  const updateBusiness = useUpdateBusiness({
    mutation: {
      onMutate: async ({ id, data }) => {
        await queryClient.cancelQueries({ queryKey });
        const prev = queryClient.getQueryData<Business[]>(queryKey);
        if (prev && data.status) {
          queryClient.setQueryData<Business[]>(
            queryKey,
            prev.map((b) => (b.id === id ? ({ ...b, status: data.status } as Business) : b))
          );
        }
        return { prev };
      },
      onError: (_err, _vars, ctx) => {
        const context = ctx as { prev?: Business[] } | undefined;
        if (context?.prev) queryClient.setQueryData(queryKey, context.prev);
      },
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey });
      },
    },
  });

  const list = businesses ?? [];
  const filtered = list.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.sector.toLowerCase().includes(search.toLowerCase());
    const matchesIndustry = industry === "All" || c.sector === industry;
    return matchesSearch && matchesIndustry;
  });

  const totalCount = list.length;

  function handleStatus(business: Business, status: StatusValue) {
    setPendingIds((s) => {
      const next = new Set(s);
      next.add(business.id);
      return next;
    });
    updateBusiness.mutate(
      {
        id: business.id,
        data: {
          name: business.name,
          sector: business.sector,
          status,
        },
      },
      {
        onSettled: () => {
          setPendingIds((s) => {
            const next = new Set(s);
            next.delete(business.id);
            return next;
          });
        },
      }
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Phone className="h-6 w-6 text-primary" />
          Cold Call List
        </h1>
        <p className="text-muted-foreground mt-1">
          {totalCount} mid-size service businesses · Tap a status to log progress
        </p>
      </div>

      {/* Script panel */}
      <ScriptPanel />

      {/* Filters */}
      <div className="space-y-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search by name or sector..."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {INDUSTRIES.map((ind) => (
            <button
              key={ind}
              onClick={() => setIndustry(ind)}
              className={`shrink-0 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                industry === ind
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background text-muted-foreground border-border hover:border-foreground hover:text-foreground"
              }`}
            >
              {ind}
            </button>
          ))}
        </div>
      </div>

      {/* Count */}
      <p className="text-xs text-muted-foreground">
        Showing {filtered.length} of {totalCount}
      </p>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-muted-foreground">Loading...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground bg-muted/30 rounded-lg border border-dashed border-border">
          No companies match your search.
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((company, idx) => {
            const reviews = company.reviewCount ?? 0;
            const rating = company.rating ?? 0;
            const phone = company.phone ?? "";
            const website = company.website ?? "";
            const isContacted = (company.status as StatusValue) !== "not_contacted";
            return (
              <div
                key={company.id}
                className={`rounded-xl border bg-card p-4 space-y-3 transition-colors ${
                  isContacted ? "border-primary/30" : "border-border"
                }`}
              >
                {/* Top row: name + sector + rating */}
                <div className="flex items-start gap-2 flex-wrap">
                  <span className="text-xs text-muted-foreground font-mono mt-0.5 shrink-0">
                    #{idx + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold text-foreground leading-snug">{company.name}</p>
                    <div className="flex items-center gap-2 mt-1 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-md text-[10px] font-semibold border ${
                          INDUSTRY_COLORS[company.sector] ?? "bg-muted text-muted-foreground border-border"
                        }`}
                      >
                        {company.sector}
                      </span>
                      {rating > 0 && (
                        <span className="flex items-center gap-0.5 text-xs text-amber-400 font-semibold">
                          <Star className="h-3 w-3 fill-amber-400" />
                          {rating}
                          <span className="text-muted-foreground font-normal ml-0.5">
                            ({formatReviews(reviews)})
                          </span>
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Contact actions */}
                <div className="flex flex-wrap items-center gap-2">
                  {phone && (
                    <a
                      href={`tel:${phone}`}
                      className="flex items-center gap-1.5 rounded-lg bg-primary/10 border border-primary/20 hover:bg-primary/20 px-3 py-2 text-sm font-semibold text-primary transition-colors"
                      title={phone}
                    >
                      <Phone className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline">{phone}</span>
                      <span className="sm:hidden">Call</span>
                    </a>
                  )}
                  {website && (
                    <a
                      href={website.startsWith("http") ? website : `https://${website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex items-center gap-1.5 rounded-lg bg-muted hover:bg-muted/80 border border-border px-3 py-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
                      title={website}
                    >
                      <Globe className="h-3.5 w-3.5" />
                      <span className="hidden sm:inline truncate max-w-[160px]">{website}</span>
                    </a>
                  )}
                </div>

                {/* Status tick buttons */}
                <div className="pt-2 border-t border-border/60">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1.5 font-semibold">
                    Status
                  </p>
                  <StatusButtons
                    business={company}
                    onChange={(s) => handleStatus(company, s)}
                    disabled={pendingIds.has(company.id)}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
