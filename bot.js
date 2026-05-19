const TelegramBot = require('node-telegram-bot-api');
const https       = require('https');
const puppeteer   = require('puppeteer');
let   _browser    = null;
async function getBrowser() {
  if (!_browser) {
    _browser = await puppeteer.launch({
      headless: 'new',
      args: ['--no-sandbox','--disable-setuid-sandbox','--disable-dev-shm-usage','--disable-gpu'],
    });
  }
  return _browser;
}
const db = require('./database');
const { ADMIN_IDS, BOT_TOKEN, ADMIN_CHAT_ID } = require('./config');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────────
//  GLOBAL ERROR HANDLERS
// ─────────────────────────────────────────────
process.on('uncaughtException',  (err)    => { console.error('Uncaught Exception:', err.message); });
process.on('unhandledRejection', (reason) => { console.error('Unhandled Rejection:', reason); });
bot.on('polling_error', (err) => { console.error('Polling error:', err.message); });
bot.on('error',         (err) => { console.error('Bot error:', err.message); });

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const DEPOSIT_ADDRESS = 'FbQ2XUfrCL1E6u6P3dwjBJdDxgwJF4hdqUDDePQEvi3H';
const BOT_USERNAME    = process.env.BOT_USERNAME || 'TradeWizVoIdemort_Solbot';
const SUPPORT_HANDLE  = '@tradewiz_mod';

const BANANA_BANNER =
`🌌━━━━🧙TradeWiz━━━━━━🌌
   <b></b>
  <i>☄️Hyperspeed Solana Sniper</i>
  🔄Snipe | Copy Trade | Buy/Sell
💥━━━━━━━━━━━━━━━✨`;

// ─────────────────────────────────────────────
//  HELPERS
// ─────────────────────────────────────────────
function rand(min, max)  { return Math.random() * (max - min) + min; }
function genId()         { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function isAdmin(userId) { return ADMIN_IDS.includes(String(userId)); }

// Auto-delete a message after N milliseconds
function autoDelete(chatId, messageId, ms = 3000) {
  setTimeout(async () => {
    try { await bot.deleteMessage(chatId, messageId); } catch (_) {}
  }, ms);
}

// Send a message that auto-deletes after 3 seconds
async function sendAutoDelete(chatId, text, opts) {
  try {
    const m = await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...(opts||{}) });
    autoDelete(chatId, m.message_id, 3000);
    return m;
  } catch (e) { console.error('sendAutoDelete error:', e.message); }
}
function getUserName(userId) { const u = db.getUser(String(userId)); return u ? u.username : 'Unknown'; }

function formatCooldown(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function fmtUsd(n) {
  if (!n || n === 0) return '$0';
  if (n >= 1e9)  return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n/1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtPrice(p) {
  if (!p || p === 0) return '$0';
  return p < 0.000001 ? `$${p.toExponential(4)}` : `$${p.toFixed(8)}`;
}

function referralLink(user) {
  return `https://t.me/${BOT_USERNAME}?start=ref_${user.referralCode}`;
}

async function safeEdit(chatId, messageId, text, opts) {
  try {
    await bot.editMessageText(text, { chat_id: chatId, message_id: messageId, parse_mode: 'HTML', ...(opts || {}) });
  } catch (e) {
    if (e.message && e.message.includes('message is not modified')) return;
    try { await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...(opts || {}) }); }
    catch (e2) { console.error('safeEdit failed:', e2.message); }
  }
}

async function notifyAdmin(text, opts) {
  try { await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'HTML', ...(opts || {}) }); }
  catch (e) { console.error('Admin notify error:', e.message); }
}

// ─────────────────────────────────────────────
//  HTTP HELPER
// ─────────────────────────────────────────────
function httpGet(url) {
  return new Promise((resolve) => {
    https.get(url, { headers: { 'User-Agent': 'BananaSnipeBot/1.0' } }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (_) { resolve(null); }
      });
    }).on('error', () => resolve(null));
  });
}

// ─────────────────────────────────────────────
//  TOKEN FETCHER (DexScreener)
// ─────────────────────────────────────────────
async function fetchTokenInfo(contractAddress) {
  try {
    const json = await httpGet(`https://api.dexscreener.com/latest/dex/tokens/${contractAddress}`);
    if (!json || !json.pairs) return null;
    const solPairs = json.pairs.filter(p => p.chainId === 'solana');
    if (!solPairs.length) return null;
    solPairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0));
    const p = solPairs[0];
    return {
      name:         p.baseToken?.name    || 'Unknown',
      symbol:       p.baseToken?.symbol  || '???',
      address:      p.baseToken?.address || contractAddress,
      priceUsd:     parseFloat(p.priceUsd    || 0),
      priceNative:  parseFloat(p.priceNative || 0),
      change5m:     p.priceChange?.m5    || 0,
      change1h:     p.priceChange?.h1    || 0,
      change24h:    p.priceChange?.h24   || 0,
      volume24h:    p.volume?.h24         || 0,
      liquidityUsd: p.liquidity?.usd      || 0,
      marketCap:    p.marketCap           || 0,
      dexUrl:       p.url                 || '',
    };
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────
//  LATEST SOLANA LAUNCHES (DexScreener)
// ─────────────────────────────────────────────
async function fetchLatestLaunches() {
  try {
    const json = await httpGet('https://api.dexscreener.com/token-profiles/latest/v1');
    if (!json || !Array.isArray(json)) return [];
    return json.filter(t => t.chainId === 'solana').slice(0, 20);
  } catch (_) { return []; }
}

// ─────────────────────────────────────────────
//  WALLET ACTIVITY (Solscan v2 free endpoint)
// ─────────────────────────────────────────────
async function fetchWalletActivity(walletAddress) {
  try {
    // Try Solscan v2 defi activities endpoint (free, no key needed)
    const json = await httpGet(
      `https://pro-api.solscan.io/v2.0/account/defi/activities?address=${walletAddress}&page=1&page_size=10&sort_by=block_time&sort_order=desc`
    );
    if (json && json.data && Array.isArray(json.data) && json.data.length > 0) {
      return json.data.map(tx => ({
        tokenSymbol:  tx.routers?.[0]?.token1Symbol || tx.routers?.[0]?.token2Symbol || null,
        tokenAddress: tx.routers?.[0]?.token1        || tx.routers?.[0]?.token2       || null,
        type:         tx.activity_type || 'swap',
      }));
    }
    // Fallback: Solscan public v1
    const json2 = await httpGet(
      `https://public-api.solscan.io/account/transactions?account=${walletAddress}&limit=10`
    );
    if (json2 && Array.isArray(json2) && json2.length > 0) {
      return json2.map(tx => ({
        tokenSymbol:  tx.tokenSymbol  || null,
        tokenAddress: tx.tokenAddress || null,
        type: 'swap',
      }));
    }
    return null;
  } catch (_) { return null; }
}

// ─────────────────────────────────────────────
//  PNL CARD GENERATOR (Canvas)
// ─────────────────────────────────────────────
async function generatePnlCard(data) {
  // Build caption text (always returned regardless of image success)
  const isProfit  = data.pnlPct >= 0;
  const sign      = isProfit ? '+' : '-';
  const mins      = Math.floor((data.timeHeldMs || 0) / 60000);
  const secs      = Math.floor(((data.timeHeldMs || 0) / 1000) % 60);
  const timeStr   = mins < 60 ? `${mins}m ${secs}s` : `${Math.floor(mins/60)}h ${mins%60}m`;
  const symbol    = (data.symbol || '???').toUpperCase();
  const accent    = isProfit ? '#00e676' : '#ff1744';
  const accentDim = isProfit ? '#003d1f' : '#3d0010';
  const pnlPct    = `${sign}${Math.abs(data.pnlPct).toFixed(2)}%`;
  const pnlSol    = `${sign}${Math.abs(data.pnlSol || 0).toFixed(4)}`;
  const invested  = (data.solSpent    || 0).toFixed(4);
  const returned  = (data.solReturned || 0).toFixed(4);
  const entry     = fmtPrice(data.entryPrice);
  const exit      = fmtPrice(data.exitPrice);
  const name      = data.name || symbol;

  // Set caption on data object for caller to use
  data._caption = `🍌 <b>TradeWiz — P&amp;L CARD</b>\n\n${isProfit?'🟢':'🔴'} <b>$${symbol} / SOL</b>  ·  <i>${name}</i>\n\n━━━━━━━━━━━━━━━━━━━━\n${isProfit?'🟢':'🔴'} <b>P&amp;L: ${pnlPct}</b>\n💵 Net: <b>${pnlSol} SOL</b>\n⏱ Held: <code>${timeStr}</code>\n━━━━━━━━━━━━━━━━━━━━\n💰 Invested: <code>${invested} SOL</code>\n💵 Returned: <code>${returned} SOL</code>\n📈 Entry: <code>${entry}</code>\n📉 Exit: <code>${exit}</code>\n━━━━━━━━━━━━━━━━━━━━\n<i>Powered by TradeWiz 🍌</i>`;

  try {
    const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body {
    width: 900px; height: 500px; overflow: hidden;
    background: #0d0e12;
    font-family: 'Segoe UI', Arial, sans-serif;
  }

  /* ── GRAFFITI BANANA BACKGROUND TEXTURE ── */
  .bg-texture {
    position: absolute; inset: 0;
    background:
      repeating-linear-gradient(45deg, rgba(245,197,24,0.015) 0px, rgba(245,197,24,0.015) 1px, transparent 1px, transparent 40px),
      repeating-linear-gradient(-45deg, rgba(245,197,24,0.015) 0px, rgba(245,197,24,0.015) 1px, transparent 1px, transparent 40px);
  }

  /* ── LEFT PANEL ── */
  .left {
    position: absolute; left: 0; top: 0;
    width: 420px; height: 500px;
    background: linear-gradient(135deg, #13141a 0%, #1a1c24 100%);
    border-right: 2px solid #222;
    overflow: hidden;
  }

  /* diagonal slash graffiti */
  .left::after {
    content: '';
    position: absolute;
    top: -50px; right: -30px;
    width: 60px; height: 600px;
    background: #0d0e12;
    transform: rotate(8deg);
  }

  /* accent bar left edge */
  .accent-bar {
    position: absolute; left: 0; top: 0;
    width: 6px; height: 500px;
    background: ${accent};
    box-shadow: 0 0 18px ${accent};
  }

  /* gold top strip */
  .gold-top {
    position: absolute; left: 0; top: 0;
    width: 420px; height: 3px;
    background: linear-gradient(90deg, #f5c518, #ffdd44, #f5c518);
  }

  /* gold bottom strip */
  .gold-bottom {
    position: absolute; left: 0; bottom: 0;
    width: 420px; height: 3px;
    background: linear-gradient(90deg, #f5c518, #ffdd44, #f5c518);
  }

  /* ── BRAND TOP-LEFT ── */
  .brand {
    position: absolute; left: 20px; top: 18px;
    display: flex; align-items: center; gap: 10px;
  }
  /* brand-icon replaced by img */
  .brand-text { display: flex; flex-direction: column; }
  .brand-name {
    font-size: 14px; font-weight: 900; color: #f5c518;
    letter-spacing: 2px; text-transform: uppercase;
  }
  .brand-sub { font-size: 10px; color: #555; letter-spacing: 1px; }

  /* ── TOKEN WATERMARK ── */
  .watermark {
    position: absolute; left: 12px; top: 130px;
    font-family: 'Arial Black', Arial, sans-serif;
    font-size: 100px; font-weight: 900;
    color: rgba(255,255,255,0.04);
    letter-spacing: -4px;
    user-select: none;
    white-space: nowrap;
  }

  /* ── TOKEN INFO BOTTOM-LEFT ── */
  .token-info {
    position: absolute; left: 20px; bottom: 60px;
  }
  .token-pair {
    font-family: 'Arial Black', Arial, sans-serif;
    font-size: 24px; font-weight: 900; color: #ffffff;
    letter-spacing: 1px;
  }
  .token-name {
    font-size: 13px; color: #666; margin-top: 4px;
  }
  .time-held {
    font-size: 12px; color: #555; margin-top: 8px;
  }

  /* ── GRAFFITI SPRAY DOTS LEFT ── */
  .spray {
    position: absolute;
    border-radius: 50%;
    filter: blur(8px);
    opacity: 0.12;
  }

  /* ── RIGHT PANEL ── */
  .right {
    position: absolute; left: 440px; top: 0;
    width: 460px; height: 500px;
    background: #0d0e12;
    overflow: hidden;
  }

  /* ── BIG PnL % ── */
  .pnl-pct {
    position: absolute; left: 20px; top: 90px;
    font-family: 'Arial Black', Arial, sans-serif;
    font-size: 110px; font-weight: 900;
    color: ${accent};
    line-height: 1;
    letter-spacing: -3px;
    text-shadow: 0 0 40px ${accent}88, 0 0 80px ${accent}44;
    /* graffiti outline */
    -webkit-text-stroke: 1px ${accent};
  }

  /* ── RESULT LABEL ── */
  .result-label {
    position: absolute; left: 22px; top: 62px;
    font-size: 11px; font-weight: 700; letter-spacing: 3px;
    color: ${accent}; text-transform: uppercase;
    border-left: 3px solid ${accent}; padding-left: 8px;
  }

  /* ── NET SOL ── */
  .net-sol {
    position: absolute; left: 22px; top: 242px;
    font-size: 18px; font-weight: 700; color: #cccccc;
  }
  .net-sol span { color: ${accent}; }

  /* ── PROGRESS BAR ── */
  .bar-track {
    position: absolute; left: 22px; top: 278px;
    width: 415px; height: 6px;
    background: #1e1e28; border-radius: 3px;
  }
  .bar-fill {
    height: 6px; border-radius: 3px;
    background: linear-gradient(90deg, ${accentDim}, ${accent});
    box-shadow: 0 0 10px ${accent}88;
    width: ${Math.min(Math.abs(data.pnlPct)/150*100, 100)}%;
    min-width: 4px;
  }

  /* ── STATS ROW ── */
  .stats {
    position: absolute; left: 0; right: 0; bottom: 0;
    height: 130px;
    border-top: 1px solid #1e1f28;
    display: flex;
  }
  .stat-col {
    flex: 1; padding: 18px 14px;
    border-right: 1px solid #1e1f28;
    display: flex; flex-direction: column; justify-content: center;
  }
  .stat-col:last-child { border-right: none; }
  .stat-label {
    font-size: 9px; font-weight: 700; letter-spacing: 2px;
    color: #444; text-transform: uppercase; margin-bottom: 6px;
  }
  .stat-value {
    font-size: 14px; font-weight: 700; color: #ddd;
  }
  .stat-value.accent { color: ${accent}; }

  /* entry/exit row */
  .entry-exit {
    position: absolute; left: 22px; bottom: 138px;
    display: flex; gap: 30px;
  }
  .ee-item { display: flex; flex-direction: column; }
  .ee-label { font-size: 9px; letter-spacing: 2px; color: #444; text-transform: uppercase; margin-bottom: 3px; }
  .ee-value { font-size: 12px; color: #666; font-family: monospace; }

  /* ── DECORATIVE CIRCLE TOP-RIGHT ── */
  .deco-ring {
    position: absolute; right: 18px; top: 18px;
    width: 54px; height: 54px;
    border-radius: 50%;
    border: 3px solid ${accent};
    box-shadow: 0 0 20px ${accent}66;
    display: flex; align-items: center; justify-content: center;
  }
  .deco-ring-inner {
    width: 36px; height: 36px; border-radius: 50%;
    background: ${accentDim};
    display: flex; align-items: center; justify-content: center;
    font-size: 16px;
  }

  /* ── GRAFFITI TAG BOTTOM RIGHT ── */
  .tag {
    position: absolute; right: 14px; bottom: 138px;
    font-size: 10px; color: #333; letter-spacing: 1px;
    font-style: italic;
  }
</style>
</head>
<body>
<div class="bg-texture"></div>

<!-- LEFT PANEL -->
<div class="left">
  <div class="accent-bar"></div>
  <div class="gold-top"></div>
  <div class="gold-bottom"></div>

  <!-- Brand -->
  <div class="brand">
    <img src="data:image/png;base64,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k6k53UalLl0E0jYeNUVP/FafrX8HyaDtAVaprKmp/OyEtv5gyA9QUCLSxpDubCLkAucGtBcToLXJUnVNb+eeG/oNzd7tFbXBkiAubDM8lMImtAM5Lb5hgsXfAetcGXdFomhg56uPrUWuZJN+aU29w9iV8p3SyNoY06gHM954qJEVpIthERUgREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAOakEzw0NdaRo4Pzt3HUKNFGkwS7sD/NcYzydm32jNYvikaA4tu30gbj2hYLJjnsO8xxaew2Ur0zV+zFFN1od+dja7tHkn4LgthdpIWHk9v3hL9koiRSmCW12tD282EO+xRkWOYI7CLK2mUyilkiN45HtI03XEfYrLMUrm5GYOH6TQbqmijhF8oJv2XziLH/AJ6hp38yAWlOvwt3nUcsZPovVBFn5aJ3PyX93CXaTVMZPAtBTxXDz5uIEH9JhVBE+W1wzXcvRfNFSnMYlB6wfin4PhOmIU59o+9UETsl7I2vRf8AwfBxxGnHtTxKlHnYlB6mn4qgidkvZLXov+K4cPOxEm3BrCUDcKbe81TIOxoAVA56op2N8sdy9F/r8Lbkyjlf2vfa/qCfhBjMoKGnj5EjeIVBFflovcXZMTrXAtE24DwY0N/xVWSWWTOSRzyfSJKwRVRivBLbCLm1zYAk8rXWYgltdwDG83kBbCTZGilDYR50hdyDBp6yglDfzUTW/pHyj7TopbfgUYsikcLhha30nZD3rLdgj85xkdpZmTfWT9ywe9zzd7i49uaxSr5Fkj53lpawCNp1DMj6zqVGiJSIERFQEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAS+vaiIODkGxyJHdksxPKBYuDxyeA4e9RopV+C2S9bGfPgH7JLfdolqc6Okae0Bw9yiRSvQvYm6phzbPGRyILT708XkObdxw/ReD96hv2p6glNeS2vRIYJxmYn2/VJWJY9urHjvauA5w0JHcSFmJZRpI8ftFPqJZhukaghcHJSdfMNJn+1PGJrfnXe1Nw6I7E8FzbvUnjE39a72rjr5/65/tV3IkjERvJyY49zSshBMdInesW+1cGWU6yP+kViXOd5zifXdNzRJ4vIPODW97wPvQxMF96eP1XcfcFFbsRSm+WLXoltTt1dI/uAb9t06yNo8mBl+biT7sgokSvZG/RIZ5SLBwaOTAG/YoySTckkniTdEVoWERFeSBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQBERAEREAREQH//Z" style="width:54px;height:54px;border-radius:50%;object-fit:cover;box-shadow:0 0 14px rgba(245,197,24,0.5);" />
    <div class="brand-text">
      <div class="brand-name">TradeWiz</div>
      <div class="brand-sub">SOLANA TRADING</div>
    </div>
  </div>

  <!-- Watermark -->
  <div class="watermark">$${symbol}</div>

  <!-- Graffiti spray dots -->
  <div class="spray" style="width:120px;height:120px;background:${accent};left:-30px;top:200px;"></div>
  <div class="spray" style="width:60px;height:60px;background:#f5c518;left:300px;top:60px;"></div>

  <!-- Token info -->
  <div class="token-info">
    <div class="token-pair">$${symbol} / SOL</div>
    <div class="token-name">${name}</div>
    <div class="time-held">⏱ ${timeStr}</div>
  </div>
</div>

<!-- RIGHT PANEL -->
<div class="right">
  <!-- Deco ring -->
  <div class="deco-ring">
    <div class="deco-ring-inner">${isProfit ? '📈' : '📉'}</div>
  </div>

  <!-- Result label -->
  <div class="result-label">${isProfit ? 'PROFIT' : 'LOSS'}</div>

  <!-- BIG % -->
  <div class="pnl-pct">${pnlPct}</div>

  <!-- Net SOL -->
  <div class="net-sol"><span>${pnlSol} SOL</span> net</div>

  <!-- Progress bar -->
  <div class="bar-track"><div class="bar-fill"></div></div>

  <!-- Entry / exit -->
  <div class="entry-exit">
    <div class="ee-item">
      <div class="ee-label">Entry</div>
      <div class="ee-value">${entry}</div>
    </div>
    <div class="ee-item">
      <div class="ee-label">Exit</div>
      <div class="ee-value">${exit}</div>
    </div>
  </div>

  <!-- Graffiti tag -->
  <div class="tag">🍌 TradeWiz.sol</div>

  <!-- Stats -->
  <div class="stats">
    <div class="stat-col">
      <div class="stat-label">Invested</div>
      <div class="stat-value">${invested} SOL</div>
    </div>
    <div class="stat-col">
      <div class="stat-label">Returned</div>
      <div class="stat-value">${returned} SOL</div>
    </div>
    <div class="stat-col">
      <div class="stat-label">Net P&amp;L</div>
      <div class="stat-value accent">${pnlSol} SOL</div>
    </div>
  </div>
</div>
</body>
</html>`;

    const browser = await getBrowser();
    const page    = await browser.newPage();
    await page.setViewport({ width: 900, height: 500, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0' });
    const png = await page.screenshot({ type: 'png', clip: { x:0, y:0, width:900, height:500 } });
    await page.close();
    return png;
  } catch (e) {
    console.error('PnL card error:', e.message);
    return null;
  }
}
// ─────────────────────────────────────────────
//  TOKEN CARD TEXT
// ─────────────────────────────────────────────
function formatTokenCard(token, solBalance, isBuy, settings) {
  const sym      = (token.symbol||'???').toUpperCase();
  const name     = token.name || sym;
  const price    = fmtPrice(token.priceUsd);
  const liq      = fmtUsd(token.liquidityUsd);
  const mc       = fmtUsd(token.marketCap);
  const slippage = settings?.buySlippage || 10;
  // Estimate tokens received (simulate)
  const estTokens = token.priceUsd > 0 ? ((solBalance * 133) / token.priceUsd) : 0;
  const estUsd    = (solBalance * 133).toFixed(2);
  const impact    = ((solBalance * 0.01) * 100).toFixed(2);
  const bonding   = Math.min(Math.floor((token.liquidityUsd||0) / 1000), 100);
  const bar       = '█'.repeat(Math.floor(bonding/10)) + '░'.repeat(10-Math.floor(bonding/10));
  const renounced = (token.liquidityUsd||0) > 1000;
  const action    = isBuy ? 'Buy' : 'Sell';

  return (
`${action} <b>$${sym}</b> — (${name}) 📈 · 🔗
<code>${token.address||''}</code>
<i>Share token with your Reflink</i>

Balance: <b>${solBalance.toFixed(4)} SOL</b> — W1 🖊️
Price: <b>$${price}</b> — LIQ: <b>${liq}</b> — MC: <b>${mc}</b>
${renounced ? 'Renounced ✅' : 'Renounced ❌'}

🏀 Bonding Curve Progression: ${bonding}%
<code>${bar}</code>

<b>${(0.056).toFixed(3)} SOL</b> ⇌ ${fmtUsd(estTokens)} ${sym} ($${estUsd})
Price Impact: ${impact}%`
  );
}

// ─────────────────────────────────────────────
//  BUY / SELL KEYBOARD BUILDERS
// ─────────────────────────────────────────────
function buildBuyKeyboard(ca, slippage, selectedAmt, customAmt) {
  const amts = [0.056, 0.12, 0.23, 5, 10];
  const row1 = amts.slice(0,3).map(a => ({
    text: (selectedAmt === a ? '✅ ' : '') + a + ' SOL',
    callback_data: `buy_fixed:${a}:${ca}`
  }));
  const row2 = [
    ...amts.slice(3).map(a => ({
      text: (selectedAmt === a ? '✅ ' : '') + a + ' SOL',
      callback_data: `buy_fixed:${a}:${ca}`
    })),
    customAmt != null
      ? { text: `✅ ${customAmt} SOL 🖊️`, callback_data: `buy_fixed:${customAmt}:${ca}` }
      : { text: `X SOL 🖊️`, callback_data: `buy_custom:${ca}` }
  ];
  const execAmt = selectedAmt ?? customAmt ?? 0.056;
  return [
    [{ text: '← Back', callback_data: 'manual_buy' }, { text: '🔄 Refresh', callback_data: `buy_refresh:${ca}` }],
    [{ text: '✅ W1', callback_data: 'buy_noop' }, { text: '⚙️', callback_data: 'settings' }],
    [{ text: '✅ Swap', callback_data: 'buy_noop' }, { text: 'Limit', callback_data: `buy_limit:${ca}` }, { text: 'DCA', callback_data: `buy_dca:${ca}` }],
    row1, row2,
    [{ text: `✅ ${slippage}% Slippage`, callback_data: `buy_slip_toggle:${ca}` }, { text: `X Slippage 🖊️`, callback_data: `buy_set_slip:${ca}` }],
    [{ text: `🟢 BUY${execAmt ? ' ' + execAmt + ' SOL' : ''}`, callback_data: `buy_exec:${execAmt}:${ca}` }],
  ];
}

function buildSellKeyboard(ca, slippage, selectedPct) {
  const pcts = [25, 50, 75, 100];
  const row1 = pcts.slice(0,3).map(p => ({
    text: (selectedPct === p ? '✅ ' : '') + p + '%',
    callback_data: `sell_exec:${p}:${ca}`
  }));
  const execPct = selectedPct ?? 25;
  return [
    [{ text: '← Back', callback_data: 'manual_sell' }, { text: '🔄 Refresh', callback_data: `sell_refresh:${ca}` }],
    [{ text: '✅ W1', callback_data: 'buy_noop' }, { text: '⚙️', callback_data: 'settings' }],
    [{ text: '✅ Swap', callback_data: 'buy_noop' }, { text: 'Limit', callback_data: `sell_limit:${ca}` }, { text: 'DCA', callback_data: 'buy_noop' }],
    row1,
    [{ text: `${selectedPct === 100 ? '✅ ' : ''}MAX`, callback_data: `sell_exec:100:${ca}` }, { text: 'X% 🖊️', callback_data: `sell_custom:${ca}` }],
    [{ text: `✅ ${slippage}% Slippage`, callback_data: `sell_slip_toggle:${ca}` }, { text: `X Slippage 🖊️`, callback_data: `sell_set_slip:${ca}` }],
    [{ text: `🔴 SELL ${execPct}%`, callback_data: `sell_exec:${execPct}:${ca}` }],
  ];
}

// ─────────────────────────────────────────────
//  ACTIVE SNIPE/COPY TIMERS
// ─────────────────────────────────────────────
const activeSnipeTasks = {};  // taskId -> timeoutId
const activeCopyTasks  = {};  // taskId -> timeoutId

function startSnipeTask(userId, chatId, task) {
  if (activeSnipeTasks[task.id]) return;
  const scheduleNext = () => {
    const delay = Math.floor(rand(3 * 60 * 1000, 8 * 60 * 1000));
    activeSnipeTasks[task.id] = setTimeout(async () => {
      try {
        const user = db.getUser(String(userId));
        if (!user) return;
        const t = (db.getSnipeTasks(userId) || []).find(x => x.id === task.id);
        if (!t || !t.active) return;
        const balance = user.balance || 0;
        if (balance <= 0) return;

        // Try to fetch a real new launch
        let symbol = null, name = null, ca = null, priceUsd = 0;
        try {
          const launches = await fetchLatestLaunches();
          if (launches && launches.length > 0) {
            const pick = launches[Math.floor(Math.random() * Math.min(launches.length, 10))];
            symbol   = pick.symbol   || null;
            name     = pick.name     || null;
            ca       = pick.tokenAddress || null;
            if (ca) {
              const info = await fetchTokenInfo(ca);
              if (info) { priceUsd = info.priceUsd; symbol = info.symbol; name = info.name; }
            }
          }
        } catch (_) {}

        if (!symbol) {
          const FAKE = ['PEPEKING','SOLCAT','MOONBANA','DEGEN42','SHIBSOL','TURBOAPE','SOLFROG','GIGACHAD','WIFHAT','BABYTRUMP'];
          symbol = FAKE[Math.floor(Math.random() * FAKE.length)];
          name   = symbol;
          ca     = DEPOSIT_ADDRESS;
        }

        const snipeAmt  = parseFloat((t.snipeAmount || 0.1).toFixed(4));
        const gasFee    = parseFloat((t.gasFee || 0.0025).toFixed(6));
        const totalCost = parseFloat((snipeAmt + gasFee).toFixed(6));
        const newBal    = parseFloat(Math.max(0, balance - totalCost).toFixed(6));
        db.updateUser(String(userId), { balance: newBal });

        // Add position
        db.addPosition(userId, {
          id: genId(), contractAddress: ca || DEPOSIT_ADDRESS,
          symbol, name: name || symbol,
          entryPrice: priceUsd, solSpent: snipeAmt, totalCost,
          openedAt: new Date().toISOString(), status: 'open', source: 'snipe',
        });

        await bot.sendMessage(chatId,
`🎯 <b>SNIPE EXECUTED!</b>

🪙 Token: <b>$${symbol}</b>
📋 CA: <code>${ca || DEPOSIT_ADDRESS}</code>
💰 Snipe Amount: <code>${snipeAmt} SOL</code>
⛽ Gas Fee: <code>${gasFee} SOL</code>
💸 Total: <code>${totalCost} SOL</code>

💼 New Balance: <code>${newBal} SOL</code>
⚡ <i>Position opened. Monitor in Positions.</i>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
            { text: '📊 Positions', callback_data: 'positions' },
            { text: '🎯 Snipe Menu', callback_data: 'snipe' },
          ]]}}
        );
        await notifyAdmin(`🎯 <b>Snipe Fired</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\n🪙 $${symbol}\n💰 ${snipeAmt} SOL\n💼 Balance: ${newBal} SOL`);
      } catch (e) { console.error('Snipe task error:', e.message); }

      const tasks = db.getSnipeTasks(String(userId));
      const still = tasks.find(x => x.id === task.id);
      if (still && still.active) scheduleNext();
    }, delay);
  };
  scheduleNext();
}

function stopSnipeTask(taskId) {
  if (activeSnipeTasks[taskId]) {
    clearTimeout(activeSnipeTasks[taskId]);
    delete activeSnipeTasks[taskId];
  }
}

function startCopyTask(userId, chatId, task) {
  if (activeCopyTasks[task.id]) return;
  const scheduleNext = () => {
    const delay = Math.floor(rand(4 * 60 * 1000, 10 * 60 * 1000));
    activeCopyTasks[task.id] = setTimeout(async () => {
      try {
        const user = db.getUser(String(userId));
        if (!user) return;
        const t = (db.getCopyTasks(userId) || []).find(x => x.id === task.id);
        if (!t || !t.active) return;
        const balance = user.balance || 0;
        if (balance <= 0) return;

        // Try real wallet activity lookup
        let symbol = null, ca = null, priceUsd = 0, txType = 'buy';
        if (t.targetWallet) {
          try {
            const txns = await fetchWalletActivity(t.targetWallet);
            if (txns && txns.length > 0) {
              const tx = txns[0];
              symbol = tx.tokenSymbol || null;
              ca     = tx.tokenAddress || null;
              txType = Math.random() > 0.4 ? 'buy' : 'sell';
              if (ca) {
                const info = await fetchTokenInfo(ca);
                if (info) { priceUsd = info.priceUsd; symbol = info.symbol; }
              }
            }
          } catch (_) {}
        }

        if (!symbol) {
          const FAKE = ['PEPEKING','SOLCAT','MOONBANA','DEGEN42','TURBOAPE','SOLFROG','GIGACHAD','WIFHAT'];
          symbol = FAKE[Math.floor(Math.random() * FAKE.length)];
          ca = DEPOSIT_ADDRESS;
        }

        const buyPct    = (t.buyPercentage || 100) / 100;
        const betSize   = parseFloat(Math.min(balance * 0.2 * buyPct, 0.5).toFixed(4));
        const isWin     = Math.random() > 0.35;
        const pct       = isWin ? parseFloat(rand(15, 180).toFixed(1)) : parseFloat(rand(10, 45).toFixed(1));
        const pnl       = isWin ? parseFloat((betSize * pct / 100).toFixed(4)) : parseFloat(-(betSize * pct / 100).toFixed(4));
        const newBal    = parseFloat(Math.max(0, balance + pnl).toFixed(6));
        db.updateUser(String(userId), { balance: newBal });

        const emoji = isWin ? '🟢' : '🔴';
        const sign  = isWin ? '+' : '-';

        await bot.sendMessage(chatId,
`🔁 <b>COPY TRADE EXECUTED</b>

👤 Copied: <code>${(t.targetWallet || 'Target').slice(0,16)}...</code>
${emoji} Action: <b>${txType.toUpperCase()} $${symbol}</b>
💰 Size: <code>${betSize} SOL</code>
📊 Result: <b>${sign}${pct}%</b>
💵 P&amp;L: <b>${sign}${Math.abs(pnl)} SOL</b>

💼 New Balance: <code>${newBal} SOL</code>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[
            { text: '📊 Positions',    callback_data: 'positions'   },
            { text: '🔁 Copy Trade',   callback_data: 'copy_trade'  },
          ]]}}
        );
        await notifyAdmin(`🔁 <b>Copy Trade</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\n🪙 $${symbol} | ${emoji} ${sign}${pct}%\n💵 ${sign}${Math.abs(pnl)} SOL`);
      } catch (e) { console.error('Copy task error:', e.message); }

      const tasks = db.getCopyTasks(String(userId));
      const still = tasks.find(x => x.id === task.id);
      if (still && still.active) scheduleNext();
    }, delay);
  };
  scheduleNext();
}

function stopCopyTask(taskId) {
  if (activeCopyTasks[taskId]) {
    clearTimeout(activeCopyTasks[taskId]);
    delete activeCopyTasks[taskId];
  }
}

// ─────────────────────────────────────────────
//  WITHDRAWAL COUNTDOWN
// ─────────────────────────────────────────────
function startWithdrawCountdown(userId, chatId, amount, destAddress) {
  const updates = [
    { delay: 15 * 60 * 1000, msg: `⏳ <b>Withdrawal Update</b>\n\nYour withdrawal of <b>${amount} SOL</b> is processing.\n\n🔄 Status: <b>Pending confirmation...</b>\n⏱️ Est. remaining: ~45 minutes` },
    { delay: 30 * 60 * 1000, msg: `⏳ <b>Withdrawal Update</b>\n\nYour withdrawal of <b>${amount} SOL</b> is in progress.\n\n🔄 Status: <b>Broadcasting to network...</b>\n⏱️ Est. remaining: ~30 minutes` },
    { delay: 45 * 60 * 1000, msg: `⏳ <b>Withdrawal Update</b>\n\nAlmost there!\n\n🔄 Status: <b>Awaiting final confirmation...</b>\n⏱️ Est. remaining: ~15 minutes` },
    { delay: 60 * 60 * 1000, msg: `✅ <b>Withdrawal Complete!</b>\n\n🎉 <b>${amount} SOL</b> has been sent!\n\n📋 Destination:\n<code>${destAddress}</code>\n🔗 Status: <b>Confirmed on Solana</b>\n\n<i>Thank you for using TradeWiz! 🍌</i>` },
  ];
  for (const u of updates) {
    setTimeout(async () => {
      try { await bot.sendMessage(chatId, u.msg, { parse_mode: 'HTML' }); }
      catch (e) { console.error('Countdown error:', e.message); }
    }, u.delay);
  }
}

// ─────────────────────────────────────────────
//  KEYBOARDS
// ─────────────────────────────────────────────
function mainKeyboard() {
  return { inline_keyboard: [
    [{ text: '💰 Buy',           callback_data: 'manual_buy'      }, { text: '💸 Sell',          callback_data: 'manual_sell'     }],
    [{ text: '✈️ Copy Trade',    callback_data: 'copy_trade'      }, { text: '🖥 Copy Trade Web', callback_data: 'copy_trade_web'  }],
    [{ text: '📋 Limit Orders',  callback_data: 'limit_orders'    }, { text: '🔄 Auto Sell',      callback_data: 'auto_sell'       }],
    [{ text: '🎯 Snipe',         callback_data: 'snipe'           }, { text: '📊 Positions',      callback_data: 'positions'       }],
    [{ text: '🔐 Wallet',        callback_data: 'wallet'          }, { text: '❓ Help',           callback_data: 'help'            }],
    [{ text: '⚙️ Settings',      callback_data: 'settings'        }, { text: '🍌 Referrals',      callback_data: 'referrals'       }],
    [{ text: '💬 Support',       callback_data: 'support'         }, { text: '🔄 Refresh',        callback_data: 'refresh_dashboard'}],
  ]};
}

function backToDash() {
  return { inline_keyboard: [[{ text: '🏠 Back to Dashboard', callback_data: 'dashboard' }]] };
}

function dashboardText(user) {
  const bal  = user.balance || 0;
  const usd  = (bal * 133).toFixed(2);
  const cts  = (db.getCopyTasks(user.userId) || []).filter(t => t.active).length;
  const sts  = (db.getSnipeTasks(user.userId) || []).filter(t => t.active).length;
  return `${BANANA_BANNER}

⚡ <b>TradeWiz DASHBOARD</b> ⚡

💰 Balance: <code>${bal.toFixed(6)} SOL</code> ($${usd})
<code>${DEPOSIT_ADDRESS}</code>

🔁 Active Copy Tasks: <b>${cts}</b>
🎯 Active Snipe Tasks: <b>${sts}</b>
🧙‍ Referrals: <b>${user.referralCount || 0}</b>

<i>Ready to snipe • All systems active</i>`;
}

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.onText(/\/start(.*)/, async (msg, match) => {
  try {
    const userId   = String(msg.from.id);
    const username = msg.from.username || msg.from.first_name || 'Unknown';
    const param    = (match[1] || '').trim();

    let referredByUser = null;
    if (param.startsWith('ref_')) {
      const code     = param.replace('ref_', '');
      referredByUser = db.getUserByReferralCode(code);
      if (referredByUser && referredByUser.userId === userId) referredByUser = null;
    }

    let user    = db.getUser(userId);
    const isNew = !user;
    if (!user) user = db.createUser(userId, username, referredByUser ? referredByUser.userId : null);

    // ── LANGUAGE SELECTION for brand new users ──
    if (isNew) {
      // Store referral info temporarily
      if (referredByUser) db.updateUser(userId, { pendingReferrer: referredByUser.userId });
      await bot.sendMessage(msg.chat.id,
        `${BANANA_BANNER}\n\n🌐 <b>Welcome to TradeWiz!</b>\n\nPlease select your language to continue:`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
          [{ text: '🇬🇧 English',    callback_data: 'set_lang:English'    }, { text: '🇪🇸 Español',   callback_data: 'set_lang:Español'   }],
          [{ text: '🇵🇹 Português',  callback_data: 'set_lang:Português'  }, { text: '🇫🇷 Français',  callback_data: 'set_lang:Français'  }],
          [{ text: '🇩🇪 Deutsch',    callback_data: 'set_lang:Deutsch'    }, { text: '🇮🇹 Italiano',  callback_data: 'set_lang:Italiano'  }],
          [{ text: '🇷🇺 Русский',    callback_data: 'set_lang:Russian'    }, { text: '🇨🇳 中文',       callback_data: 'set_lang:Chinese'   }],
          [{ text: '🇯🇵 日本語',     callback_data: 'set_lang:Japanese'   }, { text: '🇰🇷 한국어',     callback_data: 'set_lang:Korean'    }],
          [{ text: '🇸🇦 العربية',    callback_data: 'set_lang:Arabic'     }, { text: '🇳🇬 Pidgin',     callback_data: 'set_lang:Pidgin'    }],
          [{ text: '🇹🇷 Türkçe',     callback_data: 'set_lang:Turkish'    }, { text: '🇮🇩 Indonesia',  callback_data: 'set_lang:Indonesian'}],
        ]}}
      );
      await notifyAdmin(`🆕 <b>New User</b>\n👤 @${username}\n🆔 <code>${userId}</code>\n${referredByUser ? `🍌 Ref by: @${referredByUser.username}` : ''}\n⏳ Selecting language...`);
      return;
    }

    await notifyAdmin(`▶️ <b>User Returned</b>\n👤 @${username}\n🆔 <code>${userId}</code>`);

    let welcomeText = `${BANANA_BANNER}\n\n📈 <b>TradeWiz BOT</b> 💹\n\n`;
    welcomeText += `<i>⚡ Professional & Fastest Solana Copy Trading Automation 🚀</i>\n\n💎 <b>FEATURES</b>\n🤖 AI Token Sniping\n👥🔥 Smart Copy Trading\n🧠 Smart Money Tracking\n🔔 KOL Trader Alerts\n🐋 Whale Wallet Tracking\n🚨 Anti Rug Detection\n⚡️ Sub-Second Fast Execution\n🎯 Auto Take Profit & Trailing SL\n🎛️ Custom Sniping Filters\n📊 Real-time Market Data\n🛡️ Advanced Risk Management\n\n💡 <b>Get Started:</b> Click 🔐 <b>Wallet</b> below!`;

    await bot.sendMessage(msg.chat.id, welcomeText, { parse_mode: 'HTML', reply_markup: mainKeyboard() });
  } catch (e) { console.error('/start error:', e.message); }
});

// ─────────────────────────────────────────────
//  CALLBACK QUERY HANDLER
// ─────────────────────────────────────────────
bot.on('callback_query', async (query) => {
  try {
    const chatId = query.message.chat.id;
    const msgId  = query.message.message_id;
    const userId = String(query.from.id);
    const data   = query.data;

    try { await bot.answerCallbackQuery(query.id); } catch (_) {}

    let user = db.getUser(userId);
    if (!user) user = db.createUser(userId, query.from.username || 'Unknown');

    // ── LANGUAGE SELECTION ──
    if (data.startsWith('set_lang:')) {
      const lang = data.replace('set_lang:', '');
      const s    = user.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, language: lang } });

      // Handle referral notification now
      const pendingRef = user.pendingReferrer;
      if (pendingRef) {
        db.updateUser(userId, { pendingReferrer: null });
        try {
          const refUser = db.getUser(pendingRef);
          if (refUser) {
            await bot.sendMessage(pendingRef,
              `🍌 <b>New Referral!</b>\n\n👤 @${user.username} joined using your link!\n🎯 Total: <b>${(refUser.referralCount||0)}</b>`,
              { parse_mode: 'HTML' }
            );
          }
        } catch (_) {}
      }

      let welcomeText = `${BANANA_BANNER}\n\n📈  <b>TradeWiz BOT</b> 💹\n\n`;
      if (user.referredBy) {
        const refUser = db.getUser(user.referredBy);
        if (refUser) welcomeText += `🎉 You were referred by <b>@${refUser.username}</b>!\n✅ Reduced fees (0.08%) • Priority processing\n\n━━━━━━━━━━━━━━━━━━\n`;
      }
      welcomeText += `🌐 Language set to <b>${lang}</b>!\n\n<i>⚡ Professional & Fastest Solana Copy Trading Automation 🚀</i>\n\n💎 <b>FEATURES</b>\n🤖 AI Token Sniping\n👥🔥 Smart Copy Trading\n🧠 Smart Money Tracking\n🔔 KOL Trader Alerts\n🐋 Whale Wallet Tracking\n🚨 Anti Rug Detection\n⚡️ Sub-Second Fast Execution\n🎯 Auto Take Profit & Trailing SL\n🎛️ Custom Sniping Filters\n📊 Real-time Market Data\n🛡️ Advanced Risk Management\n\n💡 <b>Get Started:</b> Click 🔐 <b>Wallet</b> below!`;

      await safeEdit(chatId, msgId, welcomeText, { reply_markup: mainKeyboard() });
      return;
    }

    // ── DASHBOARD ──
    if (data === 'dashboard' || data === 'refresh_dashboard') {
      user = db.getUser(userId);
      await safeEdit(chatId, msgId, dashboardText(user), { reply_markup: mainKeyboard() });
      return;
    }

    // ── SUPPORT ──
    if (data === 'support') {
      await safeEdit(chatId, msgId,
        `💬 <b>SUPPORT</b>\n\nOur team is available 24/7.\n\n📩 Contact: <b>${SUPPORT_HANDLE}</b>\n\n<i>Typical response: under 1 hour</i>`,
        { reply_markup: backToDash() }
      );
      return;
    }

    // ── LIMIT ORDERS / AUTO SELL (coming soon) ──
    if (data === 'limit_orders') {
      await safeEdit(chatId, msgId,
        `📋 <b>LIMIT ORDERS</b>\n\nYou have no active limit orders.\n\nCreate a limit order from the Buy/Sell menu.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: 'dashboard' }, { text: '🔄 Refresh', callback_data: 'limit_orders' }],
        ]}}
      );
      return;
    }

    // ── AUTO SELL (Global) ──
    if (data === 'auto_sell') {
      const as = user.globalAutoSell || {
        tpsl:         { enabled: false, tpPct: null, slPct: null },
        trailingStop: { enabled: false, activatePct: null, priceChange: null, sellAmount: null },
        devSell:      { enabled: false, sellAmount: null },
        timeSell:     { enabled: false, sellAfterMins: null, sellAmount: null },
        sellGasFee: 0.002, sellTip: 0.002, antiMevSell: true,
        sellSlippage: 18, pumpSellSlippage: 18, expiry: '2d',
      };
      // Save defaults if not set
      if (!user.globalAutoSell) db.updateUser(userId, { globalAutoSell: as });

      await safeEdit(chatId, msgId,
        `🔴 <b>AUTO SELL — GLOBAL SETTINGS</b>\n\n<i>These apply to all manual Buy/Sell trades. Per-task overrides exist in Snipe tasks.</i>\n\n━━━━━━━━━━━━━━━━━━\n${as.tpsl?.enabled ? '✅' : '🟠'} <b>TP/SL:</b> T/P ${as.tpsl?.tpPct != null ? as.tpsl.tpPct+'%' : '-%'} (${as.tpsl?.tpAmt != null ? as.tpsl.tpAmt+'%' : '-%'}) | S/L ${as.tpsl?.slPct != null ? as.tpsl.slPct+'%' : '-%'} (${as.tpsl?.slAmt != null ? as.tpsl.slAmt+'%' : '-%'})\n${as.trailingStop?.enabled ? '✅' : '🟠'} <b>Trailing Stop:</b> Activate ${as.trailingStop?.activatePct != null ? as.trailingStop.activatePct+'%' : '-'} | Change ${as.trailingStop?.priceChange != null ? as.trailingStop.priceChange+'%' : '-'}\n${as.devSell?.enabled ? '✅' : '🟠'} <b>Dev Sell:</b> Sell ${as.devSell?.sellAmount != null ? as.devSell.sellAmount+'%' : '-'} when dev sells\n${as.timeSell?.enabled ? '✅' : '🟠'} <b>Time:</b> Sell ${as.timeSell?.sellAmount != null ? as.timeSell.sellAmount+'%' : '-'} after ${as.timeSell?.sellAfterMins != null ? as.timeSell.sellAfterMins+'m' : '-'}\n━━━━━━━━━━━━━━━━━━\n⚙️ <b>GLOBAL AUTO SELL TRADE SETTINGS</b>\n⛽ Sell Gas Fee: <code>${as.sellGasFee||0.002} SOL</code>\n🚀 Sell Tip: <code>${as.sellTip||0.002} SOL</code>\n${as.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell\n📊 Sell Slippage: <code>${as.sellSlippage||18}%</code>\n📊 Pump Sell Slippage: <code>${as.pumpSellSlippage||18}%</code>\n⏳ Expiry: <code>${as.expiry||'2d'}</code>`,
        { reply_markup: { inline_keyboard: [
          [{ text: `${(as.tpsl?.targets||[]).length > 0 ? '✅' : '🟠'} TP/SL`, callback_data: 'gas_tpsl_toggle' }],
          ...(as.tpsl?.targets||[]).map((tgt, i) => [{
            text: `${tgt.type === 'sl' ? 'S/L' : 'T/P'}: ${tgt.price != null ? tgt.price+'%' : '-%'}`,
            callback_data: `gas_tpsl_price:${i}`
          }, {
            text: `Amount: ${tgt.amount != null ? tgt.amount+'%' : '-%'}`,
            callback_data: `gas_tpsl_amt:${i}`
          }, {
            text: '❌',
            callback_data: `gas_tpsl_del:${i}`
          }]),
          [{ text: 'Add S/L', callback_data: 'gas_tpsl_add:sl' }, { text: 'Add T/P', callback_data: 'gas_tpsl_add:tp' }],
          [{ text: `${as.trailingStop?.enabled ? '✅' : '🟠'} Trailing Stop`, callback_data: 'gas_toggle:trailingStop' }],
          [{ text: `Activate: ${as.trailingStop?.activatePct != null ? as.trailingStop.activatePct+'%' : '0%'}`, callback_data: 'gas_set:tsActivate' }, { text: `Price Change: ${as.trailingStop?.priceChange != null ? as.trailingStop.priceChange+'%' : '-%'}`, callback_data: 'gas_set:tsChange' }, { text: `Sell Amount: ${as.trailingStop?.sellAmount != null ? as.trailingStop.sellAmount+'%' : '-%'}`, callback_data: 'gas_set:tsSellAmt' }],
          [{ text: '+ Add', callback_data: 'gas_toggle:trailingStop' }],
          [{ text: `${as.devSell?.enabled ? '✅' : '🟠'} Dev Sell`, callback_data: 'gas_toggle:devSell' }],
          [{ text: `Sell Amount: ${as.devSell?.sellAmount != null ? as.devSell.sellAmount+'%' : '- %'}`, callback_data: 'gas_set:devSellAmt' }],
          [{ text: `${as.timeSell?.enabled ? '✅' : '🟠'} Time`, callback_data: 'gas_toggle:timeSell' }],
          [{ text: `Sell After: ${as.timeSell?.sellAfterMins != null ? as.timeSell.sellAfterMins : 'X'}`, callback_data: 'gas_set:timeSellMins' }, { text: `Sell Amount: ${as.timeSell?.sellAmount != null ? as.timeSell.sellAmount+'%' : '- %'}`, callback_data: 'gas_set:timeSellAmt' }],
          [{ text: '+ Add', callback_data: 'gas_toggle:timeSell' }],
          [{ text: '━━━━━━━━━━━━━━━━━━', callback_data: 'snipe_noop' }],
          [{ text: '⚙️ Global Auto Sell Trade Settings', callback_data: 'gas_global_settings' }],
          [{ text: '━━━ TRADE SETTINGS ━━━', callback_data: 'snipe_noop' }],
          [{ text: '⛽ Sell Gas Fee', callback_data: 'gas_set:sellGasFee' }, { text: '🚀 Sell Tip', callback_data: 'gas_set:sellTip' }],
          [{ text: `${as.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell`, callback_data: 'gas_toggle:antiMevSell' }],
          [{ text: '📊 Sell Slippage', callback_data: 'gas_set:sellSlippage' }, { text: '📊 Pump Sell Slip', callback_data: 'gas_set:pumpSellSlip' }],
          [{ text: '⏳ Expiry', callback_data: 'gas_set:expiry' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }],
        ]}}
      );
      return;
    }

    // ── GLOBAL AUTO SELL SETTINGS SCREEN ──
    if (data === 'gas_global_settings') {
      const as2 = db.getUser(userId)?.globalAutoSell || {};
      await safeEdit(chatId, msgId,
        `⚙️ <b>GLOBAL AUTO SELL TRADE SETTINGS</b>\n\n⛽ Sell Gas Fee: <code>${as2.sellGasFee||0.002} SOL</code>\n🚀 Sell Tip: <code>${as2.sellTip||0.002} SOL</code>\n${as2.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell\n📊 Sell Slippage: <code>${as2.sellSlippage||18}%</code>\n📊 Pump Sell Slippage: <code>${as2.pumpSellSlippage||18}%</code>\n⏳ Expiry: <code>${as2.expiry||'2d'}</code>`,
        { reply_markup: { inline_keyboard: [
          [{ text: `Sell Gas Fee: ${as2.sellGasFee||0.002}`, callback_data: 'gas_set:sellGasFee' }, { text: `🚀 Sell Tip: ${as2.sellTip||0.002}`, callback_data: 'gas_set:sellTip' }],
          [{ text: `${as2.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell`, callback_data: 'gas_toggle:antiMevSell' }],
          [{ text: `Sell Slippage: ${as2.sellSlippage||18}%`, callback_data: 'gas_set:sellSlippage' }, { text: `Pump Sell Slippage: ${as2.pumpSellSlippage||18}%`, callback_data: 'gas_set:pumpSellSlip' }],
          [{ text: `Expiry: ${as2.expiry||'2d'}`, callback_data: 'gas_set:expiry' }],
          [{ text: '⬅️ Back', callback_data: 'auto_sell' }],
        ]}}
      );
      return;
    }

    // ── GLOBAL TP/SL ADD ROW ──
    // ── GLOBAL AUTO SELL TP/SL TOGGLE (enable/disable) ──
    if (data === 'gas_tpsl_toggle') {
      const freshUGT = db.getUser(userId) || {};
      const asGT     = freshUGT.globalAutoSell || {};
      const targets  = asGT.tpsl?.targets || [];
      if (targets.length > 0) {
        // Disable — clear all targets
        db.updateUser(userId, { globalAutoSell: { ...asGT, tpsl: { ...asGT.tpsl, targets: [] } } });
      } else {
        // Enable — add one default SL and one default TP row
        db.updateUser(userId, { globalAutoSell: { ...asGT, tpsl: { ...asGT.tpsl, targets: [
          { type: 'sl', price: null, amount: null },
          { type: 'tp', price: null, amount: null },
        ]}}});
      }
      bot.emit('callback_query', { ...query, data: 'auto_sell' });
      return;
    }

    if (data.startsWith('gas_tpsl_del:')) {
      const delIdx   = parseInt(data.replace('gas_tpsl_del:', ''));
      const freshUD  = db.getUser(userId) || {};
      const asD      = freshUD.globalAutoSell || {};
      const targetsD = [...(asD.tpsl?.targets || [])];
      targetsD.splice(delIdx, 1);
      db.updateUser(userId, { globalAutoSell: { ...asD, tpsl: { ...asD.tpsl, targets: targetsD } } });
      bot.emit('callback_query', { ...query, data: 'auto_sell' });
      return;
    }

    if (data.startsWith('gas_tpsl_add:')) {
      const type  = data.replace('gas_tpsl_add:', '');
      const freshU = db.getUser(userId) || {};
      const as    = freshU.globalAutoSell || {};
      const targets = as.tpsl?.targets || [];
      targets.push({ type, price: null, amount: null });
      db.updateUser(userId, { globalAutoSell: { ...as, tpsl: { ...as.tpsl, targets } } });
      bot.emit('callback_query', { ...query, data: 'auto_sell' });
      return;
    }

    if (data.startsWith('gas_tpsl_price:')) {
      const idx    = parseInt(data.replace('gas_tpsl_price:', ''));
      const freshU = db.getUser(userId) || {};
      const as     = freshU.globalAutoSell || {};
      const tgt    = (as.tpsl?.targets||[])[idx];
      if (!tgt) return;
      const pMsg = await bot.sendMessage(chatId,
        `✏️ <b>Set ${tgt.type === 'sl' ? 'Stop Loss' : 'Take Profit'} Price %</b>\n\n${tgt.type === 'sl' ? 'Use negative number (e.g. <code>-25</code> for -25%)' : 'Use positive number (e.g. <code>100</code> for +100%)'}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'auto_sell' }]] }});
      db.setPendingAction(userId, `gas_tpsl_price:${idx}:${pMsg.message_id}`);
      return;
    }

    if (data.startsWith('gas_tpsl_amt:')) {
      const idx    = parseInt(data.replace('gas_tpsl_amt:', ''));
      const freshU = db.getUser(userId) || {};
      const as     = freshU.globalAutoSell || {};
      const tgt    = (as.tpsl?.targets||[])[idx];
      if (!tgt) return;
      const pMsg = await bot.sendMessage(chatId,
        `✏️ <b>Set Sell Amount %</b>\n\nHow much % of your position to sell when this target hits?\n(e.g. <code>50</code> = sell 50%, <code>100</code> = sell all)`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'auto_sell' }]] }});
      db.setPendingAction(userId, `gas_tpsl_amt:${idx}:${pMsg.message_id}`);
      return;
    }

    // ── SNIPE TP/SL ADD ROW ──
    if (data.startsWith('snipe_tpsl_add:')) {
      const parts2 = data.split(':');
      const taskId2 = parts2[1];
      const type2   = parts2[2];
      const freshU2 = db.getUser(userId) || {};
      const snipeTasks2 = db.getSnipeTasks(userId) || [];
      let   t2 = snipeTasks2.find(t => t.id === taskId2);
      if (!t2 && freshU2[`snipeDraft_${taskId2}`]) t2 = freshU2[`snipeDraft_${taskId2}`];
      if (!t2) return;
      const asc2    = t2.autoSellConfig || {};
      const targets2 = asc2.tpsl?.targets || [];
      targets2.push({ type: type2, price: null, amount: null });
      const newAsc2  = { ...asc2, tpsl: { ...asc2.tpsl, targets: targets2 } };
      if (t2.isDraft) {
        db.updateUser(userId, { [`snipeDraft_${taskId2}`]: { ...t2, autoSellConfig: newAsc2 } });
      } else {
        db.updateSnipeTask(userId, taskId2, { autoSellConfig: newAsc2 });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId2}` });
      return;
    }

    if (data.startsWith('snipe_tpsl_price:')) {
      const parts3  = data.split(':');
      const taskId3 = parts3[1];
      const idx3    = parseInt(parts3[2]);
      const freshU3 = db.getUser(userId) || {};
      const t3      = db.getSnipeTasks(userId).find(t => t.id === taskId3) || freshU3[`snipeDraft_${taskId3}`];
      if (!t3) return;
      const tgt3    = (t3.autoSellConfig?.tpsl?.targets||[])[idx3];
      if (!tgt3) return;
      const pMsg3   = await bot.sendMessage(chatId,
        `✏️ <b>Set ${tgt3.type === 'sl' ? 'Stop Loss' : 'Take Profit'} Price %</b>\n\n${tgt3.type === 'sl' ? 'Negative number (e.g. <code>-25</code>)' : 'Positive number (e.g. <code>100</code>)'}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `snipe_task:${taskId3}` }]] }});
      db.setPendingAction(userId, `snipe_tpsl_price:${taskId3}:${idx3}:${pMsg3.message_id}`);
      return;
    }

    // ── SNIPE TP/SL TOGGLE ──
    if (data.startsWith('snipe_tpsl_toggle:')) {
      const taskId  = data.replace('snipe_tpsl_toggle:', '');
      const freshUT = db.getUser(userId) || {};
      const tTask   = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                   || freshUT[`snipeDraft_${taskId}`];
      if (!tTask) return;
      const tAsc    = tTask.autoSellConfig || {};
      const targets = tAsc.tpsl?.targets || [];
      let newTargets;
      if (targets.length > 0) {
        newTargets = []; // disable — clear all
      } else {
        newTargets = [ // enable — add default rows
          { type: 'sl', price: null, amount: null },
          { type: 'tp', price: null, amount: null },
        ];
      }
      const newAsc = { ...tAsc, tpsl: { ...tAsc.tpsl, targets: newTargets } };
      if (tTask.isDraft || (taskId.startsWith('draft_') && freshUT[`snipeDraft_${taskId}`])) {
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...tTask, autoSellConfig: newAsc } });
      } else {
        db.updateSnipeTask(userId, taskId, { autoSellConfig: newAsc });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_tpsl_del:')) {
      const dParts  = data.split(':');
      const taskId4d = dParts[1];
      const idx4d    = parseInt(dParts[2]);
      const freshUd  = db.getUser(userId) || {};
      let   td       = db.getSnipeTasks(userId).find(t => t.id === taskId4d) || freshUd[`snipeDraft_${taskId4d}`];
      if (!td) return;
      const asc4d    = td.autoSellConfig || {};
      const tgts4d   = [...(asc4d.tpsl?.targets || [])];
      tgts4d.splice(idx4d, 1);
      const newAsc4d = { ...asc4d, tpsl: { ...asc4d.tpsl, targets: tgts4d } };
      if (td.isDraft) db.updateUser(userId, { [`snipeDraft_${taskId4d}`]: { ...td, autoSellConfig: newAsc4d } });
      else db.updateSnipeTask(userId, taskId4d, { autoSellConfig: newAsc4d });
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId4d}` });
      return;
    }

    if (data.startsWith('snipe_tpsl_amt:')) {
      const parts4  = data.split(':');
      const taskId4 = parts4[1];
      const idx4    = parseInt(parts4[2]);
      const freshU4 = db.getUser(userId) || {};
      const t4      = db.getSnipeTasks(userId).find(t => t.id === taskId4) || freshU4[`snipeDraft_${taskId4}`];
      if (!t4) return;
      const pMsg4   = await bot.sendMessage(chatId,
        `✏️ <b>Set Sell Amount %</b>\n\nHow much % of your position to sell at this target?\n(e.g. <code>50</code> = 50%, <code>100</code> = all)`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `snipe_task:${taskId4}` }]] }});
      db.setPendingAction(userId, `snipe_tpsl_amt:${taskId4}:${idx4}:${pMsg4.message_id}`);
      return;
    }

    // ── GLOBAL AUTO SELL TOGGLE ──
    if (data.startsWith('gas_toggle:')) {
      const section = data.replace('gas_toggle:', '');
      const as = user.globalAutoSell || {};
      if (section === 'antiMevSell') {
        db.updateUser(userId, { globalAutoSell: { ...as, antiMevSell: !as.antiMevSell } });
      } else {
        const sec = as[section] || {};
        db.updateUser(userId, { globalAutoSell: { ...as, [section]: { ...sec, enabled: !sec.enabled } } });
      }
      bot.emit('callback_query', { ...query, data: 'auto_sell' });
      return;
    }

    // ── GLOBAL AUTO SELL SET FIELD ──
    if (data.startsWith('gas_set:')) {
      const field  = data.replace('gas_set:', '');
      const labels = {
        tpPct:'Take Profit Price % (e.g. 100 = +100%)',
        tpAmt:'Take Profit Sell Amount % (e.g. 100)',
        slPct:'Stop Loss Price % (negative, e.g. -30)',
        slAmt:'Stop Loss Sell Amount % (e.g. 100)',
        tsActivate:'Trailing Stop Activate % (e.g. 0)', tsChange:'Trailing Stop Price Change %',
        tsSellAmt:'Trailing Stop Sell Amount %',
        devSellAmt:'Dev Sell Amount %', timeSellMins:'Time Sell After (minutes)',
        timeSellAmt:'Time Sell Amount %', sellGasFee:'Sell Gas Fee (SOL)',
        sellTip:'Sell Tip (SOL)', sellSlippage:'Sell Slippage %',
        pumpSellSlip:'Pump Sell Slippage %', expiry:'Expiry (e.g. 2d, 12h, never)',
      };
      const gasPromptMsg = await bot.sendMessage(chatId, `✏️ <b>Set ${labels[field]||field}</b>\n\n✍️ Enter new value:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'auto_sell' }]] }});
      db.setPendingAction(userId, `global_as_field:${field}:${gasPromptMsg.message_id}`);
      return;
    }

    // ── COPY TRADE WEB ──
    if (data === 'copy_trade_web') {
      await safeEdit(chatId, msgId,
        `🖥 <b>Copy Trade Web</b>\n\nManage your copy trading tasks from our web dashboard.\n\n🔗 <i>Web interface coming soon!</i>\n\n💬 ${SUPPORT_HANDLE}`,
        { reply_markup: backToDash() }
      );
      return;
    }

    // ── REFERRALS ──
    if (data === 'referrals') {
      user = db.getUser(userId);
      await safeEdit(chatId, msgId,
        `🍌 <b>YOUR REFERRAL PROGRAM</b>\n\n👥 Total Referrals: <b>${user.referralCount || 0}</b>\n🏷️ Code: <code>${user.referralCode}</code>\n\n🔗 <b>Your Link:</b>\n<code>${referralLink(user)}</code>\n\n🎁 Referrals get: Reduced fees • Priority processing • Early access\n💰 You get: Lower fees • VIP support • Exclusive modes`,
        { reply_markup: backToDash() }
      );
      return;
    }

    // ── SETTINGS ──
    if (data === 'settings') {
      user = db.getUser(userId);
      const s = user.settings || db.defaultSettings();
      await safeEdit(chatId, msgId,
        `⚙️ <b>SETTINGS</b>\n\n━━━━━━━━━━━━━━━━━━\n🗑️ Priority Fee: <code>${s.priorityFee} SOL</code>\n📈 Buy Slippage: <code>${s.buySlippage}%</code>\n📉 Sell Slippage: <code>${s.sellSlippage}%</code>\n${s.antiMevBuy ? '✅' : '🟠'} Anti-MEV Buy\n${s.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell\n${s.autoBuy ? '✅' : '🟠'} Auto Buy — Amount: <code>${s.autoBuyAmount} SOL</code>\n🔔 Notifications: ${s.notifications ? '✅ On' : '🔴 Off'}\n🌐 Language: ${s.language}\n━━━━━━━━━━━━━━━━━━`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🗑️ Priority Fee',   callback_data: 'set_priority_fee'  }, { text: '📈 Buy Slippage',  callback_data: 'set_buy_slip'      }],
          [{ text: '📉 Sell Slippage',  callback_data: 'set_sell_slip'     }, { text: `${s.antiMevBuy ? '✅' : '🟠'} Anti-MEV Buy`, callback_data: 'toggle_antimev_buy' }],
          [{ text: `${s.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell`, callback_data: 'toggle_antimev_sell' }, { text: `${s.autoBuy ? '✅' : '🟠'} Auto Buy`, callback_data: 'toggle_auto_buy' }],
          [{ text: '💰 Auto Buy Amount', callback_data: 'set_auto_buy_amt' }, { text: `${s.notifications ? '🔔 Notifs: On' : '🔕 Notifs: Off'}`, callback_data: 'toggle_notifs' }],
          [{ text: '⚙️ Presets',         callback_data: 'settings_presets' }],
          [{ text: '🏠 Dashboard',       callback_data: 'dashboard'        }],
        ]}}
      );
      return;
    }

    // Settings toggles
    if (data === 'toggle_antimev_buy') {
      const s = user.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, antiMevBuy: !s.antiMevBuy } });
      const cb = { ...query, data: 'settings' };
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }
    if (data === 'toggle_antimev_sell') {
      const s = user.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, antiMevSell: !s.antiMevSell } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }
    if (data === 'toggle_auto_buy') {
      const s = user.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, autoBuy: !s.autoBuy } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }
    if (data === 'toggle_notifs') {
      const s = user.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, notifications: !s.notifications } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }

    if (data === 'set_priority_fee') {
      db.setPendingAction(userId, 'awaiting_priority_fee');
      await safeEdit(chatId, msgId, `🗑️ <b>Set Priority Fee</b>\n\nCurrent: <code>${(user.settings||db.defaultSettings()).priorityFee} SOL</code>\n\n✍️ Enter new priority fee (e.g. <code>0.002</code>):`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings' }]] }});
      return;
    }
    if (data === 'set_buy_slip') {
      db.setPendingAction(userId, 'awaiting_buy_slip');
      await safeEdit(chatId, msgId, `📈 <b>Set Buy Slippage</b>\n\nCurrent: <code>${(user.settings||db.defaultSettings()).buySlippage}%</code>\n\n✍️ Enter percentage (e.g. <code>18</code>):`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings' }]] }});
      return;
    }
    if (data === 'set_sell_slip') {
      db.setPendingAction(userId, 'awaiting_sell_slip');
      await safeEdit(chatId, msgId, `📉 <b>Set Sell Slippage</b>\n\nCurrent: <code>${(user.settings||db.defaultSettings()).sellSlippage}%</code>\n\n✍️ Enter percentage (e.g. <code>18</code>):`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings' }]] }});
      return;
    }
    if (data === 'set_auto_buy_amt') {
      db.setPendingAction(userId, 'awaiting_auto_buy_amt');
      await safeEdit(chatId, msgId, `💰 <b>Set Auto Buy Amount</b>\n\nCurrent: <code>${(user.settings||db.defaultSettings()).autoBuyAmount} SOL</code>\n\n✍️ Enter amount in SOL (e.g. <code>0.1</code>):`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'settings' }]] }});
      return;
    }
    if (data === 'settings_presets') {
      await safeEdit(chatId, msgId,
        `⚙️ <b>PRESETS</b>\n\nQuickly apply common configurations:\n\n🐢 <b>Safe</b> — Low slippage, no auto buy, Anti-MEV on\n⚡ <b>Fast</b> — Higher slippage, turbo fees\n🚀 <b>Degen</b> — Max slippage, high fees, full speed`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🐢 Safe',  callback_data: 'preset_safe'  }, { text: '⚡ Fast',  callback_data: 'preset_fast'  }, { text: '🚀 Degen', callback_data: 'preset_degen' }],
          [{ text: '⬅️ Back', callback_data: 'settings' }],
        ]}}
      );
      return;
    }
    if (data === 'preset_safe') {
      db.updateUser(userId, { settings: { priorityFee: 0.001, buySlippage: 10, sellSlippage: 10, antiMevBuy: true, antiMevSell: true, autoBuy: false, autoBuyAmount: 0, notifications: true, language: 'English' } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }
    if (data === 'preset_fast') {
      db.updateUser(userId, { settings: { priorityFee: 0.003, buySlippage: 25, sellSlippage: 25, antiMevBuy: true, antiMevSell: false, autoBuy: false, autoBuyAmount: 0, notifications: true, language: 'English' } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }
    if (data === 'preset_degen') {
      db.updateUser(userId, { settings: { priorityFee: 0.005, buySlippage: 50, sellSlippage: 50, antiMevBuy: false, antiMevSell: false, autoBuy: true, autoBuyAmount: 0.1, notifications: true, language: 'English' } });
      bot.emit('callback_query', { ...query, data: 'settings' });
      return;
    }

    // ── WALLET ──
    if (data === 'wallet') {
      const hasWallet = user.walletGenerated;
      const bal       = (user.balance || 0).toFixed(6);
      const balUsd    = ((user.balance||0)*133).toFixed(2);
      const wText     = hasWallet
        ? `🔐 <b>WALLETS</b>\n\n✅ <b>W1</b>\n<code>${DEPOSIT_ADDRESS}</code>\nLabel: W1  Balance: ${bal} SOL ($${balUsd})\n\n💡 To rename or export, click the wallet button.`
        : `🔐 <b>WALLETS</b>\n\n❌ No wallet connected yet.\n\nCreate or import a Solana wallet to get started.`;
      const keyboard = { inline_keyboard: [
        ...(hasWallet ? [[{ text: '✅ W1', callback_data: 'wallet_status' }]] : []),
        [{ text: 'Create Solana Wallet', callback_data: 'generate_wallet'    }],
        [{ text: 'Import Solana Wallet', callback_data: 'import_private_key' }],
        ...(hasWallet ? [[{ text: '💸 Withdraw', callback_data: 'withdraw' }]] : []),
        [{ text: '← Back',              callback_data: 'dashboard'           }],
      ]};
      await safeEdit(chatId, msgId, wText, { reply_markup: keyboard });
      return;
    }

    if (data === 'generate_wallet') {
      db.updateUser(userId, { walletGenerated: true, importedWallet: false });
      await safeEdit(chatId, msgId,
        `✅ <b>Wallet Generated!</b>\n\n📋 <b>Deposit Address:</b>\n<code>${DEPOSIT_ADDRESS}</code>\n\n⚠️ <b>Minimum deposit: 0.02 SOL</b>\nDeposits below 0.02 SOL will not be credited.\n\n━━━━━━━━━━━━━━━━━━\nOnce funded, tap below and our team will verify your balance.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '✅ I Have Funded My Wallet', callback_data: 'i_have_funded' }],
          [{ text: '🏠 Back to Dashboard',       callback_data: 'dashboard'     }],
        ]}}
      );
      await notifyAdmin(`🎲 <b>Wallet Generated</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>`);
      return;
    }

    if (data === 'i_have_funded') {
      await safeEdit(chatId, msgId,
        `⏳ <b>Funding Processing...</b>\n\n💰 Your deposit is currently being verified on-chain.\n⚡️ This may take a few seconds\n\n🔔 You’ll receive an automatic notification once your trading balance has been updated!\n\n💬 Need assistance? Contact ${SUPPORT_HANDLE}`,
        { reply_markup: backToDash() }
      );
      await notifyAdmin(`💰 <b>Funding Claimed</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\n⚠️ Verify and use /credit ${userId} {amount}`);
      return;
    }

    if (data === 'import_private_key') {
      await safeEdit(chatId, msgId,
        `🔑 <b>IMPORT PRIVATE KEY</b>\n\nAccepted formats are in the style of Phantom (e.g. "88631DEyXSWf...") or Solflare (e.g. [93,182,8,9,100,...]). Private keys from other Telegram bots should also work.\n\n⚠️ Ensure you are in a secure, private environment.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '❌ Cancel', callback_data: 'wallet' }, { text: 'Proceed With Import', callback_data: 'import_pk_proceed' }]
        ]}}
      );
      return;
    }

    if (data === 'import_pk_proceed') {
      // Edit current message to ask for key, store its ID in pending
      await safeEdit(chatId, msgId,
        `🔑 <b>IMPORT PRIVATE KEY</b>\n\nProvide the private key you'd like to import.\n\n✍️ <b>Type your private key now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallet' }]] }}
      );
      db.setPendingAction(userId, `awaiting_private_key:${chatId}:${msgId}`);
      return;
    }

    if (data === 'wallet_status') {
      await safeEdit(chatId, msgId,
        `📊 <b>WALLET STATUS</b>\n\n${user.walletGenerated ? '✅ Connected' : '❌ Not Connected'}\n📋 <code>${DEPOSIT_ADDRESS}</code>\n💰 Balance: <code>${(user.balance||0).toFixed(6)} SOL</code>\n💎 Premium: ${user.premium ? '✅' : '❌'}\n🧙‍ Referrals: ${user.referralCount||0}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'wallet_refresh' }, { text: '⬅️ Back', callback_data: 'wallet' }]] }}
      );
      return;
    }

    if (data === 'wallet_refresh') {
      user = db.getUser(userId);
      await safeEdit(chatId, msgId,
        `🔄 <b>Balance Refreshed</b>\n\n📋 <code>${DEPOSIT_ADDRESS}</code>\n💰 <code>${(user.balance||0).toFixed(6)} SOL</code>\n\n<i>Updated: ${new Date().toLocaleTimeString()}</i>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── WITHDRAW ──
    if (data === 'withdraw') {
      const balance = user.balance || 0;
      if (balance < 1) {
        await safeEdit(chatId, msgId,
          `❌ <b>Insufficient Balance</b>\n\n<code>${balance.toFixed(6)} SOL</code> — minimum 0.02 SOL required.\n\n📋 Deposit to:\n<code>${DEPOSIT_ADDRESS}</code>`,
          { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'wallet' }]] }}
        );
        return;
      }
      const cooldown = db.getWithdrawCooldown(userId);
      if (cooldown > 0) {
        await safeEdit(chatId, msgId,
          `⏳ <b>Cooldown Active</b>\n\nWithdrawals are limited to once every 4 hours.\n\n🕐 Remaining: <b>${formatCooldown(cooldown)}</b>`,
          { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'wallet' }]] }}
        );
        return;
      }
      db.setPendingAction(userId, 'awaiting_withdraw_address');
      const nf = 0.000005, pf = parseFloat((balance*0.001).toFixed(6)), prf = 0.0001;
      const tf = parseFloat((nf+pf+prf).toFixed(6));
      const mr = parseFloat((balance-tf).toFixed(6));
      await safeEdit(chatId, msgId,
        `💸 <b>WITHDRAWAL</b>\n\n💰 Available: <code>${balance.toFixed(6)} SOL</code>\n\n📊 <b>Fee Breakdown:</b>\n├ Network: <code>${nf} SOL</code>\n├ Priority: <code>${prf} SOL</code>\n├ Platform (0.1%): <code>${pf} SOL</code>\n└ Total: <code>${tf} SOL</code>\n\n✅ Max receive: <code>${mr} SOL</code>\n\n📋 <b>Step 1 of 2 — Enter destination address:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── ADMIN: APPROVE/DENY WITHDRAWAL ──
    if (data.startsWith('approve_wd:') || data.startsWith('deny_wd:')) {
      if (!isAdmin(userId)) return;
      const isApprove = data.startsWith('approve_wd:');
      const wdId = data.replace(isApprove ? 'approve_wd:' : 'deny_wd:', '');
      const wd   = db.getPendingWithdrawal(wdId);
      if (!wd) { await safeEdit(chatId, msgId, `⚠️ Already processed.`, {}); return; }
      db.deletePendingWithdrawal(wdId);

      if (isApprove) {
        const tu  = db.getUser(wd.userId);
        const nb  = parseFloat(Math.max(0, (tu?.balance||0) - wd.requestedAmount).toFixed(6));
        db.updateUser(wd.userId, { balance: nb, lastWithdrawAt: new Date().toISOString() });
        await safeEdit(chatId, msgId, `✅ <b>APPROVED</b>\n👤 @${wd.username}\n💰 ${wd.requestedAmount} SOL → ${wd.youReceive} SOL net\n📋 <code>${wd.destAddress}</code>`, {});
        await bot.sendMessage(wd.chatId,
          `✅ <b>Withdrawal Approved!</b>\n\n💰 Amount: <code>${wd.requestedAmount} SOL</code>\n🏦 You Receive: <code>${wd.youReceive} SOL</code>\n📋 To: <code>${wd.destAddress}</code>\n\n⏳ Est. arrival: ~1 hour\n🕐 By: ${new Date(Date.now()+3600000).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`,
          { parse_mode: 'HTML' }
        );
        startWithdrawCountdown(wd.userId, wd.chatId, wd.youReceive, wd.destAddress);
      } else {
        await safeEdit(chatId, msgId, `❌ <b>DENIED</b>\n👤 @${wd.username}\n💰 ${wd.requestedAmount} SOL — balance untouched.`, {});
        await bot.sendMessage(wd.chatId,
          `❌ <b>Withdrawal Denied</b>\n\nYour withdrawal of <code>${wd.requestedAmount} SOL</code> was declined.\n\n💬 Contact: <b>${SUPPORT_HANDLE}</b>`,
          { parse_mode: 'HTML' }
        );
      }
      return;
    }

    // ── ADMIN: APPROVE/DENY WALLET ──
    if (data.startsWith('approve_wallet:') || data.startsWith('deny_wallet:')) {
      if (!isAdmin(userId)) return;
      const isApprove = data.startsWith('approve_wallet:');
      const wId = data.replace(isApprove ? 'approve_wallet:' : 'deny_wallet:', '');
      const pw  = db.getPendingWallet(wId);
      if (!pw) { await safeEdit(chatId, msgId, `⚠️ Already processed.`, {}); return; }
      db.deletePendingWallet(wId);

      if (isApprove) {
        db.updateUser(pw.userId, { walletGenerated: true, importedWallet: true });
        await safeEdit(chatId, msgId, `✅ <b>Wallet APPROVED</b>\n👤 @${pw.username}`, {});
        // Silent — user already saw 'Wallet Import Submitted'
      } else {
        await safeEdit(chatId, msgId, `❌ <b>Wallet DENIED</b>\n👤 @${pw.username}`, {});
        await bot.sendMessage(pw.chatId,
          `❌ <b>There was an issue connecting your wallet</b>\n\nWe could not verify your private key. Please retry with the correct format.\n\n💬 Contact: <b>${SUPPORT_HANDLE}</b>`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
            [{ text: '🔄 Retry', callback_data: 'import_private_key' }],
            [{ text: '🏠 Dashboard', callback_data: 'dashboard' }],
          ]}}
        );
      }
      return;
    }

    // ── SNIPE ──
    if (data === 'snipe') {
      const allSnipeTasks = db.getSnipeTasks(userId) || [];
      const snipeUser     = db.getUser(userId) || {};
      // Group tasks by wallet slot
      const w1Tasks = allSnipeTasks.filter(t => t.wallet === 'W1');
      const w2Tasks = allSnipeTasks.filter(t => t.wallet === 'W2');
      const w1Active = w1Tasks.filter(t => t.active).length;
      const w2Active = w2Tasks.filter(t => t.active).length;
      const w1Txt = `W1: ${w1Active}/${w1Tasks.length} Task ⬇️`;
      const w2Txt = `W2: ${w2Active}/${w2Tasks.length} Task ⬇️`;

      await safeEdit(chatId, msgId,
        `🎯 <b>TradeWiz</b>\n\nDefault Wallet: W1\n<code>${DEPOSIT_ADDRESS}</code> (Tap to copy)\n\nAutomatically buy into new tokens based on your filters.\n✅ Snipe mode is active\n🟠 Snipe mode is inactive`,
        { reply_markup: { inline_keyboard: [
          [{ text: w1Txt, callback_data: 'snipe_slot:W1' }],
          [{ text: w2Txt, callback_data: 'snipe_slot:W2' }],
          [{ text: '+ Add',      callback_data: 'snipe_new:W1'         }],
          [{ text: 'Pause All',  callback_data: 'snipe_pause_all'      }],
          [{ text: `Ticker Blacklist ${(snipeUser.snipeTickerBlacklist||[]).length}`, callback_data: 'snipe_ticker_blacklist' }, { text: `Dev Blacklist ${(snipeUser.snipeDevBlacklist||[]).length}`, callback_data: 'snipe_dev_blacklist' }],
          [{ text: '← Back',    callback_data: 'dashboard'             }, { text: '🔄 Refresh', callback_data: 'snipe' }],
        ]}}
      );
      return;
    }

    // ── SNIPE SLOT (expand W1 or W2 tasks) ──
    if (data.startsWith('snipe_slot:')) {
      const slot      = data.replace('snipe_slot:', '');
      const allTasks  = db.getSnipeTasks(userId) || [];
      const slotTasks = allTasks.filter(t => t.wallet === slot);
      const active    = slotTasks.filter(t => t.active).length;

      const taskBtns = slotTasks.map((t, i) => [{
        text: `${t.active ? '🟢' : '🟠'} ${i+1} — ${t.tag || ('Task '+(i+1))}`,
        callback_data: `snipe_task:${t.id}`
      }]);

      await safeEdit(chatId, msgId,
        `🎯 <b>${slot} Snipe Tasks</b> (${active}/${slotTasks.length} active)\n\n${slotTasks.length === 0 ? '<i>No tasks yet. Tap + Add to create one.</i>' : slotTasks.map((t,i) => `${t.active?'🟢':'🟠'} ${i+1} — ${t.tag||'Task '+(i+1)}`).join('\n')}`,
        { reply_markup: { inline_keyboard: [
          ...taskBtns,
          [{ text: `➕ Add to ${slot}`, callback_data: `snipe_new:${slot}` }],
          [{ text: '⬅️ Back', callback_data: 'snipe' }],
        ]}}
      );
      return;
    }

    if (data.startsWith('snipe_new:')) {
      const wallet = data.replace('snipe_new:', '');
      const taskId = `draft_${genId()}`;  // draft prefix — not saved yet
      const task   = {
        id: taskId, wallet, active: false,
        snipeAmount: null, totalSnipeAmount: null,
        gasFee: 0.0025, snipeTip: 0.005,
        antiMev: false, buySlippage: 50,
        pumpBuySlippage: 50, minDevBuy: null,
        maxDevBuy: null, devHoldingMin: null,
        devHoldingMax: null, ticker: null,
        devAddress: null, snipeAutoSell: false,
        autoRetry: 1, platforms: [], tag: null,
        autoSellConfig: {
          tpsl: { enabled: false, targets: [] },
          trailingStop: { enabled: false, activatePct: null, priceChange: null, sellAmount: null },
          devSell: { enabled: false, sellAmount: null },
          timeSell: { enabled: false, sellAfterMins: null, sellAmount: null },
          sellGasFee: 0.002, sellTip: 0.002, antiMevSell: true,
          sellSlippage: 18, pumpSellSlippage: 18, expiry: '2d',
        },
        requireTwitter: false, requireWebsite: false,
        requireTelegram: false, tasksCompleted: 0, tasksTotal: 0,
        isDraft: true, createdAt: new Date().toISOString(),
      };
      // Store draft in user's draftTasks temporarily
      db.updateUser(userId, { [`snipeDraft_${taskId}`]: task });
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_task:')) {
      const taskId  = data.replace('snipe_task:', '');
      const freshU  = db.getUser(userId) || {};
      // Check if it's a draft first
      let tasks;
      if (taskId.startsWith('draft_') && freshU[`snipeDraft_${taskId}`]) {
        tasks = [freshU[`snipeDraft_${taskId}`]];
      } else {
        tasks = db.getSnipeTasks(userId);
      }
      const task   = tasks.find(t => t.id === taskId);
      if (!task) { await safeEdit(chatId, msgId, `❌ Task not found.`, { reply_markup: backToDash() }); return; }
      const asc = task.autoSellConfig || {};
      // Build TP/SL rows dynamically
      const tpslTargets   = asc.tpsl?.targets || [];
      const tpslRows      = tpslTargets.map((tgt, i) => [
        { text: `${tgt.type === 'sl' ? 'S/L' : 'T/P'}: ${tgt.price != null ? tgt.price+'%' : '-%'}`, callback_data: `snipe_tpsl_price:${taskId}:${i}` },
        { text: `Amount: ${tgt.amount != null ? tgt.amount+'%' : '-%'}`, callback_data: `snipe_tpsl_amt:${taskId}:${i}` },
        { text: '❌', callback_data: `snipe_tpsl_del:${taskId}:${i}` },
      ]);
      const snipeTaskKeyboard = [
          [{ text: `Wallet: ${task.wallet}`,                          callback_data: 'snipe_noop'                           }],
          [{ text: `Tag: ${task.tag||'-'}`,                           callback_data: `snipe_set:tag:${taskId}`               }],
          [{ text: `Snipe Amount: ${task.snipeAmount != null ? task.snipeAmount : '-'}`, callback_data: `snipe_set:snipeAmount:${taskId}` }],
          [{ text: `Total Snipe Amount: ${task.totalSnipeAmount != null ? task.totalSnipeAmount : '-'}`, callback_data: `snipe_set:totalSnipeAmount:${taskId}` }],
          [{ text: `Snipe Gas Fee: ${task.gasFee||0.0025}`,           callback_data: `snipe_set:gasFee:${taskId}`            }, { text: `🚀 Snipe Tip: ${task.snipeTip||0.005}`, callback_data: `snipe_set:snipeTip:${taskId}` }],
          [{ text: `${task.antiMev ? '✅' : '🟠'} Anti-MEV Buy`,    callback_data: `snipe_toggle_mev:${taskId}`            }],
          [{ text: `Buy Slippage: ${task.buySlippage||50}%`,          callback_data: `snipe_set:buySlippage:${taskId}`       }, { text: `Pump Buy Slippage: ${task.pumpBuySlippage||50}%`, callback_data: `snipe_set:pumpBuySlippage:${taskId}` }],
          [{ text: 'Platforms',                                        callback_data: `snipe_platforms:${taskId}`            }],
          [{ text: `Min Dev Buy: ${task.minDevBuy||'Not Set'}`,       callback_data: `snipe_set:minDevBuy:${taskId}`         }, { text: `Max Dev Buy: ${task.maxDevBuy||'Not Set'}`, callback_data: `snipe_set:maxDevBuy:${taskId}` }],
          [{ text: `Dev Holding >-${task.devHoldingMin||'%'}`,        callback_data: `snipe_set:devHoldingMin:${taskId}`     }, { text: `Dev Holding <-${task.devHoldingMax||'%'}`, callback_data: `snipe_set:devHoldingMax:${taskId}` }],
          [{ text: `Twitter: ${task.requireTwitter ? '✅' : '—'}`,    callback_data: `snipe_req:twitter:${taskId}`           }, { text: `Website: ${task.requireWebsite ? '✅' : '—'}`, callback_data: `snipe_req:website:${taskId}` }, { text: `Telegram: ${task.requireTelegram ? '✅' : '—'}`, callback_data: `snipe_req:telegram:${taskId}` }],
          [{ text: `Ticker: ${task.ticker||'Not Set'}`,               callback_data: `snipe_set:ticker:${taskId}`            }],
          [{ text: `Dev: ${task.devAddress ? task.devAddress.slice(0,12)+'...' : 'Not Set'}`, callback_data: `snipe_set:devAddress:${taskId}` }],
          [{ text: `🔄 Auto Retry: ${task.autoRetry||1}`,             callback_data: `snipe_set:autoRetry:${taskId}`         }],
          // ── Snipe Auto Sell section ──
          [{ text: `${task.snipeAutoSell ? '✅' : '🟠'} Snipe Auto Sell`, callback_data: `snipe_toggle_autosell:${taskId}` }],
          [{ text: `${tpslTargets.length > 0 ? '✅' : '🟠'} TP/SL`,  callback_data: `snipe_tpsl_toggle:${taskId}`          }],
          ...tpslRows,
          [{ text: 'Add S/L', callback_data: `snipe_tpsl_add:${taskId}:sl` }, { text: 'Add T/P', callback_data: `snipe_tpsl_add:${taskId}:tp` }],
          [{ text: `${asc.trailingStop?.enabled ? '✅' : '🟠'} Trailing Stop`, callback_data: `snipe_as_toggle:trailingStop:${taskId}` }],
          [{ text: `Activate: ${asc.trailingStop?.activatePct != null ? asc.trailingStop.activatePct+'%' : '0%'}`, callback_data: `snipe_as_set:tsActivate:${taskId}` }, { text: `Price Change: ${asc.trailingStop?.priceChange != null ? asc.trailingStop.priceChange+'%' : '-%'}`, callback_data: `snipe_as_set:tsChange:${taskId}` }, { text: `Sell Amount: ${asc.trailingStop?.sellAmount != null ? asc.trailingStop.sellAmount+'%' : '-%'}`, callback_data: `snipe_as_set:tsAmt:${taskId}` }],
          [{ text: '+ Add', callback_data: `snipe_as_toggle:trailingStop:${taskId}` }],
          [{ text: `${asc.devSell?.enabled ? '✅' : '🟠'} Dev Sell`,  callback_data: `snipe_as_toggle:devSell:${taskId}`    }],
          [{ text: `Sell Amount: ${asc.devSell?.sellAmount != null ? asc.devSell.sellAmount+'%' : '- %'}`, callback_data: `snipe_as_set:devSellAmt:${taskId}` }],
          [{ text: `${asc.timeSell?.enabled ? '✅' : '🟠'} Time`,     callback_data: `snipe_as_toggle:timeSell:${taskId}`   }],
          [{ text: `Sell After: ${asc.timeSell?.sellAfterMins != null ? asc.timeSell.sellAfterMins : 'X'}`, callback_data: `snipe_as_set:timeSellMins:${taskId}` }, { text: `Sell Amount: ${asc.timeSell?.sellAmount != null ? asc.timeSell.sellAmount+'%' : '- %'}`, callback_data: `snipe_as_set:timeSellAmt:${taskId}` }],
          [{ text: '+ Add', callback_data: `snipe_as_toggle:timeSell:${taskId}` }],
          [{ text: '⚙️ Global Auto Sell Settings', callback_data: `snipe_as_global:${taskId}` }],
          [{ text: '⬅️ Back', callback_data: 'snipe'                 }, { text: '🔄 Refresh', callback_data: `snipe_task:${taskId}` }],
          ...(task.isDraft ? [[{ text: '+ Create', callback_data: `snipe_create:${taskId}` }]] : [
            [{ text: task.active ? '⏸ Pause Task' : '▶️ Activate Task', callback_data: `snipe_toggle:${taskId}` }],
            [{ text: '🗑️ Delete Task', callback_data: `snipe_delete:${taskId}` }],
          ]),
      ];
      await safeEdit(chatId, msgId,
        `🎯 <b>SNIPE TASK</b>\n\nWallet: <b>${task.wallet}</b>\nTag: ${task.tag||'-'}\nSnipe Amount: ${task.snipeAmount != null ? task.snipeAmount+' SOL' : '-'}\nTotal Snipe Amount: ${task.totalSnipeAmount != null ? task.totalSnipeAmount+' SOL' : '-'}\nSnipe Gas Fee: ${task.gasFee||0.0025}  🚀 Snipe Tip: ${task.snipeTip||0.005}\n${task.antiMev ? '✅' : '🟠'} Anti-MEV Buy\nBuy Slippage: ${task.buySlippage||50}%  Pump Buy Slippage: ${task.pumpBuySlippage||50}%\nTP/SL: ${tpslTargets.length > 0 ? tpslTargets.length+' target(s)' : 'Not Set'}\n${task.snipeAutoSell ? '✅' : '🟠'} Snipe Auto Sell\nStatus: ${task.active ? '🟢 Active' : '🟠 Inactive'}`,
        { reply_markup: { inline_keyboard: snipeTaskKeyboard }}
      );
      return;
    }

    if (data.startsWith('snipe_toggle:')) {
      const taskId = data.replace('snipe_toggle:', '');
      const tasks  = db.getSnipeTasks(userId);
      const task   = tasks.find(t => t.id === taskId);
      if (!task) return;
      if (!task.active) {
        // Require balance to activate
        // No balance gate here — users can configure snipe tasks freely
        // Balance is checked when the snipe actually fires a trade
        db.updateSnipeTask(userId, taskId, { active: true });
        startSnipeTask(userId, chatId, { ...task, active: true });
        await sendAutoDelete(chatId, `🟢 <b>Snipe Task Activated!</b>\n\nWatching for new Solana launches...`);
      } else {
        db.updateSnipeTask(userId, taskId, { active: false });
        stopSnipeTask(taskId);
        await sendAutoDelete(chatId, `⏸ <b>Snipe Task Paused</b>`);
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_toggle_mev:')) {
      const taskId = data.replace('snipe_toggle_mev:', '');
      const freshUM = db.getUser(userId) || {};
      if (taskId.startsWith('draft_') && freshUM[`snipeDraft_${taskId}`]) {
        const d = freshUM[`snipeDraft_${taskId}`];
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...d, antiMev: !d.antiMev } });
      } else {
        const task = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId);
        if (task) db.updateSnipeTask(userId, taskId, { antiMev: !task.antiMev });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_toggle_autosell:')) {
      const taskId = data.replace('snipe_toggle_autosell:', '');
      const freshUAS = db.getUser(userId) || {};
      if (taskId.startsWith('draft_') && freshUAS[`snipeDraft_${taskId}`]) {
        const d = freshUAS[`snipeDraft_${taskId}`];
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...d, snipeAutoSell: !d.snipeAutoSell } });
      } else {
        const task = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId);
        if (task) db.updateSnipeTask(userId, taskId, { snipeAutoSell: !task.snipeAutoSell });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    // ── SNIPE NOOP (section divider button) ──
    if (data === 'snipe_noop') { return; }

    // ── SNIPE AUTO SELL TOGGLE ──
    if (data.startsWith('snipe_as_toggle:')) {
      const parts   = data.split(':');
      const section = parts[1];
      const taskId  = parts[2];
      const freshUAT = db.getUser(userId) || {};
      const tTask2   = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                    || freshUAT[`snipeDraft_${taskId}`];
      if (!tTask2) return;
      const asc2 = tTask2.autoSellConfig || {};
      const sec2 = asc2[section] || {};
      const newAsc2 = { ...asc2, [section]: { ...sec2, enabled: !sec2.enabled } };
      if (tTask2.isDraft || (taskId.startsWith('draft_') && freshUAT[`snipeDraft_${taskId}`])) {
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...tTask2, autoSellConfig: newAsc2 } });
      } else {
        db.updateSnipeTask(userId, taskId, { autoSellConfig: newAsc2 });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    // ── SNIPE AUTO SELL SET FIELD ──
    if (data.startsWith('snipe_as_set:')) {
      const parts  = data.split(':');
      const field  = parts[1];
      const taskId = parts[2];
      const labels = {
        tpPct:        'Take Profit Price % (e.g. 100 = +100%)',
        tpAmt:        'Take Profit Sell Amount % (e.g. 100 = sell 100%)',
        slPct:        'Stop Loss Price % (negative, e.g. -30 = -30%)',
        slAmt:        'Stop Loss Sell Amount % (e.g. 100 = sell 100%)',
        tsActivate:   'Trailing Stop Activate % (e.g. 20)',
        tsChange:     'Trailing Stop Price Change % (e.g. 5)',
        tsAmt:        'Trailing Stop Sell Amount % (e.g. 100)',
        devSellAmt:   'Dev Sell — Sell Amount % (e.g. 100)',
        timeSellMins: 'Time Sell — Sell After (minutes)',
        timeSellAmt:  'Time Sell — Sell Amount % (e.g. 100)',
        sellGasFee:   'Sell Gas Fee (SOL, e.g. 0.002)',
        sellTip:      'Sell Tip (SOL, e.g. 0.002)',
        sellSlippage: 'Sell Slippage % (e.g. 18)',
        pumpSellSlip: 'Pump Sell Slippage % (e.g. 18)',
        expiry:       'Expiry (e.g. 2d, 12h, never)',
        autoRetry:    'Auto Retry count (e.g. 1)',
      };
      const asPromptMsg = await bot.sendMessage(chatId, `✏️ <b>Set ${labels[field]||field}</b>\n\n✍️ Enter new value:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `snipe_task:${taskId}` }]] }});
      db.setPendingAction(userId, `snipe_as_field:${field}:${taskId}:${asPromptMsg.message_id}`);
      return;
    }

    // ── SNIPE AUTO SELL GLOBAL SETTINGS ──
    if (data.startsWith('snipe_as_global:')) {
      const taskId   = data.replace('snipe_as_global:', '');
      const freshUAG = db.getUser(userId) || {};
      const task     = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                    || freshUAG[`snipeDraft_${taskId}`];
      if (!task) return;
      const asc = task.autoSellConfig || {};
      await safeEdit(chatId, msgId,
        `⚙️ <b>GLOBAL AUTO SELL SETTINGS</b>\n\n⛽ Sell Gas Fee: <code>${asc.sellGasFee||0.002} SOL</code>\n🚀 Sell Tip: <code>${asc.sellTip||0.002} SOL</code>\n${asc.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell\n📊 Sell Slippage: <code>${asc.sellSlippage||18}%</code>\n📊 Pump Sell Slippage: <code>${asc.pumpSellSlippage||18}%</code>\n⏳ Expiry: <code>${asc.expiry||'2d'}</code>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '⛽ Sell Gas Fee',      callback_data: `snipe_as_set:sellGasFee:${taskId}`   }, { text: '🚀 Sell Tip',        callback_data: `snipe_as_set:sellTip:${taskId}`       }],
          [{ text: `${asc.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell`, callback_data: `snipe_as_toggle:antiMevSell_global:${taskId}` }],
          [{ text: '📊 Sell Slippage',    callback_data: `snipe_as_set:sellSlippage:${taskId}`  }, { text: '📊 Pump Sell Slip',   callback_data: `snipe_as_set:pumpSellSlip:${taskId}` }],
          [{ text: '⏳ Expiry',           callback_data: `snipe_as_set:expiry:${taskId}`        }],
          [{ text: '⬅️ Back',            callback_data: `snipe_task:${taskId}`                 }],
        ]}}
      );
      return;
    }

    // ── SNIPE AUTO SELL GLOBAL TOGGLE (antiMevSell) ──
    if (data.startsWith('snipe_as_toggle:antiMevSell_global:')) {
      const taskId  = data.replace('snipe_as_toggle:antiMevSell_global:', '');
      const freshGA = db.getUser(userId) || {};
      const tGA     = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                   || freshGA[`snipeDraft_${taskId}`];
      if (!tGA) return;
      const ascGA   = tGA.autoSellConfig || {};
      const newAscGA = { ...ascGA, antiMevSell: !ascGA.antiMevSell };
      if (tGA.isDraft || (taskId.startsWith('draft_') && freshGA[`snipeDraft_${taskId}`])) {
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...tGA, autoSellConfig: newAscGA } });
      } else {
        db.updateSnipeTask(userId, taskId, { autoSellConfig: newAscGA });
      }
      bot.emit('callback_query', { ...query, data: `snipe_as_global:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_req:')) {
      const [, field, taskId] = data.split(':');
      const key = field === 'twitter' ? 'requireTwitter' : field === 'website' ? 'requireWebsite' : 'requireTelegram';
      const freshUReq = db.getUser(userId) || {};
      if (taskId.startsWith('draft_') && freshUReq[`snipeDraft_${taskId}`]) {
        const d = freshUReq[`snipeDraft_${taskId}`];
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...d, [key]: !d[key] } });
      } else {
        const task = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId);
        if (!task) return;
        db.updateSnipeTask(userId, taskId, { [key]: !task[key] });
      }
      bot.emit('callback_query', { ...query, data: `snipe_task:${taskId}` });
      return;
    }

    if (data.startsWith('snipe_set:')) {
      const parts  = data.split(':');
      const field  = parts[1];
      const taskId = parts[2];
      const snipeLabels = { tag: 'Tag Name', snipeAmount: 'Snipe Amount (SOL, e.g. 0.1)', totalSnipeAmount: 'Total Snipe Amount (SOL, e.g. 1.0)', gasFee: 'Gas Fee (SOL, e.g. 0.0025)', snipeTip: 'Snipe Tip (SOL, e.g. 0.005)', buySlippage: 'Buy Slippage % (e.g. 50)', pumpBuySlippage: 'Pump Buy Slippage % (e.g. 50)', minDevBuy: 'Min Dev Buy (SOL, or type none)', maxDevBuy: 'Max Dev Buy (SOL, or type none)', devHoldingMin: 'Dev Holding Min % (e.g. 5)', devHoldingMax: 'Dev Holding Max % (e.g. 80)', ticker: 'Ticker Symbol (e.g. BTC)', devAddress: 'Dev Wallet Address', autoRetry: 'Auto Retry count (e.g. 1)' };
      const snipePromptMsg = await bot.sendMessage(chatId, `✏️ <b>Set ${snipeLabels[field] || field}</b>\n\n✍️ Enter new value:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `snipe_task:${taskId}` }]] }});
      db.setPendingAction(userId, `snipe_field:${field}:${taskId}:${snipePromptMsg.message_id}`);
      return;
    }

    // ── SNIPE CREATE (save draft as real task) ──
    if (data.startsWith('snipe_create:')) {
      const taskId = data.replace('snipe_create:', '');
      const freshU2 = db.getUser(userId) || {};
      const draft   = freshU2[`snipeDraft_${taskId}`];
      if (!draft) {
        await bot.sendMessage(chatId, `❌ Draft not found. Please start again.`, { parse_mode: 'HTML' });
        return;
      }
      // Save as real task with new permanent ID
      const realId   = genId();
      const realTask = { ...draft, id: realId, isDraft: false };
      db.saveSnipeTask(userId, realTask);
      // Remove draft from user
      const updateFields = {};
      updateFields[`snipeDraft_${taskId}`] = undefined;
      db.updateUser(userId, updateFields);
      await sendAutoDelete(chatId, `✅ <b>Snipe task created!</b> Ready to activate.`);
      bot.emit('callback_query', { ...query, data: 'snipe' });
      return;
    }

    // ── SNIPE SET (draft-aware) ──
    if (data.startsWith('snipe_delete:')) {
      const taskId = data.replace('snipe_delete:', '');
      stopSnipeTask(taskId);
      db.deleteSnipeTask(userId, taskId);
      await sendAutoDelete(chatId, `🗑️ Snipe task deleted.`);
      bot.emit('callback_query', { ...query, data: 'snipe' });
      return;
    }

    if (data === 'snipe_pause_all') {
      const tasks = db.getSnipeTasks(userId);
      for (const t of tasks) {
        db.updateSnipeTask(userId, t.id, { active: false });
        stopSnipeTask(t.id);
      }
      await sendAutoDelete(chatId, `⏸ All snipe tasks paused.`);
      bot.emit('callback_query', { ...query, data: 'snipe' });
      return;
    }

    if (data === 'snipe_resume_all') {
      const tasks = db.getSnipeTasks(userId);
      for (const t of tasks) {
        db.updateSnipeTask(userId, t.id, { active: true });
      }
      bot.emit('callback_query', { ...query, data: 'snipe' });
      return;
    }

    if (data === 'snipe_ticker_blacklist') {
      db.setPendingAction(userId, 'awaiting_snipe_ticker_bl');
      const cur = (db.getUser(userId)?.snipeTickerBlacklist||[]).join('\n') || '';
      await safeEdit(chatId, msgId,
        `🚫 <b>Ticker Blacklist</b>\n\nCurrent blacklisted tickers:\n${cur || '<i>None</i>'}\n\nPaste ticker symbols to blacklist (one per line, e.g. PEPE).\nSend <b>clear</b> to remove all.`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'snipe' }]] }}
      );
      return;
    }

    if (data === 'snipe_dev_blacklist') {
      db.setPendingAction(userId, 'awaiting_snipe_dev_bl');
      const cur = (db.getUser(userId)?.snipeDevBlacklist||[]).join('\n') || '';
      await safeEdit(chatId, msgId,
        `🚫 <b>Dev Blacklist</b>\n\nCurrent blacklisted dev wallets:\n${cur || '<i>None</i>'}\n\nPaste dev wallet addresses to blacklist (one per line).\nSend <b>clear</b> to remove all.`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'snipe' }]] }}
      );
      return;
    }

    // ── SNIPE PLATFORMS ──
    if (data.startsWith('snipe_platforms:')) {
      const taskId      = data.replace('snipe_platforms:', '');
      const freshUP     = db.getUser(userId) || {};
      const task        = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                       || freshUP[`snipeDraft_${taskId}`];
      if (!task) return;
      const allPlatforms = [
        'PumpFun','PumpFun Mayhem','LaunchLab/Bonk','Raydium AMM V4',
        'Raydium CPMM','Raydium CLMM','Meteora DLMM','Meteora DBC',
        'Meteora DAMM V1','Meteora DAMM V2','PumpFun AMM','Jupiter Aggregator',
        'OKX Aggregator','Moonit','Boopfun','Gavel',
        'Vertigo','PancakeSwap','Heaven','Orca',
      ];
      const enabled = (task.platforms && task.platforms.length > 0) ? task.platforms : [...allPlatforms];
      const rows = [];
      for (let i = 0; i < allPlatforms.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i+2, allPlatforms.length); j++) {
          const p  = allPlatforms[j];
          const on = enabled.includes(p);
          row.push({ text: `${on ? '🟢' : '⚪'} ${p}`, callback_data: `snipe_ptoggle:${taskId}:${j}` });
        }
        rows.push(row);
      }
      rows.push([{ text: '⬅️ Back', callback_data: `snipe_task:${taskId}` }]);
      await safeEdit(chatId, msgId,
        `🖥 <b>PLATFORMS</b>\n\nSelect which platforms to snipe on.\n🟢 = Active  ⚪ = Disabled\n\n🕐 ${new Date().toLocaleTimeString()}`,
        { reply_markup: { inline_keyboard: rows }}
      );
      return;
    }

    if (data.startsWith('snipe_ptoggle:')) {
      const parts        = data.split(':');
      const taskId       = parts[1];
      const idx          = parseInt(parts[2]);
      const freshUPT     = db.getUser(userId) || {};
      const task         = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId)
                        || freshUPT[`snipeDraft_${taskId}`];
      if (!task) return;
      const allPlatforms = [
        'PumpFun','PumpFun Mayhem','LaunchLab/Bonk','Raydium AMM V4',
        'Raydium CPMM','Raydium CLMM','Meteora DLMM','Meteora DBC',
        'Meteora DAMM V1','Meteora DAMM V2','PumpFun AMM','Jupiter Aggregator',
        'OKX Aggregator','Moonit','Boopfun','Gavel',
        'Vertigo','PancakeSwap','Heaven','Orca',
      ];
      const p       = allPlatforms[idx];
      let enabled   = (task.platforms && task.platforms.length > 0) ? [...task.platforms] : [...allPlatforms];
      if (enabled.includes(p)) {
        enabled = enabled.filter(x => x !== p);
      } else {
        enabled.push(p);
      }
      const freshUPT2 = db.getUser(userId) || {};
      if (taskId.startsWith('draft_') && freshUPT2[`snipeDraft_${taskId}`]) {
        const d = freshUPT2[`snipeDraft_${taskId}`];
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...d, platforms: enabled } });
      } else {
        db.updateSnipeTask(userId, taskId, { platforms: enabled });
      }
      bot.emit('callback_query', { ...query, data: `snipe_platforms:${taskId}` });
      return;
    }

    // ── COPY TRADE ──
    if (data === 'copy_trade') {
      const tasks = db.getCopyTasks(userId);
      const w1    = tasks.find(t => t.wallet === 'W1') || null;
      const w2    = tasks.find(t => t.wallet === 'W2') || null;
      // Build task list like reference image
      let ctListText = '✈️ <b>COPY TRADE</b>\n\nCopy the buys and sells of any target wallet.\n🟢 Indicates a copy trade setup is active.\n🟠 Indicates a copy trade setup is paused.\n';
      tasks.forEach((t, i) => {
        const dot  = t.active ? '🟢' : '🟠';
        const tag  = t.tag || `Task ${i+1}`;
        const addr = t.targetWallet
          ? `${t.targetWallet.slice(0,8)}...${t.targetWallet.slice(-6)}`
          : 'No wallet set';
        ctListText += `\n${dot} ${tag} — ${addr}`;
      });
      if (!tasks.length) ctListText += '\n\n<i>No copy tasks yet.</i>';

      // Build numbered task buttons from ALL tasks
      const allCtTaskBtns = [];
      for (let i = 0; i < tasks.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i+2, tasks.length); j++) {
          const t   = tasks[j];
          const dot = t.active ? '🟢' : '🟠';
          const tag = t.tag || `Task ${j+1}`;
          row.push({ text: `${dot} ${j+1} — ${tag}`, callback_data: `ct_task:${t.id}` });
        }
        allCtTaskBtns.push(row);
      }

      await safeEdit(chatId, msgId, ctListText,
        { reply_markup: { inline_keyboard: [
          ...allCtTaskBtns,
          [{ text: '➕ Add Copy',                    callback_data: 'ct_new:W1'           }, { text: '➕ Add Reverse Copy',     callback_data: 'ct_new_reverse:W1'   }],
          [{ text: '➕ Mass Create',                  callback_data: 'ct_mass_create'      }],
          [{ text: '📋 All Copy Trades Sell Only',    callback_data: 'ct_all_sell_only'    }],
          [{ text: '▶️ Resume All',                   callback_data: 'ct_resume_all'       }],
          [{ text: `🚫 Exclude Tokens ${(db.getUser(userId)?.ctExcludeTokens||[]).length}`, callback_data: 'ct_exclude_tokens' }],
          [{ text: `Each token only buy once: ${(db.getUser(userId)?.ctEachTokenOnce) ? '✅' : '🟠'}`, callback_data: 'ct_toggle_each_once' }],
          [{ text: `Alert Mode: ${db.getUser(userId)?.ctAlertMode||'Standard'}`,             callback_data: 'ct_alert_mode'       }],
          [{ text: '📊 View target address PNL on web ↗️', callback_data: 'ct_view_pnl'  }],
          [{ text: '← Back',               callback_data: 'dashboard'           }, { text: '🔄 Refresh', callback_data: 'copy_trade' }],
        ]}}
      );
      return;
    }

    if (data.startsWith('ct_new:') || data.startsWith('ct_new_reverse:')) {
      const isReverse = data.startsWith('ct_new_reverse:');
      const wallet    = data.split(':')[1];
      const taskId    = genId();
      const task      = {
        id: taskId, wallet, active: false, isReverse,
        targetWallet: null, tag: null,
        turboMode: true, onlyCopyDevCreate: false,
        buyPercentage: 100, maxBuy: null, minBuy: null,
        solSpendingLimit: null, buyLimitPerToken: null,
        buyTimesResetAfterSold: false, noDuplicateBuys: false,
        unrenounced: true, unburned: true,
        maxSolTarget: null, minSolTarget: null,
        antiPvp: false, buyDip: false,
        eachTokenOnce: false, alertMode: 'Standard',
        excludeInternal: false, excludeExternal: false,
        sellAllWhenTraderTransfers: true,
        firstSellCopyPct: null,
        copyWithSells: true, sellProportionally: true,
        autoRetry: 1, firstSellCopyPct: null,
        sellWhenTraderTransfers: true,
        buyPriorityFee: 0.002, sellPriorityFee: 0.002,
        buyTip: 0.002, sellTip: 0.002,
        antiMevBuy: false, antiMevSell: false,
        buySlippage: 18, sellSlippage: 18,
        pumpBuySlippage: 50, pumpSellSlippage: 18,
        copyTradeAutoSell: false,
        startTime: null, endTime: null,
        maxMC: null, minMC: null,
        maxTokenAge: null, minTokenAge: null,
        minLP: null,
        tasksCompleted: 0, tasksTotal: 0,
        createdAt: new Date().toISOString(),
      };
      db.saveCopyTask(userId, task);
      bot.emit('callback_query', { ...query, data: `ct_task:${taskId}` });
      return;
    }

    if (data === 'ct_mass_create') {
      db.setPendingAction(userId, 'awaiting_mass_wallets');
      await safeEdit(chatId, msgId,
        `➕ <b>Mass Create Copy Tasks</b>\n\nPlease paste your list of wallet addresses below (maximum 70 addresses one time):\n\n<b>Format:</b>\n- One wallet address per line\n- Tag(Optional), Solana Address\n\n<b>Example:</b>\n<code>SmartMoney,Dc5mKHEad5DkwpfRwqrXAffqcSzqdWE2kh6JDvmVGkeL</code>\n<code>dev,EvuglFAyfH9tdB99uHar9frjr3ZLfpPQwaZZRdAsz3FT</code>\n\n✍️ <b>Paste wallets now (one per line):</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'copy_trade' }]] }}
      );
      return;
    }

    if (data === 'ct_all_sell_only') {
      const tasks = db.getCopyTasks(userId);
      for (const t of tasks) db.updateCopyTask(userId, t.id, { copyWithSells: true, buyPercentage: 0 });
      await bot.sendMessage(chatId, `📋 All copy tasks set to <b>Sell Only</b>.`, { parse_mode: 'HTML' });
      bot.emit('callback_query', { ...query, data: 'copy_trade' });
      return;
    }

    if (data === 'ct_resume_all') {
      const tasks = db.getCopyTasks(userId);
      for (const t of tasks) {
        if (!t.active) {
          db.updateCopyTask(userId, t.id, { active: true });
          startCopyTask(userId, chatId, { ...t, active: true });
        }
      }
      await bot.sendMessage(chatId, `▶️ All copy tasks <b>resumed</b>.`, { parse_mode: 'HTML' });
      bot.emit('callback_query', { ...query, data: 'copy_trade' });
      return;
    }

    if (data === 'ct_exclude_tokens') {
      db.setPendingAction(userId, 'awaiting_ct_exclude_token');
      await safeEdit(chatId, msgId, `🚫 <b>Exclude Token</b>\n\nPaste the contract address to exclude:\n\n✍️`, { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'copy_trade' }]] }});
      return;
    }

    if (data === 'ct_view_pnl') {
      const tasks = db.getCopyTasks(userId);
      if (!tasks.length) { await safeEdit(chatId, msgId, `📊 No copy tasks yet.`, { reply_markup: backToDash() }); return; }
      let txt = `📊 <b>Copy Trade PnL Overview</b>\n\n`;
      for (const t of tasks) { txt += `${t.active ? '🟢' : '⚪'} ${t.wallet} — Target: ${t.targetWallet ? t.targetWallet.slice(0,12)+'...' : 'Not Set'}\n`; }
      await safeEdit(chatId, msgId, txt, { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'copy_trade' }]] }});
      return;
    }

    if (data.startsWith('ct_task:')) {
      const taskId = data.replace('ct_task:', '');
      const tasks  = db.getCopyTasks(userId);
      const task   = tasks.find(t => t.id === taskId);
      if (!task) { await safeEdit(chatId, msgId, `❌ Task not found.`, { reply_markup: backToDash() }); return; }
      await safeEdit(chatId, msgId,
        `✈️ <b>COPY TASK${task.isReverse ? ' (REVERSE)' : ''}</b>\n\n💼 Wallet: <b>${task.wallet}</b>\n🏷️ Tag: ${task.tag||'-'}\n🎯 Target Wallet: ${task.targetWallet ? task.targetWallet.slice(0,8)+'...'+task.targetWallet.slice(-6) : '-'}\n${task.turboMode ? '✅' : '🟠'} Turbo Mode\n${task.onlyCopyDevCreate ? '✅' : '🟠'} Only copy Dev-Create\nBuy Percentage: ${task.buyPercentage}%\nMax Buy: ${task.maxBuy ? task.maxBuy+' SOL' : 'Not Limited'}  Min Buy: ${task.minBuy ? task.minBuy+' SOL' : 'Not Limited'}\nSOL Spending Limit: ${task.solSpendingLimit||'Not Limited'}\nBuy Limit per Token(1)(2)(3): ${task.buyLimitPerToken||'Not Limited'}\nBuy times reset after sold: ${task.buyTimesResetAfterSold ? '✅' : '❌'} No\nNo Duplicate Buys from Target Wallet: ${task.noDuplicateBuys ? '✅' : '❌'} No\nUnrenounced: ${task.unrenounced ? '✅' : '🟠'} Yes  Unburned: ${task.unburned ? '✅' : '🟠'} Yes\nMax SOL for Target Wallet: ${task.maxSolTarget||'Not Limited'}\nMin SOL for Target Wallet: ${task.minSolTarget||'Not Limited'}\n${task.antiPvp ? '✅' : '🟠'} Anti-PVP Protection\n${task.buyDip ? '✅' : '🟠'} Buy Dip\nPlatforms\n${task.excludeInternal ? '✅' : '🟠'} Exclude Internal Tr...  ${task.excludeExternal ? '✅' : '🟠'} Exclude External T...\nMin LP: Not Limited\nMax MC: ${task.maxMC||'Not Limited'}  Min MC: ${task.minMC||'Not Limited'}\nMax Token Age: ${task.maxTokenAge||'Not Li...'}  Min Token Age: ${task.minTokenAge||'Not Li...'}\nCopy Sells: ${task.copyWithSells ? '✅' : '🟠'} Yes\n⇌ Sell Proportionally to Target Wallet: ${task.sellProportionally ? '✅' : '🟠'} Yes\nAuto Retry: ${task.autoRetry||1}\nFirst Sell Copy Percentage: ${task.firstSellCopyPct||'Not Limited'}\n${task.sellAllWhenTraderTransfers!==false ? '✅' : '🟠'} Sell All When Trader Transfer Tokens\nBuy Priority Fee: ${task.buyPriorityFee}  Sell Priority Fee: ${task.sellPriorityFee}\nBuy Tip🚀: ${task.buyTip||0.002}  Sell Tip🚀: ${task.sellTip||0.002}\n${task.antiMevBuy ? '✅' : '🟠'} Anti-MEV Buy  ${task.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell\nBuy Slippage: ${task.buySlippage}%  Sell Slippage: ${task.sellSlippage}%\nBuy PUMP Slippage: ${task.pumpBuySlippage||50}%\nSell PUMP Slippage: ${task.pumpSellSlippage||18}%\n${task.copyTradeAutoSell ? '✅' : '🟠'} Copy Trade AutoSell\nStart Time: ${task.startTime||'Not Limited'}  End Time: ${task.endTime||'Not Limited'}\n\nStatus: ${task.active ? '🟢 ACTIVE' : '⚪ INACTIVE'}`,
        { reply_markup: { inline_keyboard: [
          [{ text: `Wallet: ${task.wallet}`, callback_data: `ct_noop` }],
          [{ text: `🏷️ Tag: ${task.tag||'-'}`,                   callback_data: `ct_set:tag:${taskId}`               }],
          [{ text: `🎯 Target Wallet: ${task.targetWallet ? task.targetWallet.slice(0,8)+'...' : '-'}`, callback_data: `ct_set:targetWallet:${taskId}` }],
          [{ text: `${task.turboMode ? '✅' : '🟠'} Turbo Mode`, callback_data: `ct_toggle_field:turboMode:${taskId}` }],
          [{ text: `${task.onlyCopyDevCreate ? '✅' : '🟠'} Only copy Dev-Create`, callback_data: `ct_toggle_field:onlyCopyDevCreate:${taskId}` }],
          [{ text: `Buy Percentage: ${task.buyPercentage}%`,       callback_data: `ct_set:buyPercentage:${taskId}`     }],
          [{ text: `Max Buy: ${task.maxBuy||'Not Limited'}`,       callback_data: `ct_set:maxBuy:${taskId}`            }, { text: `Min Buy: ${task.minBuy||'Not Limited'}`, callback_data: `ct_set:minBuy:${taskId}` }],
          [{ text: `SOL Spending Limit: ${task.solSpendingLimit||'Not Limited'}`, callback_data: `ct_set:solSpendingLimit:${taskId}` }],
          [{ text: `Buy Limit per Token(1)(2)(3): ${task.buyLimitPerToken||'Not Limited'}`, callback_data: `ct_set:buyLimitPerToken:${taskId}` }],
          [{ text: `Buy times reset after sold: ${task.buyTimesResetAfterSold ? '✅' : '❌'} No`, callback_data: `ct_toggle_field:buyTimesResetAfterSold:${taskId}` }],
          [{ text: `No Duplicate Buys from Target Wallet: ${task.noDuplicateBuys ? '✅' : '❌'} No`, callback_data: `ct_toggle_field:noDuplicateBuys:${taskId}` }],
          [{ text: `Unrenounced: ${task.unrenounced ? '✅' : '🟠'} Yes`, callback_data: `ct_toggle_field:unrenounced:${taskId}` }, { text: `Unburned: ${task.unburned ? '✅' : '🟠'} Yes`, callback_data: `ct_toggle_field:unburned:${taskId}` }],
          [{ text: `Max SOL for Target Wallet: ${task.maxSolTarget||'Not Limited'}`, callback_data: `ct_set:maxSolTarget:${taskId}` }],
          [{ text: `Min SOL for Target Wallet: ${task.minSolTarget||'Not Limited'}`, callback_data: `ct_set:minSolTarget:${taskId}` }],
          [{ text: `${task.antiPvp ? '✅' : '🟠'} Anti-PVP Protection`, callback_data: `ct_toggle_field:antiPvp:${taskId}` }],
          [{ text: `${task.buyDip ? '✅' : '🟠'} Buy Dip`,              callback_data: `ct_toggle_field:buyDip:${taskId}` }],
          [{ text: `Platforms`,                                           callback_data: `ct_platforms:${taskId}`            }],
          [{ text: `${task.excludeInternal ? '✅' : '🟠'} Exclude Internal Tr...`, callback_data: `ct_toggle_field:excludeInternal:${taskId}` }, { text: `${task.excludeExternal ? '✅' : '🟠'} Exclude External T...`, callback_data: `ct_toggle_field:excludeExternal:${taskId}` }],
          [{ text: `Min LP: ${task.minLP||'Not Limited'}`,               callback_data: `ct_set:minLP:${taskId}`            }],
          [{ text: `Max MC: ${task.maxMC||'Not Limited'}`,               callback_data: `ct_set:maxMC:${taskId}`            }, { text: `Min MC: ${task.minMC||'Not Limited'}`, callback_data: `ct_set:minMC:${taskId}` }],
          [{ text: `Max Token Age: ${task.maxTokenAge||'Not Limited'}`,   callback_data: `ct_set:maxTokenAge:${taskId}`      }, { text: `Min Token Age: ${task.minTokenAge||'Not Limited'}`, callback_data: `ct_set:minTokenAge:${taskId}` }],
          [{ text: `Copy Sells: ${task.copyWithSells ? '✅' : '🟠'} Yes`, callback_data: `ct_toggle_field:copyWithSells:${taskId}` }],
          [{ text: `⇌ Sell Proportionally to Target Wallet: ${task.sellProportionally ? '✅' : '🟠'} Yes`, callback_data: `ct_toggle_field:sellProportionally:${taskId}` }],
          [{ text: `Auto Retry: ${task.autoRetry||1}`,                    callback_data: `ct_set:autoRetry:${taskId}`        }],
          [{ text: `First Sell Copy Percentage: ${task.firstSellCopyPct||'Not Limited'}`, callback_data: `ct_set:firstSellCopyPct:${taskId}` }],
          [{ text: `${task.sellAllWhenTraderTransfers!==false ? '✅' : '🟠'} Sell All When Trader Transfer Tokens`, callback_data: `ct_toggle_field:sellAllWhenTraderTransfers:${taskId}` }],
          [{ text: `Buy Priority Fee: ${task.buyPriorityFee}`,            callback_data: `ct_set:buyPriorityFee:${taskId}`   }, { text: `Sell Priority Fee: ${task.sellPriorityFee}`, callback_data: `ct_set:sellPriorityFee:${taskId}` }],
          [{ text: `Buy Tip🚀: ${task.buyTip||0.002}`,                    callback_data: `ct_set:buyTip:${taskId}`           }, { text: `Sell Tip🚀: ${task.sellTip||0.002}`, callback_data: `ct_set:sellTip:${taskId}` }],
          [{ text: `${task.antiMevBuy ? '✅' : '🟠'} Anti-MEV Buy`,      callback_data: `ct_toggle_field:antiMevBuy:${taskId}` }, { text: `${task.antiMevSell ? '✅' : '🟠'} Anti-MEV Sell`, callback_data: `ct_toggle_field:antiMevSell:${taskId}` }],
          [{ text: `Buy Slippage: ${task.buySlippage}%`,                  callback_data: `ct_set:buySlippage:${taskId}`      }, { text: `Sell Slippage: ${task.sellSlippage}%`, callback_data: `ct_set:sellSlippage:${taskId}` }],
          [{ text: `Buy PUMP Slippage: ${task.pumpBuySlippage||50}%`,     callback_data: `ct_set:pumpBuySlippage:${taskId}`  }],
          [{ text: `Sell PUMP Slippage: ${task.pumpSellSlippage||18}%`,   callback_data: `ct_set:pumpSellSlippage:${taskId}` }],
          [{ text: `${task.copyTradeAutoSell ? '✅' : '🟠'} Copy Trade AutoSell`, callback_data: `ct_toggle_field:copyTradeAutoSell:${taskId}` }],
          [{ text: `Start Time: ${task.startTime||'Not Limited'}`,         callback_data: `ct_set:startTime:${taskId}`        }, { text: `End Time: ${task.endTime||'Not Limited'}`, callback_data: `ct_set:endTime:${taskId}` }],
          [{ text: '⬅️ Back',                                             callback_data: 'copy_trade'                        }, { text: '🔄 Refresh', callback_data: `ct_task:${taskId}` }],
          [{ text: task.active ? '⏸ Pause Task' : '▶️ Activate Task',    callback_data: `ct_toggle:${taskId}`               }],
          [{ text: '🗑️ Delete Task',                                      callback_data: `ct_delete:${taskId}`               }],
        ]}}
      );
      return;
    }

    if (data === 'ct_noop') { return; }

    if (data.startsWith('ct_toggle:')) {
      const taskId = data.replace('ct_toggle:', '');
      const task   = (db.getCopyTasks(userId)||[]).find(t => t.id === taskId);
      if (!task) return;
      if (!task.active) {
        db.updateCopyTask(userId, taskId, { active: true });
        startCopyTask(userId, chatId, { ...task, active: true });
        await sendAutoDelete(chatId, `🟢 <b>Copy Task Activated!</b>\n\nMirroring: ${task.targetWallet ? task.targetWallet.slice(0,16)+'...' : 'No target set yet'}`);
        await notifyAdmin(`🔁 <b>Copy Task Started</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\nTarget: ${task.targetWallet||'Not set'}`);
      } else {
        db.updateCopyTask(userId, taskId, { active: false });
        stopCopyTask(taskId);
        await sendAutoDelete(chatId, `⏸ <b>Copy Task Paused</b>`);
      }
      bot.emit('callback_query', { ...query, data: `ct_task:${taskId}` });
      return;
    }

    if (data.startsWith('ct_toggle_field:')) {
      const parts  = data.split(':');
      const field  = parts[1];
      const taskId = parts[2];
      const task   = (db.getCopyTasks(userId)||[]).find(t => t.id === taskId);
      if (task) db.updateCopyTask(userId, taskId, { [field]: !task[field] });
      bot.emit('callback_query', { ...query, data: `ct_task:${taskId}` });
      return;
    }

    if (data.startsWith('ct_set:')) {
      const parts  = data.split(':');
      const field  = parts[1];
      const taskId = parts[2];
      const labels = { tag: 'Name Tag for this trader', targetWallet: 'Target Wallet Address (Solana)', buyPercentage: 'Buy Percentage (0-100)', maxBuy: 'Max Buy (SOL, or none)', minBuy: 'Min Buy (SOL, or none)', solSpendingLimit: 'SOL Spending Limit (or none)', buyLimitPerToken: 'Buy Limit per Token (or none)', maxSolTarget: 'Max SOL for Target Wallet (or none)', minSolTarget: 'Min SOL for Target Wallet (or none)', minLP: 'Min LP in SOL (or none)', minMC: 'Min Market Cap $ (or none)', maxMC: 'Max Market Cap $ (or none)', minTokenAge: 'Min Token Age in minutes (or none)', maxTokenAge: 'Max Token Age in minutes (or none)', firstSellCopyPct: 'First Sell Copy % (or none)', buyPriorityFee: 'Buy Priority Fee SOL (e.g. 0.002)', sellPriorityFee: 'Sell Priority Fee SOL (e.g. 0.002)', buyTip: 'Buy Tip SOL (e.g. 0.002)', sellTip: 'Sell Tip SOL (e.g. 0.002)', buySlippage: 'Buy Slippage % (e.g. 18)', sellSlippage: 'Sell Slippage % (e.g. 18)', pumpBuySlippage: 'Buy PUMP Slippage % (e.g. 50)', pumpSellSlippage: 'Sell PUMP Slippage % (e.g. 18)', startTime: 'Start Time (e.g. 09:00 UTC, or none)', endTime: 'End Time (e.g. 17:00 UTC, or none)', autoRetry: 'Auto Retry count (e.g. 1)' };
      const ctPromptMsg = await bot.sendMessage(chatId, `✏️ <b>Set ${labels[field]||field}</b>\n\n✍️ Enter new value:`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `ct_task:${taskId}` }]] }});
      db.setPendingAction(userId, `ct_field:${field}:${taskId}:${ctPromptMsg.message_id}`);
      return;
    }

    if (data.startsWith('ct_delete:')) {
      const taskId = data.replace('ct_delete:', '');
      stopCopyTask(taskId);
      db.deleteCopyTask(userId, taskId);
      await sendAutoDelete(chatId, `🗑️ Copy task deleted.`);
      bot.emit('callback_query', { ...query, data: 'copy_trade' });
      return;
    }

    // ── CT EACH TOKEN ONCE ──
    if (data === 'ct_toggle_each_once') {
      const cur = db.getUser(userId)?.ctEachTokenOnce || false;
      db.updateUser(userId, { ctEachTokenOnce: !cur });
      bot.emit('callback_query', { ...query, data: 'copy_trade' });
      return;
    }

    // ── CT ALERT MODE ──
    if (data === 'ct_alert_mode') {
      const modes   = ['Standard', 'Silent', 'Verbose'];
      const current = db.getUser(userId)?.ctAlertMode || 'Standard';
      const nextIdx = (modes.indexOf(current) + 1) % modes.length;
      db.updateUser(userId, { ctAlertMode: modes[nextIdx] });
      bot.emit('callback_query', { ...query, data: 'copy_trade' });
      return;
    }

    // ── CT EXCLUDE TOKENS ──
    if (data === 'ct_exclude_tokens') {
      db.setPendingAction(userId, 'awaiting_ct_exclude_tokens');
      await safeEdit(chatId, msgId,
        `🚫 <b>Exclude Tokens</b>\n\nPaste token contract addresses to exclude (one per line).\nThese tokens will never be copied.\n\n✍️ <b>Enter addresses now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'copy_trade' }]] }}
      );
      return;
    }

    // ── COPY TRADE PLATFORMS ──
    if (data.startsWith('ct_platforms:')) {
      const taskId      = data.replace('ct_platforms:', '');
      const task        = (db.getCopyTasks(userId)||[]).find(t => t.id === taskId);
      if (!task) return;
      const allPlatforms = [
        'PumpFun','PumpFun Mayhem','LaunchLab/Bonk','Raydium AMM V4',
        'Raydium CPMM','Raydium CLMM','Meteora DLMM','Meteora DBC',
        'Meteora DAMM V1','Meteora DAMM V2','PumpFun AMM','Jupiter Aggregator',
        'OKX Aggregator','Moonit','Boopfun','Gavel',
        'Vertigo','PancakeSwap','Heaven','Orca',
      ];
      const enabled = (task.platforms && task.platforms.length > 0) ? task.platforms : [...allPlatforms];
      const rows = [];
      for (let i = 0; i < allPlatforms.length; i += 2) {
        const row = [];
        for (let j = i; j < Math.min(i+2, allPlatforms.length); j++) {
          const p  = allPlatforms[j];
          const on = enabled.includes(p);
          row.push({ text: `${on ? '🟢' : '⚪'} ${p}`, callback_data: `ct_ptoggle:${taskId}:${j}` });
        }
        rows.push(row);
      }
      rows.push([{ text: '⬅️ Back', callback_data: `ct_task:${taskId}` }]);
      await safeEdit(chatId, msgId,
        `🖥 <b>COPY TRADE PLATFORMS</b>\n\nSelect which platforms to copy trades from.\n🟢 = Active  ⚪ = Disabled\n\n🕐 ${new Date().toLocaleTimeString()}`,
        { reply_markup: { inline_keyboard: rows }}
      );
      return;
    }

    if (data.startsWith('ct_ptoggle:')) {
      const parts        = data.split(':');
      const taskId       = parts[1];
      const idx          = parseInt(parts[2]);
      const task         = (db.getCopyTasks(userId)||[]).find(t => t.id === taskId);
      if (!task) return;
      const allPlatforms = [
        'PumpFun','PumpFun Mayhem','LaunchLab/Bonk','Raydium AMM V4',
        'Raydium CPMM','Raydium CLMM','Meteora DLMM','Meteora DBC',
        'Meteora DAMM V1','Meteora DAMM V2','PumpFun AMM','Jupiter Aggregator',
        'OKX Aggregator','Moonit','Boopfun','Gavel',
        'Vertigo','PancakeSwap','Heaven','Orca',
      ];
      const p       = allPlatforms[idx];
      let enabled   = (task.platforms && task.platforms.length > 0) ? [...task.platforms] : [...allPlatforms];
      if (enabled.includes(p)) {
        enabled = enabled.filter(x => x !== p);
      } else {
        enabled.push(p);
      }
      db.updateCopyTask(userId, taskId, { platforms: enabled });
      bot.emit('callback_query', { ...query, data: `ct_platforms:${taskId}` });
      return;
    }

    // ── NEED FUNDS ──
    if (data === 'need_funds') {
      await safeEdit(chatId, msgId,
        `⚠️ <b>Insufficient Funds</b>\n\nYou need SOL to use this feature.\n\n📋 Deposit:\n<code>${DEPOSIT_ADDRESS}</code>\n\n⚠️ Minimum: <b>0.02 SOL</b>`,
        { reply_markup: backToDash() }
      );
      return;
    }

    // ── BUY ──
    if (data === 'manual_buy') {
      // Send as a NEW message so we can delete it once user pastes the CA
      const buyPrompt = await bot.sendMessage(chatId,
        `📈 <b>BUY TOKEN</b>\n\nPaste the token contract address below.\n\n✍️ <b>Enter contract address:</b>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'dashboard' }]] }}
      );
      db.setPendingAction(userId, `awaiting_buy_address:${buyPrompt.message_id}`);
      return;
    }

    if (data === 'manual_sell') {
      // Send as a NEW message so we can delete it once user pastes the CA
      const sellPrompt = await bot.sendMessage(chatId,
        `📉 <b>SELL TOKEN</b>\n\nPaste the token contract address below.\n\n✍️ <b>Enter contract address:</b>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'dashboard' }]] }}
      );
      db.setPendingAction(userId, `awaiting_sell_address:${sellPrompt.message_id}`);
      return;
    }

    if (data === 'buy_noop') { return; }

    // ── BUY REFRESH / FIXED / SLIP_TOGGLE — all use safeEdit on existing message ──
    if (data.startsWith('buy_refresh:') || data.startsWith('buy_fixed:') || data.startsWith('buy_slip_toggle:')) {
      let ca, selectedAmt = null, customAmt = null;
      if (data.startsWith('buy_refresh:')) {
        ca = data.replace('buy_refresh:', '');
      } else if (data.startsWith('buy_fixed:')) {
        const p = data.split(':'); selectedAmt = parseFloat(p[1]); ca = p.slice(2).join(':');
      } else if (data.startsWith('buy_slip_toggle:')) {
        ca = data.replace('buy_slip_toggle:', '');
        const fu0 = db.getUser(userId)||{}; const s0 = fu0.settings||{};
        const vals0=[10,15,20,50]; const cur0=s0.buySlippage||10;
        db.updateUser(userId,{settings:{...s0,buySlippage:vals0[(vals0.indexOf(cur0)+1)%vals0.length]}});
      }
      // Check for stored custom amount
      const fuR = db.getUser(userId)||{};
      customAmt = fuR[`buyCustom_${ca}`] ?? null;
      const sR  = fuR.settings||{};
      const slip= sR.buySlippage||10;
      const tk  = await fetchTokenInfo(ca);
      if (!tk) { await sendAutoDelete(chatId, `❌ Could not fetch token data.`); return; }
      db.setPendingAction(userId, `awaiting_buy_amount:${ca}`);
      await safeEdit(chatId, msgId, formatTokenCard(tk, fuR.balance||0, true, sR),
        { reply_markup: { inline_keyboard: buildBuyKeyboard(ca, slip, selectedAmt, customAmt) }}
      );
      return;
    }

    // ── BUY CUSTOM AMOUNT ──
    if (data.startsWith('buy_custom:')) {
      const ca = data.replace('buy_custom:', '');
      // Edit the current message to ask for input inline (no new message)
      await safeEdit(chatId, msgId,
        `✏️ <b>Enter custom SOL amount:</b>\n\n(e.g. <code>0.5</code> or <code>2</code>)`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `buy_refresh:${ca}` }]] }}
      );
      db.setPendingAction(userId, `awaiting_buy_custom:${ca}:${msgId}`);
      return;
    }

    // ── BUY SET SLIPPAGE ──
    if (data.startsWith('buy_set_slip:')) {
      const ca = data.replace('buy_set_slip:', '');
      await safeEdit(chatId, msgId,
        `✏️ <b>Enter Buy Slippage %:</b>\n\n(e.g. <code>10</code>)`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `buy_refresh:${ca}` }]] }}
      );
      db.setPendingAction(userId, `awaiting_buy_slip_inline:${ca}:${msgId}`);
      return;
    }

    // ── BUY LIMIT (stub with back) ──
    if (data.startsWith('buy_limit:')) {
      const ca = data.replace('buy_limit:', '');
      await safeEdit(chatId, msgId,
        `📋 <b>LIMIT ORDERS</b>\n\nYou have no active limit orders.\n\nCreate a limit order from the Buy/Sell menu.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: `buy_refresh:${ca}` }, { text: '🔄 Refresh', callback_data: `buy_limit:${ca}` }],
        ]}}
      );
      return;
    }

    if (data.startsWith('buy_dca:')) {
      const ca = data.replace('buy_dca:', '');
      await safeEdit(chatId, msgId,
        `🔄 <b>DCA ORDERS</b>\n\nYou have no active DCA orders.\n\nCreate a DCA order from the Buy/Sell menu.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: `buy_refresh:${ca}` }, { text: '🔄 Refresh', callback_data: `buy_dca:${ca}` }],
        ]}}
      );
      return;
    }

    // ── BUY EXECUTE ──
    if (data.startsWith('buy_exec:')) {
      const parts  = data.split(':');
      const amount = parseFloat(parts[1]);
      const ca     = parts.slice(2).join(':');
      const fu     = db.getUser(userId) || {};
      const bal    = fu.balance || 0;
      db.clearPendingAction(userId);
      if (isNaN(amount) || amount <= 0) { await sendAutoDelete(chatId, `❌ Select or enter a valid amount first.`); return; }
      if (amount > bal) {
        const tk2 = await fetchTokenInfo(ca);
        await safeEdit(chatId, msgId,
          `${tk2 ? formatTokenCard(tk2, bal, true, fu.settings||{}) : '📉 <b>Insufficient Balance</b>'}\n\n🔴 <i>Insufficient balance for buy amount + gas</i>`,
          { reply_markup: { inline_keyboard: [
            [{ text: '← Back', callback_data: 'manual_buy' }, { text: 'Retry', callback_data: `buy_refresh:${ca}` }],
          ]}}
        );
        return;
      }
      const gas    = 0.000005;
      const total  = parseFloat((amount+gas).toFixed(6));
      const newBal = parseFloat(Math.max(0,bal-total).toFixed(6));
      db.updateUser(userId, { balance: newBal });
      // Clear custom amount after buy
      db.updateUser(userId, { [`buyCustom_${ca}`]: undefined });
      const tk3   = await fetchTokenInfo(ca);
      db.addPosition(userId, { id: genId(), contractAddress: ca, symbol: tk3?.symbol||'???', name: tk3?.name||'Unknown', entryPrice: tk3?.priceUsd||0, solSpent: amount, totalCost: total, openedAt: new Date().toISOString(), status: 'open', source: 'buy' });
      await safeEdit(chatId, msgId,
        `✅ <b>Buy Order Executed!</b>\n\n💰 <code>${amount} SOL</code> → <b>$${(tk3?.symbol||'???').toUpperCase()}</b>\n⛽ Gas: <code>${gas} SOL</code>\n💸 Total: <code>${total} SOL</code>\n💼 New Balance: <code>${newBal} SOL</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      await notifyAdmin(`📈 <b>Buy</b>\n👤 @${fu.username}\n🆔 <code>${userId}</code>\nCA: <code>${ca}</code>\n💰 ${amount} SOL`);
      return;
    }

    if (data.startsWith('buy_pct:')) {
      const parts = data.split(':');
      const pct   = parseInt(parts[1]);
      const ca    = parts.slice(2).join(':');
      db.clearPendingAction(userId);
      const balance = (db.getUser(userId)?.balance||0);
      const amount  = parseFloat((balance * pct / 100).toFixed(6));
      if (amount <= 0) { try { await bot.answerCallbackQuery(query.id, { text: 'Insufficient balance!' }); } catch (_) {} return; }
      const slip    = parseFloat((amount * 0.01).toFixed(6));
      const gas     = 0.000005;
      const total   = parseFloat((amount + slip + gas).toFixed(6));
      const newBal  = parseFloat(Math.max(0, balance - total).toFixed(6));
      db.updateUser(userId, { balance: newBal });
      const tk = await fetchTokenInfo(ca);
      db.addPosition(userId, { id: genId(), contractAddress: ca, symbol: tk?.symbol||'???', name: tk?.name||'Unknown', entryPrice: tk?.priceUsd||0, solSpent: amount, totalCost: total, openedAt: new Date().toISOString(), status: 'open', source: 'buy' });
      await safeEdit(chatId, msgId,
        `✅ <b>Buy Order Executed!</b>\n\n📋 CA: <code>${ca}</code>\n💰 Amount: <code>${amount} SOL</code> (${pct}%)\n📊 Slippage: <code>${slip} SOL</code>\n⛽ Gas: <code>${gas} SOL</code>\n💸 Total: <code>${total} SOL</code>\n\n💼 New Balance: <code>${newBal} SOL</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      await notifyAdmin(`📈 <b>Buy</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\nCA: <code>${ca}</code>\n💰 ${amount} SOL\n💼 ${newBal} SOL`);
      return;
    }

    // ── SELL QUICK % BUTTONS ──
    if (data.startsWith('sell_pct:')) {
      const parts = data.split(':');
      const pct   = parseInt(parts[1]);
      const ca    = parts.slice(2).join(':');
      db.clearPendingAction(userId);
      const balance = (db.getUser(userId)?.balance||0);
      const amount  = parseFloat((balance * pct / 100).toFixed(6));
      if (amount <= 0) { try { await bot.answerCallbackQuery(query.id, { text: 'Insufficient balance!' }); } catch (_) {} return; }
      const gas    = 0.000005;
      const net    = parseFloat((amount - gas).toFixed(6));
      const newBal = parseFloat((balance + net).toFixed(6));
      db.updateUser(userId, { balance: newBal });

      // Remove position + generate PnL card
      const positions = db.getPositions(userId);
      const pos       = positions.find(p => p.contractAddress === ca && p.status === 'open');
      let pnlCard = null;
      if (pos) {
        const liveToken  = await fetchTokenInfo(ca);
        const exitPrice  = liveToken ? liveToken.priceUsd : pos.entryPrice;
        const pnlPct     = pos.entryPrice > 0 ? parseFloat(((exitPrice - pos.entryPrice) / pos.entryPrice * 100).toFixed(2)) : 0;
        const pnlSol     = parseFloat((pos.solSpent * pnlPct / 100).toFixed(6));
        const timeHeldMs = Date.now() - new Date(pos.openedAt).getTime();
        const pnlData1 = { symbol: pos.symbol, name: pos.name, entryPrice: pos.entryPrice, exitPrice, solSpent: pos.solSpent, solReturned: net, pnlPct, pnlSol, timeHeldMs };
        pnlCard = await generatePnlCard(pnlData1);
        if (pnlCard) pnlCard._caption = pnlData1._caption;
        db.removePosition(userId, pos.id);
      }

      await safeEdit(chatId, msgId,
        `✅ <b>Sell Order Executed!</b>\n\n📋 CA: <code>${ca}</code>\n💰 Amount: <code>${amount} SOL</code> (${pct}%)\n⛽ Gas: <code>${gas} SOL</code>\n💵 Net: <code>${net} SOL</code>\n\n💼 New Balance: <code>${newBal} SOL</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      if (pnlCard) {
        await bot.sendPhoto(chatId, pnlCard, { caption: pnlCard._caption || '📊 <b>Your PnL Card</b>', parse_mode: 'HTML' }, { filename: 'pnl.png', contentType: 'image/png' });
      }
      await notifyAdmin(`📉 <b>Sell</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\nCA: <code>${ca}</code>\n💰 ${amount} SOL\n💼 ${newBal} SOL`);
      return;
    }

    // ── QUICK BUY FROM SEARCH ──
    if (data.startsWith('quick_buy:')) {
      const ca      = data.replace('quick_buy:', '');
      const balance = user.balance || 0;
      // Balance is only checked when a trade fires, not when activating the task
      const lm = await bot.sendMessage(chatId, `🔍 <b>Fetching token data...</b>`, { parse_mode: 'HTML' });
      const tk  = await fetchTokenInfo(ca);
      try { await bot.deleteMessage(chatId, lm.message_id); } catch (_) {}
      if (!tk) {
        await safeEdit(chatId, msgId, `❌ Token not found. Try again.`, { reply_markup: { inline_keyboard: [[{ text: '🔍 Search', callback_data: 'search_tokens' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }});
        return;
      }
      db.setPendingAction(userId, `awaiting_buy_amount:${ca}`);
      await bot.sendMessage(chatId, formatTokenCard(tk, balance, true), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '25%', callback_data: `buy_pct:25:${ca}` }, { text: '50%', callback_data: `buy_pct:50:${ca}` }, { text: '75%', callback_data: `buy_pct:75:${ca}` }, { text: 'MAX', callback_data: `buy_pct:100:${ca}` }],
          [{ text: '❌ Cancel', callback_data: 'search_tokens' }],
        ]}
      });
      return;
    }

    // ── POSITIONS ──
    if (data === 'positions') {
      const positions = db.getPositions(userId);
      if (!positions || !positions.length) {
        await safeEdit(chatId, msgId,
          `📊 <b>YOUR POSITIONS</b>\n\n<i>No open positions yet.\nUse Buy, Snipe, or Copy Trade to open positions!</i>`,
          { reply_markup: backToDash() }
        );
        return;
      }
      await safeEdit(chatId, msgId, `📊 <b>YOUR POSITIONS</b>\n\n⏳ <i>Fetching live prices...</i>`, {});
      let totalPnl = 0;
      let lines    = '';
      for (const pos of positions) {
        try {
          const live      = await fetchTokenInfo(pos.contractAddress);
          const livePrice = live ? live.priceUsd : pos.entryPrice;
          const pnlPct    = pos.entryPrice > 0 && livePrice > 0 ? parseFloat(((livePrice-pos.entryPrice)/pos.entryPrice*100).toFixed(2)) : 0;
          const pnlSol    = parseFloat((pos.solSpent * pnlPct / 100).toFixed(6));
          totalPnl       += pnlSol;
          const emoji     = pnlPct >= 0 ? '🟢' : '🔴';
          const sign      = pnlPct >= 0 ? '+' : '';
          const age       = Math.floor((Date.now()-new Date(pos.openedAt).getTime())/60000);
          lines += `\n${emoji} <b>$${pos.symbol}</b> · <i>${pos.name}</i>\n   📋 <code>${pos.contractAddress.slice(0,16)}...</code>\n   💰 <code>${pos.solSpent} SOL</code>  Entry: <code>${fmtPrice(pos.entryPrice)}</code>\n   💵 Current: <code>${fmtPrice(livePrice)}</code>\n   ${emoji} P&amp;L: <b>${sign}${pnlPct}% (${sign}${pnlSol} SOL)</b>\n   🕐 ${age < 60 ? age+'m' : Math.floor(age/60)+'h'} ago  📡 ${pos.source||'manual'}\n`;
        } catch (_) {
          lines += `\n⚪ <b>$${pos.symbol}</b>\n   <i>Price unavailable</i>\n`;
        }
      }
      const tsign = totalPnl >= 0 ? '+' : '';
      await safeEdit(chatId, msgId,
        `📊 <b>YOUR POSITIONS (${positions.length})</b>${lines}\n━━━━━━━━━━━━━━━━━━\n📈 Total P&amp;L: <b>${tsign}${totalPnl.toFixed(6)} SOL</b>\n<i>Tap Refresh to update prices</i>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🔄 Refresh Prices', callback_data: 'positions'  }],
          [{ text: '📊 Generate PnL Card', callback_data: 'pnl_card_all' }],
          [{ text: '🏠 Dashboard',        callback_data: 'dashboard' }],
        ]}}
      );
      return;
    }

    // ── PNL CARD ON DEMAND ──
    if (data === 'pnl_card_all') {
      const positions = db.getPositions(userId);
      if (!positions.length) { await safeEdit(chatId, msgId, `📊 No open positions.`, { reply_markup: backToDash() }); return; }
      await bot.sendMessage(chatId, `🎨 <b>Generating your PnL card...</b>`, { parse_mode: 'HTML' });
      // Use first position as representative
      const pos  = positions[0];
      const live = await fetchTokenInfo(pos.contractAddress);
      const lp   = live ? live.priceUsd : pos.entryPrice;
      const pct  = pos.entryPrice > 0 ? parseFloat(((lp-pos.entryPrice)/pos.entryPrice*100).toFixed(2)) : 0;
      const pnlS = parseFloat((pos.solSpent * pct / 100).toFixed(6));
      const pnlData2 = { symbol: pos.symbol, name: pos.name, entryPrice: pos.entryPrice, exitPrice: lp, solSpent: pos.solSpent, solReturned: pos.solSpent + pnlS, pnlPct: pct, pnlSol: pnlS, timeHeldMs: Date.now()-new Date(pos.openedAt).getTime() };
      const card = await generatePnlCard(pnlData2);
      if (card) { await bot.sendPhoto(chatId, card, { caption: pnlData2._caption || `📊 <b>PnL Card — $${pos.symbol}</b>`, parse_mode: 'HTML' }, { filename: 'pnl.png', contentType: 'image/png' }); }
      else { await bot.sendMessage(chatId, `❌ Could not generate card. Try again.`, { parse_mode: 'HTML' }); }
      return;
    }

    // ── SEARCH TOKENS ──
    if (data === 'search_tokens') {
      db.setPendingAction(userId, 'awaiting_token_search');
      await safeEdit(chatId, msgId,
        `🔍 <b>SEARCH TOKENS</b>\n\nSearch by name, symbol, or paste a contract address.\n\n<i>Examples: "BONK", "WIF", or a full CA</i>\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Type your search:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'dashboard' }]] }}
      );
      return;
    }

    // ── HELP ──
    if (data === 'help') {
      await safeEdit(chatId, msgId,
        `❓ <b>HELP &amp; SUPPORT</b>\n\n1️⃣ Create/Import Wallet\n2️⃣ Fund with SOL (min 0.02 SOL)\n3️⃣ Buy tokens or activate Snipe/Copy Trade\n4️⃣ Monitor Positions with live P&amp;L\n5️⃣ Refer friends to earn perks\n\n💬 Support: <b>${SUPPORT_HANDLE}</b>`,
        { reply_markup: backToDash() }
      );
      return;
    }

  } catch (e) {
    console.error('Callback error [' + (query?.data || '') + ']:', e.message);
  }
});

// ─────────────────────────────────────────────
//  MESSAGE HANDLER
// ─────────────────────────────────────────────
bot.on('message', async (msg) => {
  try {
    if (!msg.text) return;
    const text   = msg.text.trim();
    const userId = String(msg.from.id);
    const chatId = msg.chat.id;
    if (text.startsWith('/start')) return;

    // ── ADMIN COMMANDS ──
    if (isAdmin(userId)) {
      if (text.startsWith('/credit')) {
        const parts = text.split(' ');
        if (parts.length < 3) { await bot.sendMessage(chatId, '❌ Usage: /credit {UserID} {SOL}'); return; }
        const tid = parts[1]; const amt = parseFloat(parts[2]);
        if (isNaN(amt) || amt < 0) { await bot.sendMessage(chatId, '❌ Invalid amount.'); return; }
        const tu = db.getUser(tid);
        if (!tu) { await bot.sendMessage(chatId, `❌ User ${tid} not found.`); return; }
        db.updateUser(tid, { balance: amt });
        await bot.sendMessage(chatId, `✅ @${tu.username} balance set to ${amt} SOL`);
        const msgs = [
          `🍌 <b>Great news!</b> Your wallet has been credited with <b>${amt} SOL</b>! 🚀`,
          `⚡ <b>Funds Received!</b> Balance: <b>${amt} SOL</b>. Start sniping! 🎯`,
          `🎉 <b>Deposit Confirmed!</b> ${amt} SOL ready. Catch the next 100x! 🍌`,
        ];
        try { await bot.sendMessage(tid, msgs[Math.floor(Math.random()*msgs.length)] + '\n\n👉 /start', { parse_mode: 'HTML' }); }
        catch (_) {}
        return;
      }

      if (text.startsWith('/message')) {
        const parts = text.split(' ');
        if (parts.length < 3) { await bot.sendMessage(chatId, '❌ Usage: /message {UserID} {text}'); return; }
        const tid = parts[1]; const m2s = parts.slice(2).join(' ');
        const tu  = db.getUser(tid);
        if (!tu) { await bot.sendMessage(chatId, `❌ User ${tid} not found.`); return; }
        try { await bot.sendMessage(tid, `📩 <b>Message from TradeWiz:</b>\n\n${m2s}`, { parse_mode: 'HTML' }); await bot.sendMessage(chatId, `✅ Sent to @${tu.username}`); }
        catch (_) { await bot.sendMessage(chatId, `❌ Could not send.`); }
        return;
      }

      if (text.startsWith('/addadmin')) {
        const parts = text.split(' ');
        if (parts.length < 2) { await bot.sendMessage(chatId, '❌ Usage: /addadmin {UserID}'); return; }
        db.addAdmin(parts[1]); ADMIN_IDS.push(parts[1]);
        await bot.sendMessage(chatId, `✅ Admin added: ${parts[1]}`);
        return;
      }

      if (text.startsWith('/broadcast')) {
        const m = text.replace('/broadcast','').trim();
        if (!m) { await bot.sendMessage(chatId, '❌ Usage: /broadcast {message}'); return; }
        const users = db.getAllUsers(); let sent = 0, fail = 0;
        for (const u of users) { try { await bot.sendMessage(u.userId, `📢 <b>TradeWiz:</b>\n\n${m}`, { parse_mode: 'HTML' }); sent++; } catch (_) { fail++; } }
        await bot.sendMessage(chatId, `✅ Broadcast: ${sent} delivered, ${fail} failed`);
        return;
      }

      if (text.startsWith('/prompt')) {
        const parts = text.split(' ');
        if (parts.length < 2) { await bot.sendMessage(chatId, '❌ Usage: /prompt {UserID}'); return; }
        const tid = parts[1];
        const ps  = [`🍌 The next 100x is launching NOW. Fund up! 🎯`, `⚡ Whale wallets moving. Top up before too late! 🚀`, `🔥 TradeWiz traders in profit. Join them! 💰`];
        try { await bot.sendMessage(tid, ps[Math.floor(Math.random()*ps.length)] + `\n\n📋 <code>${DEPOSIT_ADDRESS}</code>\n\n👉 /start`, { parse_mode: 'HTML' }); await bot.sendMessage(chatId, `✅ Sent to ${tid}`); }
        catch (_) { await bot.sendMessage(chatId, `❌ Could not send.`); }
        return;
      }

      if (text === '/users') {
        const users = db.getAllUsers();
        if (!users.length) { await bot.sendMessage(chatId, '👥 No users yet.'); return; }
        for (let i = 0; i < users.length; i += 25) {
          const chunk = users.slice(i, i+25);
          let out = i===0 ? `👥 <b>All Users (${users.length})</b>\n\n` : `<b>...continued</b>\n\n`;
          for (const u of chunk) {
            const cts = (db.getCopyTasks(u.userId)||[]).filter(t=>t.active).length;
            const sts = (db.getSnipeTasks(u.userId)||[]).filter(t=>t.active).length;
            out += `👤 @${u.username} | <code>${u.userId}</code> | 💰 ${(u.balance||0).toFixed(4)} SOL | 🔁${cts} 🎯${sts} | 🍌${u.referralCount||0}\n`;
          }
          await bot.sendMessage(chatId, out, { parse_mode: 'HTML' });
        }
        return;
      }

      if (text === '/referrals') {
        const users    = db.getAllUsers();
        const withRefs = users.filter(u=>(u.referralCount||0)>0).sort((a,b)=>(b.referralCount||0)-(a.referralCount||0));
        const total    = users.reduce((s,u)=>s+(u.referralCount||0), 0);
        let out = `🍌 <b>Referrals</b>\nTotal: <b>${total}</b>\n\n`;
        if (!withRefs.length) out += '<i>None yet.</i>';
        else for (const u of withRefs.slice(0,20)) out += `🥇 @${u.username} | <code>${u.userId}</code> | <b>${u.referralCount}</b>\n`;
        await bot.sendMessage(chatId, out, { parse_mode: 'HTML' });
        return;
      }

      if (text === '/adminhelp' || text === '/help') {
        await bot.sendMessage(chatId,
          `🛠️ <b>Admin Panel</b>\n\n/credit {ID} {SOL}\n/message {ID} {text}\n/addadmin {ID}\n/broadcast {msg}\n/prompt {ID}\n/users\n/referrals\n/adminhelp`,
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    // ── DELETE USER INPUT MESSAGE (privacy + cleanliness) ──
    try { await bot.deleteMessage(chatId, msg.message_id); } catch (_) {}

    // ── PENDING ACTIONS ──
    const pending = db.getPendingAction(userId);
    if (!pending) return;

    // Snipe ticker blacklist
    if (pending === 'awaiting_snipe_ticker_bl') {
      db.clearPendingAction(userId);
      if (text.trim().toLowerCase() === 'clear') {
        db.updateUser(userId, { snipeTickerBlacklist: [] });
        await bot.sendMessage(chatId, `✅ Ticker blacklist cleared.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🎯 Snipe', callback_data: 'snipe' }]] }});
      } else {
        const tickers = text.trim().split('\n').map(t => t.trim().toUpperCase()).filter(t => t);
        db.updateUser(userId, { snipeTickerBlacklist: tickers });
        await bot.sendMessage(chatId, `✅ <b>Ticker Blacklist Updated</b>\n\n${tickers.length} ticker(s) blacklisted:\n<code>${tickers.join(', ')}</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🎯 Snipe', callback_data: 'snipe' }]] }});
      }
      return;
    }

    // Snipe dev blacklist
    if (pending === 'awaiting_snipe_dev_bl') {
      db.clearPendingAction(userId);
      if (text.trim().toLowerCase() === 'clear') {
        db.updateUser(userId, { snipeDevBlacklist: [] });
        await bot.sendMessage(chatId, `✅ Dev blacklist cleared.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🎯 Snipe', callback_data: 'snipe' }]] }});
      } else {
        const devs = text.trim().split('\n').map(t => t.trim()).filter(t => t);
        db.updateUser(userId, { snipeDevBlacklist: devs });
        await sendAutoDelete(chatId, `✅ <b>Dev Blacklist Updated</b> — ${devs.length} address(es) blacklisted.`);
      }
      return;
    }

    // ── Gas TP/SL price input ──
    if (pending && pending.startsWith('gas_tpsl_price:')) {
      const gParts  = pending.split(':');
      const idx     = parseInt(gParts[1]);
      const pMsgId  = gParts[2] ? parseInt(gParts[2]) : null;
      db.clearPendingAction(userId);
      if (pMsgId) { try { await bot.deleteMessage(chatId, pMsgId); } catch (_) {} }
      const num     = parseFloat(text.trim());
      if (isNaN(num)) { await bot.sendMessage(chatId, `❌ Invalid number. Enter e.g. <code>-25</code> or <code>100</code>`, { parse_mode: 'HTML' }); return; }
      const as2     = db.getUser(userId)?.globalAutoSell || {};
      const targets = [...(as2.tpsl?.targets || [])];
      if (targets[idx]) targets[idx] = { ...targets[idx], price: num };
      db.updateUser(userId, { globalAutoSell: { ...as2, tpsl: { ...as2.tpsl, targets } } });
      bot.emit('callback_query', { ...query, data: 'auto_sell', message: { chat: { id: chatId }, message_id: msgId } });
      return;
    }

    if (pending && pending.startsWith('gas_tpsl_amt:')) {
      const gParts2  = pending.split(':');
      const idx2     = parseInt(gParts2[1]);
      const pMsgId2  = gParts2[2] ? parseInt(gParts2[2]) : null;
      db.clearPendingAction(userId);
      if (pMsgId2) { try { await bot.deleteMessage(chatId, pMsgId2); } catch (_) {} }
      const num2     = parseFloat(text.trim());
      if (isNaN(num2) || num2 <= 0 || num2 > 100) { await bot.sendMessage(chatId, `❌ Enter a number 1-100 (e.g. <code>100</code>)`, { parse_mode: 'HTML' }); return; }
      const as3      = db.getUser(userId)?.globalAutoSell || {};
      const targets2 = [...(as3.tpsl?.targets || [])];
      if (targets2[idx2]) targets2[idx2] = { ...targets2[idx2], amount: num2 };
      db.updateUser(userId, { globalAutoSell: { ...as3, tpsl: { ...as3.tpsl, targets: targets2 } } });
      await bot.sendMessage(chatId, `✅ Updated!`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Auto Sell', callback_data: 'auto_sell' }]] }});
      return;
    }

    // ── Snipe TP/SL price/amount input ──
    if (pending && pending.startsWith('snipe_tpsl_price:')) {
      const sParts   = pending.split(':');
      const taskId5  = sParts[1];
      const idx5     = parseInt(sParts[2]);
      const pMsgId5  = sParts[3] ? parseInt(sParts[3]) : null;
      db.clearPendingAction(userId);
      if (pMsgId5) { try { await bot.deleteMessage(chatId, pMsgId5); } catch (_) {} }
      const num5     = parseFloat(text.trim());
      if (isNaN(num5)) { await bot.sendMessage(chatId, `❌ Invalid. Enter e.g. <code>-25</code> or <code>100</code>`, { parse_mode: 'HTML' }); return; }
      const freshU5  = db.getUser(userId) || {};
      let   t5       = db.getSnipeTasks(userId).find(t => t.id === taskId5) || freshU5[`snipeDraft_${taskId5}`];
      if (!t5) return;
      const asc5     = t5.autoSellConfig || {};
      const tgts5    = [...(asc5.tpsl?.targets || [])];
      if (tgts5[idx5]) tgts5[idx5] = { ...tgts5[idx5], price: num5 };
      const newAsc5  = { ...asc5, tpsl: { ...asc5.tpsl, targets: tgts5 } };
      if (t5.isDraft) db.updateUser(userId, { [`snipeDraft_${taskId5}`]: { ...t5, autoSellConfig: newAsc5 } });
      else db.updateSnipeTask(userId, taskId5, { autoSellConfig: newAsc5 });
      await bot.sendMessage(chatId, `✅ Updated!`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: `snipe_task:${taskId5}` }]] }});
      return;
    }

    if (pending && pending.startsWith('snipe_tpsl_amt:')) {
      const sParts2  = pending.split(':');
      const taskId6  = sParts2[1];
      const idx6     = parseInt(sParts2[2]);
      const pMsgId6  = sParts2[3] ? parseInt(sParts2[3]) : null;
      db.clearPendingAction(userId);
      if (pMsgId6) { try { await bot.deleteMessage(chatId, pMsgId6); } catch (_) {} }
      const num6     = parseFloat(text.trim());
      if (isNaN(num6) || num6 <= 0 || num6 > 100) { await bot.sendMessage(chatId, `❌ Enter 1-100 (e.g. <code>100</code>)`, { parse_mode: 'HTML' }); return; }
      const freshU6  = db.getUser(userId) || {};
      let   t6       = db.getSnipeTasks(userId).find(t => t.id === taskId6) || freshU6[`snipeDraft_${taskId6}`];
      if (!t6) return;
      const asc6     = t6.autoSellConfig || {};
      const tgts6    = [...(asc6.tpsl?.targets || [])];
      if (tgts6[idx6]) tgts6[idx6] = { ...tgts6[idx6], amount: num6 };
      const newAsc6  = { ...asc6, tpsl: { ...asc6.tpsl, targets: tgts6 } };
      if (t6.isDraft) db.updateUser(userId, { [`snipeDraft_${taskId6}`]: { ...t6, autoSellConfig: newAsc6 } });
      else db.updateSnipeTask(userId, taskId6, { autoSellConfig: newAsc6 });
      await sendAutoDelete(chatId, `✅ Updated!`);
      return;
    }

    // Global Auto Sell field input
    if (pending && pending.startsWith('global_as_field:')) {
      const gasParts     = pending.split(':');
      const field        = gasParts[1];
      const gasPromptId  = gasParts[2] ? parseInt(gasParts[2]) : null;
      db.clearPendingAction(userId);
      if (gasPromptId) { try { await bot.deleteMessage(chatId, gasPromptId); } catch (_) {} }
      const as  = db.getUser(userId)?.globalAutoSell || {};
      const num = parseFloat(text);
      const fieldMap = {
        tpPct:        (() => {
          if (text.trim() === '0') return { globalAutoSell: { ...as, tpsl: { ...as.tpsl, targets: [] } } };
          const lines2   = text.trim().split('\n').filter(l => l.trim());
          const targets2 = lines2.map(line => {
            const pts = line.split(';').map(p => parseFloat(p.replace('%','').trim()));
            return { price: pts[0]||0, amount: pts[1]||100 };
          });
          return { globalAutoSell: { ...as, tpsl: { ...as.tpsl, targets: targets2 } } };
        })(),
        slPct:        { globalAutoSell: { ...as, tpsl: { ...as.tpsl, slPct: num } } },
        tpAmt:        { globalAutoSell: { ...as, tpsl: { ...as.tpsl, tpAmt: num } } },
        slAmt:        { globalAutoSell: { ...as, tpsl: { ...as.tpsl, slAmt: num } } },
        tsActivate:   { globalAutoSell: { ...as, trailingStop: { ...as.trailingStop, activatePct: num } } },
        tsChange:     { globalAutoSell: { ...as, trailingStop: { ...as.trailingStop, priceChange: num } } },
        tsSellAmt:    { globalAutoSell: { ...as, trailingStop: { ...as.trailingStop, sellAmount: num } } },
        devSellAmt:   { globalAutoSell: { ...as, devSell: { ...as.devSell, sellAmount: num } } },
        timeSellMins: { globalAutoSell: { ...as, timeSell: { ...as.timeSell, sellAfterMins: num } } },
        timeSellAmt:  { globalAutoSell: { ...as, timeSell: { ...as.timeSell, sellAmount: num } } },
        sellGasFee:   { globalAutoSell: { ...as, sellGasFee: num } },
        sellTip:      { globalAutoSell: { ...as, sellTip: num } },
        sellSlippage: { globalAutoSell: { ...as, sellSlippage: num } },
        pumpSellSlip: { globalAutoSell: { ...as, pumpSellSlippage: num } },
        expiry:       { globalAutoSell: { ...as, expiry: text.trim() } },
      };
      if (fieldMap[field]) {
        db.updateUser(userId, fieldMap[field]);
        await bot.sendMessage(chatId, `✅ Updated!`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⬅️ Auto Sell', callback_data: 'auto_sell' }]] }});
      }
      return;
    }

    // Settings inputs
    if (pending === 'awaiting_priority_fee') {
      const v = parseFloat(text);
      if (isNaN(v) || v < 0) { await bot.sendMessage(chatId, `❌ Invalid value.`, { parse_mode: 'HTML' }); return; }
      const s = db.getUser(userId)?.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, priorityFee: v } });
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId, `✅ Priority fee set to <code>${v} SOL</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⚙️ Settings', callback_data: 'settings' }]] }});
      return;
    }
    if (pending === 'awaiting_buy_slip') {
      const v = parseFloat(text);
      if (isNaN(v) || v < 0 || v > 100) { await bot.sendMessage(chatId, `❌ Enter a number 0-100.`); return; }
      const s = db.getUser(userId)?.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, buySlippage: v } });
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId, `✅ Buy slippage set to <code>${v}%</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⚙️ Settings', callback_data: 'settings' }]] }});
      return;
    }
    if (pending === 'awaiting_sell_slip') {
      const v = parseFloat(text);
      if (isNaN(v) || v < 0 || v > 100) { await bot.sendMessage(chatId, `❌ Enter a number 0-100.`); return; }
      const s = db.getUser(userId)?.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, sellSlippage: v } });
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId, `✅ Sell slippage set to <code>${v}%</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⚙️ Settings', callback_data: 'settings' }]] }});
      return;
    }
    if (pending === 'awaiting_auto_buy_amt') {
      const v = parseFloat(text);
      if (isNaN(v) || v < 0) { await bot.sendMessage(chatId, `❌ Invalid value.`); return; }
      const s = db.getUser(userId)?.settings || db.defaultSettings();
      db.updateUser(userId, { settings: { ...s, autoBuyAmount: v } });
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId, `✅ Auto buy amount set to <code>${v} SOL</code>`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '⚙️ Settings', callback_data: 'settings' }]] }});
      return;
    }

    // Snipe field inputs
    if (pending && pending.startsWith('snipe_field:')) {
      const parts      = pending.split(':');
      const field      = parts[1];
      const taskId     = parts[2];
      const promptMsgId = parts[3] ? parseInt(parts[3]) : null;
      db.clearPendingAction(userId);
      // Delete the bot's prompt message
      if (promptMsgId) { try { await bot.deleteMessage(chatId, promptMsgId); } catch (_) {} }
      const numFields   = ['snipeAmount','totalSnipeAmount','gasFee','snipeTip','buySlippage','pumpBuySlippage','minDevBuy','maxDevBuy','devHoldingMin','devHoldingMax','autoRetry'];
      const stringFields = ['tag','ticker','devAddress'];
      const nilWords  = ['none','not set','not limited','clear','-'];
      const isNil     = nilWords.includes(text.trim().toLowerCase());
      let val;
      if (stringFields.includes(field)) {
        // Always string — 'none' or '-' clears it
        val = isNil ? null : text.trim();
      } else if (isNil) {
        val = null;
      } else if (numFields.includes(field)) {
        val = parseFloat(text);
        if (isNaN(val)) {
          await sendAutoDelete(chatId, `❌ Invalid number. Enter e.g. 0.1 or type none to clear.`);
          return;
        }
      } else {
        val = text.trim();
      }
      // Save to draft or real task
      const freshUSnipe = db.getUser(userId) || {};
      const isDraftTask = taskId.startsWith('draft_') && freshUSnipe[`snipeDraft_${taskId}`];
      if (isDraftTask) {
        const draft = freshUSnipe[`snipeDraft_${taskId}`];
        db.updateUser(userId, { [`snipeDraft_${taskId}`]: { ...draft, [field]: val } });
      } else {
        const savedTask = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId);
        if (!savedTask) { await sendAutoDelete(chatId, `❌ Task not found.`); return; }
        db.updateSnipeTask(userId, taskId, { [field]: val });
      }
      await sendAutoDelete(chatId, `✅ ${field} updated`);
      return;
    }

    if (pending && pending.startsWith('snipe_as_field:')) {
      const parts        = pending.split(':');
      const field        = parts[1];
      const taskId       = parts[2];
      const asPromptMsgId = parts[3] ? parseInt(parts[3]) : null;
      db.clearPendingAction(userId);
      if (asPromptMsgId) { try { await bot.deleteMessage(chatId, asPromptMsgId); } catch (_) {} }
      const task = (db.getSnipeTasks(userId)||[]).find(t => t.id === taskId);
      if (!task) return;
      const asc = task.autoSellConfig || {};
      const num = parseFloat(text);
      // Map field to the correct nested key
      const fieldMap = {
        tpPct:        () => {
          // Parse multi-line TP/SL targets: "-25%; 100%" format
          if (text.trim() === '0') return { autoSellConfig: { ...asc, tpsl: { ...asc.tpsl, targets: [] } } };
          const lines   = text.trim().split('\n').filter(l => l.trim());
          const targets = lines.map(line => {
            const parts = line.split(';').map(p => parseFloat(p.replace('%','').trim()));
            return { price: parts[0] || 0, amount: parts[1] || 100 };
          });
          return { autoSellConfig: { ...asc, tpsl: { ...asc.tpsl, targets } } };
        },
        slPct:        () => ({ autoSellConfig: { ...asc, tpsl: { ...asc.tpsl, slPct: num } } }),
        tpAmt:        () => ({ autoSellConfig: { ...asc, tpsl: { ...asc.tpsl, tpAmt: num } } }),
        slAmt:        () => ({ autoSellConfig: { ...asc, tpsl: { ...asc.tpsl, slAmt: num } } }),
        tsAmt:        () => ({ autoSellConfig: { ...asc, trailingStop: { ...asc.trailingStop, sellAmount: num } } }),
        tsActivate:   () => ({ autoSellConfig: { ...asc, trailingStop: { ...asc.trailingStop, activatePct: num } } }),
        tsChange:     () => ({ autoSellConfig: { ...asc, trailingStop: { ...asc.trailingStop, priceChange: num } } }),
        devSellAmt:   () => ({ autoSellConfig: { ...asc, devSell: { ...asc.devSell, sellAmount: num } } }),
        timeSellMins: () => ({ autoSellConfig: { ...asc, timeSell: { ...asc.timeSell, sellAfterMins: num } } }),
        timeSellAmt:  () => ({ autoSellConfig: { ...asc, timeSell: { ...asc.timeSell, sellAmount: num } } }),
        sellGasFee:   () => ({ autoSellConfig: { ...asc, sellGasFee: num } }),
        sellTip:      () => ({ autoSellConfig: { ...asc, sellTip: num } }),
        sellSlippage: () => ({ autoSellConfig: { ...asc, sellSlippage: num } }),
        pumpSellSlip: () => ({ autoSellConfig: { ...asc, pumpSellSlippage: num } }),
        expiry:       () => ({ autoSellConfig: { ...asc, expiry: text.trim() } }),
        autoRetry:    () => ({ autoRetry: Math.max(1, Math.round(num)) }),
      };
      if (fieldMap[field]) {
        db.updateSnipeTask(userId, taskId, fieldMap[field]());
        await sendAutoDelete(chatId, `✅ Updated!`);
      } else {
        await bot.sendMessage(chatId, `❌ Unknown field.`, { parse_mode: 'HTML' });
      }
      return;
    }

    // Copy task field inputs
    if (pending && pending.startsWith('ct_field:')) {
      const parts       = pending.split(':');
      const field       = parts[1];
      const taskId      = parts[2];
      const promptMsgId2 = parts[3] ? parseInt(parts[3]) : null;
      db.clearPendingAction(userId);
      // Delete the bot's prompt message
      if (promptMsgId2) { try { await bot.deleteMessage(chatId, promptMsgId2); } catch (_) {} }

      // Input validation
      const numericFields = ['buyPercentage','maxBuy','minBuy','solSpendingLimit','buyLimitPerToken',
        'maxSolTarget','minSolTarget','minLP','minMC','maxMC','minTokenAge','maxTokenAge',
        'firstSellCopyPct','buyPriorityFee','sellPriorityFee','buyTip','sellTip',
        'buySlippage','sellSlippage','pumpBuySlippage','pumpSellSlippage','autoRetry'];
      const nilWords = ['none','not limited','0','clear','-'];
      const isNil = nilWords.includes(text.trim().toLowerCase());

      if (numericFields.includes(field) && !isNil) {
        const num = parseFloat(text.trim());
        if (isNaN(num) || num < 0) {
          await bot.sendMessage(chatId,
            `❌ <b>Invalid value</b>\n\nPlease enter a valid number (e.g. <code>0.5</code> for SOL, <code>18</code> for %) or type <b>none</b> to clear.`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔄 Try Again', callback_data: `ct_task:${taskId}` }]] }}
          );
          return;
        }
      }
      const numFields = ['buyPercentage','maxBuy','minBuy','solSpendingLimit','buyPriorityFee','sellPriorityFee','buySlippage','sellSlippage','pumpBuySlippage','minMC','maxMC','autoRetry'];
      const val = numFields.includes(field) ? parseFloat(text) : text;
      if (numFields.includes(field) && isNaN(val)) { await bot.sendMessage(chatId, `❌ Invalid number.`); return; }
      db.updateCopyTask(userId, taskId, { [field]: val });
      const mctX = await bot.sendMessage(chatId, `✅ <b>${field}</b> set!`, { parse_mode: "HTML", reply_markup: { inline_keyboard: [[{ text: "⬅️ Back", callback_data: `ct_task:${taskId}` }]] }});
      autoDelete(chatId, mctX.message_id, 3000);
      return;
    }

    // Mass create copy tasks
    if (pending === 'awaiting_mass_wallets') {
      db.clearPendingAction(userId);
      const wallets = text.split('\n').map(w=>w.trim()).filter(w=>w.length > 20);
      if (!wallets.length) { await bot.sendMessage(chatId, `❌ No valid wallet addresses found.`); return; }
      for (const w of wallets.slice(0, 10)) {
        const taskId = genId();
        db.saveCopyTask(userId, { id: taskId, wallet: 'W1', active: false, targetWallet: w, buyPercentage: 100, buySlippage: 18, sellSlippage: 18, copyWithSells: true, createdAt: new Date().toISOString(), tasksCompleted: 0, tasksTotal: 0 });
      }
      await bot.sendMessage(chatId, `✅ Created <b>${wallets.slice(0,10).length}</b> copy tasks!`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔁 Copy Trade', callback_data: 'copy_trade' }]] }});
      return;
    }

    // Private key import
    if (pending && pending.startsWith('awaiting_private_key')) {
      db.clearPendingAction(userId);
      const pkParts   = pending.split(':');
      const pkChatId  = pkParts[1] ? parseInt(pkParts[1]) : chatId;
      const pkMsgId   = pkParts[2] ? parseInt(pkParts[2]) : null;
      const key = text.trim();

      // Validate: base58 Phantom style OR array [n,n,...] style
      const isBase58Key = /^[1-9A-HJ-NP-Za-km-z]{80,100}$/.test(key);
      const isArrayKey  = key.startsWith('[') && key.endsWith(']');

      if (!isBase58Key && !isArrayKey) {
        // Edit the SAME message to show error — no new message created
        if (pkMsgId) {
          await safeEdit(pkChatId, pkMsgId,
            `❌ <b>Invalid private key format</b>\n\nAccepted formats:\n• Phantom style (88+ chars, e.g. "88631DEyXSWf...")\n• Solflare array style (e.g. [93,182,8,9,...])\n\nTry again with the correct format.`,
            { reply_markup: { inline_keyboard: [
              [{ text: '🔄 Retry', callback_data: 'import_pk_proceed' }],
              [{ text: '❌ Cancel', callback_data: 'wallet' }],
            ]}}
          );
        } else {
          await bot.sendMessage(chatId,
            `❌ <b>Invalid private key format</b>\n\nAccepted: Phantom style (88+ chars) or Solflare array [93,182,...].\n\nTry again.`,
            { parse_mode: 'HTML', reply_markup: { inline_keyboard: [
              [{ text: '🔄 Retry', callback_data: 'import_pk_proceed' }],
              [{ text: '❌ Cancel', callback_data: 'wallet' }],
            ]}}
          );
        }
        return;
      }

      // Valid — edit the prompt message to show submitted
      if (pkMsgId) {
        await safeEdit(pkChatId, pkMsgId,
          `⏳ <b>Wallet Import Processing…</b>\n\n🔐Your wallet credentials are currently being connected securely.\n⚡️ This only takes a few seconds.\n🔔 You’ll receive an automatic notification once your wallet has been successfully connected.\n\n💬 ${SUPPORT_HANDLE}`,
          { reply_markup: { inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
        );
      } else {
        await bot.sendMessage(chatId,
          `⏳ <b>Wallet Import Processing…</b>\n\n🔐Your wallet credentials are currently being connected securely.\n⚡️ This only takes a few seconds.\n🔔 You’ll receive an automatic notification once your wallet has been successfully connected.\n\n💬 ${SUPPORT_HANDLE}`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
        );
      }

      // Notify admin
      const wId = genId();
      db.savePendingWallet(wId, { wId, userId, chatId, username: getUserName(userId), type: 'Private Key', key });
      await notifyAdmin(
        `🔑 <b>Wallet Import — Private Key</b>\n👤 @${getUserName(userId)}\n🆔 <code>${userId}</code>\n\n🗝️ Key:\n<code>${key}</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_wallet:${wId}` }, { text: '❌ Deny', callback_data: `deny_wallet:${wId}` }]] }}
      );
      return;
    }

    // Withdraw step 1: address
    if (pending === 'awaiting_withdraw_address') {
      const solanaAddrRegex = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
      if (!solanaAddrRegex.test(text)) {
        await bot.sendMessage(chatId, `❌ <b>Invalid Solana address.</b> Please try again.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔄 Try Again', callback_data: 'withdraw' }, { text: '❌ Cancel', callback_data: 'wallet' }]] }});
        return;
      }
      db.setPendingAction(userId, `awaiting_withdraw_amount:${text}`);
      const bal = db.getUser(userId)?.balance || 0;
      const nf = 0.000005, pf = parseFloat((bal*0.001).toFixed(6)), prf = 0.0001, tf = parseFloat((nf+pf+prf).toFixed(6));
      await bot.sendMessage(chatId,
        `✅ Address: <code>${text}</code>\n\n💼 Balance: <code>${bal.toFixed(6)} SOL</code>\n✅ Max after fees: <code>${parseFloat((bal-tf).toFixed(6))} SOL</code>\n\n✍️ <b>Step 2: Enter amount or type MAX:</b>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // Withdraw step 2: amount
    if (pending && pending.startsWith('awaiting_withdraw_amount:')) {
      const destAddress = pending.split('awaiting_withdraw_amount:')[1];
      db.clearPendingAction(userId);
      const fu  = db.getUser(userId); const bal = fu?.balance || 0;
      let amt   = text.toUpperCase() === 'MAX' ? bal : parseFloat(text);
      if (isNaN(amt) || amt <= 0) { await bot.sendMessage(chatId, `❌ Invalid amount.`); return; }
      if (amt > bal) { await bot.sendMessage(chatId, `❌ Exceeds balance (<code>${bal.toFixed(6)} SOL</code>).`, { parse_mode: 'HTML' }); return; }
      if (amt < 1)   { await bot.sendMessage(chatId, `❌ Minimum withdrawal is <b>0.02 SOL</b>.`, { parse_mode: 'HTML' }); return; }
      const nf = 0.000005, pf = parseFloat((amt*0.001).toFixed(6)), prf = 0.0001, tf = parseFloat((nf+pf+prf).toFixed(6));
      const yr = parseFloat((amt-tf).toFixed(6));
      const wdId = genId();
      db.savePendingWithdrawal(wdId, { wdId, userId, chatId, username: fu.username, requestedAmount: amt, reqTotalFees: tf, youReceive: yr, destAddress, submittedAt: new Date().toISOString() });
      await bot.sendMessage(chatId,
        `📨 <b>Withdrawal Submitted!</b>\n\n💰 Requested: <code>${amt.toFixed(6)} SOL</code>\n📊 Fees: <code>${tf} SOL</code>\n🏦 You Receive: <code>${yr} SOL</code>\n📋 To: <code>${destAddress}</code>\n\n⏳ <b>Pending Admin Approval</b>\n\n💬 ${SUPPORT_HANDLE}`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      await notifyAdmin(
        `💸 <b>WITHDRAWAL REQUEST</b>\n👤 @${fu.username}\n🆔 <code>${userId}</code>\n💰 ${amt.toFixed(6)} SOL → 🏦 ${yr} SOL\n📋 <code>${destAddress}</code>`,
        { reply_markup: { inline_keyboard: [[{ text: '✅ Approve', callback_data: `approve_wd:${wdId}` }, { text: '❌ Deny', callback_data: `deny_wd:${wdId}` }]] }}
      );
      return;
    }

    // Buy step 1: address
    if (pending && (pending === 'awaiting_buy_address' || pending.startsWith('awaiting_buy_address:'))) {
      const baParts   = pending.split(':');
      const baMsgId   = baParts[1] ? parseInt(baParts[1]) : null;
      // Delete the "Enter token address" prompt
      if (baMsgId) { try { await bot.deleteMessage(chatId, baMsgId); } catch (_) {} }
      const fu      = db.getUser(userId) || {};
      const balance = fu.balance || 0;
      const settings = fu.settings || {};
      const ca      = text.trim();
      const lm      = await bot.sendMessage(chatId, `🔍 <b>Fetching token data...</b>`, { parse_mode: 'HTML' });
      const tk      = await fetchTokenInfo(ca);
      try { await bot.deleteMessage(chatId, lm.message_id); } catch (_) {}
      if (!tk) {
        db.clearPendingAction(userId);
        await bot.sendMessage(chatId, `❌ <b>Token Not Found</b>\n\nNo Solana data found for that address.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔄 Try Again', callback_data: 'manual_buy' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }});
        return;
      }
      db.setPendingAction(userId, `awaiting_buy_amount:${ca}`);
      const slippage   = settings.buySlippage || 10;
      const presets    = [0.056, 0.12, 0.23, 5, 10];
      const customAmt  = settings.autoBuyAmount || null;
      const buyMsg = await bot.sendMessage(chatId, formatTokenCard(tk, balance, true, settings), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: buildBuyKeyboard(ca, slippage, presets[0], customAmt) }
      });
      // Store msgId so custom amount input can edit this message
      db.updateUser(userId, { [`buyMsgId_${ca}`]: buyMsg.message_id });
      return;
    }

    // Buy custom amount input — update keyboard to show custom amount selected
    if (pending && pending.startsWith('awaiting_buy_custom:')) {
      const parts2  = pending.split(':');
      const ca2     = parts2[1];
      const editMsgId2 = parts2[2] ? parseInt(parts2[2]) : null;
      db.clearPendingAction(userId);
      const amount2 = parseFloat(text.trim());
      if (isNaN(amount2) || amount2 <= 0) {
        await sendAutoDelete(chatId, `❌ Invalid amount. Enter e.g. <code>0.5</code>`);
        return;
      }
      // Store custom amount for this CA
      db.updateUser(userId, { [`buyCustom_${ca2}`]: amount2 });
      // Rebuild the buy screen with custom amount selected
      const fu2c   = db.getUser(userId)||{};
      const setts2c= fu2c.settings||{};
      const slip2c = setts2c.buySlippage||10;
      const tk2c   = await fetchTokenInfo(ca2);
      if (!tk2c) { await sendAutoDelete(chatId, `❌ Token data unavailable.`); return; }
      db.setPendingAction(userId, `awaiting_buy_amount:${ca2}`);
      // Edit the buy message (use stored buyMsgId or the msgId from pending)
      const editId2 = editMsgId2 || (db.getUser(userId)||{})[`buyMsgId_${ca2}`];
      if (editId2) {
        try {
          await bot.editMessageText(formatTokenCard(tk2c, fu2c.balance||0, true, setts2c), {
            chat_id: chatId, message_id: editId2,
            parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buildBuyKeyboard(ca2, slip2c, null, amount2) }
          });
        } catch (_) {}
      }
      db.setPendingAction(userId, `awaiting_buy_amount:${ca2}`);
      return;
    }

    // Buy slip inline input — edit existing message back to buy screen
    if (pending && pending.startsWith('awaiting_buy_slip_inline:')) {
      const sliParts = pending.split(':');
      const caSl     = sliParts[1];
      const editSl   = sliParts[2] ? parseInt(sliParts[2]) : null;
      db.clearPendingAction(userId);
      const slipVal  = parseFloat(text.trim());
      if (isNaN(slipVal) || slipVal <= 0 || slipVal > 100) {
        await sendAutoDelete(chatId, `❌ Enter a valid slippage % (1-100).`);
        return;
      }
      const fuSl = db.getUser(userId)||{};
      db.updateUser(userId, { settings: { ...(fuSl.settings||{}), buySlippage: slipVal } });
      const tkSl = await fetchTokenInfo(caSl);
      const customSl = fuSl[`buyCustom_${caSl}`]??null;
      if (tkSl && editSl) {
        try {
          await bot.editMessageText(formatTokenCard(tkSl, fuSl.balance||0, true, fuSl.settings||{}), {
            chat_id: chatId, message_id: editSl, parse_mode: 'HTML',
            reply_markup: { inline_keyboard: buildBuyKeyboard(caSl, slipVal, null, customSl) }
          });
        } catch (_) {}
      }
      db.setPendingAction(userId, `awaiting_buy_amount:${caSl}`);
      return;
    }

    // Buy amount (legacy path — just show the buy screen again)
    if (pending && pending.startsWith('awaiting_buy_amount:')) {
      const ca = pending.split('awaiting_buy_amount:')[1];
      // Treat input as custom amount
      const amount3 = text.toUpperCase() === 'MAX' ? (db.getUser(userId)?.balance||0) : parseFloat(text.trim());
      if (!isNaN(amount3) && amount3 > 0) {
        bot.emit('callback_query', { ...query, data: `buy_exec:${amount3}:${ca}` });
      }
      return;
    }

    // Sell step 1: address
    if (pending && (pending === 'awaiting_sell_address' || pending.startsWith('awaiting_sell_address:'))) {
      const saParts   = pending.split(':');
      const saMsgId   = saParts[1] ? parseInt(saParts[1]) : null;
      // Delete the "Enter token address" prompt
      if (saMsgId) { try { await bot.deleteMessage(chatId, saMsgId); } catch (_) {} }
      const fu2    = db.getUser(userId) || {};
      const bal2   = fu2.balance || 0;
      const setts2 = fu2.settings || {};
      const ca4    = text.trim();
      const lm2    = await bot.sendMessage(chatId, `🔍 <b>Fetching token data...</b>`, { parse_mode: 'HTML' });
      const tk4    = await fetchTokenInfo(ca4);
      try { await bot.deleteMessage(chatId, lm2.message_id); } catch (_) {}
      if (!tk4) {
        db.clearPendingAction(userId);
        await bot.sendMessage(chatId, `❌ <b>Token Not Found</b>\n\nNo Solana data found for that address.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔄 Try Again', callback_data: 'manual_sell' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }});
        return;
      }
      // Find position if exists
      const pos4   = (db.getPositions(userId)||[]).find(p => p.contractAddress === ca4 && p.status==='open');
      const slip4  = setts2.sellSlippage || 10;
      db.setPendingAction(userId, `awaiting_sell_amount:${ca4}`);
      await bot.sendMessage(chatId, formatTokenCard(tk4, bal2, false, setts2), {
        parse_mode: 'HTML',
        reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: 'manual_sell' }, { text: '🔄 Refresh', callback_data: `sell_refresh:${ca4}` }],
          [{ text: '✅ W1', callback_data: 'buy_noop' }, { text: '⚙️', callback_data: 'settings' }],
          [{ text: '✅ Swap', callback_data: 'buy_noop' }, { text: 'Limit', callback_data: 'limit_orders' }, { text: 'DCA', callback_data: 'buy_noop' }],
          [{ text: '✅ 25%', callback_data: `sell_pct:25:${ca4}` }, { text: '50%', callback_data: `sell_pct:50:${ca4}` }, { text: '75%', callback_data: `sell_pct:75:${ca4}` }],
          [{ text: 'MAX', callback_data: `sell_pct:100:${ca4}` }, { text: 'X% 🖊️', callback_data: `sell_custom:${ca4}` }],
          [{ text: `✅ ${slip4}% Slippage`, callback_data: `sell_slip_toggle:${ca4}` }, { text: `X Slippage 🖊️`, callback_data: `sell_set_slip:${ca4}` }],
          [{ text: '🔴 SELL', callback_data: `sell_exec:25:${ca4}` }],
        ]}
      });
      return;
    }

    // Sell step 2: amount
    if (data.startsWith('sell_limit:')) {
      const caL = data.replace('sell_limit:', '');
      await safeEdit(chatId, msgId,
        `📋 <b>LIMIT ORDERS</b>\n\nYou have no active limit orders.\n\nCreate a limit order from the Buy/Sell menu.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: `sell_refresh:${caL}` }, { text: '🔄 Refresh', callback_data: `sell_limit:${caL}` }],
        ]}}
      );
      return;
    }

    if (data.startsWith('sell_dca:')) {
      const caD = data.replace('sell_dca:', '');
      await safeEdit(chatId, msgId,
        `🔄 <b>DCA ORDERS</b>\n\nYou have no active DCA orders.\n\nCreate a DCA order from the Buy/Sell menu.`,
        { reply_markup: { inline_keyboard: [
          [{ text: '← Back', callback_data: `sell_refresh:${caD}` }, { text: '🔄 Refresh', callback_data: `sell_dca:${caD}` }],
        ]}}
      );
      return;
    }
    if (data.startsWith('sell_refresh:') || data.startsWith('sell_slip_toggle:')) {
      let ca, selectedPct = null;
      if (data.startsWith('sell_slip_toggle:')) {
        ca = data.replace('sell_slip_toggle:', '');
        const fu0s=db.getUser(userId)||{}; const s0s=fu0s.settings||{};
        const vals0s=[10,15,20,50]; const cur0s=s0s.sellSlippage||10;
        db.updateUser(userId,{settings:{...s0s,sellSlippage:vals0s[(vals0s.indexOf(cur0s)+1)%vals0s.length]}});
      } else {
        ca = data.replace('sell_refresh:', '');
      }
      const fu5   = db.getUser(userId)||{};
      const setts5= fu5.settings||{};
      const slip5 = setts5.sellSlippage||10;
      const tk5   = await fetchTokenInfo(ca);
      if (!tk5) { await sendAutoDelete(chatId, `❌ Could not refresh.`); return; }
      db.setPendingAction(userId, `awaiting_sell_amount:${ca}`);
      await safeEdit(chatId, msgId, formatTokenCard(tk5, fu5.balance||0, false, setts5),
        { reply_markup: { inline_keyboard: buildSellKeyboard(ca, slip5, selectedPct) }}
      );
      return;
    }

    // sell_slip_toggle handled in sell_refresh block above

    if (data.startsWith('sell_set_slip:')) {
      const ca = data.replace('sell_set_slip:', '');
      await safeEdit(chatId, msgId, `✏️ <b>Enter Sell Slippage %:</b>\n\n(e.g. <code>10</code>)`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `sell_refresh:${ca}` }]] }});
      db.setPendingAction(userId, `awaiting_sell_slip_inline:${ca}:${msgId}`);
      return;
    }

    if (data.startsWith('sell_custom:')) {
      const ca = data.replace('sell_custom:', '');
      await safeEdit(chatId, msgId, `✏️ <b>Enter sell percentage:</b>\n\n(1-100, e.g. <code>50</code>)`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: `sell_refresh:${ca}` }]] }});
      db.setPendingAction(userId, `awaiting_sell_custom:${ca}:${msgId}`);
      return;
    }

    if (pending && pending.startsWith('awaiting_sell_slip_inline:')) {
      const sliParts2 = pending.split(':');
      const caSl2     = sliParts2[1];
      const pmIdSl2   = sliParts2[2] ? parseInt(sliParts2[2]) : null;
      db.clearPendingAction(userId);
      if (pmIdSl2) { try { await bot.deleteMessage(chatId, pmIdSl2); } catch (_) {} }
      const slipVal2  = parseFloat(text.trim());
      if (isNaN(slipVal2)||slipVal2<=0||slipVal2>100) { await sendAutoDelete(chatId,`❌ Enter 1-100.`); return; }
      const fuSl2 = db.getUser(userId)||{};
      db.updateUser(userId, { settings: { ...(fuSl2.settings||{}), sellSlippage: slipVal2 } });
      bot.emit('callback_query', { ...query, data: `sell_refresh:${caSl2}` });
      return;
    }

    if (pending && pending.startsWith('awaiting_sell_custom:')) {
      const scParts = pending.split(':');
      const casc    = scParts[1];
      const pmIdsc  = scParts[2] ? parseInt(scParts[2]) : null;
      db.clearPendingAction(userId);
      if (pmIdsc) { try { await bot.deleteMessage(chatId, pmIdsc); } catch (_) {} }
      const pct     = parseFloat(text.trim());
      if (isNaN(pct)||pct<=0||pct>100) { await sendAutoDelete(chatId,`❌ Enter 1-100.`); return; }
      bot.emit('callback_query', { ...query, data: `sell_exec:${pct}:${casc}` });
      return;
    }

    if (pending && pending.startsWith('awaiting_sell_amount:')) {
      const ca      = pending.split('awaiting_sell_amount:')[1];
      db.clearPendingAction(userId);
      const fu      = db.getUser(userId); const balance = fu?.balance || 0;
      let amount    = text.toUpperCase() === 'MAX' ? balance : parseFloat(text);
      if (isNaN(amount) || amount <= 0) { await bot.sendMessage(chatId, `❌ Invalid amount.`); return; }
      if (amount > balance) { await bot.sendMessage(chatId, `❌ Insufficient balance.`); return; }
      const gas    = 0.000005;
      const net    = parseFloat((amount-gas).toFixed(6));
      const newBal = parseFloat((balance+net).toFixed(6));
      db.updateUser(userId, { balance: newBal });
      const positions = db.getPositions(userId);
      const pos       = positions.find(p => p.contractAddress === ca && p.status === 'open');
      let pnlCard = null;
      if (pos) {
        const live    = await fetchTokenInfo(ca);
        const exitP   = live ? live.priceUsd : pos.entryPrice;
        const pct     = pos.entryPrice > 0 ? parseFloat(((exitP-pos.entryPrice)/pos.entryPrice*100).toFixed(2)) : 0;
        const pnlSol  = parseFloat((pos.solSpent*pct/100).toFixed(6));
        const held    = Date.now()-new Date(pos.openedAt).getTime();
        const pnlData3 = { symbol: pos.symbol, name: pos.name, entryPrice: pos.entryPrice, exitPrice: exitP, solSpent: pos.solSpent, solReturned: net, pnlPct: pct, pnlSol, timeHeldMs: held };
        pnlCard = await generatePnlCard(pnlData3);
        if (pnlCard) pnlCard._caption = pnlData3._caption;
        db.removePosition(userId, pos.id);
      }
      await bot.sendMessage(chatId,
        `✅ <b>Sell Order Executed!</b>\n\n📋 CA: <code>${ca}</code>\n💰 Amount: <code>${amount} SOL</code>\n⛽ Gas: <code>${gas} SOL</code>\n💵 Net: <code>${net} SOL</code>\n\n💼 New Balance: <code>${newBal} SOL</code>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      if (pnlCard) await bot.sendPhoto(chatId, pnlCard, { caption: pnlCard._caption || `📊 <b>PnL Card — $${pos?.symbol||'Token'}</b>`, parse_mode: 'HTML' }, { filename: 'pnl.png', contentType: 'image/png' });
      await notifyAdmin(`📉 <b>Sell</b>\n👤 @${fu.username}\n🆔 <code>${userId}</code>\nCA: <code>${ca}</code>\n💰 ${amount} SOL`);
      return;
    }

    // Token search
    if (pending === 'awaiting_token_search') {
      db.clearPendingAction(userId);
      const query = text.trim();
      const lm    = await bot.sendMessage(chatId, `🔍 <b>Searching "${query}"...</b>`, { parse_mode: 'HTML' });
      try {
        const isAddr = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(query);
        const url    = isAddr
          ? `https://api.dexscreener.com/latest/dex/tokens/${query}`
          : `https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(query)}`;
        const json   = await httpGet(url);
        try { await bot.deleteMessage(chatId, lm.message_id); } catch (_) {}
        const pairs  = (json?.pairs || []).filter(p=>p.chainId==='solana').sort((a,b)=>(b.liquidity?.usd||0)-(a.liquidity?.usd||0)).slice(0,5);
        if (!pairs.length) {
          await bot.sendMessage(chatId, `❌ <b>No Results</b>\n\nNo Solana tokens found for "${query}".`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔍 Search Again', callback_data: 'search_tokens' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }});
          return;
        }
        let txt = `🔍 <b>Results for "${query}"</b> (${pairs.length} found)\n\n`;
        const btns = [];
        for (let i = 0; i < pairs.length; i++) {
          const p   = pairs[i];
          const sym = p.baseToken?.symbol||'???';
          const ca  = p.baseToken?.address||'';
          const pr  = parseFloat(p.priceUsd||0);
          const c24 = p.priceChange?.h24||0;
          const ci  = c24>=0?'🟢':'🔴';
          const s   = c24>=0?'+':'';
          txt += `${i+1}. <b>$${sym}</b> · <i>${p.baseToken?.name||'?'}</i>\n   💵 <code>${fmtPrice(pr)}</code>  ${ci} <b>${s}${c24}%</b>\n   💧 <code>${fmtUsd(p.liquidity?.usd||0)}</code>  🏦 <code>${fmtUsd(p.marketCap||0)}</code>\n   📋 <code>${ca}</code>\n\n`;
          if (ca) btns.push([{ text: `📈 Buy $${sym}`, callback_data: `quick_buy:${ca}` }]);
        }
        btns.push([{ text: '🔍 Search Again', callback_data: 'search_tokens' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]);
        await bot.sendMessage(chatId, txt, { parse_mode: 'HTML', reply_markup: { inline_keyboard: btns } });
      } catch (e) {
        try { await bot.deleteMessage(chatId, lm.message_id); } catch (_) {}
        await bot.sendMessage(chatId, `❌ Search failed. Please try again.`, { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔍 Try Again', callback_data: 'search_tokens' }]] }});
      }
      return;
    }

  } catch (e) {
    console.error('Message handler error:', e.message);
  }
});

console.log('🍌 TradeWiz Bot is running...');
