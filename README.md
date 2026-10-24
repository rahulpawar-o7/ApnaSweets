# ApnaSweets (with backend)

## Run it
1. Install Node.js 18 or newer.
2. In this folder run:  `node server.js`   (no `npm install` needed)
3. Open http://localhost:3000
4. Owner login: footer > "Owner login" - `owner@apnasweets.in` / `sweets123`
   Change the password in Owner > Settings right away.

## What the backend does
- Product photos are uploaded to the server (`data/uploads/`) and shown to every customer.
- Products, stock, orders and settings are saved in `data/db.json`, so orders placed on a
  customer's phone appear in the owner dashboard on any device.
- The server re-checks price and stock for every order, so stock can't go negative.
- Owner login uses a hashed password and a session token. Photo upload and all owner
  actions need that login.
- If two things change at once (e.g. a customer orders while you edit stock), the owner
  save is refused and the page reloads - just repeat your last change. Nothing is overwritten.

## Photo upload tips
- Products > Add/Edit: choose a file, paste (Ctrl+V) a copied photo, drop one, or paste an image link.
- Stock page: tap "Upload photo" on any row.

## Put it online
Use any Node host with a persistent disk (Render, Railway, Fly.io, a VPS).
- Start command: `node server.js`
- Set `DATA_DIR` to the persistent disk path (otherwise data is lost on redeploy).
- Before the FIRST start set `ADMIN_EMAIL` and `ADMIN_PASSWORD` to pick your own login.
- Use HTTPS (the host usually provides it). Back up the `DATA_DIR` folder regularly.

Opening `public/index.html` directly (double-click) still works in the old browser-only
mode, but photos and orders are then stored only in that one browser.
