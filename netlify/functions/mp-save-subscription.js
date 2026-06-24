// Netlify Function: salva (ou remove) a inscrição de push de um navegador
// Arquivo: netlify/functions/mp-save-subscription.js

const { getDoc, setDocREST } = require('./firestore-lib.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const body = JSON.parse(event.body || '{}');
    const { subscription, action } = body; // action: 'add' | 'remove'

    if (!subscription || !subscription.endpoint) {
      return { statusCode: 400, body: JSON.stringify({ error: 'subscription inválida' }) };
    }

    const subStr = JSON.stringify(subscription);
    const subsDoc = (await getDoc('formatura', 'push_subscriptions')) || { subscriptions: [] };
    let subs = subsDoc.subscriptions || [];

    // Remove duplicatas pelo mesmo endpoint (cada navegador tem um endpoint único)
    subs = subs.filter((s) => {
      try {
        return JSON.parse(s).endpoint !== subscription.endpoint;
      } catch (e) {
        return true;
      }
    });

    if (action !== 'remove') {
      subs.push(subStr);
    }

    await setDocREST('formatura', 'push_subscriptions', { subscriptions: subs });

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ ok: true, total: subs.length }),
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
