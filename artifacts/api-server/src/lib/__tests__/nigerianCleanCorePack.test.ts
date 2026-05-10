import { describe, expect, it } from "vitest";

import {
  NIGERIAN_CLEAN_CORE_ENTRIES,
  NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN,
  type NigerianCleanCoreEntry,
  canActivateNigerianCleanCorePack,
  classifyNigerianCleanCoreEntryFailure,
  isValidNigerianCleanCoreEntry,
} from "../nigerianCleanCorePack.js";
import { authorPackEntryAsIdea } from "../nigerianPackAuthor.js";
import type { NigerianPackEntry } from "../nigerianHookPack.js";
import { PREMISE_CORES } from "../premiseCoreLibrary.js";
import { VOICE_CLUSTERS } from "../voiceClusters.js";

// ---------------------------------------------------------------- //
// Test fixture builder — these strings live ONLY in tests, NEVER   //
// in the production catalog. They exist to exercise the validator   //
// helpers; they are not approved creative copy.                     //
// ---------------------------------------------------------------- //

function fixture(
  overrides: Partial<NigerianCleanCoreEntry> = {},
): NigerianCleanCoreEntry {
  return {
    id: "ng_clean_test_001",
    draftId: "DRAFT-NG-CLEAN-001",
    anchor: "generator",
    hook: "the generator stopped and everyone heard their own thoughts",
    whatToShow:
      "you sit by the generator with the room newly quiet, listening to nothing",
    howToFilm:
      "Static phone shot near the generator at chest height, then a slow lean back as the room goes quiet",
    caption: "the generator stopped speaking on our behalf",
    premiseFamily: "household_realities",
    voiceTone: "dry_observational",
    reviewedBy: "BI-CLEAN 2026-05-09",
    ...overrides,
  };
}

// ---------------------------------------------------------------- //
// Gate truth-table                                                  //
// ---------------------------------------------------------------- //

describe("canActivateNigerianCleanCorePack — gate truth-table", () => {
  it("activates for nigeria + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "nigeria",
        languageStyle: "clean",
      }),
    ).toBe(true);
  });

  it("OFF for nigeria + pidgin", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "nigeria",
        languageStyle: "pidgin",
      }),
    ).toBe(false);
  });

  it("OFF for nigeria + light_pidgin", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "nigeria",
        languageStyle: "light_pidgin",
      }),
    ).toBe(false);
  });

  it("OFF for nigeria + null languageStyle", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "nigeria",
        languageStyle: null,
      }),
    ).toBe(false);
  });

  it("OFF for nigeria + undefined languageStyle", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "nigeria",
        languageStyle: undefined,
      }),
    ).toBe(false);
  });

  it("OFF for nigeria + omitted languageStyle", () => {
    expect(canActivateNigerianCleanCorePack({ region: "nigeria" })).toBe(false);
  });

  it("OFF for western + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "western",
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("OFF for india + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "india",
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("OFF for philippines + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: "philippines",
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("OFF for null region + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: null,
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("OFF for undefined region + clean", () => {
    expect(
      canActivateNigerianCleanCorePack({
        region: undefined,
        languageStyle: "clean",
      }),
    ).toBe(false);
  });

  it("OFF for omitted region", () => {
    expect(canActivateNigerianCleanCorePack({ languageStyle: "clean" })).toBe(
      false,
    );
  });
});

// ---------------------------------------------------------------- //
// Empty catalog invariant                                           //
// ---------------------------------------------------------------- //

describe("NIGERIAN_CLEAN_CORE_ENTRIES — N1-CLEAN-CORE-P1 catalog invariant", () => {
  it("ships exactly 30 hand-authored entries", () => {
    expect(NIGERIAN_CLEAN_CORE_ENTRIES.length).toBe(30);
  });

  it("is a frozen array (cannot be mutated by callers)", () => {
    expect(Object.isFrozen(NIGERIAN_CLEAN_CORE_ENTRIES)).toBe(true);
  });

  it("module loads without throwing (boot-time validator passes for all 30)", async () => {
    // Re-import to assert the module-load assertion does not throw.
    await expect(
      import("../nigerianCleanCorePack.js"),
    ).resolves.toBeDefined();
  });

  it("every entry passes classifyNigerianCleanCoreEntryFailure", () => {
    const failures: Array<{ id: string; reason: string }> = [];
    for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
      const reason = classifyNigerianCleanCoreEntryFailure(entry);
      if (reason !== null) failures.push({ id: entry.id, reason });
    }
    expect(failures).toEqual([]);
  });

  it("ids are ng_clean_001..ng_clean_030, all distinct", () => {
    const ids = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(30);
    expect(ids[0]).toBe("ng_clean_001");
    expect(ids[29]).toBe("ng_clean_030");
  });

  it("draftIds are CLEAN-DRAFT-001..CLEAN-DRAFT-030, all distinct", () => {
    const draftIds = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.draftId);
    expect(new Set(draftIds).size).toBe(30);
    expect(draftIds[0]).toBe("CLEAN-DRAFT-001");
    expect(draftIds[29]).toBe("CLEAN-DRAFT-030");
  });

  it("hooks and howToFilm are intra-catalog distinct", () => {
    const hooks = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.hook);
    const howTo = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.howToFilm);
    expect(new Set(hooks).size).toBe(30);
    expect(new Set(howTo).size).toBe(30);
  });

  it("every entry carries the BI-CLEAN 2026-05-09 reviewer stamp", () => {
    for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
      expect(entry.reviewedBy).toBe("BI-CLEAN 2026-05-09");
    }
  });
});

// ---------------------------------------------------------------- //
// Validator helper — fixture-driven                                 //
// ---------------------------------------------------------------- //

describe("classifyNigerianCleanCoreEntryFailure — fixture cases", () => {
  it("accepts a clean Nigerian-English fixture", () => {
    const entry = fixture();
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBeNull();
    expect(isValidNigerianCleanCoreEntry(entry)).toBe(true);
  });

  it("rejects a pidgin-marker fixture (`dey` in hook)", () => {
    const entry = fixture({
      hook: "the generator dey behave like it owns me today",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "pidgin_marker_in_hook_or_what_to_show",
    );
  });

  it("rejects a pidgin-marker fixture (`abeg` in whatToShow)", () => {
    const entry = fixture({
      whatToShow:
        "you stand by the generator, abeg please just start one time",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "pidgin_marker_in_hook_or_what_to_show",
    );
  });

  it("rejects a shouty `AGAIN. AGAIN!!!` fixture", () => {
    const entry = fixture({
      hook: "the generator stopped AGAIN. AGAIN!!!",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "shouty_template_blocked_by_clean_core_guard",
    );
  });

  it("rejects a stereotype-token fixture (`NEPA` in caption)", () => {
    const entry = fixture({
      caption: "thanks NEPA, very cool",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "stereotype_token_in_hook_or_what_to_show_or_caption",
    );
  });

  it("rejects a stereotype-token fixture (`village people` in hook)", () => {
    const entry = fixture({
      hook: "the generator stopped because village people are working overtime",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "stereotype_token_in_hook_or_what_to_show_or_caption",
    );
  });

  it("rejects an old-filming-boilerplate fixture (`one take`)", () => {
    const entry = fixture({
      howToFilm:
        "Phone near the generator, one take, soft daylight from the window",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "filming_boilerplate_in_how_to_film",
    );
  });

  it("rejects an old-filming-boilerplate fixture (`Counter-level lock-off`)", () => {
    const entry = fixture({
      howToFilm: "Counter-level lock-off near the generator, hold for 8s",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "filming_boilerplate_in_how_to_film",
    );
  });

  it("rejects a missing-anchor-in-hook fixture", () => {
    const entry = fixture({
      hook: "the room got very quiet at the worst possible moment",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "anchor_not_in_hook",
    );
  });

  it("rejects a missing-anchor-in-whatToShow fixture", () => {
    const entry = fixture({
      whatToShow:
        "you sit in the suddenly quiet room and listen to your own breathing",
    });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "anchor_not_in_what_to_show",
    );
  });

  it("rejects a missing-reviewedBy fixture", () => {
    const entry = fixture({ reviewedBy: "" });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "missing_reviewed_by",
    );
  });

  it("rejects a missing-id fixture", () => {
    const entry = fixture({ id: "" });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe("missing_id");
  });

  it("rejects an empty-howToFilm fixture", () => {
    const entry = fixture({ howToFilm: "" });
    expect(classifyNigerianCleanCoreEntryFailure(entry)).toBe(
      "missing_how_to_film",
    );
  });
});

// ---------------------------------------------------------------- //
// PHASE N1-CLEAN-CORE-P1 (BI-CLEAN 2026-05-09) — runtime validator   //
// proof: every one of the 30 shipped entries must clear the FULL    //
// production validator path inside `authorPackEntryAsIdea`           //
// (ideaSchema + validateScenarioCoherence + validateComedy +         //
// validateAntiCopyDetailed). The boot-time entry validator covered   //
// only static field shape; this block is the architect-requested     //
// end-to-end runtime proof.                                          //
// ---------------------------------------------------------------- //

describe("NIGERIAN_CLEAN_CORE_ENTRIES — runtime validator pass (architect P1 fix)", () => {
  // Pin a stable core + voice so the run is deterministic and the
  // failure surface is the entry, not the fixture.
  const CORE = PREMISE_CORES[0]!;
  const VOICE = VOICE_CLUSTERS[0]!;

  for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
    it(`runtime-authors and validates: ${entry.id}`, () => {
      const projectedDomain =
        NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN[
          entry.premiseFamily
        ] ?? "everyday";
      const packShape: NigerianPackEntry = {
        hook: entry.hook,
        whatToShow: entry.whatToShow,
        howToFilm: entry.howToFilm,
        caption: entry.caption,
        anchor: entry.anchor,
        domain: projectedDomain,
        pidginLevel: "light_pidgin",
        reviewedBy: entry.reviewedBy,
      };
      const r = authorPackEntryAsIdea({
        entry: packShape,
        core: CORE,
        voice: VOICE,
        regenerateSalt: 0,
        seedFingerprints: new Set(),
      });
      // Surface the validator's structured rejection reason if any
      // entry slips, so curators can fix the bad row directly.
      if (!r.ok) {
        // eslint-disable-next-line no-console
        console.error(
          `clean-core entry ${entry.id} failed runtime validators:`,
          r,
        );
      }
      expect(r.ok).toBe(true);
    });
  }

  it("all 30 entries pass simultaneously (aggregate)", () => {
    const failed: string[] = [];
    for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
      const projectedDomain =
        NIGERIAN_CLEAN_CORE_PREMISE_FAMILY_TO_PACK_DOMAIN[
          entry.premiseFamily
        ] ?? "everyday";
      const packShape: NigerianPackEntry = {
        hook: entry.hook,
        whatToShow: entry.whatToShow,
        howToFilm: entry.howToFilm,
        caption: entry.caption,
        anchor: entry.anchor,
        domain: projectedDomain,
        pidginLevel: "light_pidgin",
        reviewedBy: entry.reviewedBy,
      };
      const r = authorPackEntryAsIdea({
        entry: packShape,
        core: CORE,
        voice: VOICE,
        regenerateSalt: 0,
        seedFingerprints: new Set(),
      });
      if (!r.ok) failed.push(entry.id);
    }
    expect(failed).toEqual([]);
  });
});
