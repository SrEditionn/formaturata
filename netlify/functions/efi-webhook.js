// Netlify Function: webhook do Pix (Efí) — ATUALMENTE NÃO USADO EM PRODUÇÃO
// Arquivo: netlify/functions/efi-webhook.js
//
// ⚠️ A Efí exige mTLS (certificado de cliente) em qualquer URL de webhook cadastrada,
// por norma do Banco Central. O Netlify Functions não permite configurar essa camada
// (não há como exigir certificado de cliente numa function serverless padrão), então
// o cadastro deste webhook via efi-register-webhook.js sempre vai falhar com
// "webhook_invalido" / "TLS mútuo não configurado" — isso é esperado e não tem correção
// gratuita no Netlify.
//
// Por isso o site hoje usa POLLING como mecanismo principal: o front-end chama
// efi-proxy.js a cada 12s, e é lá que a lógica de processar Pix novo (mesma lógica
// que está abaixo) realmente roda. Veja efi-process-pix.js.
//
// Este arquivo fica aqui pronto para o caso de você um dia hospedar um servidor próprio
// com mTLS configurado (fora do Netlify) e repassar a notificação pra cá — nesse caso
// basta apontar esse servidor para chamar esta function com o corpo no formato da Efí.

const { processarPixRecebidos } = require('./efi-process-pix.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

    console.log('[efi-webhook] method:', event.httpMethod);
    console.log('[efi-webhook] body:', JSON.stringify(body));

    // Formato padrão da Efí: { "pix": [ { "endToEndId": "...", "txid": "..." }, ... ] }
    const pixArray = Array.isArray(body.pix) ? body.pix : [];
    if (pixArray.length === 0) {
      console.log('[efi-webhook] ignorado: sem array "pix" no corpo');
      return { statusCode: 200, body: 'ok (ignorado: sem pix)' };
    }

    await processarPixRecebidos(pixArray);

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[efi-webhook] ERRO NÃO TRATADO:', err.message, err.stack);
    // Retorna 200 mesmo em erro para a Efí não ficar reenviando o webhook indefinidamente;
    // o erro real fica registrado no log do Netlify Functions para você investigar.
    return { statusCode: 200, body: 'erro: ' + err.message };
  }
};
