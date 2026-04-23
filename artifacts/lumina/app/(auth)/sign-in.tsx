/**
 * Sign In — branded Lumina email/password sign-in built on the Clerk
 * Core v3 SignInFuture API (custom UI is required for Expo Go).
 */

import { useSignIn } from "@clerk/expo";
import { Link, useRouter, type Href } from "expo-router";
import React, { useCallback, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { AuthField } from "@/components/auth/AuthField";
import { AuthShell } from "@/components/auth/AuthShell";
import { PortalButton } from "@/components/foundation/PortalButton";
import { type } from "@/constants/typography";

export default function SignInScreen() {
  const { signIn, errors, fetchStatus } = useSignIn();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);

  const submitting = fetchStatus === "fetching";
  const canSubmit = !!email && !!password && !submitting;

  const handleSubmit = useCallback(async () => {
    setSubmitError(null);
    const { error } = await signIn.password({
      emailAddress: email,
      password,
    });
    if (error) {
      setSubmitError(error.message ?? "could not sign in");
      return;
    }
    if (signIn.status === "complete") {
      await signIn.finalize({
        navigate: () => router.replace("/onboarding"),
      });
    }
  }, [signIn, email, password, router]);

  return (
    <AuthShell
      title="welcome back"
      subtitle="your hive is waiting"
      footer={
        <View style={styles.footRow}>
          <Text style={[type.body, styles.footText]}>new here? </Text>
          <Link href={"/(auth)/sign-up" as Href} replace>
            <Text style={[type.body, styles.footLink]}>create account</Text>
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
        error={errors?.fields?.identifier?.message}
      />
      <AuthField
        label="password"
        secureTextEntry
        autoComplete="password"
        value={password}
        onChangeText={setPassword}
        placeholder="••••••••"
        error={errors?.fields?.password?.message}
      />

      {submitError ? (
        <Text style={styles.submitError}>{submitError}</Text>
      ) : null}

      <View style={{ height: 8 }} />
      <Pressable
        onPress={handleSubmit}
        disabled={!canSubmit}
        style={({ pressed }) => [
          styles.cta,
          !canSubmit && styles.ctaDisabled,
          pressed && styles.ctaPressed,
        ]}
      >
        <PortalButton
          label={submitting ? "entering…" : "enter the hive"}
          onPress={handleSubmit}
          disabled={!canSubmit}
        />
      </Pressable>
    </AuthShell>
  );
}

const styles = StyleSheet.create({
  cta: { marginTop: 4 },
  ctaDisabled: { opacity: 0.55 },
  ctaPressed: { opacity: 0.85 },
  submitError: {
    color: "#FF7A9C",
    fontSize: 13,
    marginBottom: 6,
    textAlign: "center",
  },
  footRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
  },
  footText: {
    color: "rgba(255,255,255,0.55)",
  },
  footLink: {
    color: "#7CD7FF",
    fontWeight: "600",
  },
});
