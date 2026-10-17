# Tunakula — Restaurant app (React Native + Expo)

The native restaurant/merchant app for the new Tunakula platform, on the new API. Third of the three apps
replacing the StackFood apps; it shares the customer app's infrastructure and ships from **EAS**.

## What it does today

- **Phone + OTP sign-in** for restaurant staff.
- **Kitchen board** (`/v1/kitchen/orders`), polling every 8s, grouped by order with lines, options,
  allergens, customer note, total and current state.
- **Order actions** through the order state machine (`/v1/orders/{id}/transitions`): **accept**, **start
  preparing**, **mark packed**, and **reject** with a reason.
- **Pause / resume intake** per branch (`/v1/kitchen/branches/{id}/status`) when the kitchen is slammed.
- **Push** as `app = "merchant"`, so a new order rings the kitchen in the background.

## Run / build

```bash
cd apps/restaurant
npm install
npx expo start
eas build -p android   # .aab
eas build -p ios       # .ipa
```

## Next

- **Mark ready for pickup** needs a pack photo and seal labels (`MARK_READY`) — a camera flow that is the
  next increment; the app covers accept → prepare → pack today.
- A tablet KDS layout (the app runs on tablets; a column-per-state board is a natural follow-up).
- Menu/availability editing from the app (today that lives in the admin console).
