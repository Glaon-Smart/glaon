// Glaon — 12 TimezoneSelect → SearchSelect (button + popover search) (#690)
//
// Updates the "App Primitives/TimezoneSelect" COMPONENT in the Design
// System Figma file to match PR #690: the timezone picker is no longer an
// editable input (ComboBox) — it's a **button trigger** (leading clock
// glyph + selected `(GMT±hh:mm) City` label + chevron) that opens a popover
// with a **search field** inside it (kit SearchSelect). Options come from
// react-timezone-select; the value is the IANA id. Keeps `storybook-id:
// app-primitives-timezone-select` (Chromatic Figma-diff contract).
//
// The frame shows the closed trigger; search-in-popover is the open state.
//
// Usage:
//   1. Copy this file's contents into tools/figma-plugin/code.js.
//   2. Open the Design System Figma file.
//   3. Run plugin (Plugins → Development → Glaon) → review dry-run.
//   4. Flip CONFIRM = true → re-run → report the node id for the PR body.
//   5. git restore tools/figma-plugin/code.js

const CONFIRM = false;

const COMPONENT_NAME = 'App Primitives/TimezoneSelect';
const STORYBOOK_ID = 'app-primitives-timezone-select';
const FRAME_WIDTH = 360;
const SAMPLE_LABEL = '(GMT+03:00) Istanbul';

const TOKENS = {
  surface: { var: 'surface/default', hex: '#FFFFFF' },
  border: { var: 'border/subtle', hex: '#E4E7EC' },
  textPrimary: { var: 'text/primary', hex: '#181D27' },
  textMuted: { var: 'text/muted', hex: '#717680' },
};

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
    const existing = (await figma.root.findAllWithCriteria({ types: ['COMPONENT'] })).find(
      (n) => n.name === COMPONENT_NAME,
    );

    if (!CONFIRM) {
      figma.notify(
        existing
          ? `🔍 DRY-RUN — would rebuild "${COMPONENT_NAME}" [${existing.id}] as a button trigger ` +
              `(clock + "${SAMPLE_LABEL}" + chevron; search in popover). Flip CONFIRM to apply.`
          : `🔍 DRY-RUN — "${COMPONENT_NAME}" not found; would create it. Flip CONFIRM.`,
        { timeout: 13000 },
      );
      figma.closePlugin();
      return;
    }

    const vars = await figma.variables.getLocalVariablesAsync();
    const byName = new Map(vars.map((v) => [v.name, v]));
    const fill = (key) => {
      const t = TOKENS[key];
      const paint = { type: 'SOLID', color: hexToRgb(t.hex) };
      const v = byName.get(t.var);
      return v ? figma.variables.setBoundVariableForPaint(paint, 'color', v) : paint;
    };

    const FAMILY = 'Inter';
    let fontReg = { family: FAMILY, style: 'Regular' };
    let fontMed = { family: FAMILY, style: 'Medium' };
    try {
      await figma.loadFontAsync(fontReg);
      await figma.loadFontAsync(fontMed);
    } catch {
      const fb = { family: 'Roboto', style: 'Regular' };
      await figma.loadFontAsync(fb);
      fontReg = fb;
      fontMed = fb;
    }
    const text = (chars, font, size, colorKey) => {
      const t = figma.createText();
      t.fontName = font;
      t.fontSize = size;
      t.characters = chars;
      t.fills = [fill(colorKey)];
      return t;
    };

    const buildTrigger = () => {
      const trigger = figma.createFrame();
      trigger.name = 'trigger';
      trigger.layoutMode = 'HORIZONTAL';
      trigger.itemSpacing = 8;
      trigger.counterAxisAlignItems = 'CENTER';
      trigger.paddingLeft = 12;
      trigger.paddingRight = 12;
      trigger.paddingTop = 10;
      trigger.paddingBottom = 10;
      trigger.cornerRadius = 8;
      trigger.fills = [fill('surface')];
      trigger.strokes = [fill('border')];
      trigger.strokeWeight = 1;
      trigger.layoutAlign = 'STRETCH';
      trigger.primaryAxisSizingMode = 'FIXED';
      trigger.counterAxisSizingMode = 'AUTO';

      trigger.appendChild(text('🕐', fontReg, 16, 'textMuted')); // clock glyph stand-in
      const value = text(SAMPLE_LABEL, fontMed, 16, 'textPrimary');
      value.layoutGrow = 1;
      trigger.appendChild(value);
      trigger.appendChild(text('⌄', fontReg, 14, 'textMuted')); // chevron
      return trigger;
    };

    const apply = (node) => {
      node.layoutMode = 'VERTICAL';
      node.itemSpacing = 6;
      node.fills = [];
      node.resize(FRAME_WIDTH, 10);
      node.primaryAxisSizingMode = 'AUTO';
      node.counterAxisSizingMode = 'FIXED';
      node.appendChild(text('Timezone', fontMed, 14, 'textPrimary'));
      node.appendChild(buildTrigger());
    };

    let root = existing;
    if (root) {
      for (const child of [...root.children]) child.remove();
      apply(root);
      if (!root.description.includes(`storybook-id: ${STORYBOOK_ID}`)) {
        root.description =
          (root.description ? root.description + '\n' : '') + `storybook-id: ${STORYBOOK_ID}`;
      }
    } else {
      root = figma.createComponent();
      root.name = COMPONENT_NAME;
      root.description = `Glaon timezone picker — kit SearchSelect (button + in-popover search), options from react-timezone-select (#690).\nstorybook-id: ${STORYBOOK_ID}`;
      apply(root);
      root.x = Math.round(figma.viewport.center.x - FRAME_WIDTH / 2);
      root.y = Math.round(figma.viewport.center.y - 40);
      figma.currentPage.appendChild(root);
    }

    figma.viewport.scrollAndZoomIntoView([root]);
    figma.notify(`✅ Updated "${COMPONENT_NAME}" — node id: ${root.id}`, { timeout: 15000 });
    console.log('[Glaon 12 TimezoneSelect] node id:', root.id);
  } catch (err) {
    figma.notify(`Glaon plugin error: ${err.message}`, { error: true });
    throw err;
  } finally {
    figma.closePlugin();
  }
})();
