// Copies the team app (web/admin) plus the shared files into www/ for the Android build.
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, '..', 'web');
const out = join(here, 'www');

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

cpSync(join(web, 'admin'), out, { recursive: true });
cpSync(join(web, 'brand'), join(out, 'brand'), { recursive: true });
for (const f of ['config.js', 'celebrate.js']) cpSync(join(web, f), join(out, f));
rmSync(join(out, 'sw.js'), { force: true });          // no service worker inside the app
rmSync(join(out, 'manifest.json'), { force: true });

const html = join(out, 'index.html');
writeFileSync(html, readFileSync(html, 'utf8')
  .replaceAll('../config.js', 'config.js')
  .replaceAll('../celebrate.js', 'celebrate.js')
  .replaceAll('../brand/', 'brand/')
  .replace('<link rel="manifest" href="manifest.json">\n', ''));

const css = join(out, 'style.css');
writeFileSync(css, readFileSync(css, 'utf8').replaceAll('../brand/', 'brand/'));

cpSync(join(here, 'native', 'offline.html'), join(out, 'offline.html'));
if (!existsSync(join(out, 'app.js'))) throw new Error('web/admin/app.js missing');
console.log('www/ ready');
