/**
 * Privacy + Schedule cards for the Profile screen.
 *
 * Three concerns wrapped together so they share the same compact
 * dark-glass aesthetic:
 *
 *   1. Privacy & disclosures — view current AI/age consent state,
 *      withdraw it, export all owned data, delete the account.
 *   2. Nightly swarm — opt-in to scheduled overnight cycles, pick
 *      a local hour. Tz is auto-detected from the device.
 *   3. (No subscription card here yet — that lives in the future
 *      paywall flow.)
 *
 * Server-side gates back-stop everything: an unconsented creator
 * cannot run the swarm or record a publication, and enabling the
 * schedule without consent returns 403.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  useDeleteMyData,
  useExportMyData,
  useGetConsent,
  useGetSchedule,
  useUpsertConsent,
  useUpsertSchedule,
} from "@workspace/api-client-react";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";

function deviceTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function fmtHour(h: number | null | undefined): string {
  if (h == null) return "—";
  const am = h < 12;
  const display = h === 0 ? 12 : h > 12 ? h - 12 : h;
  return `${display}${am ? "am" : "pm"}`;
}

function confirm(title: string, body: string, ok: () => void) {
  if (Platform.OS === "web") {
    if (typeof window !== "undefined" && window.confirm(`${title}\n\n${body}`)) {
      ok();
    }
    return;
  }
  Alert.alert(title, body, [
    { text: "Cancel", style: "cancel" },
    { text: "Confirm", style: "destructive", onPress: ok },
  ]);
}

export function PrivacyAndScheduleCards() {
  return (
    <View style={styles.wrap}>
      <PrivacyCard />
      <ScheduleCard />
    </View>
  );
}

/* ─── Privacy card ────────────────────────────────────────────── */

function PrivacyCard() {
  const { data: consent, refetch } = useGetConsent();
  const upsert = useUpsertConsent();
  const exportData = useExportMyData();
  const deleteAll = useDeleteMyData();

  const aiOk = !!consent?.aiDisclosureConsentedAt;
  const adultOk = !!consent?.adultConfirmedAt;

  const toggle = useCallback(
    async (next: { ai: boolean; adult: boolean }) => {
      try {
        await upsert.mutateAsync({
          data: {
            aiDisclosureConsented: next.ai,
            adultConfirmed: next.adult,
          },
        });
        await refetch();
      } catch {
        feedback.error();
      }
    },
    [upsert, refetch],
  );

  const onWithdrawAi = () =>
    confirm(
      "Withdraw AI disclosure consent?",
      "The swarm will refuse to generate or publish content until you re-consent.",
      () => void toggle({ ai: false, adult: adultOk }),
    );
  const onWithdrawAdult = () =>
    confirm(
      "Withdraw age confirmation?",
      "Generative monetisation features will be disabled until you re-confirm.",
      () => void toggle({ ai: aiOk, adult: false }),
    );
  const onGrantAi = () => void toggle({ ai: true, adult: adultOk });
  const onGrantAdult = () => void toggle({ ai: aiOk, adult: true });

  const onExport = useCallback(async () => {
    try {
      const res = await exportData.mutateAsync();
      const json = JSON.stringify(res, null, 2);
      if (Platform.OS === "web" && typeof window !== "undefined") {
        const blob = new Blob([json], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "lumina-export.json";
        a.click();
        URL.revokeObjectURL(url);
      } else {
        Alert.alert(
          "Export ready",
          `Your data has been downloaded (${json.length.toLocaleString()} bytes).`,
        );
      }
      feedback.success();
    } catch {
      feedback.error();
    }
  }, [exportData]);

  const onDelete = () =>
    confirm(
      "Delete everything?",
      "This permanently wipes your creator profile, videos, deals, ledger, and publications. There is no undo.",
      async () => {
        try {
          await deleteAll.mutateAsync();
          feedback.success();
          Alert.alert("Deleted", "Your account has been removed.");
        } catch {
          feedback.error();
        }
      },
    );

  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionLabel]}>privacy & disclosures</Text>
      <GlassSurface radius={20} agent="director">
        <View style={styles.cardInner}>
          <Row
            label="AI content disclosure (FTC · EU AI Act)"
            sub={
              aiOk
                ? `granted · posts will be labelled AI-assisted`
                : `not granted · the swarm is paused`
            }
            actionLabel={aiOk ? "withdraw" : "grant"}
            danger={aiOk}
            onPress={aiOk ? onWithdrawAi : onGrantAi}
          />
          <Divider />
          <Row
            label="I am 18+ (COPPA)"
            sub={adultOk ? "confirmed" : "not confirmed"}
            actionLabel={adultOk ? "withdraw" : "confirm"}
            danger={adultOk}
            onPress={adultOk ? onWithdrawAdult : onGrantAdult}
          />
          <Divider />
          <Row
            label="Export my data (GDPR / CCPA)"
            sub="every row owned by your account, as JSON"
            actionLabel={exportData.isPending ? "…" : "export"}
            onPress={onExport}
          />
          <Divider />
          <Row
            label="Delete my account"
            sub="hard delete · cannot be undone"
            actionLabel={deleteAll.isPending ? "…" : "delete"}
            danger
            onPress={onDelete}
          />
        </View>
      </GlassSurface>
    </View>
  );
}

/* ─── Schedule card ───────────────────────────────────────────── */

function ScheduleCard() {
  const { data: schedule, refetch } = useGetSchedule();
  const upsert = useUpsertSchedule();
  const tz = useMemo(deviceTz, []);
  const [enabled, setEnabled] = useState(false);
  const [hour, setHour] = useState<number>(2);

  useEffect(() => {
    if (!schedule) return;
    setEnabled(!!schedule.enabled);
    setHour(typeof schedule.hour === "number" ? schedule.hour : 2);
  }, [schedule]);

  const persist = useCallback(
    async (next: { enabled: boolean; hour: number }) => {
      try {
        await upsert.mutateAsync({
          data: { enabled: next.enabled, hour: next.hour, tz },
        });
        await refetch();
      } catch {
        feedback.error();
      }
    },
    [upsert, refetch, tz],
  );

  const onToggle = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    void persist({ enabled: next, hour });
  }, [enabled, hour, persist]);

  const onHour = useCallback(
    (h: number) => {
      setHour(h);
      if (enabled) void persist({ enabled, hour: h });
    },
    [enabled, persist],
  );

  return (
    <View style={styles.section}>
      <Text style={[type.label, styles.sectionLabel]}>nightly swarm</Text>
      <GlassSurface radius={20} agent="ideator">
        <View style={styles.cardInner}>
          <Row
            label="Run the swarm overnight"
            sub={
              enabled
                ? `wakes daily at ${fmtHour(hour)} (${tz})`
                : "tap to enable while-you-sleep cycles"
            }
            actionLabel={enabled ? "on" : "off"}
            onPress={onToggle}
          />
          {enabled ? (
            <View style={styles.hourPickerWrap}>
              <Text style={[type.microDelight, styles.hourLabel]}>
                local hour
              </Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.hourRow}
              >
                {Array.from({ length: 24 }, (_, h) => h).map((h) => {
                  const selected = h === hour;
                  return (
                    <Pressable
                      key={h}
                      onPress={() => onHour(h)}
                      style={[
                        styles.hourPill,
                        selected && styles.hourPillSelected,
                      ]}
                      accessibilityRole="button"
                      accessibilityLabel={`Set nightly hour to ${fmtHour(h)}`}
                    >
                      <Text
                        style={[
                          styles.hourPillText,
                          selected && styles.hourPillTextSelected,
                        ]}
                      >
                        {fmtHour(h)}
                      </Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
              {schedule?.lastRunAt ? (
                <Text style={[type.microDelight, styles.scheduleFootnote]}>
                  last run · {new Date(schedule.lastRunAt).toLocaleString()}
                </Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </GlassSurface>
    </View>
  );
}

/* ─── Atoms ──────────────────────────────────────────────────── */

function Row({
  label,
  sub,
  actionLabel,
  onPress,
  danger,
}: {
  label: string;
  sub: string;
  actionLabel: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <View style={styles.row}>
      <View style={{ flex: 1, paddingRight: 12 }}>
        <Text style={[type.body, styles.rowLabel]}>{label}</Text>
        <Text style={[type.microDelight, styles.rowSub]}>{sub}</Text>
      </View>
      <Pressable
        onPress={onPress}
        style={({ pressed }) => [
          styles.actionBtn,
          danger && styles.actionBtnDanger,
          { opacity: pressed ? 0.75 : 1 },
        ]}
        accessibilityRole="button"
        accessibilityLabel={`${actionLabel} ${label}`}
      >
        <Text style={[styles.actionText, danger && styles.actionTextDanger]}>
          {actionLabel}
        </Text>
      </Pressable>
    </View>
  );
}

function Divider() {
  return <View style={styles.divider} />;
}

const styles = StyleSheet.create({
  wrap: { gap: 26, paddingHorizontal: 22 },
  section: {},
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 16, gap: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
  },
  rowLabel: { color: "#FFFFFF", fontSize: 14 },
  rowSub: {
    color: "rgba(255,255,255,0.55)",
    marginTop: 4,
    fontSize: 11,
  },
  actionBtn: {
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 12,
    backgroundColor: "rgba(0,255,204,0.14)",
    borderWidth: 1,
    borderColor: "rgba(0,255,204,0.4)",
    minWidth: 64,
    alignItems: "center",
  },
  actionBtnDanger: {
    backgroundColor: "rgba(255,90,128,0.12)",
    borderColor: "rgba(255,90,128,0.45)",
  },
  actionText: {
    color: lumina.core,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "lowercase",
  },
  actionTextDanger: { color: "rgba(255,140,170,0.95)" },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  hourPickerWrap: { paddingTop: 6, paddingBottom: 4 },
  hourLabel: {
    color: "rgba(255,255,255,0.45)",
    fontSize: 10,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    marginBottom: 8,
  },
  hourRow: { gap: 8, paddingRight: 8 },
  hourPill: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 14,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    minWidth: 52,
    alignItems: "center",
  },
  hourPillSelected: {
    backgroundColor: "rgba(0,255,204,0.18)",
    borderColor: lumina.core,
  },
  hourPillText: { color: "rgba(255,255,255,0.7)", fontSize: 12 },
  hourPillTextSelected: { color: "#FFFFFF", fontWeight: "700" },
  scheduleFootnote: {
    color: "rgba(255,255,255,0.45)",
    marginTop: 12,
    fontSize: 11,
  },
});
