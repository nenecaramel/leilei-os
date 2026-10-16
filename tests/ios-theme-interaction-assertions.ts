import assert from 'node:assert/strict';

// Original's interaction payload is intentionally immutable. iMessage may
// change only the card background (two permission/question cards); no response,
// selection, submission, errors, or history callbacks are excluded.
export function assertInteractionThemePreservesOriginal(current: string, historical: string): void {
  const anchor = 'struct NativeLivePermissionInteractionCard: View {';
  const start = current.indexOf(anchor);
  assert.ok(start > 0 && historical.includes(anchor), 'Interaction card boundary');
  const declaration = current.slice(0, start);
  assert.match(declaration, /private struct NativeLiveInteractionCardBackground: ViewModifier/);
  assert.match(declaration, /@Environment\(\\\.iMessageWallpaperVisible\)/);
  assert.match(declaration, /Color\(red: 0\.17, green: 0\.20, blue: 0\.23\)/);
  assert.match(declaration, /\.glassEffect\(\s*\.regular,\s*in: RoundedRectangle\(cornerRadius: 11, style: \.continuous\)/);
  assert.match(declaration, /Color\.primary\.opacity\(0\.055\)/);
  assert.match(declaration, /RoundedRectangle\(cornerRadius: 14, style: \.continuous\)/);

  const themePaint = '.modifier(NativeLiveInteractionCardBackground())';
  const originalPaint = '.background(Color.primary.opacity(0.055), in: RoundedRectangle(cornerRadius: 14, style: .continuous))';
  const present = current.slice(start);
  assert.equal(present.split(themePaint).length - 1, 2, 'Exactly permission and question backgrounds changed');
  const normalize = (value: string) =>
    value.replace(/"(?:\\.|[^"\\])*"|\s+/g, token => token.startsWith('"') ? token : '');
  assert.equal(normalize(present.replaceAll(themePaint, originalPaint)),
    normalize(historical.slice(historical.indexOf(anchor))),
    'All interaction submission guards, choices, IDs, strings and history remain unchanged');
}
