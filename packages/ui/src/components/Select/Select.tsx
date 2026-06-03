// Glaon Select — thin wrap around the Untitled UI kit Select family
// under `packages/ui/src/components/base/select/`. Per CLAUDE.md's
// UUI Source Rule, the structural HTML/CSS, popover positioning,
// keyboard navigation (arrow / typeahead / escape), and
// invalid / disabled state matrix come from the kit (built on
// react-aria-components `<Select>` + `<ComboBox>` + `<ListBox>`).
// Glaon's contribution is the wrap layer (token override via
// `theme.css` + `glaon-overrides.css`, prop API consistency, Figma
// `parameters.design` mapping in the story).
//
// The kit ships several siblings — re-export them all so consumers
// can reach the full catalogue via a single `@glaon/ui` import:
//
// - `Select` — single-value popover-based picker.
// - `ComboBox` — search-as-you-type version.
// - `MultiSelect` — multi-value popover with checkmarks.
// - `TagSelect` — tag/chip multi-select.
// - `NativeSelect` — HTML `<select>` for forms that want native UI.
// - `SelectItem` — list-item helper used by every variant.
// - `SelectContext`, `sizes`, types — escape hatches for custom
//   compositions.

export { Select, type SelectProps } from '../base/select/select';
export { ComboBox } from '../base/select/combobox';
export { MultiSelect } from '../base/select/multi-select';
export { SearchSelect } from '../base/select/search-select';
export { TagSelect, TagSelectBase, TagSelectTagsValue } from '../base/select/tag-select';
export { NativeSelect } from '../base/select/select-native';
export { SelectItem } from '../base/select/select-item';
export {
  SelectContext,
  sizes as selectSizes,
  type CommonProps as SelectCommonProps,
  type SelectItemType,
} from '../base/select/select-shared';
