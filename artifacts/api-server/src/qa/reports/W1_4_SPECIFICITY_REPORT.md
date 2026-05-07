# W1.4 — Western Hook Specificity Upgrade · QA report

_Generated: 2026-05-07T19:01:59.828Z · driver: `artifacts/api-server/src/qa/w14SpecificityQa.ts`_

Layer adds an orthogonal deterministic scoring layer on top of W1/W1.2/W1.3:
- Generic-template demotion: -10 per match, capped at -20 (10 templates curated from the W1.3 ON shipped sample).
- Specific-behavior reward: +5 per axis, capped at +15 across 4 axes (gerund opener, 'like X' comparison, 'X, then Y-ing' self-betrayal, concrete numeric duration).
- Cohort-gated to region undefined OR "western" only; non-prod kill-switch `LUMINA_W1_4_DISABLE_FOR_QA=1`.

## Western/default — OFF baseline vs ON

_OFF batches=6 (18 ideas) · ON batches=10 (30 ideas)_

| metric | OFF | ON | delta |
|---|---:|---:|---:|
| shipped weak-skeleton hits (W1 families) | 2/18 | 5/30 | 3 |
| shipped generic-template hits (W1.4 families) | 4/18 | 6/30 | 2 |
| shipped specific-behavior hits (W1.4 reward) | 0/18 | 0/30 | 0 |
| exact cross-batch duplicates | 0 | 0 | 0 |
| refresh success | 6/6 | 10/10 | — |
| errors | 0 | 0 | — |

OFF top weak families: anchor_knows_lying: 1; totally_fine_about_anchor: 1
OFF top template families: watched_myself_verb_anchor_live: 1; anchor_itself_is_abstract_noun: 1; quiet_realization_template: 1; drained_the_whole_battery: 1
ON  top weak families: totally_fine_about_anchor: 4; body_quit_brain_screaming: 1
ON  top template families: anchor_itself_is_abstract_noun: 1; anchor_itself_isnt_the_problem: 1; anchor_broke_me: 1; why_does_anchor_keep_verbing_itself: 1; repeated_emphatic_again: 1; quiet_realization_template: 1

## Strongest 20 shipped Western hooks (W1.4 ON)
- (+0) the gym bag taking notes about my life
- (+0) i SAID i'd dodge the inbox but NO
- (+0) the fridge keeps raiding itself
- (+0) the gym bag watching me decide nothing
- (+0) I really planned to handle the laptop ding
- (+0) "i'll snooze the alarm later"... still pending
- (+0) my own fridge is avoiding me back!!
- (+0) is it still about the meal prep
- (+0) not great with the laundry
- (+0) still dodging the inbox at midnight again
- (+0) the rsvp and i are still here. barely.
- (+0) my brain hates me after 11pm
- (+0) is it still about the fridge
- (+0) i can't keep leaving the bed!! BUT I WILL
- (+0) i SAID i'd skip the gym but NO
- (+0) avoiding the gym isn't recovery. it's panic.
- (+0) the dumbbell is ignoring me. AGAIN.
- (+0) i checked one thing. ruined my day
- (+0) still ignoring the earbuds at this hour
- (-2) I am totally fine about the parked car

## Weakest 20 shipped Western hooks (W1.4 ON)
- (-3) quiet realization: the fork itself is anxiety now
- (-3) i abandoned the inbox AGAIN. AGAIN!!!
- (-3) WHY does the calendar keep avoiding itself
- (-3) the lockscreen broke me!! and I'M NOT FINE
- (-3) the flashcards itself isn't the problem. i am.
- (-3) the inbox itself is the entire pattern
- (-2) I am totally fine about the water bottle
- (-2) I am totally fine about the bulb
- (-2) my body quit. my brain kept screaming
- (-2) I am totally fine about the to-do app
- (-2) I am totally fine about the parked car
- (+0) still ignoring the earbuds at this hour
- (+0) i checked one thing. ruined my day
- (+0) the dumbbell is ignoring me. AGAIN.
- (+0) avoiding the gym isn't recovery. it's panic.
- (+0) i SAID i'd skip the gym but NO
- (+0) i can't keep leaving the bed!! BUT I WILL
- (+0) is it still about the fridge
- (+0) my brain hates me after 11pm
- (+0) the rsvp and i are still here. barely.

## Non-western cohort smoke (each cohort independently gated)
- ng_pidgin: batches=3, ideas=9, weakHits=0, tmplHits=0, rewardHits=0, dupes=0, errors=0, refresh=3/3
- ng_light: batches=3, ideas=9, weakHits=0, tmplHits=1, rewardHits=0, dupes=0, errors=0, refresh=3/3
- india: batches=3, ideas=9, weakHits=2, tmplHits=2, rewardHits=0, dupes=0, errors=0, refresh=3/3
- philippines: batches=3, ideas=9, weakHits=2, tmplHits=1, rewardHits=0, dupes=0, errors=0, refresh=3/3

## Acceptance check
- Hard rules respected: NG pack/N1 flags/Pidgin scorer/India/PH untouched (helper short-circuits → 0 outside western/default cohort; verified by gate unit tests + shipped non-western smoke).
- Validators / anti-copy / safety / Claude prompts / QA thresholds NOT changed (W1.4 is a per-candidate signed scoring delta added at the same call site as W1).
- Western pack / corpus NOT introduced; this layer is purely a re-ranking signal.
- Scenario coherence preserved: hook is never replaced — the layer only re-ranks. Hooks that would break coherence are never substituted.
- W1 / W1.2 / W1.3 preserved: same call site, additive composition.

Pattern table: `WESTERN_GENERIC_TEMPLATE_PATTERNS.length=11` · weak skeletons (W1): 9.