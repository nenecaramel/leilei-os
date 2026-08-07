# Todo Paper Vertical Offset Implementation Plan

Goal: Move `.paper-detail-paper` down exactly 31px with no other geometry changes.

Task 1:
1. Add a failing test asserting `transform: translateY(31px)` on `.paper-detail-paper`.
2. Run the focused Todo paper test and confirm RED.
3. Add only `transform: translateY(31px);` to `.paper-detail-paper`.
4. Run Todo paper + Home tests, typecheck, and diff check.
5. Commit the implementation.
