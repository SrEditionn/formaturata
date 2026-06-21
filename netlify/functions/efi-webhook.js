// Netlify Function: webhook do Pix (Efí)
// Arquivo: netlify/functions/efi-webhook.js
//
// A Efí chama essa URL (configurada uma vez via efi-register-webhook.js) toda vez que um
// Pix é recebido na chave configurada. O corpo da notificação só traz identificadores
// (endToEndId/txid) — por segurança, NUNCA confiamos em valor/nome vindos do corpo do
// webhook em si; sempre buscamos o detalhe autenticado na API antes de gravar/notificar.

const { sendWebPush } = require('./webpush-lib.js');
const { getDoc, setDocREST } = require('./firestore-lib.js');
const { getPixPorE2eId, enviarPix } = require('./efi-lib.js');
const { bancoFromEndToEndId } = require('./efi-bancos.js');

const VAPID_PUBLIC_KEY = 'BE4MscUkWvkoRhjXPj_ixZ57h4-PBnUHlxsxKug1BW8T57EU-bkAR5zun0td8aJUxzu6_nQcru15_Z8J9XcPfNE';
const VAPID_PRIVATE_KEY = 'nOveZwVINacfN_lw7fZTkjDEFSpwHlswkSNOx07bCVg';
const VAPID_SUBJECT = 'mailto:contato@example.com';

function extractNome(detalhe) {
  const nome = detalhe?.pagador?.nome || detalhe?.devedor?.nome || '';
  return nome && nome.trim() ? nome.trim() : null;
}

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

    const pixDoc = (await getDoc('formatura', 'pix')) || { logs: [], seen: [] };
    const logs = pixDoc.logs || [];
    const seen = pixDoc.seen || [];
    const novos = [];

    for (const item of pixArray) {
      const e2eid = item.endToEndId;
      if (!e2eid) continue;

      const alreadyLogged = logs.some((l) => String(l.pixId) === String(e2eid));
      const alreadySeen = seen.includes(String(e2eid));
      if (alreadyLogged && alreadySeen) continue; // já processado antes, ignora (idempotência)

      // Busca o detalhe OFICIAL e autenticado — não confia no que veio no corpo do webhook
      let detalhe;
      try {
        detalhe = await getPixPorE2eId(e2eid);
      } catch (err) {
        console.error('[efi-webhook] falha ao buscar detalhe do Pix', e2eid, err.message);
        continue;
      }

      const nome = extractNome(detalhe) || 'Pagador não identificado';
      const valor = Number(detalhe?.valor || item.valor || 0);
      const banco = bancoFromEndToEndId(e2eid) || 'Banco não identificado';
      const horario = detalhe?.horario ? new Date(detalhe.horario).getTime() : Date.now();

      console.log('[efi-webhook] PIX RECEBIDO — nome:', nome, '| banco:', banco, '| valor:', valor);

      if (!alreadyLogged) {
        logs.unshift({ pixId: String(e2eid), txid: detalhe?.txid || item.txid || null, name: nome, bank: banco, value: valor, date: horario });
        if (logs.length > 200) logs.length = 200;
        novos.push({ id: 'pix_' + e2eid, pixId: String(e2eid), name: nome, bank: banco, value: valor });
      }
      if (!alreadySeen) {
        seen.push(String(e2eid));
        if (seen.length > 500) seen.splice(0, seen.length - 500);
      }

      // ── Repasse automático para a conta Nubank ──
      // Só roda se as variáveis de ambiente necessárias estiverem configuradas. Se a Efí
      // ainda não tiver liberado o produto "Envio de Pix" para a aplicação, isso falha
      // silenciosamente (fica só registrado no log) e o recebimento continua funcionando normal.
      if (!alreadyLogged) {
        await tentarRepasse(e2eid, valor);
      }
    }

    await setDocREST('formatura', 'pix', { logs, seen, updatedAt: Date.now() });
    console.log('[efi-webhook] Firestore atualizado. novos:', novos.length);

    if (novos.length > 0) {
      const subsDoc = await getDoc('formatura', 'push_subscriptions');
      const subs = subsDoc?.subscriptions || [];
      console.log('[efi-webhook] subscriptions encontradas:', subs.length);

      const stillValid = [];
      for (const n of novos) {
        const payload = {
          title: 'Pix recebido 💸',
          body: `${n.name} — R$ ${Number(n.value).toFixed(2)}`,
        };
        await Promise.all(subs.map(async (sub) => {
          try {
            await sendWebPush(JSON.parse(sub), payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
            if (!stillValid.includes(sub)) stillValid.push(sub);
          } catch (err) {
            console.warn('[efi-webhook] push FALHOU:', err.statusCode, err.message);
            if (err.statusCode !== 404 && err.statusCode !== 410 && !stillValid.includes(sub)) {
              stillValid.push(sub);
            }
          }
        }));
      }

      if (stillValid.length !== subs.length) {
        await setDocREST('formatura', 'push_subscriptions', { subscriptions: stillValid });
      }
    }

    return { statusCode: 200, body: 'ok' };
  } catch (err) {
    console.error('[efi-webhook] ERRO NÃO TRATADO:', err.message, err.stack);
    // Retorna 200 mesmo em erro para a Efí não ficar reenviando o webhook indefinidamente;
    // o erro real fica registrado no log do Netlify Functions para você investigar.
    return { statusCode: 200, body: 'erro: ' + err.message };
  }
};

async function tentarRepasse(e2eid, valor) {
  const chaveOrigem = process.env.EFI_PIX_KEY_ORIGEM_ENVIO;
  const chaveDestino = process.env.NUBANK_PIX_KEY;

  if (!chaveOrigem || !chaveDestino) {
    console.log('[efi-webhook] repasse automático não configurado (faltam variáveis de ambiente) — pulando.');
    return;
  }
  if (!valor || valor <= 0) {
    console.log('[efi-webhook] repasse pulado: valor inválido.');
    return;
  }

  try {
    // idEnvio precisa ser único e idempotente — usar o próprio e2eid evita reenvio duplicado
    // caso a Efí reenvie o mesmo webhook (retry).
    const idEnvio = 'rep' + e2eid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const resultado = await enviarPix({
      idEnvio,
      valor: valor.toFixed(2),
      chaveOrigem,
      chaveDestino,
      descricao: 'Repasse automatico formatura',
    });
    console.log('[efi-webhook] repasse enviado com sucesso:', JSON.stringify(resultado));
  } catch (err) {
    console.error('[efi-webhook] FALHA no repasse automático para Nubank:', err.message);
    // Não derruba o fluxo principal — o Pix já foi registrado e a notificação já dispara.
    // O dinheiro fica retido na conta Efí até você fazer o repasse manualmente nesse caso.
  }
}
