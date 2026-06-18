// Netlify Function: proxy seguro para Mercado Pago
// Arquivo: netlify/functions/mp-proxy.js

const MP_ACCESS_TOKEN = 'APP_USR-8339884002049059-061809-efec8227a953fd963f9653f597d0b7e6-3479248919';

exports.handler = async function(event, context) {
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const params = event.queryStringParameters || {};
  const limit = params.limit || '20';

  // Sem range/begin_date/end_date — busca os últimos pagamentos aprovados via Pix
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
