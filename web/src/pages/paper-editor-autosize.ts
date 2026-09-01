const PAPER_EDITOR_MIN_HEIGHT = 240;

/**
 * Measure a paper editor without collapsing its current layout footprint.
 * Keeping a numeric height in place while reading scrollHeight prevents the
 * browser from clamping the document scroll position during long edits.
 */
export function resizePaperTextarea(node: HTMLTextAreaElement): void {
  const inlineHeight = Number.parseFloat(node.style.height);
  const renderedHeight = node.getBoundingClientRect().height || node.offsetHeight;
  const currentHeight = Math.max(
    PAPER_EDITOR_MIN_HEIGHT,
    Number.isFinite(inlineHeight) ? inlineHeight : 0,
    renderedHeight,
  );

  node.style.height = `${currentHeight}px`;
  node.style.height = `${Math.max(PAPER_EDITOR_MIN_HEIGHT, node.scrollHeight)}px`;
}
