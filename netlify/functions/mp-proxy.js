// Netlify Function: proxy seguro para Mercado Pago
// Arquivo: netlify/functions/mp-proxy.js

const MP_ACCESS_TOKEN = 'APP_USR-8339884002049059-061809-efec8227a953fd963f9653f597d0b7e6-3479248919';

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = event.queryStringParameters || {};
  const limit = params.limit || '20';

  const mpUrl = 'https://api.mercadopago.com/v1/payments/search'
    + '?sort=date_created&criteria=desc'
    + '&limit=' + limit
    + '&status=approved&payment_method_id=pix';

  try {
    const response = await fetch(mpUrl, {
      headers: {
        'Authorization': 'Bearer ' + MP_ACCESS_TOKEN,
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    // Para cada pagamento, busca detalhes individuais pelo ID.
    // Isso é necessário porque a listagem (/payments/search) mascara o nome
    // do pagador com XXXXXXXXXXXX por padrão (comportamento da API do MP).
    // O nome real vem de additional_info.payer, disponível apenas no endpoint
    // individual /v1/payments/{id}.
    if (Array.isArray(data.results)) {
      const enriched = await Promise.all(data.results.map(async (p) => {
        // Verifica se já temos o nome real (não mascarado) no resultado da listagem
        const firstName = p.additional_info?.payer?.first_name || '';
        const directFirst = p.payer?.first_name || '';
        const isMasked = (firstName === '' || firstName === 'XXXXXXXXXXXX') &&
                         (directFirst === '' || directFirst === 'XXXXXXXXXXXX');

        // Se o nome já veio correto, não precisa buscar de novo
        if (!isMasked && (firstName || directFirst)) return p;

        // Busca detalhes completos do pagamento pelo ID para obter o nome real
        try {
          const detailRes = await fetch(`https://api.mercadopago.com/v1/payments/${p.id}`, {
            headers: { 'Authorization': 'Bearer ' + MP_ACCESS_TOKEN }
          });
          if (detailRes.ok) {
            const detail = await detailRes.json();
            return detail;
          }
        } catch(e) { /* ignora erro, retorna original */ }
        return p;
      }));
      data.results = enriched;
    }

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
      body: JSON.stringify(data),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
