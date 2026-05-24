// Inline SVG icons used by the Layout Setup step's wrap UI
// (floor-tabs, room-card, room-grid). We don't reach into
// `@untitledui/icons` directly from apps/web — apps/web's dep
// surface stays narrowed to `@glaon/ui`, which re-exports kit
// components but not arbitrary icons. For affordances small
// enough to inline, the SVG lives here.
//
// Each icon takes a `className` so the consumer controls size
// (`size-4`, `size-3.5`) and colour (currentColor). Decorative by
// default — pair with an accessible-name on the surrounding button
// so screen readers know what the icon does.

import type { ReactNode } from 'react';

interface IconProps {
  readonly className?: string;
}

export function PlusIcon({ className }: IconProps): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M10 4.167v11.666M4.167 10h11.666" />
    </svg>
  );
}

export function XCloseIcon({ className }: IconProps): ReactNode {
  return (
    <svg
      className={className}
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M15 5 5 15M5 5l10 10" />
    </svg>
  );
}
