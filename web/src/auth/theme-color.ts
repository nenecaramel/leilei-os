export function syncThemeColorMeta(
  documentRef:
    | Pick<Document, "querySelector">
    | undefined,
  background: string,
): void {
  if (
    !documentRef ||
    !/^#[0-9A-Fa-f]{6}$/.test(background)
  ) {
    return;
  }

  documentRef
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", background);
}
