# ISF Business Ledger V5

Mobile-friendly React + Vite + Supabase ledger for distributor/member/agent daily settlement.

## What's new in V5 (over V4)

**Dark mode:**
- A sun/moon toggle button next to the logout button switches between light and dark themes instantly.
- On first visit (no saved preference), the app follows the device/browser's system-level light/dark setting automatically.
- The choice is remembered in the browser (`localStorage`) so it persists across visits and devices' status-bar color on mobile updates to match.
- Every screen — including the login and pending-approval screens, cards, tables, forms, and badges — has been converted to theme-aware colors instead of hardcoded ones, so there is no leftover white flash anywhere in the app.

**Mobile UI improvements:**
- Navigation moves to a fixed bottom tab bar (with icons) on phone-sized screens, matching common mobile-app navigation patterns, instead of a horizontally-scrolling strip at the top.
- Content area gets extra bottom padding on mobile so the bottom nav never covers the last row of a table or the last field of a form.
- Bottom nav respects the iPhone home-indicator safe area (`env(safe-area-inset-bottom)`).
- Buttons and nav targets are sized closer to the 44px touch-target guideline for easier tapping.
- The top bar's email/logout area, which previously wasn't using the intended CSS styling, now correctly collapses the email text on narrow screens so the Logout and theme buttons stay reachable.

No database changes in this update — `supabase/schema.sql` and `supabase/migration_v3_to_v4.sql` from V4 still apply as-is; there is nothing new to run in Supabase for V5.

## What's new in V4 (over V3)

**Security fix (the important one):**
- V3 let *anyone* who clicked "Continue with Google" automatically get a profile with role `agent`, which could read and write all business data — because several database read-policies checked only "is this person signed in", not "is this person approved". This is fixed.
- New sign-ins now default to role **`pending`**, which cannot read or write any data.
- The very first person to ever sign in becomes `super_admin` automatically — no more manual SQL needed to bootstrap the first admin.
- Every table's read policy now requires an **approved** role, not just an authenticated session.
- Fixed a bug in `user_permissions`' RLS policy that checked the wrong column (`id` instead of `user_id`), which meant users could never read their own permission rows.

**New features:**
- **Users tab** (Super Admin / Admin) — approve pending sign-ups and change anyone's role directly from the app. No more manual SQL to promote/demote a user.
- **Channels tab** (in Settings, Super Admin/Admin/Manager) — payment channels (Cash, bKash, Nagad, Rocket, Upay, Bank, …) are now stored in the database and managed from the UI. Add new ones (e.g. Tap, DBBL Nexus) or deactivate old ones without touching code.
- **Audit Log tab** (Super Admin/Admin/Manager) — the app was already writing an audit trail, but there was no screen to see it. There's now a table view of the last 300 actions with who/what/when.
- **Active/Inactive people** — the `active` flag on members/agents existed in the schema but nothing in the UI used it. You can now deactivate a member/agent from the People tab; deactivated people drop out of the transaction-entry dropdown but stay in historical reports.
- **Date-range reports** — the Reports tab filtered by a single exact date; it now supports a From/To range.
- **Dashboard channel snapshot** — quick per-channel opening/closing view on the dashboard, not just inside Daily Closing.
- **Pending-approval screen** — a new sign-in now sees a clear "waiting for approval" screen instead of a blank/broken dashboard.
- **Daily closing reminder** — an optional browser notification reminder (see limitation below).
- Role-aware navigation — Users/Audit/Channels management only show up for roles that can actually use them.

**Explicitly NOT done (flagged, not silently skipped):**
- **Real SMS/email notifications.** The reminder feature only fires a browser notification while the app tab is open on your device — it is not a push notification and cannot text/email anyone. Real alerts need a backend (e.g. a Supabase Edge Function) plus a paid SMS/email provider (Twilio, a local BD SMS gateway, Resend, etc.) — that requires your own account/API keys, so it isn't something that can be wired up without you choosing and paying for a provider.
- **Multi-business / multi-tenant support.** The app still stores one business's data per Supabase project. Properly separating multiple businesses needs a `business_id` on every table plus new RLS scoping — a bigger structural change, not a drop-in update. If you need this, it's worth doing as its own project rather than bolted onto V4.

## Upgrading an existing (already-deployed) project
1. Open Supabase → SQL Editor and run `supabase/migration_v3_to_v4.sql`. It's additive/idempotent — it does **not** delete data and does **not** change any existing user's current role.
2. Deploy the updated `src/main.jsx` / `src/styles.css` (this code) to Vercel.
3. Log in as your existing super_admin and open the new **Users** tab — that's where you'll approve any new teammates going forward.

## Starting a brand-new project
1. Create a Supabase project.
2. Run `supabase/schema.sql` in the Supabase SQL Editor.
3. Enable the Google provider under Supabase Authentication.
4. Copy `.env.example` to `.env` and set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
5. `npm install`
6. `npm run dev`
7. Deploy to Vercel.
8. The first person to sign in with Google automatically becomes Super Admin.

## Formula
Net Result = Collection - Fund Given - Expense
Channel Closing = Opening + Collection - Fund Given - Expense

## Core features
- Google login with an approval workflow (Pending → assigned role)
- Dashboard and daily settlement
- Agent/member individual ledger with date selection
- Fund Given / Collection / Expense transactions
- Manageable payment channels
- Daily closing and Net Result
- Transaction search/filter with date range
- Edit and delete transactions (role controlled)
- Audit log with a viewer UI
- PDF + Excel reports
- Native PDF file share when mobile browser supports it
- WhatsApp and Telegram share links for report text
- Role model: Super Admin, Admin, Manager, Member, Agent, Pending
- Supabase Row Level Security policies, gated on approval status

## Important security notes
- Do not put a Supabase service-role key in the browser — the app only ever uses the anon key, which is safe by design because RLS enforces access.
- A real production multi-business deployment should add an organization/business_id to every business table and enforce tenant isolation (see "Explicitly NOT done" above).
- Approve new users promptly and review roles periodically in the Users tab — anyone left in `pending` sees nothing, which is the safe default.

## Sharing
WhatsApp/Telegram direct links share text. On supported mobile browsers, **Share PDF** can open the native share sheet and include the generated PDF file. Direct `wa.me`/`t.me/share` URLs cannot attach a local PDF file by themselves.
