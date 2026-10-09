# Payday Calendar

A React app for logging hours and seeing what each paycheck covers. Schedules and day entries are stored in a SQLite database at `data/payday.sqlite`.

```bash
npm install
npm start
```

Then open http://localhost:3000.

The live site is https://paycheck.tanmoybarua.com. That host serves the built React app from the subdomain folder, and a PHP copy of the API stores the same SQLite data. Spending is at `#spend`. Debt tracking is at `#debt`.

Gmail one-time-code login can protect the site. Set these when publishing (never commit them):

- `PAYDAY_OWNER_EMAIL` — your Gmail address
- `GMAIL_USER` — usually the same address
- `GMAIL_APP_PASSWORD` — a Google App Password for that account

The deploy script packs them into `data/mail.json` (blocked by `.htaccess`). After that, open the site, request a code, and enter it. Sessions last 1 hour of activity; idle use logs you out. Face ID on your phone is optional on top of that.

`node scripts/deploy-hostinger.mjs` publishes a new build. A push can publish again once `HOSTINGER_API_TOKEN` is a repository secret. Do not commit that key or Gmail passwords.
