# Tunakula — Rider app (React Native + Expo)

The native rider app for the new Tunakula platform, on the new API. Second of the three apps replacing the
old StackFood apps; it shares the customer app's infrastructure (API client, session, push, design tokens)
and ships from **EAS** cloud builds — no Mac needed.

## What it does today

- **Phone + OTP sign-in** — the rider's registered number. A number that isn't a rider sees a clear message.
- **Go online / offline** with a GPS fix (`/v1/rider/presence`); while online it sends a location heartbeat
  every 20s so dispatch and the customer's map stay current.
- **Job offers** with a countdown (`/v1/rider/jobs`) — accept or pass (`/v1/rider/offers/{id}/accept|decline`).
- **Active deliveries** → a job screen with navigation (opens Google Maps), **confirm pick-up**, and
  **confirm delivery with the customer's code**, plus report-failed-delivery — all through the order
  state machine (`/v1/orders/{id}/transitions`).
- **Earnings** (`/v1/rider/earnings`) with today/this-week and **cash out** (`/v1/rider/cashout`).
- **Push**: registers an Expo token with `app = "rider"` so new offers and updates reach the lock screen.

## Run / build

```bash
cd apps/rider
npm install
npx expo start          # press a (Android) / i (iOS), or scan in Expo Go
# cloud builds:
eas build -p android    # .aab
eas build -p ios        # .ipa
```

Point at a backend via `app.json` → `expo.extra.apiUrl`. Same isolation note as the customer app: this
directory is outside the repo's npm workspaces on purpose.

## Next

- Live in-app map (currently hands off to Google Maps for turn-by-turn).
- Background location while online (the iOS/Android permission is declared; wiring `expo-task-manager` is
  the follow-up).
- Scan-to-confirm labels at pick-up (the API already accepts scanned label ids).
