import crypto from 'crypto';
import logger from '../utils/logger.js';

let db = null;

export function setDb(database) {
  db = database;
}

export function gerarHash(oferta) {
  const normalized = oferta.titulo.toLowerCase().trim();
  return crypto.createHash('sha256').update(`${normalized}|${oferta.plataforma}`).digest('hex');
}

function getYesterdayISO() {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function getTodayISO() {
  return new Date().toISOString().split('T')[0];
}

export async function salvarOferta(oferta) {
  const hashDedup = gerarHash(oferta);
  const yesterday = getYesterdayISO();

  const existing = await db.get(
    'SELECT id FROM ofertas WHERE hash_dedup = ? AND criado_em > ?',
    [hashDedup, yesterday]
  );

  if (existing) {
    logger.debug({ msg: 'Oferta duplicada', hash: hashDedup, titulo: oferta.titulo });
    return null;
  }

  const now = new Date().toISOString();
  const result = await db.run(
    `INSERT INTO ofertas (titulo, preco, preco_de, desconto_pct, link_afiliado, imagem_url, plataforma, fonte, hash_dedup, criado_em)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      oferta.titulo,
      oferta.preco,
      oferta.preco_de,
      oferta.desconto_pct,
      oferta.link_afiliado,
      oferta.imagem_url,
      oferta.plataforma,
      oferta.fonte,
      hashDedup,
      now,
    ]
  );

  logger.info({ id: result.lastInsertRowid, plataforma: oferta.plataforma, msg: 'Oferta salva' });
  return result.lastInsertRowid;
}

export async function getOferta(id) {
  return db.get('SELECT * FROM ofertas WHERE id = ?', [id]);
}

export async function getOfertasRecentes() {
  const yesterday = getYesterdayISO();
  return db.all('SELECT * FROM ofertas WHERE criado_em > ? ORDER BY criado_em DESC', [yesterday]);
}

export async function getStats() {
  const total = await db.get('SELECT COUNT(*) as count FROM ofertas');
  const today = getTodayISO();
  const hoje = await db.get(
    'SELECT COUNT(*) as count FROM ofertas WHERE date(criado_em) = ?',
    [today]
  );
  const envios = await db.get(
    'SELECT COUNT(*) as count FROM envios WHERE date(enviado_em) = ?',
    [today]
  );

  return {
    total: total?.count || 0,
    hoje: hoje?.count || 0,
    envios: envios?.count || 0,
  };
}

export async function salvarOfertas(lista) {
  let inseridas = 0;
  let duplicadas = 0;

  for (const oferta of lista) {
    const id = await salvarOferta(oferta);
    if (id) {
      inseridas++;
    } else {
      duplicadas++;
    }
  }

  return { inseridas, duplicadas };
}

export default {
  setDb,
  gerarHash,
  salvarOferta,
  getOferta,
  getOfertasRecentes,
  getStats,
  salvarOfertas,
};