# Home Records Grid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Change the four Home Records links into a full-width 2 × 2 grid with 10px gaps and 35px centered cards.

**Architecture:** Keep the existing Records markup and links. Only adjust `.home-bottom-nav` and `.home-bottom-nav a`, with regression tests locking the approved geometry.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints

- Grid is 2 × 2.
- Horizontal and vertical gap is 10px.
- Cards fill the same outer width as Todo and Calendar.
- Each card height and minimum height is 35px.
- Labels remain horizontally and vertically centered.
- Existing order, styling, links, and Records heading spacing remain unchanged.

---

### Task 1: Refine Records card geometry

**Files:**
- Modify: `tests/mobile-home-shell.test.ts`
- Modify: `web/src/styles.css`

- [ ] Add failing CSS assertions for two columns, 10px gap, and 35px card height.
- [ ] Run the focused test and confirm failure.
- [ ] Change `.home-bottom-nav` to two equal columns with a 10px gap.
- [ ] Set `.home-bottom-nav a` height and min-height to 35px.
- [ ] Keep `place-items: center`.
- [ ] Run focused tests, typecheck, and diff check.
- [ ] Review on the mobile preview before committing.
