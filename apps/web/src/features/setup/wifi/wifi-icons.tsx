// Inline SVG icons for the Wi-Fi step. Kept local (vs reaching for
// `@untitledui/icons`) for the same reason the Layout step's
// `step-icons.tsx` did — apps/web's icon dep surface stays narrowed
// to `@glaon/ui` plus a handful of small inline SVGs for affordances
// that aren't worth pulling another package for.
//
// Currently the handoff overlay is the only consumer (SpinnerIcon).
// Lock / signal-bars / refresh / eye-off glyphs are queued for the
// wifi-step polish follow-up to #594 — adding them here ahead of
// their consumers trips knip's "unused export" gate, so they ship
// alongside the consumers, not before.

import type { ReactNode } from 'react';

interface IconProps {
  readonly className?: string;
}

/** Spinner glyph — used inline next to "Switching…" copy. */
export function SpinnerIcon({ className }: IconProps): ReactNode {
  return (
    <svg
      className={'animate-spin ' + (className ?? '')}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M10 2v3M10 15v3M3.5 10h-1M17.5 10h-1M5.45 5.45 4.4 4.4M15.6 15.6l-1.05-1.05M5.45 14.55 4.4 15.6M15.6 4.4l-1.05 1.05" />
    </svg>
  );
}
