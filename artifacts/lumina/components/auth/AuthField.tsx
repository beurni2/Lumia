/**
 * AuthField — labeled text input with the bioluminescent glass treatment.
 */

import React from "react";
import {
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
  ...inputProps
}: TextInputProps & { label: string; error?: string }) {
  return (
    <View style={styles.wrap}>
      <Text style={[type.microDelight, styles.label]}>{label}</Text>
      <TextInput
        placeholderTextColor="rgba(255,255,255,0.35)"
        style={styles.input}
        {...inputProps}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { marginBottom: 14 },
  label: {
    color: "rgba(255,255,255,0.6)",
    marginBottom: 6,
    textTransform: "lowercase",
  },
  input: {
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: 14,
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

// Suppress unused import lint since lumina is referenced in future variants.
void lumina;
