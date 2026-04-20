import express from 'express';
import logger from '../utils/logger.js';
import ofertaService from '../services/ofertaService.js';
import broadcastService from '../services/broadcastService.js';
import userService from '../services/userService.js';

const router = express.Router();

let startTime = Date.now();

export function setStartTime(time) {
  startTime = time;
}

function requireAdmin(req, res, next) {
  const secret = req.headers['x-admin-secret'];
  if (secret !== process.env.ADMIN_SECRET) {
    return res.status(401).json({ erro: 'Unauthorized' });
  }
  next();
}

router.get('/health', async (req, res) => {
  try {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    
    let ofertasHoje = 0;
    let usuariosAtivos = 0;
    
    try {
      const ofertaStats = await ofertaService.getStats();
      ofertasHoje = ofertaStats?.hoje || 0;
    } catch (e) {
      logger.warn({ erro: e.message, msg: 'Erro ao buscar stats de ofertas' });
    }
    
    try {
      const userStats = await userService.getStats();
      usuariosAtivos = userStats?.ativos || 0;
    } catch (e) {
      logger.warn({ erro: e.message, msg: 'Erro ao buscar stats de usuários' });
    }

    res.json({
      status: 'ok',
      uptime: uptimeSeconds,
      ofertas_hoje: ofertasHoje,
      usuarios_ativos: usuariosAtivos,
      ts: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
    });
  } catch (err) {
    logger.error({ erro: err.message, msg: 'Healthcheck falhou' });
    res.status(500).json({ status: 'error', erro: 'Healthcheck falhou' });
  }
});

router.get('/admin/stats', requireAdmin, async (req, res) => {
  try {
    const userStats = await userService.getStats();
    const ofertaStats = await ofertaService.getStats();

    res.json({
      usuarios: userStats,
      ofertas: ofertaStats,
    });
  } catch (err) {
    logger.error({ erro: err.message });
    res.status(500).json({ erro: err.message });
  }
});

router.post('/admin/collect', requireAdmin, async (req, res) => {
  try {
    const collectors = await import('../collectors/index.js');
    const ofertas = await collectors.coletarTodas();
    const result = await ofertaService.salvarOfertas(ofertas);

    res.json({ sucesso: true, coletadas: ofertas.length, ...result });
  } catch (err) {
    logger.error({ erro: err.message });
    res.status(500).json({ erro: err.message });
  }
});

router.post('/admin/broadcast', requireAdmin, async (req, res) => {
  try {
    const ofertas = await ofertaService.getOfertasRecentes();
    const result = await broadcastService.broadcastListaOfertas(ofertas);

    res.json({ sucesso: true, ...result });
  } catch (err) {
    logger.error({ erro: err.message });
    res.status(500).json({ erro: err.message });
  }
});

router.get('/admin/test/mercadolivre', requireAdmin, async (req, res) => {
  try {
    const collector = await import('../collectors/mercadolivre.js');
    const ofertas = await collector.default.collect();

    res.json({
      fonte: 'mercadolivre',
      total: ofertas.length,
      sample: ofertas.slice(0, 3),
    });
  } catch (err) {
    logger.error({ erro: err.message });
    res.status(500).json({ erro: err.message });
  }
});

export default router;