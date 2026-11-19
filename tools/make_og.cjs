// Renders the 1200x630 share image (client/og.png) from the real game's Locker Room.
// Start a server on PORT, then:  NODE_PATH=$(npm root -g) node tools/make_og.cjs /tmp/og2x.png 4104 5000
// and shrink the 2x screenshot:  python3 -c "from PIL import Image; Image.open('/tmp/og2x.png').convert('RGB').resize((1200,630), Image.LANCZOS).save('client/og.png', optimize=True)"
// (5000 ms lands on the calm "number one" pose; emotes later can get cut off at the top.)
const { chromium } = require('playwright');
const OUT = process.argv[2];
const PORT = process.argv[3] || 4104;
(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage({ viewport: { width: 1200, height: 630 }, deviceScaleFactor: 2 });
  await page.goto(`http://localhost:${PORT}/`);
  await page.waitForSelector('#auth:not(.hidden)', { timeout: 30000 });
  await page.click('#auth-tabs button[data-v="signup"]');
  const u = 'OG' + Math.floor(Math.random() * 1e6);
  await page.fill('#a-email', u + '@ex.com');
  await page.fill('#a-user', u);
  await page.fill('#a-pass', 'secret123');
  await page.check('#a-age');
  await page.click('#a-go');
  await page.waitForSelector('#menu:not(.hidden)', { timeout: 30000 });
  await page.addStyleTag({ content: `
    #menu { background: linear-gradient(90deg, rgba(4,10,28,.85) 0%, rgba(4,10,28,.55) 38%, rgba(4,10,28,0) 62%) !important; }
    #menu > *:not(.menu-right) { display: none !important; }
    .menu-right > *:not(#preview) { display: none !important; }
    #preview { position: fixed !important; right: 70px; bottom: -6px; width: 480px !important; height: 507px !important;
      background: none !important; box-shadow: none !important; border-radius: 0 !important; }
    #og { position: fixed; left: 64px; top: 92px; z-index: 50; font-family: 'Trebuchet MS', 'Segoe UI', system-ui, sans-serif; color: #fff; width: 720px; }
    #og .logo { font-size: 108px; }
    #og .crown { font-size: 64px; position: absolute; left: 360px; top: -58px; transform: rotate(14deg); filter: drop-shadow(3px 4px 0 rgba(0,0,0,.35)); }
    #og .tag { font-size: 34px; font-weight: 800; margin: 26px 0 0; text-shadow: 2px 2px 0 rgba(0,0,0,.5); opacity: 1; }
    #og .pills { display: flex; gap: 12px; margin-top: 22px; }
    #og .pills span { white-space: nowrap; background: #ffcc33; color: #1b1b1b; font-weight: 800; font-size: 21px; padding: 9px 16px; border-radius: 12px; box-shadow: 0 4px 0 #b88a10; }
    #og .pills span.alt { background: #ff5a2a; color: #fff; box-shadow: 0 4px 0 #a3300f; }
  ` });
  await page.evaluate(() => {
    const d = document.createElement('div');
    d.id = 'og';
    d.innerHTML = '<div class="crown">👑</div><h1 class="logo">FOOTBALL<br><span>ROYALE</span></h1>'
      + '<p class="tag">75 players. One champion.</p>'
      + '<div class="pills"><span class="alt">FREE IN YOUR BROWSER</span><span>SQUAD UP WITH FRIENDS</span></div>';
    document.body.appendChild(d);
  });
  await page.waitForTimeout(Number(process.argv[4] || 9000));
  await page.screenshot({ path: OUT });
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
