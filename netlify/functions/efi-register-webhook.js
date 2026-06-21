// Netlify Function: registra a URL de webhook na Efí
// Arquivo: netlify/functions/efi-register-webhook.js
//
// ⚠️ NÃO CHAME ESTE ENDPOINT — a Efí exige mTLS (certificado de cliente) em qualquer
// URL de webhook, e o Netlify Functions não tem como atender essa exigência de graça.
// Chamar esta URL vai sempre retornar o erro "webhook_invalido" / TLS mútuo não
// configurado — isso é esperado, não é um bug a corrigir.
//
// O site hoje usa POLLING (efi-proxy.js, chamado a cada 12s pelo front-end) como
// mecanismo de atualização em vez de webhook. Veja efi-process-pix.js para a lógica
// de processamento. Este arquivo fica aqui apenas como referência / para o caso de
// você um dia hospedar um servidor próprio com mTLS configurado.
//
// Como usar, SE algum dia voltar a fazer sentido (servidor próprio com mTLS):
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
  const siteUrl = process.env.URL || process.env.DEPLOY_PRIME_URL; // variáveis automáticas do Netlify
  if (!chave) {
    return { statusCode: 500, body: 'EFI_PIX_KEY não configurada nas variáveis de ambiente.' };
  }
  if (!siteUrl) {
    return { statusCode: 500, body: 'Não consegui detectar a URL do site automaticamente. Configure manualmente via API da Efí.' };
  }

  const webhookUrl = `${siteUrl}/.netlify/functions/efi-webhook`;

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
