# Search behavior coverage plan

**Goal:** Review all six test areas and fill demonstrated request-lifecycle gaps without changing application behavior.

- [x] Inventory all tests and compare high-risk source assertions with real behavior counterparts.
- [x] Run ordinary main baseline and existing Claude bridge tests with external opt-ins disabled.
- [x] Mount the actual Web search page and exercise stale reads, pagination retry and Memory return restoration.
- [x] Compile actual iOS search task methods against a controlled service and explicit response barriers.
- [x] Remove guards temporarily as negative controls; require failure, then restore source.
- [x] Run high-risk DB tests against an attested temporary local PostgreSQL instance; record both locale outcomes without weakening assertions.
- [x] Run final ordinary suite, relevant gates and builds; obtain independent review.
- [x] Record evidence and remaining UI/provider/locale limits, create PR, clean task-created environments.

No model calls, installed Hook changes, daemon restart, deployment, production DB access, new runtime architecture, or unrelated UI changes.
