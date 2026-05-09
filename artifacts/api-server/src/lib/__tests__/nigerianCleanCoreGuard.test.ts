import { describe, it, expect } from "vitest";

import {
  canApplyNigerianCleanCoreGuard,
  classifyNigerianCleanCoreHookBlock,
  isNigerianCleanCoreHookBlocked,
  NIGERIAN_CLEAN_CORE_GUARD_PATTERN_IDS,
} from "../nigerianCleanCoreGuard.js";

describe("canApplyNigerianCleanCoreGuard — gate truth table", () => {
  it("activates for region=nigeria + languageStyle=clean", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: "clean",
      }),
    ).toBe(true);
  });

  it("activates for region=nigeria + languageStyle=null", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: null,
      }),
    ).toBe(true);
  });

  it("activates for region=nigeria + languageStyle=undefined", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: undefined,
      }),
    ).toBe(true);
  });

  it("activates for region=nigeria with languageStyle field omitted", () => {
    expect(canApplyNigerianCleanCoreGuard({ region: "nigeria" })).toBe(true);
  });

  it("does NOT activate for region=nigeria + languageStyle=pidgin", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: "pidgin",
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=nigeria + languageStyle=light_pidgin", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: "light_pidgin",
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=western + clean", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "western",
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=western + null", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "western",
        languageStyle: null,
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=india + clean/null", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "india",
        languageStyle: "clean",
      }),
    ).toBe(false);
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "india",
        languageStyle: null,
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=philippines + clean/null", () => {
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "philippines",
        languageStyle: "clean",
      }),
    ).toBe(false);
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "philippines",
        languageStyle: null,
      }),
    ).toBe(false);
  });

  it("does NOT activate for region=undefined / null + clean/null", () => {
    expect(canApplyNigerianCleanCoreGuard({ languageStyle: "clean" })).toBe(
      false,
    );
    expect(
      canApplyNigerianCleanCoreGuard({
        region: null,
        languageStyle: null,
      }),
    ).toBe(false);
    expect(canApplyNigerianCleanCoreGuard({})).toBe(false);
  });
});

describe("classifyNigerianCleanCoreHookBlock — blocked patterns", () => {
  it("blocks the production-surfaced `i dodged the lockscreen AGAIN. AGAIN!!!`", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "i dodged the lockscreen AGAIN. AGAIN!!!",
      ),
    ).toBe("repeated_emphatic_again");
  });

  it("blocks `the inbox is dodging me. AGAIN.` (mild repeated AGAIN family — shouted_contradiction)", () => {
    // Audit §3 mild ng_clean leak. Caught by `shouted_contradiction`
    // (period + space + AGAIN), not by `repeated_emphatic_again`
    // which requires AGAIN…AGAIN. Either id is acceptable; we assert
    // it is rejected.
    expect(
      isNigerianCleanCoreHookBlocked("the inbox is dodging me. AGAIN."),
    ).toBe(true);
  });

  it("blocks `the inbox. the inbox!! AGAIN the inbox`", () => {
    expect(
      isNigerianCleanCoreHookBlocked("the inbox. the inbox!! AGAIN the inbox"),
    ).toBe(true);
  });

  it("blocks `i can't keep refreshing the inbox!! BUT I WILL`", () => {
    expect(
      isNigerianCleanCoreHookBlocked(
        "i can't keep refreshing the inbox!! BUT I WILL",
      ),
    ).toBe(true);
  });

  it("blocks `i CANNOT stop ignoring the dishes. i CANNOT`", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "i CANNOT stop ignoring the dishes. i CANNOT",
      ),
    ).toBe("i_cannot_stop_doubled");
  });

  it("blocks `WHY does the alarm keep snoozing itself`", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "WHY does the alarm keep snoozing itself",
      ),
    ).toBe("why_does_anchor_keep_verbing_itself");
  });

  it("blocks exclamation pile `OMG this is wild!!!`", () => {
    expect(classifyNigerianCleanCoreHookBlock("OMG this is wild!!!")).toBe(
      "punctuation_pile",
    );
  });

  it("blocks `someone explain the inbox to me. NOW`", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "someone explain the inbox to me. NOW",
      ),
    ).toBe("someone_explain_now_shout");
  });

  it("blocks `the towel broke me!! and i'm not fine`", () => {
    expect(
      isNigerianCleanCoreHookBlocked("the towel broke me!! and i'm not fine"),
    ).toBe(true);
  });

  it("blocks `STILL waiting. STILL waiting.` (repeated all-caps token)", () => {
    expect(
      classifyNigerianCleanCoreHookBlock("STILL waiting. STILL waiting."),
    ).toBe("repeated_all_caps_token");
  });
});

describe("classifyNigerianCleanCoreHookBlock — non-blocked hooks", () => {
  it("does NOT block a normal clean-English Nigerian hook", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "light disappeared mid-call and the power bank judged me",
      ),
    ).toBe(null);
  });

  it("does NOT block a quiet observational hook", () => {
    expect(
      classifyNigerianCleanCoreHookBlock(
        "the okada driver took one look and laughed at my outfit",
      ),
    ).toBe(null);
  });

  it("does NOT block a calm setup with a single exclamation point", () => {
    expect(
      classifyNigerianCleanCoreHookBlock("traffic on third mainland again!"),
    ).toBe(null);
  });

  it("does NOT block pidgin voice markers in isolation (those are not in scope)", () => {
    // Pidgin grammar markers in a quiet sentence — guard intentionally
    // does NOT block these. The Nigerian style penalty handles pidgin
    // gating at its own cohort gate (pidgin/light_pidgin only).
    expect(
      classifyNigerianCleanCoreHookBlock(
        "group chat don hijack my whole peace",
      ),
    ).toBe(null);
  });

  it("does NOT block an empty hook (defensive, returns null)", () => {
    expect(classifyNigerianCleanCoreHookBlock("")).toBe(null);
  });
});

describe("composition with cohort gate (integration-shape)", () => {
  it("ng_pidgin: the AGAIN!!! shape would block, but guard is gated off", () => {
    const hook = "i dodged the lockscreen AGAIN. AGAIN!!!";
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "nigeria",
        languageStyle: "pidgin",
      }),
    ).toBe(false);
    // Demonstrate that the pattern itself would have matched, so the
    // ng_pidgin pass-through is purely the gate's responsibility.
    expect(isNigerianCleanCoreHookBlocked(hook)).toBe(true);
  });

  it("western: same shape would block but guard is gated off", () => {
    const hook = "i dodged the lockscreen AGAIN. AGAIN!!!";
    expect(
      canApplyNigerianCleanCoreGuard({
        region: "western",
        languageStyle: "clean",
      }),
    ).toBe(false);
    expect(isNigerianCleanCoreHookBlocked(hook)).toBe(true);
  });

  it("ng_clean: gate active AND shape blocks → reject", () => {
    const hook = "i dodged the lockscreen AGAIN. AGAIN!!!";
    const gateActive = canApplyNigerianCleanCoreGuard({
      region: "nigeria",
      languageStyle: "clean",
    });
    expect(gateActive).toBe(true);
    expect(gateActive && isNigerianCleanCoreHookBlocked(hook)).toBe(true);
  });

  it("ng_null (internal): gate active AND shape blocks → reject", () => {
    const hook = "i dodged the lockscreen AGAIN. AGAIN!!!";
    const gateActive = canApplyNigerianCleanCoreGuard({
      region: "nigeria",
      languageStyle: null,
    });
    expect(gateActive).toBe(true);
    expect(gateActive && isNigerianCleanCoreHookBlocked(hook)).toBe(true);
  });
});

describe("pattern id surface (regression guard)", () => {
  it("exposes the expected pattern id set in declaration order", () => {
    expect(NIGERIAN_CLEAN_CORE_GUARD_PATTERN_IDS).toEqual([
      "repeated_emphatic_again",
      "i_cannot_keep_but_i_will",
      "i_cannot_stop_doubled",
      "anchor_triple_repeat_shout",
      "anchor_broke_me_shout",
      "why_does_anchor_keep_verbing_itself",
      "someone_explain_now_shout",
      "i_said_but_no_shout",
      "my_own_anchor_back_shout",
      "punctuation_pile",
      "repeated_all_caps_token",
      "shouted_contradiction",
    ]);
  });
});
