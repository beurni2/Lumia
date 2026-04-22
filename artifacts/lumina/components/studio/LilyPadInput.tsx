/**
 * LilyPadInput — the bottom prompt bar of Swarm Studio.
 *
 * Anchored glassmorphism row with:
 *   • A soft, breathing input field (TextInput sitting in a GlassSurface)
 *   • A signature ✦ send button that brightens when text is present
 *   • Three "suggestion fireflies" rising from below the bar — each is
 *     a glowing pill of an alternate creative direction. Tap one to
 *     pre-fill the prompt; they bob with gentle drift physics so the
 *     bar always feels alive.
 *
 * The bar lifts with the keyboard via KeyboardAvoidingView in the parent.
 */

import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import React, { useEffect, useState } from "react";
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withSpring,
  withTiming,
} from "react-native-reanimated";

import { GlassSurface } from "@/components/foundation/GlassSurface";
import { lumina } from "@/constants/colors";
import { spring } from "@/constants/motion";
import { type } from "@/constants/typography";

type Props = {
  value: string;
  onChangeText: (v: string) => void;
  onSubmit: (v: string) => void;
  suggestions?: string[];
  disabled?: boolean;
};

export function LilyPadInput({
  value,
  onChangeText,
  onSubmit,
  suggestions = [],
  disabled = false,
}: Props) {
  const hasText = value.trim().length > 0;

  return (
    <View style={styles.wrap}>
      {/* Suggestion fireflies — bobbing chips above the input */}
      {suggestions.length > 0 && (
        <View style={styles.suggestRow}>
          {suggestions.slice(0, 3).map((s, i) => (
            <SuggestionFirefly
              key={s}
              text={s}
              delay={i * 220}
              phase={i}
              disabled={disabled}
              onPress={() => {
                if (disabled) return;
                if (Platform.OS !== "web") Haptics.selectionAsync();
                onChangeText(s);
              }}
            />
          ))}
        </View>
      )}

      <GlassSurface radius={28} agent="ideator" breathing>
        <View style={styles.row}>
          <Feather
            name="message-circle"
            size={18}
            color="rgba(255,255,255,0.55)"
            style={{ marginLeft: 14 }}
          />
          <TextInput
            value={value}
            onChangeText={onChangeText}
            placeholder="Tell the swarm what you want…"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={[type.body, styles.input]}
            editable={!disabled}
            multiline={false}
            returnKeyType="send"
            onSubmitEditing={() => hasText && onSubmit(value.trim())}
            blurOnSubmit
          />
          <Pressable
            disabled={!hasText || disabled}
            onPress={() => {
              if (Platform.OS !== "web") {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              }
              onSubmit(value.trim());
            }}
            accessibilityRole="button"
            accessibilityLabel="Send prompt to swarm"
            accessibilityState={{ disabled: !hasText || disabled }}
            style={[
              styles.sendBtn,
              {
                backgroundColor: hasText ? lumina.firefly : "rgba(255,255,255,0.08)",
                shadowColor: lumina.firefly,
                shadowOpacity: hasText ? 0.7 : 0,
              },
            ]}
            hitSlop={10}
          >
            <Text
              style={{
                color: hasText ? "#0A0824" : "rgba(255,255,255,0.4)",
                fontSize: 18,
                lineHeight: 20,
                fontWeight: "700",
              }}
            >
              ✦
            </Text>
          </Pressable>
        </View>
      </GlassSurface>
    </View>
  );
}

function SuggestionFirefly({
  text,
  delay,
  phase,
  onPress,
  disabled = false,
}: {
  text: string;
  delay: number;
  phase: number;
  onPress: () => void;
  disabled?: boolean;
}) {
  const bob = useSharedValue(0);

  useEffect(() => {
    bob.value = withRepeat(
      withTiming(1, {
        duration: 2400 + phase * 320,
        easing: Easing.inOut(Easing.sin),
      }),
      -1,
      true,
    );
  }, [bob, phase]);

  const style = useAnimatedStyle(() => {
    "worklet";
    return {
      transform: [
        { translateY: -bob.value * 4 },
        { translateX: (phase % 2 === 0 ? 1 : -1) * bob.value * 2 },
      ],
    };
  });

  return (
    <Animated.View
      entering={FadeIn.duration(420).delay(delay)}
      style={[styles.suggestChip, style]}
    >
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`Use suggestion: ${text}`}
        accessibilityState={{ disabled }}
        style={({ pressed }) => [
          styles.suggestInner,
          { opacity: disabled ? 0.4 : pressed ? 0.7 : 1 },
        ]}
      >
        <View style={styles.suggestDot} />
        <Text style={[type.microDelight, styles.suggestText]} numberOfLines={1}>
          {text}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  suggestRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
    paddingHorizontal: 4,
  },
  suggestChip: {
    borderRadius: 999,
    overflow: "hidden",
  },
  suggestInner: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(0,255,204,0.10)",
    borderWidth: 0.5,
    borderColor: "rgba(0,255,204,0.40)",
  },
  suggestDot: {
    width: 5,
    height: 5,
    borderRadius: 999,
    backgroundColor: lumina.firefly,
    shadowColor: lumina.firefly,
    shadowOpacity: 0.9,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 0 },
  },
  suggestText: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 6,
    paddingRight: 6,
  },
  input: {
    flex: 1,
    color: "#FFFFFF",
    paddingHorizontal: 10,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 15,
  },
  sendBtn: {
    width: 38,
    height: 38,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 10,
  },
});
