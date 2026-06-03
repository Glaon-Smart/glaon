// Glaon — 10 LanguageSelect → Select (icon-leading) variant (#683)
//
// Updates the "App Primitives/LanguageSelect" COMPONENT in the Design
// System Figma file to match PR Phase B: the picker is now the kit
// `Select` (icon-leading) — a plain dropdown (NO search input), with a
// leading translate glyph, the selected language shown as its **autonym**
// (its name in its own language, e.g. "Türkçe"), and a trailing
// chevron. The component keeps its `storybook-id:
// app-primitives-language-select` description (Chromatic Figma-diff
// contract; see docs/figma.md).
//
// What changes vs the previous (ComboBox) frame: the trigger shows the
// language's autonym, and there is no search affordance — it's a select
// trigger (glyph + value + chevron).
//
// Usage:
//   1. Copy this file's contents into tools/figma-plugin/code.js.
//   2. Open the Design System Figma file (Inter installed; else falls back
//      to the default font).
//   3. Run plugin (Plugins → Development → Glaon) → review dry-run.
//   4. Flip CONFIRM = true → re-run → report the node id for the PR body.
//   5. git restore tools/figma-plugin/code.js
//
// Idempotent: rebuilds the trigger's children in place; re-running yields
// the same result.

const CONFIRM = false;

const COMPONENT_NAME = 'App Primitives/LanguageSelect';
const STORYBOOK_ID = 'app-primitives-language-select';
const FRAME_WIDTH = 360;
const SAMPLE_LABEL = 'Türkçe'; // autonym only (#683)

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
          ? `🔍 DRY-RUN — would rebuild "${COMPONENT_NAME}" [${existing.id}] as a Select ` +
              `(leading translate glyph + "${SAMPLE_LABEL}" + chevron, no search). Flip CONFIRM to apply.`
          : `🔍 DRY-RUN — "${COMPONENT_NAME}" not found; would create it as a Select. Flip CONFIRM.`,
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

    // Build the select trigger: [translate glyph] [value, grows] [chevron].
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

      trigger.appendChild(text('A文', fontReg, 14, 'textMuted')); // translate glyph
      const value = text(SAMPLE_LABEL, fontMed, 16, 'textPrimary');
      value.layoutGrow = 1;
      trigger.appendChild(value);
      trigger.appendChild(text('⌄', fontReg, 14, 'textMuted')); // chevron
      return trigger;
    };

    let root = existing;
    if (root) {
      // Rebuild children in place (keep the node id + storybook-id).
      for (const child of [...root.children]) child.remove();
      root.layoutMode = 'VERTICAL';
      root.itemSpacing = 6;
      root.fills = [];
      root.resize(FRAME_WIDTH, 10);
      root.primaryAxisSizingMode = 'AUTO';
      root.counterAxisSizingMode = 'FIXED';
      root.appendChild(text('Language', fontMed, 14, 'textPrimary'));
      root.appendChild(buildTrigger());
      if (!root.description.includes(`storybook-id: ${STORYBOOK_ID}`)) {
        root.description =
          (root.description ? root.description + '\n' : '') + `storybook-id: ${STORYBOOK_ID}`;
      }
    } else {
      root = figma.createComponent();
      root.name = COMPONENT_NAME;
      root.description = `Glaon language picker — kit Select (icon-leading), no search (#683).\nstorybook-id: ${STORYBOOK_ID}`;
      root.layoutMode = 'VERTICAL';
      root.itemSpacing = 6;
      root.fills = [];
      root.resize(FRAME_WIDTH, 10);
      root.primaryAxisSizingMode = 'AUTO';
      root.counterAxisSizingMode = 'FIXED';
      root.appendChild(text('Language', fontMed, 14, 'textPrimary'));
      root.appendChild(buildTrigger());
      root.x = Math.round(figma.viewport.center.x - FRAME_WIDTH / 2);
      root.y = Math.round(figma.viewport.center.y - 40);
      figma.currentPage.appendChild(root);
    }

    figma.viewport.scrollAndZoomIntoView([root]);
    figma.notify(`✅ Updated "${COMPONENT_NAME}" — node id: ${root.id}`, { timeout: 15000 });
    console.log('[Glaon 10 LanguageSelect] node id:', root.id);
  } catch (err) {
    figma.notify(`Glaon plugin error: ${err.message}`, { error: true });
    throw err;
  } finally {
    figma.closePlugin();
  }
})();
