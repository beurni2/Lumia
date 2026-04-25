/**
 * Billing + Payouts cards for the Profile screen.
 *
 * Two concerns wrapped together so they share the compact dark-glass
 * aesthetic of the existing PrivacyAndScheduleCards block:
 *
 *   1. Lumina Pro subscription — server-mirrored status badge, plus a
 *      "Start subscription" button (Stripe Checkout) when inactive
 *      and a "Manage billing" button (Stripe Customer Portal) when
 *      active. Both flows open in the device browser and return to
 *      a deep link configured server-side as STRIPE_BILLING_RETURN_URL.
 *
 *   2. Payouts (Stripe Connect Express) — server-mirrored capability
 *      flags, plus a single "Set up payouts" / "Continue payout
 *      setup" button that opens an AccountLink onboarding URL.
 *
 * Both panels render in a "stripe_disabled" muted state when the
 * server reports `stripeConfigured: false` so the UX never surfaces
 * a button that would 503. This is the same closed-by-default
 * principle as the webhook receivers.
 *
 * No new generated SDK methods — we hand-call the four endpoints
 * via the existing customFetch wrapper. When we OpenAPI-spec these
 * routes in a future round, this file collapses to a few hook
 * imports, but the UI stays unchanged.
 */

import React, { useCallback, useEffect } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useFocusEffect } from "expo-router";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { type } from "@/constants/typography";
import { feedback } from "@/lib/feedback";
import { customFetch } from "@workspace/api-client-react";

// ---------------------------------------------------------------- //
// Types mirror the JSON the server sends. Kept narrow on purpose   //
// so a server-side response shape change surfaces as a TS error.   //
// ---------------------------------------------------------------- //

type BillingStatus = {
  hasActive: boolean;
  status: string | null;
  plan: string | null;
  currentPeriodEnd: string | null;
  stripeConfigured: boolean;
};

type PayoutsStatus = {
  stripeConfigured: boolean;
  accountId: string | null;
  country: string | null;
  onboarded: boolean;
  payoutsEnabled: boolean;
  chargesEnabled: boolean;
};

type RedirectResponse = { url: string };

// ---------------------------------------------------------------- //
// Helpers                                                          //
// ---------------------------------------------------------------- //

function statusLabel(status: string | null): string {
  if (!status) return "Free plan";
  switch (status) {
    case "active":
      return "Pro · active";
    case "trialing":
      return "Pro · trialing";
    case "past_due":
      return "Pro · past due";
    case "canceled":
      return "Canceled";
    case "incomplete":
    case "incomplete_expired":
      return "Setup incomplete";
    case "unpaid":
      return "Pro · unpaid";
    case "paused":
      return "Pro · paused";
    default:
      return `Pro · ${status}`;
  }
}

function statusColor(status: string | null, hasActive: boolean): string {
  if (hasActive) return "rgba(94, 234, 212, 0.95)"; // mint
  if (status === "past_due" || status === "unpaid") return "rgba(251, 191, 36, 0.95)";
  if (status === "canceled") return "rgba(248, 113, 113, 0.85)";
  return "rgba(255,255,255,0.65)";
}

function payoutsLabel(s: PayoutsStatus): string {
  if (!s.accountId) return "Not set up";
  if (s.onboarded) return `Active${s.country ? ` · ${s.country}` : ""}`;
  if (s.payoutsEnabled || s.chargesEnabled) return "Almost done";
  return "Setup pending";
}

function payoutsColor(s: PayoutsStatus): string {
  if (s.onboarded) return "rgba(94, 234, 212, 0.95)";
  if (s.accountId) return "rgba(251, 191, 36, 0.95)";
  return "rgba(255,255,255,0.65)";
}

async function openExternal(url: string): Promise<void> {
  // expo-router runs the same code on web + native. On web, Linking
  // delegates to window.open which respects the user's popup blocker
  // unless we're inside a user gesture — every caller IS inside a
  // tap handler so this is safe.
  try {
    await Linking.openURL(url);
  } catch (err) {
    if (Platform.OS === "web" && typeof window !== "undefined") {
      window.location.href = url;
      return;
    }
    Alert.alert(
      "Couldn't open browser",
      "Please try again, or contact support if the problem persists.",
    );
    throw err;
  }
}

// ---------------------------------------------------------------- //
// Hooks                                                            //
// ---------------------------------------------------------------- //

function useBillingStatus() {
  return useQuery({
    queryKey: ["billing", "status"],
    queryFn: () => customFetch<BillingStatus>("/api/billing/status"),
    // Refresh modestly — the webhook handler keeps the row in sync
    // out-of-band, so the UI doesn't need to hammer this endpoint.
    staleTime: 30_000,
  });
}

function usePayoutsStatus() {
  return useQuery({
    queryKey: ["payouts", "status"],
    queryFn: () => customFetch<PayoutsStatus>("/api/payouts/connect/status"),
    staleTime: 30_000,
  });
}

// React Query v5's `onSuccess` callback signature is
// `(data, variables, onMutateResult, context) => unknown`, where
// `data` is `unknown` until the function-result generic is widened.
// Annotating the parameter explicitly keeps each mutation strongly
// typed without an `as` cast and without leaking the wider `data`
// shape into the call site.
function useStartCheckout() {
  return useMutation<RedirectResponse>({
    mutationFn: () =>
      customFetch<RedirectResponse>("/api/billing/checkout", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: RedirectResponse) => {
      void openExternal(data.url);
    },
  });
}

function useOpenPortal() {
  return useMutation<RedirectResponse>({
    mutationFn: () =>
      customFetch<RedirectResponse>("/api/billing/portal", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: RedirectResponse) => {
      void openExternal(data.url);
    },
  });
}

function useStartConnect() {
  return useMutation<RedirectResponse>({
    mutationFn: () =>
      customFetch<RedirectResponse>("/api/payouts/connect/onboard", {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: (data: RedirectResponse) => {
      void openExternal(data.url);
    },
  });
}

// ---------------------------------------------------------------- //
// Component                                                        //
// ---------------------------------------------------------------- //

export function BillingAndPayoutsCards(): React.ReactElement {
  const qc = useQueryClient();
  const billing = useBillingStatus();
  const payouts = usePayoutsStatus();
  const startCheckout = useStartCheckout();
  const openPortal = useOpenPortal();
  const startConnect = useStartConnect();

  // After the user returns from Stripe Checkout / Portal / Connect
  // we have no native event to listen for, so the simplest reliable
  // refresh is to invalidate when the screen regains focus AND when
  // the app foregrounds. A tap on the card itself ALSO triggers a
  // refresh as a safety rail. The webhook → job queue lag is
  // typically 2-10 s, well inside the patience budget after a tap.
  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: ["billing", "status"] });
    void qc.invalidateQueries({ queryKey: ["payouts", "status"] });
  }, [qc]);

  // Refresh when the Profile tab regains focus (e.g. after a deep
  // link returned from Stripe Checkout / Portal / Connect onboarding).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  // Refresh when the OS brings the app back to the foreground —
  // covers the case where the user dismisses the in-app browser by
  // swiping the system back gesture rather than via the return URL.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const billingData = billing.data;
  const payoutsData = payouts.data;
  const stripeOff =
    (billingData && !billingData.stripeConfigured) ||
    (payoutsData && !payoutsData.stripeConfigured);

  const onCheckout = useCallback(() => {
    feedback.portal();
    startCheckout.mutate(undefined, {
      onError: (err) => {
        Alert.alert(
          "Couldn't start checkout",
          err instanceof Error ? err.message : "Please try again.",
        );
      },
    });
  }, [startCheckout]);

  const onPortal = useCallback(() => {
    feedback.tap();
    openPortal.mutate(undefined, {
      onError: (err) => {
        Alert.alert(
          "Couldn't open billing",
          err instanceof Error ? err.message : "Please try again.",
        );
      },
    });
  }, [openPortal]);

  const onConnect = useCallback(() => {
    feedback.portal();
    startConnect.mutate(undefined, {
      onError: (err) => {
        Alert.alert(
          "Couldn't start payout setup",
          err instanceof Error ? err.message : "Please try again.",
        );
      },
    });
  }, [startConnect]);

  return (
    <View style={styles.wrap}>
      {/* ---------- Lumina Pro ---------- */}
      <Text style={[type.label, styles.sectionLabel]}>lumina pro</Text>
      <GlassSurface radius={20} agent="ideator">
        <Pressable
          onPress={refresh}
          style={styles.cardInner}
          accessibilityRole="button"
          accessibilityLabel="Refresh subscription status"
          testID="billing-card"
        >
          <View style={styles.row}>
            <Text style={[type.body, styles.cardTitle]}>Subscription</Text>
            <Text
              style={[
                type.label,
                styles.statusPill,
                {
                  color: statusColor(
                    billingData?.status ?? null,
                    Boolean(billingData?.hasActive),
                  ),
                },
              ]}
            >
              {billing.isLoading
                ? "—"
                : statusLabel(billingData?.status ?? null)}
            </Text>
          </View>

          <Text style={[type.microDelight, styles.helper]}>
            {stripeOff
              ? "Billing is not enabled on this server yet."
              : billingData?.hasActive
                ? "You're a Pro creator. Manage your card or cancel anytime."
                : "Unlock larger nightly cycles, the Style Twin garden, and priority brand deals."}
          </Text>

          <View style={styles.btnRow}>
            {billingData?.hasActive ? (
              <Pressable
                onPress={onPortal}
                disabled={openPortal.isPending || stripeOff}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  (pressed || openPortal.isPending) && styles.btnPressed,
                  stripeOff && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Manage billing"
                testID="billing-portal"
              >
                {openPortal.isPending ? (
                  <ActivityIndicator color="#0A0824" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryLabel}>manage billing</Text>
                )}
              </Pressable>
            ) : (
              <Pressable
                onPress={onCheckout}
                disabled={startCheckout.isPending || stripeOff}
                style={({ pressed }) => [
                  styles.btnPrimary,
                  (pressed || startCheckout.isPending) && styles.btnPressed,
                  stripeOff && styles.btnDisabled,
                ]}
                accessibilityRole="button"
                accessibilityLabel="Start Lumina Pro subscription"
                testID="billing-checkout"
              >
                {startCheckout.isPending ? (
                  <ActivityIndicator color="#0A0824" size="small" />
                ) : (
                  <Text style={styles.btnPrimaryLabel}>start subscription</Text>
                )}
              </Pressable>
            )}
          </View>
        </Pressable>
      </GlassSurface>

      <View style={{ height: 22 }} />

      {/* ---------- Payouts ---------- */}
      <Text style={[type.label, styles.sectionLabel]}>payouts</Text>
      <GlassSurface radius={20} agent="monetizer">
        <Pressable
          onPress={refresh}
          style={styles.cardInner}
          accessibilityRole="button"
          accessibilityLabel="Refresh payout status"
          testID="payouts-card"
        >
          <View style={styles.row}>
            <Text style={[type.body, styles.cardTitle]}>Stripe Connect</Text>
            <Text
              style={[
                type.label,
                styles.statusPill,
                {
                  color: payoutsData
                    ? payoutsColor(payoutsData)
                    : "rgba(255,255,255,0.55)",
                },
              ]}
            >
              {payouts.isLoading
                ? "—"
                : payoutsData
                  ? payoutsLabel(payoutsData)
                  : "—"}
            </Text>
          </View>

          <Text style={[type.microDelight, styles.helper]}>
            {stripeOff
              ? "Payouts are not enabled on this server yet."
              : payoutsData?.onboarded
                ? "Your payout account is verified. Earnings will arrive on Stripe's standard schedule."
                : payoutsData?.accountId
                  ? "We need a few more details from you before payouts can start."
                  : "Connect a payout account to receive earnings from brand deals and direct revenue share."}
          </Text>

          <View style={styles.btnRow}>
            <Pressable
              onPress={onConnect}
              disabled={startConnect.isPending || stripeOff || payoutsData?.onboarded}
              style={({ pressed }) => [
                styles.btnPrimary,
                (pressed || startConnect.isPending) && styles.btnPressed,
                (stripeOff || payoutsData?.onboarded) && styles.btnDisabled,
              ]}
              accessibilityRole="button"
              accessibilityLabel="Set up payouts"
              testID="payouts-onboard"
            >
              {startConnect.isPending ? (
                <ActivityIndicator color="#0A0824" size="small" />
              ) : (
                <Text style={styles.btnPrimaryLabel}>
                  {payoutsData?.onboarded
                    ? "all set"
                    : payoutsData?.accountId
                      ? "continue setup"
                      : "set up payouts"}
                </Text>
              )}
            </Pressable>
          </View>
        </Pressable>
      </GlassSurface>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 22, marginTop: 28 },
  sectionLabel: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    letterSpacing: 1.6,
    textTransform: "uppercase",
    marginBottom: 12,
  },
  cardInner: { padding: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitle: { color: "#FFFFFF", fontSize: 16 },
  statusPill: {
    fontSize: 11,
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  helper: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 13,
    marginTop: 10,
    lineHeight: 19,
  },
  btnRow: { marginTop: 16, flexDirection: "row" },
  btnPrimary: {
    flex: 1,
    backgroundColor: "rgba(255,255,255,0.92)",
    borderRadius: 999,
    paddingVertical: 12,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  btnPrimaryLabel: {
    color: "#0A0824",
    fontSize: 13,
    letterSpacing: 1.4,
    textTransform: "uppercase",
    fontWeight: "600",
  },
  btnPressed: { opacity: 0.7 },
  btnDisabled: { opacity: 0.45 },
});
