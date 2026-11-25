# Cardinal Forecast — GitHub Pages + synchronized cloud data

**Status:** Deployment-ready source package, **not** a live website. You need a free GitHub repository, a Supabase account/project, and control of the DNS for `cardinaldistributing.com`. This package does not contain company reports or passwords.

## Why this setup
- **GitHub Pages** hosts HTML/CSS/JavaScript for free. No Render, Python server, or desktop installation.
- **Supabase Free** stores private inventory, sales history, supplier lead times, and preferences, synchronized whenever you sign into the same user account on another device. The database is separate from GitHub.
- Browser uploads are parsed locally, then the structured records are synchronized over HTTPS after login.
- **Privacy:** SQL row-level security isolates each login's records. Users cannot see other users' records by default. If you want a *shared team workspace* later, it needs an explicit workspace/membership model; merely creating extra accounts will not share data.
- The supplied VIP **Units Sold** field drives every forecast; keg counts are never replaced by case-equivalent quantities.

## 1. Create the free database (Supabase)
1. Sign up at https://supabase.com and create a new **Free** project.
2. In **SQL Editor**, paste the entire `schema.sql` and execute it **once**. (On an existing table with policies, review the SQL before rerunning; duplicate policy names can error.)
3. In **Authentication → Providers → Email**, leave email/password sign-in enabled. For a company-only site, start with one user and **disable public sign-ups** afterward, or manage invited users in the Auth dashboard.
4. In **Authentication → URL Configuration**, set the Site URL to `https://forecast.cardinaldistributing.com/`. Until your DNS is ready, you can add your GitHub Pages testing URL to redirect allow-list.
5. In **Project Settings → API**, copy the **Project URL** and **Publishable key** (some projects label this the legacy `anon` key). Paste into `config.js`.
6. **Never** use a `service_role`/`secret` key or database password in `config.js`. The publishable key is meant to be visible to browsers; privacy comes from Auth + RLS.

## 2. Publish the static website (GitHub Pages)
1. Create a NEW public repository, such as `cardinal-forecast`. Public repos are compatible with GitHub Pages Free; only add app source, not inventory or sales reports.
2. Upload **all files in this folder to the repository root**. Keep `CNAME`, `.nojekyll`, `engine.js`, `parser.js`, `bridge.js`, `app.js`, `index.html`, `styles.css`, `cardinal-logo.png`, `config.js`, and `schema.sql`.
3. GitHub repo **Settings → Pages → Build and deployment → Deploy from a branch → `main` → `/(root)` → Save**.
4. In GitHub **Settings → Pages**, enter **Custom domain** `forecast.cardinaldistributing.com` and enable **Enforce HTTPS** once the certificate is ready.
5. In your domain registrar/DNS manager, create a **CNAME** record:
   - Name/host: `forecast`
   - Value/target: **`YOUR_GITHUB_USERNAME.github.io`**, replacing the name with the GitHub user or organization that owns the Pages repository (no repository name, protocol, or slash).
6. Verify your custom domain with GitHub if prompted; DNS/HTTPS issuance can take time.

## 3. First login and synchronization
1. Open `https://forecast.cardinaldistributing.com` (or the temporary GitHub Pages URL while testing).
2. Use **Create account** with email and a strong password. If Supabase requires confirmation, open the email verification link, then sign in.
3. Import your inventory CSV and your "Weekly Sales History by Product" XLSX from VIP.
4. Once the first upload finishes, sign in using the **same email/password** on another computer. Click **Refresh** to load the current supplier data.
5. Use **Download backup** periodically. Supabase Free does not provide paid-tier automated backups.

## 4. Bring over your existing desktop database (optional)
If you already have a `forecast.db` containing years of history and saved lead times:
```
python migrate_desktop_db.py /path/to/forecast.db
```
This generates `cardinal_forecast_desktop_migration.json` in the directory from which you run the command. It does not change SQLite. Sign in to the new website and click **Restore backup**, selecting the generated JSON. You can alternatively reimport the original CSV/XLSX reports.

## Upload semantics and important limits
- **Inventory CSV:** upserts individual products within the suppliers present in the file; omitted products and unrelated suppliers are not reset to zero. A compact history of up to **30 imports per supplier** is retained in the database (these are values supplied, not a fully reconciled on-hand ledger).
- **Sales XLSX:** replaces the historical sales records of the **included** suppliers only, preserving others. Periods without a sales row in a covered report count as **zero**, while weeks outside report coverage remain unknown.
- **Forecast:** current partial week (W0) plus four full Monday–Sunday weeks (W1–W4); `Month = W1+W2+W3+W4` and `Future = W0+Month`. Uses physical cases/individual kegs, not case equivalents. Suggested orders are estimates, not supplier POs.
- **Inventory outlook:** increases only for on-order quantities with a **dated Next PO arrival and quantity**, and shows undated quantities separately.
- **Security:** data is private **per authenticated Supabase user**. Same account on both devices = shared data. Different accounts = isolated data. Do not publish CSVs, XLSX, SQLite backups, or `cardinal_forecast_desktop_migration.json` in GitHub.
- **Free tier:** as of November 2026, Supabase Free includes 500 MB database size and may **pause after 7 days of inactivity** (resume in Supabase dashboard). GitHub Pages continues serving the static website, but live data cannot load while the database project is paused. Monitor current pricing/limits: https://supabase.com/pricing.
- **Conflicts:** uploads from two browsers at precisely the same time to the same supplier use **last successful supplier write wins**. Avoid concurrent uploads for the same supplier.
- **Auth:** sessions are persisted by the browser. Sign out on shared computers. For business use, enable MFA and restrict signups in the Supabase dashboard.
- **No ongoing server:** browser forecasts can be slow on very large datasets, but the app does not require a Render process.

## Development / self-test
- `node --check engine.js`, `node --check parser.js`, `node --check bridge.js`, `node --check app.js` for syntax checks.
- Open `index.html` from a local HTTP server, e.g. `python -m http.server 8000` (with Supabase URL + key in `config.js`) for local development. **Do not serve confidential files** alongside a public web server.

## Official docs
- GitHub Pages custom domains: https://docs.github.com/en/pages/configuring-a-custom-domain-for-your-github-pages-site/managing-a-custom-domain-for-your-github-pages-site
- GitHub Pages branch publishing: https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site
- Supabase browser keys: https://supabase.com/docs/guides/getting-started/api-keys
- Supabase Row-Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Free tier: https://supabase.com/pricing
