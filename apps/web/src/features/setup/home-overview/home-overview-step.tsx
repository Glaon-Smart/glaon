// Home Overview wizard step — first real step in the device setup
// wizard (epic #533, ADR 0028). Pixel-matched to Figma node
// 1277:791 right column. Replaces the placeholder from #539.
//
// Form fields (per Figma, top to bottom):
// - Home Name (required text input)
// - Location (LocationPicker — autocomplete + map + draggable marker)
// - Unit System (radio: metric / imperial)
// - Country (CountrySelect — auto-detect on first visit)
// - Timezone (TimezoneSelect — auto-detect on first visit)
// - Language (Select; SUPPORTED_LOCALES from @glaon/core)
//
// Layout follows the UUI horizontal-form pattern: a label column on
// the left, the control on the right, horizontal divider between
// rows. Below the `sm` breakpoint the rows stack so phones stay
// readable.
//
// Per the API Error Toast Rule (CLAUDE.md), per-field validation
// (e.g. "Home name is required") renders inline; nothing here goes
// through Toast because nothing leaves the device.
//
// The previous local helpers (`./countries.ts`, `./timezones.ts`)
// were dropped in #590 — the Phase 2 picker trio
// (CountrySelect / TimezoneSelect / LocationPicker) is now the
// canonical implementation.

import {
  CountrySelect,
  InputBase,
  LocationPicker,
  Radio,
  RadioGroup,
  Select,
  SelectItem,
  TextField,
  TimezoneSelect,
  nominatimGeocode,
  type SelectItemType,
} from '@glaon/ui';
import { useId, useMemo, useState, type ReactNode, type SubmitEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { SUPPORTED_LOCALES, type SupportedLocale } from '@glaon/core/i18n';
import type { DeviceConfigInput } from '@glaon/core/config';

interface HomeOverviewStepProps {
  /** Partial DeviceConfig collected from earlier steps in this run. */
  readonly collected: DeviceConfigInput;
  /** Merge the form's output into `collected` and advance to the next step. */
  readonly onNext: (partial: DeviceConfigInput) => void;
}

type UnitSystem = 'metric' | 'imperial';

interface LocationState {
  readonly address: string;
  readonly latitude: number | undefined;
  readonly longitude: number | undefined;
}

export function HomeOverviewStep({ collected, onNext }: HomeOverviewStepProps): ReactNode {
  const { t } = useTranslation();
  const homeNameLabelId = useId();
  const languageLabelId = useId();

  const [homeName, setHomeName] = useState<string>(collected.homeName ?? '');
  const [location, setLocation] = useState<LocationState>(() => ({
    address: collected.location ?? '',
    latitude: collected.latitude,
    longitude: collected.longitude,
  }));
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(collected.unitSystem ?? 'metric');
  const [country, setCountry] = useState<string>(collected.country ?? '');
  const [timezone, setTimezone] = useState<string>(collected.timezone ?? '');
  const [locale, setLocale] = useState<SupportedLocale>(
    (collected.locale as SupportedLocale | undefined) ?? 'en',
  );
  const [showHomeNameError, setShowHomeNameError] = useState<boolean>(false);

  const localeItems = useMemo<SelectItemType[]>(
    () =>
      SUPPORTED_LOCALES.map((code) => ({
        id: code,
        label: t(`setup.locales.${code}`),
      })),
    [t],
  );

  const homeNameTrimmed = homeName.trim();
  const homeNameInvalid = showHomeNameError && homeNameTrimmed === '';
  const homeNameErrorText = homeNameInvalid ? t('setup.homeOverview.homeName.required') : undefined;

  // The LocationPicker hydrates from `defaultValue` only when the
  // wizard re-opens with a previously saved location; on a fresh
  // visit we leave the picker empty (no auto-geolocation prompt).
  const locationDefault =
    collected.location !== undefined &&
    collected.latitude !== undefined &&
    collected.longitude !== undefined
      ? { address: collected.location, lat: collected.latitude, lng: collected.longitude }
      : undefined;

  const onSubmit = (event: SubmitEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (homeNameTrimmed === '') {
      setShowHomeNameError(true);
      return;
    }
    const partial: DeviceConfigInput = {
      homeName: homeNameTrimmed,
      unitSystem,
      locale,
    };
    if (location.address.trim() !== '') partial.location = location.address.trim();
    if (location.latitude !== undefined) partial.latitude = location.latitude;
    if (location.longitude !== undefined) partial.longitude = location.longitude;
    if (country !== '') partial.country = country;
    if (timezone !== '') partial.timezone = timezone;
    onNext(partial);
  };

  return (
    <div className="flex flex-col p-8 lg:p-12">
      <header className="flex flex-col gap-1 pb-6">
        <h1 className="text-display-xs font-semibold text-primary">
          {t('setup.homeOverview.title')}
        </h1>
        <p className="text-sm text-tertiary">{t('setup.homeOverview.subtitle')}</p>
      </header>

      <form onSubmit={onSubmit} noValidate className="flex flex-col">
        <FormRow label={t('setup.homeOverview.homeName.label')} labelId={homeNameLabelId} required>
          <TextField
            value={homeName}
            onChange={(value) => {
              setHomeName(value);
              if (showHomeNameError && value.trim() !== '') setShowHomeNameError(false);
            }}
            isRequired
            isInvalid={homeNameInvalid}
            aria-labelledby={homeNameLabelId}
          >
            <InputBase
              type="text"
              placeholder={t('setup.homeOverview.homeName.placeholder')}
              autoComplete="off"
              data-testid="home-overview-home-name"
            />
          </TextField>
          {homeNameErrorText !== undefined && <InlineError>{homeNameErrorText}</InlineError>}
        </FormRow>

        <FormRow label={t('setup.homeOverview.location.label')}>
          <LocationPicker
            label={t('setup.homeOverview.location.label')}
            hideRequiredIndicator
            placeholder={t('setup.homeOverview.location.placeholder')}
            geocode={nominatimGeocode}
            {...(locationDefault !== undefined ? { defaultValue: locationDefault } : {})}
            onChange={(value) => {
              setLocation({
                address: value.address ?? location.address,
                latitude: value.lat,
                longitude: value.lng,
              });
            }}
          />
        </FormRow>

        <FormRow label={t('setup.homeOverview.unitSystem.label')}>
          <RadioGroup
            value={unitSystem}
            onChange={(value) => {
              setUnitSystem(value as UnitSystem);
            }}
            aria-label={t('setup.homeOverview.unitSystem.label')}
            orientation="vertical"
          >
            <Radio
              value="metric"
              label={t('setup.homeOverview.unitSystem.metric.label')}
              hint={t('setup.homeOverview.unitSystem.metric.description')}
            />
            <Radio
              value="imperial"
              label={t('setup.homeOverview.unitSystem.imperial.label')}
              hint={t('setup.homeOverview.unitSystem.imperial.description')}
            />
          </RadioGroup>
        </FormRow>

        <FormRow label={t('setup.homeOverview.country.label')}>
          <CountrySelect
            label={t('setup.homeOverview.country.label')}
            hideRequiredIndicator
            placeholder={t('setup.homeOverview.country.placeholder')}
            {...(collected.country !== undefined ? { defaultValue: collected.country } : {})}
            autoDetect={collected.country === undefined}
            onSelectionChange={(iso) => {
              setCountry(iso ?? '');
            }}
          />
        </FormRow>

        <FormRow label={t('setup.homeOverview.timezone.label')}>
          <TimezoneSelect
            label={t('setup.homeOverview.timezone.label')}
            hideRequiredIndicator
            placeholder={t('setup.homeOverview.timezone.placeholder')}
            {...(collected.timezone !== undefined ? { defaultValue: collected.timezone } : {})}
            autoDetect={collected.timezone === undefined}
            onSelectionChange={(tz) => {
              setTimezone(tz ?? '');
            }}
          />
        </FormRow>

        <FormRow label={t('setup.homeOverview.language.label')} labelId={languageLabelId}>
          <Select
            aria-labelledby={languageLabelId}
            items={localeItems}
            placeholder={t('setup.homeOverview.language.placeholder')}
            value={locale}
            onChange={(key) => {
              if (
                typeof key === 'string' &&
                (SUPPORTED_LOCALES as readonly string[]).includes(key)
              ) {
                setLocale(key as SupportedLocale);
              }
            }}
          >
            {(item) => <SelectItem key={item.id} id={item.id} label={item.label ?? ''} />}
          </Select>
        </FormRow>

        <div className="flex justify-end gap-3 border-t border-secondary py-6">
          <button
            type="submit"
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover"
          >
            <span>{t('setup.homeOverview.actions.next')}</span>
            <NextArrowIcon />
          </button>
        </div>
      </form>
    </div>
  );
}

interface FormRowProps {
  readonly label: string;
  /**
   * id forwarded to the visible `<p>` label so the matching control can
   * reference it via `aria-labelledby`. Omit when the control owns its
   * accessible name (RadioGroup via `aria-label`, the picker trio via
   * their own `label` prop, etc.).
   */
  readonly labelId?: string;
  readonly required?: boolean;
  readonly children: ReactNode;
}

// Two-column row with a horizontal divider above. Below `sm` the
// columns stack so mobile stays readable. Matches the UUI horizontal
// form pattern Figma uses for `1277:791`.
function FormRow({ label, labelId, required = false, children }: FormRowProps): ReactNode {
  return (
    <div className="grid grid-cols-1 gap-2 border-t border-secondary py-5 sm:grid-cols-[240px_1fr] sm:items-start sm:gap-8">
      <p id={labelId} className="pt-2 text-sm font-semibold text-secondary">
        {label}
        {required && (
          <span aria-hidden="true" className="text-error-primary">
            {' *'}
          </span>
        )}
      </p>
      <div className="flex max-w-[480px] flex-col gap-1.5">{children}</div>
    </div>
  );
}

function InlineError({ children }: { children: ReactNode }): ReactNode {
  return (
    <p role="alert" className="text-sm text-error-primary">
      {children}
    </p>
  );
}

// `LocationIcon` (the previous inline SVG used by the free-text
// location field) and the `./countries.ts` + `./timezones.ts`
// helpers all retired in #590 — the Phase 2 picker trio ships its
// own glyphs and datasets.

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
