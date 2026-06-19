// Netlify Function de DIAGNÓSTICO — mostra exatamente o que a Mercado Pago
// mandou na última chamada ao webhook (mp-webhook.js), para conferirmos
// se o formato bate com o que o código espera.
// Acesse pelo navegador: /.netlify/functions/mp-ver-ultima-chamada

const { getDoc } = require('./firestore-lib.js');

exports.handler = async function () {
  try {
    const doc = await getDoc('formatura', 'webhook_debug');
    if (!doc) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        body: 'Nenhuma chamada registrada ainda. Faça um Pix de teste e acesse esta página de novo.',
      };
    }
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: '=== ÚLTIMA CHAMADA RECEBIDA NO WEBHOOK ===\n\n' + JSON.stringify(doc, null, 2),
    };
  } catch (err) {
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: 'ERRO: ' + err.message };
  }
};
