// Netlify Function: proxy seguro para Mercado Pago
// Arquivo: netlify/functions/mp-proxy.js
//
// Esta função roda no servidor (não no navegador), então:
// 1. O token do MP fica seguro (não aparece no código front-end)
// 2. Não tem problema de CORS
// 3. O MP aceita a chamada normalmente

const MP_ACCESS_TOKEN = 'APP_USR-8339884002049059-061809-efec8227a953fd963f9653f597d0b7e6-3479248919';

exports.handler = async function(event, context) {
  // Permite apenas GET
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  // Parâmetros opcionais que o front-end pode passar
  const params = event.queryStringParameters || {};
  const limit = params.limit || '20';
  const beginDate = params.begin_date || 'NOW-7DAYS';

  const mpUrl = `https://api.mercadopago.com/v1/payments/search`
    + `?sort=date_created&criteria=desc&range=date_created`
    + `&begin_date=${encodeURIComponent(beginDate)}&limit=${limit}`
    + `&status=approved&payment_method_id=pix`;

  try {
    const response = await fetch(mpUrl, {
      headers: {
        'Authorization': `Bearer ${MP_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
      },
      cache: 'no-store',
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
