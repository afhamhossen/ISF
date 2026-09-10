# ISF Business Ledger V3

Mobile-friendly React + Vite + Supabase ledger for distributor/member/agent daily settlement.

## V3 features
- Google/Gmail login
- Dashboard and daily settlement
- Agent/member individual ledger with date selection
- Fund Given / Collection / Expense transactions
- Opening balance by Cash, bKash, Nagad, Rocket, Upay and Bank
- Channel-wise closing balance formula
- Daily closing and Net Result
- Transaction search/filter
- Edit and delete transactions (role controlled)
- Audit log for create/update/delete/closing actions
- PDF + Excel reports
- Native PDF file share when mobile browser supports it
- WhatsApp and Telegram share links for report text
- Role model: Super Admin, Admin, Manager, Member, Agent
- Supabase Row Level Security policies

## Formula
Net Result = Collection - Fund Given - Expense
Channel Closing = Opening + Collection - Fund Given - Expense

## Setup
1. Create a Supabase project.
2. Run `supabase/schema.sql` in Supabase SQL Editor.
3. Enable Google provider under Supabase Authentication.
4. Copy `.env.example` to `.env` and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.
5. `npm install`
6. `npm run dev`
7. Deploy the repository to Vercel.

## Important security
Do not put a Supabase service-role key in the browser. The included RLS is stronger than V2 but a real production multi-business deployment should add an organization/business_id to every business table and enforce tenant isolation.

## Sharing
WhatsApp/Telegram direct links share text. On supported mobile browsers, **Share PDF** can open the native share sheet and include the generated PDF file. Direct `wa.me`/`t.me/share` URLs cannot attach a local PDF file by themselves.
