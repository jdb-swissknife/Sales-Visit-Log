import { useEffect, useMemo, useRef, useState } from "react";
import maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  useListBusinesses,
  useCreateVisit,
  useCreateNote,
  useUpdateBusiness,
  getListBusinessesQueryKey,
  getListVisitsQueryKey,
} from "@workspace/api-client-react";
import type { Business } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { CheckCircle2, PhoneMissed, CalendarClock, XCircle, MapPin, Navigation } from "lucide-react";

const STATUS_COLORS: Record<string, string> = {
  not_contacted: "#64748b", // slate
  contacted: "#3b82f6", // blue
  follow_up: "#f59e0b", // amber
  converted: "#22c55e", // green
  not_interested: "#ef4444", // red
};

const STATUS_LABELS: Record<string, string> = {
  not_contacted: "Not contacted",
  contacted: "Contacted",
  follow_up: "Follow up",
  converted: "Converted",
  not_interested: "Not interested",
};

interface OutcomeOption {
  key: string;
  label: string;
  icon: typeof CheckCircle2;
  visitOutcome: "positive" | "neutral" | "negative" | "follow_up_needed";
  businessStatus: "contacted" | "follow_up" | "converted" | "not_interested";
  color: string;
}

const OUTCOMES: OutcomeOption[] = [
  { key: "sale", label: "Sale", icon: CheckCircle2, visitOutcome: "positive", businessStatus: "converted", color: "border-green-500 data-[selected=true]:bg-green-500" },
  { key: "callback", label: "Callback", icon: CalendarClock, visitOutcome: "follow_up_needed", businessStatus: "follow_up", color: "border-amber-500 data-[selected=true]:bg-amber-500" },
  { key: "no_answer", label: "No answer", icon: PhoneMissed, visitOutcome: "neutral", businessStatus: "contacted", color: "border-blue-500 data-[selected=true]:bg-blue-500" },
  { key: "not_interested", label: "Not interested", icon: XCircle, visitOutcome: "negative", businessStatus: "not_interested", color: "border-red-500 data-[selected=true]:bg-red-500" },
];

const CALLBACK_PRESETS = [
  { label: "Tomorrow", days: 1 },
  { label: "In 3 days", days: 3 },
  { label: "Next week", days: 7 },
];

const MINNEAPOLIS: [number, number] = [-93.2650, 44.9778];

export default function MapPage() {
  const rootRef = useRef<HTMLDivElement>(null);
  const mapContainer = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const loadedRef = useRef(false);
  const tileErrRef = useRef(0);
  const [mapError, setMapError] = useState(false);
  const [diag, setDiag] = useState("init…");

  const { data: businesses } = useListBusinesses();
  const [selected, setSelected] = useState<Business | null>(null);
  const [outcome, setOutcome] = useState<OutcomeOption | null>(null);
  const [callbackDays, setCallbackDays] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const createVisit = useCreateVisit();
  const createNote = useCreateNote();
  const updateBusiness = useUpdateBusiness();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const located = useMemo(
    () => (businesses ?? []).filter((b) => b.latitude != null && b.longitude != null),
    [businesses]
  );
  const unlocatedCount = (businesses?.length ?? 0) - located.length;

  // Init map once
  useEffect(() => {
    if (!mapContainer.current || mapRef.current) return;

    const size = () => {
      const el = mapContainer.current;
      return el ? `${Math.round(el.clientWidth)}x${Math.round(el.clientHeight)}` : "0x0";
    };
    setDiag(`init dpr=${window.devicePixelRatio} ${size()}`);

    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: mapContainer.current,
        style: "https://tiles.openfreemap.org/styles/liberty",
        center: MINNEAPOLIS,
        zoom: 12,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // WebGL unavailable (older devices, hardware acceleration off, etc.).
      // Surface a fallback instead of crashing the whole page.
      console.error("Map init failed", err);
      setDiag(`WebGL init threw: ${err instanceof Error ? err.message : String(err)}`);
      setMapError(true);
      return;
    }

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const geolocate = new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
    });
    map.addControl(geolocate, "top-right");

    loadedRef.current = false;
    tileErrRef.current = 0;

    // If the map never finishes loading (style/tiles blocked, stalled WebGL),
    // fall back to the usable list instead of leaving a blank canvas forever.
    const loadTimeout = window.setTimeout(() => {
      if (!mapRef.current || loadedRef.current) return;
      console.error("Map load timed out — showing fallback");
      setMapError(true);
    }, 8000);

    const hardenResize = () => {
      // Container can size after mount (dvh on mobile, layout settling),
      // which otherwise leaves MapLibre with a 0-size blank canvas. Resize a
      // few times to defeat layout races.
      map.resize();
      requestAnimationFrame(() => map.resize());
      window.setTimeout(() => map.resize(), 200);
      window.setTimeout(() => map.resize(), 600);
    };

    map.on("load", () => {
      loadedRef.current = true;
      window.clearTimeout(loadTimeout);
      hardenResize();
      try {
        geolocate.trigger();
      } catch {
        /* geolocation optional */
      }
    });

    map.on("error", (e) => {
      const msg = (e?.error as Error)?.message ?? String(e?.error ?? e);
      // Tile/source fetch failures (blocked network, ad blocker, provider down)
      // leave the base map blank even though "load" may fire from the style.
      if (/tile|source|fetch|network|load|403|429|500/i.test(msg)) tileErrRef.current += 1;
      console.error("Map error", e?.error ?? e);
      // If tiles keep failing, the canvas is unusable — show the list instead.
      if (tileErrRef.current >= 4) setMapError(true);
    });

    mapRef.current = map;

    // Keep the canvas in sync with container size changes.
    const ro = new ResizeObserver(() => map.resize());
    ro.observe(mapContainer.current);

    return () => {
      window.clearTimeout(loadTimeout);
      ro.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // LIVE diagnostic: walk the DOM height chain so we can see exactly which
  // ancestor collapses to 0px on the user's webview.
  useEffect(() => {
    const id = window.setInterval(() => {
      const el = rootRef.current;
      if (!el) return;
      const h = (n: Element | null | undefined) =>
        n ? Math.round((n as HTMLElement).clientHeight) : "—";
      const main = el.parentElement; // <main>
      const row = main?.parentElement; // content row
      const shell = row?.parentElement; // app shell root
      setDiag(
        `win=${window.innerHeight} doc=${document.documentElement.clientHeight} ` +
          `body=${h(document.body)} shell=${h(shell)} row=${h(row)} ` +
          `main=${h(main)} root=${h(el)} inner=${h(mapContainer.current)} | ` +
          `${loadedRef.current ? "loaded" : "loading"} tileErr=${tileErrRef.current}`
      );
    }, 500);
    return () => window.clearInterval(id);
  }, []);

  // Sync markers with data
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = located.map((b) => {
      const el = document.createElement("div");
      el.style.cssText = [
        "width:22px;height:22px;border-radius:50% 50% 50% 0;",
        "transform:rotate(-45deg);cursor:pointer;",
        `background:${STATUS_COLORS[b.status] ?? "#64748b"};`,
        "border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4);",
      ].join("");
      el.addEventListener("click", (e) => {
        e.stopPropagation();
        setSelected(b);
        setOutcome(null);
        setCallbackDays(null);
        setNote("");
      });
      return new maplibregl.Marker({ element: el, anchor: "bottom" })
        .setLngLat([b.longitude!, b.latitude!])
        .addTo(map);
    });
  }, [located]);

  // Fit to pins on first data load
  const fittedRef = useRef(false);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || fittedRef.current || located.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    located.forEach((b) => bounds.extend([b.longitude!, b.latitude!]));
    map.fitBounds(bounds, { padding: 60, maxZoom: 14 });
    fittedRef.current = true;
  }, [located]);

  async function handleSave() {
    if (!selected || !outcome) return;
    setSaving(true);
    try {
      const nextActionDate =
        outcome.key === "callback" && callbackDays != null
          ? new Date(Date.now() + callbackDays * 86_400_000).toISOString()
          : undefined;

      const visit = await createVisit.mutateAsync({
        data: {
          businessId: selected.id,
          visitedAt: new Date().toISOString(),
          outcome: outcome.visitOutcome,
          ...(nextActionDate ? { nextActionDate } : {}),
        },
      });

      if (note.trim()) {
        await createNote.mutateAsync({ id: visit.id, data: { type: "text", content: note.trim() } });
      }

      await updateBusiness.mutateAsync({
        id: selected.id,
        data: { name: selected.name, sector: selected.sector, status: outcome.businessStatus },
      });

      queryClient.invalidateQueries({ queryKey: getListBusinessesQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListVisitsQueryKey() });
      toast({ title: `Visit logged — ${outcome.label}` });
      setSelected(null);
    } catch {
      toast({ title: "Failed to log visit", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div ref={rootRef} className="relative flex flex-col grow min-h-0 w-full">
      <div ref={mapContainer} className="grow min-h-0 w-full" />

      {/* TEMP diagnostic — read this back to debug the blank map */}
      <div className="absolute left-2 top-2 z-30 max-w-[92%] rounded bg-black/80 px-2 py-1 font-mono text-[11px] leading-tight text-green-300">
        {diag}
      </div>

      {/* Fallback when the map (WebGL) can't render on this device */}
      {mapError && (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-background p-4">
          <div className="mx-auto max-w-md space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <MapPin className="h-4 w-4 shrink-0 text-primary" />
              Map can't render on this device — showing your located businesses as a list.
            </div>
            {located.map((b) => (
              <button
                key={b.id}
                onClick={() => {
                  setSelected(b);
                  setOutcome(null);
                  setCallbackDays(null);
                  setNote("");
                }}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-3 py-2 text-left"
              >
                <span
                  className="inline-block h-3 w-3 shrink-0 rounded-full"
                  style={{ background: STATUS_COLORS[b.status] ?? "#64748b" }}
                />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{b.address}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Legend */}
      <div className="absolute bottom-3 left-3 z-10 rounded-lg bg-card/90 px-3 py-2 text-xs shadow backdrop-blur">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          {Object.entries(STATUS_LABELS).map(([k, label]) => (
            <span key={k} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: STATUS_COLORS[k] }} />
              {label}
            </span>
          ))}
        </div>
        {unlocatedCount > 0 && (
          <div className="mt-1 text-muted-foreground">{unlocatedCount} businesses not geocoded yet</div>
        )}
      </div>

      {/* Quick-log bottom sheet */}
      <Drawer open={!!selected} onOpenChange={(open) => !open && setSelected(null)}>
        <DrawerContent>
          {selected && (
            <div className="mx-auto w-full max-w-md pb-6">
              <DrawerHeader className="pb-2">
                <DrawerTitle className="flex items-center gap-2">
                  <MapPin className="h-4 w-4 shrink-0 text-primary" />
                  {selected.name}
                </DrawerTitle>
                <DrawerDescription className="flex items-center gap-2">
                  {selected.address}
                  <Badge variant="outline">{STATUS_LABELS[selected.status] ?? selected.status}</Badge>
                </DrawerDescription>
              </DrawerHeader>

              <div className="space-y-4 px-4">
                {/* Outcome chips */}
                <div className="grid grid-cols-2 gap-2">
                  {OUTCOMES.map((o) => (
                    <button
                      key={o.key}
                      data-selected={outcome?.key === o.key}
                      onClick={() => setOutcome(o)}
                      className={`flex items-center justify-center gap-2 rounded-lg border-2 px-3 py-3 text-sm font-medium transition-colors data-[selected=true]:text-white ${o.color}`}
                    >
                      <o.icon className="h-4 w-4" />
                      {o.label}
                    </button>
                  ))}
                </div>

                {/* Callback presets */}
                {outcome?.key === "callback" && (
                  <div className="flex gap-2">
                    {CALLBACK_PRESETS.map((p) => (
                      <button
                        key={p.days}
                        data-selected={callbackDays === p.days}
                        onClick={() => setCallbackDays(p.days)}
                        className="flex-1 rounded-md border px-2 py-2 text-xs font-medium data-[selected=true]:bg-amber-500 data-[selected=true]:text-white"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                )}

                <Textarea
                  placeholder="Quick note (optional)…"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  rows={2}
                />

                <div className="flex gap-2">
                  <Button className="flex-1" size="lg" disabled={!outcome || saving} onClick={handleSave}>
                    {saving ? "Saving…" : "Log visit"}
                  </Button>
                  {selected.latitude != null && (
                    <Button
                      variant="outline"
                      size="lg"
                      onClick={() =>
                        window.open(
                          `https://www.google.com/maps/dir/?api=1&destination=${selected.latitude},${selected.longitude}`,
                          "_blank"
                        )
                      }
                    >
                      <Navigation className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
