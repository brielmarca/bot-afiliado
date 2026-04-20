import { createClient as createLibSQLClient } from '@libsql/client';
import logger from '../utils/logger.js';

let db = null;
let useTurso = false;
let client = null;

const SCHEMA_USUARIOS = `
CREATE TABLE IF NOT EXISTS usuarios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  telegram_id INTEGER UNIQUE NOT NULL,
  username TEXT,
  ativo INTEGER DEFAULT 1,
  desconto_minimo INTEGER DEFAULT 30,
  categorias TEXT DEFAULT '[]',
  criado_em TEXT)
`;

const SCHEMA_OFERTAS = `
CREATE TABLE IF NOT EXISTS ofertas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  titulo TEXT,
  preco REAL,
  preco_de REAL,
  desconto_pct INTEGER,
  link_afiliado TEXT NOT NULL,
  imagem_url TEXT,
  plataforma TEXT,
  fonte TEXT,
  hash_dedup TEXT UNIQUE,
  criado_em TEXT)
`;

const SCHEMA_ENVIOS = `
CREATE TABLE IF NOT EXISTS envios (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  oferta_id INTEGER,
  usuario_id INTEGER,
  status TEXT CHECK(status IN ('enviado','falhou','bloqueado')),
  enviado_em TEXT)
`;

const INDEXES = `
CREATE INDEX IF NOT EXISTS idx_ofertas_hash ON ofertas(hash_dedup);
CREATE INDEX IF NOT EXISTS idx_ofertas_criado ON ofertas(criado_em);
CREATE INDEX IF NOT EXISTS idx_usuarios_ativo ON usuarios(ativo);
CREATE INDEX IF NOT EXISTS idx_envios_usuario ON envios(usuario_id);
`;

function initTurso(url, token) {
  client = createLibSQLClient({ 
    url, 
    authToken: token, 
    enableWrites: true
  });
  useTurso = true;

  async function execMulti(sql) {
    const statements = sql.split(';').filter((s) => s.trim());
    for (const stmt of statements) {
      if (stmt.trim()) {
        try {
          await client.execute({ sql: stmt, args: [] });
        } catch (e) {
          if (!e.message?.includes('already exists')) {
            logger.warn({ sql: stmt, erro: e.message, msg: 'Statement ignorado ou erro' });
          }
        }
      }
    }
  }

  return {
    async run(sql, params = []) {
      await client.execute({ sql, args: params });
    },
    async get(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows?.[0] || null;
    },
    async all(sql, params = []) {
      const result = await client.execute({ sql, args: params });
      return result.rows || [];
    },
    async exec(sql) {
      await execMulti(sql);
    },
    async createTables() {
      logger.info({ msg: 'Criando tabelas no Turso...' });
      await execMulti(SCHEMA_USUARIOS);
      await execMulti(SCHEMA_OFERTAS);
      await execMulti(SCHEMA_ENVIOS);
      await execMulti(INDEXES);
      logger.info({ msg: 'Tabelas criadas com sucesso' });
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
  return database.run(`DELETE FROM envios WHERE enviado_em < datetime('now', '-7 days')`);
}

export default { initDb, setDb, getDb, cleanOldData };