// Paste your Supabase project details here (Supabase → Project Settings → API).
// The "anon public" key is safe to put here: the database rules decide what anyone can see or do.
window.ZS_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT-ID.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-PUBLIC-KEY',

  // Business details printed on invoices
  BUSINESS_NAME: 'Z-SHIRTS',
  BUSINESS_ADDRESS: '',        // e.g. 'Ahmedabad, Gujarat 380051'
  GSTIN: '',                   // add once registered

  // Shop details shown to customers
  STORE_WHATSAPP: '',          // e.g. '919876543210' (country code + number, no +). Leave '' to hide the button.
  INSTAGRAM: '',               // e.g. 'zshirts.in'

  // Oversized size guide in inches (edit to match your actual pattern)
  SIZE_GUIDE: [
    { size: 'S',   chest: 44, length: 28, shoulder: 21 },
    { size: 'M',   chest: 46, length: 29, shoulder: 22 },
    { size: 'L',   chest: 48, length: 30, shoulder: 23 },
    { size: 'XL',  chest: 50, length: 31, shoulder: 24 },
    { size: 'XXL', chest: 52, length: 32, shoulder: 25 }
  ]
};
