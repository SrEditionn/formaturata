// Netlify Function: ativa o nome completo do pagador nas notificações de webhook.
// Arquivo: netlify/functions/efi-ativar-nome-pagador.js
//
// Chamada única (não precisa rodar de novo depois). Por padrão a Efí não envia o nome
// completo de quem pagou — essa function liga essa opção pra chave configurada em
// EFI_PIX_KEY. Depois disso, os PRÓXIMOS Pix recebidos (não os antigos) vêm com o nome.
//
// Como usar, uma única vez:
//   https://SEU-SITE.netlify.app/.netlify/functions/efi-ativar-nome-pagador?secret=SUA_SETUP_SECRET

const { ativarNotificacaoPagador } = require('./efi-lib.js');

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

  try {
    await ativarNotificacaoPagador(chave);
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ok: true,
        mensagem: 'Nome do pagador ativado para a chave ' + chave + '. Vale só pra Pix recebidos a partir de agora.',
      }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: false, error: err.message }),
    };
  }
};
