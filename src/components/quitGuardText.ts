/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// The words and the times shown by the quit toast (QuitGuardToast.tsx) and the next-launch prompt
// (LeftoverPrompt.tsx). Kept out of both components so they can be tested with no window.
import { formatStamp } from "../shared/datetime";
import type { WorkAction } from "../shared/types";

export const ACTION_LABEL: Record<WorkAction, string> = {
  pause: "Pause",
  stop: "Stop",
  finish: "Finish, then quit",
  stopSafely: "Stop safely and quit",
};

// A reason this file has not heard of still needs a title, and "about to close" is true of them all.
export function quitTitle(reason: string): string {
  if (reason === "update") return "An update is ready to install";
  if (reason === "shutdown") return "Windows is shutting down";
  return "Focal Registry is about to close";
}

// Two shapes are stored, both UTC, and only one carries a zone marker (shared/datetime.ts). Its
// "iso" mode is what stops the unmarked shape being read as local time, hours out.
export function parseStored(stored: string): number {
  return Date.parse(formatStamp(stored, "iso"));
}

const two = (n: number): string => String(n).padStart(2, "0");

/** "11-12-2026 5:05 PM" in local time. Month first, like every date a person reads in this app. */
export function whenText(stored: string): string {
  const d = new Date(parseStored(stored));
  if (Number.isNaN(d.getTime())) return stored; // shown as it came: a blank would hide that something is wrong
  const hour = d.getHours() % 12 || 12;
  return `${two(d.getMonth() + 1)}-${two(d.getDate())}-${d.getFullYear()} ${hour}:${two(d.getMinutes())} ${d.getHours() < 12 ? "AM" : "PM"}`;
}

/** The value a date-and-time field takes: local time, to the minute. Empty for an unreadable time. */
export function toInputValue(ms: number): string {
  const d = new Date(ms);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}T${two(d.getHours())}:${two(d.getMinutes())}`;
}

/**
 * The end time to store for what was typed, or the sentence saying why it cannot be used.
 * The field has no seconds, so a time inside the minute the timer started in means "at the start".
 * Without that, picking the very minute the prompt names as the start would be refused as "before".
 */
export function readEndTime(typed: string, startedAt: string, nowMs: number): { iso: string } | { error: string } {
  const end = new Date(typed).getTime(); // the field's value carries no zone, so it is read as local time
  const start = parseStored(startedAt) || 0; // an unreadable start cannot be compared, so it sets no lower limit
  if (Number.isNaN(end)) return { error: "Enter a date and a time." };
  if (end > nowMs) return { error: "The end time cannot be later than now." };
  if (end < start - (start % 60_000)) return { error: `The end time cannot be before the timer started, ${whenText(startedAt)}.` };
  return { iso: new Date(Math.max(end, start)).toISOString() };
}
