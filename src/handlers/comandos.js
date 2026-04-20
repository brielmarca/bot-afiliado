import userService from '../services/userService.js';
import ofertaService from '../services/ofertaService.js';
import broadcastService from '../services/broadcastService.js';
import logger from '../utils/logger.js';

const adminSessions = new Set();

export function isAdmin(chatId) {
  return adminSessions.has(chatId);
}

export async function handleStart(ctx) {
  const { id: telegram_id, username, first_name } = ctx.from;

  await userService.upsertUsuario({ telegram_id, username, primeiro_nome: first_name });

  const message = `🔥 *Bem-vindo ao Bot de Ofertas!*\n\n
Aqui você recebe as melhores promoções automaticamente.\n\n
*Comandos disponíveis:*\n
/categorias - Escolher categorias de interesse\n/minimo - Definir desconto mínimo (padrão: 30%)\n/ultimas - Ver últimas ofertas\n/parar - Parar de receber ofertas\n\n
Boas compras! 🛒`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

export async function handleParar(ctx) {
  const { id: telegram_id } = ctx.from;
  await userService.setAtivo(telegram_id, false);
  await ctx.reply('❌ Você parou de receber ofertas.\n\nPara voltar, use /reativar');
}

export async function handleReativar(ctx) {
  const { id: telegram_id } = ctx.from;
  await userService.setAtivo(telegram_id, true);
  await ctx.reply('✅ Você voltou a receber ofertas!\n\nUse /categorias para escolher preferências.');
}

export async function handleMinimo(ctx) {
  const { id: telegram_id } = ctx.from;
  const args = ctx.message.text.split(' ');

  if (args.length < 2) {
    const usuario = await userService.getUsuario(telegram_id);
    const atual = usuario?.desconto_minimo || 30;
    await ctx.reply(`Seu desconto mínimo atual é: *${atual}%*\n\nPara alterar, use: /minimo [número]`, {
      parse_mode: 'Markdown',
    });
    return;
  }

  const valor = parseInt(args[1]);
  if (isNaN(valor) || valor < 0 || valor > 99) {
    await ctx.reply('Por favor, informe um número entre 0 e 99.');
    return;
  }

  await userService.setDescontoMinimo(telegram_id, valor);
  await ctx.reply(`✅ Desconto mínimo alterado para *${valor}%*`, { parse_mode: 'Markdown' });
}

export async function handleCategorias(ctx) {
  const { id: telegram_id } = ctx.from;
  const usuario = await userService.getUsuario(telegram_id);

  const categorias = ['Eletrônicos', 'Moda', 'Casa', 'Beleza', 'Todos'];
  const keyboard = [];

  for (let i = 0; i < categorias.length; i += 2) {
    const row = [];
    for (let j = 0; j < 2 && i + j < categorias.length; j++) {
      const cat = categorias[i + j];
      const selected = usuario?.categorias?.includes(cat);
      row.push({
        text: `${selected ? '✅' : '⬜'} ${cat}`,
        callback_data: `cat:${cat}`,
      });
    }
    keyboard.push(row);
  }

  await ctx.reply('Selecione suas categorias de interesse:', {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleSetCategorias(ctx) {
  const { id: telegram_id } = ctx.from;
  const args = ctx.message.text.split(' ').slice(1);

  if (args.length === 0) {
    await ctx.reply('Uso: /set_categorias x,y,z\nExemplo: /set_categorias Eletrônicos,Moda');
    return;
  }

  const categorias = args.join(' ').split(',').map((c) => c.trim()).filter(Boolean);
  await userService.setCategorias(telegram_id, categorias);
  await ctx.reply(`✅ Categorias atualizadas: ${categorias.join(', ')}`);
}

export async function handleUltimas(ctx) {
  const ofertas = await ofertaService.getOfertasRecentes();
  const top5 = ofertas.slice(0, 5);

  if (top5.length === 0) {
    await ctx.reply('Nenhuma oferta encontrada no momento. ✨');
    return;
  }

  for (const oferta of top5) {
    const plataforma = oferta.plataforma.toUpperCase();
    const preco = Number(oferta.preco).toFixed(2).replace('.', ',');
    const precoDe = Number(oferta.preco_de).toFixed(2).replace('.', ',');
    const desconto = oferta.desconto_pct || 0;

    let message = `🔥 [${plataforma}] ${oferta.titulo?.substring(0, 60)}\n\n`;
    message += `~~De: R$ ${precoDe}~~ Por: *R$ ${preco}* (${desconto}% OFF)\n`;
    message += `[Ver oferta ↗](${oferta.link_afiliado})`;

    await ctx.reply(message, { parse_mode: 'Markdown' });
  }
}

export async function handleAdmin(ctx) {
  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('Uso: /admin [senha]');
    return;
  }

  const senha = args[1];
  if (senha !== process.env.ADMIN_SECRET) {
    await ctx.reply('❌ Senha incorreta.');
    return;
  }

  adminSessions.add(ctx.from.id);
  await ctx.reply('✅ Admin autenticado!\n\nComandos disponíveis:\n/stats - Estatísticas\n/enviar_agora [id] - Broadcast imediato');
}

export async function handleStats(ctx) {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Use /admin [senha] primeiro.');
    return;
  }

  const userStats = await userService.getStats();
  const ofertaStats = await ofertaService.getStats();

  const message = `📊 *Estatísticas*\n\n
👥 Usuários: ${userStats.total} (${userStats.ativos} ativos)
📦 Ofertas: ${ofertaStats.total} total (${ofertaStats.hoje} hoje)
✅ Envios hoje: ${ofertaStats.envios}`;

  await ctx.reply(message, { parse_mode: 'Markdown' });
}

export async function handleEnviarAgora(ctx) {
  if (!isAdmin(ctx.from.id)) {
    await ctx.reply('❌ Use /admin [senha] primeiro.');
    return;
  }

  const args = ctx.message.text.split(' ');
  if (args.length < 2) {
    await ctx.reply('Uso: /enviar_agora [id]');
    return;
  }

  const ofertaId = parseInt(args[1]);
  if (isNaN(ofertaId)) {
    await ctx.reply('ID inválido.');
    return;
  }

  await ctx.reply('⏳ Enviando...');
  const result = await broadcastService.broadcastOfertaEspecifica(ofertaId);

  if (result.erro) {
    await ctx.reply(`❌ ${result.erro}`);
  } else {
    await ctx.reply(`✅ Enviado para ${result.enviados} usuários`);
  }
}

export async function handleCallbackQuery(ctx) {
  const { data } = ctx.callbackQuery;

  if (data?.startsWith('cat:')) {
    const categoria = data.replace('cat:', '');
    const usuario = await userService.getUsuario(ctx.from.id);

    let categorias = usuario?.categorias || [];

    if (categorias.includes(categoria)) {
      categorias = categorias.filter((c) => c !== categoria);
    } else {
      if (categoria !== 'Todos') {
        categorias = categorias.filter((c) => c !== 'Todos');
      }
      categorias.push(categoria);
    }

    if (categorias.includes('Todos')) {
      categorias = ['Todos'];
    }

    await userService.setCategorias(ctx.from.id, categorias);
    await ctx.answerCallbackQuery(`Categoria ${categoria} atualizada!`);
    await handleCategorias(ctx.callbackQuery.message);
  }
}

export function registerHandlers(bot) {
  bot.command('start', handleStart);
  bot.command('parar', handleParar);
  bot.command('reativar', handleReativar);
  bot.command('minimo', handleMinimo);
  bot.command('categorias', handleCategorias);
  bot.command('set_categorias', handleSetCategorias);
  bot.command('ultimas', handleUltimas);
  bot.command('admin', handleAdmin);
  bot.command('stats', handleStats);
  bot.command('enviar_agora', handleEnviarAgora);
  bot.on('callback_query:data', handleCallbackQuery);
}

export default { registerHandlers, isAdmin };