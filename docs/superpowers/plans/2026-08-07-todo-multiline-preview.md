# Todo Multiline Editing and Home Preview Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Fix wrapped Todo editing and make Home preview limit content by three visual text lines.

**Architecture:** Keep one Todo as one logical entry. The editor auto-sizes its textarea on activation; Home renders all Todo entries inside a measured three-line viewport and shows a separate overflow indicator only when rendered content exceeds that viewport.

**Tech Stack:** React, TypeScript, CSS, Node test runner.

## Global Constraints
- Automatic wrapping never creates extra Todo data.
- Enter still activates the next Todo.
- Status marks belong to the first visual line.
- Home card dimensions and signature position stay unchanged.
- Overflow indicator is left-aligned with Todo text and visually fades.

### Task 1: Multiline Todo editing

**Files:** Modify `web/src/pages/TodoPaperEditor.tsx`; test in `tests/todo-paper-dialog.test.ts`.

- [ ] RED: require textarea sizing when an existing wrapped Todo becomes active, not only after input.
- [ ] Run the focused Todo paper test and confirm failure.
- [ ] GREEN: add `resizeTodoTextarea(textarea)` that resets height to `auto` and then uses `scrollHeight`.
- [ ] Call it when the textarea ref mounts and from `handleInput`.
- [ ] Preserve pending caret restoration after sizing.
- [ ] Re-run the focused Todo paper test.

### Task 2: Three visual-line Home preview

**Files:** Modify `web/src/pages/TodayPanel.tsx` and `web/src/styles.css`; test in `tests/mobile-home-shell.test.ts`.

- [ ] RED: require removal of `notes.slice(0, 3)` and require visual overflow handling.
- [ ] Run the focused Home test and confirm failure.
- [ ] GREEN: render all notes into a three-line viewport and measure `scrollHeight > clientHeight + 1`.
- [ ] Re-measure when notes or viewport width change.
- [ ] Allow Todo text to wrap naturally while each status mark remains on its first visual line.
- [ ] Render `...` only when the viewport actually overflows.
- [ ] Position the indicator without changing card height or signature geometry and fade the dots from left to right.
- [ ] Re-run the focused Home test and inspect the phone preview.

### Task 3: Final verification

- [ ] Run Todo paper and Home regression tests.
- [ ] Run web typecheck.
- [ ] Run `git diff --check`.
- [ ] Sync the earlier Todo offset docs from 38px to the accepted 31px.
- [ ] Commit the completed UI batch without adding `web/preview.html` or `web/src/preview-main.tsx`.
