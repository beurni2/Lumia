/**
 * PHASE UX3.2 — AUTHORED SCENARIO PLANS
 *
 * Replaces generic "object + verb" scenario template substitution
 * with hand-authored, domain-specific scenario plans for the 10
 * highest-frequency anchors. Each plan answers, by construction:
 *
 *   1. What object/screen/place is shown?
 *   2. What physical action happens (concrete, performable)?
 *   3. What changes or gets revealed?
 *   4. What is the final visual payoff?
 *   5. Why does this match the hook? (the scene IS the contradiction
 *      the hook names — no abstract "{verb} the {anchor}" template
 *      stitching anywhere in the rendered text.)
 *
 * The cohesive author calls `selectAuthoredPlan(anchor, family)`
 * BEFORE rendering any generic shape templates. When a plan
 * matches, the author short-circuits the generic
 * showShapes/filmShapes/triggerShapes/reactionShapes/shotPlan
 * pools and renders the plan's pre-curated surfaces verbatim.
 *
 * The plan's `triggerVariants` / `reactionVariants` /
 * `captionVariants` are tiny pools (3-4 each) so the same authored
 * domain shipped twice in two different cores still varies across
 * batches without sliding back into template stiffness.
 *
 * No Claude. No DB. Pure / frozen at module load. Pre-frozen
 * `Object.freeze` discipline matches `coreDomainAnchorCatalog`
 * and `voiceClusters`.
 */

// ---------------------------------------------------------------- //
// Public types                                                      //
// ---------------------------------------------------------------- //

export type AuthoredDomainId =
  | "inbox"
  | "alarm"
  | "calendar"
  | "fridge"
  | "highlighter"
  | "gym"
  | "tab"
  | "profile"
  | "junk"
  | "mirror";

export type AuthoredScenarioPlan = {
  /** Stable id for telemetry + tests. Format: `aps_<domainId>`. */
  readonly planId: string;
  readonly domainId: AuthoredDomainId;
  /** Anchor tokens (single-word, lowercased) that route to this
   *  plan when seen at cohesive-author entry. Lookup is exact. */
  readonly anchors: ReadonlyArray<string>;
  /** Pre-rendered whatToShow. MUST literally contain the canonical
   *  anchor token AND read as a concrete shootable scene. */
  readonly whatToShow: string;
  /** Pre-rendered howToFilm. MUST literally contain the canonical
   *  anchor token AND describe a real camera setup the creator can
   *  execute alone. */
  readonly howToFilm: string;
  /** Three-beat shot plan: setup → action → payoff. Each entry is
   *  a discrete shoot direction (not "Lean into the X beat"). */
  readonly shotPlan: readonly [string, string, string];
  /** Tiny variant pools so the plan ships with controlled variety
   *  when reused across cores/anchors. djb2(`${core.id}|${anchor}|*`)
   *  picks the index in the cohesive author. */
  readonly triggerVariants: ReadonlyArray<string>;
  readonly reactionVariants: ReadonlyArray<string>;
  readonly captionVariants: ReadonlyArray<string>;
  /** Comfort-mode alternate instructions. Concrete sentences (NOT
   *  literal phrase swaps) appended to howToFilm by `film-this-now`
   *  when the creator activates `no_face` / `no_voice`. */
  readonly comfortNotes: {
    readonly no_face: string;
    readonly no_voice: string;
  };
};

// ---------------------------------------------------------------- //
// Plan library                                                      //
// ---------------------------------------------------------------- //
//
// Each plan was hand-written from the user's UX3.2 spec verbatim
// (the 10 "Good scene / Payoff" specs in the rejection report). Do
// NOT collapse multiple plans into a single template — the whole
// point of UX3.2 is that different domains need different concrete
// shoot directions, not a unified abstraction.

const PLANS: ReadonlyArray<AuthoredScenarioPlan> = [
  // 1. inbox / email / work messages
  Object.freeze({
    planId: "aps_inbox",
    domainId: "inbox",
    anchors: Object.freeze(["inbox"]),
    whatToShow:
      "Open the inbox on your laptop or phone. Hold on the unread count for one beat. " +
      "Start typing a reply, delete it, switch to another tab, then come back to the inbox " +
      "and mark nothing as read. Close the laptop halfway and then reopen it because the inbox is still there.",
    howToFilm:
      "Phone propped over your shoulder pointing at the laptop, or phone on a shelf with the inbox " +
      "screen filling most of the frame. Single take, no music. Cut the second you reopen the laptop after fake-closing it.",
    shotPlan: Object.freeze([
      "Setup: laptop or phone open to the inbox, unread count visible.",
      "Action: type a reply, delete it, switch tabs, come back to the inbox, mark nothing read.",
      "Payoff: close the laptop halfway, reopen it — the inbox didn't go anywhere.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Open the inbox and let the unread count sit on screen for a full beat.",
      "Land on the inbox tab, then immediately start typing a reply you won't send.",
      "Pull up the inbox with everything still unread.",
    ]),
    reactionVariants: Object.freeze([
      "Close the laptop halfway, then reopen it because the inbox didn't go away.",
      "Push the laptop two inches further away like that fixes the inbox.",
      "Stare at the unread count, then tab over to literally anything else.",
    ]),
    captionVariants: Object.freeze([
      "closed the laptop. reopened it. inbox still there. plot twist for nobody.",
      "12 unread, 0 read, 1 me pretending this isn't happening.",
      "the inbox is winning and i am, broadly, losing.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Frame the laptop screen only — phone over-the-shoulder or directly over the keyboard. Your hands appear when typing/deleting; your face never enters the shot.",
      no_voice:
        "No spoken line. Hook lands as on-screen caption text overlaid for the first beat, then let the screen interactions carry the scene with quiet ambient sound only.",
    }),
  }),

  // 2. alarm / sleep denial
  Object.freeze({
    planId: "aps_alarm",
    domainId: "alarm",
    anchors: Object.freeze(["alarm"]),
    whatToShow:
      "Phone on the nightstand or pillow with the alarm ringing on screen. " +
      "A hand reaches in and snoozes the alarm. The alarm rings again. " +
      "The hand slides the phone under the pillow or pulls the blanket over it while the alarm keeps buzzing. " +
      "End on the blanket slowly covering the alarm.",
    howToFilm:
      "Locked-off shot from the side of the bed, alarm screen visible the whole take. Just one hand and the phone in frame — face stays under the covers. " +
      "Single take, the alarm sound is the audio. Cut on the blanket fully covering the alarm.",
    shotPlan: Object.freeze([
      "Setup: phone on nightstand or pillow, alarm ringing on screen.",
      "Action: hand snoozes once; alarm rings again; hand slides phone under pillow/blanket.",
      "Payoff: blanket slowly drags over the buzzing alarm — denial, on camera.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Alarm rings on the phone with the screen lit and visible.",
      "Phone vibrating on the nightstand, alarm clock app full screen.",
      "Alarm goes off; one hand fumbles into frame to snooze the alarm.",
    ]),
    reactionVariants: Object.freeze([
      "Drag the blanket over the alarm and pretend that solves anything.",
      "Slide the alarm under the pillow while it keeps buzzing through the fabric.",
      "Snooze the alarm a third time and put your face back in the pillow.",
    ]),
    captionVariants: Object.freeze([
      "the alarm and i are in a fight. the alarm is winning.",
      "snoozed, snoozed, hid the alarm under a pillow. all life skills.",
      "buried the alarm under a blanket. it is still buzzing. so am i.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Frame stays on the alarm and the hand only — face stays buried under the blanket the entire take. The blanket itself becomes the final shot.",
      no_voice:
        "No voiceover. The alarm sound IS the audio. Hook + payoff land as captions. Let the buzzing through the blanket carry the punchline.",
    }),
  }),

  // 3. calendar / plans / regret
  Object.freeze({
    planId: "aps_calendar",
    domainId: "calendar",
    anchors: Object.freeze(["calendar"]),
    whatToShow:
      "Open the calendar on your phone (or a fake group-chat plan). Hold on the commitment from yesterday for a beat. " +
      "Sit there frozen, then start typing 'rain check?' and stop halfway through. " +
      "Pull the blanket higher or close the calendar app and put the phone face-down.",
    howToFilm:
      "Phone-in-hand framing from over your shoulder, the calendar visible on screen the whole take. " +
      "Or a couch shot with the calendar held up to the camera. Single take. Cut on the phone going face-down.",
    shotPlan: Object.freeze([
      "Setup: open the calendar to yesterday's commitment, hold for a beat.",
      "Action: start typing 'rain check?', hesitate, delete a few characters.",
      "Payoff: pull the blanket higher or flip the calendar face-down — yesterday-you booked this.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Open the calendar to today and look at what yesterday-you committed to.",
      "Pull up the group-chat plan from yesterday and reread it slowly.",
      "Tap the calendar event, see the time, freeze.",
    ]),
    reactionVariants: Object.freeze([
      "Type 'rain check?' and stop halfway through.",
      "Close the calendar and put the phone face-down on the blanket.",
      "Pull the blanket up to your chin and stare at the calendar event a second longer.",
    ]),
    captionVariants: Object.freeze([
      "yesterday me really booked this for present me. love that.",
      "the calendar said yes. me-today is filing an appeal.",
      "drafted 'rain check?' three times, sent zero, blanket: higher.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Phone-in-hand, screen-only framing — the calendar fills the frame. Hands appear; face stays out. The 'rain check?' typing IS the scene.",
      no_voice:
        "No voiceover. Hook as caption overlay, then the on-screen typing of 'rain check?' carries the beat. Background ambient only.",
    }),
  }),

  // 4. fridge / food denial
  Object.freeze({
    planId: "aps_fridge",
    domainId: "fridge",
    anchors: Object.freeze(["fridge"]),
    whatToShow:
      "Open the fridge. Stand there a beat looking at leftovers or vegetables. " +
      "Close the fridge. Immediately open a delivery app on your phone or grab a snack from the counter. " +
      "Walk back and close the fridge with respect, like the fridge won.",
    howToFilm:
      "Camera on a counter or shelf pointing at the fridge, you in profile so we see the open-then-close. " +
      "Single take. The phone or snack appears in the SAME shot. Cut on the second close.",
    shotPlan: Object.freeze([
      "Setup: open the fridge, hold on the leftovers / vegetables for a beat.",
      "Action: close the fridge, immediately open a delivery app on the phone (or grab a snack).",
      "Payoff: walk back and close the fridge gently, like it won this round.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Open the fridge and stare at the leftovers for one full beat.",
      "Open the fridge wide enough to see the vegetable drawer, then sigh.",
      "Pull the fridge door open and just look in.",
    ]),
    reactionVariants: Object.freeze([
      "Close the fridge gently, like apologizing.",
      "Shut the fridge and immediately open a delivery app.",
      "Close the fridge with both hands like it deserved more.",
    ]),
    captionVariants: Object.freeze([
      "opened the fridge for inspiration. left with takeout in the cart.",
      "the fridge had options. i chose 'something arrives at the door'.",
      "looked into the fridge. the fridge looked back. ordered noodles.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Hands-and-fridge framing only — camera low or side-on, you stay below the door. The phone delivery app appears in the same shot once you close the fridge.",
      no_voice:
        "No spoken line. Caption hook overlays the open-fridge shot, then the delivery app screen carries the punchline silently.",
    }),
  }),

  // 5. highlighter / study / school
  Object.freeze({
    planId: "aps_highlighter",
    domainId: "highlighter",
    anchors: Object.freeze(["highlighter"]),
    whatToShow:
      "Open notes or a textbook with the highlighter in hand. " +
      "Highlight one sentence. Then another sentence. Then the whole paragraph. Then the whole page. " +
      "Put the highlighter down slowly, like the highlighter just betrayed you.",
    howToFilm:
      "Top-down shot of the page and your hand with the highlighter — phone on a stack of books or a tripod arm. " +
      "Single take, the highlighter visible the whole time. Cut on the highlighter being placed down.",
    shotPlan: Object.freeze([
      "Setup: notes/textbook open, highlighter in hand, page mostly clean.",
      "Action: highlight one sentence, then another, then a paragraph, then the whole page.",
      "Payoff: put the highlighter down slowly — the page is now mostly highlighter, you understand less.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Pick up the highlighter and start on a clean page.",
      "Open the textbook and uncap the highlighter.",
      "Page is open, highlighter is ready, productivity is theoretical.",
    ]),
    reactionVariants: Object.freeze([
      "Put the highlighter down like it personally let you down.",
      "Set the highlighter on the page and stare at the yellow rectangle that used to be a paragraph.",
      "Cap the highlighter slowly — the page is more highlighter than text now.",
    ]),
    captionVariants: Object.freeze([
      "highlighted everything. understand nothing. study era.",
      "the highlighter and i had a productive session. nobody learned anything.",
      "step 1: highlight one line. step 47: highlight the whole page. brain: empty.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Top-down framing on the page only — your hand and the highlighter appear, your face stays out of frame. The expanding yellow IS the visual.",
      no_voice:
        "No voiceover. Hook lands as caption, then the silent highlighting sequence carries the joke. Pen-on-paper sound is the only audio.",
    }),
  }),

  // 6. gym / fitness avoidance
  Object.freeze({
    planId: "aps_gym",
    domainId: "gym",
    anchors: Object.freeze(["gym"]),
    whatToShow:
      "Put on gym shoes or open a fitness app on the phone. " +
      "Start moving toward the door. Stop, sit down to check your phone, and then keep sitting there. " +
      "End on you still sitting with the gym shoes on, the workout never started.",
    howToFilm:
      "Wide shot from across the room — couch / floor / hallway in frame so the door is visible behind you, gym shoes catching the light. " +
      "Single take. The phone scroll is real. Cut on a long held shot of you still seated with the gym shoes on.",
    shotPlan: Object.freeze([
      "Setup: lace up gym shoes or open the fitness app, head toward the door.",
      "Action: stop, sit down to check the phone, scroll for a beat.",
      "Payoff: still sitting there with the gym shoes on — the gym is theoretical.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Lace up the gym shoes and start walking toward the door.",
      "Open the fitness app for the gym session you swore you'd do.",
      "Gym shoes on, keys in hand, motion toward the door.",
    ]),
    reactionVariants: Object.freeze([
      "Sit down to check your phone, then never get back up.",
      "Drop onto the couch with the gym shoes still on and start scrolling.",
      "Stay seated long enough that the gym window has clearly closed.",
    ]),
    captionVariants: Object.freeze([
      "gym shoes: on. body at the gym: no. checked notifications instead.",
      "made it to the door. then to the couch. the gym remains a rumor.",
      "had a fitness app open and a couch open. the couch won.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Frame just the shoes and the floor — wide shot from low. We see the laces tighten, the steps to the door, the sit-down. Face never required.",
      no_voice:
        "No voiceover. Hook as caption, then the silent shoes-on-couch shot is the punchline. No music needed; the stillness IS the joke.",
    }),
  }),

  // 7. tab / browser / fake productivity
  Object.freeze({
    planId: "aps_tab",
    domainId: "tab",
    anchors: Object.freeze(["tab"]),
    whatToShow:
      "Open the laptop with one work tab. " +
      "Open another tab. Then another tab. Suddenly there are 12 tabs and the original task is untouched. " +
      "Close one tab proudly, like that counts as progress.",
    howToFilm:
      "Over-the-shoulder shot of the laptop or a clean screen-record of the tab bar. " +
      "Single take. Cut on the proud one-tab close.",
    shotPlan: Object.freeze([
      "Setup: laptop open, one work tab, cursor near the address bar.",
      "Action: open a tab, then another, then another — tab count climbs to 12, no task done.",
      "Payoff: close exactly one tab with a proud little nod. Progress, allegedly.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Open the laptop to the one work tab you're supposed to be on.",
      "Cursor is on the address bar of the work tab — what could go wrong.",
      "Stare at the work tab for one beat before opening a second one.",
    ]),
    reactionVariants: Object.freeze([
      "Close one tab and nod once like you accomplished something.",
      "Look at the 12-tab bar and close exactly one tab.",
      "Cmd-W a single tab, then sit back like productivity happened.",
    ]),
    captionVariants: Object.freeze([
      "12 tabs, 0 tasks. closed one. that's basically winning.",
      "started with one tab. now i have a parliament of tabs.",
      "opened a tab to focus. the focus is on the tab count now.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Pure screen recording or over-the-shoulder — the tab bar and cursor ARE the scene. Your hands appear on the trackpad; face never required.",
      no_voice:
        "No voiceover needed. Caption-only hook over the tab bar, the silent multiplication of tabs carries the rest.",
    }),
  }),

  // 8. profile / story-view mistake
  Object.freeze({
    planId: "aps_profile",
    domainId: "profile",
    anchors: Object.freeze(["profile"]),
    whatToShow:
      "Open a fake or demo profile on your phone. Scroll into the profile. " +
      "Accidentally tap or view something — story view, double-tap, whatever. Freeze. " +
      "Close the app too late, then put the phone down on the table like physical evidence.",
    howToFilm:
      "Phone in hand with the profile screen visible to camera (mirror the screen if you can). Or over-the-shoulder. " +
      "Single take. Cut on the phone hitting the table screen-down right after the profile tap.",
    shotPlan: Object.freeze([
      "Setup: open the app, scroll onto the profile.",
      "Action: accidentally tap / view a story / double-tap, then freeze.",
      "Payoff: close the app too late, set the phone down screen-down like evidence.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Scroll into the profile and let your thumb hover one beat too long.",
      "Open the profile and tap once before you mean to.",
      "Land on the profile, eyes wide, the worst tap is one second away.",
    ]),
    reactionVariants: Object.freeze([
      "Close the app too late and set the phone down screen-down on the table.",
      "Force-close the app and put the phone face-down like you're hiding evidence.",
      "Lock the phone, slide it under a pillow, do not breathe.",
    ]),
    captionVariants: Object.freeze([
      "viewed the profile by accident. the profile knows. nature is healing.",
      "tapped, regretted, force-closed. the profile saw everything anyway.",
      "thumb slipped onto the profile. now i live underground.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Phone-in-hand framing or over-the-shoulder — the profile screen + the thumb tap IS the shot. No face needed; the screen-down phone is the payoff.",
      no_voice:
        "No spoken line. Caption hook + the silent on-screen tap-then-freeze beat carries the joke. The phone hitting the table is the punctuation.",
    }),
  }),

  // 9. junk / room clutter
  Object.freeze({
    planId: "aps_junk",
    domainId: "junk",
    anchors: Object.freeze(["junk"]),
    whatToShow:
      "Camera shows a pile of junk on a desk, dresser, or chair. " +
      "Move one item off the junk pile. Reveal more junk underneath. " +
      "Put the item back like the junk pile has structural integrity. Walk away and call it 'organized.'",
    howToFilm:
      "Wide shot of the junk pile from waist height, you stepping into frame. Single take. " +
      "Cut on you walking out of frame after putting the item back on the junk.",
    shotPlan: Object.freeze([
      "Setup: wide shot of the junk pile in its full glory.",
      "Action: lift one item off the junk, reveal more junk underneath.",
      "Payoff: put the item back, walk out of frame — junk is now 'organized'.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Stand in front of the junk pile and pretend you're going to deal with it.",
      "Reach into the junk pile to move one specific item.",
      "Lift the top item off the junk pile with full intention.",
    ]),
    reactionVariants: Object.freeze([
      "Put the item back on the junk pile and walk out of frame.",
      "Set the item back gently, like the junk pile is load-bearing.",
      "Place the item back on top of the junk and call it organizing.",
    ]),
    captionVariants: Object.freeze([
      "moved one item. revealed more junk. put it back. organizing era.",
      "the junk pile is structural now. cannot legally remove it.",
      "lifted one thing off the junk pile. immediately put it back. growth.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Wide shot of the junk pile only — your hand enters to lift the item and place it back. No face needed; the junk pile IS the protagonist.",
      no_voice:
        "No voiceover. Caption hook on the wide junk shot. The silent lift-reveal-replace sequence carries everything.",
    }),
  }),

  // 10. mirror / confidence betrayal
  Object.freeze({
    planId: "aps_mirror",
    domainId: "mirror",
    anchors: Object.freeze(["mirror"]),
    whatToShow:
      "Walk into frame in front of a mirror, looking confident. " +
      "Catch your reflection, pause, lean closer to the mirror. " +
      "Immediately adjust the lighting or fix your hair. " +
      "Turn off the light or back away from the mirror like the mirror got personal.",
    howToFilm:
      "Camera in the mirror's reflection (phone on the counter pointed at the mirror) OR a side angle catching both you and the mirror. " +
      "Single take. Cut on you backing out of frame or the light going off.",
    shotPlan: Object.freeze([
      "Setup: walk into frame confident, mirror visible.",
      "Action: catch your reflection, pause, lean closer to the mirror, start adjusting hair / lighting.",
      "Payoff: turn off the light or back away — the mirror won this round.",
    ]) as readonly [string, string, string],
    triggerVariants: Object.freeze([
      "Walk into the bathroom looking confident, mirror straight ahead.",
      "Catch your reflection in the mirror mid-stride.",
      "Step into the mirror's frame like nothing's wrong.",
    ]),
    reactionVariants: Object.freeze([
      "Lean two inches closer to the mirror and immediately start fixing things.",
      "Reach for the lighting and adjust it like the mirror's the problem.",
      "Back away from the mirror and switch the light off.",
    ]),
    captionVariants: Object.freeze([
      "walked past the mirror confident. the mirror disagreed.",
      "the mirror and i had words. i lost. lighting now off.",
      "leaned closer to the mirror. should not have leaned closer to the mirror.",
    ]),
    comfortNotes: Object.freeze({
      no_face:
        "Skip the reflection — frame the mirror and the room only. Hand reaches in to adjust the lighting; the dimming light IS the payoff. No face needed.",
      no_voice:
        "No spoken line. Caption hook over the wide mirror shot, then the silent lean-in and light-off carries it.",
    }),
  }),
];

// ---------------------------------------------------------------- //
// Module-load assertions: every plan satisfies the quality floor    //
// ---------------------------------------------------------------- //

const _PLAN_BY_ANCHOR: Map<string, AuthoredScenarioPlan> = (() => {
  const m = new Map<string, AuthoredScenarioPlan>();
  for (const plan of PLANS) {
    // Every plan MUST literally include its anchor token in show + film
    // (so the cohesive author's existing
    // hookContainsAnchor / showContainsAnchor / filmContainsAnchor
    // construction precondition still passes for the authored path).
    for (const a of plan.anchors) {
      const al = a.toLowerCase();
      if (!plan.whatToShow.toLowerCase().includes(al)) {
        throw new Error(
          `[authoredScenarioPlans] plan ${plan.planId} whatToShow missing anchor token '${al}'`,
        );
      }
      if (!plan.howToFilm.toLowerCase().includes(al)) {
        throw new Error(
          `[authoredScenarioPlans] plan ${plan.planId} howToFilm missing anchor token '${al}'`,
        );
      }
      // Each plan slot (setup/action/payoff in shotPlan) MUST exist
      // and be a non-trivial sentence. Catches accidental empty
      // entries before they ship.
      for (const beat of plan.shotPlan) {
        if (!beat || beat.trim().length < 10) {
          throw new Error(
            `[authoredScenarioPlans] plan ${plan.planId} shotPlan beat too short: '${beat}'`,
          );
        }
      }
      if (
        plan.triggerVariants.length === 0 ||
        plan.reactionVariants.length === 0 ||
        plan.captionVariants.length === 0
      ) {
        throw new Error(
          `[authoredScenarioPlans] plan ${plan.planId} has empty variant pool`,
        );
      }
      if (m.has(al)) {
        throw new Error(
          `[authoredScenarioPlans] anchor '${al}' routed to two plans: ${m.get(al)!.planId} vs ${plan.planId}`,
        );
      }
      m.set(al, plan);
    }
  }
  // Coverage assert: all 10 listed UX3.2 domains must be present.
  const requiredAnchors = [
    "inbox", "alarm", "calendar", "fridge", "highlighter",
    "gym", "tab", "profile", "junk", "mirror",
  ];
  for (const a of requiredAnchors) {
    if (!m.has(a)) {
      throw new Error(
        `[authoredScenarioPlans] required UX3.2 anchor '${a}' has no plan`,
      );
    }
  }
  return m;
})();

// ---------------------------------------------------------------- //
// Public API                                                        //
// ---------------------------------------------------------------- //

/**
 * Returns the authored scenario plan that should be used for the
 * given (anchor) pair, or `null` when no plan is registered for the
 * anchor (caller falls back to the cohesive author's generic shape
 * templates).
 *
 * Lookup is exact on the lowercased anchor token. The `family`
 * parameter is currently unused but reserved — a future revision
 * may register family-specific plan variants for the same anchor.
 */
export function selectAuthoredPlan(
  anchor: string,
): AuthoredScenarioPlan | null {
  if (typeof anchor !== "string" || anchor.length === 0) return null;
  return _PLAN_BY_ANCHOR.get(anchor.toLowerCase()) ?? null;
}

/** Flat list of every plan (for tests + QA harness coverage sweeps). */
export function getAllAuthoredPlans(): ReadonlyArray<AuthoredScenarioPlan> {
  return PLANS;
}

/** Set of every anchor token routed to an authored plan. Used by
 *  the abstract-anchor denylist in the cohesive author's GENERIC
 *  fallback path so we never re-emit a "set down inbox" shape for
 *  an authored anchor that somehow slipped past plan selection. */
export function getAuthoredAnchorSet(): ReadonlySet<string> {
  return new Set(_PLAN_BY_ANCHOR.keys());
}

/** PHASE UX3.2 — abstract anchors where the generic template
 *  pool's "set the X down / pick the X up / put it back" verbs
 *  produce impossible-action emissions. The cohesive author's
 *  generic fallback substitutes a screen/prop alternative
 *  ("phone showing inbox", "gym shoes" etc.) BEFORE rendering
 *  any physical-verb sentence when the anchor is in this set
 *  AND no authored plan was selected.
 *
 *  Superset of the authored-anchor set so newly-added abstract
 *  anchors (e.g. "thread", "deadline", "week") get hardened
 *  generic fallback even before a plan is authored for them. */
export const ABSTRACT_ANCHORS: ReadonlySet<string> = new Set([
  // authored 10
  "inbox", "alarm", "calendar", "fridge", "highlighter",
  "gym", "tab", "profile", "junk", "mirror",
  // additional abstract surfaces still served by the generic path
  "thread", "groupchat", "invite", "rsvp", "tasks", "doc",
  "yoga", "pushups", "swipe", "bio", "app", "draft",
  "syllabus", "flashcards", "wallpaper", "lockscreen",
  // PHASE UX3.2 (post-architect-review) — additional money/social/
  // content catalog anchors that are screens / abstract concepts
  // and can't be physically picked up / set down / dodged on
  // camera. Without these the generic-template renderer would
  // still emit "set the venmo down" / "pick the savings up" /
  // "dodge the caption" / "carry the voicememo" for non-authored
  // domains served by the generic path.
  "venmo", "savings", "caption", "voicememo", "atm", "statement",
]);

/** PHASE UX3.2 — concrete prop substitution map. When the cohesive
 *  author's GENERIC fallback fires for an abstract anchor with no
 *  authored plan, the renderer swaps in the concrete prop from
 *  this table for the "object on camera" slot of the show
 *  template. The verb stays the anchor-aware verb (already
 *  resolved by `resolveAnchorAwareAction`).
 *
 *  Format: abstract anchor → concrete shootable prop phrase that
 *  contains the anchor token (so the existing showContainsAnchor
 *  precondition still passes). */
export const ABSTRACT_TO_CONCRETE_PROP: Readonly<Record<string, string>> = {
  inbox: "phone showing the inbox",
  alarm: "phone with the alarm ringing",
  calendar: "phone open to the calendar",
  gym: "gym shoes by the door",
  tab: "laptop with the work tab open",
  profile: "phone open to the profile",
  thread: "phone open to the thread",
  groupchat: "phone open to the groupchat",
  invite: "phone showing the invite",
  rsvp: "phone showing the rsvp",
  tasks: "phone open to the tasks list",
  doc: "laptop open to the doc",
  yoga: "yoga mat rolled out",
  pushups: "floor mat for the pushups",
  swipe: "phone open to the swipe screen",
  bio: "phone showing the bio",
  app: "phone with the app open",
  draft: "phone showing the draft",
  syllabus: "page of the syllabus",
  flashcards: "stack of flashcards",
  wallpaper: "phone showing the wallpaper",
  lockscreen: "phone on the lockscreen",
  highlighter: "page with the highlighter on it",
  fridge: "fridge door",
  junk: "junk pile",
  mirror: "mirror in the bathroom",
  // PHASE UX3.2 (post-architect-review) — concrete props for the
  // newly-added abstract money/social/content catalog anchors.
  venmo: "phone open to venmo",
  savings: "phone showing the savings balance",
  caption: "phone showing the caption draft",
  voicememo: "phone playing the voicememo",
  atm: "phone showing the atm receipt",
  statement: "phone showing the statement",
};

/** Ordered list of authored domain ids. Drives the per-domain
 *  rotation in `ux32LiveQa.ts` and the coverage table in the
 *  authored-plan vitest spec. */
export const AUTHORED_DOMAIN_IDS: ReadonlyArray<AuthoredDomainId> = [
  "inbox",
  "alarm",
  "calendar",
  "fridge",
  "highlighter",
  "gym",
  "tab",
  "profile",
  "junk",
  "mirror",
] as const;
