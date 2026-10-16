# Tunakula — Customer app (React Native + Expo)

The native customer app for the new Tunakula platform, built on the new API (`api.tunakula.com`). This
is the first of the three apps that replace the old StackFood apps; the rider and merchant apps follow the
same shape. It is a **managed Expo** app, so iOS and Android builds are produced in the cloud with **EAS**
— no Mac or Xcode required.

## What it does today

- **Phone + OTP sign-in** (`/v1/auth/otp/{request,verify}`), SMS or WhatsApp — the same identity the old
  apps use, so a migrated customer signs in with the number they already have. Session kept in the device
  keychain (`expo-secure-store`).
- **Discover nearby shops** using the device location (`/v1/branches/nearby`), with store type, distance
  and rating. Restaurants, groceries, pharmacies, convenience and **boutiques** all appear.
- **Browse a menu and build a cart** (`/v1/branches/{id}/menu`), including per-item **add-ons**.
- **Checkout**: delivery or pick-up, mobile money / cash / wallet, kitchen note, a live server
  **quote** (`/v1/carts/quote`) and **place** (`/v1/orders`) with an idempotency key so a retry never
  double-orders. Boutique advance-notice is surfaced.
- **Track an order** live (`/v1/orders/{id}`) with the recipient hand-over code, and a **past orders**
  list (`/v1/me/orders`).
- **Push notifications**: registers an Expo push token with `/v1/me/push-devices`; the API's comms engine
  delivers order updates to the device (APNs on iOS, FCM on Android, behind Expo's one token).

The warm brand palette is ported from the storefront's design system so the app and web read as one brand.

## Run it locally (Expo Go / dev client)

```bash
cd apps/customer
npm install
npx expo start            # press i (iOS simulator), a (Android), or scan the QR in Expo Go
```

Point it at a backend by editing `app.json` → `expo.extra.apiUrl` (and `country`), or override per EAS
build profile. For local API testing use your machine's LAN IP, e.g. `http://192.168.1.20:8080`.

## Build for the stores (EAS, no Mac needed)

```bash
npm i -g eas-cli
eas login
eas init                  # writes expo.extra.eas.projectId
eas build -p ios          # cloud build → .ipa  (uses your Apple Developer account)
eas build -p android      # cloud build → .aab  (uses your Google Play account)
eas submit -p ios         # upload to App Store Connect / TestFlight
eas submit -p android     # upload to Google Play
```

Set the production API URL for a build via the profile's `env` or by committing it to `app.json`.

## Notes

- This directory is **outside** the repo's npm workspaces on purpose: Expo/Metro has its own toolchain and
  must not be pulled into the web/backend `npm run check` pipeline. The app keeps its own small copy of the
  API wire types (`src/api/types.ts`) so Metro needs no cross-workspace TS project references.
- Typecheck with `npm run typecheck` after `npm install` (needs the Expo/React Native type packages).
- Payment handoff for mobile money / card currently places the order; wiring the full payment-intent
  approval flow (`/v1/payments/intents`) into the app is the next increment.
