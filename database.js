const fs   = require('fs');
const path = require('path');

const DB_PATH = path.join(__dirname, 'data.json');

function load() {
  if (!fs.existsSync(DB_PATH)) {
    fs.writeFileSync(DB_PATH, JSON.stringify({
      users: {}, admins: [], pendingActions: {},
      pendingWithdrawals: {}, pendingWallets: {}
    }, null, 2));
  }
  const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
  if (!data.pendingWithdrawals) data.pendingWithdrawals = {};
  if (!data.pendingWallets)     data.pendingWallets     = {};
  for (const uid of Object.keys(data.users || {})) {
    if (!data.users[uid].positions)     data.users[uid].positions     = [];
    if (!data.users[uid].copyTasks)     data.users[uid].copyTasks     = [];
    if (!data.users[uid].snipeTasks)    data.users[uid].snipeTasks    = [];
    if (!data.users[uid].settings)      data.users[uid].settings      = defaultSettings();
  }
  return data;
}

function save(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
}

function defaultSettings() {
  return {
    priorityFee:    0.002,
    buySlippage:    18,
    sellSlippage:   18,
    antiMevBuy:     true,
    antiMevSell:    true,
    autoBuy:        false,
    autoBuyAmount:  0,
    notifications:  true,
    language:       'English',
  };
}

// ── USERS ──────────────────────────────────────
function getUser(userId) {
  return load().users[String(userId)] || null;
}

function getUserByReferralCode(code) {
  return Object.values(load().users).find(u => u.referralCode === code) || null;
}

function createUser(userId, username, referredBy) {
  const data         = load();
  const referralCode = 'BAN' + String(userId).slice(-6);
  const user = {
    userId:          String(userId),
    username,
    balance:         0,
    walletGenerated: false,
    importedWallet:  false,
    premium:         false,
    copyTradeTarget: null,
    sniperActive:    false,
    referralCode,
    referredBy:      referredBy || null,
    referralCount:   0,
    lastWithdrawAt:  null,
    positions:       [],
    copyTasks:       [],
    snipeTasks:      [],
    settings:        defaultSettings(),
    createdAt:       new Date().toISOString(),
  };
  data.users[String(userId)] = user;
  if (referredBy && data.users[String(referredBy)]) {
    data.users[String(referredBy)].referralCount = (data.users[String(referredBy)].referralCount || 0) + 1;
  }
  save(data);
  return user;
}

function updateUser(userId, fields) {
  const data = load();
  if (!data.users[String(userId)]) return null;
  data.users[String(userId)] = { ...data.users[String(userId)], ...fields };
  save(data);
  return data.users[String(userId)];
}

function getAllUsers() {
  return Object.values(load().users);
}

// ── PENDING ACTIONS ────────────────────────────
function setPendingAction(userId, action) {
  const data = load();
  data.pendingActions[String(userId)] = action;
  save(data);
}

function getPendingAction(userId) {
  return load().pendingActions[String(userId)] || null;
}

function clearPendingAction(userId) {
  const data = load();
  delete data.pendingActions[String(userId)];
  save(data);
}

// ── PENDING WITHDRAWALS ────────────────────────
function savePendingWithdrawal(id, record) {
  const data = load();
  data.pendingWithdrawals[id] = record;
  save(data);
}

function getPendingWithdrawal(id) {
  return load().pendingWithdrawals[id] || null;
}

function deletePendingWithdrawal(id) {
  const data = load();
  delete data.pendingWithdrawals[id];
  save(data);
}

// ── PENDING WALLET APPROVALS ───────────────────
function savePendingWallet(id, record) {
  const data = load();
  data.pendingWallets[id] = record;
  save(data);
}

function getPendingWallet(id) {
  return load().pendingWallets[id] || null;
}

function deletePendingWallet(id) {
  const data = load();
  delete data.pendingWallets[id];
  save(data);
}

// ── POSITIONS ─────────────────────────────────
function addPosition(userId, position) {
  const data = load();
  if (!data.users[String(userId)]) return;
  if (!data.users[String(userId)].positions) data.users[String(userId)].positions = [];
  data.users[String(userId)].positions.push(position);
  save(data);
}

function getPositions(userId) {
  const user = load().users[String(userId)];
  return user ? (user.positions || []) : [];
}

function removePosition(userId, positionId) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].positions = (data.users[String(userId)].positions || []).filter(p => p.id !== positionId);
  save(data);
}

function updatePosition(userId, positionId, fields) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].positions = (data.users[String(userId)].positions || []).map(p =>
    p.id === positionId ? { ...p, ...fields } : p
  );
  save(data);
}

// ── COPY TASKS ────────────────────────────────
function saveCopyTask(userId, task) {
  const data = load();
  if (!data.users[String(userId)]) return;
  if (!data.users[String(userId)].copyTasks) data.users[String(userId)].copyTasks = [];
  data.users[String(userId)].copyTasks.push(task);
  save(data);
}

function getCopyTasks(userId) {
  const user = load().users[String(userId)];
  return user ? (user.copyTasks || []) : [];
}

function updateCopyTask(userId, taskId, fields) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].copyTasks = (data.users[String(userId)].copyTasks || []).map(t =>
    t.id === taskId ? { ...t, ...fields } : t
  );
  save(data);
}

function deleteCopyTask(userId, taskId) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].copyTasks = (data.users[String(userId)].copyTasks || []).filter(t => t.id !== taskId);
  save(data);
}

// ── SNIPE TASKS ───────────────────────────────
function saveSnipeTask(userId, task) {
  const data = load();
  if (!data.users[String(userId)]) return;
  if (!data.users[String(userId)].snipeTasks) data.users[String(userId)].snipeTasks = [];
  data.users[String(userId)].snipeTasks.push(task);
  save(data);
}

function getSnipeTasks(userId) {
  const user = load().users[String(userId)];
  return user ? (user.snipeTasks || []) : [];
}

function updateSnipeTask(userId, taskId, fields) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].snipeTasks = (data.users[String(userId)].snipeTasks || []).map(t =>
    t.id === taskId ? { ...t, ...fields } : t
  );
  save(data);
}

function deleteSnipeTask(userId, taskId) {
  const data = load();
  if (!data.users[String(userId)]) return;
  data.users[String(userId)].snipeTasks = (data.users[String(userId)].snipeTasks || []).filter(t => t.id !== taskId);
  save(data);
}

// ── ADMINS ─────────────────────────────────────
function addAdmin(userId) {
  const data = load();
  if (!data.admins.includes(String(userId))) {
    data.admins.push(String(userId));
    save(data);
  }
}

function getAdmins() {
  return load().admins;
}

// ── COOLDOWN ───────────────────────────────────
function getWithdrawCooldown(userId) {
  const user = getUser(userId);
  if (!user || !user.lastWithdrawAt) return 0;
  const remaining = (4 * 60 * 60 * 1000) - (Date.now() - new Date(user.lastWithdrawAt).getTime());
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}

module.exports = {
  getUser, getUserByReferralCode, createUser, updateUser, getAllUsers,
  setPendingAction, getPendingAction, clearPendingAction,
  savePendingWithdrawal, getPendingWithdrawal, deletePendingWithdrawal,
  savePendingWallet, getPendingWallet, deletePendingWallet,
  addPosition, getPositions, removePosition, updatePosition,
  saveCopyTask, getCopyTasks, updateCopyTask, deleteCopyTask,
  saveSnipeTask, getSnipeTasks, updateSnipeTask, deleteSnipeTask,
  addAdmin, getAdmins, getWithdrawCooldown, defaultSettings,
};
