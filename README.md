# Payday Calendar

A React app for logging hours and seeing what each paycheck covers. Schedules and day entries are stored in a SQLite database at `data/payday.sqlite`.

```bash
npm install
npm start
```

Then open http://localhost:3000.

The live site is https://paycheck.tanmoybarua.com. That host serves the built React app from the subdomain folder, and a PHP copy of the API stores the same SQLite data. Spending is at `#spend`. Debt tracking is at `#debt`. The notepad payment checklist is at `#checklist`. Settings is at `#settings`. You can turn on Face ID plus a passcode from Settings. The lock is stored on the server, so other browsers must enter the passcode before data loads.

## Deploy (set the API token once — keep it private)

**Why agents keep asking for the token:** GitHub Actions only publishes when the encrypted secret `HOSTINGER_API_TOKEN` exists. If that secret is empty, publish is skipped (or now fails) and someone has to supply the token again. Put it in GitHub Secrets **once**; after that, never paste it into chat or commit it.

**One-time (private):**

1. Copy a Hostinger API token from Hostinger.
2. GitHub → this repo → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**.
3. Name: `HOSTINGER_API_TOKEN` → paste token → save.

**Every deploy after that:** push or merge to `cursor/payday-calendar-b823` or `main`. Actions builds and publishes. Or run **Actions → Deploy to Hostinger → Run workflow**.

Full notes: [docs/deploy.md](docs/deploy.md). Never commit the token, put it in a PR, or paste it into the workflow file.
