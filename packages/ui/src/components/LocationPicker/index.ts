// LocationPicker barrel. Per memory note
// `feedback_knip_props_interfaces.md`: keep prop / helper types
// un-exported until an external consumer needs them. The component
// itself is re-exported via the package barrel
// (`packages/ui/src/index.ts`); the `nominatimGeocode` helper is
// re-exported because every consumer wiring the default geocoder
// needs it.

export { LocationPicker, nominatimGeocode } from './LocationPicker';
