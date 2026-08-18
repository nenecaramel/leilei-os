# Memory Visual Acceptance Fixes Implementation Plan

**Goal:** Resolve the six mobile visual-acceptance defects found at 393×852.

**Constraints:**
- Mobile Memory only.
- Desktop unchanged.
- Todo unchanged.
- Shared PaperDetailDialog geometry unchanged.
- API/database/lifecycle contracts unchanged.
- Key remains a single visual line.
- Preview helpers remain untouched.

## Changes

1. Mirror the create Pen glyph exactly once at SVG-source level.
2. Balance header optical sizes while preserving 44×44 hit targets.
3. Give view/edit/create title and content identical paper coordinates.
4. Remove all Memory-paper input focus chrome so editing looks like writing directly on the ruled sheet.
5. Raise Archive return above surrounding presentation layers without changing its existing navigation semantics.
6. Remove both custom and native search cancel crosses.

## Verification

- RED visual acceptance tests.
- Focused Memory UI tests.
- Complete related Memory/Todo regression gate.
- Web typecheck.
- git diff --check.
