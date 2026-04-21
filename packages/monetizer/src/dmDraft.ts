/**
 * Templated DM drafts for brand outreach.
 *
 * Hard contract: every draft is marked `requiresManualSend: true` and carries
 * a `readyToSend` flag the UI must verify before exposing the Send button.
 * Lumina NEVER sends a DM autonomously — Sprint 4 acceptance:
 * "Templated WhatsApp / IG DM drafts with manual send gate."
 */

import type { BrandRecord } from "./brandGraph";

export type DmChannel = "whatsapp" | "instagram" | "tiktok";

export interface DmInput {
  readonly creatorHandle: string;
  readonly hook: string;
  readonly viralConfidencePct: number;
  readonly askUsd: number;
}

export interface DmDraft {
  readonly id: string;
  readonly channel: DmChannel;
  readonly toHandle: string;
  readonly body: string;
  readonly requiresManualSend: true;
  readonly readyToSend: boolean;
  readonly blockedReason: string | null;
}

const MAX_LEN: Record<DmChannel, number> = {
  whatsapp:  1024,
  instagram:  900,
  tiktok:     500,
};

export function draftDm(channel: DmChannel, brand: BrandRecord, input: DmInput): DmDraft {
  const body = renderBody(channel, brand, input);
  const cap = MAX_LEN[channel];
  const ready = body.length > 0 && body.length <= cap && input.askUsd > 0;
  const blockedReason = !ready
    ? body.length > cap
      ? `draft exceeds ${channel} cap of ${cap} chars`
      : input.askUsd <= 0
        ? `ask must be > 0 USD`
        : `draft is empty`
    : null;
  return {
    id: `dm-${channel}-${brand.id}`,
    channel,
    toHandle: brand.handle,
    body,
    requiresManualSend: true,
    readyToSend: ready,
    blockedReason,
  };
}

function renderBody(channel: DmChannel, brand: BrandRecord, input: DmInput): string {
  const lead = channel === "whatsapp"
    ? `Oi ${brand.handle}!`
    : `Hi ${brand.handle} —`;
  return [
    lead,
    ``,
    `${input.creatorHandle} here. Drafted a 60s slot in my next video — projected ${input.viralConfidencePct}% reach, hook below:`,
    ``,
    `"${input.hook}"`,
    ``,
    `Ask: USD ${input.askUsd} (50% on publish, 50% on 7-day perf).`,
    `Reply "yes" to lock this slot. 48h window.`,
  ].join("\n");
}
