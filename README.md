# ISF Multi-Book Ledger

Mobile-first multi-book cash management application using React + Vite + Supabase.

## 1. Local setup
```bash
npm install
cp .env.example .env
npm run dev
```

Put your Supabase URL and anon/publishable key in `.env`.

## 2. Supabase
1. Create a Supabase project.
2. Open SQL Editor.
3. Run `supabase/schema.sql`.
4. Enable Email authentication in Authentication > Providers.
5. Create your first account with email/password.
6. In SQL Editor, run the bootstrap SQL shown in `supabase/bootstrap.sql` after replacing the email.
7. **For Forgot Password to work:** in Authentication → URL Configuration, add your app's
   URL (e.g. `https://your-app.vercel.app`) to both **Site URL** and **Redirect URLs**.
   Without this, the reset-password email link will not be able to log the user back in.

## 3. Vercel
Import this GitHub repository into Vercel.
- Framework: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
- (Optional) Add `VITE_GOOGLE_CLIENT_ID` — see **Google Drive Backup setup** below.
- Deploy.

Do not put the Supabase service-role key in frontend environment variables.

## Features
Dashboard, multiple books, duplicate book, Cash In/Out, Fund Given/Collection per
distributor or party (with a running balance so you can see what's still owed),
Daily Closing (opening → in/out → closing, carried day to day), real Team management
(invite by email, per-book view/create/edit/delete permissions), Activity Log, richer
filters (date presets, type, party, payment mode), editable Account details and
in-app Password change, **Forgot Password (email reset link from the login screen)**,
Excel/PDF reports, responsive mobile UI. All labels (roles, book types, party types)
render as clean Title Case instead of raw snake_case.

**New in this version — Settings > Preferences:**
- **Dark Theme** — toggle, applies instantly across the whole app.
- **App Lock (PIN)** — a device-local 4–6 digit PIN gate shown before the app opens
  (independent of the account password). The PIN itself is never stored — only its
  SHA-256 hash, in this browser's local storage.
- **Language (English/বাংলা)** — switches the main navigation, page headers and
  common buttons. This is a first pass covering the app's chrome, not every single
  label in every modal — tell me which screens matter most and I can extend it.
- **Amount Calculator** — in the New Entry amount field, type an expression like
  `500+200-30` and it evaluates automatically (or tap the `=` that appears).
- **Backup & Restore** — "Export Backup" downloads a full JSON snapshot (every book
  you can see, with its parties/categories/payment modes/transactions/closings)
  as a file. "Import Backup" re-creates each book from a snapshot file as a new
  book named "… (Restored)" — it never overwrites existing data.

**New — Settings > Business:** a shared Business Profile (name, address, employee
count, category, sub-category, type, registration no., business mobile/email) —
visible to everyone, editable only by Admin/Primary Admin.

## Deploying this version (V3)
Run, in order, in Supabase → SQL Editor (skip any file already applied):
1. `supabase/schema.sql`
2. `supabase/migration_v1_to_v2.sql` — Party/Distributor ledger, `fund_given`/`collection`
   transaction types, email-invite lookup function.
3. `supabase/migration_v2_to_v3.sql` — adds the `business_profile` table used by
   Settings > Business.
4. Deploy the updated `src/App.jsx`, `src/styles.css` and `index.html`.

All three migration files are additive — safe to run on an existing project, nothing
is ever dropped.

### Google Drive Backup setup (optional)
This is the one feature that needs a one-time setup step outside Supabase, since it
talks to Google's own Drive API:
1. Go to [Google Cloud Console](https://console.cloud.google.com) → create (or pick) a project.
2. **APIs & Services → OAuth consent screen** — configure it (External is fine for personal use).
3. **APIs & Services → Credentials → Create Credentials → OAuth client ID**, type
   **Web application**. Under *Authorized JavaScript origins*, add your live URL
   (e.g. `https://your-app.vercel.app`) — and `http://localhost:5173` if you also
   want it working in local dev.
4. Copy the generated **Client ID** into `VITE_GOOGLE_CLIENT_ID` (in Vercel's
   Environment Variables, and in your local `.env`).
5. Redeploy. "Backup to Google Drive" / "Restore from Google Drive" will now appear
   in Settings > Preferences. Until this is set up, those buttons stay hidden and the
   local Export/Import Backup file option is used instead — no functionality is lost.

## Professional UI V2/V3
Refined mobile/desktop visual system, ISF-branded header, elevated cards, cleaner
transaction rows, improved responsive spacing, polished modal experience, and a
full Dark Theme palette.
