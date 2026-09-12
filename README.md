# ISF Suite V9 (Business Ledger + Cash Book + Personal Expense + CashBook Pro)

## V9: new "CashBook" module
A fourth tool alongside Business Ledger / Cash Book / Personal Expense, picked from the
same app chooser after login. It mirrors a Business → Books → Entries structure instead
of Business Ledger's single running ledger:

- **Books list** — a business can hold many independent books (Day Book, Investments,
  Project Book, Client Record, or a custom name), each with its own running balance.
  Rename, duplicate or delete a book from its kebab menu.
- **Day Book screen** — Net Balance / Opening Balance / Total In / Total Out card, a
  scrollable date-grouped entry list, and green **Cash In** / red **Cash Out** buttons
  that open a bottom-sheet entry form (date, amount, category, payment mode, remark).
- **Filters** — a dedicated full-screen filter (Date presets, Entry Type, Members,
  Category, Payment Mode) with an "Add opening balance" toggle and Clear all/Apply.
- **Duplicate Book** — copy a book's Members & Roles / Categories / Payment Modes /
  Contact settings into a newly named book.
- **Business Team & Roles** — Primary Admin / Admin / Employee tabs with a permissions
  and restrictions breakdown, built on top of the existing `business_members` roles
  (Employee book-level access is stored in the new `cbp_book_members` table).
- **Business Profile** (Basics / Business Info / Communication tabs) and **App Settings**
  (Dark Theme, App Lock, Group Book Notifications, Amount Field Calculator) screens.
- **Excel Report** export of a book's currently filtered entries, and a **Book Activity**
  log (who did what, when) per book.

Run `supabase/migration_v8_to_v9.sql` after `migration_v7_to_v8.sql` to add the new
`cbp_*` tables — it only adds tables/columns, so it's safe on an existing V8 database and
doesn't touch Business Ledger, Cash Book or Personal Expense data.

**Scope note:** this first pass covers the core loop (create/duplicate/delete books, log
and filter entries, view/change team roles, edit the business profile, export Excel,
toggle app settings). Inviting a new teammate by email, per-book Employee role
assignment from the UI, PDF-styled reports, and the Help & FAQ content are stubbed with
placeholder text ("coming soon") rather than fully wired up — flag any of those as your
next priority and they're straightforward to build on this same foundation.

## Latest additions (this update)
- **Quick filters.** Business Ledger's Reports tab and Cash Book's Cash Entries tab now
  have a chip-style date filter (All Time / Today / Yesterday / This Month / Last Month /
  Date Range) plus dropdowns for Entry Type, Members (Business Ledger) or Category
  (Cash Book), and Payment Mode/Channel — with an active-filter count badge and a
  "Clear all" button. Cash Book's stats (Total In/Out/Balance) update to match the
  filtered entries; nothing here changes what PDF/Excel/Backup export.
- **Duplicate Business.** In Business Ledger → Settings → "Duplicate Business", create a
  new business pre-filled with the current one's Payment Channels and/or Members & Roles
  (agents/members list only — transactions, closings and audit history are never copied).
  You automatically become its Super Admin and are switched into it, same as creating a
  business normally.

## What's new in V8
Six features added to **both Business Ledger and Cash Book** (Personal Expense is
unchanged). Each tool has its own copy of the data — nothing is shared between them.

- **Inventory.** Track items (name, SKU, unit, cost/sale price, low-stock threshold).
  Post Stock In / Stock Out / Set Exact Quantity movements; the item's quantity updates
  automatically. Items below their threshold show a "Low Stock" badge and appear in
  Analytics.
- **Invoices.** Build an invoice with a customer, dates, status (draft/sent/paid) and
  line items — pull a line from Inventory (auto-fills description & price) or type one
  freehand. Export any invoice as a PDF.
- **Recurring Transactions/Entries.** Define a rule (amount, channel, frequency:
  daily/weekly/monthly, next run date). Press **Process Due** to post every rule that's
  due as a real transaction/entry and advance its next run date — this is manual, not a
  background job (see "Explicitly not included").
- **Budgets & Alerts.** Set a monthly limit — per channel in Business Ledger, per
  category in Cash Book — and see actual spend vs. limit with a progress bar that turns
  red when you're over.
- **Analytics.** A 6-month spend chart and a breakdown chart (collection by channel in
  Business Ledger, top expense categories in Cash Book), plus the low-stock list.
- **Multi-currency display.** Enter manual exchange rates (business's/Cash Book's base
  currency → another currency) and pick a display currency on the Analytics screen.
  **This only changes how numbers are *shown*** — everything is still stored in the
  original currency; no rates are fetched automatically.

### Upgrading an existing (already-deployed) project to V8
Run `supabase/migration_v7_to_v8.sql` in Supabase → SQL Editor. It only adds new tables
(inventory, invoices, recurring, budgets, exchange rates — one set for Business Ledger,
one for Cash Book) — nothing existing is touched. Then deploy the updated
`src/main.jsx` / `src/styles.css`.


Mobile-friendly React + Vite + Supabase app. After Google login, you now pick one of three
independent tools — your choice is remembered on this device (a "Switch App" button in
each tool's header lets you change it any time):

- **Business Ledger** — everything from V5, unchanged: multi-business, team roles,
  agents/members, daily closing, audit log, reports.
- **Cash Book** — a simple personal cash in / cash out log (date, type, category,
  channel, amount, note), with running totals and edit/delete. No teams, no roles.
- **Personal Expense** — a simple personal spending tracker (date, category, amount,
  note), with a total and a by-category breakdown, and edit/delete.

Cash Book and Personal Expense are single-user: each row belongs only to the signed-in
account (enforced by Supabase RLS), with no business/team concept at all.

## Upgrading an existing (already-deployed) project to V7
Run `supabase/migration_v6_to_v7.sql` in Supabase → SQL Editor (adds Cash Book's Khata
tables only). If you're upgrading straight from V5, also run `migration_v5_to_v6.sql`
first, in order.

## Cash Book now includes a Customer & Supplier Ledger ("Khata")
Inside Cash Book there are now two tabs:
- **Cash Entries** — the original simple cash in/out log, plus PDF/Excel export and a
  one-click JSON backup (same idea as Business Ledger's backup, just for Cash Book's
  own data).
- **Customer & Supplier Ledger (খাতা)** — add customers/suppliers, record "You'll Get"
  (they owe you) or "You'll Give" (you owe them) entries, see each contact's running
  balance, and send a WhatsApp reminder with the due amount pre-filled (opens `wa.me`
  with the message ready — there's no SMS gateway wired up, see "Explicitly not
  included" below for why).

## Upgrading an existing (already-deployed) project to V6
Run `supabase/migration_v5_to_v6.sql` in Supabase → SQL Editor. It only adds the two new
tables (`cashbook_entries`, `personal_expenses`) — nothing existing is touched. Then
deploy the updated `src/main.jsx` / `src/styles.css`.

## What's new since the last V5 build
- **Receipt photos are now cleaned up automatically before upload.** Sideways phone-camera photos are auto-rotated (EXIF orientation is read and corrected) and the image is resized/re-compressed to a small JPEG (max 1600px, quality 0.8) before it's sent to Supabase Storage. Faster uploads, much less storage used, no more sideways receipts.
- **Download Backup button (Settings → Backup).** One click bundles everything for the current business — transactions, members, agents, opening balances, daily closings, channels, team list, audit log — into one JSON file and downloads it to the device. This is a manual export, not an automatic cloud sync: save the downloaded file to Google Drive, email it to yourself, etc.
- **Weekly backup reminder (Settings → Backup).** Pick a day of the week and a time; while the app is open in a browser tab on that device, a browser notification will remind you to download and store a backup. Same client-side-only limitation as the existing Daily Closing Reminder — see "Explicitly not included" below.

## What's new in V5 (over V4)

- **Multi-business support.** One Google account can now own or join several businesses. Each business has its own members, agents, transactions, channels, closings and audit log — fully separate from every other business. A person's role (Super Admin/Admin/Manager/Member/Agent) is now set **per business**, so the same person could be a Super Admin in one business and just an Agent (or not a member at all) in another. A dropdown in the top bar switches between businesses you belong to.
- **Receipt / bill photo upload.** Every transaction can have a photo attached (stored in Supabase Storage). Shows as a 📎 link in Reports.
- **Per-business currency.** Each business picks its own currency (BDT, USD, INR, EUR, GBP, PKR, NPR, MYR, AED, SAR); all amounts throughout the app use that business's symbol.
- **Adding teammates changed.** The old "Users" tab (global, one role per person) is now scoped to whichever business you're currently viewing, and works by email: type a teammate's Gmail address to add them to *this* business (they must have signed in with Google at least once already, even if they've never used this business before). New additions start as `pending` in that business until approved.
- If you have zero businesses, you're prompted to create one (you become its Super Admin automatically). If your only business membership is still `pending`, you see a waiting screen with the option to switch to another approved business or create a new one.

## Upgrading an existing (already-deployed) project
Run the migrations **in order** in Supabase → SQL Editor:
1. `supabase/migration_v3_to_v4.sql` — skip if you already ran this before.
2. `supabase/migration_v4_to_v5.sql` — turns your current single-business data into "My Business" inside the new multi-business model. **Nothing is deleted**, and everyone's current role carries over unchanged, now scoped to "My Business". You can rename it and set its currency afterward from Settings.

Both migration files end with `NOTIFY pgrst, 'reload schema';`, so the API refreshes immediately after each one — you shouldn't need to reload the cache manually.

Then deploy the updated `src/main.jsx` / `src/styles.css` to Vercel.

## Starting a brand-new project
1. Create a Supabase project, run `supabase/schema.sql` in the SQL Editor. (It now ends with `NOTIFY pgrst, 'reload schema';` so the API picks up the new tables immediately — no separate cache-reload step needed.)
2. **Verify it worked** before moving on: Supabase → Table Editor → confirm `businesses`, `business_members`, `members`, `agents`, `transactions`, `channels` all appear under the `public` schema. If any are missing, re-run `schema.sql` and check the SQL Editor's output for errors — a table it depends on may have failed to create.
3. Enable the Google provider under Supabase Authentication.
4. Copy `.env.example` to `.env`, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` — **double-check these match the same project you just ran the SQL in** (easy to mix up if you have more than one Supabase project).
5. `npm install && npm run dev`, then deploy to Vercel (set the same two env vars there too).
6. On first login you'll be asked to create your first business — you become its Super Admin.

### Troubleshooting: "Could not find the table 'public.X' in the schema cache"
This means PostgREST (Supabase's API layer) doesn't see that table. The app now shows a clearer message for this automatically, but the underlying fixes are:
- The SQL was never run on this project → run `schema.sql` (fresh project) or the migration files in order (upgrading an existing project), then check Table Editor as in step 2 above.
- `.env` / Vercel env vars point at a different Supabase project than the one you ran the SQL in → fix the URL/key.
- The SQL ran but PostgREST's cache hadn't refreshed yet → run `NOTIFY pgrst, 'reload schema';` in SQL Editor, or Settings → API → reload schema cache (all three SQL files now do this for you automatically at the end).

## Formula
Net Result = Collection - Fund Given - Expense
Channel Closing = Opening + Collection - Fund Given - Expense

## Core features
- Google login with a per-business approval workflow (Pending → assigned role)
- Multiple businesses per account, each fully data-isolated, each with its own currency
- Dashboard and daily settlement, per business
- Agent/member individual ledger with date selection
- Fund Given / Collection / Expense transactions, with optional receipt photo
- Manageable payment channels, per business
- Daily closing and Net Result
- Transaction search/filter with date range
- Edit and delete transactions (role controlled)
- Audit log with a viewer UI, per business
- PDF + Excel reports
- Native PDF file share when mobile browser supports it
- WhatsApp and Telegram share links for report text
- Role model per business: Super Admin, Admin, Manager, Member, Agent, Pending

## Security notes
- The app only ever uses the Supabase anon key in the browser — never put a service-role key in client code. Access control is enforced by Postgres Row Level Security (RLS), not by the app's UI, so hiding a tab is a UX nicety, not the actual security boundary.
- Every business-data table carries a `business_id`, and every RLS policy checks the signed-in user's role **in that specific business** before allowing read or write. A user approved in Business A gets nothing in Business B unless separately added there.
- Receipt photos are stored in a public Storage bucket (so links work simply); anyone with the exact file URL (a random UUID) could view a receipt image, but URLs aren't discoverable or listable. Uploads/deletes are restricted to users approved in the business that owns that folder.
- Approve new teammates promptly per business and review roles periodically in each business's Users tab.

## Explicitly not included
- **Automatic recurring posting.** Recurring Transactions/Entries only post when someone
  presses **Process Due** while the app is open — there's no server-side scheduler
  (e.g. a Supabase Edge Function on a cron) running this in the background yet.
- **Live exchange rates.** Multi-currency display uses rates you enter by hand; nothing
  is fetched from a live FX API.
- **Real SMS reminders.** Only a WhatsApp `wa.me` link with the message pre-filled is included (Khata's "WhatsApp Reminder" button, and the existing report-sharing buttons). True SMS needs a paid SMS gateway account (e.g. a local BD provider) plus a backend to call it — not available in this environment.
- **Real SMS/email notifications.** The Settings reminders (daily closing and weekly backup) only fire a browser notification while the app tab is open on your device. Real push/SMS/email alerts need a backend (e.g. a Supabase Edge Function) plus a paid provider (Twilio, a local BD SMS gateway, Resend, etc.) — that requires your own account and API keys.
- **True automatic cloud backup.** The Download Backup button is one click, not zero — it saves a JSON file to the device, and you still choose where to store it (Google Drive, email, etc.). A fully automatic backup to Google Drive/GitHub would need server-side credentials (a Google Cloud OAuth client or similar) that aren't available in this environment.

## Sharing
WhatsApp/Telegram direct links share text. On supported mobile browsers, **Share PDF** can open the native share sheet and include the generated PDF file. Direct `wa.me`/`t.me/share` URLs cannot attach a local PDF file by themselves.
