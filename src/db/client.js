import { createClient as createLibSQLClient } from '@libsql/client';
import { existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import logger from '../utils/logger.js';

let db = null;
let useTurso = false;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS usuarios (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id     INTEGER UNIQUE NOT NULL,
  username        TEXT,
  ativo           INTEGER DEFAULT 1,
  desconto_minimo INTEGER DEFAULT 30,
  categorias      TEXT DEFAULT '[]',
  criado_em       TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS ofertas (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo        TEXT,
  preco         REAL,
  preco_de      REAL,
  desconto_pct  INTEGER,
  link_afiliado TEXT NOT NULL,
  imagem_url    TEXT,
  plataforma    TEXT,
  fonte         TEXT,
  hash_dedup    TEXT UNIQUE,
  criado_em     TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS envios (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  oferta_id  INTEGER REFERENCES ofertas(id),
  usuario_id INTEGER REFERENCES usuarios(id),
  status     TEXT CHECK(status IN ('enviado','falhou','bloqueado')),
  enviado_em TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_ofertas_hash   ON ofertas(hash_dedup);
CREATE INDEX IF NOT EXISTS idx_ofertas_criado ON ofertas(criado_em);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo ON usuarios(ativo);
CREATE INDEX IF NOT EXISTS idx_envios_usuario ON envios(usuario_id);
`;

function initTurso(url, token) {
  const client = createLibSQLClient({ url, authToken: token });
  useTurso = true;

  return {
    async run(sql, params = []) {
      await client.execute({ sql, args: params });
    },
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows[0] || null;
    },
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows;
    },
    async exec(sql) {
      const statements = sql.split(';').filter((s) => s.trim());
      for (const stmt of statements) {
        if (stmt.trim()) {
          await client.execute({ sql: stmt, args: [] });
        }
      }
    },
    close() {
      return client.close();
    },
  };
}

export function initDb() {
  const tursoUrl = process.env.TURSO_URL;
  const tursoToken = process.env.TURSO_TOKEN;

  if (!tursoUrl || !tursoToken) {
    throw new Error('TURSO_URL e TURSO_TOKEN são obrigatórios');
  }

  logger.info({ msg: 'Usando Turso como banco de dados' });
  return initTurso(tursoUrl, tursoToken);
}

export function setDb(database) {
  db = database;
}

export function getDb() {
  return db;
}

export function cleanOldData(database = db) {
  if (!database) return;

  if (useTurso) {
    return database.run(`DELETE FROM envios WHERE enviado_em < datetime('now', '-7 days')`);
  }

  return database.run(`DELETE FROM envios WHERE enviado_em < datetime('now', '-7 days')`);
}

export default { initDb, setDb, getDb, cleanOldData };