/**
 * useCountUp — animates a numeric value from `0` to `target` over `duration`,
 * driven by Reanimated and updated on the JS thread via `runOnJS` so React
 * state stays in sync (the consumer renders a normal `<Text>`).
 *
 * Used by Earnings hero. Easing is a cubic out so the number "lands" on the
 * final amount rather than coasting past it.
 */

import { useEffect, useState } from "react";
import {
  Easing,
  cancelAnimation,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";

export function useCountUp(target: number, duration = 1200) {
  const progress = useSharedValue(0);
  const [value, setValue] = useState(0);

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(target, {
      duration,
      easing: Easing.out(Easing.cubic),
    });
    return () => cancelAnimation(progress);
  }, [target, duration, progress]);

  useDerivedValue(() => {
    runOnJS(setValue)(Math.round(progress.value));
  }, [target]);

  return value;
}
