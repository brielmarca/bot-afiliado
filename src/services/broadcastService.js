import userService from './userService.js';
import logger from '../utils/logger.js';

let bot = null;
let db = null;
const CHUNK_SIZE = 25;
const DELAY_MS = 50;

export function setBot(telegramBot) {
  bot = telegramBot;
}

export function setDb(database) {
  db = database;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatOfferMessage(oferta) {
  const plataforma = oferta.plataforma.toUpperCase();
  const titulo = oferta.titulo?.substring(0, 80) || 'Oferta';
  const preco = Number(oferta.preco).toFixed(2).replace('.', ',');
  const precoDe = Number(oferta.preco_de).toFixed(2).replace('.', ',');
  const desconto = oferta.desconto_pct || 0;

  let message = `🔥 [${plataforma}] ${titulo}\n\n`;
  message += `~~De: R$ ${precoDe}~~ Por: *R$ ${preco}* (${desconto}% OFF)\n\n`;
  message += `[Ver oferta ↗](${oferta.link_afiliado})`;

  return message;
}

async function sendWithRetry(chatId, text) {
  let lastError = null;

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await bot.api.sendMessage(chatId, text, {
        parse_mode: 'Markdown',
        link_preview_options: { is_disabled: true },
      });
      return { sucesso: true };
    } catch (err) {
      lastError = err;

      try {
        if (err.error_code === 403) {
          await userService.setAtivo(chatId, false);
          logger.warn({ chatId, msg: 'Usuário bloqueou o bot' });
          if (db) {
            await db.run('INSERT INTO envios (oferta_id, usuario_id, status) VALUES (?, ?, ?)', [
              null,
              chatId,
              'bloqueado',
            ]);
          }
          return { sucesso: false, bloqueado: true };
        }
      } catch (e) {
        logger.error({ erro: e.message, msg: 'Erro ao processar 403' });
      }

      if (err.error_code === 429) {
        const backoff = Math.pow(2, attempt - 1) * 1000;
        logger.warn({ chatId, attempt, backoff, msg: 'Rate limit' });
        await sleep(backoff);
        continue;
      }

      logger.error({ chatId, erro: err.message, attempt });
    }
  }

  return { sucesso: false, erro: lastError?.message };
}

export async function broadcastOferta(oferta) {
  if (!bot) {
    logger.error({ msg: 'Bot não inicializado' });
    return { enviados: 0, bloqueados: 0, falharam: 0 };
  }

  try {
    const usuarios = await userService.getUsuariosAtivos(oferta.desconto_pct);
    logger.info({ ofertaId: oferta.id, usuarios: usuarios.length, msg: 'Iniciando broadcast' });

    const results = { enviados: 0, bloqueados: 0, falharam: 0 };

    for (let i = 0; i < usuarios.length; i += CHUNK_SIZE) {
      const chunk = usuarios.slice(i, i + CHUNK_SIZE);

      for (const usuario of chunk) {
        try {
          const mensagem = formatOfferMessage(oferta);
          const resultado = await sendWithRetry(usuario.telegram_id, mensagem);

          if (db) {
            await db.run('INSERT INTO envios (oferta_id, usuario_id, status) VALUES (?, ?, ?)', [
              oferta.id,
              usuario.id,
              resultado.bloqueado ? 'bloqueado' : resultado.sucesso ? 'enviado' : 'falhou',
            ]);
          }

          if (resultado.sucesso) results.enviados++;
          else if (resultado.bloqueado) results.bloqueados++;
          else results.falharam++;
        } catch (err) {
          logger.error({ chatId: usuario.telegram_id, erro: err.message, msg: 'Falha ao enviar para usuário' });
          results.falharam++;
        }

        await sleep(DELAY_MS);
      }

      if (i + CHUNK_SIZE < usuarios.length) {
        await new Promise((r) => setImmediate(r));
      }
    }

    logger.info({ ofertaId: oferta.id, ...results, msg: 'Broadcast concluído' });
    return results;
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Falha no broadcast' });
    return { enviados: 0, bloqueados: 0, falharam: 0 };
  }
}

export async function broadcastOfertaEspecifica(ofertaId) {
  const oferta = await db.get('SELECT * FROM ofertas WHERE id = ?', [ofertaId]);
  if (!oferta) {
    return { erro: 'Oferta não encontrada' };
  }

  return broadcastOferta(oferta);
}

export async function broadcastListaOfertas(ofertas) {
  const results = { total: ofertas.length, enviados: 0 };

  for (const oferta of ofertas) {
    const result = await broadcastOferta(oferta);
    if (result) {
      results.enviados += result.enviados;
    }
  }

  return results;
}

export default { setBot, setDb, broadcastOferta, broadcastOfertaEspecifica, broadcastListaOfertas };