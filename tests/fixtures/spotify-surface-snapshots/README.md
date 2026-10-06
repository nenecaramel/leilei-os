# Spotify Assistant result surface

Twelve actual AssistantTurnRow captures per device: search, ordered provider
error + three-song search, and no Spotify; collapsed/expanded in light/dark.
The test compares no-Spotify full pixels and frames directly against main
`41bf880f24a5d42dd48fb39603c47080b3ec75bd`, checks the items delivered to rendered
cards and their size/order across expansion, and exercises both real details
sheets with the same Input/Output/Resources/status.

Run on booted iPhone/iPad simulators:

```sh
SPOTIFY_SIMULATORS=<iphone-uuid>,<ipad-uuid> \
SPOTIFY_RENDER_CACHE=<temporary-directory> \
node --import tsx --test tests/ios-spotify-result-surface-render.test.ts
```

`SPOTIFY_SURFACE_RECORD=1` explicitly replaces these captures and frame manifests.
`SPOTIFY_RENDER_MUTATION=collapse` changes only the temporary compilation copy
and must fail the collapsed result count check.
