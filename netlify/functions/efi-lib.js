// Cliente mínimo para a API Pix da Efí (ex-Gerencianet), sem dependências externas.
// Arquivo: netlify/functions/efi-lib.js
//
// A API da Efí exige autenticação mTLS (certificado .p12 da própria conta) EM TODAS as
// chamadas, inclusive para pegar o token OAuth2. Por isso usamos o módulo nativo 'https'
// (em vez do fetch global), que permite passar pfx/passphrase por requisição.
//
// O certificado fica em netlify/functions/efi-cert.p12 (embutido no pacote da function via
// "included_files" no netlify.toml) — NÃO como variável de ambiente, porque o AWS Lambda
// (que roda por trás do Netlify) tem um limite de 4KB para todas as env vars somadas, e o
// certificado sozinho já estoura isso.
//
// ── Variáveis de ambiente esperadas (configure no painel do Netlify, nunca no código) ──
//   EFI_CLIENT_ID            -> Client_Id da aplicação Efí
//   EFI_CLIENT_SECRET        -> Client_Secret da aplicação Efí
//   EFI_CERT_PASSPHRASE      -> senha do .p12 (deixe vazio se o certificado não tiver senha)
//   EFI_AMBIENTE             -> 'producao' (padrão) ou 'homologacao'
//   EFI_PIX_KEY              -> a chave Pix cadastrada na Efí que RECEBE os pagamentos
//   EFI_PIX_KEY_ORIGEM_ENVIO -> chave Pix de origem usada para autorizar envios (Conta Digital Efí)
//   NUBANK_PIX_KEY           -> chave Pix da conta Nubank para onde o valor é repassado

const https = require('https');
const fs = require('fs');
const path = require('path');

function env(name, fallback) {
  const v = process.env[name];
  return (v === undefined || v === null || v === '') ? fallback : v;
}

function baseHost() {
  const ambiente = env('EFI_AMBIENTE', 'producao');
  return ambiente === 'homologacao' ? 'pix-h.api.efipay.com.br' : 'pix.api.efipay.com.br';
}

let cachedAgentOptions = null;
function getAgentOptions() {
  if (cachedAgentOptions) return cachedAgentOptions;

  const certPath = path.join(__dirname, 'efi-cert.p12');
  if (!fs.existsSync(certPath)) {
    throw new Error('Certificado efi-cert.p12 não encontrado junto da function. Confira o included_files no netlify.toml.');
  }

  cachedAgentOptions = {
    pfx: fs.readFileSync(certPath),
    passphrase: env('EFI_CERT_PASSPHRASE', ''),
  };
  return cachedAgentOptions;
}

// Requisição HTTPS genérica com mTLS, usando o módulo nativo (sem libs externas)
function rawRequest(method, path, { headers = {}, body, host } = {}) {
  return new Promise((resolve, reject) => {
    const agentOpts = getAgentOptions();
    const bodyStr = body !== undefined ? JSON.stringify(body) : undefined;

    const req = https.request(
      {
        method,
        host: host || baseHost(),
        path,
        pfx: agentOpts.pfx,
        passphrase: agentOpts.passphrase,
        headers: {
          'Content-Type': 'application/json',
          ...(bodyStr ? { 'Content-Length': Buffer.byteLength(bodyStr) } : {}),
          ...headers,
        },
      },
      (res) => {
        let chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const raw = Buffer.concat(chunks).toString('utf8');
          let parsed = null;
          try { parsed = raw ? JSON.parse(raw) : null; } catch (e) { parsed = raw; }
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            const err = new Error(`Efí HTTP ${res.statusCode} em ${method} ${path}: ${raw.slice(0, 500)}`);
            err.statusCode = res.statusCode;
            err.body = parsed;
            reject(err);
          }
        });
      }
    );
    req.on('error', reject);
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

// ── OAuth2 (client_credentials), com cache do token em memória entre invocações "quentes" ──
let tokenCache = { token: null, expiresAt: 0 };

async function getAccessToken() {
  const now = Date.now();
  if (tokenCache.token && tokenCache.expiresAt > now + 10_000) {
    return tokenCache.token;
  }

  const clientId = process.env.EFI_CLIENT_ID;
  const clientSecret = process.env.EFI_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('EFI_CLIENT_ID / EFI_CLIENT_SECRET não configurados nas variáveis de ambiente do Netlify.');
  }

  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const data = await rawRequest('POST', '/oauth/token', {
    headers: { Authorization: `Basic ${basic}` },
    body: {
      grant_type: 'client_credentials',
      scope: 'cob.write cob.read pix.write pix.read webhook.write webhook.read gn.pix.send.write gn.pix.send.read gn.balance.read gn.settings.write gn.settings.read',
    },
  });

  if (!data || !data.access_token) {
    throw new Error('Efí não retornou access_token: ' + JSON.stringify(data));
  }

  tokenCache = {
    token: data.access_token,
    expiresAt: now + (Number(data.expires_in || 3600) * 1000),
  };
  return tokenCache.token;
}

// Requisição autenticada (token + mTLS) na API da Efí
async function efiRequest(method, path, body) {
  const token = await getAccessToken();
  return rawRequest(method, path, {
    headers: { Authorization: `Bearer ${token}` },
    body,
  });
}

// ── Endpoints Pix usados pelo site ──

// Busca o detalhe oficial e autenticado de um Pix recebido a partir do endToEndId.
// Importante: NUNCA confiamos em valor/pagador que vier direto no corpo do webhook —
// sempre buscamos de novo aqui, autenticado, para evitar que alguém forje uma notificação.
function getPixPorE2eId(e2eid) {
  return efiRequest('GET', `/v2/pix/${encodeURIComponent(e2eid)}`);
}

// Lista os Pix recebidos num intervalo (usado para popular/atualizar a lista no front-end)
function listarPixRecebidos({ inicio, fim, itensPorPagina = 100 }) {
  const qs = new URLSearchParams({
    inicio,
    fim,
    'paginacao.itensPorPagina': String(itensPorPagina),
  }).toString();
  return efiRequest('GET', `/v2/pix?${qs}`);
}

// Registra (ou atualiza) a URL de webhook associada à chave Pix de recebimento
function registrarWebhook(chave, webhookUrl) {
  return efiRequest('PUT', `/v2/webhook/${encodeURIComponent(chave)}`, { webhookUrl });
}

// Ativa o envio do nome completo (e CPF/CNPJ mascarado + banco) do pagador nas notificações
// de webhook para uma chave específica. Por padrão a Efí NÃO manda esse dado (proteção de
// dados) — precisa desse PUT /v2/gn/config uma única vez por chave para ligar.
// Depois de ativado, o campo "gnExtras.pagador.nome" passa a vir nas próximas notificações
// (não retroage para Pix já recebidos antes da ativação).
// Busca a configuração atual da conta (necessário porque o PUT /v2/gn/config exige o
// corpo completo, incluindo campos que talvez você nunca tenha mexido, como
// "receberSemChave" — não dá pra mandar só o pedaço que quer mudar).
function buscarConfig() {
  return efiRequest('GET', '/v2/gn/config');
}

// Ativa o envio do nome completo (e CPF/CNPJ mascarado + banco) do pagador nas notificações
// de webhook para uma chave específica. Por padrão a Efí NÃO manda esse dado (proteção de
// dados) — precisa desse PUT /v2/gn/config uma única vez por chave para ligar.
// Depois de ativado, o campo "gnExtras.pagador.nome" passa a vir nas próximas notificações
// (não retroage para Pix já recebidos antes da ativação).
//
// IMPORTANTE: a API exige o corpo COMPLETO no PUT (inclusive "receberSemChave" e a config
// das outras chaves, se houver) — por isso buscamos a config atual primeiro e só adicionamos
// a opção do nome em cima dela, em vez de mandar um corpo novo do zero (o que apagaria
// qualquer outra configuração que você já tivesse).
async function ativarNotificacaoPagador(chave) {
  const atual = (await buscarConfig()) || {};
  const pixAtual = atual.pix || {};
  const chavesAtuais = pixAtual.chaves || {};
  const chaveAtual = chavesAtuais[chave] || {};
  const recebimentoAtual = chaveAtual.recebimento || {};
  const webhookAtual = recebimentoAtual.webhook || {};
  const notificacaoAtual = webhookAtual.notificacao || {};

  const novoBody = {
    pix: {
      ...pixAtual,
      receberSemChave: pixAtual.receberSemChave !== undefined ? pixAtual.receberSemChave : true,
      chaves: {
        ...chavesAtuais,
        [chave]: {
          ...chaveAtual,
          recebimento: {
            txidObrigatorio: false,
            qrCodeEstatico: { recusarTodos: false },
            ...recebimentoAtual,
            webhook: {
              ...webhookAtual,
              notificacao: {
                tarifa: false,
                ...notificacaoAtual,
                pagador: true,
              },
            },
          },
        },
      },
    },
  };

  return efiRequest('PUT', '/v2/gn/config', novoBody);
}

// Envia um Pix automaticamente (produto "Conta Digital Efí" / Envio de Pix).
// Requer que a aplicação tenha o escopo de envio liberado pela Efí — nem toda conta tem
// isso habilitado por padrão. idEnvio precisa ser único (usamos o txid/e2eid recebido).
function enviarPix({ idEnvio, valor, chaveOrigem, chaveDestino, descricao }) {
  return efiRequest('PUT', `/v3/gn/pix/${encodeURIComponent(idEnvio)}`, {
    valor: String(valor),
    pagador: {
      chave: chaveOrigem,
      ...(descricao ? { infoPagador: descricao } : {}),
    },
    favorecido: { chave: chaveDestino },
  });
}

module.exports = {
  env,
  getAccessToken,
  efiRequest,
  getPixPorE2eId,
  listarPixRecebidos,
  registrarWebhook,
  ativarNotificacaoPagador,
  enviarPix,
};
