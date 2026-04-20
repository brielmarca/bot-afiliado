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

export async function salvarOferta(oferta) {
  const hashDedup = gerarHash(oferta);

  const existing = await db.get(
    'SELECT id FROM ofertas WHERE hash_dedup = ? AND criado_em > datetime("now", "-1 day")',
    [hashDedup]
  );

  if (existing) {
    logger.debug({ msg: 'Oferta duplicada', hash: hashDedup, titulo: oferta.titulo });
    return null;
  }

  const result = await db.run(
    `INSERT INTO ofertas (titulo, preco, preco_de, desconto_pct, link_afiliado, imagem_url, plataforma, fonte, hash_dedup)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
    ]
  );

  logger.info({ id: result.lastInsertRowid, plataforma: oferta.plataforma, msg: 'Oferta salva' });
  return result.lastInsertRowid;
}

export async function getOferta(id) {
  return db.get('SELECT * FROM ofertas WHERE id = ?', [id]);
}

export async function getOfertasRecentes() {
  return db.all(
    'SELECT * FROM ofertas WHERE criado_em > datetime("now", "-1 day") ORDER BY criado_em DESC'
  );
}

export async function getStats() {
  const total = await db.get('SELECT COUNT(*) as count FROM ofertas');
  const hoje = await db.get(
    'SELECT COUNT(*) as count FROM ofertas WHERE date(criado_em) = date("now")'
  );
  const envios = await db.get(
    'SELECT COUNT(*) as count FROM envios WHERE date(enviado_em) = date("now")'
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