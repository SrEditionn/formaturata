// Netlify Function: webhook do Mercado Pago
// Arquivo: netlify/functions/mp-webhook.js
//
// Configure esta URL no painel do Mercado Pago como webhook de notificações:
//   https://SEU-SITE.netlify.app/.netlify/functions/mp-webhook
//
// O Mercado Pago chama esta URL automaticamente, no exato instante de cada
// pagamento aprovado — por isso a notificação fica instantânea, sem precisar
// do site aberto em nenhum navegador.

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
  // O Mercado Pago chama com GET (validação) ou POST (notificação real)
  if (event.httpMethod !== 'POST' && event.httpMethod !== 'GET') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const params = event.queryStringParameters || {};
    let body = {};
    try {
      body = event.body ? JSON.parse(event.body) : {};
    } catch (e) {
      body = {};
    }

    // O MP manda o id do pagamento em formatos diferentes dependendo da versão/configuração:
    // querystring (?data.id=...&type=payment) ou no corpo (body.data.id)
    const paymentId =
      params['data.id'] ||
      body?.data?.id ||
      (params.topic === 'payment' ? params.id : null) ||
      (body.type === 'payment' ? body.id : null);

    const topic = params.topic || body.type;

    if (!paymentId || (topic && topic !== 'payment')) {
      // Não é uma notificação de pagamento (pode ser merchant_order, teste, etc.) — apenas confirma o recebimento
      return { statusCode: 200, body: 'ok (ignorado: não é payment)' };
    }

    // 1. Busca o detalhe completo do pagamento
    const payment = await mpFetch(`https://api.mercadopago.com/v1/payments/${paymentId}`);

    if (payment.status !== 'approved' || payment.payment_method_id !== 'pix') {
      return { statusCode: 200, body: 'ok (ignorado: não é pix aprovado)' };
    }

    const name = extractName(payment) || 'Pagador não identificado';
    const amount = payment.transaction_amount || 0;

    // 2. Salva no documento compartilhado do Pix (mesmo doc que o site lê via onSnapshot)
    const pixDoc = (await getDoc('formatura', 'pix')) || { logs: [], seen: [] };
    const logs = pixDoc.logs || [];
    const seen = pixDoc.seen || [];

    const alreadyLogged = logs.some((l) => String(l.id) === String(payment.id));
    if (!alreadyLogged) {
      logs.unshift({
        id: String(payment.id),
        name,
        amount,
        date: Date.now(),
      });
      if (logs.length > 200) logs.length = 200;
    }

    const alreadySeen = seen.includes(String(payment.id));
    if (!alreadySeen) {
      seen.push(String(payment.id));
      if (seen.length > 500) seen.splice(0, seen.length - 500);
    }

    await setDocREST('formatura', 'pix', { logs, seen, updatedAt: Date.now() });

    // 3. Dispara push para todos os navegadores inscritos (mesmo com o site fechado)
    if (!alreadyLogged) {
      const subsDoc = await getDoc('formatura', 'push_subscriptions');
      const subs = subsDoc?.subscriptions || [];

      const payload = {
        title: 'Pix recebido 💸',
        body: `${name} — R$ ${Number(amount).toFixed(2)}`,
      };

      const stillValid = [];
      await Promise.all(
        subs.map(async (sub) => {
          try {
            await sendWebPush(JSON.parse(sub), payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
            stillValid.push(sub);
          } catch (err) {
            // 404/410 = inscrição expirada/cancelada no navegador: remove da lista
            if (err.statusCode !== 404 && err.statusCode !== 410) {
              stillValid.push(sub);
            }
          }
        })
      );

      if (stillValid.length !== subs.length) {
        await setDocREST('formatura', 'push_subscriptions', { subscriptions: stillValid });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[mp-webhook] erro:', err);
    // Sempre responder 200 evita que o Mercado Pago fique re-tentando indefinidamente
    // por erros que não vão se resolver sozinhos; ainda assim logamos o erro para depuração.
    return { statusCode: 200, body: 'erro tratado: ' + err.message };
  }
};
