// Glaon — 09 Home Overview: language switcher → header top-right (#670)
//
// Updates the Home Overview wizard screen frame (node 1277:791 in the
// Design System file) to match PR #671:
//   - REMOVE the "Language" / "Dil" row from the form's field list.
//   - ADD a compact, label-less language control pinned to the TOP-RIGHT
//     of the step header (title/subtitle on the left). The control shows a
//     translate glyph + the selected language ("İngilizce") + a chevron,
//     ~176px wide, aligned to the title's top.
//
// The screen frame is hand-built, so this script does NOT assume layer
// names. It locates nodes by their visible text ("Home Overview" /
// "Ev Genel Bakış" for the header; "Language" / "Dil" for the row) and
// logs a full layer tree in dry-run so the structure can be confirmed
// before mutating.
//
// Usage:
//   1. Copy this file's contents into tools/figma-plugin/code.js.
//   2. Open the Design System Figma file.
//   3. Run plugin (Plugins → Development → Glaon) → read the dry-run tree
//      in the console (View → Show/Hide console) and the notify summary.
//   4. If the matched header + language-row look right, flip CONFIRM = true
//      → re-run → report the frame node id for the PR body.
//   5. git restore tools/figma-plugin/code.js
//
// Idempotent: if a language control already exists in the header (a node
// named "lang-switcher-topright"), the script skips the add; if the form
// row is already gone, it skips the remove.

const CONFIRM = false;

// Home Overview screen frame. Falls back to a name match if the id drifts.
const FRAME_ID = '1277:791';
const FRAME_NAME_HINTS = ['Home Overview', 'Ev Genel Bakış', 'SETUP', 'Home Overview Step'];

// Visible text used to locate the header title + the language form row.
const HEADER_TEXT = ['home overview', 'ev genel bakış'];
const LANGUAGE_TEXT = ['language', 'dil'];

const ADDED_NODE_NAME = 'lang-switcher-topright';
const CONTROL_WIDTH = 176;

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

function norm(s) {
  return (s || '').trim().toLowerCase();
}

// Print a compact layer tree (name/type + text) for confirmation.
function dumpTree(node, depth, lines) {
  const pad = '  '.repeat(depth);
  const txt = node.type === 'TEXT' ? ` "${node.characters.slice(0, 40)}"` : '';
  lines.push(`${pad}${node.type} · ${node.name}${txt} [${node.id}]`);
  if (depth >= 4) return; // keep the dump shallow
  if ('children' in node) {
    for (const c of node.children) dumpTree(c, depth + 1, lines);
  }
}

// Find the first TEXT descendant whose content matches one of `needles`.
function findTextNode(root, needles) {
  let hit = null;
  const walk = (n) => {
    if (hit) return;
    if (n.type === 'TEXT' && needles.some((needle) => norm(n.characters).includes(needle))) {
      hit = n;
      return;
    }
    if ('children' in n) n.children.forEach(walk);
  };
  walk(root);
  return hit;
}

// Walk up from `node` until the parent is `stopAt` (exclusive) — i.e. the
// top-level "row" container directly under the form/fields wrapper.
function rowAncestorUnder(node, stopAt) {
  let cur = node;
  while (cur.parent && cur.parent.id !== stopAt.id) cur = cur.parent;
  return cur === node ? null : cur;
}

(async () => {
  try {
    // --- locate the screen frame ---
    let frame = await figma.getNodeByIdAsync(FRAME_ID).catch(() => null);
    if (!frame) {
      const frames = await figma.root.findAllWithCriteria({ types: ['FRAME', 'COMPONENT'] });
      frame = frames.find((n) => FRAME_NAME_HINTS.some((h) => norm(n.name).includes(norm(h))));
    }
    if (!frame) {
      figma.notify(`Glaon: Home Overview frame not found (id ${FRAME_ID}).`, { error: true });
      figma.closePlugin();
      return;
    }

    const headerText = findTextNode(frame, HEADER_TEXT);
    const alreadyAdded =
      'children' in frame ? frame.findOne((n) => n.name === ADDED_NODE_NAME) : null;

    // The language ROW is a "Language"/"Dil" text that is NOT the header
    // title and not our own added control.
    let langRowText = null;
    {
      const all = frame.findAll
        ? frame.findAll(
            (n) =>
              n.type === 'TEXT' &&
              LANGUAGE_TEXT.includes(norm(n.characters)) &&
              (!headerText || n.id !== headerText.id),
          )
        : [];
      langRowText = all[0] || null;
    }

    if (!CONFIRM) {
      const lines = [];
      dumpTree(frame, 0, lines);
      console.log('[Glaon 09] Home Overview frame tree:\n' + lines.join('\n'));
      console.log('[Glaon 09] header title node:', headerText ? headerText.id : 'NOT FOUND');
      console.log('[Glaon 09] language row text node:', langRowText ? langRowText.id : 'NOT FOUND');
      console.log(
        '[Glaon 09] existing top-right control:',
        alreadyAdded ? alreadyAdded.id : 'none',
      );
      figma.notify(
        `🔍 DRY-RUN — frame "${frame.name}" [${frame.id}]. ` +
          `Header: ${headerText ? 'found' : 'MISSING'}; ` +
          `language row: ${langRowText ? 'found' : 'MISSING'}; ` +
          `top-right control: ${alreadyAdded ? 'present' : 'none'}. ` +
          `See console for the layer tree. Flip CONFIRM to apply.`,
        { timeout: 16000 },
      );
      figma.closePlugin();
      return;
    }

    // --- CONFIRM: mutate ---
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

    const summary = [];

    // 1) Remove the language form row (the row container directly under the
    //    fields wrapper). We delete the row container so the divider goes too.
    if (langRowText) {
      // The form/fields wrapper is the language text's row's parent. Find the
      // nearest ancestor whose parent is a VERTICAL auto-layout (the field
      // stack); remove that ancestor (the whole row).
      let row = langRowText;
      while (
        row.parent &&
        row.parent.id !== frame.id &&
        !(
          row.parent.type === 'FRAME' &&
          row.parent.layoutMode === 'VERTICAL' &&
          row.parent.children.length > 2
        )
      ) {
        row = row.parent;
      }
      if (row && row.parent && row.id !== frame.id) {
        summary.push(`removed language row "${row.name}" [${row.id}]`);
        row.remove();
      } else {
        summary.push('language row container not confidently resolved — left untouched');
      }
    } else {
      summary.push('language row already absent');
    }

    // 2) Add a compact label-less language control to the header's top-right.
    if (alreadyAdded) {
      summary.push(`top-right control already present [${alreadyAdded.id}]`);
    } else if (headerText) {
      // Build the control (translate glyph + selected language + chevron).
      const control = figma.createFrame();
      control.name = ADDED_NODE_NAME;
      control.layoutMode = 'HORIZONTAL';
      control.itemSpacing = 8;
      control.counterAxisAlignItems = 'CENTER';
      control.paddingLeft = 12;
      control.paddingRight = 10;
      control.paddingTop = 8;
      control.paddingBottom = 8;
      control.cornerRadius = 8;
      control.fills = [fill('surface')];
      control.strokes = [fill('border')];
      control.strokeWeight = 1;
      control.resize(CONTROL_WIDTH, 36);
      control.counterAxisSizingMode = 'FIXED';
      control.primaryAxisSizingMode = 'FIXED';

      control.appendChild(text('A文', fontReg, 13, 'textMuted')); // translate glyph
      const sel = text('İngilizce', fontReg, 14, 'textPrimary');
      sel.layoutGrow = 1;
      control.appendChild(sel);
      control.appendChild(text('⌄', fontReg, 13, 'textMuted'));

      // Determine the header row (ancestor of the title that sits directly
      // under the frame or a top section) to align against, then pin the
      // control to its top-right using absolute coordinates within the frame.
      const headerRow = rowAncestorUnder(headerText, frame) || headerText;
      const titleAbs = headerText.absoluteBoundingBox;
      const frameAbs = frame.absoluteBoundingBox;
      // Right inset mirrors the screen's content gutter (use the header row's
      // right edge if available, else the frame's right padding ~48px).
      const rowAbs = headerRow.absoluteBoundingBox || frameAbs;
      const rightEdge = rowAbs.x + rowAbs.width; // content right edge
      frame.appendChild(control);
      control.x = Math.round(rightEdge - frameAbs.x - CONTROL_WIDTH);
      control.y = Math.round((titleAbs ? titleAbs.y : frameAbs.y + 48) - frameAbs.y);
      summary.push(
        `added top-right language control [${control.id}] at (${control.x}, ${control.y})`,
      );
    } else {
      summary.push('header title not found — top-right control NOT added');
    }

    console.log('[Glaon 09] ' + summary.join(' | '));
    figma.notify(`✅ Home Overview updated — frame ${frame.id}. ${summary.join(' | ')}`, {
      timeout: 18000,
    });
  } catch (err) {
    figma.notify(`Glaon plugin error: ${err.message}`, { error: true });
    throw err;
  } finally {
    figma.closePlugin();
  }
})();
