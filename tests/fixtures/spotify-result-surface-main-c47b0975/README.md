# Immutable Spotify row oracle

`NativeLiveAssistantTurnRow.swift` is a byte-for-byte archive from commit
`c47b09754c858a938172cb43cb58618aa384846d`, the original standalone Spotify
surface implementation. SHA256:
`00285aa81d30159a588300217235b52dddeb926e275f87e71e4de0ff88e7d591`.
The original approved manifests remain in `../spotify-surface-snapshots/`.
They were committed by the same historical implementation, and are never
recorded again by the acceptance test.

The generated `HistoricalSpotifyAssistantTurnRow` is a separate SwiftUI View,
not a typealias, wrapper around the current row, or current-source copy. The
archive declares one top-level struct and no global builder functions; only
that independent struct name is prefixed when generating the disposable app.
`pre-spotify-41bf.swift` is the byte-for-byte pre-Spotify row from
`41bf880f24a5d42dd48fb39603c47080b3ec75bd`, SHA256
`d0050ba68c5945e280b036f961d28ed06dcb02512fed92f8d91df18b97c09d2e`.
It remains the separate no-Spotify pixel oracle. Both archives load directly
from fixture files, so the test does not depend on repository Git history.

Generated copies adapt only approved changes: album badge/readback retirement
(c6bc326f), timestamp moved to the shared action footer (cccf6e6e), and a fixed
12-point extra process-to-body gap, from the approved 18-point total minus the
historical 6-point row spacing (a553c665). The value is a historical literal,
never computed from mutable current layout constants.

`shared-visual-source-sha256.json` is dependency-freeze metadata from pinned
base commit `452bd750`, not behavior evidence or a newly recorded golden.
Its own SHA256 is a literal in the test. The 64 literal source digests freeze
shared Card/Surface/Spotify projector, activity/footer, text/rendering,
model projections, layout and font dependencies. The dependency inventory
includes all visual renderer branches reachable through the text renderer;
AppModel and networking I/O services are excluded because fixture data/state
is initialized directly and the app stays unauthenticated. These guards
prevent a shared visual edit from silently changing both comparison sides.
No source guard substitutes for the actual simulator comparisons.

For each device, all 12 current snapshots are compared with the independently
compiled historical oracle: every CGRect and every pixel is exactly equal.
The original manifest still checks every case and every frame key (including
no-card `none` cases), complete unchanged activity rectangles, original
body/card intrinsic dimensions and x positions, row origins/widths, and exact
relative card gaps. The approved shifted absolute positions and row heights
are protected by the compiled historical oracle, without float tolerances.
Original collapse, card-content, details-authority and pre-Spotify exact-pixel
checks remain active.
