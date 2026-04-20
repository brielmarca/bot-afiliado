import { Bot } from 'grammy';
import axios from 'axios';
import logger from '../utils/logger.js';
import { linkCache } from '../utils/cache.js';

let bot = null;
let onOfertaCallback = null;

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

function buildAffiliateLink(url, plataforma) {
  try {
    const urlObj = new URL(url);

    if (plataforma === 'mercadolivre') {
      const partnerId = process.env.ML_PARTNER_ID;
      if (partnerId) urlObj.searchParams.set('tag', partnerId);
    } else if (plataforma === 'shopee') {
      const pid = process.env.SHOPEE_PID;
      if (pid) {
        const pathParts = urlObj.pathname.split('/').filter(Boolean);
        const itemId = pathParts.pop()?.replace('.html', '') || '';
        const shopId = pathParts.find((p) => p.startsWith('shop/'))?.replace('shop/', '') || '';
        return `https://shope.ee/affiliate?pid=${pid}&item_id=${itemId}&shop_id=${shopId}`;
      }
    }

    return urlObj.toString();
  } catch {
    return url;
  }
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
    linkCache.set(url, result);
    return result;
  } catch (err) {
    logger.error({ url, erro: err.message });
    return { titulo: 'Produto', imagem_url: null, preco: 0 };
  }
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
      const chatId = String(ctx.msg.chat.id);

      if (!allowedGroupIds.includes(chatId)) return;

      const urls = extractUrls(ctx.msg.text);
      if (urls.length === 0) return;

      logger.info({ chatId, urls: urls.length, msg: 'URLs detectadas em grupo' });

      for (const url of urls) {
        try {
          const plataforma = detectPlatform(url);

          if (plataforma === 'desconhecida') continue;

          const ogData = await fetchOgData(url);
          const linkAfiliado = buildAffiliateLink(url, plataforma);

          const oferta = {
            titulo: ogData.titulo?.substring(0, 200) || 'Produto',
            preco: ogData.preco || 0,
            preco_de: ogData.preco || 0,
            desconto_pct: 0,
            link_afiliado: linkAfiliado,
            imagem_url: ogData.imagem_url,
            plataforma,
            fonte: 'telegram_listener',
          };

          if (onOfertaCallback) {
            await onOfertaCallback(oferta);
          }
        } catch (err) {
          logger.error({ url, erro: err.message, msg: 'Erro ao processar URL específica' });
        }
      }
    } catch (err) {
      logger.error({ erro: err.message, msg: 'Erro no handler de mensagem' });
    }
  });

  bot.on('error', (err) => {
    logger.error({ erro: err.message, msg: 'Erro no bot listener' });
  });

  logger.info({ grupos: allowedGroupIds, msg: 'Telegram listener iniciado' });
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