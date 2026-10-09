# Native mobile / desktop CSS ownership

`native-mobile-page-css.ts` is the Vite adapter. It recognizes the existing
`?native-mobile-desktop` query and delegates to `native-mobile-css-transform.ts`.
The latter owns only deterministic parsing, selector filtering and projection;
it has no Vite or browser lifecycle dependency. Existing public exports remain
available from the adapter.

## Cascade contract

`src/main.tsx` loads the accepted base declarations first, then foundation and
feature styles, then the generated desktop layers, and finally
`native-mobile-desktop-geometry.css`. Page-level CSS imports remain owned by
those pages. Import order is part of the UI contract, not cosmetic formatting.

The generated layer takes eligible declarations from existing `max-width: 760px`
blocks and emits them under `min-width: 761px`. Shared paper/date declarations
are scoped to the existing target routes. It does not reimplement the mobile
appearance in a separate hand-written desktop theme.

`styles.css` still contains ordered base and responsive overrides. Similar
selectors can have different cascade roles; neither apparent duplication nor
file size proves a rule is removable. This cleanup deliberately leaves all CSS
bytes, selector order and `main.tsx` imports unchanged.

## Offline verification

`tests/native-mobile-css-transform.test.ts` pins the eight generated layers
against main `372735d4`, exercises nested rules/quoted syntax, malformed inputs,
plugin filtering and the original mirror API. `responsive-ui-regressions.test.ts`
also protects import order and desktop geometry boundaries. Update an accepted
output hash only after verifying the actual main declaration change with the
previous transformer; do not regenerate it merely to dismiss a failure.

These checks establish generation/cascade conservation. They do not substitute
for an actual browser viewport or light/dark visual comparison.
