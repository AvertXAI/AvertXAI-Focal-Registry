/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Break-reminder message registry — DATA, not component copy (the tips.ts pattern): the toast
// pulls a rotating variant so the reminder never reads identically twice in a row.
const MESSAGES: string[] = [
  "Stand up, roll your shoulders, look at something farther than a screen.",
  "Water, stretch, breathe — the timer will still be here.",
  "Your eyes have earned twenty seconds of distance. Take it.",
  "A short walk now beats a sore back later.",
  "Step away for a minute — the work keeps better than your posture does.",
  "Unclench your jaw, drop your shoulders, refill the glass.",
];

let lastIndex = -1;

/** Random pick that never repeats the previous message. */
export function pickBreakMessage(): string {
  let i = Math.floor(Math.random() * MESSAGES.length);
  if (MESSAGES.length > 1 && i === lastIndex) i = (i + 1) % MESSAGES.length;
  lastIndex = i;
  return MESSAGES[i];
}
