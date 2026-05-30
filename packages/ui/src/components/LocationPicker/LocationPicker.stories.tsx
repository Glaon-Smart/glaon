import type { Meta, StoryObj } from '@storybook/react-native-web-vite';

import { defineControls } from '../_internal/controls';
import { LocationPicker } from './LocationPicker';
import { locationPickerControls, locationPickerExcludeFromArgs } from './LocationPicker.controls';
import { nominatimGeocode, type GeocodeSuggestion } from './geocoding';

const { args, argTypes } = defineControls(locationPickerControls);

// Static mock geocoder — deterministic so Chromatic snapshots stay
// stable. Filters a hand-curated list of well-known landmarks by
// substring. The `Live (Nominatim)` story below opts into the real
// endpoint for manual sanity but disables the Chromatic snapshot.
const MOCK_RESULTS: GeocodeSuggestion[] = [
  {
    id: 'istanbul',
    label: 'Istanbul, Türkiye',
    lat: 41.0082,
    lng: 28.9784,
  },
  {
    id: 'ankara',
    label: 'Ankara, Türkiye',
    lat: 39.9334,
    lng: 32.8597,
  },
  {
    id: 'izmir',
    label: 'İzmir, Türkiye',
    lat: 38.4192,
    lng: 27.1287,
  },
  {
    id: 'berlin',
    label: 'Berlin, Deutschland',
    lat: 52.52,
    lng: 13.405,
  },
  {
    id: 'london',
    label: 'London, United Kingdom',
    lat: 51.5074,
    lng: -0.1278,
  },
  {
    id: 'newyork',
    label: 'New York, NY, United States',
    lat: 40.7128,
    lng: -74.006,
  },
];

const mockGeocode = (query: string): Promise<GeocodeSuggestion[]> => {
  const needle = query.toLowerCase().trim();
  const matches = MOCK_RESULTS.filter((r) => r.label.toLowerCase().includes(needle));
  return Promise.resolve(matches);
};

const meta: Meta<typeof LocationPicker> = {
  title: 'App Primitives/LocationPicker',
  component: LocationPicker,
  parameters: {
    design: {
      type: 'figma',
      url: 'https://www.figma.com/design/cDLzPUkcsDJtvwqZLWRwrd/Design-System?node-id=app-primitives-location-picker',
    },
  },
  args: { ...args, geocode: mockGeocode },
  argTypes,
  decorators: [
    (Story) => (
      <div style={{ width: 480 }}>
        <Story />
      </div>
    ),
  ],
};

export default meta;
type Story = StoryObj<typeof LocationPicker>;

export const excludeFromArgs = locationPickerExcludeFromArgs;

/**
 * Default — empty input, map at the fallback centre (Istanbul) at
 * zoom 4. Type any substring of the curated mock list (e.g.
 * `ankara`, `berlin`, `new york`) to see the autocomplete + map
 * fly-to flow.
 */
export const Default: Story = {};

/**
 * Pre-selected — `defaultValue` set to Istanbul with a 200 m radius.
 * The map opens centred on the marker at zoom 14, with the orange
 * radius circle + its draggable edge handle. Drag the marker to move
 * the centre, or the handle to resize; `onChange` fires on settle.
 */
export const WithDefaultValue: Story = {
  args: {
    defaultValue: {
      lat: 41.0082,
      lng: 28.9784,
      radius: 200,
      address: 'Istanbul, Türkiye',
    },
  },
};

/**
 * No search — `geocode` omitted, so the search box is hidden and the
 * user works the map + numeric fields directly (the HA zone-editor
 * shape). Edit Latitude / Longitude / Radius or drag the marker.
 */
export const NoSearch: Story = {
  args: {
    geocode: undefined,
    defaultValue: { lat: 39.6588, lng: 27.9063, radius: 200 },
  },
};

/**
 * Berlin centre — confirms the picker handles negative-zero zoom
 * starts and that the marker drop matches the curated label.
 */
export const Berlin: Story = {
  args: {
    defaultValue: {
      lat: 52.52,
      lng: 13.405,
      address: 'Berlin, Deutschland',
    },
  },
};

/**
 * Disabled — input is dim, suggestions don't open, marker is
 * non-draggable, map is non-interactive.
 */
export const Disabled: Story = {
  args: {
    defaultValue: {
      lat: 41.0082,
      lng: 28.9784,
      address: 'Istanbul, Türkiye',
    },
    isDisabled: true,
  },
};

/** Invalid + hint — error styling clears on the next selection. */
export const WithError: Story = {
  args: {
    isInvalid: true,
    hint: 'Pick a location to continue.',
  },
};

/** Helper text under the input when the field is valid. */
export const WithHint: Story = {
  args: {
    hint: 'Drag the marker to fine-tune the address.',
  },
};

/**
 * Larger map — `mapHeight: 480`. Useful as the centre-of-stage
 * affordance on a dedicated location step.
 */
export const TallerMap: Story = {
  args: { mapHeight: 480 },
};

/**
 * Smaller map — `mapHeight: 240`. Fits dense forms where the
 * picker is one of several fields.
 */
export const ShorterMap: Story = {
  args: { mapHeight: 240 },
};

/**
 * Live Nominatim — opts into the real free-tier OSM geocoder for
 * manual sanity checking. Disabled in Chromatic to keep snapshots
 * deterministic (and to respect Nominatim's free-tier rate limit).
 */
export const LiveNominatim: Story = {
  args: { geocode: nominatimGeocode },
  parameters: { chromatic: { disableSnapshot: true } },
};
