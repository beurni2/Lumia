/**
 * SwarmCta — "Run the swarm tonight" trigger button.
 *
 * One pulsating PortalButton that:
 *   1. POSTs /agents/run-overnight to start a fresh four-agent cycle
 *   2. Polls GET /agents/runs/:id every 1.5s until status becomes
 *      done | failed
 *   3. While running, swaps the label for a "weaving…" pill that
 *      reveals which agent is currently active
 *   4. On done, invalidates the trends/videos/earnings caches so the
 *      home + while-you-slept screens repopulate with fresh swarm
 *      output, and surfaces the parent run summary
 *
 * Used from the Home screen and the While-You-Slept "Tomorrow's
 * Promise" section so the demo works without an actual overnight
 * wait.
 */

import React from "react";
import { Platform, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";

import {
  getGetEarningsSummaryQueryKey,
  getGetSwarmRunQueryKey,
  getListSwarmRunsQueryKey,
  getListTrendBriefsQueryKey,
  getListVideosQueryKey,
  useGetSwarmRun,
  useStartSwarmRun,
} from "@workspace/api-client-react";

import { PortalButton } from "@/components/foundation/PortalButton";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";

type Props = {
  /** Override the resting-state CTA copy. */
  label?: string;
  /** Use the inline (small halo) variant inside dense screens. */
  subtle?: boolean;
};

const RESTING_LABEL = "Run the swarm tonight";

export function SwarmCta({ label = RESTING_LABEL, subtle = false }: Props) {
  const qc = useQueryClient();
  const [runId, setRunId] = React.useState<string | null>(null);
  const [toast, setToast] = React.useState<string | null>(null);

  const start = useStartSwarmRun({
    mutation: {
      onSuccess: (res) => {
        setRunId(res.runId);
      },
    },
  });

  // Poll the run status every 1.5s while it's in progress. React Query
  // disables the query entirely when runId is null, so this hook is a
  // no-op until the user taps the button.
  const run = useGetSwarmRun(runId ?? "", {
    query: {
      queryKey: getGetSwarmRunQueryKey(runId ?? ""),
      enabled: !!runId,
      refetchInterval: (q) => {
        const s = (q.state.data as { status?: string } | undefined)?.status;
        return s === "done" || s === "failed" ? false : 1500;
      },
    },
  });

  const status = run.data?.status;

  // When the swarm finishes, invalidate the dependent caches so the
  // home + studio + earnings screens repopulate with the new content.
  React.useEffect(() => {
    if (status !== "done" && status !== "failed") return;
    if (status === "done") {
      qc.invalidateQueries({ queryKey: getListTrendBriefsQueryKey() });
      qc.invalidateQueries({ queryKey: getListVideosQueryKey() });
      qc.invalidateQueries({ queryKey: getGetEarningsSummaryQueryKey() });
      qc.invalidateQueries({ queryKey: getListSwarmRunsQueryKey() });
      setToast(run.data?.summary ?? "the swarm wove something new");
    } else {
      setToast(`swarm hit a snag: ${run.data?.error ?? "unknown"}`);
    }
    const t = setTimeout(() => {
      setToast(null);
      setRunId(null);
      // Also invalidate the run-detail query key so the next tap
      // doesn't reuse the previous "done" payload.
      if (runId) {
        qc.removeQueries({ queryKey: getGetSwarmRunQueryKey(runId) });
      }
    }, 6000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  const inFlight =
    start.isPending || (!!runId && status !== "done" && status !== "failed");

  const activeAgent = run.data?.agents.find((a) => a.status === "running");
  const dynamicLabel = inFlight
    ? activeAgent
      ? `weaving · ${activeAgent.agent}`
      : "weaving…"
    : label;

  return (
    <View style={styles.wrap}>
      <PortalButton
        label={dynamicLabel}
        onPress={() => {
          if (inFlight) return;
          start.mutate();
        }}
        disabled={inFlight}
        subtle={subtle}
        width={subtle ? 280 : 260}
      />
      {toast && (
        <View style={styles.toast}>
          <Text style={[type.microDelight, styles.toastText]} numberOfLines={3}>
            {toast}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: "center", gap: 12 },
  toast: {
    maxWidth: 320,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 14,
    backgroundColor: "rgba(0,255,204,0.08)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.3)",
    ...Platform.select({
      web: {
        boxShadow: `0 0 24px ${lumina.firefly}33`,
      },
    }),
  },
  toastText: {
    color: lumina.firefly,
    fontSize: 12,
    textAlign: "center",
    lineHeight: 16,
  },
});
