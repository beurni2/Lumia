import { validateHook, validateBigPremise, validateOutputLine } from "./src/lib/patternIdeator.ts";
const tests = [
  "this did not go well at all",
  "this went badly for everyone involved",
  "i had a system. the system fought back",
  "i had a system. the system won.",
  "a single notification flatlined my entire week",
  "scientists could write entire papers about my chaos",
  "scientists could write papers about this chaos",
  "no one should listen to 2am thoughts",
  "no one should trust me at 2am",
];
for (const h of tests) {
  console.log(JSON.stringify(h), "VH:", validateHook(h), "VBP:", validateBigPremise(h), "VOL:", validateOutputLine(h));
}
