import axios from 'axios';
import crypto from 'crypto';
import logger from '../utils/logger.js';
import { rssCache } from '../utils/cache.js';

const ML_API_BASE = 'https://api.mercadolibre.com';
let mlToken = null;
let mlTokenExpiry = 0;

const SHOPEE_API = 'https://api.shopee.com.br';
const ADMITAD_API = 'https://api.admitad.com';

let db = null;

export function setDatabase(database) {
  db = database;
}

async function fetchMLToken() {
  if (mlToken && Date.now() < mlTokenExpiry - 60000) return mlToken;
  
  const clientId = process.env.ML_CLIENT_ID;
  const clientSecret = process.env.ML_CLIENT_SECRET;
  
  if (!clientId || !clientSecret) {
    logger.warn({ msg: 'ML credentials não configuradas' });
    return null;
  }
  
  try {
    const response = await axios.post(
      `${ML_API_BASE}/oauth/token`,
      new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: clientId,
        client_secret: clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    
    mlToken = response.data.access_token;
    mlTokenExpiry = Date.now() + (response.data.expires_in || 21600) * 1000;
    logger.info({ msg: 'ML token obtido' });
    return mlToken;
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Erro ao obter ML token' });
    return null;
  }
}

function buildML AffiliateLink(url) {
  const tag = process.env.ML_PARTNER_ID;
  if (!tag) return url;
  const separator = url.includes('?') ? '&' : '?';
  return `${url}${separator}tag=${tag}`;
}

function buildShopeeLink(url) {
  const pid = process.env.SHOPEE_PID;
  if (!pid) return url;
  try {
    const urlObj = new URL(url);
    const itemId = urlObj.pathname.split('/').pop()?.replace('.html', '');
    return `https://shopee.com.br/${itemId}?p=${pid}`;
  } catch {
    return url;
  }
}

function buildAliExpressLink(url) {
  const admitadCid = process.env.ADMITAD_CAMPAIGN;
  if (!admitadCid) return url;
  return `${url}?affiliate=${admitadCid}`;
}

export function buildAffiliateLink(url, plataforma) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) {
    return buildMLAffiliateLink(url);
  }
  if (urlLower.includes('shopee')) {
    return buildShopeeLink(url);
  }
  if (urlLower.includes('aliexpress')) {
    return buildAliExpressLink(url);
  }
  
  return url;
}

function detectPlatform(url) {
  const urlLower = url.toLowerCase();
  if (urlLower.includes('mercadolivre') || urlLower.includes('ml.')) return 'mercadolivre';
  if (urlLower.includes('shopee')) return 'shopee';
  if (urlLower.includes('aliexpress') || urlLower.includes('ali.')) return 'aliexpress';
  if (urlLower.includes('amazon')) return 'amazon';
  return 'desconhecida';
}

function generateHash(url) {
  return crypto.createHash('sha256').update(url).digest('hex').substring(0, 16);
}

function hashExists(hash) {
  if (!db) return false;
  const existing = db.get('SELECT id FROM ofertas WHERE hash_dedup = ?', [hash]);
  return !!existing;
}

async function saveOffer(oferta) {
  const hash = generateHash(oferta.link_afiliado);
  
  if (db) {
    const existing = await db.get('SELECT id FROM ofertas WHERE hash_dedup = ?', [hash]);
    if (existing) {
      logger.debug({ hash, msg: 'Oferta já existe' });
      return null;
    }
    
    const now = new Date().toISOString();
    await db.run(
      `INSERT INTO ofertas (titulo, preco, preco_de, desconto_pct, link_afiliado, plataforma, fonte, hash_dedup, criado_em)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        oferta.titulo,
        oferta.preco,
        oferta.preco_de,
        oferta.desconto_pct,
        oferta.link_afiliado,
        oferta.plataforma,
        oferta.fonte,
        hash,
        now,
      ]
    );
    
    logger.info({ plataforma: oferta.plataforma, msg: 'Oferta salva' });
    return hash;
  }
  
  return hash;
}

async function collectFromML() {
  const token = await fetchMLToken();
  if (!token) return [];
  
  const queries = ['celular', 'notebook', 'fone bluetooth', 'smartwatch', 'mochila', 'teclado'];
  const allOffers = [];
  
  for (const query of queries) {
    try {
      const response = await axios.get(`${ML_API_BASE}/sites/MLB/search`, {
        params: { q: query, limit: 20, condition: 'new' },
        headers: { Authorization: `Bearer ${token}` },
      });
      
      const items = response.data.results || [];
      
      for (const item of items) {
        const original = item.original_price || item.price;
        const current = item.price;
        
        if (!original || original <= current) continue;
        
        const discount = Math.round(((original - current) / original) * 100);
        if (discount < 30) continue;
        
        const oferta = {
          titulo: item.title?.substring(0, 200),
          preco: current,
          preco_de: original,
          desconto_pct: discount,
          link_afiliado: buildAffiliateLink(item.permalink, 'mercadolivre'),
          imagem_url: item.thumbnail,
          plataforma: 'mercadolivre',
          fonte: 'ml-api',
        };
        
        allOffers.push(oferta);
      }
    } catch (err) {
      logger.error({ query, erro: err.message });
    }
    
    await new Promise(r => setTimeout(r, 1000));
  }
  
  return allOffers;
}

async function fetchWithBrowser(url) {
  const cacheKey = `fetch_${crypto.createHash('md5').update(url).digest('hex')}`;
  const cached = rssCache.get(cacheKey);
  if (cached) return cached;
  
  const userAgents = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
  ];
  
  try {
    const response = await axios.get(url, {
      timeout: 10000,
      headers: {
        'User-Agent': userAgents[0],
        'Accept': 'text/html,application/xhtml+xml',
      },
    });
    
    rssCache.set(cacheKey, response.data, 300000);
    return response.data;
  } catch (err) {
    logger.error({ url, erro: err.message });
    return null;
  }
}

async function collectFromPromoSites() {
  const sites = [
    { name: 'pelando', url: 'https://www.pelando.com.br/ofertas' },
    { name: 'promobit', url: 'https://www.promobit.com.br/ofertas' },
  ];
  
  const allOffers = [];
  
  for (const site of sites) {
    const html = await fetchWithBrowser(site.url);
    if (!html) continue;
    
    const linkRegex = /href="(https?:\/\/[^"'>]+(?:mercadolivre|shopee|aliexpress|amazon)[^"']+)"/gi;
    const priceRegex = /R\$\s*(\d{1,3}(?:\.\d{3})*(?:,\d{2})/g;
    
    const links = new Set();
    let match;
    while ((match = linkRegex.exec(html)) !== null) {
      if (match[1].length < 100) links.add(match[1]);
    }
    
    for (const url of links) {
      const plataforma = detectPlatform(url);
      const oferta = {
        titulo: url.split('/').pop()?.replace(/-/g, ' ').substring(0, 100) || 'Produto',
        preco: 0,
        preco_de: 0,
        desconto_pct: 0,
        link_afiliado: buildAffiliateLink(url, plataforma),
        imagem_url: null,
        plataforma,
        fonte: site.name,
      };
      
      allOffers.push(oferta);
    }
  }
  
  return allOffers;
}

export async function runCollection() {
  logger.info({ msg: 'Iniciando coleta automática' });
  
  let allOffers = [];
  
  const mlOffers = await collectFromML();
  allOffers.push(...mlOffers);
  
  const promoOffers = await collectFromPromoSites();
  allOffers.push(...promoOffers);
  
  const savedOffers = [];
  for (const oferta of allOffers) {
    const hash = await saveOffer(oferta);
    if (hash) savedOffers.push(oferta);
  }
  
  logger.info({ total: allOffers.length, saves: savedOffers.length, msg: 'Coleta concluída' });
  return savedOffers;
}

export async function processLink(url, chatId = null) {
  const plataforma = detectPlatform(url);
  
  const oferta = {
    titulo: url.split('/').pop()?.replace(/-/g, ' ').substring(0, 150) || 'Produto',
    preco: 0,
    preco_de: 0,
    desconto_pct: 0,
    link_afiliado: buildAffiliateLink(url, plataforma),
    imagem_url: null,
    plataforma,
    fonte: chatId ? 'grupo' : 'manual',
  };
  
  const hash = await saveOffer(oferta);
  
  return { oferta, hash: !!hash };
}

export default {
  setDatabase,
  buildAffiliateLink,
  detectPlatform,
  runCollection,
  processLink,
};