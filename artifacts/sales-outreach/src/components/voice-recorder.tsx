import { useEffect, useRef, useState } from "react";
import { Mic, Square, Trash2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";

type Status = "idle" | "requesting" | "recording" | "recorded" | "error";

interface VoiceRecorderProps {
  onChange: (audio: { blob: Blob; durationSec: number; mimeType: string } | null) => void;
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(1, "0")}:${s.toString().padStart(2, "0")}`;
}

function pickMimeType(): string {
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  if (typeof MediaRecorder === "undefined") return "";
  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c)) return c;
  }
  return "";
}

export function VoiceRecorder({ onChange }: VoiceRecorderProps) {
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<number | null>(null);
  const finalDurationRef = useRef<number>(0);
  const previewUrlRef = useRef<string | null>(null);

  useEffect(() => {
    previewUrlRef.current = previewUrl;
  }, [previewUrl]);

  useEffect(() => {
    return () => {
      stopStream();
      if (tickRef.current) window.clearInterval(tickRef.current);
      if (previewUrlRef.current) URL.revokeObjectURL(previewUrlRef.current);
    };
  }, []);

  function stopStream() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
  }

  async function startRecording() {
    setErrorMsg(null);
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
      setErrorMsg("Voice recording is not supported in this browser.");
      setStatus("error");
      return;
    }

    setStatus("requesting");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      recorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        const blobType = recorder.mimeType || "audio/webm";
        const blob = new Blob(chunksRef.current, { type: blobType });
        const url = URL.createObjectURL(blob);
        if (previewUrl) URL.revokeObjectURL(previewUrl);
        setPreviewUrl(url);
        setStatus("recorded");
        stopStream();
        onChange({ blob, durationSec: finalDurationRef.current, mimeType: blobType });
      };

      recorder.start(250);
      startedAtRef.current = Date.now();
      setElapsedSec(0);
      tickRef.current = window.setInterval(() => {
        const sec = (Date.now() - startedAtRef.current) / 1000;
        setElapsedSec(sec);
      }, 200);
      setStatus("recording");
    } catch (err) {
      const message = err instanceof Error ? err.message : "Microphone access denied.";
      setErrorMsg(message);
      setStatus("error");
      stopStream();
    }
  }

  function stopRecording() {
    if (recorderRef.current && recorderRef.current.state !== "inactive") {
      finalDurationRef.current = (Date.now() - startedAtRef.current) / 1000;
      recorderRef.current.stop();
    }
    if (tickRef.current) {
      window.clearInterval(tickRef.current);
      tickRef.current = null;
    }
  }

  function discard() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    finalDurationRef.current = 0;
    setElapsedSec(0);
    setStatus("idle");
    onChange(null);
  }

  if (status === "recording") {
    return (
      <div className="rounded-xl border-2 border-red-500/50 bg-red-500/5 p-4 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="relative flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-red-500" />
          </span>
          <div>
            <p className="text-sm font-semibold text-red-500">Recording</p>
            <p className="font-mono text-lg font-bold tabular-nums">{formatTime(elapsedSec)}</p>
          </div>
        </div>
        <Button type="button" variant="destructive" onClick={stopRecording} className="gap-2">
          <Square className="h-4 w-4 fill-current" />
          Stop
        </Button>
      </div>
    );
  }

  if (status === "recorded" && previewUrl) {
    return (
      <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-primary" />
            <span className="text-sm font-semibold text-primary">Voice note ready</span>
            <span className="text-xs text-muted-foreground font-mono">
              {formatTime(finalDurationRef.current)}
            </span>
          </div>
        </div>
        <audio src={previewUrl} controls className="w-full" />
        <div className="flex gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => { discard(); startRecording(); }} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" />
            Re-record
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={discard} className="gap-1.5 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-3.5 w-3.5" />
            Discard
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
            <Mic className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-sm font-semibold">Voice Note</p>
            <p className="text-xs text-muted-foreground">
              Tap record to capture quick notes hands-free.
            </p>
          </div>
        </div>
        <Button
          type="button"
          onClick={startRecording}
          disabled={status === "requesting"}
          className="gap-2"
        >
          <Mic className="h-4 w-4" />
          {status === "requesting" ? "Starting..." : "Record"}
        </Button>
      </div>
      {errorMsg && (
        <p className="text-xs text-destructive mt-3">
          {errorMsg} If you were asked for microphone access, please allow it and try again.
        </p>
      )}
    </div>
  );
}
