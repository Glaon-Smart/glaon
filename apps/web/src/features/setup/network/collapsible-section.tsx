// Accessible expand/collapse panel for the Network step's IPv4 / IPv6
// blocks (#629). Feature-local on purpose: @glaon/ui ships no
// Accordion/Disclosure primitive yet, and this is wizard-step composition
// (like apply-step's own private sub-components), not a reusable base
// primitive. If a second consumer appears it graduates to @glaon/ui as a
// UUI-wrapped primitive. Uses native button + aria-expanded/aria-controls
// so it's keyboard- and screen-reader-correct without a library.

import { useId, useState, type ReactNode } from 'react';

interface CollapsibleSectionProps {
  readonly title: string;
  /** Secondary line shown under the title (e.g. the current method). */
  readonly summary?: string;
  readonly defaultOpen?: boolean;
  readonly children: ReactNode;
}

export function CollapsibleSection({
  title,
  summary,
  defaultOpen = false,
  children,
}: CollapsibleSectionProps): ReactNode {
  const [open, setOpen] = useState<boolean>(defaultOpen);
  const panelId = useId();

  return (
    <div className="rounded-xl border border-secondary bg-primary">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => {
          setOpen((prev) => !prev);
        }}
        className="flex w-full items-center justify-between gap-3 rounded-xl px-4 py-3 text-left transition-colors hover:bg-secondary"
      >
        <span className="flex flex-col">
          <span className="text-sm font-semibold text-secondary">{title}</span>
          {summary !== undefined && (
            <span className="text-sm font-normal text-tertiary">{summary}</span>
          )}
        </span>
        <ChevronIcon open={open} />
      </button>
      {open && (
        <div id={panelId} className="flex flex-col gap-4 border-t border-secondary px-4 py-4">
          {children}
        </div>
      )}
    </div>
  );
}

function ChevronIcon({ open }: { open: boolean }): ReactNode {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`shrink-0 text-tertiary transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}
