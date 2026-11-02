# Z-SHIRTS — one place for everything

Shop, orders, stock, returns, money and partner trust — in one system.

| | Who uses it | Address after setup |
|---|---|---|
| **Shop** | Customers | `https://idivyesh304.github.io/Z-Shirt/` |
| **Team app** | Aaryak, Ayush, Devanshi, Jigar (partners) and Mahendra (store) | `https://idivyesh304.github.io/Z-Shirt/admin/` |

Both work on phones and laptops, and the team app installs to the home screen like a normal app.

---

## What it does

### For customers (the shop)
- Browse by category, search, and filter by **price, type, colour, discount and in-stock**; sort by newest, price or biggest discount.
- Every tee shows a **hang-tag price** with MRP and % off, "Only 3 left" alerts, and colour dots. Without photos, the shop draws the tee in its real colour.
- Pick colour and size (sold-out sizes are struck through, low ones show "2 left"), size guide, share link.
- Bag with **free-delivery progress bar** and total savings.
- Checkout: pincode **fills city and state automatically**; repeat customers' details are remembered. Pay **online (UPI/cards/netbanking via Razorpay)** or **cash on delivery**.
- **Track order** with order number + phone, and request a **size exchange or return** within 7 days of delivery.

### For the team (Mahendra and partners)
- **Live alerts** for every website, Instagram, WhatsApp and store order, payment, return request and low stock — with **confetti and a chime**. Big moments get a full-screen celebration: first order, ₹10k / ₹25k / ₹50k / ₹1 lakh… in sales, 10 / 50 / 100… orders.
- **Home:** today's sales, a "Do next" list (to confirm, to pack, to ship, returns, approvals, low stock), 14-day chart, next sales milestone.
- **Orders:** one-tap pipeline — *Confirm → Mark packed → Ship → Mark delivered*. Shipping remembers the last courier. WhatsApp update to the customer with a ready-made message for each stage, call, copy address, **print invoice + shipping label**, RTO, cancel.
- **Sell:** store counter (cash/UPI) and **Instagram/WhatsApp orders** (prepaid or COD). **Paste the customer's DM** and it picks out name, phone, pincode and address.
- **Stock:** size × colour grid for every product, low sizes in pink, tap a number to add production pieces. New products in a minute: name, prices, tap colours and sizes, add photos.
- **Returns & exchanges** inbox, with stock and refunds handled automatically.
- **Books, approvals, partner shares, month close, activity log** (partners).

---

## The rules (enforced inside the database)

| Action | Who decides |
|---|---|
| Expense up to ₹2,000 | Recorded instantly, **bill photo required** |
| Expense ₹2,001 – ₹15,000 | Any **2 partners** |
| Expense above ₹15,000 | **All 4 partners** |
| Capital in / payout to a partner | **All 4** + bank screenshot |
| **Changing a live product's price** | **All 4** |
| **Removing damaged stock** | **All 4** |
| Changing any limit or shop setting | **All 4** |
| Profit / loss split | **All 4** |
| Cancelling a **paid** order (= refund) or approving a **return** | **Partners only** (Mahendra can't) |
| Discount on manual orders | Max **10%** (changeable by all 4) |
| Products Mahendra adds | Stay **draft** until a partner publishes |

- **Nothing is ever edited or deleted:** books, votes, stock movements, order history, activity log. Mistakes are fixed by a reversal that all 4 approve.
- **Sales post themselves to the books** when money actually arrives (online payment confirmed by Razorpay, store sale, or COD delivered). Refunds post themselves too.
- **Order totals are always calculated by the database** from the real price list. Someone tampering with the website can't change a price.
- **Stock can't be oversold:** two people buying the last piece at the same moment — only one gets it.
- **Online orders not paid within 30 minutes** release their stock automatically.
- **Month close:** each partner enters the bank balance and signs; after all 4 sign, that month is locked.
- **Mahendra** sees orders, stock and returns, but not the books, partner money or the activity log.

### Profit & loss split
**25% each by default** (profit and loss). It can be changed any time — equal, by investment ratio, or custom % per partner — but only when all 4 approve (Team app → More → Partners → *Change split*). The **Partners** screen shows each person's investment, share, and "if settled today".

---

## What's in the repo

```
web/                         the shop (customers)
web/admin/                   the team app
web/config.js                your Supabase keys + business details  ← edit this
web/celebrate.js             confetti, chime, milestone moments
supabase/migrations/         database: 001 books & approvals · 002 bill photos · 003 shop, orders, stock · 004 product photos + auto clean-up
supabase/functions/razorpay  the payment server function
supabase/seed/members.sql    the 4 partners + Mahendra  ← edit e-mails first
supabase/tests/              128 automatic checks of every rule (run on every GitHub push)
```

---

## Setup (about 45 minutes, one time)

### 1. Database (Supabase, free)
1. **supabase.com** → sign in with GitHub → **New project** → name `zshirts`, region **Mumbai**, strong password (save it).
2. **SQL Editor → New query**, and run these files **in this order** (open each on GitHub, copy all, paste, **Run**):
   1. `supabase/migrations/001_phase1_partner_ledger.sql`
   2. `supabase/migrations/002_storage.sql`
   3. `supabase/migrations/003_phase2_commerce.sql`
   4. `supabase/migrations/004_storage_products_and_cron.sql`
   5. `supabase/seed/members.sql` — **replace the 5 example e-mails with the real ones first**
3. **Authentication → Sign In / Providers → Email:** keep **Confirm email** on.
4. **Database → Publications → supabase_realtime:** make sure **notifications** is ticked (for instant alerts).

### 2. Connect the apps
1. Supabase → **Project Settings → API**: copy the **Project URL** and the **anon public** key.
2. On GitHub open `web/config.js` → ✏️ → paste both. Also fill in your WhatsApp number, Instagram handle and business address → **Commit changes**.

### 3. Online payments (Razorpay)
1. Create a Razorpay account and complete KYC (needs the business PAN/bank). Start in **Test mode**.
2. Razorpay → **Settings → API Keys** → generate keys.
3. Supabase → **Edge Functions → Deploy a new function → Via editor**: name it `razorpay`, paste `supabase/functions/razorpay/index.ts`, deploy. In the function's settings turn **off "Verify JWT"**.
4. Supabase → **Edge Functions → Secrets**: add `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` (any long random text).
5. Razorpay → **Webhooks → Add**: URL `https://YOUR-PROJECT-ID.supabase.co/functions/v1/razorpay`, the same webhook secret, events **payment.captured** and **order.paid**.
6. Test with Razorpay's test UPI/card. When happy, switch Razorpay to **Live mode** keys.

Until this step is done, customers can still order with **cash on delivery**.

### 4. Put it online
1. Repo → **Settings → Pages** → Source: **GitHub Actions**.
2. Repo → **Actions → Publish app → Run workflow**.
3. Supabase → **Authentication → URL Configuration** → Site URL = `https://idivyesh304.github.io/Z-Shirt/admin/`.

### 5. Everyone joins the team app
Each partner and Mahendra opens `…/Z-Shirt/admin/`, taps **Create account** with their registered e-mail, confirms it, signs in, and adds it to the home screen. Tap the 🔔 → **Turn on phone alerts**.

### 6. First steps inside
1. Each partner records their **capital in** (More → New money entry) — the others approve.
2. **Stock → + New product** → add your tees, then tap the grid to add pieces.
3. Open the shop and place a test COD order — watch the confetti on everyone's phone.

---

## Honest limits

- **Alerts arrive while the team app is open** (on screen or in a background tab). Alerts to a fully closed phone app need push notifications — that's in the next phase.
- **Instagram and WhatsApp orders are entered by the team** (with the paste-a-DM shortcut). Reading DMs automatically needs Meta's business API approval.
- **Courier booking** is manual for now (enter courier + AWB). Shiprocket/Delhivery integration can auto-book and auto-track.
- **GST:** prices are treated as inclusive of GST and the invoice says so. A full GST tax invoice (HSN, CGST/SGST split) should be added once you register — check rates with your CA.
- **The Supabase account owner can technically bypass rules.** Add all 4 partners to the Supabase organisation and watch the activity log for "system / database owner".
- **Cash outside the system** can't be seen by software. Prefer UPI/online payments into the business account and do a monthly physical stock count.
- Order numbers can skip (e.g. ZS1003 → ZS1005) when a checkout fails at the last step — normal, nothing is missing.

## Coming next
HRMS for Mahendra (attendance, salary, leave) · daily cash-counter close · push notifications to closed phones · Shiprocket auto-booking · GST invoices · discount coupons · abandoned-cart WhatsApp nudges · Play Store app.
