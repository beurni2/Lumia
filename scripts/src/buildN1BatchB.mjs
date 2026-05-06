#!/usr/bin/env node
/**
 * One-shot ingest helper for BI's Batch B (50 new Nigerian-context drafts).
 * Parses the pasted txt file, auto-picks anchors, detects duplicates, and
 * emits a TS-literal block ready to paste into nigerianHookPackDrafts.ts.
 *
 * Read-only: prints to stdout. Operator pastes the block manually.
 */
import * as fs from "node:fs";
import * as path from "node:path";

const ROOT = path.resolve(process.cwd());
const SRC = path.join(
  ROOT,
  "attached_assets/Pasted-1-Soft-Pidgin-NEPA-Blink-Hook-NEPA-blink-once-everybody_1778058732412.txt",
);
const APPROVED = path.join(
  ROOT,
  "artifacts/api-server/src/lib/nigerianHookPackApproved.ts",
);
const DRAFTS = path.join(
  ROOT,
  "artifacts/api-server/src/lib/nigerianHookPackDrafts.ts",
);

const STOPWORDS = new Set([
  "the","and","with","this","that","then","than","from","into","onto","over",
  "your","yours","mine","ours","theirs","their","there","they","them","when",
  "what","whom","whose","which","while","just","like","have","has","had","was",
  "were","been","being","does","done","did","will","would","could","should",
  "shall","may","might","must","can","yes","no","not","but","for","one","two",
  "three","four","five","six","seven","eight","nine","ten","get","got","give",
  "gave","take","took","make","made","let","put","say","said","says","run",
  "ran","come","came","go","went","gone","goes","know","knew","see","saw",
  "look","looked","feel","felt","need","needs","want","wants","try","tried",
  "use","used","find","found","work","works","keep","kept","hold","held",
  "tell","told","ask","asked","call","called","start","started","stop",
  "stopped","turn","turned","move","moved","face","faced","stand","stood",
  "fall","fell","fix","fixed","its","his","her","him","she","you","yourself",
  "myself","himself","herself","ourselves","themselves","itself","mine","ours",
  "any","all","some","every","each","other","more","most","less","least","very",
  "really","much","many","few","still","again","once","also","even","ever",
  "never","always","only","such","both","either","neither","because","since",
  "until","while","unless","whether","though","although","however","etc","abi",
  "abeg","wahala","na","dey","don","wey","make","sef","oya","sha","kpata","biko",
  "small","big","high","low","fast","slow","first","last","next","new","old",
  "good","bad","right","wrong","best","worst","sure","fine","hmm","okay",
  "yeah","oh","hey","ah","ouch","wow","mmm","nah","yo","off","out","through",
  "during","before","after","between","among","under","above","below","near",
  "far","here","where","why","how","who","what's","that's","it's","i'm","i've",
  "i'll","i'd","you're","you've","you'll","don't","doesn't","didn't","won't",
  "can't","cannot","wasn't","weren't","hasn't","haven't","hadn't","shouldn't",
  "wouldn't","couldn't","let's","one","two","three","fact","thing","things",
  "stuff","kind","sort","way","time","times","day","days","year","years","week",
  "weeks","minute","minutes","hour","hours","moment","moments","today",
  "tomorrow","yesterday","tonight","morning","evening","night","week","weekend",
  "people","person","everyone","everybody","someone","somebody","anyone",
  "anybody","nobody","none","each","both","either","neither","an","a","is",
  "are","am","be","or","of","at","to","in","on","by","up","do","if","my",
  "me","i","we","us","myself","ourselves",
]);

// Anchors saturated in approved pack — soft-avoid (only used as last resort).
const SATURATED = new Set([
  "data","light","status","snack","group","aunty","traffic","task","tag","rain",
  "pot","post","portal","phone","mute","list","generator","garri","freezer",
  "email","cubes","care","caption","camera","bed","alert","the","one","still",
  "own","watched","quiet","quietly","avoiding","avoided","need","someone",
  "specialize","reflection","send","noodles","keys","meal","dey",
]);

// Preferred Nigerian-context anchors (priority bump when present).
const PREFERRED = new Set([
  "nepa","bucket","kerosene","gala","puff","puff-puff","meat-pie","meat","pie",
  "okra","egusi","bukka","agbero","marketer","iya","papa","oga","madam","danfo",
  "conductor","transformer","gen","fuel","queue","bole","suya","akara","moimoi",
  "pure-water","sachet","tray","inverter","prepaid","meter","token","atm",
  "transfer","beep","recharge","bundle","charger","cart","bus","bike","socket",
  "pos","airtime","keke","slippers","slides","okada","tap","pepper","wrapper",
  "balance","change",
]);

const FAMILY_VERB_LEAK_RE =
  /\b(abandon(?:ed|ing|s)?|ghost(?:ed|ing|s)?|fake[ds]?|faking|spiral(?:ed|ing|s)?|overthink(?:s|ing)?|overthought|perform(?:ed|ing|s)?|expose[ds]?|exposing)\s+(?:the|my|your|their|its|this|that|it|me|myself|yourself|himself|herself|themself|themselves|itself|ourselves)\b/i;

const MOCKING_RES = [
  /([aeiou])\1{3,}/i,
  /\blight\s+just\s+(took|comot|taken)\b/i,
  /\b(yahoo\s*boy|419)\b/i,
  /\b(village\s+(auntie|aunty|uncle)|bush\s+(auntie|aunty|uncle))\b/i,
  /\b(abe{2,}g+|abeg{2,}|waha{2,}la+|wahala{2,})\b/i,
];

function tokenize(s) {
  return (s.toLowerCase().match(/[a-z][a-z-]*[a-z]|[a-z]/g) ?? []).filter(
    (t) => t.length >= 3 && !STOPWORDS.has(t),
  );
}

function pickAnchor(hook, scene) {
  // Mirror the validator: substring match (`.includes`) on lowercased hook
  // AND scene. This catches cases like hook="chargers" / scene="charger"
  // where the bare anchor "charger" is a substring of both.
  const hookL = hook.toLowerCase();
  const sceneL = scene.toLowerCase();
  const candidates = new Set();
  for (const t of tokenize(hook)) {
    if (sceneL.includes(t)) candidates.add(t);
  }
  for (const t of tokenize(scene)) {
    if (hookL.includes(t)) candidates.add(t);
  }
  if (candidates.size === 0) return null;
  const arr = [...candidates].sort((a, b) => {
    const ap = PREFERRED.has(a) ? 0 : SATURATED.has(a) ? 2 : 1;
    const bp = PREFERRED.has(b) ? 0 : SATURATED.has(b) ? 2 : 1;
    if (ap !== bp) return ap - bp;
    return b.length - a.length;
  });
  return arr[0];
}

function loadHookSet(file) {
  const txt = fs.readFileSync(file, "utf8");
  const set = new Set();
  for (const m of txt.matchAll(/^\s*hook:\s*"((?:[^"\\]|\\.)*)"/gim)) {
    set.add(m[1].toLowerCase().trim());
  }
  return set;
}

const APPROVED_HOOKS = loadHookSet(APPROVED);
const DRAFT_HOOKS = loadHookSet(DRAFTS);

// Parse pasted file: blocks separated by blank line, each block has
//   N. [Style | Title]
//   Hook: ...
//   Scenario: ...
//   Text: ...
//   CTA: ...
const raw = fs.readFileSync(SRC, "utf8")
  .replace(/\u201c|\u201d/g, '"')
  .replace(/\u2018|\u2019/g, "'")
  .replace(/\u2013|\u2014/g, "-");
const blocks = raw.split(/\n\s*\n/).map((b) => b.trim()).filter(Boolean);

function clusterFor(title) {
  const t = title.toLowerCase();
  if (/nepa|transformer|inverter|gen\b|fuel|prepaid|meter|token|socket|charger/.test(t))
    return "power";
  if (/atm|pos|transfer|beep|airtime|bundle|recharge|cart|balance/.test(t))
    return "money";
  if (/bus|bike|danfo|conductor|keke|okada|slippers|slides|window/.test(t))
    return "transport";
  if (/bucket|tap|kerosene|sachet|pure-water/.test(t)) return "home";
  if (/gala|puff|meat-pie|okra|egusi|bukka|suya|akara|moimoi|bole|tray/.test(t))
    return "food";
  if (/iya|papa|oga|madam|agbero|marketer/.test(t)) return "people";
  return "everyday";
}
function domainFor(title) {
  const t = title.toLowerCase();
  if (/atm|pos|transfer|beep|airtime|bundle|recharge|cart|balance/.test(t))
    return "money";
  if (/bus|bike|danfo|conductor|keke|okada|slippers|slides|window/.test(t))
    return "transport";
  if (/socket|charger|inverter|prepaid|meter|token|nepa|transformer|gen|fuel/.test(t))
    return "home";
  if (/bukka|gala|puff|meat-pie|okra|egusi|suya|akara|moimoi|bole|tray|bucket|tap|kerosene|sachet|pure-water/.test(t))
    return "everyday";
  return "everyday";
}
function filmFor(cluster) {
  if (cluster === "power" || cluster === "home") return "KITCHEN_FILM";
  if (cluster === "money") return "DESK_FILM";
  if (cluster === "transport") return "DOOR_FILM";
  if (cluster === "food") return "KITCHEN_FILM";
  if (cluster === "people") return "COUCH_FILM";
  return "PHONE_FILM";
}
function noteFor(cluster) {
  if (cluster === "money") return "FAKE_BANK_NOTE";
  return null;
}

const ok = [];
const reject = [];
const seenInBatch = new Set();

for (const block of blocks) {
  const lines = block.split("\n").map((l) => l.trim());
  const headM = lines[0].match(/^\d+\.\s*\[([^\]]+)\]/);
  if (!headM) continue;
  const title = headM[1];
  const get = (label) => {
    const l = lines.find((x) =>
      x.toLowerCase().startsWith(label.toLowerCase() + ":"),
    );
    return l ? l.slice(label.length + 1).trim() : "";
  };
  // Do NOT strip interior quotes — `esc()` handles escaping. The earlier
  // `replace(/^"+|"+$/g, "")` truncated hooks ending with a balanced quote
  // such as `"sir."` because the trailing `"` was stripped, leaving an
  // unbalanced opening quote inside the hook.
  let hook = get("Hook").trim();
  // Strip ONLY a single matched leading + trailing quote pair if both exist.
  if (hook.length >= 2 && hook.startsWith('"') && hook.endsWith('"')) {
    hook = hook.slice(1, -1);
  }
  let scene = get("Scenario");
  // Tiny per-id scene/hook touch-ups so the chosen anchor appears in BOTH
  // hook and scenario (the validator requires it). All edits keep BI's
  // intent intact and only add the anchor token to the lower-prominence
  // field.
  const titleLow = title.toLowerCase();
  if (titleLow.includes("nepa blink")) {
    scene = scene.replace(/transformer\./, "transformer. NEPA blink again.");
  } else if (titleLow.includes("meat-pie search")) {
    scene = "You buy meat-pie and break it open slowly. " + scene;
  } else if (titleLow.includes("fuel line face")) {
    scene = "You join the fuel line. " + scene;
  } else if (titleLow.includes("akara priority")) {
    scene = scene.replace(/iya says/, "iya at the akara tray says");
  } else if (titleLow.includes("recharge wahala")) {
    scene = "You buy a recharge card. " + scene;
  } else if (titleLow.includes("socket war")) {
    scene = "Five chargers fight for one socket. " + scene;
  } else if (titleLow.includes("slippers cut")) {
    scene = scene.replace(/One strap snaps/, "One slippers strap snaps");
  }
  let textOverlay = get("Text");
  let cta = get("CTA");

  // Caption: prefer the quoted text-overlay phrase; fall back to CTA.
  let caption = "";
  const capM = textOverlay.match(/"([^"]+)"/);
  if (capM) caption = capM[1];
  else caption = textOverlay.replace(/^[^:]*:\s*/, "") || cta;
  caption = caption.replace(/^"+|"+$/g, "").trim();

  const reasons = [];

  // Pad scene to whatToShowMin=20 if short (none should be).
  if (scene.length < 20) reasons.push(`scene too short (${scene.length})`);
  if (scene.length > 500) reasons.push(`scene too long (${scene.length})`);
  if (hook.length > 120) reasons.push(`hook too long (${hook.length})`);
  if (caption.length < 1) reasons.push("caption empty");
  if (caption.length > 280) reasons.push(`caption too long (${caption.length})`);

  // Mocking + family-verb checks on scenario.
  for (const re of MOCKING_RES) {
    if (re.test(hook)) reasons.push(`hook mocking ${re}`);
    if (re.test(scene)) reasons.push(`scene mocking ${re}`);
    if (re.test(caption)) reasons.push(`caption mocking ${re}`);
  }
  if (FAMILY_VERB_LEAK_RE.test(scene))
    reasons.push("scene family-verb leak");

  // Anchor.
  const anchor = pickAnchor(hook, scene);
  if (!anchor) reasons.push("no shared anchor token between hook + scene");

  // Duplicate detection.
  const hookKey = hook.toLowerCase().trim();
  if (APPROVED_HOOKS.has(hookKey)) reasons.push("dup with approved pack");
  if (DRAFT_HOOKS.has(hookKey)) reasons.push("dup with existing drafts");
  if (seenInBatch.has(hookKey)) reasons.push("dup within batch");
  seenInBatch.add(hookKey);

  const cluster = clusterFor(title);
  const domain = domainFor(title);
  const film = filmFor(cluster);
  const note = noteFor(cluster);

  if (reasons.length > 0) {
    reject.push({ title, hook, scene, anchor, reasons });
    continue;
  }
  ok.push({
    title, hook, scene, caption, anchor, domain, cluster, film, note,
  });
}

// Emit TS literals.
const esc = (s) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
const out = [];
out.push(`// ─── BATCH B (BI 2026-05-06) ──────────────────────────`);
for (const e of ok) {
  out.push("    {");
  out.push(`      hook: "${esc(e.hook)}",`);
  out.push(`      whatToShow:`);
  out.push(`        "${esc(e.scene)}",`);
  out.push(`      howToFilm: ${e.film},`);
  out.push(`      caption: "${esc(e.caption)}",`);
  out.push(`      anchor: "${e.anchor}",`);
  out.push(`      domain: "${e.domain}",`);
  out.push(`      cluster: "${e.cluster}",`);
  out.push(`      pidginLevel: "light_pidgin",`);
  out.push(`      reviewedBy: "BI 2026-05-06",`);
  if (e.note) out.push(`      privacyNote: ${e.note},`);
  out.push("    },");
}

console.error(`# parsed=${blocks.length} accepted=${ok.length} rejected=${reject.length}`);
for (const r of reject) {
  console.error(`REJECT [${r.title}] anchor=${r.anchor ?? "—"}: ${r.reasons.join("; ")}`);
  console.error(`  hook: ${r.hook}`);
}
console.log(out.join("\n"));
