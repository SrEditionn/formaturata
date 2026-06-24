// Netlify Function: proxy seguro para Mercado Pago
// Arquivo: netlify/functions/mp-proxy.js

const MP_ACCESS_TOKEN = 'APP_USR-8339884002049059-061809-efec8227a953fd963f9653f597d0b7e6-3479248919';

async function mpFetch(url) {
  const r = await fetch(url, {
    headers: { 'Authorization': 'Bearer ' + MP_ACCESS_TOKEN, 'Content-Type': 'application/json' }
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

function extractName(p) {
  // 1) additional_info (preenchido quando há integração via checkout)
  const af = p.additional_info?.payer?.first_name || '';
  const al = p.additional_info?.payer?.last_name  || '';
  if (af && af !== 'XXXXXXXXXXXX') return (af + ' ' + al).trim();

  // 2) payer direto
  const pf = p.payer?.first_name || '';
  const pl = p.payer?.last_name  || '';
  if (pf && pf !== 'XXXXXXXXXXXX') return (pf + ' ' + pl).trim();

  return null;
}

exports.handler = async function(event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const params = event.queryStringParameters || {};
  const limit  = params.limit || '20';

  try {
    // 1. Lista pagamentos
    const data = await mpFetch(
      'https://api.mercadopago.com/v1/payments/search'
      + '?sort=date_created&criteria=desc'
      + '&limit=' + limit
      + '&status=approved&payment_method_id=pix'
    );

    if (!Array.isArray(data.results)) {
      return {
        statusCode: 200,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        body: JSON.stringify(data)
      };
    }

    // 2. Para cada pagamento sem nome, tenta buscar pelo payer.id
    const enriched = await Promise.all(data.results.map(async (p) => {
      // Tenta extrair nome do que já temos
      let name = extractName(p);
      if (name) { p._resolvedName = name; return p; }

      // Tenta buscar detalhe individual (pode ter mais dados)
      try {
        const detail = await mpFetch(`https://api.mercadopago.com/v1/payments/${p.id}`);
        name = extractName(detail);
        if (name) { detail._resolvedName = name; return detail; }

        // Tenta buscar perfil do pagador pelo ID da conta MP
        const payerId = detail.payer?.id || p.payer?.id;
        if (payerId) {
          try {
            const user = await mpFetch(`https://api.mercadopago.com/v1/users/${payerId}`);
            const uname = (user.first_name || '') + ' ' + (user.last_name || '');
            if (uname.trim() && uname.trim() !== 'XXXXXXXXXXXX') {
              detail._resolvedName = uname.trim();
              return detail;
            }
            // Tenta nickname como fallback
            if (user.nickname && user.nickname !== 'XXXXXXXXXXXX') {
              detail._resolvedName = user.nickname;
              return detail;
            }
          } catch(e) { /* ignora */ }
        }

        return detail;
      } catch(e) { return p; }
    }));

    data.results = enriched;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify(data)
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message })
    };
  }
};
