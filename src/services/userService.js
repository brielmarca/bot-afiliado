import logger from '../utils/logger.js';

let db = null;

export function setDb(database) {
  db = database;
}

export async function upsertUsuario({ telegram_id, username, primeiro_nome }) {
  const existing = await db.get('SELECT id FROM usuarios WHERE telegram_id = ?', [telegram_id]);
  const now = new Date().toISOString();

  if (existing) {
    await db.run(
      'UPDATE usuarios SET username = ?, criado_em = ? WHERE telegram_id = ?',
      [username || null, now, telegram_id]
    );
  } else {
    await db.run(
      'INSERT INTO usuarios (telegram_id, username, ativo, desconto_minimo, categorias, criado_em) VALUES (?, ?, 1, 30, ?, ?)',
      [telegram_id, username || null, '[]', now]
    );
  }

  return getUsuario(telegram_id);
}

export async function getUsuario(telegram_id) {
  const usuario = await db.get('SELECT * FROM usuarios WHERE telegram_id = ?', [telegram_id]);

  if (usuario && usuario.categorias) {
    try {
      usuario.categorias = JSON.parse(usuario.categorias);
    } catch {
      usuario.categorias = [];
    }
  }

  return usuario;
}

export async function setAtivo(telegram_id, ativo) {
  const now = new Date().toISOString();
  await db.run('UPDATE usuarios SET ativo = ?, criado_em = ? WHERE telegram_id = ?', [
    ativo ? 1 : 0,
    now,
    telegram_id,
  ]);
  logger.info({ telegram_id, ativo, msg: 'Status atualizado' });
}

export async function setDescontoMinimo(telegram_id, pct) {
  const valor = Math.max(0, Math.min(99, pct));
  const now = new Date().toISOString();
  await db.run('UPDATE usuarios SET desconto_minimo = ?, criado_em = ? WHERE telegram_id = ?', [
    valor,
    now,
    telegram_id,
  ]);
  logger.info({ telegram_id, desconto_minimo: valor, msg: 'Desconto mínimo atualizado' });
}

export async function setCategorias(telegram_id, categorias) {
  const categoriasJson = JSON.stringify(categorias);
  const now = new Date().toISOString();
  await db.run('UPDATE usuarios SET categorias = ?, criado_em = ? WHERE telegram_id = ?', [
    categoriasJson,
    now,
    telegram_id,
  ]);
  logger.info({ telegram_id, categorias, msg: 'Categorias atualizadas' });
}

export async function getUsuariosAtivos(descontoMinOferta) {
  const rows = await db.all(
    'SELECT * FROM usuarios WHERE ativo = 1 AND desconto_minimo <= ?',
    [descontoMinOferta]
  );

  return rows.map((row) => {
    if (row.categorias) {
      try {
        row.categorias = JSON.parse(row.categorias);
      } catch {
        row.categorias = [];
      }
    }
    return row;
  });
}

export async function getStats() {
  const total = await db.get('SELECT COUNT(*) as count FROM usuarios');
  const ativos = await db.get('SELECT COUNT(*) as count FROM usuarios WHERE ativo = 1');

  return {
    total: total?.count || 0,
    ativos: ativos?.count || 0,
  };
}

export default {
  setDb,
  upsertUsuario,
  getUsuario,
  setAtivo,
  setDescontoMinimo,
  setCategorias,
  getUsuariosAtivos,
  getStats,
};