// Z-SHIRTS · Razorpay payments (Supabase Edge Function)
//
// The shop never decides an order is "paid". Only this server function can,
// after checking Razorpay's signature AND asking Razorpay for the real amount.
//
// Secrets to set (Supabase → Edge Functions → Secrets):
//   RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET
// Deploy:  supabase functions deploy razorpay --no-verify-jwt
// Webhook: Razorpay Dashboard → Webhooks → URL = <project>/functions/v1/razorpay,
//          events: payment.captured, order.paid

import { createClient } from 'npm:@supabase/supabase-js@2';

const KEY_ID = Deno.env.get('RAZORPAY_KEY_ID') ?? '';
const KEY_SECRET = Deno.env.get('RAZORPAY_KEY_SECRET') ?? '';
const WEBHOOK_SECRET = Deno.env.get('RAZORPAY_WEBHOOK_SECRET') ?? '';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function hmacHex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(sig)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function razorpay(path: string, init: RequestInit = {}) {
  const res = await fetch(`https://api.razorpay.com/v1/${path}`, {
    ...init,
    headers: { Authorization: 'Basic ' + btoa(`${KEY_ID}:${KEY_SECRET}`), 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body?.error?.description ?? 'Razorpay request failed');
  return body;
}

// Confirms in the database only if Razorpay itself says the payment is captured/authorized for this order.
async function confirm(orderNo: string, rzpOrderId: string, paymentId: string) {
  const payment = await razorpay(`payments/${paymentId}`);
  if (payment.order_id !== rzpOrderId) throw new Error('Payment does not belong to this order.');
  if (!['captured', 'authorized'].includes(payment.status)) throw new Error(`Payment is ${payment.status}.`);
  const { data, error } = await db.rpc('confirm_online_payment', {
    p_order_no: orderNo, p_rzp_order_id: rzpOrderId, p_payment_id: paymentId, p_amount_paise: payment.amount,
  });
  if (error) throw new Error(error.message);
  return data;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  if (!KEY_ID || !KEY_SECRET) return json({ error: 'Online payment is not set up yet.' }, 503);

  const raw = await req.text();

  // ---- Razorpay webhook (safety net if the customer closes the page after paying)
  const hookSig = req.headers.get('x-razorpay-signature');
  if (hookSig) {
    if (!WEBHOOK_SECRET || !safeEqual(await hmacHex(WEBHOOK_SECRET, raw), hookSig)) return json({ error: 'bad signature' }, 401);
    const evt = JSON.parse(raw);
    const p = evt?.payload?.payment?.entity;
    if (p && (evt.event === 'payment.captured' || evt.event === 'order.paid')) {
      const orderNo = p.notes?.order_no;
      if (orderNo) {
        try { await confirm(orderNo, p.order_id, p.id); } catch (e) { console.error('webhook confirm', orderNo, (e as Error).message); }
      }
    }
    return json({ ok: true });
  }

  let body: Record<string, string>;
  try { body = JSON.parse(raw); } catch { return json({ error: 'Bad request' }, 400); }

  try {
    // ---- 1. Start payment for an order the shop just created
    if (body.action === 'create') {
      const { data: order, error } = await db.from('orders')
        .select('order_no,total,status,payment_method,payment_status,customer_name,customer_phone,customer_email')
        .eq('order_no', body.order_no).single();
      if (error || !order) return json({ error: 'Order not found.' }, 404);
      if (order.payment_method !== 'online' || order.payment_status !== 'pending' || order.status === 'cancelled') {
        return json({ error: 'This order is not waiting for payment.' }, 409);
      }
      const amount = Math.round(Number(order.total) * 100);
      const rzp = await razorpay('orders', {
        method: 'POST',
        body: JSON.stringify({ amount, currency: 'INR', receipt: order.order_no, notes: { order_no: order.order_no } }),
      });
      const { error: e2 } = await db.rpc('attach_razorpay_order', { p_order_no: order.order_no, p_rzp_order_id: rzp.id });
      if (e2) throw new Error(e2.message);
      return json({
        key: KEY_ID, razorpay_order_id: rzp.id, amount, currency: 'INR', order_no: order.order_no,
        name: order.customer_name, phone: order.customer_phone, email: order.customer_email,
      });
    }

    // ---- 2. Customer finished paying in the Razorpay window
    if (body.action === 'verify') {
      const expected = await hmacHex(KEY_SECRET, `${body.razorpay_order_id}|${body.razorpay_payment_id}`);
      if (!safeEqual(expected, body.razorpay_signature ?? '')) return json({ error: 'Payment could not be verified.' }, 400);
      const status = await confirm(body.order_no, body.razorpay_order_id, body.razorpay_payment_id);
      return json({ status });
    }

    return json({ error: 'Unknown action' }, 400);
  } catch (e) {
    return json({ error: (e as Error).message }, 400);
  }
});
