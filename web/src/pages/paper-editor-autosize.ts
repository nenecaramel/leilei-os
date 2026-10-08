const PAPER_EDITOR_MIN_HEIGHT = 240;

/**
 * Measure a paper editor without collapsing its current layout footprint.
 * The off-flow clone can be reset for measurement without changing the live
 * textarea's contribution to document layout or its selection.
 */
export function resizePaperTextarea(node: HTMLTextAreaElement, minimumHeight = PAPER_EDITOR_MIN_HEIGHT): void {
  const measuringNode = node.cloneNode(false) as HTMLTextAreaElement;
  measuringNode.value = node.value;
  measuringNode.style.position = "absolute";
  measuringNode.style.visibility = "hidden";
  measuringNode.style.pointerEvents = "none";
  measuringNode.style.height = "auto";
  measuringNode.style.minHeight = "0";
  measuringNode.style.maxHeight = "none";
  measuringNode.style.overflow = "hidden";

  const computedWidth = typeof window === "undefined"
    ? ""
    : window.getComputedStyle(node).width;
  if (computedWidth && computedWidth !== "auto") measuringNode.style.width = computedWidth;

  const parent = node.parentElement;
  if (parent) parent.appendChild(measuringNode);
  const contentHeight = measuringNode.scrollHeight;
  measuringNode.remove();

  node.style.height = `${Math.max(minimumHeight, contentHeight)}px`;
}
