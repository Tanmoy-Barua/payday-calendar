# Deploy to Hostinger (private token)

The live site is https://paycheck.tanmoybarua.com.

The Hostinger API token must stay private. Store it **once** as an encrypted secret. Do **not** commit it, put it in a pull request, paste it into workflow YAML, or keep pasting it into chat.

## One-time setup (do this once)

1. Open Hostinger → API / developers and copy a token (or create a new one if the old one was exposed).
2. Open this GitHub repo → **Settings** → **Secrets and variables** → **Actions**.
3. Click **New repository secret**.
4. Name (exact): `HOSTINGER_API_TOKEN`
5. Value: paste the token → **Add secret**.

GitHub encrypts it. Workflows can read it; the public repo cannot.

### Optional: Cursor Cloud Agent secret

If you want an agent to run `npm run deploy` inside a Cloud Agent VM (without GitHub Actions), add the same name `HOSTINGER_API_TOKEN` as a **Cursor environment secret** for this project. Still never put it in the repo.

## Every deploy after that (no token needed)

Push (or merge) to either:

- `cursor/payday-calendar-b823`, or
- `main`

GitHub Actions runs **Deploy to Hostinger**, builds the app, and publishes with the stored secret.

You can also open **Actions** → **Deploy to Hostinger** → **Run workflow** (manual) on those branches.

## Local / agent deploy (only if the secret is already in the environment)

```bash
# token already exported in this shell / CI / Cursor env — never echo it
npm run deploy
```

If `HOSTINGER_API_TOKEN` is unset, the script exits and does not publish.

## If publish fails with “token missing”

The GitHub secret is empty or was never added. Repeat the one-time setup above, then re-run the workflow. Do not paste the token into code to “fix” it.
