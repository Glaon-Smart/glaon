// Layout Setup wizard step — second step in the device setup wizard
// (epic #533, ADR 0028). v1 placeholder per the epic body and #545:
// single optional `<Input>` ("Home structure description") + Next,
// no floor/room domain. The real floor/room editor is its own epic.
//
// Same horizontal-form layout primitives as #540 — a label column on
// the left, the control on the right, divider above the row. Below
// `sm` the rows stack.
//
// The placeholder field writes into the string `layout?: string` slot
// already defined on DeviceConfig (#535); when the real editor lands
// it will replace this step without touching the schema's surface.

import { InputBase, TextField } from '@glaon/ui';
import { useId, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import type { DeviceConfigInput } from '@glaon/core/config';

interface LayoutStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge the form's output into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
}

export function LayoutStep({ collected, onNext }: LayoutStepProps): ReactNode {
  const { t } = useTranslation();
  const layoutLabelId = useId();
  const [layout, setLayout] = useState<string>(collected.layout ?? '');

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const trimmed = layout.trim();
    const partial: DeviceConfigInput = {};
    if (trimmed !== '') partial.layout = trimmed;
    onNext(partial);
  };

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">
          {t('setup.layoutSetup.title')}
        </h1>
        <p className="text-sm text-tertiary">{t('setup.layoutSetup.subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        <div className="grid grid-cols-1 gap-2 border-t border-secondary py-5 sm:grid-cols-[240px_1fr] sm:items-start sm:gap-8">
          <p id={layoutLabelId} className="pt-2 text-sm font-semibold text-secondary">
            {t('setup.layoutSetup.layout.label')}
          </p>
          <div className="flex max-w-[480px] flex-col gap-1.5">
            <TextField value={layout} onChange={setLayout} aria-labelledby={layoutLabelId}>
              <InputBase
                type="text"
                placeholder={t('setup.layoutSetup.layout.placeholder')}
                autoComplete="off"
              />
            </TextField>
            <p className="text-sm text-tertiary">{t('setup.layoutSetup.layout.hint')}</p>
          </div>
        </div>

        <div className="flex justify-end gap-3 border-t border-secondary py-6">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover"
          >
            <span>{t('setup.layoutSetup.actions.next')}</span>
            <NextArrowIcon />
          </button>
        </div>
      </form>
    </div>
  );
}

function NextArrowIcon(): ReactNode {
  return (
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
      <path d="M4.167 10h11.666m0 0L10 4.167M15.833 10 10 15.833" />
    </svg>
  );
}
