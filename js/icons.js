// free-trace icon set — 24x24 stroke drawings per TRUELINE UI spec section 3.
// Every icon: viewBox 0 0 24 24, stroke currentColor 1.5, round caps/joins,
// fill only where the spec calls for solid shapes (arrowheads, mirror triangle...).

const ATTRS = 'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"';
const s = (body) => `<svg ${ATTRS}>${body}</svg>`;

export const ICONS = {
  // ---- select / navigate ----
  'select': s('<path d="M6 4l5.3 12.7 1.9-5.5 5.5-1.9z"/><path d="M13.4 13.4l4.6 4.6"/>'),
  'lasso': s('<path stroke-dasharray="3 2.4" d="M12 5c4.5 0 8 1.9 8 4.4 0 2.7-3.3 4.5-7.6 4.6C8 14.1 4.2 12.6 4.2 9.9 4.2 7.2 7.5 5 12 5z"/><path d="M6.3 12.8c-1.8 1.5-2.7 3.4-2.2 6.2"/>'),
  'pan': s('<path d="M7 12.6V8.4a1.3 1.3 0 0 1 2.6 0V11"/><path d="M9.6 11V6.6a1.3 1.3 0 0 1 2.6 0v4.1"/><path d="M12.2 10.7V7.4a1.3 1.3 0 0 1 2.6 0V12"/><path d="M7 12.6v.9c0 3.3 2.1 5.5 5.3 5.5 2.9 0 4.8-1.9 5.1-4.7l.3-2.5a1.25 1.25 0 0 0-2.48-.35l-.12 1"/><path d="M9.7 21h4.8"/>'),
  // ---- draw ----
  'line': s('<path d="M6.4 17.6L17.6 6.4"/><rect x="3.6" y="17.6" width="2.8" height="2.8"/><rect x="17.6" y="3.6" width="2.8" height="2.8"/>'),
  'polyline': s('<path d="M4 18l6-10 5 6 5-8"/><rect x="2.7" y="16.7" width="2.6" height="2.6"/><rect x="8.7" y="6.7" width="2.6" height="2.6"/><rect x="13.7" y="12.7" width="2.6" height="2.6"/><rect x="18.7" y="4.7" width="2.6" height="2.6"/>'),
  'rect': s('<rect x="5" y="7" width="14" height="10"/><rect x="3.8" y="5.8" width="2.4" height="2.4"/><rect x="17.8" y="5.8" width="2.4" height="2.4"/><rect x="3.8" y="15.8" width="2.4" height="2.4"/><rect x="17.8" y="15.8" width="2.4" height="2.4"/>'),
  'circle': s('<circle cx="12" cy="12" r="7"/><path d="M10.6 12h2.8M12 10.6v2.8"/>'),
  'arc': s('<path d="M10 5.8A7.5 7.5 0 1 0 19.3 15"/><path d="M10.8 13h2.4M12 11.8v2.4"/><path d="M10.45 7.2L9.67 4.3M17.8 14.6l2.9.8"/>'),
  'ellipse': s('<ellipse cx="12" cy="12" rx="8" ry="5"/><path d="M10.6 12h2.8M12 10.6v2.8"/>'),
  'spline': s('<path d="M4 18C9 4 15 20 20 6"/><path stroke-width="1" d="M4 18l4.3-12.1M20 6l-4.3 12.1"/><circle cx="9" cy="4" r="1.5"/><circle cx="15" cy="20" r="1.5"/>'),
  'point': s('<circle cx="12" cy="12" r="3"/><path d="M12 6.8v10.4M6.8 12h10.4"/><circle cx="12" cy="12" r=".9" fill="currentColor" stroke="none"/>'),
  'text': s('<path d="M8 16.5L12 6l4 10.5M9.7 13h4.6"/><path d="M5 19.5h14"/>'),
  // ---- dimension ----
  'dim-linear': s('<path d="M5 7.5v9.5M19 7.5v9.5"/><path d="M7.6 14.5h8.8"/><path fill="currentColor" stroke="none" d="M5 14.5l2.6-1v2z"/><path fill="currentColor" stroke="none" d="M19 14.5l-2.6-1v2z"/><path d="M10.9 9.3v3M13.1 9.3v3"/>'),
  'dim-angular': s('<path d="M5 19h14M5 19L12.5 6"/><path d="M13 19A8 8 0 0 0 9 12.07"/><path fill="currentColor" stroke="none" d="M13 19l.5-2.2-1.56.25z"/><path fill="currentColor" stroke="none" d="M9 12.1l2.23.67-1.14 1.14z"/>'),
  'dim-radial': s('<circle cx="12" cy="12" r="7"/><path d="M12 12l3.7 2.6"/><path fill="currentColor" stroke="none" d="M17.7 16l-2.37-.81.8-1.14z"/><path d="M10.8 12h2.4M12 10.8v2.4"/>'),
  // ---- modify ----
  'move': s('<path d="M12 5v14M5 12h14"/><path d="M9.9 7.1L12 5l2.1 2.1M9.9 16.9L12 19l2.1-2.1M7.1 9.9L5 12l2.1 2.1M16.9 9.9L19 12l-2.1 2.1"/>'),
  'copy': s('<rect x="4.5" y="4.5" width="10" height="10" stroke-dasharray="2.6 2"/><rect x="8.5" y="8.5" width="10" height="10"/>'),
  'rotate': s('<path d="M12 5.5A6.5 6.5 0 1 1 5.5 12"/><path fill="currentColor" stroke="none" d="M5.5 9.6l1.1 2.7H4.4z"/><path d="M10.9 12h2.2M12 10.9v2.2"/>'),
  'scale': s('<rect x="4.5" y="5.5" width="14" height="14" stroke-dasharray="2.5 2"/><rect x="4.5" y="13.5" width="6" height="6"/><path d="M11.6 12.4l5.3-5.3"/><path fill="currentColor" stroke="none" d="M18.2 5.8l-1 2.1-1.1-1.1z"/>'),
  'mirror': s('<path stroke-dasharray="4.5 2.2 1 2.2" d="M12 4v16"/><path fill="currentColor" stroke="none" d="M9.5 8v8H4.7z"/><path stroke-dasharray="2.4 1.8" d="M14.5 8v8h4.8z"/>'),
  'trim': s('<path d="M5 17L19 7"/><path d="M14 4v6.6"/><path stroke-dasharray="2.2 2" d="M14 10.6V20"/><path d="M12.9 11l2.2 2M15.1 11l-2.2 2"/>'),
  'extend': s('<path d="M19 5v14"/><path d="M4 12h7"/><path stroke-dasharray="2 1.8" d="M11 12h5"/><path fill="currentColor" stroke="none" d="M18.6 12l-2.6-1.1v2.2z"/>'),
  'offset': s('<path d="M4.5 14.5Q12 4.5 19.5 9.5M4.5 19.5Q12 9.5 19.5 14.5"/><path d="M12 8.9v3.7"/><path d="M10.7 11.2L12 12.6l1.3-1.4"/>'),
  'fillet': s('<path d="M6 19v-7a5 5 0 0 1 5-5h8"/><rect x="6" y="7" width="5" height="5" stroke-dasharray="2 1.6"/>'),
  'chamfer': s('<path d="M6 19v-7l5-5h8"/>'),
  // ---- measure ----
  'measure': s('<path d="M6 5.5h12M6 5.5V14M18 5.5V14M6 14h2.6M18 14h-2.6"/><path d="M4 18.5h16M4 17.2v2.6M20 17.2v2.6"/>'),
  // ---- panels / states ----
  'layers': s('<path d="M12 4.2L19.8 8 12 11.8 4.2 8z"/><path opacity=".6" d="M12 8.2L19.8 12 12 15.8 4.2 12z"/><path opacity=".35" d="M12 12.2L19.8 16 12 19.8 4.2 16z"/>'),
  'eye': s('<path d="M3.5 12c2.2-4.2 5-6.3 8.5-6.3s6.3 2.1 8.5 6.3c-2.2 4.2-5 6.3-8.5 6.3S5.7 16.2 3.5 12z"/><circle cx="12" cy="12" r="2.6"/>'),
  'eye-off': s('<path d="M3.5 12c2.2-4.2 5-6.3 8.5-6.3s6.3 2.1 8.5 6.3c-2.2 4.2-5 6.3-8.5 6.3S5.7 16.2 3.5 12z"/><circle cx="12" cy="12" r="2.6"/><path d="M5 19L19 5"/>'),
  'lock': s('<rect x="7.5" y="11" width="9" height="8" rx="1.5"/><path d="M8 11V8.7a4 4 0 0 1 8 0V11"/>'),
  'unlock': s('<rect x="7.5" y="11" width="9" height="8" rx="1.5"/><path d="M8 11V8.7a4 4 0 0 1 7.8-1.3"/>'),
  // ---- toggles ----
  'snap': s('<path d="M6.5 14V9.8a5.5 5.5 0 0 1 11 0V14"/><path d="M10.2 14v-4a1.8 1.8 0 0 1 3.6 0v4"/><path d="M6.5 14h3.7M13.8 14h3.7"/><path d="M8.3 16.6v2.2M15.7 16.6v2.2"/>'),
  'grid': s('<g fill="currentColor" stroke="none"><circle cx="6" cy="6" r="1.1"/><circle cx="12" cy="6" r="1.1"/><circle cx="18" cy="6" r="1.1"/><circle cx="6" cy="12" r="1.1"/><circle cx="12" cy="12" r="1.1"/><circle cx="18" cy="12" r="1.1"/><circle cx="6" cy="18" r="1.1"/><circle cx="12" cy="18" r="1.1"/><circle cx="18" cy="18" r="1.1"/></g>'),
  'ortho': s('<path d="M7 5v13h13"/><path d="M7 13.4h4.6V18"/>'),
  'polar': s('<path d="M6 18h13M6 18V5M6 18l9.5-9.5"/><path stroke-dasharray="2.4 2.2" d="M15 18a9 9 0 0 0-9-9"/><circle cx="6" cy="18" r="1.2" fill="currentColor" stroke="none"/>'),
  // ---- app bar ----
  'undo': s('<path d="M8.5 13.5L4 9l4.5-4.5"/><path d="M4 9h9.5a5.5 5.5 0 0 1 0 11H9"/>'),
  'redo': s('<path d="M15.5 13.5L20 9l-4.5-4.5"/><path d="M20 9h-9.5a5.5 5.5 0 0 0 0 11H15"/>'),
  'export': s('<path d="M5 13.5V19h14v-5.5"/><path d="M12 15V4.8"/><path d="M8.4 8.2L12 4.6l3.6 3.6"/>'),
  'import': s('<path d="M5 13.5V19h14v-5.5"/><path d="M12 4.5v9.1"/><path d="M8.4 10L12 13.6 15.6 10"/>'),
  'settings': s('<circle cx="12" cy="12" r="5.8"/><circle cx="12" cy="12" r="2.4"/><path stroke-width="2" d="M17.8 12H20M12 17.8V20M6.2 12H4M12 6.2V4M16.1 16.1l1.56 1.56M7.9 16.1l-1.56 1.56M7.9 7.9L6.34 6.34M16.1 7.9l1.56-1.56"/>'),
  'zoom-fit': s('<path d="M8 4.5H4.5V8M16 4.5h3.5V8M19.5 16v3.5H16M8 19.5H4.5V16"/><rect x="8.5" y="9.5" width="7" height="5"/>'),
  'calibrate': s('<rect x="3.5" y="14.5" width="17" height="5.5" rx=".8"/><path d="M6.5 14.5v2.4M9.5 14.5v3.2M12.5 14.5v2.4M15.5 14.5v3.2M18.5 14.5v2.4"/><circle cx="12" cy="8" r="2.7"/><path d="M12 3.8v8.4M7.8 8h8.4"/>'),
  'tablet': s('<rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="M18.5 5.5l-7.6 7.6"/><path fill="currentColor" stroke="none" d="M9.5 14.5l1.69-.85-.84-.84z"/>'),
  'save': s('<path d="M15.3 4.5H6A1.5 1.5 0 0 0 4.5 6v12A1.5 1.5 0 0 0 6 19.5h12a1.5 1.5 0 0 0 1.5-1.5V8.7z"/><path d="M8 19.5v-6h8v6"/><path d="M8 4.5V8h6"/>'),
  'open': s('<path d="M4 18.5V6.8a1.3 1.3 0 0 1 1.3-1.3h4.2l2 2.4h6.2A1.3 1.3 0 0 1 19 9.2v1.3"/><path d="M4 18.5l2.5-6.4a1.3 1.3 0 0 1 1.2-.8h12.6l-2.7 6.4a1.3 1.3 0 0 1-1.2.8z"/>'),
  // ---- generic ui ----
  'plus': s('<path d="M12 5.5v13M5.5 12h13"/>'),
  'trash': s('<path d="M5 7h14"/><path d="M9.5 7V5.7a1.2 1.2 0 0 1 1.2-1.2h2.6a1.2 1.2 0 0 1 1.2 1.2V7"/><path d="M6.7 7l.7 11.2a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5L17.3 7"/><path d="M10.2 10.5v5.8M13.8 10.5v5.8"/>'),
  'close': s('<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'),
  'check': s('<path d="M5 12.5l4.5 4.5L19 7"/>'),
  'chevron-down': s('<path d="M7 10l5 5 5-5"/>'),
  // ---- trace-specific ----
  'freehand': s('<path d="M4 16c1.9-4.6 3.5-5.8 4.7-3.6 1.3 2.3 1.8 4.7 3.4 4.2 1.5-.5 1.9-3.4 2.9-5.1"/><path fill="currentColor" stroke="none" d="M15 11.5l3.1-4.3 1.2 1.2z"/>'),
  'area': s('<path stroke-dasharray="2.8 2.2" d="M7 5.5h10l2.5 5-3 8h-9l-3-8z"/><path stroke-width="1" d="M6.5 11l4.5-4.5M7 15l8-8M9.5 18l9-9M13.5 18l4.5-4.5"/>'),
};

const FALLBACK = s('<rect x="4.5" y="4.5" width="15" height="15" rx="2"/><path d="M9.9 9.6a2.1 2.1 0 1 1 3 1.9c-.6.3-.9.7-.9 1.5"/><circle cx="12" cy="16.4" r=".8" fill="currentColor" stroke="none"/>');

export function icon(name) {
  return ICONS[name] || FALLBACK;
}

const REQUIRED = [
  'select', 'lasso', 'pan', 'line', 'polyline', 'rect', 'circle', 'arc',
  'ellipse', 'spline', 'point', 'text', 'dim-linear', 'dim-angular',
  'dim-radial', 'move', 'copy', 'rotate', 'scale', 'mirror', 'trim',
  'extend', 'offset', 'fillet', 'chamfer', 'measure', 'layers', 'eye',
  'eye-off', 'lock', 'unlock', 'snap', 'grid', 'ortho', 'polar', 'undo',
  'redo', 'export', 'import', 'settings', 'zoom-fit', 'calibrate', 'tablet',
  'save', 'open', 'plus', 'trash', 'close', 'check', 'chevron-down',
  'freehand', 'area',
];

export function selfTest() {
  const failures = [];
  for (const name of REQUIRED) {
    const svg = ICONS[name];
    if (typeof svg !== 'string' || svg.length === 0) {
      failures.push(`${name}: missing`);
      continue;
    }
    if (!/^<svg\b[^>]*>[\s\S]*<\/svg>$/.test(svg)) {
      failures.push(`${name}: not a complete <svg>...</svg> element`);
    }
    if (!svg.includes('viewBox="0 0 24 24"')) {
      failures.push(`${name}: missing viewBox="0 0 24 24"`);
    }
    const opens = (svg.match(/<[a-zA-Z]/g) || []).length;
    const closes = (svg.match(/\/>/g) || []).length + (svg.match(/<\/[a-zA-Z]/g) || []).length;
    if (opens !== closes) {
      failures.push(`${name}: unbalanced tags (${opens} open vs ${closes} close)`);
    }
    if (((svg.match(/"/g) || []).length) % 2 !== 0) {
      failures.push(`${name}: unbalanced attribute quotes`);
    }
  }
  for (const key of Object.keys(ICONS)) {
    if (!REQUIRED.includes(key)) failures.push(`${key}: extra icon not in inventory`);
  }
  return { pass: failures.length === 0, failures };
}
