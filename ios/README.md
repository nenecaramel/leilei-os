# LeileiOS Native iOS

This directory contains the native SwiftUI client.

## Current clean-app scope

The iOS app is a frontend for the existing LeileiOS backend. It does not connect directly to PostgreSQL or to the Mac Claude Code process.

Default production backend:

`https://leilei-os-production.up.railway.app`

The app currently includes a real backend health probe and an authenticated `/api/v1/session` probe. The Auth0 native client still needs its own client ID / redirect configuration before sign-in can be enabled.

## Run on an iPhone

1. Open `ios/LeileiOS/LeileiOS.xcodeproj` in Xcode.
2. Select the LeileiOS target.
3. Under Signing & Capabilities, select your Apple Development Team.
4. Give the target a bundle identifier owned by that team if Xcode asks.
5. Connect/select the iPhone and press Run.
6. Open System → Connections in the app. The backend API row should report `leilei-os: ok` whenever Railway production is running.

## Runtime configuration

The app reads these optional Info.plist keys:

- `LEILEI_API_BASE_URL` — defaults to the production Railway URL above.
- `LEILEI_AUTH0_ISSUER`
- `LEILEI_AUTH0_AUDIENCE`
- `LEILEI_AUTH0_SCOPE`
- `LEILEI_AUTH0_CLIENT_ID`

Do not commit Auth0 secrets. A native client ID is public configuration, but the iOS app must not contain a client secret.

Once native Auth0 login is wired, the resulting access token is stored in Keychain and the same `LeileiAPIClient` can call the existing `/api/v1` domain APIs.
