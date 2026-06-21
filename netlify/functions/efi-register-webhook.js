// Netlify Function: registra a URL de webhook na Efí
// Arquivo: netlify/functions/efi-register-webhook.js
//
// Agora o webhook é atendido pela VM Oracle (que faz o mTLS exigido pela Efí), não mais
// pelo Netlify. A URL registrada vem da variável de ambiente EFI_WEBHOOK_URL — configure
// ela no painel do Netlify (Site settings → Environment variables) com o endereço da VM,
// por exemplo: https://taterceiro.duckdns.org/
//
// Como usar (uma única vez, depois que o servidor da VM já estiver rodando — Passo 8 do
// README do pacote webhook-vm):
//   https://SEU-SITE.netlify.app/.netlify/functions/efi-register-webhook?secret=SUA_SETUP_SECRET

const { registrarWebhook } = require('./efi-lib.js');

exports.handler = async function (event) {
  const params = event.queryStringParameters || {};
  const expected = process.env.SETUP_SECRET;

  if (!expected) {
    return { statusCode: 500, body: 'SETUP_SECRET não configurado nas variáveis de ambiente.' };
  }
  if (params.secret !== expected) {
    return { statusCode: 403, body: 'Acesso negado.' };
  }

  const chave = process.env.EFI_PIX_KEY;
  if (!chave) {
    return { statusCode: 500, body: 'EFI_PIX_KEY não configurada nas variáveis de ambiente.' };
  }

  const webhookUrl = process.env.EFI_WEBHOOK_URL;
  if (!webhookUrl) {
    return {
      statusCode: 500,
      body: 'EFI_WEBHOOK_URL não configurada nas variáveis de ambiente do Netlify. Configure com o endereço da VM, ex: https://taterceiro.duckdns.org/',
    };
  }

  try {
    const resultado = await registrarWebhook(chave, webhookUrl);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, webhookUrl, resultado }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
