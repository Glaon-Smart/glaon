// Glaon LocationPicker — search-as-you-type address picker paired
// with an interactive MapLibre map. The third primitive in the
// Phase 2 picker trio (CountrySelect #577, TimezoneSelect #578).
//
// UX:
//
//   1. User types into the search input.
//   2. Suggestions stream in (debounced + abortable) via the
//      `geocode` callback the host injects. Default helper is
//      `nominatimGeocode` for the free OSM endpoint.
//   3. Selecting a suggestion flies the map to the location and
//      drops a draggable marker.
//   4. The user can drag the marker to fine-tune the coordinates;
//      `onChange` fires on every settle with `{ lat, lng, address? }`.
//
// Per CLAUDE.md's Component Data-Fetching Boundary rule, the network
// fetch itself is injected via the `geocode` prop — the component
// owns the debounce / abort / paint trigger, but never imports
// `fetch` calling code at module scope. The `nominatimGeocode`
// helper ships alongside as a sibling export so stories and feature
// pages can wire it in one line.
//
// Per the UUI Source Rule, the search input is the kit `<ComboBox>`
// with `defaultFilter={() => true}` so the kit doesn't try to filter
// our async-loaded suggestion list locally (server-side filtering
// already narrowed them).

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type ReactNode,
} from 'react';
import { MarkerPin01, SearchLg } from '@untitledui/icons';
import Map, {
  Marker,
  NavigationControl,
  type MapRef,
  type MarkerDragEvent,
} from 'react-map-gl/maplibre';
// MapLibre ships its own stylesheet — kept component-scoped (rather
// than `globals.css`) so the ~25 kB raw / ~7 kB gzipped CSS only
// downloads as part of the lazy setup-route chunk that actually
// renders the map. Loading it in `globals.css` would block initial
// paint on every page that consumes `@glaon/ui/styles`, which is
// the LCP regression Lighthouse mobile flagged on #591.
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Key } from 'react-aria-components';

import { ComboBox, SelectItem, type SelectItemType } from '../Select';
import type { GeocodeSuggestion } from './geocoding';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`
// — `react-docgen-typescript` still resolves the prop names for the
// F6 prop-coverage gate without a top-level `export`. Promote when
// an external consumer needs them.
type LocationPickerSize = 'sm' | 'md' | 'lg';

interface LatLng {
  lat: number;
  lng: number;
}

interface LocationValue extends LatLng {
  address?: string;
}

type Geocoder = (
  query: string,
  signal?: AbortSignal,
  locale?: string,
) => Promise<GeocodeSuggestion[]>;

interface LocationPickerProps {
  /**
   * Controlled selection — `{ lat, lng, address? }`. Pair with
   * `onChange` to manage state outside. When set, `defaultValue` is
   * ignored.
   */
  value?: LocationValue;
  /** Uncontrolled initial selection. */
  defaultValue?: LocationValue;
  /**
   * Initial map centre when no `value` / `defaultValue` is set.
   * Defaults to Istanbul (`{ lat: 41.0082, lng: 28.9784 }`) — change
   * to a region-appropriate fallback for non-TR deployments.
   */
  defaultCenter?: LatLng;
  /**
   * Initial map zoom when no `value` is set. The picker auto-zooms
   * to `14` whenever the user picks a suggestion.
   * @default 4
   */
  defaultZoom?: number;
  /**
   * Async geocoder. The component debounces input (300ms) and
   * aborts in-flight requests when the query changes, so the
   * callback only sees the latest live query. Required for the
   * autocomplete to work — pass `nominatimGeocode` for the free OSM
   * default.
   */
  geocode?: Geocoder;
  /**
   * Fires on every settled selection — autocomplete pick or marker
   * drag. Receives `{ lat, lng, address? }` (the `address` is only
   * present for autocomplete picks; marker drags emit lat/lng only).
   */
  onChange?: (value: LocationValue) => void;
  /**
   * BCP-47 locale forwarded to the geocoder's `accept-language`
   * query — Nominatim returns labels in that language when the OSM
   * data has translations. Defaults to `navigator.language`.
   */
  locale?: string;
  /** Field label rendered above the search input. */
  label?: string;
  /** Placeholder text inside the search input. */
  placeholder?: string;
  /** Helper text shown under the input; doubles as the error
   *  message when `isInvalid` is true. */
  hint?: ReactNode;
  /** Block all interaction and dim the trigger + map. */
  isDisabled?: boolean;
  /**
   * Surface validation error styling on the search input. Auto-clears
   * the moment the user makes a selection; toggling `false → true`
   * re-arms the error.
   */
  isInvalid?: boolean;
  /** Mark the field as required. */
  isRequired?: boolean;
  /** Hide the visual `*` next to the label even when `isRequired` is true. */
  hideRequiredIndicator?: boolean;
  /** Visual scale of the search input.
   *  @default 'md' */
  size?: LocationPickerSize;
  /** Height of the map canvas in pixels.
   *  @default 320 */
  mapHeight?: number;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
}

const ISTANBUL: LatLng = { lat: 41.0082, lng: 28.9784 };
const SUGGESTION_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;
const PICK_ZOOM = 14;

// MapLibre style JSON for OSM raster tiles. We bundle the style
// rather than fetching a remote style.json so the strict CSP only
// has to whitelist tile + nominatim hosts (no extra `connect-src`
// for a style server).
const OSM_STYLE = {
  version: 8 as const,
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster' as const, source: 'osm' }],
};

export function LocationPicker({
  value,
  defaultValue,
  defaultCenter = ISTANBUL,
  defaultZoom = 4,
  geocode,
  onChange,
  locale,
  label,
  placeholder = 'Search for an address',
  hint,
  isDisabled,
  isInvalid,
  isRequired,
  hideRequiredIndicator,
  size = 'md',
  mapHeight = 320,
  className,
}: LocationPickerProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const mapId = useId();
  // Unified location state — same shape as CountrySelect /
  // TimezoneSelect: seeded from defaultValue, controlled-from-wrapper
  // so the marker + map fly-to can read it in every mode.
  const [internalValue, setInternalValue] = useState<LocationValue | null>(defaultValue ?? null);
  const isHostControlled = value !== undefined;
  const effectiveValue: LocationValue | null = value ?? internalValue;

  // Autocomplete plumbing — debounced query + abortable fetch.
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<GeocodeSuggestion[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (geocode === undefined) {
      setSuggestions([]);
      return;
    }
    const trimmed = query.trim();
    if (trimmed.length < MIN_QUERY_LENGTH) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      geocode(trimmed, controller.signal, resolvedLocale)
        .then((next) => {
          if (!controller.signal.aborted) setSuggestions(next);
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === 'AbortError') return;
          // The host owns the error UX (Toast etc.); we collapse the
          // suggestion list so the user gets a clean re-try affordance.
          setSuggestions([]);
        });
    }, SUGGESTION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [query, geocode, resolvedLocale]);

  useEffect(
    () => () => {
      abortRef.current?.abort();
    },
    [],
  );

  // Suppress invalid styling once the user picks something. Reset
  // when the host re-asserts `isInvalid` (false → true after
  // re-validation re-arms the error).
  const [suppressInvalid, setSuppressInvalid] = useState(false);
  useEffect(() => {
    setSuppressInvalid(false);
  }, [isInvalid]);

  const writeValue = useCallback(
    (next: LocationValue) => {
      if (!isHostControlled) setInternalValue(next);
      setSuppressInvalid(true);
      onChange?.(next);
    },
    [isHostControlled, onChange],
  );

  const handleSelectionChange = (key: Key | null) => {
    if (key === null) return;
    const picked = suggestions.find((s) => s.id === String(key));
    if (picked === undefined) return;
    writeValue({ lat: picked.lat, lng: picked.lng, address: picked.label });
    // Sync the input so the trigger reads the picked label after the
    // popover closes (RAC's default behaviour copies textValue, but
    // since we set defaultFilter to constant-true the inputValue
    // path needs an explicit sync).
    setQuery(picked.label);
  };

  const handleInputChange = (next: string) => {
    setQuery(next);
  };

  const handleMarkerDragEnd = (event: MarkerDragEvent) => {
    writeValue({ lat: event.lngLat.lat, lng: event.lngLat.lng });
  };

  // Fly to the picked location whenever the lat/lng changes from
  // outside the marker-drag path. We track the last lng+lat we
  // flew to so a drag (which also updates effectiveValue) doesn't
  // double-fly. The map naturally tracks the marker visually
  // during a drag.
  const mapRef = useRef<MapRef>(null);
  const lastFlownTo = useRef<string | null>(null);
  useEffect(() => {
    if (effectiveValue === null) return;
    const key = `${effectiveValue.lng.toString()},${effectiveValue.lat.toString()}`;
    if (key === lastFlownTo.current) return;
    lastFlownTo.current = key;
    mapRef.current?.flyTo({
      center: [effectiveValue.lng, effectiveValue.lat],
      zoom: PICK_ZOOM,
      duration: 800,
    });
  }, [effectiveValue]);

  // Select-all-on-focus inside the search input — same affordance
  // as CountrySelect / TimezoneSelect.
  const handleFocusCapture = useCallback((event: FocusEvent<HTMLDivElement>) => {
    const target = event.target;
    if (!(target instanceof HTMLInputElement)) return;
    if (target.disabled || target.readOnly) return;
    requestAnimationFrame(() => {
      try {
        target.select();
      } catch {
        // Input may have unmounted between focus and the rAF tick.
      }
    });
  }, []);

  const effectiveInvalid = isInvalid === true && !suppressInvalid;
  const items: SelectItemType[] = useMemo(
    () => suggestions.map((s) => ({ id: s.id, label: s.label })),
    [suggestions],
  );

  const initialView = useMemo(() => {
    const center = effectiveValue ?? defaultCenter;
    const lat = 'lat' in center ? center.lat : defaultCenter.lat;
    const lng = 'lng' in center ? center.lng : defaultCenter.lng;
    const zoom = effectiveValue !== null ? PICK_ZOOM : defaultZoom;
    return { longitude: lng, latitude: lat, zoom };
    // Only seeded once; subsequent moves go through flyTo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Build the ComboBox props bag conditionally — the @glaon/ui package
  // compiles with `exactOptionalPropertyTypes: true`, so passing an
  // explicit `undefined` to an optional prop fails type-check.
  const comboProps: Record<string, unknown> = {
    items,
    size,
    inputValue: query,
    onInputChange: handleInputChange,
    onSelectionChange: handleSelectionChange,
    defaultFilter: () => true,
    shortcut: false,
    icon: SearchLg,
    'aria-controls': mapId,
  };
  if (label !== undefined) comboProps.label = label;
  // `placeholder` always has a value (default in the destructuring),
  // so it goes through unconditionally — the conditional spread
  // pattern is reserved for genuinely optional props.
  comboProps.placeholder = placeholder;
  if (hint !== undefined) comboProps.hint = hint;
  if (isDisabled === true) comboProps.isDisabled = true;
  if (effectiveInvalid) comboProps.isInvalid = true;
  if (isRequired === true) comboProps.isRequired = true;
  if (hideRequiredIndicator === true) comboProps.hideRequiredIndicator = true;

  return (
    <div className={'flex flex-col gap-3' + (className !== undefined ? ' ' + className : '')}>
      <div onFocusCapture={handleFocusCapture}>
        <ComboBox {...comboProps}>
          {(item: SelectItemType) => (
            <SelectItem id={item.id} label={item.label ?? ''} icon={MarkerPin01} />
          )}
        </ComboBox>
      </div>

      <div
        id={mapId}
        className="overflow-hidden rounded-lg ring-1 ring-primary"
        style={{ height: mapHeight }}
      >
        <Map
          ref={mapRef}
          initialViewState={initialView}
          mapStyle={OSM_STYLE}
          reuseMaps
          attributionControl={{ compact: true }}
          interactive={isDisabled !== true}
        >
          <NavigationControl position="top-right" showCompass={false} />
          {effectiveValue !== null && (
            <Marker
              latitude={effectiveValue.lat}
              longitude={effectiveValue.lng}
              draggable={isDisabled !== true}
              onDragEnd={handleMarkerDragEnd}
              anchor="bottom"
            />
          )}
        </Map>
      </div>
    </div>
  );
}

// Re-export the default geocoder so consumers can wire it without
// reaching into a sibling file:
//
//   import { LocationPicker, nominatimGeocode } from '@glaon/ui';
//   <LocationPicker geocode={nominatimGeocode} ... />
export { nominatimGeocode } from './geocoding';

/**
 * Resolve the locale used for geocode results. Reads
 * `navigator.language` lazily so SSR builds don't crash on a missing
 * `navigator`. Falls back to `'en'` when neither prop nor navigator
 * is available.
 */
function useResolvedLocale(locale: string | undefined): string {
  return useMemo(() => {
    if (locale !== undefined && locale.length > 0) return locale;
    if (typeof navigator !== 'undefined' && navigator.language) {
      return navigator.language;
    }
    return 'en';
  }, [locale]);
}
