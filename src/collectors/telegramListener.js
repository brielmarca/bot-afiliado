import { Bot } from 'grammy';
import axios from 'axios';
import logger from '../utils/logger.js';
import { linkCache } from '../utils/cache.js';

let bot = null;
let onOfertaCallback = null;
const chatIdsProcessados = new Set();

const LINK_REGEX = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

function extractUrls(text) {
  if (!text) return [];
  const matches = text.match(LINK_REGEX);
  return matches || [];
}

function detectPlatform(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) return 'mercadolivre';
  if (urlLower.includes('shopee')) return 'shopee';
  if (urlLower.includes('aliexpress') || urlLower.includes('ali.')) return 'aliexpress';
  if (urlLower.includes('amazon')) return 'amazon';
  return 'desconhecida';
}

function extractPrice(text) {
  const matches = text.match(/R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})?)/g);
  if (!matches || matches.length === 0) return { preco: 0, preco_de: 0 };

  const prices = matches.map((m) =>
    parseFloat(m.replace(/R\$\s*/g, '').replace(/\./g, '').replace(',', '.'))
  );

  const preco = prices[0];
  const preco_de = prices.length > 1 ? prices[1] : preco;

  return { preco, preco_de };
}

function calculateDiscount(preco, precoDe) {
  if (!precoDe || precoDe <= preco || precoDe <= 0) return 0;
  return Math.round(((precoDe - preco) / precoDe) * 100);
}

async function fetchOgData(url) {
  const cached = linkCache.get(url);
  if (cached) return cached;

  try {
    const response = await axios.get(url, {
      timeout: 8000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      },
    });

    const html = response.data;
    const titleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:title["']/i);
    const imageMatch = html.match(/<meta[^>]*property=["']og:image["'][^>]*content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]*content=["']([^"']+)["'][^>]*property=["']og:image["']/i);
    const priceMatch = html.match(/<meta[^>]*property=["']product:price:amount["'][^>]*content=["']([^"']+)["']/i);

    const title = titleMatch ? titleMatch[1] : 'Produto';
    const image = imageMatch ? imageMatch[1] : null;
    const preco = priceMatch ? parseFloat(priceMatch[1]) : 0;

    const result = { titulo: title, imagem_url: image, preco };
    linkCache.set(url, result, 30 * 60 * 1000);
    return result;
  } catch (err) {
    logger.error({ url, erro: err.message });
    return { titulo: 'Produto', imagem_url: null, preco: 0 };
  }
}

function formatOfertaMessage(oferta) {
  const plataforma = oferta.plataforma.toUpperCase();
  const preco = Number(oferta.preco).toFixed(2).replace('.', ',');
  const precoDe = Number(oferta.preco_de).toFixed(2).replace('.', ',');
  const desconto = oferta.desconto_pct || 0;

  let message = `🔥 *${plataforma}* - ${oferta.titulo?.substring(0, 80)}\n\n`;
  
  if (desconto > 0) {
    message += `💰 *DE: R$ ${precoDe}* POR: *R$ ${preco}*\n`;
    message += `🎉 *${desconto}% OFF!*\n\n`;
  } else {
    message += `💰 R$ ${preco}\n\n`;
  }
  
  message += `[Comprar ↗](${oferta.link_afiliado})`;

  return message;
}

export function init(token, groupIds, onOferta) {
  if (!token) {
    logger.warn({ msg: 'LISTENER_BOT_TOKEN não configurado, listener desativado' });
    return null;
  }

  bot = new Bot(token);
  onOfertaCallback = onOferta;

  const allowedGroupIds = groupIds?.split(',').filter(Boolean).map(String) || [];

  bot.on('message:text', async (ctx) => {
    try {
      const chatId = ctx.msg.chat.id;
      const chatIdStr = String(chatId);

      if (!allowedGroupIds.includes(chatIdStr)) return;
      if (chatIdsProcessados.has(chatId)) return;
      chatIdsProcessados.add(chatId);

      const text = ctx.msg.text || '';
      const urls = extractUrls(text);
      
      if (urls.length === 0) return;

      logger.info({ chatId, urls: urls.length, msg: 'Mensagem com URLs detectadas' });

      for (const url of urls) {
        try {
          const plataforma = detectPlatform(url);
          if (plataforma === 'desconhecida') continue;

          const ogData = await fetchOgData(url);
          const { preco, preco_de } = extractPrice(text);
          let discountPct = calculateDiscount(ogData.preco || preco, preco_de);
          
          if (!discountPct && preco_de > preco) {
            discountPct = calculateDiscount(ogData.preco || preco, preco_de);
          }

          const oferta = {
            titulo: ogData.titulo?.substring(0, 200) || text.substring(0, 100),
            preco: ogData.preco || preco || 0,
            preco_de: preco_de || ogData.preco || preco,
            desconto_pct: discountPct,
            link_afiliado: url,
            imagem_url: ogData.imagem_url,
            plataforma,
            fonte: 'telegram_listener',
          };

          const message = formatOfertaMessage(oferta);
          
          try {
            await ctx.reply(message, { parse_mode: 'Markdown' });
            logger.info({ plataforma, msg: 'Oferta enviada para o grupo' });
          } catch (e) {
            logger.error({ erro: e.message, msg: 'Erro ao enviar mensagem' });
          }

          if (onOfertaCallback) {
            try {
              await onOfertaCallback(oferta);
            } catch (e) {
              logger.error({ erro: e.message, msg: 'Erro no callback' });
            }
          }
        } catch (err) {
          logger.error({ url, erro: err.message, msg: 'Erro ao processar URL' });
        }
      }
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Erro no handler' });
    }
  });

  bot.on('error', (err) => {
    logger.error({ erro: err.message, msg: 'Erro no bot listener' });
  });

  logger.info({ grupos: allowedGroupIds, msg: 'Telegram listener iniciado (modo grupo)' });
  return bot;
}

export function start() {
  if (bot) {
    bot.start();
  }
}

export function stop() {
  if (bot) {
    bot.stop();
    bot = null;
  }
}

export default { init, start, stop };