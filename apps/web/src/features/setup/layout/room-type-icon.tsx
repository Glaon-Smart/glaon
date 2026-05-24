// Emoji glyph mapper for room types. We use emoji rather than the
// `@untitledui/icons` set because:
//
//   - The kit doesn't ship dedicated `Bed` / `Bath` / `Sofa` /
//     `Kitchen` glyphs — closest matches are generic furniture /
//     building icons that all read as "thing".
//   - Emoji renders the same intent across every modern OS / browser
//     (Apple, Segoe UI, Noto). The user immediately recognises 🛏️
//     as bedroom; nobody has to learn that `Bed01` from a kit means
//     bedroom.
//   - Zero extra weight — emoji is unicode text, no SVG payload.
//
// Per CLAUDE.md the project avoids emojis in source files **as a
// general rule** (no emoji-flavoured commit messages, docs, code
// comments). User-facing UI is the explicit exception: a wall
// tablet sitting in someone's living room ships emoji icons because
// they're the right tool for "this is a kitchen" at a glance.

import type { ReactNode } from 'react';

import type { RoomType } from '@glaon/core/config';

const EMOJI: Record<RoomType, string> = {
  bedroom: '🛏️',
  bathroom: '🛁',
  kitchen: '🍳',
  living: '🛋️',
  office: '💻',
  dining: '🍽️',
  garage: '🚗',
  garden: '🌳',
  other: '🚪',
};

/** Fallback when the user hasn't picked a type yet. */
const DEFAULT_EMOJI = '🏠';

interface RoomTypeIconProps {
  readonly type?: RoomType;
  /** Visual size — defaults to `lg` (~32px). */
  readonly size?: 'sm' | 'md' | 'lg';
  /** Accessible label; when set, the emoji is announced. Defaults
   *  to decorative (aria-hidden) since the room name carries the
   *  semantics. */
  readonly ariaLabel?: string;
}

export function RoomTypeIcon({ type, size = 'lg', ariaLabel }: RoomTypeIconProps): ReactNode {
  const glyph = type !== undefined ? EMOJI[type] : DEFAULT_EMOJI;
  const sizeClass = size === 'sm' ? 'text-lg' : size === 'md' ? 'text-2xl' : 'text-4xl';
  const isDecorative = ariaLabel === undefined;
  return (
    <span
      className={`inline-flex shrink-0 select-none leading-none ${sizeClass}`}
      role={isDecorative ? undefined : 'img'}
      aria-label={ariaLabel}
      aria-hidden={isDecorative ? true : undefined}
    >
      {glyph}
    </span>
  );
}
