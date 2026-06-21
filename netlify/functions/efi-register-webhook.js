// Netlify Function: registra a URL de webhook na Efí (rodar UMA VEZ depois do deploy)
// Arquivo: netlify/functions/efi-register-webhook.js
//
// Protegido por SETUP_SECRET para que ninguém além de você consiga apontar seu webhook
// Pix para outra URL. Depois de rodar com sucesso uma vez, não precisa rodar de novo
// (só se você trocar de domínio).
//
// Como usar, depois de configurar as variáveis de ambiente no Netlify e fazer o deploy:
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
