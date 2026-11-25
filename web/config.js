// SINDIICAT runs on DZYN LAB's own server (sindiicat.dzynlabpvtltd.com). The server rewrites
// these two values from its own settings; they are kept here for the Android app build.
// The "anon public" key is safe to put here: the database rules decide what anyone can see or do.
window.ZS_CONFIG = {
  SUPABASE_URL: 'https://api.sindiicat.dzynlabpvtltd.com',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoiYW5vbiIsImlzcyI6InN1cGFiYXNlIiwiaWF0IjoxNzk1NjAwMjg0LCJleHAiOjE5NTMyODAyODR9.iPQOg6_MNFKYV1wsO1ycZlRKC5UIt19t67nZFuxhflA',

  // Business details printed on invoices
  BUSINESS_NAME: 'SINDIICAT',
  BUSINESS_ADDRESS: '',        // e.g. 'Ahmedabad, Gujarat 380051'
  GSTIN: '',                   // add once registered

  // Public address of the shop (used for links in WhatsApp messages and the Android app)
  SHOP_URL: 'https://sindiicat.dzynlabpvtltd.com/',

  // Shop details shown to customers
  STORE_WHATSAPP: '',          // e.g. '919876543210' (country code + number, no +). Leave '' to hide the button.
  INSTAGRAM: '',               // e.g. 'sindiicat.in'

  // Oversized size guide in inches (edit to match your actual pattern)
  SIZE_GUIDE: [
    { size: 'S',   chest: 44, length: 28, shoulder: 21 },
    { size: 'M',   chest: 46, length: 29, shoulder: 22 },
    { size: 'L',   chest: 48, length: 30, shoulder: 23 },
    { size: 'XL',  chest: 50, length: 31, shoulder: 24 },
    { size: 'XXL', chest: 52, length: 32, shoulder: 25 }
  ],
  // Regular Fit: true to size, shoulder seam on the shoulder (inches, garment)
  SIZE_GUIDE_REGULAR: [
    { size: 'S',   chest: 38, length: 26, shoulder: 16.5 },
    { size: 'M',   chest: 40, length: 27, shoulder: 17.5 },
    { size: 'L',   chest: 42, length: 28, shoulder: 18.5 },
    { size: 'XL',  chest: 44, length: 29, shoulder: 19.5 },
    { size: 'XXL', chest: 46, length: 30, shoulder: 20.5 }
  ]
};
