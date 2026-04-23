/**
 * AuthField — labeled text input with the bioluminescent glass treatment.
 *
 * Focus state lights the border and shadow with the lumina core hue, and
 * a small leading "spark" dot pulses while the field is active so the
 * input feels alive in the same way the rest of the swarm does.
 */

import React, { useEffect, useRef, useState } from "react";
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TextInput,
  type TextInputProps,
  View,
} from "react-native";

import { lumina } from "@/constants/colors";
import { type } from "@/constants/typography";

export function AuthField({
  label,
  error,
  onFocus,
  onBlur,
  ...inputProps
}: TextInputProps & { label: string; error?: string }) {
  const [focused, setFocused] = useState(false);
  const glow = useRef(new Animated.Value(0)).current;
  const sparkPulse = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(glow, {
      toValue: focused ? 1 : 0,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: false,
    }).start();
  }, [focused, glow]);

  useEffect(() => {
    if (!focused) {
      sparkPulse.setValue(0);
      return;
    }
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(sparkPulse, {
          toValue: 1,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(sparkPulse, {
          toValue: 0,
          duration: 900,
          easing: Easing.inOut(Easing.quad),
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [focused, sparkPulse]);

  const borderColor = glow.interpolate({
    inputRange: [0, 1],
    outputRange: ["rgba(255,255,255,0.12)", "rgba(0,255,204,0.55)"],
  });
  const shadowOpacity = glow.interpolate({
    inputRange: [0, 1],
    outputRange: [0, 0.55],
  });
  const sparkOpacity = sparkPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.35, 1],
  });
  const sparkScale = sparkPulse.interpolate({
    inputRange: [0, 1],
    outputRange: [0.85, 1.15],
  });

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Animated.View
          style={[
            styles.spark,
            {
              opacity: focused ? sparkOpacity : 0,
              transform: [{ scale: focused ? sparkScale : 1 }],
            },
          ]}
        />
        <Text style={[type.microDelight, styles.label]}>{label}</Text>
      </View>
      <Animated.View
        style={[
          styles.inputWrap,
          {
            borderColor,
            shadowOpacity,
          },
        ]}
      >
        <TextInput
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.input}
          onFocus={(e) => {
            setFocused(true);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            setFocused(false);
            onBlur?.(e);
          }}
          {...inputProps}
        />
      </Animated.View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  labelRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 6,
    gap: 6,
  },
  label: {
    color: "rgba(255,255,255,0.6)",
    textTransform: "lowercase",
  },
  spark: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: lumina.core,
    shadowColor: lumina.core,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 6,
    shadowOpacity: 0.9,
  },
  inputWrap: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderRadius: 14,
    shadowColor: lumina.core,
    shadowOffset: { width: 0, height: 0 },
    shadowRadius: 14,
  },
  input: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: "#FFFFFF",
    fontSize: 15,
  },
  error: {
    color: "#FF7A9C",
    fontSize: 12,
    marginTop: 6,
  },
});
