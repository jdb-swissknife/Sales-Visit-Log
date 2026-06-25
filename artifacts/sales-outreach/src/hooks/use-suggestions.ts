import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react/custom-fetch";

export type Suggestion = {
  id: number;
  type: "callback_reminder" | "nearby_prospect" | "coaching" | "debrief" | "other";
  title: string;
  body: string;
  businessId: number | null;
  repId: string | null;
  priority: "low" | "normal" | "high" | "urgent";
  priorityScore: number | null;
  status: "unread" | "read" | "acted" | "dismissed";
  actionLabel: string | null;
  actionUrl: string | null;
  createdAt: string;
  expiresAt: string | null;
  data: Record<string, unknown> | null;
};

const SUGGESTIONS_KEY = ["/api/suggestions"] as const;

export function useSuggestions() {
  return useQuery({
    queryKey: SUGGESTIONS_KEY,
    queryFn: () => customFetch<Suggestion[]>("/api/suggestions"),
    refetchInterval: 30_000,
  });
}

export function useUnreadCount() {
  const { data } = useSuggestions();
  return data?.filter((s: Suggestion) => s.status === "unread").length ?? 0;
}

export function useUpdateSuggestionStatus() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status }: { id: number; status: Suggestion["status"] }) => {
      return customFetch<Suggestion>(`/api/suggestions/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: SUGGESTIONS_KEY }),
  });
}
