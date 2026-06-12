import {
  useGetMediaTranscription,
  useRequestMediaTranscription,
  getGetMediaTranscriptionQueryKey,
  type Media,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Sparkles, Loader2, RefreshCw, AlertTriangle, Flame, ThermometerSun, ThermometerSnowflake, Snowflake, HelpCircle } from "lucide-react";

const INTEREST_CONFIG: Record<string, { label: string; icon: typeof Flame; className: string }> = {
  hot: { label: "Hot lead", icon: Flame, className: "bg-red-500/15 text-red-600 dark:text-red-400" },
  warm: { label: "Warm", icon: ThermometerSun, className: "bg-orange-500/15 text-orange-600 dark:text-orange-400" },
  cool: { label: "Cool", icon: ThermometerSnowflake, className: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  cold: { label: "Cold", icon: Snowflake, className: "bg-slate-500/15 text-slate-600 dark:text-slate-400" },
  unknown: { label: "Unrated", icon: HelpCircle, className: "bg-muted text-muted-foreground" },
};

/**
 * Shows the Whisper transcript + AI-structured fields for a voice media item.
 * Polls while transcription is in flight.
 */
export function TranscriptionCard({ media }: { media: Media }) {
  const queryClient = useQueryClient();

  const { data } = useGetMediaTranscription(media.id, {
    query: {
      queryKey: getGetMediaTranscriptionQueryKey(media.id),
      initialData: media,
      refetchInterval: (query) => {
        const status = query.state.data?.transcriptionStatus;
        return status === "pending" || status === "processing" ? 3000 : false;
      },
    },
  });

  const retry = useRequestMediaTranscription({
    mutation: {
      onSuccess: () => {
        void queryClient.invalidateQueries({ queryKey: getGetMediaTranscriptionQueryKey(media.id) });
      },
    },
  });

  const item = data ?? media;
  const status = item.transcriptionStatus;

  if (status === "none") return null;

  if (status === "pending" || status === "processing") {
    return (
      <Card className="border-dashed">
        <CardContent className="p-4 flex items-center gap-3 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          Transcribing voice note...
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="border-destructive/30">
        <CardContent className="p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm text-destructive">
            <AlertTriangle className="h-4 w-4" />
            Transcription failed
          </div>
          {item.transcriptionError && (
            <p className="text-xs text-muted-foreground">{item.transcriptionError}</p>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => retry.mutate({ id: media.id })}
            disabled={retry.isPending}
            className="gap-1.5"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retry.isPending ? "animate-spin" : ""}`} />
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  // status === "done"
  const ai = item.aiStructured;
  const interest = INTEREST_CONFIG[ai?.interestLevel ?? "unknown"] ?? INTEREST_CONFIG.unknown;
  const InterestIcon = interest.icon;

  return (
    <Card className="border-l-2 border-l-primary">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
            <Sparkles className="h-3.5 w-3.5" />
            AI Visit Summary
          </span>
          {ai && (
            <span className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${interest.className}`}>
              <InterestIcon className="h-3 w-3" />
              {interest.label}
            </span>
          )}
        </div>

        {ai?.summary && <p className="text-sm leading-relaxed">{ai.summary}</p>}

        {ai?.nextStep && (
          <div className="text-sm">
            <span className="font-medium">Next step: </span>
            <span className="text-muted-foreground">{ai.nextStep}</span>
          </div>
        )}

        {(ai?.objections?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Objections</span>
            <div className="flex flex-wrap gap-1.5">
              {ai!.objections!.map((o, i) => (
                <Badge key={i} variant="outline" className="text-xs font-normal">{o}</Badge>
              ))}
            </div>
          </div>
        )}

        {(ai?.followUpItems?.length ?? 0) > 0 && (
          <div className="space-y-1">
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Follow-ups</span>
            <ul className="text-sm text-muted-foreground space-y-0.5">
              {ai!.followUpItems!.map((f, i) => (
                <li key={i} className="flex gap-1.5"><span className="text-primary">•</span>{f}</li>
              ))}
            </ul>
          </div>
        )}

        {ai?.contactInfo && (
          <p className="text-xs text-muted-foreground"><span className="font-medium">Contact info:</span> {ai.contactInfo}</p>
        )}

        {item.transcript && (
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer font-medium hover:text-foreground">Full transcript</summary>
            <p className="mt-2 whitespace-pre-wrap leading-relaxed">{item.transcript}</p>
          </details>
        )}
      </CardContent>
    </Card>
  );
}
