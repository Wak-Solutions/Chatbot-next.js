import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/contracts/routes";
import type { Conversation } from "@/lib/contracts/schema-types";
import { csrfFetch } from "@/lib/queryClient";

export function useConversations() {
  return useQuery({
    queryKey: [api.conversations.list.path],
    queryFn: async () => {
      const res = await csrfFetch(api.conversations.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch conversations");
      return res.json() as Promise<Conversation[]>;
    },
    refetchInterval: 10000, // Poll every 10 seconds
  });
}
