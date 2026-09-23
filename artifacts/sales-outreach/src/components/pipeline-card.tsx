import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow, parseISO } from "date-fns";
import {
  useUpdateBusinessPipeline,
  getGetBusinessQueryKey,
  getListBusinessesQueryKey,
  type Business,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PIPELINE_STAGES, STAGE_LABELS, STAGE_FILL, OPEN_STAGES, isPipelineStage, type PipelineStage, formatMoney } from "@/lib/pipeline";
import { TrendingUp, Check, Trophy, Ban } from "lucide-react";

const LOST_REASONS = [
  "Happy with current provider",
  "No budget",
  "Not the decision maker",
  "Too small / no need",
  "Bad timing — revisit later",
  "Went with a competitor",
  "Other",
];

/** Compact stage stepper: the four open stages as a progress track. */
function StageTrack({ current }: { current: PipelineStage }) {
  const idx = OPEN_STAGES.indexOf(current);
  const won = current === "converted";
  const lost = current === "not_interested";
  return (
    <div className="flex items-center gap-1">
      {OPEN_STAGES.map((s, i) => {
        const reached = won || (!lost && idx >= i);
        return (
          <div
            key={s}
            title={STAGE_LABELS[s]}
            className={`h-1.5 flex-1 rounded-full ${reached ? (won ? STAGE_FILL.converted : STAGE_FILL[s]) : lost ? "bg-red-200 dark:bg-red-950" : "bg-muted"}`}
          />
        );
      })}
    </div>
  );
}

export function PipelineCard({ business }: { business: Business }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const update = useUpdateBusinessPipeline();

  const current: PipelineStage = isPipelineStage(business.status) ? business.status : "not_contacted";
  const [dealValue, setDealValue] = useState<string>(business.dealValue != null ? String(business.dealValue) : "");
  const [decisionMaker, setDecisionMaker] = useState<string>(business.decisionMaker ?? "");
  const [lostReason, setLostReason] = useState<string>(business.lostReason ?? "");

  // Keep local fields in sync when the business refetches.
  useEffect(() => {
    setDealValue(business.dealValue != null ? String(business.dealValue) : "");
    setDecisionMaker(business.decisionMaker ?? "");
    setLostReason(business.lostReason ?? "");
  }, [business.id, business.dealValue, business.decisionMaker, business.lostReason]);

  const dirty =
    (dealValue.trim() === "" ? null : Number(dealValue)) !== (business.dealValue ?? null) ||
    decisionMaker.trim() !== (business.decisionMaker ?? "") ||
    (current === "not_interested" && lostReason !== (business.lostReason ?? ""));

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: getGetBusinessQueryKey(business.id) });
    void queryClient.invalidateQueries({ queryKey: getListBusinessesQueryKey() });
    void queryClient.invalidateQueries({ queryKey: ["/api/stats/pipeline"] });
    void queryClient.invalidateQueries({ queryKey: ["/api/followups"] });
  };

  const save = async (data: { status?: PipelineStage; dealValue?: number | null; decisionMaker?: string | null; lostReason?: string | null }) => {
    try {
      await update.mutateAsync({ id: business.id, data });
      invalidate();
      return true;
    } catch {
      toast({ title: "Couldn't save pipeline changes", variant: "destructive" });
      return false;
    }
  };

  const onStageChange = async (value: string) => {
    if (!isPipelineStage(value) || value === current) return;
    const ok = await save({ status: value, ...(value === "not_interested" && lostReason ? { lostReason } : {}) });
    if (ok) {
      toast({
        title: value === "converted" ? "Deal won 🎉" : value === "not_interested" ? "Marked lost" : `Moved to ${STAGE_LABELS[value]}`,
      });
    }
  };

  const onSaveDetails = async () => {
    const parsed = dealValue.trim() === "" ? null : Number(dealValue);
    if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) {
      toast({ title: "Deal value must be a positive number", variant: "destructive" });
      return;
    }
    const ok = await save({
      dealValue: parsed,
      decisionMaker: decisionMaker.trim() || null,
      ...(current === "not_interested" ? { lostReason: lostReason || null } : {}),
    });
    if (ok) toast({ title: "Saved" });
  };

  const stageAge = business.stageChangedAt ? formatDistanceToNow(parseISO(business.stageChangedAt), { addSuffix: false }) : null;

  return (
    <Card className="border-primary/10 shadow-sm">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
          <TrendingUp className="h-4 w-4" /> Pipeline
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <StageTrack current={current} />

        <div className="space-y-1.5">
          <Label htmlFor="stage" className="text-xs">Stage</Label>
          <Select value={current} onValueChange={(v) => void onStageChange(v)} disabled={update.isPending}>
            <SelectTrigger id="stage">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PIPELINE_STAGES.map((s) => (
                <SelectItem key={s} value={s}>
                  <span className="flex items-center gap-2">
                    {s === "converted" && <Trophy className="h-3.5 w-3.5 text-green-600" />}
                    {s === "not_interested" && <Ban className="h-3.5 w-3.5 text-red-600" />}
                    {STAGE_LABELS[s]}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {stageAge && <p className="text-[11px] text-muted-foreground">In this stage for {stageAge}</p>}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="dealValue" className="text-xs">Est. deal value</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">$</span>
              <Input
                id="dealValue"
                inputMode="decimal"
                className="pl-6"
                placeholder="0"
                value={dealValue}
                onChange={(e) => setDealValue(e.target.value.replace(/[^0-9.]/g, ""))}
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="decisionMaker" className="text-xs">Decision maker</Label>
            <Input
              id="decisionMaker"
              placeholder="Owner / manager"
              value={decisionMaker}
              onChange={(e) => setDecisionMaker(e.target.value)}
            />
          </div>
        </div>

        {current === "not_interested" && (
          <div className="space-y-1.5">
            <Label htmlFor="lostReason" className="text-xs">Why we lost it</Label>
            <Select value={lostReason || undefined} onValueChange={setLostReason}>
              <SelectTrigger id="lostReason">
                <SelectValue placeholder="Pick a reason" />
              </SelectTrigger>
              <SelectContent>
                {LOST_REASONS.map((r) => (
                  <SelectItem key={r} value={r}>{r}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {current === "converted" && business.closedAt && (
          <p className="text-xs text-green-700 dark:text-green-400">
            Won {formatDistanceToNow(parseISO(business.closedAt), { addSuffix: true })}
            {business.dealValue != null ? ` · ${formatMoney(business.dealValue)}` : ""}
          </p>
        )}

        <Button size="sm" className="w-full" onClick={() => void onSaveDetails()} disabled={!dirty || update.isPending}>
          <Check className="mr-1.5 h-3.5 w-3.5" /> Save details
        </Button>
      </CardContent>
    </Card>
  );
}
