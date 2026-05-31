// Glaon — 08 LanguageSelect frame (#650)
//
// Creates the "App Primitives/LanguageSelect" COMPONENT in the Design
// System Figma file: a search-select trigger (leading translate glyph,
// "Language" label, "Select a language" placeholder, trailing chevron) —
// the sister of CurrencySelect / TimezoneSelect / CountrySelect. The
// component description carries `storybook-id: app-primitives-language-select`
// (Chromatic Figma-diff contract; see docs/figma.md).
//
// Usage:
//   1. Copy this file's contents into tools/figma-plugin/code.js.
//   2. Open the Design System Figma file (Inter installed; else falls back
//      to the default font).
//   3. Run plugin (Plugins → Development → Glaon) → review dry-run.
//   4. Flip CONFIRM = true → re-run → report the node id for the PR body.
//   5. git restore tools/figma-plugin/code.js
//
// Idempotent: if the component exists, the script skips creation and
// reports its id (adding the storybook-id description if missing).

const CONFIRM = false;

const COMPONENT_NAME = 'App Primitives/LanguageSelect';
const STORYBOOK_ID = 'app-primitives-language-select';
const FRAME_WIDTH = 360;

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
    if (existing) {
      if (CONFIRM && !existing.description.includes(`storybook-id: ${STORYBOOK_ID}`)) {
        existing.description =
          (existing.description ? existing.description + '\n' : '') +
          `storybook-id: ${STORYBOOK_ID}`;
      }
      figma.notify(`${CONFIRM ? '✅' : '🔍'} LanguageSelect already exists — id: ${existing.id}`, {
        timeout: 12000,
      });
      console.log('[Glaon LanguageSelect] existing node id:', existing.id);
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

    if (!CONFIRM) {
      figma.notify(
        '🔍 DRY-RUN — would create "App Primitives/LanguageSelect" (360px): label + select trigger (translate glyph, placeholder, chevron). Flip CONFIRM to build.',
        { timeout: 12000 },
      );
      figma.closePlugin();
      return;
    }

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

    const root = figma.createComponent();
    root.name = COMPONENT_NAME;
    root.description = `Glaon language picker (sister of CurrencySelect / TimezoneSelect / CountrySelect).\nstorybook-id: ${STORYBOOK_ID}`;
    root.layoutMode = 'VERTICAL';
    root.itemSpacing = 6;
    root.fills = [];
    root.resize(FRAME_WIDTH, 10);
    root.primaryAxisSizingMode = 'AUTO';
    root.counterAxisSizingMode = 'FIXED';

    root.appendChild(text('Language', fontMed, 14, 'textPrimary'));

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
    trigger.counterAxisSizingMode = 'AUTO';

    // Leading "translate" glyph — a simple "A文" mark.
    const glyph = text('A文', fontReg, 14, 'textMuted');
    trigger.appendChild(glyph);

    const placeholder = text('Select a language', fontReg, 16, 'textMuted');
    placeholder.layoutGrow = 1;
    trigger.appendChild(placeholder);

    const chevron = text('⌄', fontReg, 14, 'textMuted');
    trigger.appendChild(chevron);

    root.appendChild(trigger);

    root.x = Math.round(figma.viewport.center.x - FRAME_WIDTH / 2);
    root.y = Math.round(figma.viewport.center.y - 40);
    figma.currentPage.appendChild(root);
    figma.viewport.scrollAndZoomIntoView([root]);

    figma.notify(`✅ Created "${COMPONENT_NAME}" — node id: ${root.id}`, { timeout: 15000 });
    console.log('[Glaon LanguageSelect] created node id:', root.id);
  } catch (err) {
    figma.notify(`Glaon plugin error: ${err.message}`, { error: true });
    throw err;
  } finally {
    figma.closePlugin();
  }
})();
