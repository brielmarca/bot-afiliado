# Bot de Promoções Afiliado para Telegram

Sistema completo de coleta e distribuição automática de ofertas para Telegram. Executa 24/7 na nuvem gratuitamente (Render.com).

## Arquitetura

```
┌─────────────────────────────────────────────────────────────────┐
│                        FONTES DE OFERTAS                        │
├──────────────────┬──────────────────┬──────────────────────────┤
│  Mercado Livre   │  Shopee (RSS)    │  RSS (Pelando,           │
│  API oficial     │  Promobit        │  Promobit, Cuponomia)    │
└────────┬─────────┴────────┬─────────┴────────────┬─────────────┘
         │                  │                      │
         ▼                  ▼                      ▼
┌─────────────────────────────────────────────────────────────────┐
│                      COLETORES (async)                          │
│  • mercadolivre.js - OAuth2 + search API                       │
│  • shopee.js - RSS filtrado por shopee                         │
│  • rss.js - Pelando/Promobit/Cuponomia                         │
│  • telegramListener.js - Bot que monitora grupos               │
└─────────────────────────────┬───────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                      OFERTA SERVICE                             │
│  • Deduplicação SHA256 (24h)                                    │
│  • Normalização + persistência SQLite/Turso                    │
└─────────────────────────────┬───────────────────────────────────┘
                              │
         ┌────────────────────┴────────────────────┐
         ▼                                         ▼
┌──────────────────┐                    ┌─────────────────────────┐
│  USER SERVICE    │                    │   BROADCAST SERVICE     │
│  • Cadastro      │                    │  • Rate limit 25 msgs   │
│  • Preferências  │                    │  • Backoff 429          │
│  • Opt-in/out    │                    │  • Bloqueio 403→false   │
└──────────────────┘                    └────────────┬────────────┘
                                                     │
                                                     ▼
                                            ┌───────────────┐
                                            │   TELEGRAM    │
                                            │   (grammy)    │
                                            └───────────────┘
```

## Variáveis de Ambiente

| Variável | Obrigatória | Descrição |
|----------|-------------|-----------|
| `BOT_TOKEN` | ✅ | Token do bot Telegram (BotFather) |
| `ADMIN_SECRET` | ✅ | Senha para comandos admin |
| `ML_CLIENT_ID` | ✅ | Client ID do Mercado Livre Afiliados |
| `ML_CLIENT_SECRET` | ✅ | Client Secret do Mercado Livre |
| `ML_PARTNER_ID` | ✅ | Tag de afiliado Mercado Livre |
| `SOURCE_GROUP_IDS` | ✅ | IDs dos grupos para monitorar (separados por vírgula) |
| `CRON_SCHEDULE` | ✅ | Cron schedule para coleta (padrão: `0 */3 * * *`) |
| `PORT` | ✅ | Porta do servidor HTTP (padrão: 3000) |
| `NODE_ENV` | ✅ | Ambiente (production/development) |
| `DATABASE_PATH` | ✅ | Caminho do banco SQLite (padrão: ./data/bot.db) |
| `MIN_DISCOUNT_DEFAULT` | ❌ | Desconto mínimo padrão (padrão: 30) |
| `SHOPEE_PID` | ❌ | PID do Shopee Afiliados |
| `LISTENER_BOT_TOKEN` | ❌ | Token do bot listener (opcional) |
| `TURSO_URL` | ❌ | URL do Turso (se usar banco remoto) |
| `TURSO_TOKEN` | ❌ | Token do Turso (se usar banco remoto) |

## Deploy no Render.com

### 1. Preparar Repositório
```bash
git init
git add .
git commit -m "Initial commit"
```

### 2. Criar Conta Render
1. Acesse [render.com](https://render.com)
2. Conecte sua conta GitHub

### 3. Criar Web Service
1. **New → Web Service**
2. Conecte seu repositório
3. Configure:
   - Name: `bot-afiliado`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `node src/index.js`

### 4. Adicionar Variáveis
No painel do Render, adicione todas as variáveis de ambiente (exceto TURSO_URL e TURSO_TOKEN se usar SQLite local).

### 5. Adicionar Disco
1. No serviço criado, vá em **Disks**
2. Create New Disk:
   - Name: `sqlite-data`
   - Mount Path: `/app/data`
   - Size: 1GB

### 6. Deploy
O deploy inicia automaticamente. Após concluído, verifique `/health` para confirmar que está rodando.

## Comandos do Bot

| Comando | Descrição |
|---------|-----------|
| `/start` | Iniciar e criar cadastro |
| `/categorias` | Selecionar categorias de interesse |
| `/minimo [n]` | Definir desconto mínimo (padrão: 30%) |
| `/set_categorias x,y,z` | Definir categorias por texto |
| `/parar` | Parar de receber ofertas |
| `/reativar` | Voltar a receber ofertas |
| `/ultimas` | Ver últimas ofertas |

### Comandos Admin

| Comando | Descrição |
|---------|-----------|
| `/admin [senha]` | Autenticar como admin |
| `/stats` | Ver estatísticas |
| `/enviar_agora [id]` | Broadcast de oferta específica |

## Endpoints HTTP

| Endpoint | Método | Descrição |
|----------|--------|-----------|
| `/health` | GET | Health check |
| `/admin/stats` | GET | Estatísticas (requer header `x-admin-secret`) |
| `/admin/collect` | POST | Executar coleta manualmente |
| `/admin/broadcast` | POST | Executar broadcast das ofertas |
| `/admin/test/mercadolivre` | GET | Testar coletor ML |

## Usando Turso (Opcional)

Para usar banco de dados remoto Turso em vez de SQLite local:

1. Criar conta em [turso.tech](https://turso.tech)
2. Criar banco: `turso db create bot-afiliado`
3. Obter URL e token
4. Adicionar ao Render:
   - `TURSO_URL`: URL do banco
   - `TURSO_TOKEN`: Token de acesso

## Deploy no Render com Turso

Após criar o banco Turso (seção acima), siga estes passos para fazer deploy no Render com banco de dados remoto:

### 1. Preparar o Repositório

```bash
git init
git add .
git commit -m "Initial commit"
```

### 2. Criar Conta no Render

1. Acesse [render.com](https://render.com)
2. Faça login com GitHub
3. Autorize o acesso aos repositórios

### 3. Criar Web Service

1. No dashboard Render, clique em **New → Web Service**
2. Conecte seu repositório GitHub
3. Configure:
   - **Name**: `bot-afiliado`
   - **Environment**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node src/index.js`
   - **Plan**: Free

### 4. Configurar Variáveis de Ambiente

No painel do serviço, vá em **Environment** e adicione:

| Variável | Valor |
|----------|-------|
| `NODE_ENV` | production |
| `PORT` | 3000 |
| `BOT_TOKEN` | seu_bot_token |
| `ADMIN_SECRET` | sua_senha_admin |
| `ML_CLIENT_ID` | seu_client_id |
| `ML_CLIENT_SECRET` | seu_client_secret |
| `ML_PARTNER_ID` | sua_tag |
| `SOURCE_GROUP_IDS` | ids_dos_grupos |
| `CRON_SCHEDULE` | 0 */3 * * * |
| `DATABASE_PATH` | ./data/bot.db |
| `MIN_DISCOUNT_DEFAULT` | 30 |
| `TURSO_URL` | libsql://seu-token@nome-do-banco.turso.io |
| `TURSO_TOKEN` | seu-token-de-acesso |

### 5. Não Necessário Adicionar Disco

Como está usando Turso (banco remoto), não é necessário criar disco local para SQLite.

### 6. Deploy Automático

O Render fará deploy automaticamente após cada push para main.

### 7. Verificar Funcionamento

Acesse `https://seu-servico.onrender.com/health` para confirmar que o bot está rodando.

### 8. Testar Coleta

Execute um teste de coleta:
```
curl -X POST https://seu-servico.onrender.com/admin/collect
```

## Troubleshooting Deploy

**Erro "Connection refused" ao Turso:**
- Verificar se `TURSO_URL` e `TURSO_TOKEN` estão corretos
- Verificar se o banco Turso está ativo

**Erro "Disk" no deploy:**
- Se não usar Turso, crie um Disco conforme instrução anterior
- Se usar Turso, remova `DATABASE_PATH` das variáveis

**Bot não responde:**
- Verificar logs no painel do Render
- Confirme que `BOT_TOKEN` está correto

## Desenvolvimento Local

```bash
# Instalar dependências
npm install

# Criar arquivo .env
cp .env.example .env
# Preencher com suas credenciais

# Rodar
npm run dev
```

## Estrutura do Projeto

```
bot-afiliado/
├── src/
│   ├── index.js              ← Boot principal
│   ├── db/client.js          ← SQLite/Turso
│   ├── collectors/
│   │   ├── index.js          ← Orquestrador
│   │   ├── mercadolivre.js   ← API ML
│   │   ├── shopee.js         ← RSS Shopee
│   │   ├── rss.js            ← RSS genérico
│   │   └── telegramListener.js
│   ├── services/
│   │   ├── userService.js    ← CRUD usuários
│   │   ├── ofertaService.js  ← Deduplicação
│   │   └── broadcastService.js
│   ├── handlers/comandos.js  ← Comandos bot
│   ├── routes/index.js       ← Endpoints HTTP
│   └── utils/
│       ├── logger.js         ← Pino
│       ├── cache.js          ← Cache em memória
│       └── retry.js          ← Retry com backoff
├── package.json
├── Dockerfile
├── render.yaml
└── .env.example
```

## Licença

MIT