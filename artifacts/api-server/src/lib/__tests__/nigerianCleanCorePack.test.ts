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

describe("NIGERIAN_CLEAN_CORE_ENTRIES — N1-CLEAN-CORE-P1+P2 catalog invariant", () => {
  // Post P16-A3-REVISION-IMPORT (BI-CLEAN-P16A3-REVISION 2026-05-12):
  // P1: 30 + P2: 30 + P3: 1 + P3-HUMAN-FIRST: 3 + IMPLICIT-ANTHROPOMORPH
  // surviving: 2 + P16-A2 human-feel survivors: 3 + P16-A3 human-batch
  // survivors: 5 + P16-A3-REVISION survivors: 13 = 87 entries. Slot
  // ids ng_clean_065..069 were user-rejected for cohort fit and removed
  // from the corpus; their numeric slots are intentionally GAPPED
  // (070, 071 retained at their original ids). P16-A2 added
  // ng_clean_072 (HUMAN_005), ng_clean_073 (HUMAN_007), ng_clean_074
  // (HUMAN_020). P16-A3 added ng_clean_075 (HUMAN_001), 076 (HUMAN_002),
  // 077 (HUMAN_003), 090 (HUMAN_016), 092 (HUMAN_018). P16-A3-REVISION
  // added ng_clean_078 (HUMAN_004), 079 (005), 081 (007), 082 (008),
  // 083 (009), 084 (010), 085 (011), 086 (012), 087 (013), 089 (015),
  // 091 (017), 093 (019), 094 (020). Numeric slots 080 + 088 remain
  // intentionally GAPPED — HUMAN_006 (HQS ON 35 below boot floor 40)
  // and HUMAN_014 (HQS ON 45 below picker floor 50) are still HELD
  // below scorer floor; the gaps preserve the supervisor's exact ID
  // mapping for audit (P16-A3 packet 075..094 ← HUMAN_001..020). See
  // the in-corpus P16-A3 + P16-A3-REVISION comment blocks.
  it("ships exactly 87 hand-authored entries (P1: 30 + P2: 30 + P3: 1 + P3-HUMAN-FIRST: 3 + IMPLICIT-ANTHROPOMORPH-SURVIVING: 2 + P16-A2-HUMAN-FEEL-SURVIVING: 3 + P16-A3-HUMAN-BATCH-SURVIVING: 5 + P16-A3-REVISION-SURVIVING: 13)", () => {
    expect(NIGERIAN_CLEAN_CORE_ENTRIES.length).toBe(87);
  });

  it("is a frozen array (cannot be mutated by callers)", () => {
    expect(Object.isFrozen(NIGERIAN_CLEAN_CORE_ENTRIES)).toBe(true);
  });

  it("module loads without throwing (boot-time validator passes for all 66)", async () => {
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

  it("ids are ng_clean_001..ng_clean_064 + ng_clean_070..ng_clean_079 + ng_clean_081..ng_clean_087 + ng_clean_089..ng_clean_094 (intentional gaps at 065-069 + 080 + 088), all distinct", () => {
    const ids = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.id);
    expect(new Set(ids).size).toBe(87);
    expect(ids[0]).toBe("ng_clean_001");
    expect(ids[29]).toBe("ng_clean_030");
    expect(ids[30]).toBe("ng_clean_031");
    expect(ids[59]).toBe("ng_clean_060");
    expect(ids[60]).toBe("ng_clean_061");
    expect(ids[61]).toBe("ng_clean_062");
    expect(ids[63]).toBe("ng_clean_064");
    // Gap: 065..069 removed. Index 64 is now ng_clean_070, index 65 is 071.
    expect(ids[64]).toBe("ng_clean_070");
    expect(ids[65]).toBe("ng_clean_071");
    // P16-A2 supervisor-signoff additions.
    expect(ids[66]).toBe("ng_clean_072");
    expect(ids[67]).toBe("ng_clean_073");
    expect(ids[68]).toBe("ng_clean_074");
    // P16-A3 supervisor-signoff additions (5 of 20 packet survivors)
    // interleaved with P16-A3-REVISION (13 of the originally
    // rejected/held set, now anchor-fixed by the supervisor).
    expect(ids[69]).toBe("ng_clean_075"); // P16-A3   ← HUMAN_001
    expect(ids[70]).toBe("ng_clean_076"); // P16-A3   ← HUMAN_002
    expect(ids[71]).toBe("ng_clean_077"); // P16-A3   ← HUMAN_003
    expect(ids[72]).toBe("ng_clean_078"); // REVISION ← HUMAN_004
    expect(ids[73]).toBe("ng_clean_079"); // REVISION ← HUMAN_005
    // GAP at 080 (HUMAN_006 still HELD below boot floor)
    expect(ids[74]).toBe("ng_clean_081"); // REVISION ← HUMAN_007
    expect(ids[75]).toBe("ng_clean_082"); // REVISION ← HUMAN_008
    expect(ids[76]).toBe("ng_clean_083"); // REVISION ← HUMAN_009
    expect(ids[77]).toBe("ng_clean_084"); // REVISION ← HUMAN_010
    expect(ids[78]).toBe("ng_clean_085"); // REVISION ← HUMAN_011
    expect(ids[79]).toBe("ng_clean_086"); // REVISION ← HUMAN_012
    expect(ids[80]).toBe("ng_clean_087"); // REVISION ← HUMAN_013
    // GAP at 088 (HUMAN_014 still HELD below picker floor)
    expect(ids[81]).toBe("ng_clean_089"); // REVISION ← HUMAN_015
    expect(ids[82]).toBe("ng_clean_090"); // P16-A3   ← HUMAN_016
    expect(ids[83]).toBe("ng_clean_091"); // REVISION ← HUMAN_017
    expect(ids[84]).toBe("ng_clean_092"); // P16-A3   ← HUMAN_018
    expect(ids[85]).toBe("ng_clean_093"); // REVISION ← HUMAN_019
    expect(ids[86]).toBe("ng_clean_094"); // REVISION ← HUMAN_020
    // Hard guarantee: none of the rejected/held ids appear.
    const idSet = new Set(ids);
    for (const rejected of [
      "ng_clean_065",
      "ng_clean_066",
      "ng_clean_067",
      "ng_clean_068",
      "ng_clean_069",
      "ng_clean_080", // HUMAN_006 — HELD (HQS ON 35 < boot floor 40)
      "ng_clean_088", // HUMAN_014 — HELD (HQS ON 45 < picker floor 50)
    ]) {
      expect(idSet.has(rejected)).toBe(false);
    }
  });

  it("draftIds are CLEAN-DRAFT-001..064 + CLEAN-DRAFT-070..071 + supplied P16-A2 + P16-A3 + P16-A3-REVISION IDs (intentional gap at 065-069), all distinct", () => {
    const draftIds = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.draftId);
    expect(new Set(draftIds).size).toBe(87);
    expect(draftIds[0]).toBe("CLEAN-DRAFT-001");
    expect(draftIds[29]).toBe("CLEAN-DRAFT-030");
    expect(draftIds[30]).toBe("CLEAN-DRAFT-031");
    expect(draftIds[59]).toBe("CLEAN-DRAFT-060");
    expect(draftIds[63]).toBe("CLEAN-DRAFT-064");
    expect(draftIds[64]).toBe("CLEAN-DRAFT-070");
    expect(draftIds[65]).toBe("CLEAN-DRAFT-071");
    // P16-A2 — supplied packet IDs preserved verbatim as draftId
    // (import trace per packet rule "If the import format requires a
    // replaceId, preserve the supplied ID as the replace/import trace.").
    expect(draftIds[66]).toBe("CLEAN_P16A1_HUMAN_005");
    expect(draftIds[67]).toBe("CLEAN_P16A1_HUMAN_007");
    expect(draftIds[68]).toBe("CLEAN_P16A1_HUMAN_020");
    // P16-A3 + P16-A3-REVISION — same convention; supplied packet IDs
    // preserved verbatim. Listed in array (id-sorted) order:
    expect(draftIds[69]).toBe("CLEAN_P16A2_HUMAN_001"); // 075
    expect(draftIds[70]).toBe("CLEAN_P16A2_HUMAN_002"); // 076
    expect(draftIds[71]).toBe("CLEAN_P16A2_HUMAN_003"); // 077
    expect(draftIds[72]).toBe("CLEAN_P16A2_HUMAN_004"); // 078 REVISION
    expect(draftIds[73]).toBe("CLEAN_P16A2_HUMAN_005"); // 079 REVISION
    expect(draftIds[74]).toBe("CLEAN_P16A2_HUMAN_007"); // 081 REVISION
    expect(draftIds[75]).toBe("CLEAN_P16A2_HUMAN_008"); // 082 REVISION
    expect(draftIds[76]).toBe("CLEAN_P16A2_HUMAN_009"); // 083 REVISION
    expect(draftIds[77]).toBe("CLEAN_P16A2_HUMAN_010"); // 084 REVISION
    expect(draftIds[78]).toBe("CLEAN_P16A2_HUMAN_011"); // 085 REVISION
    expect(draftIds[79]).toBe("CLEAN_P16A2_HUMAN_012"); // 086 REVISION
    expect(draftIds[80]).toBe("CLEAN_P16A2_HUMAN_013"); // 087 REVISION
    expect(draftIds[81]).toBe("CLEAN_P16A2_HUMAN_015"); // 089 REVISION
    expect(draftIds[82]).toBe("CLEAN_P16A2_HUMAN_016"); // 090
    expect(draftIds[83]).toBe("CLEAN_P16A2_HUMAN_017"); // 091 REVISION
    expect(draftIds[84]).toBe("CLEAN_P16A2_HUMAN_018"); // 092
    expect(draftIds[85]).toBe("CLEAN_P16A2_HUMAN_019"); // 093 REVISION
    expect(draftIds[86]).toBe("CLEAN_P16A2_HUMAN_020"); // 094 REVISION
    const draftSet = new Set(draftIds);
    for (const rejected of [
      "CLEAN-DRAFT-065",
      "CLEAN-DRAFT-066",
      "CLEAN-DRAFT-067",
      "CLEAN-DRAFT-068",
      "CLEAN-DRAFT-069",
    ]) {
      expect(draftSet.has(rejected)).toBe(false);
    }
    // P16-A3-REVISION — only the 2 still-HELD packet IDs (HUMAN_006 +
    // HUMAN_014) MUST NOT appear as draftIds; all other revision IDs
    // were imported above.
    for (const held of [
      "CLEAN_P16A2_HUMAN_006", // HQS ON 35 < boot floor 40
      "CLEAN_P16A2_HUMAN_014", // HQS ON 45 < picker floor 50
    ]) {
      expect(draftSet.has(held)).toBe(false);
    }
  });

  it("hooks and howToFilm are intra-catalog distinct", () => {
    const hooks = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.hook);
    const howTo = NIGERIAN_CLEAN_CORE_ENTRIES.map((e) => e.howToFilm);
    expect(new Set(hooks).size).toBe(87);
    expect(new Set(howTo).size).toBe(87);
    // None of the 9 rejected hook strings (5 imported + 4 never imported)
    // appear in the corpus after the cleanup.
    const lc = new Set(hooks.map((h) => h.toLowerCase().trim()));
    const REJECTED_HOOKS_LC = [
      "the bank app smiled before rejecting my confidence.",
      "the pos receipt printed slower than my excuses.",
      "the group chat appointed me without discussion.",
      "the doorbell rang while i was acting serious.",
      "the email subject already sounded like extra work.",
      "the delivery code made me sound suspicious outside.",
      "the room door opened during my serious content.",
      "the extension box turned charging into family politics.",
      "the front camera corrected my whole confidence.",
    ];
    for (const h of REJECTED_HOOKS_LC) {
      expect(lc.has(h)).toBe(false);
    }
  });

  it("every entry carries a BI-CLEAN reviewer stamp (P1+P2: 2026-05-09; P3 + P3-HUMAN-FIRST + surviving anthropomorph: 2026-05-10; P16-A2 + P16-A3 + P16-A3-REVISION human-feel: 2026-05-12)", () => {
    const ALLOWED_STAMPS = new Set([
      "BI-CLEAN 2026-05-09", // P1 (1..30) and P2 (31..60)
      "BI-CLEAN 2026-05-10", // P3 (61), P3-HUMAN-FIRST (62..64), surviving anth (070,071)
      "BI-CLEAN-P16A2 2026-05-12", // P16-A2 human-feel survivors (072,073,074)
      "BI-CLEAN-P16A3 2026-05-12", // P16-A3 human-batch survivors (075,076,077,090,092)
      "BI-CLEAN-P16A3-REVISION 2026-05-12", // P16-A3-REVISION (078,079,081-087,089,091,093,094)
    ]);
    for (const entry of NIGERIAN_CLEAN_CORE_ENTRIES) {
      expect(ALLOWED_STAMPS.has(entry.reviewedBy)).toBe(true);
    }
    // First 60 entries (P1+P2) MUST still carry the original stamp — protects
    // against accidental rewrites of the existing curator-approved corpus.
    for (let i = 0; i < 60; i++) {
      expect(NIGERIAN_CLEAN_CORE_ENTRIES[i]!.reviewedBy).toBe(
        "BI-CLEAN 2026-05-09",
      );
    }
    // Entries 61..66 (P3 + P3-HUMAN-FIRST + 2 surviving IMPLICIT-ANTHROPOMORPH)
    // MUST carry the BI-CLEAN 2026-05-10 stamp.
    for (let i = 60; i < 66; i++) {
      expect(NIGERIAN_CLEAN_CORE_ENTRIES[i]!.reviewedBy).toBe(
        "BI-CLEAN 2026-05-10",
      );
    }
    // Entries 67..69 (P16-A2 human-feel survivors: ng_clean_072..074)
    // MUST carry the supervisor-supplied BI-CLEAN-P16A2 stamp.
    for (let i = 66; i < 69; i++) {
      expect(NIGERIAN_CLEAN_CORE_ENTRIES[i]!.reviewedBy).toBe(
        "BI-CLEAN-P16A2 2026-05-12",
      );
    }
    // P16-A3 (5) + P16-A3-REVISION (13) interleave by id-sorted order
    // across indices 69..86. Assert the two stamps individually by id
    // since the two batches are interleaved (075 P16A3 / 078 REVISION /
    // 090 P16A3 / 091 REVISION / 092 P16A3 / 094 REVISION etc).
    const P16A3_IDS = new Set([
      "ng_clean_075",
      "ng_clean_076",
      "ng_clean_077",
      "ng_clean_090",
      "ng_clean_092",
    ]);
    const P16A3_REVISION_IDS = new Set([
      "ng_clean_078",
      "ng_clean_079",
      "ng_clean_081",
      "ng_clean_082",
      "ng_clean_083",
      "ng_clean_084",
      "ng_clean_085",
      "ng_clean_086",
      "ng_clean_087",
      "ng_clean_089",
      "ng_clean_091",
      "ng_clean_093",
      "ng_clean_094",
    ]);
    for (let i = 69; i < 87; i++) {
      const entry = NIGERIAN_CLEAN_CORE_ENTRIES[i]!;
      if (P16A3_IDS.has(entry.id)) {
        expect(entry.reviewedBy).toBe("BI-CLEAN-P16A3 2026-05-12");
      } else if (P16A3_REVISION_IDS.has(entry.id)) {
        expect(entry.reviewedBy).toBe("BI-CLEAN-P16A3-REVISION 2026-05-12");
      } else {
        throw new Error(
          `Unexpected id at index ${i}: ${entry.id} (not in P16A3 or P16A3-REVISION sets)`,
        );
      }
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
// proof: every one of the 66 shipped entries (P1:30 + P2:30 + P3:1 +    //
// P3-HUMAN-FIRST:3 + IMPLICIT-ANTHROPOMORPH-SURVIVING:2; the 5         //
// user-rejected ng_clean_065..069 entries were removed from the corpus)//
// must clear the FULL                                                //
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

  it("all 66 entries pass simultaneously (aggregate)", () => {
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
