"use client";

import { useCallback, useEffect, useState } from "react";
import { Bot, BotOff } from "lucide-react";
import { csrfFetch } from "@/lib/queryClient";
import { Switch } from "@/components/ui/switch";

export interface PauseState {
  paused: boolean;
  paused_at: string | null;
  paused_by_agent_id: number | null;
  expires_at: string | null;
}

const INITIAL: PauseState = {
  paused: false,
  paused_at: null,
  paused_by_agent_id: null,
  expires_at: null,
};

const ONE_HOUR_MS = 60 * 60 * 1000;
const POLL_MS = 30_000;

function formatExpiresAt(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export interface UseAiPauseStateResult {
  state: PauseState;
  busy: boolean;
  setPaused: (next: boolean) => void;
}

/**
 * Single source of truth for the per-conversation AI pause. Toggle +
 * banner both consume this, so they never drift out of sync. Polls every
 * POLL_MS so the banner clears on its own at the 1-hour auto-expire.
 */
export function useAiPauseState(customerPhone: string): UseAiPauseStateResult {
  const [state, setState] = useState<PauseState>(INITIAL);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(
        `/api/conversations/${encodeURIComponent(customerPhone)}/state`,
        { credentials: "include" },
      );
      if (res.ok) {
        setState((await res.json()) as PauseState);
      }
    } catch {
      // Non-fatal — leave existing state alone.
    }
  }, [customerPhone]);

  useEffect(() => {
    setState(INITIAL);
    load();
    const id = setInterval(load, POLL_MS);
    return () => clearInterval(id);
  }, [customerPhone, load]);

  const setPaused = useCallback(
    (nextPaused: boolean) => {
      if (busy) return;
      const prev = state;
      // Optimistic update.
      setState({
        paused: nextPaused,
        paused_at: nextPaused ? new Date().toISOString() : null,
        paused_by_agent_id: prev.paused_by_agent_id,
        expires_at: nextPaused
          ? new Date(Date.now() + ONE_HOUR_MS).toISOString()
          : null,
      });
      setBusy(true);
      void (async () => {
        try {
          const res = await csrfFetch(
            `/api/conversations/${encodeURIComponent(customerPhone)}/pause`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ paused: nextPaused }),
            },
          );
          if (!res.ok) {
            setState(prev);
          } else {
            await load();
          }
        } catch {
          setState(prev);
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, customerPhone, load, state],
  );

  return { state, busy, setPaused };
}

export function AiPauseToggle({
  pause,
}: {
  pause: UseAiPauseStateResult;
}) {
  const { state, busy, setPaused } = pause;
  return (
    <div className="flex items-center gap-2">
      {state.paused ? (
        <BotOff className="w-4 h-4 text-brand-amber" />
      ) : (
        <Bot className="w-4 h-4 text-brand-slate" />
      )}
      <span className="text-xs text-brand-slate hidden sm:inline">
        {state.paused ? "AI paused" : "AI on"}
      </span>
      <Switch
        checked={!state.paused}
        onCheckedChange={(checked) => setPaused(!checked)}
        disabled={busy}
        aria-label="Toggle AI auto-reply"
      />
    </div>
  );
}

export function AiPauseBanner({
  pause,
}: {
  pause: UseAiPauseStateResult;
}) {
  const { state } = pause;
  if (!state.paused) return null;
  return (
    <div className="bg-brand-amber/15 border-b border-brand-amber/30 px-4 py-2 text-sm text-amber-200 flex items-center gap-2 shrink-0">
      <BotOff className="w-4 h-4 shrink-0" />
      <span>
        AI paused. Customer messages will not get an automatic reply.
        {state.expires_at && (
          <span className="ms-1 text-amber-300/80">
            Auto-clears at {formatExpiresAt(state.expires_at)}.
          </span>
        )}
      </span>
    </div>
  );
}
