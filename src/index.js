import 'dotenv/config';
import { Bot } from 'grammy';
import express from 'express';
import cron from 'node-cron';
import { initDb, setDb, cleanOldData } from './db/client.js';
import userService from './services/userService.js';
import ofertaService from './services/ofertaService.js';
import broadcastService from './services/broadcastService.js';
import { registerHandlers } from './handlers/comandos.js';
import routes from './routes/index.js';
import coletores from './collectors/index.js';
import telegramListener from './collectors/telegramListener.js';
import logger from './utils/logger.js';

const app = express();
let startTime = Date.now();
let bot = null;

app.use(express.json());
app.use('/', routes);

async function runMigrations(db) {
  const schema = `
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      telegram_id INTEGER UNIQUE NOT NULL,
      username TEXT,
      ativo INTEGER DEFAULT 1,
      desconto_minimo INTEGER DEFAULT 30,
      categorias TEXT DEFAULT '[]',
      criado_em TEXT
    );

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
      criado_em TEXT
    );

    CREATE TABLE IF NOT EXISTS envios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      oferta_id INTEGER,
      usuario_id INTEGER,
      status TEXT CHECK(status IN ('enviado','falhou','bloqueado')),
      enviado_em TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_ofertas_hash ON ofertas(hash_dedup);
    CREATE INDEX IF NOT EXISTS idx_ofertas_criado ON ofertas(criado_em);
    CREATE INDEX IF NOT EXISTS idx_usuarios_ativo ON usuarios(ativo);
    CREATE INDEX IF NOT EXISTS idx_envios_usuario ON envios(usuario_id);
  `;

  try {
    await db.exec(schema);
    logger.info({ msg: 'Schema verificado/criado' });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Falha ao criar schema' });
  }
}

async function runCollection() {
  logger.info({ msg: 'Iniciando coleta de ofertas' });

  try {
    const ofertas = await coletores.coletarTodas();
    const result = await ofertaService.salvarOfertas(ofertas);

    logger.info({
      coletadas: ofertas.length,
      inseridas: result.inseridas,
      duplicadas: result.duplicadas,
      msg: 'Coleta concluída',
    });

    return result;
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Falha na coleta' });
    return { inseridas: 0, duplicadas: 0 };
  }
}

async function runBroadcast() {
  logger.info({ msg: 'Iniciando broadcast automático' });

  try {
    const ofertas = await ofertaService.getOfertasRecentes();

    if (ofertas.length === 0) {
      logger.info({ msg: 'Nenhuma oferta nova para broadcast' });
      return;
    }

    for (const oferta of ofertas) {
      try {
        await broadcastService.broadcastOferta(oferta);
      } catch (err) {
        logger.error({ ofertaId: oferta.id, erro: err.message, msg: 'Falha em oferta específica' });
      }
    }

    logger.info({ ofertas: ofertas.length, msg: 'Broadcast automático concluído' });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Falha no broadcast' });
  }
}

async function start() {
  const PORT = parseInt(process.env.PORT) || 3000;
  const BOT_TOKEN = process.env.BOT_TOKEN;

  logger.info({ msg: 'Inicializando bot de promoções', PORT, env: process.env.NODE_ENV });

  // 1. Inicializar banco primeiro
  let db;
  try {
    db = initDb();
    setDb(db);
    if (db.createTables) {
      await db.createTables();
    }
    await runMigrations(db);
    logger.info({ msg: 'Banco inicializado com sucesso' });
  } catch (err) {
    logger.fatal({ erro: err.message, msg: 'FALHA CRÍTICA: Banco não inicializou' });
  }

  if (!db) {
    logger.fatal({ msg: 'Sem banco de dados, encerrando' });
    process.exit(1);
  }

  // 2. Inicializar serviços com banco
  try {
    userService.setDb(db);
    ofertaService.setDb(db);
    broadcastService.setDb(db);
    logger.info({ msg: 'Serviços inicializados' });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Falha ao configurar serviços' });
  }

  // 3. Iniciar bot Telegram
  if (BOT_TOKEN) {
    try {
      bot = new Bot(BOT_TOKEN);
      broadcastService.setBot(bot);
      registerHandlers(bot);
      logger.info({ msg: 'Bot Telegram configurado' });
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha ao inicializar bot' });
    }
  } else {
    logger.warn({ msg: 'BOT_TOKEN não configurado' });
  }

  // 4. Iniciar listener Telegram
  const listenerToken = process.env.LISTENER_BOT_TOKEN || process.env.BOT_TOKEN;
  if (listenerToken && process.env.SOURCE_GROUP_IDS) {
    try {
      telegramListener.init(
        listenerToken,
        process.env.SOURCE_GROUP_IDS,
        async (oferta) => {
          try {
            const id = await ofertaService.salvarOferta(oferta);
            if (id) {
              setTimeout(async () => {
                await broadcastService.broadcastOferta(oferta);
              }, 5000);
            }
          } catch (err) {
            logger.error({ erro: err.message, msg: 'Falha ao salvar oferta do listener' });
          }
        }
      );
      telegramListener.start();
      logger.info({ msg: 'Telegram listener iniciado' });
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha ao iniciar listener' });
    }
  }

  // 5. Iniciar cron jobs
  const cronSchedule = process.env.CRON_SCHEDULE || '0 */3 * * *';

  cron.schedule(cronSchedule, async () => {
    try {
      await runCollection();
      setTimeout(async () => {
        await runBroadcast();
      }, 30 * 60 * 1000);
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha no cron de coleta' });
    }
  });

  cron.schedule('0 3 * * *', async () => {
    try {
      cleanOldData(db);
      logger.info({ msg: 'Dados antigos limpos' });
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha na limpeza' });
    }
  });

  logger.info({ schedule: cronSchedule, msg: 'Cron jobs agendados' });

  // 6. Iniciar servidor HTTP
  const server = app.listen(PORT, () => {
    logger.info({ port: PORT, msg: 'Servidor HTTP iniciado' });
  });

  // 7. Iniciar bot polling APENAS se existir
  if (bot) {
    try {
      await bot.start({
        drop_pending_updates: true,
      });
      logger.info({ msg: 'Bot Telegram iniciado com sucesso' });
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha ao iniciar polling do bot' });
    }
  }

  // 8. Primeira coleta após 10 segundos
  setTimeout(async () => {
    try {
      await runCollection();
      setTimeout(async () => {
        await runBroadcast();
      }, 30 * 60 * 1000);
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Falha na primeira coleta' });
    }
  }, 10000);

  logger.info({ msg: 'Sistema totalmente inicializado' });
}

process.on('uncaughtException', (err) => {
  logger.fatal({ erro: err.message, stack: err.stack, msg: 'Uncaught exception - sistema continua' });
  // Não encerrar o processo - tentar recuperar
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error({ reason: String(reason), msg: 'Unhandled rejection - sistema continua' });
});

let isShuttingDown = false;

process.on('SIGTERM', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ msg: 'SIGTERM recebido, encerrando gracefully...' });
  try {
    telegramListener.stop();
    if (bot) await bot.stop();
    logger.info({ msg: 'Encerramento completo' });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Erro no shutdown' });
  }
  process.exit(0);
});

process.on('SIGINT', async () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info({ msg: 'SIGINT recebido, encerrando gracefully...' });
  try {
    telegramListener.stop();
    if (bot) await bot.stop();
    logger.info({ msg: 'Encerramento completo' });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Erro no shutdown' });
  }
  process.exit(0);
});

// Iniciar aplicação
start().catch((err) => {
  logger.fatal({ erro: err.message, stack: err.stack, msg: 'FATAL: Falha ao iniciar' });
  process.exit(1);
});

export default { start };