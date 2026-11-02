# Z-SHIRTS Books — Phase 1

One place where all four partners see every rupee of Z-SHIRTS, and where **no money moves without the right partners approving it**.

Partners: Aaryak Patel, Ayush Fotariya, Devanshi Panchal, Jigar Panchal · plus one employee who runs the store.

---

## What the rules are

These rules live inside the database itself, so they hold even if someone edits the app or opens the database directly.

| Action | Who must approve |
|---|---|
| Expense up to **₹2,000** (employee or partner) | Nobody — recorded instantly, **bill photo required** |
| Expense ₹2,001 – ₹15,000 | Any **2 partners** |
| Expense above ₹15,000 | **All 4 partners** |
| Money received (income) | 2 partners |
| Partner puts in capital | **All 4** + bank screenshot |
| Money paid out to a partner | **All 4** + bank screenshot |
| Reversing a wrong entry | **All 4** |
| Changing the ₹2,000 / ₹15,000 limits | **All 4** |
| Profit / loss sharing rule | **All 4** |

- A partner who raises a request counts as one approval.
- For "all 4" items, **one NO from any partner stops it**. For 2-partner items, it is rejected once approval becomes impossible (3 NOs).
- Rejecting always needs a written reason that everyone sees.
- **Nothing can ever be edited or deleted** — not entries, votes, signatures, proofs or the activity log. Mistakes are fixed by a reversal entry; the original stays visible.
- **Month close:** after a month ends, each partner enters the bank balance and signs. When all 4 have signed, that month is locked and nothing can be added to it.
- The employee can only record expenses and income and see their own requests. They cannot see the books, partner money or the activity log.
- Every action is logged with the person's name. Anything done outside the app shows as **"system / database owner" ⚠** in the log.

### Profit and loss sharing

Shares are calculated from the books: Aaryak ₹2,00,000 (40%), Ayush, Devanshi and Jigar ₹1,00,000 each (20%).

The rule is **not set yet** — all 4 partners must approve one in the app (New → Profit / loss rule). For each of profit and loss you choose *by investment ratio* or *equally*.

> Your example (if everything is lost, each partner pays Aaryak ₹25,000) is **"loss shared equally"**. With "loss by investment ratio", nobody would owe anybody anything. Agree on one, and put the same rule in your partnership deed.

The **Partners** screen shows, for each partner, "if settled today": invested − paid out + share of profit/loss. All four add up to the money in the business.

---

## What's in this repo

```
supabase/migrations/001_phase1_partner_ledger.sql   all tables, rules, approval engine, reports
supabase/migrations/002_storage.sql                 private storage for bill photos (no deleting)
supabase/seed/members.sql                           the 4 partners + employee (edit e-mails first)
supabase/tests/                                     automatic test of every rule (runs on GitHub)
web/                                                the app (works on phone and laptop, installable)
```

---

## One-time setup (about 30 minutes)

You need: a free **Supabase** account (the database) and this GitHub repo (hosting).

### 1. Create the database
1. Go to **supabase.com** → sign in with GitHub → **New project**.
2. Name: `zshirts` · choose a strong database password (save it) · Region: **Mumbai (ap-south-1)**.
3. Wait ~2 minutes for it to finish.

### 2. Load the rules
1. In Supabase, open **SQL Editor** → **New query**.
2. Open `supabase/migrations/001_phase1_partner_ledger.sql` here on GitHub → copy everything → paste → **Run**. It should say *Success*.
3. New query → paste `002_storage.sql` → **Run**.
4. Open `supabase/seed/members.sql`, **replace the 5 example e-mails with the real ones**, paste it in a new query → **Run**.

### 3. Lock down sign-ups
Supabase → **Authentication → Sign In / Providers → Email**: keep it enabled with **Confirm email** ON.
(Anyone can create an account, but only the 5 e-mails you added get any access.)

### 4. Connect the app
1. Supabase → **Project Settings → API**. Copy the **Project URL** and the **anon public** key.
2. In this repo open `web/config.js` → pencil ✏️ → paste both values → **Commit changes**.
   The anon key is safe to put here; the database rules control access.

### 5. Put the app online
1. Repo → **Settings → Pages** → under *Build and deployment* choose **GitHub Actions**.
2. Repo → **Actions** → **Publish app** → **Run workflow**.
3. After a minute the app is live at `https://idivyesh304.github.io/Z-Shirt/`.
4. Supabase → **Authentication → URL Configuration** → set **Site URL** to that address.

### 6. Everyone joins
Each partner and the employee opens the link → **Create account** with their registered e-mail → confirms the e-mail → signs in.
On a phone: browser menu → **Add to Home screen** to install it like an app.

### 7. First things to do in the app
1. One partner proposes the **Profit / loss rule** → the other three approve.
2. Each partner records their **Capital in** with the bank transfer screenshot → the other three approve.

---

## Honest limits — what software alone cannot stop

- **The Supabase account owner can bypass the rules** (it's their database). Mitigation: add all 4 partners to the Supabase organisation (*Organization → Team*), and watch the activity log for "system / database owner" entries.
- **Cash that never enters the system.** Take payments by UPI/QR straight to the business bank account wherever possible, and count the cash counter daily.
- **The bank account itself.** Set it up so payments need 2 partners' authorisation, and use the month-close check.
- **Stock taken off the books.** Phase 2 adds stock tracking; a partner should still do a surprise physical count each month.
- The partnership deed (profit share, exit, disputes) should be drafted by a CA or lawyer. The app enforces what you agree; it doesn't replace the deed.

---

## Coming next

- **Phase 2:** stock, production, orders, billing, daily cash counter close (price changes and stock write-offs will need all 4 partners).
- **Phase 3:** the Z-SHIRTS shop website, with online payments straight into the business account.
- **Phase 4:** Android app on the Play Store.
