/**
 * Sign Up — branded Lumina email/password sign-up with email-code
 * verification, built on the Clerk Core v3 SignUpFuture API.
 */

import { useSignUp } from "@clerk/expo";
import { Link, useRouter, type Href } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthField } from "@/components/auth/AuthField";
import { AuthShell } from "@/components/auth/AuthShell";
import { PortalButton } from "@/components/foundation/PortalButton";
import { type } from "@/constants/typography";
import { isWebQaMode } from "@/lib/qaMode";

export default function SignUpScreen() {
  // QA mode bypasses Clerk; the QaAwareRouter redirects away from
  // /(auth)/* before this screen mounts. This early-return is a
  // safety net so useSignUp() never runs without ClerkProvider.
  // isWebQaMode() is stable for a session, so calling 0 hooks vs
  // calling all hooks consistently across renders is rules-of-
  // hooks safe.
  if (isWebQaMode()) return null;

  const { signUp, errors, fetchStatus } = useSignUp();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitting = fetchStatus === "fetching";

  const handleStart = useCallback(async () => {
    setSubmitError(null);
    const { error } = await signUp.password({
      emailAddress: email,
      password,
    });
    if (error) {
      setSubmitError(error.message ?? "could not start sign-up");
      return;
    }
    await signUp.verifications.sendEmailCode();
  }, [signUp, email, password]);

  const handleVerify = useCallback(async () => {
    setSubmitError(null);
    const { error } = await signUp.verifications.verifyEmailCode({ code });
    if (error) {
      setSubmitError(error.message ?? "verification failed");
      return;
    }
    if (signUp.status === "complete") {
      await signUp.finalize({
        navigate: () => router.replace("/onboarding"),
      });
    }
  }, [signUp, code, router]);

  const needsVerification =
    signUp.status === "missing_requirements" &&
    signUp.unverifiedFields?.includes("email_address") &&
    signUp.missingFields?.length === 0;

  if (needsVerification) {
    return (
      <AuthShell
        eyebrow="act 0 · verification"
        title="check your inbox"
        subtitle={`we sent a code to ${email}`}
        mood={submitting ? "supernova" : code ? "excited" : "idle"}
      >
        <AuthField
          label="verification code"
          keyboardType="numeric"
          value={code}
          onChangeText={setCode}
          placeholder="123456"
          error={errors?.fields?.code?.message}
        />
        {submitError ? (
          <Text style={styles.submitError}>{submitError}</Text>
        ) : null}
        <View style={{ height: 8 }} />
        <PortalButton
          label={submitting ? "verifying…" : "verify"}
          onPress={handleVerify}
          disabled={!code || submitting}
        />
        <Pressable
          onPress={() => signUp.verifications.sendEmailCode()}
          style={styles.resend}
        >
          <Text style={[type.microDelight, styles.resendText]}>
            resend code
          </Text>
        </Pressable>
      </AuthShell>
    );
  }

  const canSubmit = !!email && !!password && !submitting;

  return (
    <AuthShell
      eyebrow="act 0 · arrival"
      title="join the swarm"
      subtitle="three taps and you're in"
      mood={submitting ? "supernova" : email || password ? "excited" : "idle"}
      footer={
        <View style={styles.footRow}>
          <Text style={[type.body, styles.footText]}>
            already have an account?{" "}
          </Text>
          <Link href={"/(auth)/sign-in" as Href} replace>
            <Text style={[type.body, styles.footLink]}>sign in</Text>
          </Link>
        </View>
      }
    >
      <AuthField
        label="email"
        autoCapitalize="none"
        autoComplete="email"
        keyboardType="email-address"
        value={email}
        onChangeText={setEmail}
        placeholder="you@studio.com"
        error={errors?.fields?.emailAddress?.message}
      />
      <AuthField
        label="password"
        secureTextEntry
        autoComplete="password-new"
        value={password}
        onChangeText={setPassword}
        placeholder="at least 8 characters"
        error={errors?.fields?.password?.message}
      />

      {submitError ? (
        <Text style={styles.submitError}>{submitError}</Text>
      ) : null}

      <View style={{ height: 8 }} />
      <PortalButton
        label={submitting ? "creating…" : "create account"}
        onPress={handleStart}
        disabled={!canSubmit}
      />

      {/* Required for sign-up flows — Clerk's bot protection mounts here. */}
      <View nativeID="clerk-captcha" />
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  submitError: {
    color: "#FF7A9C",
    fontSize: 13,
    marginBottom: 6,
    textAlign: "center",
  },
  resend: {
    marginTop: 14,
    alignSelf: "center",
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  resendText: {
    color: "#7CD7FF",
  },
  footRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
  },
  footText: {
    color: "rgba(255,255,255,0.55)",
  },
  footLink: {
    color: "#7CD7FF",
    fontWeight: "600",
  },
});
