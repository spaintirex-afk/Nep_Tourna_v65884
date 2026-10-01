import bcrypt from 'bcryptjs'
import { buildSeed } from './seed-data.js'

let D1 = null

function prepareSql(sql, args) {
  if (args.length === 1 && args[0] && typeof args[0] === 'object' && !Array.isArray(args[0])) {
    const obj = args[0]
    const names = []
    const normalized = sql.replace(/@([A-Za-z_][A-Za-z0-9_]*)/g, (_, name) => {
      names.push(name)
      return '?'
    })
    return { sql: normalized, args: names.map((n) => obj[n] ?? null) }
  }
  return { sql, args }
}

export function configureDatabase(binding) {
  D1 = binding
  return db
}

function requireD1() {
  if (!D1) throw new Error('Cloudflare D1 database is not configured.')
  return D1
}

export const db = {
  prepare(sql) {
    const database = requireD1()
    return {
      async get(...args) {
        const q = prepareSql(sql, args)
        return await database.prepare(q.sql).bind(...q.args).first()
      },
      async all(...args) {
        const q = prepareSql(sql, args)
        const result = await database.prepare(q.sql).bind(...q.args).all()
        return result.results || []
      },
      async run(...args) {
        const q = prepareSql(sql, args)
        return await database.prepare(q.sql).bind(...q.args).run()
      },
    }
  },
  async exec(sql) {
    const database = requireD1()
    const statements = sql.split(';').map((s) => s.trim()).filter(Boolean)
      .map((s) => database.prepare(s))
    if (statements.length) await database.batch(statements)
  },
  // D1 does not expose a callback transaction API. This keeps the existing
  // application contract while executing the callback sequentially. Critical
  // tournament capacity checks are additionally protected by the unique
  // registration index and a second server-side count immediately before insert.
  transaction(fn) {
    return fn()
  },
}

export function hashPassword(pw) { return bcrypt.hashSync(pw, 10) }
export function verifyPassword(pw, hash) {
  try { return bcrypt.compareSync(pw, hash) } catch { return false }
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  fullName TEXT NOT NULL,
  username TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  passwordHash TEXT NOT NULL,
  phone TEXT NOT NULL DEFAULT '',
  ffUid TEXT,
  ffIgn TEXT,
  role TEXT NOT NULL DEFAULT 'player',
  status TEXT NOT NULL DEFAULT 'active',
  createdAt TEXT NOT NULL,
  avatarColor TEXT NOT NULL DEFAULT '#1d4ed8'
);
CREATE TABLE IF NOT EXISTS wallets (userId TEXT PRIMARY KEY, available INTEGER NOT NULL DEFAULT 0, pending INTEGER NOT NULL DEFAULT 0, totalDeposited INTEGER NOT NULL DEFAULT 0, totalWithdrawn INTEGER NOT NULL DEFAULT 0, totalSpent INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS transactions (id TEXT PRIMARY KEY, userId TEXT NOT NULL, amount INTEGER NOT NULL, type TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, description TEXT NOT NULL DEFAULT '');
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tournaments (id TEXT PRIMARY KEY, data TEXT NOT NULL, createdAt TEXT NOT NULL, name TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registrations (id TEXT PRIMARY KEY, tournamentId TEXT NOT NULL, userId TEXT NOT NULL, joinedAt TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'joined');
CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, tournamentId TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS results (id TEXT PRIMARY KEY, matchId TEXT NOT NULL, tournamentId TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS deposits (id TEXT PRIMARY KEY, userId TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS withdrawals (id TEXT PRIMARY KEY, userId TEXT NOT NULL, amount INTEGER NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS announcements (id TEXT PRIMARY KEY, status TEXT NOT NULL, createdAt TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tickets (id TEXT PRIMARY KEY, userId TEXT NOT NULL, status TEXT NOT NULL, createdAt TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS audit_logs (id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, category TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS notifications (id TEXT PRIMARY KEY, userId TEXT NOT NULL, read INTEGER NOT NULL DEFAULT 0, createdAt TEXT NOT NULL, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS settings (id INTEGER PRIMARY KEY CHECK (id = 1), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, userId TEXT NOT NULL, createdAt TEXT NOT NULL, expiresAt TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS idx_tx_user ON transactions(userId);
CREATE INDEX IF NOT EXISTS idx_reg_tournament ON registrations(tournamentId);
CREATE INDEX IF NOT EXISTS idx_reg_user ON registrations(userId);
CREATE UNIQUE INDEX IF NOT EXISTS ux_reg_tournament_user ON registrations(tournamentId, userId);
CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(userId);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(userId);
`

let initialized = false
let initializing = null
export async function initializeDatabase() {
  requireD1()
  if (initialized) return
  if (initializing) return initializing
  initializing = (async () => {
    await db.exec(SCHEMA)
    await seedIfEmpty()
    initialized = true
  })()
  try { await initializing } finally { initializing = null }
}

async function hasUsers() {
  return (await db.prepare('SELECT COUNT(*) AS c FROM users').get()).c > 0
}

export async function seedIfEmpty() {
  if (await hasUsers()) return false
  const s = buildSeed()
  const statements = []
  for (const u of s.users) statements.push(db.prepare(`INSERT OR IGNORE INTO users (id,fullName,username,email,passwordHash,phone,ffUid,ffIgn,role,status,createdAt,avatarColor) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    u.id, u.fullName, u.username, u.email, hashPassword(u._plain), u.phone, u.ffUid ?? null, u.ffIgn ?? null, u.role, u.status, u.createdAt, u.avatarColor,
  ))
  for (const w of s.wallets) statements.push(db.prepare(`INSERT OR IGNORE INTO wallets (userId,available,pending,totalDeposited,totalWithdrawn,totalSpent) VALUES (?,?,?,?,?,?)`).run(w.userId,w.available,w.pending,w.totalDeposited,w.totalWithdrawn,w.totalSpent))
  for (const t of s.transactions) statements.push(db.prepare(`INSERT OR IGNORE INTO transactions (id,userId,amount,type,status,createdAt,description) VALUES (?,?,?,?,?,?,?)`).run(t.id,t.userId,t.amount,t.type,t.status,t.createdAt,t.description))
  statements.push(db.prepare(`INSERT OR IGNORE INTO meta (key,value) VALUES (?,?)`).run('txnCounter', String(s.txnCounter)))
  for (const t of s.tournaments) statements.push(db.prepare(`INSERT OR IGNORE INTO tournaments (id,data,createdAt,name) VALUES (?,?,?,?)`).run(t.id,JSON.stringify(t),t.createdAt,t.name))
  for (const r of s.registrations) statements.push(db.prepare(`INSERT OR IGNORE INTO registrations (id,tournamentId,userId,joinedAt,status) VALUES (?,?,?,?,?)`).run(r.id,r.tournamentId,r.userId,r.joinedAt,r.status))
  for (const m of s.matches) statements.push(db.prepare(`INSERT OR IGNORE INTO matches (id,tournamentId,data) VALUES (?,?,?)`).run(m.id,m.tournamentId,JSON.stringify(m)))
  for (const r of s.results) statements.push(db.prepare(`INSERT OR IGNORE INTO results (id,matchId,tournamentId,data) VALUES (?,?,?,?)`).run(r.id,r.matchId,r.tournamentId,JSON.stringify(r)))
  for (const d of s.deposits) statements.push(db.prepare(`INSERT OR IGNORE INTO deposits (id,userId,amount,status,createdAt,data) VALUES (?,?,?,?,?,?)`).run(d.id,d.userId,d.amount,d.status,d.createdAt,JSON.stringify(d)))
  for (const w of s.withdrawals) statements.push(db.prepare(`INSERT OR IGNORE INTO withdrawals (id,userId,amount,status,createdAt,data) VALUES (?,?,?,?,?,?)`).run(w.id,w.userId,w.amount,w.status,w.createdAt,JSON.stringify(w)))
  for (const a of s.announcements) statements.push(db.prepare(`INSERT OR IGNORE INTO announcements (id,status,createdAt,data) VALUES (?,?,?,?)`).run(a.id,a.status,a.createdAt,JSON.stringify(a)))
  for (const t of s.tickets) statements.push(db.prepare(`INSERT OR IGNORE INTO tickets (id,userId,status,createdAt,data) VALUES (?,?,?,?,?)`).run(t.id,t.userId,t.status,t.createdAt,JSON.stringify(t)))
  for (const a of s.auditLogs) statements.push(db.prepare(`INSERT OR IGNORE INTO audit_logs (id,timestamp,category,data) VALUES (?,?,?,?)`).run(a.id,a.timestamp,a.category,JSON.stringify(a)))
  for (const n of s.notifications) statements.push(db.prepare(`INSERT OR IGNORE INTO notifications (id,userId,read,createdAt,data) VALUES (?,?,?,?,?)`).run(n.id,n.userId,n.read ? 1 : 0,n.createdAt,JSON.stringify(n)))
  statements.push(db.prepare(`INSERT OR IGNORE INTO settings (id,data) VALUES (1,?)`).run(JSON.stringify(s.settings)))
  // Await every D1 statement. This avoids holding promises past the request.
  for (const p of statements) await p
  return true
}

let randCounter = 0
export function uid(prefix) {
  randCounter += 1
  return `${prefix}_${Date.now().toString(36)}${randCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}
export async function nextTxnId() {
  const row = await db.prepare("SELECT value FROM meta WHERE key='txnCounter'").get()
  const counter = (row ? parseInt(row.value, 10) : 0) + 1
  await db.prepare("INSERT OR IGNORE INTO meta (key,value) VALUES ('txnCounter',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(String(counter))
  return { id: `NCC-TXN-${String(counter).padStart(6, '0')}`, counter }
}
export const nowIso = () => new Date().toISOString()
