/* Author: Jason Cruz | (c) 2026 AvertXAI | Proprietary */
// Icon set — solid paths copied verbatim from avertxai-crm-module-mockup-v7.html; the nav/settings
// glyphs (Home/Database/Bell/People/Book/Vault/Gear/Webhook) are hand-rolled OUTLINE (Phase 1.b).
import type { CSSProperties } from "react";

interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

// Single-path 16x16 currentColor icon factory (matches v7's inline svgs exactly).
function make(d: string, defaultSize = 16) {
  return function Icon({ size = defaultSize, className, style }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="currentColor" className={className} style={style}>
        <path d={d} />
      </svg>
    );
  };
}

// Stroke-outline 16x16 factory — same visual weight as the rail/theme-seg glyphs
// (fill:none, stroke 1.4, round caps/joins). d may hold multiple subpaths.
function outline(d: string, defaultSize = 16) {
  return function Icon({ size = defaultSize, className, style }: IconProps) {
    return (
      <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.4} strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
        <path d={d} />
      </svg>
    );
  };
}

export const Menu = make("M1 2.75h14v1.5H1zm0 4.5h14v1.5H1zm0 4.5h14v1.5H1z");
// Downward chevron for the sidebar section headers — rotates to a right-chevron when collapsed (CSS).
export const ChevronDown = outline("M4.5 6.5 8 10l3.5-3.5");
// Same lock geometry as the rail's LockIcon / Settings Vault — one padlock glyph everywhere.
export const Lock = outline(
  "M4.5 7h7a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2h-7a1.2 1.2 0 0 1-1.2-1.2V8.2A1.2 1.2 0 0 1 4.5 7ZM5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"
);
export const Search = make(
  "M10.68 11.74a6 6 0 1 1 1.06-1.06l3.04 3.04-1.06 1.06ZM11.5 7a4.5 4.5 0 1 0-9 0 4.5 4.5 0 0 0 9 0Z"
);
export const Plus = make("M7.25 7.25V1.5h1.5v5.75h5.75v1.5H8.75v5.75h-1.5V8.75H1.5v-1.5h5.75Z");
export const Bell = outline(
  "M4 6.6a4 4 0 0 1 8 0V9l1.4 2.4H2.6L4 9ZM6.7 13.3a1.3 1.3 0 0 0 2.6 0"
);
// Database cylinder outline (top ellipse + sides + one body band) — Data Viewer top-bar icon.
export const Database = outline(
  "M13.5 3.5a5.5 2 0 1 1-11 0 5.5 2 0 0 1 11 0M13.5 3.5v9c0 1.1-2.46 2-5.5 2s-5.5-.9-5.5-2v-9M2.5 8.2c0 1.1 2.46 2 5.5 2s5.5-.9 5.5-2"
);
export const People = outline(
  "M7.9 5.2a2.3 2.3 0 1 1-4.6 0 2.3 2.3 0 0 1 4.6 0M1.7 13.3a4.2 4.2 0 0 1 7.8 0M10.4 3.2a2.3 2.3 0 0 1 0 4.1M11.6 9.4a4.2 4.2 0 0 1 2.7 3.5"
);
export const Book = outline(
  "M1.8 2.6h3.4c1.1 0 2.1.5 2.8 1.3.7-.8 1.7-1.3 2.8-1.3h3.4v10h-3.6c-.9 0-1.8.4-2.4 1-.6-.6-1.5-1-2.4-1H1.8ZM8 3.9v9.7"
);
// Same lock geometry as the rail's outline LockIcon (Flyout) — one vault glyph everywhere.
export const Vault = outline(
  "M4.5 7h7a1.2 1.2 0 0 1 1.2 1.2v4.6a1.2 1.2 0 0 1-1.2 1.2h-7a1.2 1.2 0 0 1-1.2-1.2V8.2A1.2 1.2 0 0 1 4.5 7ZM5.5 7V5.2a2.5 2.5 0 0 1 5 0V7"
);
export const Mail = outline(
  "M3.2 3.4h9.6a1.2 1.2 0 0 1 1.2 1.2v6.8a1.2 1.2 0 0 1-1.2 1.2H3.2A1.2 1.2 0 0 1 2 11.4V4.6a1.2 1.2 0 0 1 1.2-1.2ZM2.3 4.6 8 8.9l5.7-4.3"
);
// Same geometry as the rail's outline GearIcon (Flyout) — one gear glyph everywhere.
export const Gear = outline(
  "M10.2 8a2.2 2.2 0 1 1-4.4 0 2.2 2.2 0 0 1 4.4 0M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8 3.5 3.5"
);
export const Spark = make("M8 0l1.6 4.8L14.4 6.4 9.6 8 8 12.8 6.4 8 1.6 6.4 6.4 4.8Z");
export const Webhook = outline("M12.5 8a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0");
// settings-doors door glyphs
export const DoorRoles = make(
  "M2 5.5a3.5 3.5 0 1 1 5.898 2.549 5.508 5.508 0 0 1 3.034 4.084.75.75 0 1 1-1.482.235 4 4 0 0 0-7.9 0 .75.75 0 0 1-1.482-.236A5.507 5.507 0 0 1 3.102 8.05 3.493 3.493 0 0 1 2 5.5Z"
);
export const DoorTiers = make(
  "M1.75 1h12.5A1.75 1.75 0 0 1 16 2.75v3.5A1.75 1.75 0 0 1 14.25 8H1.75A1.75 1.75 0 0 1 0 6.25v-3.5C0 1.784.784 1 1.75 1Z"
);
export const DoorBrand = make(
  "M8 0a8 8 0 0 0 0 16c.69 0 1.25-.56 1.25-1.25 0-.32-.12-.61-.32-.83a1.25 1.25 0 0 1 .92-2.09H11A5 5 0 0 0 8 0Z"
);
export const DoorTheme = make("M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2Z");
