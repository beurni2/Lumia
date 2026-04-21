import React, { useState } from "react";
import { View, Text, StyleSheet, Dimensions, Pressable } from "react-native";
import { useColors } from "@/hooks/useColors";
import { useAppState } from "@/hooks/useAppState";
import { useRouter } from "expo-router";
import * as Haptics from "expo-haptics";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  interpolateColor,
} from "react-native-reanimated";

const { width } = Dimensions.get("window");

const SLIDES = [
  {
    title: "Meet Your Swarm",
    description: "4 AI agents collaborating in real time to ideate, direct, edit, and monetize your content.",
  },
  {
    title: "Your Style Twin",
    description: "An AI trained on your best videos that knows your pacing, humor, and unique vibe.",
  },
  {
    title: "The Earnings Flywheel",
    description: "While you sleep, Lumina negotiates brand deals and pushes your viral potential to the max.",
  },
];

export default function OnboardingScreen() {
  const colors = useColors();
  const { setHasCompletedOnboarding } = useAppState();
  const router = useRouter();
  const [currentIndex, setCurrentIndex] = useState(0);

  const scrollX = useSharedValue(0);

  const handleNext = () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    if (currentIndex < SLIDES.length - 1) {
      setCurrentIndex((prev) => prev + 1);
    } else {
      setHasCompletedOnboarding(true);
      router.replace("/(tabs)");
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: colors.background }]}>
      <View style={styles.content}>
        <Text style={[styles.title, { color: colors.foreground }]}>
          {SLIDES[currentIndex].title}
        </Text>
        <Text style={[styles.description, { color: colors.mutedForeground }]}>
          {SLIDES[currentIndex].description}
        </Text>
      </View>

      <View style={styles.footer}>
        <View style={styles.dots}>
          {SLIDES.map((_, index) => (
            <View
              key={index}
              style={[
                styles.dot,
                {
                  backgroundColor:
                    currentIndex === index ? colors.primary : colors.border,
                },
              ]}
            />
          ))}
        </View>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: colors.primary, opacity: pressed ? 0.8 : 1 },
          ]}
          onPress={handleNext}
        >
          <Text style={[styles.buttonText, { color: colors.primaryForeground }]}>
            {currentIndex === SLIDES.length - 1 ? "Get Started" : "Next"}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 32,
    fontWeight: "bold",
    textAlign: "center",
    marginBottom: 16,
  },
  description: {
    fontSize: 18,
    textAlign: "center",
    lineHeight: 26,
  },
  footer: {
    paddingHorizontal: 32,
    paddingBottom: 64,
  },
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    marginBottom: 32,
    gap: 8,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  button: {
    paddingVertical: 18,
    borderRadius: 100,
    alignItems: "center",
  },
  buttonText: {
    fontSize: 18,
    fontWeight: "bold",
  },
});
