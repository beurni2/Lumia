# W1.3 — Western Pattern-Engine Skeleton Distribution Fix · QA report

_10 batches per pass, region=western, single demo creator, fresh memory, regenerate cadence (batch 1 = false, 2..10 = true)._

## Summary (post-canonicalization + post-fallback re-application)

| metric | OFF (`LUMINA_W1_3_DISABLE_FOR_QA=1`) | ON (default) | delta |
|---|---:|---:|---:|
| batches | 10 | 10 | — |
| merged-pool size sum (at first selection) | 151 | 89 | -62 |
| merged repeated-family count sum | 22 | 2 | -20 |
| WEAK skeletonId pool occurrences (3 ids) | 70 | 16 | -54 |
| shipped weak-pattern hooks (regex) | 5/30 | 4/30 | — |
| cross-batch exact-hook dups | 0 | 0 | — |

## Top merged skeletons — OFF
- **totally_fine_about**: 45
- **is_it_really_still_about**: 25
- how_to_avoid_three_steps: 6
- whole_post_noun: 4
- noun_taking_notes: 3
- planned_to_handle: 3
- just_observing_disaster: 1

## Top merged skeletons — ON
- **is_it_really_still_about**: 9
- **totally_fine_about**: 7
- planned_to_handle: 5
- not_great_with_today: 3
- whole_post_noun: 3
- how_many_days_gets: 1
- noun_watching_decide: 1
- just_observing_disaster: 1
- noun_taking_notes: 1

## Shipped hooks — OFF
1. the gym and i are co-conspirators now
2. the sink itself hired a lawyer about my behavior
3. my own lens is dodging me back!!
4. WHY does the sink keep ignoring itself
5. i CANNOT stop avoiding the fork. i CANNOT
6. ⚠ I am totally fine about the package
7. someone explain the alarm to me. NOW
8. laundry day is cancelled... again
9. ⚠ I am totally fine about the front step
10. the tab itself isn't the problem. i am.
11. the gym itself isn't the problem. i am.
12. this is where the gift broke me
13. this is where the dishes broke me
14. the fork keeps dropping itself
15. the doc demolished my entire vibe
16. the gym bag taking notes about my life
17. ⚠ I am totally fine about the parked car
18. "i'll dodge the inbox later"... still pending
19. car parked for 20 minutes and i'm still in it
20. my own charger is ignoring me back!!
21. i CANNOT stop claiming the couch. i CANNOT
22. the toothbrush itself isn't the problem. i am.
23. how to avoid the gym bag in three steps
24. i checked one thing. ruined my day
25. i dodged my own calendar
26. is it still about the birthday thread
27. ⚠ I am totally fine about the errand list
28. the tasks drained the whole battery
29. ⚠ I am totally fine about the post
30. one inbox aged me 10 years visibly

## Shipped hooks — ON
1. the groupchat keeps revealing itself
2. the inbox ruined my villain arc
3. the fridge knows i'm lying
4. not great with the laundry
5. my body quit. my brain kept screaming
6. one gym aged me 10 years visibly
7. the inbox itself is the entire pattern
8. ⚠ I am totally fine about the wifi
9. ignoring the charger isn't recovery. it's panic.
10. WHY does the alarm keep snoozing itself
11. the shopping cart watching me decide nothing
12. ⚠ I am totally fine about the meal prep
13. the gym bag. that's the whole post.
14. ⚠ I am totally fine about the group chat
15. is it still about the errand list
16. the mirror broke me!! and I'M NOT FINE
17. is it still about the gym bag
18. ⚠ I am totally fine about the water bottle
19. the bed itself isn't the problem. i am.
20. the statement and i are still here. barely.
21. yesterday me booked chaos for today me's calendar
22. quiet realization: the inbox itself is anxiety now
23. the bio is freezing me. AGAIN.
24. i ignored the wallpaper AGAIN. AGAIN!!!
25. the alarm is judging me... again
26. the junk ruined my villain arc
27. quietly realized the towel itself is the personality
28. watched myself fake the gym live
29. my wardrobe vs the laundry mountain
30. i avoided the pan AGAIN. AGAIN!!!

## Non-western cohort smoke (NG pidgin / NG light / india / philippines, 3 batches each)
All 12 batches returned 3 ideas; `hasWestFunnel=false` confirms cohort gate; no errors.