// Present native shortcut names without changing the cross-platform key handlers.
export const isMac = /Mac|iPhone|iPad/.test(globalThis.navigator?.userAgentData?.platform || globalThis.navigator?.platform || '');
export function shortcutLabels(text) {
  return isMac ? text.replaceAll('Ctrl+Y', '⌘⇧Z').replaceAll('Ctrl+', '⌘').replaceAll('Ctrl/Alt', 'Command/Option') : text;
}
export function localizeShortcuts(root) {
  if (!isMac) return;
  const visit = node => {
    if (node.nodeType === 3) node.nodeValue = shortcutLabels(node.nodeValue);
    if (node.nodeType === 1 && node.hasAttribute('title')) node.title = shortcutLabels(node.title);
    for (const child of node.childNodes) visit(child);
  };
  visit(root);
}
