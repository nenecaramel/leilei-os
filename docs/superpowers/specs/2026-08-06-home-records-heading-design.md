# Home Records Heading Design

## Scope

Only adjust mobile Home section labeling and selected heading font weights.

## Records section

Add a `Records` heading directly above the four existing bottom cards:

- Memory
- Diary
- Task
- Universe

`Records` must reuse the same section-heading structure and match the visual spacing rhythm of `Todo` and `Calendar`.

Required alignment and spacing:

- same left edge as `Todo` and `Calendar`
- same font family and font size
- font weight 500
- distance from `Records` to the four cards below must equal the distance from `Calendar` to the calendar card below
- distance from the calendar card above to `Records` must follow the same section-to-section spacing used between the Todo section and Calendar section
- spacing values may compensate for the Calendar frame pseudo-element, but the rendered visual rhythm must match

The four cards and their internal content remain unchanged.

## Font-weight adjustment

Use font weight 500 for:

- Home top-bar `Leilei OS`
- sidebar `Leilei OS`
- `Todo`
- `Calendar`
- `Records`

Navigation text remains at font weight 500.

## Non-goals

Do not change:

- card sizes or internal content
- Todo body layout
- Calendar layout
- sidebar geometry
- dialogs or interactions

## Verification

Tests should confirm:

- Home renders the `Records` heading
- `Records` appears directly before the four bottom cards
- `Records` reuses the same heading class and spacing structure as `Todo` and `Calendar`
- the selected headings use font weight 500
- existing Home and mobile-shell tests still pass
