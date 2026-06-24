// Netlify Function: webhook do Mercado Pago
// Arquivo: netlify/functions/mp-webhook.js

const { sendWebPush } = require('./webpush-lib.js');
const { getDoc, setDocREST } = require('./firestore-lib.js');

const MP_ACCESS_TOKEN = 'APP_USR-8339884002049059-061809-efec8227a953fd963f9653f597d0b7e6-3479248919';
const VAPID_PUBLIC_KEY = 'BE4MscUkWvkoRhjXPj_ixZ57h4-PBnUHlxsxKug1BW8T57EU-bkAR5zun0td8aJUxzu6_nQcru15_Z8J9XcPfNE';
const VAPID_PRIVATE_KEY = 'nOveZwVINacfN_lw7fZTkjDEFSpwHlswkSNOx07bCVg';
const VAPID_SUBJECT = 'mailto:contato@example.com';

async function mpFetch(url) {
  const r = await fetch(url, {
    headers: { Authorization: 'Bearer ' + MP_ACCESS_TOKEN, 'Content-Type': 'application/json' },
  });
  if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + url);
  return r.json();
}

function extractName(p) {
  const af = p.additional_info?.payer?.first_name || '';
  const al = p.additional_info?.payer?.last_name || '';
  if (af && af !== 'XXXXXXXXXXXX') return (af + ' ' + al).trim();
  const pf = p.payer?.first_name || '';
  const pl = p.payer?.last_name || '';
  if (pf && pf !== 'XXXXXXXXXXXX') return (pf + ' ' + pl).trim();
  return null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    let body = {};
    try { body = event.body ? JSON.parse(event.body) : {}; } catch (e) { body = {}; }

    // LOG DETALHADO — aparece no Netlify Functions log para diagnóstico
    console.log('[mp-webhook] method:', event.httpMethod);
    console.log('[mp-webhook] querystring:', JSON.stringify(params));
    console.log('[mp-webhook] body:', JSON.stringify(body));

    // ── Extração do paymentId nos TODOS os formatos conhecidos do Mercado Pago ──
    //
    // Formato 1 (Notificações v1 — mais antigo):
    //   GET ?topic=payment&id=123456
    //
    // Formato 2 (Webhooks v2 — painel Developers):
    //   POST body: { "type": "payment", "data": { "id": "123456" } }
    //   E às vezes também na querystring: ?data.id=123456&type=payment
    //
    // Formato 3 (IPN legado):
    //   POST body: { "id": 123456, "topic": "payment" }

    let paymentId =
      params['data.id'] ||                              // v2 querystring
      body?.data?.id ||                                 // v2 body
      (params.topic === 'payment' ? params.id : null) || // v1 querystring
      (body.topic === 'payment' ? body.id : null) ||   // IPN body com topic
      (body.type === 'payment' ? body.id : null) ||    // v2 body formato alternativo
      body?.id;                                         // fallback: qualquer id no body

    const topic = params.topic || body.topic || body.type || '';

    console.log('[mp-webhook] paymentId extraído:', paymentId, '| topic:', topic);

    // Se tem id mas topic indica que não é pagamento (ex: merchant_order), ignora
    if (!paymentId) {
      console.log('[mp-webhook] ignorado: sem paymentId detectável');
      return { statusCode: 200, body: 'ok (ignorado: sem paymentId)' };
    }

    if (topic && !['payment', 'payments', ''].includes(topic)) {
      console.log('[mp-webhook] ignorado: topic não é payment:', topic);
      return { statusCode: 200, body: 'ok (ignorado: topic=' + topic + ')' };
    }

    // 1. Busca o detalhe completo do pagamento na API do MP
    console.log('[mp-webhook] buscando pagamento:', paymentId);
    const payment = await mpFetch(`https://api.mercadopago.com/v1/payments/${paymentId}`);
    console.log('[mp-webhook] status:', payment.status, '| método:', payment.payment_method_id);

    if (payment.status !== 'approved') {
      return { statusCode: 200, body: 'ok (ignorado: status=' + payment.status + ')' };
    }
    if (payment.payment_method_id !== 'pix') {
      return { statusCode: 200, body: 'ok (ignorado: método=' + payment.payment_method_id + ')' };
    }

    const name = extractName(payment) || 'Pagador não identificado';
    const amount = payment.transaction_amount || 0;
    console.log('[mp-webhook] PIX APROVADO — nome:', name, '| valor:', amount);

    // 2. Salva no Firestore (o site lê em tempo real via onSnapshot)
    const pixDoc = (await getDoc('formatura', 'pix')) || { logs: [], seen: [] };
    const logs = pixDoc.logs || [];
    const seen = pixDoc.seen || [];

    const alreadyLogged = logs.some((l) => String(l.id) === String(payment.id));
    if (!alreadyLogged) {
      logs.unshift({ id: String(payment.id), name, amount, date: Date.now() });
      if (logs.length > 200) logs.length = 200;
    }

    const alreadySeen = seen.includes(String(payment.id));
    if (!alreadySeen) {
      seen.push(String(payment.id));
      if (seen.length > 500) seen.splice(0, seen.length - 500);
    }

    await setDocREST('formatura', 'pix', { logs, seen, updatedAt: Date.now() });
    console.log('[mp-webhook] Firestore atualizado. alreadyLogged:', alreadyLogged);

    // 3. Dispara push para todos os navegadores inscritos
    if (!alreadyLogged) {
      const subsDoc = await getDoc('formatura', 'push_subscriptions');
      const subs = subsDoc?.subscriptions || [];
      console.log('[mp-webhook] subscriptions encontradas:', subs.length);

      const payload = {
        title: 'Pix recebido 💸',
        body: `${name} — R$ ${Number(amount).toFixed(2)}`,
      };

      const stillValid = [];
      await Promise.all(subs.map(async (sub) => {
        try {
          await sendWebPush(JSON.parse(sub), payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
          console.log('[mp-webhook] push enviado OK para endpoint:', JSON.parse(sub).endpoint?.slice(0, 60));
          stillValid.push(sub);
        } catch (err) {
          console.warn('[mp-webhook] push FALHOU:', err.statusCode, err.message, '| endpoint:', JSON.parse(sub)?.endpoint?.slice(0, 60));
          if (err.statusCode !== 404 && err.statusCode !== 410) {
            stillValid.push(sub);
          }
        }
      }));

      if (stillValid.length !== subs.length) {
        await setDocREST('formatura', 'push_subscriptions', { subscriptions: stillValid });
        console.log('[mp-webhook] subscriptions inválidas removidas. restam:', stillValid.length);
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[mp-webhook] ERRO NÃO TRATADO:', err.message, err.stack);
    return { statusCode: 200, body: 'erro: ' + err.message };
  }
};
