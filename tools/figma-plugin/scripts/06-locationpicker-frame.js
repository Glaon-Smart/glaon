// Glaon — 06 LocationPicker frame (#647)
//
// Creates the canonical "App Primitives/LocationPicker" COMPONENT in the
// Design System Figma file, matching the redesigned React component and
// the Home Assistant zone-editor reference: an optional search row, a map
// area with a home marker + orange radius circle (with a draggable edge
// handle), and numeric Latitude / Longitude / Radius fields. No visible
// "Location" label.
//
// The component description carries `storybook-id: app-primitives-location-picker`
// — the Chromatic Figma-diff contract (docs/figma.md). After running,
// report the created component's node id; it goes in the #647 PR body.
//
// Usage:
//   1. Copy this file's contents into tools/figma-plugin/code.js.
//   2. Open the Design System Figma file (the one that holds Variables +
//      text styles). Inter must be installed locally (Glaon's placeholder
//      family, #133); otherwise the script falls back to the default font.
//   3. Run plugin (Plugins → Development → Glaon).
//   4. Review the dry-run summary; flip CONFIRM = true; re-run.
//   5. Copy the node id from the notification / console into the PR body,
//      then publish the library.
//   6. git restore tools/figma-plugin/code.js
//
// Idempotent: if a component named "App Primitives/LocationPicker" already
// exists, the script skips creation and just reports its id (re-binding
// the storybook-id description if missing).

const CONFIRM = false;

const COMPONENT_NAME = 'App Primitives/LocationPicker';
const STORYBOOK_ID = 'app-primitives-location-picker';
const FRAME_WIDTH = 480;
const MAP_HEIGHT = 320;

// Semantic variable names (01-variables-bootstrap) with hex fallbacks for
// files where Variables aren't populated yet. The orange radius maps to
// the brand primitive; everything else to neutral semantics.
const TOKENS = {
  surface: { var: 'surface/default', hex: '#FFFFFF' },
  surfaceMuted: { var: 'surface/muted', hex: '#F5F5F5' },
  surfaceRaised: { var: 'surface/raised', hex: '#FFFFFF' },
  border: { var: 'border/subtle', hex: '#E4E7EC' },
  textPrimary: { var: 'text/primary', hex: '#181D27' },
  textMuted: { var: 'text/muted', hex: '#717680' },
  brand: { var: 'brand/primary', hex: '#F97316' },
};

const RADIUS_ORANGE = '#F97316'; // Brand/600 — overridden by the token if present.

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  return {
    r: parseInt(h.slice(0, 2), 16) / 255,
    g: parseInt(h.slice(2, 4), 16) / 255,
    b: parseInt(h.slice(4, 6), 16) / 255,
  };
}

(async () => {
  try {
    // --- Idempotency: bail (report) if the component already exists. ---
    const existing = (await figma.root.findAllWithCriteria({ types: ['COMPONENT'] })).find(
      (n) => n.name === COMPONENT_NAME,
    );
    if (existing) {
      if (!existing.description.includes(`storybook-id: ${STORYBOOK_ID}`)) {
        if (CONFIRM) {
          existing.description =
            (existing.description ? existing.description + '\n' : '') +
            `storybook-id: ${STORYBOOK_ID}`;
        }
      }
      figma.notify(
        `${CONFIRM ? '✅' : '🔍'} LocationPicker already exists — node id: ${existing.id}`,
        { timeout: 12000 },
      );
      console.log('[Glaon LocationPicker] existing node id:', existing.id);
      figma.closePlugin();
      return;
    }

    // --- Resolve semantic variables (best-effort) ---
    const vars = await figma.variables.getLocalVariablesAsync();
    const byName = new Map(vars.map((v) => [v.name, v]));
    const fill = (key) => {
      const t = TOKENS[key];
      const paint = { type: 'SOLID', color: hexToRgb(t.hex) };
      const v = byName.get(t.var);
      return v ? figma.variables.setBoundVariableForPaint(paint, 'color', v) : paint;
    };
    const brandVar = byName.get(TOKENS.brand.var);
    const orangeSolid = (opacity) => {
      const paint = { type: 'SOLID', color: hexToRgb(RADIUS_ORANGE), opacity };
      return brandVar ? figma.variables.setBoundVariableForPaint(paint, 'color', brandVar) : paint;
    };

    if (!CONFIRM) {
      figma.notify(
        '🔍 DRY-RUN — would create "App Primitives/LocationPicker" (480px): search row + map(320) w/ radius circle + Latitude/Longitude/Radius fields. Flip CONFIRM to build.',
        { timeout: 12000 },
      );
      console.log('[Glaon LocationPicker] dry-run; no mutation. Variables found:', {
        surface: !!byName.get(TOKENS.surface.var),
        border: !!byName.get(TOKENS.border.var),
        brand: !!brandVar,
      });
      figma.closePlugin();
      return;
    }

    // --- Fonts ---
    const FAMILY = 'Inter';
    let fontReg = { family: FAMILY, style: 'Regular' };
    let fontMed = { family: FAMILY, style: 'Medium' };
    try {
      await figma.loadFontAsync(fontReg);
      await figma.loadFontAsync(fontMed);
    } catch {
      const fallback = { family: 'Roboto', style: 'Regular' };
      await figma.loadFontAsync(fallback);
      fontReg = fallback;
      fontMed = fallback;
    }

    const text = (chars, font, size, colorKey) => {
      const t = figma.createText();
      t.fontName = font;
      t.fontSize = size;
      t.characters = chars;
      t.fills = [fill(colorKey)];
      return t;
    };

    // A field: label above a bordered input box with the value + a trailing
    // unit suffix. Returns a vertical auto-layout frame.
    const field = (label, value, unit) => {
      const wrap = figma.createFrame();
      wrap.name = label;
      wrap.layoutMode = 'VERTICAL';
      wrap.itemSpacing = 6;
      wrap.fills = [];
      wrap.layoutGrow = 1;
      wrap.primaryAxisSizingMode = 'AUTO';
      wrap.counterAxisSizingMode = 'AUTO';
      wrap.appendChild(text(label, fontMed, 14, 'textPrimary'));

      const box = figma.createFrame();
      box.name = 'input';
      box.layoutMode = 'HORIZONTAL';
      box.primaryAxisAlignItems = 'SPACE_BETWEEN';
      box.counterAxisAlignItems = 'CENTER';
      box.paddingLeft = 12;
      box.paddingRight = 12;
      box.paddingTop = 8;
      box.paddingBottom = 8;
      box.cornerRadius = 8;
      box.fills = [fill('surface')];
      box.strokes = [fill('border')];
      box.strokeWeight = 1;
      box.layoutAlign = 'STRETCH';
      box.counterAxisSizingMode = 'AUTO';
      box.appendChild(text(value, fontReg, 16, 'textPrimary'));
      box.appendChild(text(unit, fontReg, 14, 'textMuted'));
      wrap.appendChild(box);
      return wrap;
    };

    // --- Root component, vertical auto-layout ---
    const root = figma.createComponent();
    root.name = COMPONENT_NAME;
    root.description = `Glaon home-zone picker. Map + radius circle + Latitude/Longitude/Radius fields; optional search.\nstorybook-id: ${STORYBOOK_ID}`;
    root.layoutMode = 'VERTICAL';
    root.itemSpacing = 12;
    root.paddingTop = 0;
    root.paddingBottom = 0;
    root.paddingLeft = 0;
    root.paddingRight = 0;
    root.fills = [];
    root.resize(FRAME_WIDTH, 10);
    root.primaryAxisSizingMode = 'AUTO';
    root.counterAxisSizingMode = 'FIXED';

    // (1) Search row.
    const search = figma.createFrame();
    search.name = 'search';
    search.layoutMode = 'HORIZONTAL';
    search.itemSpacing = 8;
    search.counterAxisAlignItems = 'CENTER';
    search.paddingLeft = 12;
    search.paddingRight = 12;
    search.paddingTop = 10;
    search.paddingBottom = 10;
    search.cornerRadius = 8;
    search.fills = [fill('surface')];
    search.strokes = [fill('border')];
    search.strokeWeight = 1;
    search.layoutAlign = 'STRETCH';
    search.counterAxisSizingMode = 'AUTO';
    const glass = figma.createEllipse();
    glass.resize(14, 14);
    glass.fills = [];
    glass.strokes = [fill('textMuted')];
    glass.strokeWeight = 2;
    search.appendChild(glass);
    search.appendChild(text('Search for an address', fontReg, 16, 'textMuted'));
    root.appendChild(search);

    // (2) Map area with radius circle + markers.
    const map = figma.createFrame();
    map.name = 'map';
    map.resize(FRAME_WIDTH, MAP_HEIGHT);
    map.cornerRadius = 8;
    map.clipsContent = true;
    map.fills = [fill('surfaceMuted')];
    map.strokes = [fill('border')];
    map.strokeWeight = 1;
    map.layoutAlign = 'STRETCH';
    map.layoutMode = 'NONE';

    const cx = FRAME_WIDTH / 2;
    const cy = MAP_HEIGHT / 2;
    const circleD = 150;
    const circle = figma.createEllipse();
    circle.name = 'radius';
    circle.resize(circleD, circleD);
    circle.x = cx - circleD / 2;
    circle.y = cy - circleD / 2;
    circle.fills = [orangeSolid(0.18)];
    circle.strokes = [orangeSolid(1)];
    circle.strokeWeight = 2;
    map.appendChild(circle);

    const pin = figma.createEllipse();
    pin.name = 'home-marker';
    pin.resize(18, 18);
    pin.x = cx - 9;
    pin.y = cy - 9;
    pin.fills = [fill('textPrimary')];
    map.appendChild(pin);

    const handle = figma.createEllipse();
    handle.name = 'radius-handle';
    handle.resize(14, 14);
    handle.x = cx + circleD / 2 - 7;
    handle.y = cy - 7;
    handle.fills = [orangeSolid(1)];
    handle.strokes = [{ type: 'SOLID', color: hexToRgb('#FFFFFF') }];
    handle.strokeWeight = 2;
    map.appendChild(handle);
    root.appendChild(map);

    // (3) Latitude / Longitude row.
    const coordRow = figma.createFrame();
    coordRow.name = 'coordinates';
    coordRow.layoutMode = 'HORIZONTAL';
    coordRow.itemSpacing = 12;
    coordRow.fills = [];
    coordRow.layoutAlign = 'STRETCH';
    coordRow.counterAxisSizingMode = 'AUTO';
    coordRow.appendChild(field('Latitude', '41.0082', '°'));
    coordRow.appendChild(field('Longitude', '28.9784', '°'));
    root.appendChild(coordRow);

    // (4) Radius field.
    const radiusField = field('Radius', '200', 'm');
    radiusField.layoutAlign = 'STRETCH';
    root.appendChild(radiusField);

    // Park the component on the current page near the viewport centre.
    root.x = Math.round(figma.viewport.center.x - FRAME_WIDTH / 2);
    root.y = Math.round(figma.viewport.center.y - 200);
    figma.currentPage.appendChild(root);
    figma.viewport.scrollAndZoomIntoView([root]);

    figma.notify(`✅ Created "${COMPONENT_NAME}" — node id: ${root.id}`, { timeout: 15000 });
    console.log('[Glaon LocationPicker] created node id:', root.id);
  } catch (err) {
    figma.notify(`Glaon plugin error: ${err.message}`, { error: true });
    throw err;
  } finally {
    figma.closePlugin();
  }
})();
