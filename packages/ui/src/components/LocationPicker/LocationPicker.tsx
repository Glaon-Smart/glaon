// Glaon LocationPicker — an interactive home-zone picker (#647). A
// MapLibre map with a draggable home marker, an orange radius circle whose
// edge handle is draggable, and numeric Latitude / Longitude / Radius
// fields. Optional search-as-you-type geocoding sits above the map when a
// `geocode` callback is injected. Matches the Home Assistant zone editor.
//
// Field-canonical state: the numeric inputs are the source of truth. The
// marker/handle drags and a geocode pick write back into them, and the
// committed `{ lat, lng, radius, address? }` is derived whenever latitude
// and longitude are both valid. `onChange` fires on every settle.
//
// Offline: map tiles need the network, but the numeric fields don't — so
// when the browser is offline we swap the map canvas for a neutral
// placeholder and the fields stay fully editable (per #647's offline
// decision). Tiles come back when connectivity returns.
//
// Per CLAUDE.md's Component Data-Fetching Boundary rule, the geocode fetch
// is injected via the `geocode` prop — the component owns the debounce /
// abort / paint trigger but never imports fetch-calling code. Per the UUI
// Source Rule the search input is the kit `<ComboBox>` and the numeric
// fields wrap the kit `<TextField>` / `<InputBase>`.

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
  Layer,
  Marker,
  NavigationControl,
  Source,
  type MapRef,
  type MarkerDragEvent,
} from 'react-map-gl/maplibre';
// MapLibre ships its own stylesheet — kept component-scoped (rather than
// `globals.css`) so the CSS only downloads as part of the lazy setup-route
// chunk that actually renders the map (LCP regression guard from #591).
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Key } from 'react-aria-components';

import { ComboBox, SelectItem, type SelectItemType } from '../Select';
import { InputBase, TextField } from '../Input';
import { circlePolygon, destinationPoint, haversineMeters, type LatLng } from './geo';
import type { GeocodeSuggestion } from './geocoding';

// Types stay un-exported per memory note `feedback_knip_props_interfaces.md`
// — `react-docgen-typescript` still resolves the prop names for the F6
// prop-coverage gate without a top-level `export`.
type LocationPickerSize = 'sm' | 'md' | 'lg';

interface LocationValue extends LatLng {
  /** Zone radius in metres. */
  radius?: number;
  /** Human-readable label (only present after a geocode pick). */
  address?: string;
}

type Geocoder = (
  query: string,
  signal?: AbortSignal,
  locale?: string,
) => Promise<GeocodeSuggestion[]>;

interface LocationPickerProps {
  /**
   * Controlled selection — `{ lat, lng, radius?, address? }`. Pair with
   * `onChange`. When set, `defaultValue` is ignored.
   */
  value?: LocationValue;
  /** Uncontrolled initial selection. */
  defaultValue?: LocationValue;
  /**
   * Initial map centre when no `value` / `defaultValue` is set.
   * Defaults to Istanbul (`{ lat: 41.0082, lng: 28.9784 }`).
   */
  defaultCenter?: LatLng;
  /**
   * Initial map zoom when no `value` is set. The picker auto-zooms to 14
   * whenever a location is picked. @default 4
   */
  defaultZoom?: number;
  /**
   * Async geocoder. The component debounces input (300ms) and aborts
   * in-flight requests. When omitted, the search box is hidden and the
   * user works the map + numeric fields directly. Pass `nominatimGeocode`
   * for the free OSM default.
   */
  geocode?: Geocoder | undefined;
  /**
   * Fires on every settled change — geocode pick, marker drag, radius
   * handle drag, or numeric-field edit. Receives `{ lat, lng, radius,
   * address? }`.
   */
  onChange?: (value: LocationValue) => void;
  /** BCP-47 locale forwarded to the geocoder's `accept-language`. */
  locale?: string;
  /** Accessible name for the search input (no visible label is rendered). */
  searchLabel?: string;
  /** Placeholder inside the search input. */
  placeholder?: string;
  /** Visible labels for the numeric fields (host supplies localized copy). */
  latitudeLabel?: string;
  longitudeLabel?: string;
  radiusLabel?: string;
  /** Unit suffix shown inside the radius field. @default 'm' */
  radiusUnit?: string;
  /** Helper text under the fields; doubles as the error message when invalid. */
  hint?: ReactNode;
  /** Copy shown over the map when the browser is offline. */
  offlineLabel?: string;
  /** Block all interaction and dim the controls. */
  isDisabled?: boolean;
  /** Surface validation error styling. */
  isInvalid?: boolean;
  /** Visual scale of the controls. @default 'md' */
  size?: LocationPickerSize;
  /** Height of the map canvas in pixels. @default 320 */
  mapHeight?: number;
  /** Default radius (metres) applied when a location is set without one. @default 100 */
  defaultRadius?: number;
  /** Tailwind override hook for the outer wrapper. */
  className?: string;
}

const ISTANBUL: LatLng = { lat: 41.0082, lng: 28.9784 };
const SUGGESTION_DEBOUNCE_MS = 300;
const MIN_QUERY_LENGTH = 3;
const PICK_ZOOM = 14;
const DEFAULT_RADIUS_M = 100;
const HANDLE_BEARING_DEG = 90; // due east

// MapLibre style JSON for OSM raster tiles. Bundled (not a remote
// style.json) so the strict CSP only whitelists tile + nominatim hosts.
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

// Brand-600 orange for the radius circle, matching the HA zone editor.
const CIRCLE_FILL_LAYER = {
  id: 'glaon-radius-fill',
  type: 'fill' as const,
  paint: { 'fill-color': '#F97316', 'fill-opacity': 0.18 },
};
const CIRCLE_LINE_LAYER = {
  id: 'glaon-radius-line',
  type: 'line' as const,
  paint: { 'line-color': '#F97316', 'line-width': 2 },
};

function isFiniteNum(value: number | undefined): value is number {
  return value !== undefined && Number.isFinite(value);
}

function parseNum(text: string): number | undefined {
  if (text.trim() === '') return undefined;
  const n = Number(text);
  return Number.isFinite(n) ? n : undefined;
}

export function LocationPicker({
  value,
  defaultValue,
  defaultCenter = ISTANBUL,
  defaultZoom = 4,
  geocode,
  onChange,
  locale,
  searchLabel = 'Search for an address',
  placeholder = 'Search for an address',
  latitudeLabel = 'Latitude',
  longitudeLabel = 'Longitude',
  radiusLabel = 'Radius',
  radiusUnit = 'm',
  hint,
  offlineLabel = 'Map unavailable offline — enter coordinates manually.',
  isDisabled,
  isInvalid,
  size = 'md',
  mapHeight = 320,
  defaultRadius = DEFAULT_RADIUS_M,
  className,
}: LocationPickerProps) {
  const resolvedLocale = useResolvedLocale(locale);
  const mapId = useId();
  const seed = value ?? defaultValue ?? null;

  // Field-canonical state — the numeric inputs are the source of truth.
  const [latText, setLatText] = useState<string>(() => fmt(seed?.lat));
  const [lngText, setLngText] = useState<string>(() => fmt(seed?.lng));
  const [radiusText, setRadiusText] = useState<string>(() =>
    fmt(seed?.radius ?? (seed !== null ? defaultRadius : undefined)),
  );
  const [address, setAddress] = useState<string | undefined>(seed?.address);

  // When the host drives `value`, keep the fields in sync with it.
  useEffect(() => {
    if (value === undefined) return;
    setLatText(fmt(value.lat));
    setLngText(fmt(value.lng));
    setRadiusText(fmt(value.radius ?? defaultRadius));
    setAddress(value.address);
  }, [value, defaultRadius]);

  const lat = parseNum(latText);
  const lng = parseNum(lngText);
  const radius = parseNum(radiusText) ?? defaultRadius;
  // Memoized so the derived center is referentially stable across renders
  // when lat/lng don't change (the fly-to effect + circle/handle memos
  // depend on it).
  const center = useMemo<LatLng | null>(
    () => (isFiniteNum(lat) && isFiniteNum(lng) ? { lat, lng } : null),
    [lat, lng],
  );

  const emit = useCallback(
    (next: { lat: number; lng: number; radius: number; address?: string }) => {
      const payload: LocationValue = { lat: next.lat, lng: next.lng, radius: next.radius };
      if (next.address !== undefined) payload.address = next.address;
      onChange?.(payload);
    },
    [onChange],
  );

  // Commit helper — write fields and emit when the result is a valid point.
  const commit = useCallback(
    (next: { lat: number; lng: number; radius: number; address?: string | undefined }) => {
      setLatText(fmt(next.lat));
      setLngText(fmt(next.lng));
      setRadiusText(fmt(next.radius));
      setAddress(next.address);
      emit({
        lat: next.lat,
        lng: next.lng,
        radius: next.radius,
        ...(next.address !== undefined ? { address: next.address } : {}),
      });
    },
    [emit],
  );

  // --- Autocomplete plumbing (only when a geocoder is injected) ---
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

  // --- Offline detection ---
  const [isOnline, setIsOnline] = useState<boolean>(() =>
    typeof navigator !== 'undefined' ? navigator.onLine : true,
  );
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const online = () => {
      setIsOnline(true);
    };
    const offline = () => {
      setIsOnline(false);
    };
    window.addEventListener('online', online);
    window.addEventListener('offline', offline);
    return () => {
      window.removeEventListener('online', online);
      window.removeEventListener('offline', offline);
    };
  }, []);

  // --- Map fly-to on external center change (geocode pick / field edit) ---
  const mapRef = useRef<MapRef>(null);
  const lastFlownTo = useRef<string | null>(null);
  useEffect(() => {
    if (center === null) return;
    const key = `${center.lng.toString()},${center.lat.toString()}`;
    if (key === lastFlownTo.current) return;
    lastFlownTo.current = key;
    mapRef.current?.flyTo({ center: [center.lng, center.lat], zoom: PICK_ZOOM, duration: 800 });
  }, [center]);

  const handleSelectionChange = (key: Key | null) => {
    if (key === null) return;
    const picked = suggestions.find((s) => s.id === String(key));
    if (picked === undefined) return;
    commit({ lat: picked.lat, lng: picked.lng, radius, address: picked.label });
    setQuery(picked.label);
  };

  const handleMarkerDragEnd = (event: MarkerDragEvent) => {
    // A drag invalidates the geocoded address (coordinates no longer match).
    commit({ lat: event.lngLat.lat, lng: event.lngLat.lng, radius, address: undefined });
  };

  const handleRadiusDragEnd = (event: MarkerDragEvent) => {
    if (center === null) return;
    const next = Math.round(
      haversineMeters(center, { lat: event.lngLat.lat, lng: event.lngLat.lng }),
    );
    commit({ lat: center.lat, lng: center.lng, radius: Math.max(1, next), address });
  };

  // Numeric-field edits: update the field, and emit once the pair is valid.
  const onLatChange = (text: string) => {
    setLatText(text);
    const nLat = parseNum(text);
    if (isFiniteNum(nLat) && isFiniteNum(lng)) {
      emit({ lat: nLat, lng, radius, ...(address !== undefined ? { address } : {}) });
    }
  };
  const onLngChange = (text: string) => {
    setLngText(text);
    const nLng = parseNum(text);
    if (isFiniteNum(lat) && isFiniteNum(nLng)) {
      emit({ lat, lng: nLng, radius, ...(address !== undefined ? { address } : {}) });
    }
  };
  const onRadiusChange = (text: string) => {
    setRadiusText(text);
    const nRad = parseNum(text);
    if (center !== null && isFiniteNum(nRad)) {
      emit({
        lat: center.lat,
        lng: center.lng,
        radius: Math.max(1, nRad),
        ...(address !== undefined ? { address } : {}),
      });
    }
  };

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

  const items: SelectItemType[] = useMemo(
    () => suggestions.map((s) => ({ id: s.id, label: s.label })),
    [suggestions],
  );

  const circleData = useMemo(
    () => (center !== null ? circlePolygon(center, radius) : null),
    [center, radius],
  );
  const handlePos = useMemo(
    () => (center !== null ? destinationPoint(center, radius, HANDLE_BEARING_DEG) : null),
    [center, radius],
  );

  const initialView = useMemo(() => {
    const c = center ?? defaultCenter;
    return { longitude: c.lng, latitude: c.lat, zoom: center !== null ? PICK_ZOOM : defaultZoom };
    // Only seeded once; subsequent moves go through flyTo above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Search ComboBox props (only rendered when a geocoder is injected).
  const comboProps: Record<string, unknown> = {
    items,
    size,
    inputValue: query,
    onInputChange: setQuery,
    onSelectionChange: handleSelectionChange,
    defaultFilter: () => true,
    shortcut: false,
    icon: SearchLg,
    'aria-label': searchLabel,
    'aria-controls': mapId,
    placeholder,
  };
  if (isDisabled === true) comboProps.isDisabled = true;
  if (isInvalid === true) comboProps.isInvalid = true;

  return (
    <div className={'flex flex-col gap-3' + (className !== undefined ? ' ' + className : '')}>
      {geocode !== undefined && (
        <div onFocusCapture={handleFocusCapture}>
          <ComboBox {...comboProps}>
            {(item: SelectItemType) => (
              <SelectItem id={item.id} label={item.label ?? ''} icon={MarkerPin01} />
            )}
          </ComboBox>
        </div>
      )}

      <div
        id={mapId}
        className="overflow-hidden rounded-lg ring-1 ring-primary"
        style={{ height: mapHeight }}
      >
        {isOnline ? (
          <Map
            ref={mapRef}
            initialViewState={initialView}
            mapStyle={OSM_STYLE}
            reuseMaps
            attributionControl={{ compact: true }}
            interactive={isDisabled !== true}
          >
            <NavigationControl position="top-right" showCompass={false} />
            {circleData !== null && (
              <Source id="glaon-radius" type="geojson" data={circleData}>
                <Layer {...CIRCLE_FILL_LAYER} />
                <Layer {...CIRCLE_LINE_LAYER} />
              </Source>
            )}
            {center !== null && (
              <Marker
                latitude={center.lat}
                longitude={center.lng}
                draggable={isDisabled !== true}
                onDragEnd={handleMarkerDragEnd}
                anchor="bottom"
              />
            )}
            {center !== null && handlePos !== null && isDisabled !== true && (
              <Marker
                latitude={handlePos.lat}
                longitude={handlePos.lng}
                draggable
                onDragEnd={handleRadiusDragEnd}
                anchor="center"
              >
                <span
                  aria-hidden="true"
                  className="block size-3.5 rounded-full border-2 border-white bg-[#F97316] shadow-md"
                />
              </Marker>
            )}
          </Map>
        ) : (
          <div className="flex size-full items-center justify-center bg-secondary p-4 text-center text-sm text-tertiary">
            {offlineLabel}
          </div>
        )}
      </div>

      <div className="flex flex-col gap-3" onFocusCapture={handleFocusCapture}>
        <div className="flex flex-col gap-3 sm:flex-row">
          <CoordinateField
            label={latitudeLabel}
            value={latText}
            onChange={onLatChange}
            suffix="°"
            isDisabled={isDisabled === true}
            isInvalid={isInvalid === true}
            size={size}
          />
          <CoordinateField
            label={longitudeLabel}
            value={lngText}
            onChange={onLngChange}
            suffix="°"
            isDisabled={isDisabled === true}
            isInvalid={isInvalid === true}
            size={size}
          />
        </div>
        <CoordinateField
          label={radiusLabel}
          value={radiusText}
          onChange={onRadiusChange}
          suffix={radiusUnit}
          isDisabled={isDisabled === true}
          isInvalid={isInvalid === true}
          size={size}
          inputMode="numeric"
        />
      </div>

      {hint !== undefined && (
        <p className={'text-sm ' + (isInvalid === true ? 'text-error-primary' : 'text-tertiary')}>
          {hint}
        </p>
      )}
    </div>
  );
}

interface CoordinateFieldProps {
  readonly label: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly suffix: string;
  readonly isDisabled: boolean;
  readonly isInvalid: boolean;
  readonly size: LocationPickerSize;
  readonly inputMode?: 'decimal' | 'numeric';
}

// A labelled numeric field with a trailing unit suffix. Wraps the kit
// TextField/InputBase per the UUI Source Rule; the suffix is positioned
// over the input's right padding to match the HA zone editor.
function CoordinateField({
  label,
  value,
  onChange,
  suffix,
  isDisabled,
  isInvalid,
  size,
  inputMode = 'decimal',
}: CoordinateFieldProps): ReactNode {
  return (
    <label className="flex w-full flex-col gap-1.5">
      <span className="text-sm font-medium text-secondary">{label}</span>
      <div className="relative">
        <TextField
          value={value}
          onChange={onChange}
          size={size}
          isDisabled={isDisabled}
          isInvalid={isInvalid}
          aria-label={label}
        >
          <InputBase inputMode={inputMode} inputClassName="pr-8" autoComplete="off" />
        </TextField>
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-tertiary"
        >
          {suffix}
        </span>
      </div>
    </label>
  );
}

// Re-export the default geocoder so consumers can wire it without reaching
// into a sibling file:
//   import { LocationPicker, nominatimGeocode } from '@glaon/ui';
export { nominatimGeocode } from './geocoding';

function fmt(value: number | undefined): string {
  return value === undefined || !Number.isFinite(value) ? '' : String(value);
}

/**
 * Resolve the locale for geocode results. Reads `navigator.language`
 * lazily so SSR builds don't crash on a missing `navigator`.
 */
function useResolvedLocale(locale: string | undefined): string {
  return useMemo(() => {
    if (locale !== undefined && locale.length > 0) return locale;
    if (typeof navigator !== 'undefined' && navigator.language) return navigator.language;
    return 'en';
  }, [locale]);
}
