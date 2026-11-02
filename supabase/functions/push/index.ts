// Z-SHIRTS · phone notifications (Supabase Edge Function)
//
// Sends everything waiting in push_outbox to phones, even when the app is closed:
//   · team alerts (new order, approvals, low stock…) → partners / Mahendra
//   · customer alerts (order shipped, back in stock, making status)
// The database calls this every minute when something is waiting (see 006_push_cron.sql).
// It creates its own notification keys on first run, so there is nothing to set up.
// Deploy with "Verify JWT" OFF; it checks its own key from the database instead.

import { createClient } from 'npm:@supabase/supabase-js@2';
import webpush from 'npm:web-push@3.6.7';

const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
  auth: { persistSession: false },
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' } });

async function secret(key: string): Promise<string | null> {
  const { data } = await db.from('app_secrets').select('value').eq('key', key).maybeSingle();
  return data?.value ?? null;
}

async function vapidKeys() {
  let pub = await secret('vapid_public');
  let priv = await secret('vapid_private');
  if (!pub || !priv) {
    const k = webpush.generateVAPIDKeys();
    // insert-if-missing so two runs at the same moment cannot create two different key pairs
    await db.from('app_secrets').upsert([{ key: 'vapid_public', value: k.publicKey }, { key: 'vapid_private', value: k.privateKey }],
      { onConflict: 'key', ignoreDuplicates: true });
    pub = await secret('vapid_public');
    priv = await secret('vapid_private');
  }
  return { pub: pub!, priv: priv! };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return json({});
  const keys = await vapidKeys();
  const url = new URL(req.url);
  if (url.searchParams.get('key') !== null) return json({ key: keys.pub }); // public key for the browser

  const cronKey = await secret('cron_key');
  if (!cronKey || req.headers.get('x-cron-key') !== cronKey) return json({ error: 'not allowed' }, 401);

  webpush.setVapidDetails('mailto:panchaldivyesh72@gmail.com', keys.pub, keys.priv);

  const { data: jobs } = await db.from('push_outbox').select('*').is('sent_at', null).order('id').limit(200);
  if (!jobs?.length) return json({ sent: 0 });

  const { data: subs } = await db.from('push_subscriptions').select('*').is('failed_at', null);
  const { data: members } = await db.from('members').select('id, role, active');
  const role = new Map((members ?? []).map((m) => [m.id, m]));
  const shop = 'https://idivyesh304.github.io/Z-Shirt/';

  let sent = 0;
  const dead = new Set<number>();
  for (const job of jobs) {
    const targets = (subs ?? []).filter((s) => {
      if (dead.has(s.id)) return false;
      if (job.subscription_id) return s.id === job.subscription_id;
      const m = s.member_id ? role.get(s.member_id) : null;
      if (!m || !m.active) return false;
      return job.audience === 'partners' ? m.role === 'partner' : true;
    });
    const payload = JSON.stringify({ title: job.title, body: job.body ?? '', url: shop + (job.url ?? ''), tag: 'zs-' + job.id });
    await Promise.all(targets.map(async (s) => {
      try {
        await webpush.sendNotification({ endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth_key } }, payload, { TTL: 86400 });
        sent++;
      } catch (e) {
        const code = (e as { statusCode?: number }).statusCode;
        if (code === 404 || code === 410) dead.add(s.id); // phone unsubscribed or app removed
      }
    }));
  }
  await db.rpc('push_done', { p_jobs: jobs.map((j) => j.id), p_dead: [...dead] });
  return json({ jobs: jobs.length, sent });
});
