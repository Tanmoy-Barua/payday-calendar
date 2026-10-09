# Payday Calendar

A React app for logging hours and seeing what each paycheck covers. Schedules and day entries are stored in a SQLite database at `data/payday.sqlite`.

```bash
npm install
npm start
```

Then open http://localhost:3000.

The live site is https://paycheck.tanmoybarua.com. That host serves the built React app from the subdomain folder, and a PHP copy of the API stores the same SQLite data. Spending is at `#spend`. Debt tracking is at `#debt`. The notepad payment checklist is at `#checklist`: start from $2,200, check each payment paid or not paid, and keep side cards (Prime, Credit One, and the rest) separate from that math. You can turn on Face ID plus a passcode from the header. The lock is stored on the server, so other browsers must enter the passcode before calendar, spending, or debt data loads. `node scripts/deploy-hostinger.mjs` publishes a new build there. A push can publish it again once the key is stored as a GitHub Actions secret named `HOSTINGER_API_TOKEN`. Do not commit that key, put it in a pull request, or paste it into the workflow file.
