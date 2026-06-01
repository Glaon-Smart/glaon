// Home Overview wizard step — first real step in the device setup
// wizard (epic #533, ADR 0028). Pixel-matched to Figma node
// 1277:791 right column. Replaces the placeholder from #539.
//
// Form fields (per Figma, top to bottom):
// - Language (LanguageSelect; the HA-supported language set from @glaon/core)
// - Home Name (required text input)
// - Country (CountrySelect — auto-detect on first visit)
// - Location (LocationPicker — autocomplete + map + draggable marker)
// - Unit System (radio: metric / imperial)
// - Timezone (TimezoneSelect — auto-detect on first visit)
// - Currency (CurrencySelect — follows the country selection)
//
// Language sits first (#666): it switches the wizard UI language, so the
// user picks it before reading the rest of the form. The full HA language
// set is offered (HA_LANGUAGES) since the value maps to HA Core's
// `language` (the device language), not only Glaon's own UI bundle —
// picking a non-Glaon-UI language saves to the device without re-skinning
// the wizard (only SUPPORTED_LOCALES drive `i18n.changeLanguage`).
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
  CurrencySelect,
  InputBase,
  LanguageSelect,
  LocationPicker,
  Radio,
  RadioGroup,
  TextField,
  TimezoneSelect,
  nominatimGeocode,
  useToast,
} from '@glaon/ui';
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type SubmitEvent,
} from 'react';
import { useTranslation } from 'react-i18next';

import { HA_LANGUAGES, SUPPORTED_LOCALES } from '@glaon/core/i18n';
import type { DeviceConfigInput } from '@glaon/core/config';

import {
  countryCurrency,
  countryTimeZones,
  fetchHaConfig,
  lookupCountryCenter,
  saveHomeSettings,
} from './home-overview-api';

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
  readonly radius: number | undefined;
}

const DEFAULT_RADIUS_M = 100;

export function HomeOverviewStep({ collected, onNext }: HomeOverviewStepProps): ReactNode {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const homeNameLabelId = useId();
  const countryLabelId = useId();
  const timezoneLabelId = useId();
  const currencyLabelId = useId();
  const languageLabelId = useId();

  const [homeName, setHomeName] = useState<string>(collected.homeName ?? '');
  const [location, setLocation] = useState<LocationState>(() => ({
    address: collected.location ?? '',
    latitude: collected.latitude,
    longitude: collected.longitude,
    radius: undefined,
  }));
  const [unitSystem, setUnitSystem] = useState<UnitSystem>(collected.unitSystem ?? 'metric');
  const [country, setCountry] = useState<string>(collected.country ?? '');
  const [timezone, setTimezone] = useState<string>(collected.timezone ?? '');
  const [currency, setCurrency] = useState<string>(collected.currency ?? '');
  // Locale is a free BCP-47 string (#666): it maps to HA Core `language`,
  // which spans the full HA language set — not only Glaon's UI locales.
  const [locale, setLocale] = useState<string>(collected.locale ?? 'en');
  const [showHomeNameError, setShowHomeNameError] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Seed from the device (#646): on the first visit the wizard reads the
  // current HA Core config and pre-fills the fields the user hasn't
  // already set. Guarded by `collected.*` so a back-navigation keeps the
  // user's entered values instead of re-seeding over them, and by a ref so
  // it runs once. A missing/unreachable HA Core just leaves the defaults.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    seededRef.current = true;
    let cancelled = false;
    void fetchHaConfig().then((seed) => {
      if (cancelled || seed === null) return;
      if (collected.homeName === undefined && seed.locationName !== undefined) {
        setHomeName((prev) => (prev === '' ? (seed.locationName ?? prev) : prev));
      }
      if (
        collected.latitude === undefined &&
        collected.longitude === undefined &&
        seed.latitude !== undefined &&
        seed.longitude !== undefined
      ) {
        setLocation((prev) =>
          prev.latitude === undefined && prev.longitude === undefined
            ? { ...prev, latitude: seed.latitude, longitude: seed.longitude }
            : prev,
        );
      }
      if (collected.unitSystem === undefined && seed.unitSystem !== undefined) {
        setUnitSystem(seed.unitSystem);
      }
      if (collected.country === undefined && seed.country !== undefined) {
        setCountry((prev) => (prev === '' ? (seed.country ?? prev) : prev));
      }
      if (collected.timezone === undefined && seed.timezone !== undefined) {
        setTimezone((prev) => (prev === '' ? (seed.timezone ?? prev) : prev));
      }
      if (collected.currency === undefined && seed.currency !== undefined) {
        setCurrency((prev) => (prev === '' ? (seed.currency ?? prev) : prev));
      }
      // Seed the language from any device language (#666), not just Glaon's
      // UI locales — the field maps to HA Core `language`. Only flip the
      // wizard UI when the seeded language is one Glaon actually ships.
      if (collected.locale === undefined && seed.language !== undefined) {
        const lang = seed.language;
        setLocale(lang);
        if ((SUPPORTED_LOCALES as readonly string[]).includes(lang)) {
          void i18n.changeLanguage(lang);
        }
      }
    });
    return () => {
      cancelled = true;
    };
    // Seed once on mount; `collected` is read for the initial guard only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const homeNameTrimmed = homeName.trim();
  const homeNameInvalid = showHomeNameError && homeNameTrimmed === '';
  const homeNameErrorText = homeNameInvalid ? t('setup.homeOverview.homeName.required') : undefined;

  // LocationPicker is controlled (#648) so a country change can recenter
  // the map. `undefined` until lat/lng are known (device seed, geocode
  // pick, manual entry, or country sync) — then the picker reflects it.
  const locationValue =
    location.latitude !== undefined && location.longitude !== undefined
      ? {
          lat: location.latitude,
          lng: location.longitude,
          radius: location.radius ?? DEFAULT_RADIUS_M,
          ...(location.address !== '' ? { address: location.address } : {}),
        }
      : undefined;

  // Country → map + timezone + currency sync (#648, #666). Every country
  // selection drives all three: the timezone snaps to the country's primary
  // IANA zone, the currency snaps to its ISO 4217 code, and the map recenters
  // to the country's centre (geocoded best-effort, online only). Country is
  // the authoritative high-level choice, so each change re-syncs (the first
  // pick and every subsequent one). Radius is kept; the address is cleared
  // (a country centre isn't a precise address).
  const onCountrySelect = (iso: string | null): void => {
    setCountry(iso ?? '');
    if (iso === null || iso === '') return;

    const zones = countryTimeZones(iso);
    if (zones[0] !== undefined) setTimezone(zones[0]);

    const ccy = countryCurrency(iso);
    if (ccy !== undefined) setCurrency(ccy);

    const online = typeof navigator === 'undefined' || navigator.onLine;
    if (!online) return;
    void lookupCountryCenter(iso, locale, nominatimGeocode).then((center) => {
      if (center === null) return;
      setLocation((prev) => ({
        ...prev,
        address: '',
        latitude: center.lat,
        longitude: center.lng,
      }));
    });
  };

  // Country-scoped address search (#666). Once a country is picked, the
  // LocationPicker's geocoder is bound to that country (`countrycodes`) so
  // address lookups stay in-country and resolve faster. Re-created when the
  // country changes so the picker re-queries with the new scope.
  const scopedGeocode = useCallback(
    (query: string, signal?: AbortSignal, geoLocale?: string) =>
      nominatimGeocode(query, signal, geoLocale, country !== '' ? country : undefined),
    [country],
  );

  const onSubmit = async (event: SubmitEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (isSaving) return;
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
    if (currency !== '') partial.currency = currency;

    // Per-step save (#646): persist the slice to the device before
    // advancing. An `error` outcome keeps the user on this step and
    // surfaces a Toast (API Error Toast Rule); `ok`/`skipped` advance.
    setIsSaving(true);
    const outcome = await saveHomeSettings({
      latitude: location.latitude,
      longitude: location.longitude,
      unitSystem,
      timezone: timezone !== '' ? timezone : undefined,
      country: country !== '' ? country : undefined,
      currency: currency !== '' ? currency : undefined,
      locale,
    });
    if (outcome === 'error') {
      setIsSaving(false);
      toast.show({
        intent: 'danger',
        title: t('setup.homeOverview.saveFailed.title'),
        description: t('setup.homeOverview.saveFailed.description'),
      });
      return;
    }
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

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-col"
      >
        {/* Language sits first (#666) — it switches the wizard UI, so the
            user chooses it before reading the rest. The full HA language set
            (HA_LANGUAGES) is offered since the value maps to HA Core
            `language`; only Glaon's own UI locales (SUPPORTED_LOCALES)
            actually re-skin the wizard via i18n.changeLanguage. */}
        <FormRow label={t('setup.homeOverview.language.label')} labelId={languageLabelId}>
          <LanguageSelect
            aria-labelledby={languageLabelId}
            options={HA_LANGUAGES}
            value={locale}
            placeholder={t('setup.homeOverview.language.placeholder')}
            autoDetect={false}
            onSelectionChange={(code) => {
              if (code === null) return;
              setLocale(code);
              if ((SUPPORTED_LOCALES as readonly string[]).includes(code)) {
                void i18n.changeLanguage(code);
              }
            }}
          />
        </FormRow>

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

        {/* Country sits above Location (#648) so its selection can recenter
            the map. The picker has no built-in label — the FormRow's label
            is associated via aria-labelledby. */}
        <FormRow label={t('setup.homeOverview.country.label')} labelId={countryLabelId}>
          <CountrySelect
            aria-labelledby={countryLabelId}
            placeholder={t('setup.homeOverview.country.placeholder')}
            {...(collected.country !== undefined ? { defaultValue: collected.country } : {})}
            autoDetect={collected.country === undefined}
            onSelectionChange={onCountrySelect}
          />
        </FormRow>

        <FormRow label={t('setup.homeOverview.location.label')}>
          <LocationPicker
            searchLabel={t('setup.homeOverview.location.label')}
            latitudeLabel={t('setup.homeOverview.location.latitude')}
            longitudeLabel={t('setup.homeOverview.location.longitude')}
            radiusLabel={t('setup.homeOverview.location.radius')}
            radiusUnit={t('setup.homeOverview.location.radiusUnit')}
            placeholder={t('setup.homeOverview.location.placeholder')}
            geocode={scopedGeocode}
            {...(locationValue !== undefined ? { value: locationValue } : {})}
            onChange={(value) => {
              setLocation({
                address: value.address ?? location.address,
                latitude: value.lat,
                longitude: value.lng,
                radius: value.radius,
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

        <FormRow label={t('setup.homeOverview.timezone.label')} labelId={timezoneLabelId}>
          <TimezoneSelect
            aria-labelledby={timezoneLabelId}
            placeholder={t('setup.homeOverview.timezone.placeholder')}
            {...(timezone !== '' ? { value: timezone } : {})}
            autoDetect={collected.timezone === undefined && timezone === ''}
            onSelectionChange={(tz) => {
              setTimezone(tz ?? '');
            }}
          />
        </FormRow>

        {/* Currency sits under Timezone (#649). Controlled (#666) so a
            country change can drive it (country → currency sync). Label-less
            picker — the form-row label is associated via aria-labelledby. */}
        <FormRow label={t('setup.homeOverview.currency.label')} labelId={currencyLabelId}>
          <CurrencySelect
            aria-labelledby={currencyLabelId}
            placeholder={t('setup.homeOverview.currency.placeholder')}
            {...(currency !== '' ? { value: currency } : {})}
            autoDetect={collected.currency === undefined && currency === ''}
            onSelectionChange={(code) => {
              setCurrency(code ?? '');
            }}
          />
        </FormRow>

        <div className="flex justify-end gap-3 border-t border-secondary py-6">
          <button
            type="submit"
            disabled={isSaving}
            aria-busy={isSaving}
            className="inline-flex items-center gap-2 rounded-lg bg-brand-solid px-4 py-2 text-sm font-semibold text-white shadow-xs-skeuomorphic hover:bg-brand-solid_hover disabled:cursor-not-allowed disabled:opacity-70"
          >
            <span>{t('setup.homeOverview.actions.next')}</span>
            {isSaving ? <SavingSpinner /> : <NextArrowIcon />}
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

// Inline loading spinner shown on the Next button while the step's
// settings are being saved to the device (#646).
function SavingSpinner(): ReactNode {
  return (
    <svg
      className="size-4 animate-spin"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      data-testid="home-overview-saving"
    >
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 0 1 8-8V0C5.373 0 0 5.373 0 12h4z"
      />
    </svg>
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
