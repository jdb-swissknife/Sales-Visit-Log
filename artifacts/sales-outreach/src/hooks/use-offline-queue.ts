import { useCallback, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  countQueuedVisits,
  syncQueuedVisits,
  QUEUE_CHANGED_EVENT,
  type SyncResult,
} from "@/lib/offline-queue";
import { useToast } from "@/hooks/use-toast";

/**
 * Tracks online status and the offline visit queue; auto-syncs when the
 * connection returns. Mount once in the layout.
 */
export function useOfflineQueue() {
  const [isOnline, setIsOnline] = useState(
    typeof navigator === "undefined" ? true : navigator.onLine,
  );
  const [queuedCount, setQueuedCount] = useState(0);
  const [isSyncing, setIsSyncing] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const refreshCount = useCallback(() => {
    countQueuedVisits()
      .then(setQueuedCount)
      .catch(() => undefined);
  }, []);

  const syncNow = useCallback(async (): Promise<SyncResult | null> => {
    if (typeof navigator !== "undefined" && !navigator.onLine) return null;
    setIsSyncing(true);
    try {
      const result = await syncQueuedVisits();
      if (result.synced > 0) {
        toast({
          title: `Synced ${result.synced} offline visit${result.synced === 1 ? "" : "s"}`,
        });
        await queryClient.invalidateQueries();
      }
      return result;
    } finally {
      setIsSyncing(false);
      refreshCount();
    }
  }, [queryClient, refreshCount, toast]);

  useEffect(() => {
    refreshCount();

    const onOnline = () => {
      setIsOnline(true);
      void syncNow();
    };
    const onOffline = () => setIsOnline(false);
    const onQueueChanged = () => refreshCount();

    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);

    // Attempt a sync on app start in case items were left over.
    if (navigator.onLine) void syncNow();

    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(QUEUE_CHANGED_EVENT, onQueueChanged);
    };
  }, [refreshCount, syncNow]);

  return { isOnline, queuedCount, isSyncing, syncNow };
}
