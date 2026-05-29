// Shared secondary "Back" CTA for wizard steps (#637). Steps render it in
// their footer next to the primary action when `onBack` is provided
// (i.e. on every step except the first). Going back keeps `collected`
// intact — the wizard route owns that.

import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

interface WizardBackButtonProps {
  readonly onBack: () => void;
}

export function WizardBackButton({ onBack }: WizardBackButtonProps): ReactNode {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onBack}
      className="inline-flex items-center gap-2 rounded-lg border border-secondary bg-primary px-4 py-2 text-sm font-semibold text-secondary shadow-xs-skeuomorphic hover:bg-secondary"
      data-testid="wizard-back"
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 20 20"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M15.833 10H4.167m0 0L10 15.833M4.167 10 10 4.167" />
      </svg>
      <span>{t('setup.actions.back')}</span>
    </button>
  );
}
