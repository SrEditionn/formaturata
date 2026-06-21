// Lógica compartilhada de processamento de um Pix recebido.
// Arquivo: netlify/functions/efi-process-pix.js
//
// Usado pelo efi-proxy.js (chamado via polling do front-end a cada 12s) para, a cada Pix
// ainda não visto: (1) buscar o detalhe OFICIAL e autenticado na Efí (nome completo do
// pagador), (2) gravar no Firestore (fonte de verdade compartilhada entre dispositivos),
// (3) disparar push notification, e (4) tentar o repasse automático para a conta Nubank.
//
// Esse arquivo existe separado do efi-proxy.js para poder ser reusado também pelo
// efi-webhook.js, caso no futuro você hospede um servidor próprio com mTLS e volte a
// receber webhooks em tempo real — a lógica de negócio é a mesma, só muda o gatilho.

const { sendWebPush } = require('./webpush-lib.js');
const { getDoc, setDocREST } = require('./firestore-lib.js');
const { getPixPorE2eId, enviarPix } = require('./efi-lib.js');
const { bancoFromEndToEndId } = require('./efi-bancos.js');

const VAPID_PUBLIC_KEY = 'BE4MscUkWvkoRhjXPj_ixZ57h4-PBnUHlxsxKug1BW8T57EU-bkAR5zun0td8aJUxzu6_nQcru15_Z8J9XcPfNE';
const VAPID_PRIVATE_KEY = 'nOveZwVINacfN_lw7fZTkjDEFSpwHlswkSNOx07bCVg';
const VAPID_SUBJECT = 'mailto:contato@example.com';

function extractNome(obj) {
  const nome = obj?.pagador?.nome || obj?.devedor?.nome || obj?.gnExtras?.pagador?.nome || '';
  return nome && nome.trim() ? nome.trim() : null;
}

// Tenta repassar o valor recebido para a chave Pix do Nubank.
// Falha silenciosamente (só loga) se faltar configuração ou se a Efí recusar — o
// recebimento e a exibição na tela nunca são afetados por uma falha aqui.
async function tentarRepasse(e2eid, valor) {
  const chaveOrigem = process.env.EFI_PIX_KEY_ORIGEM_ENVIO;
  const chaveDestino = process.env.NUBANK_PIX_KEY;

  if (!chaveOrigem || !chaveDestino) {
    console.log('[efi-process-pix] repasse automático não configurado (faltam variáveis de ambiente) — pulando.');
    return;
  }
  if (!valor || valor <= 0) {
    console.log('[efi-process-pix] repasse pulado: valor inválido.');
    return;
  }

  try {
    // idEnvio precisa ser único e idempotente — usar o próprio e2eid evita reenvio duplicado
    // caso essa função rode mais de uma vez para o mesmo Pix (ex: duas abas com polling).
    const idEnvio = 'rep' + e2eid.replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
    const resultado = await enviarPix({
      idEnvio,
      valor: valor.toFixed(2),
      chaveOrigem,
      chaveDestino,
      descricao: 'Repasse automatico formatura',
    });
    console.log('[efi-process-pix] repasse enviado com sucesso:', JSON.stringify(resultado));
  } catch (err) {
    console.error('[efi-process-pix] FALHA no repasse automático para Nubank:', err.message);
  }
}

async function enviarPushNotifications(novos) {
  if (novos.length === 0) return;

  const subsDoc = await getDoc('formatura', 'push_subscriptions');
  const subs = subsDoc?.subscriptions || [];
  if (subs.length === 0) return;

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
        console.warn('[efi-process-pix] push FALHOU:', err.statusCode, err.message);
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

// Recebe a lista crua de Pix retornada por listarPixRecebidos (ou um único item do
// webhook) e processa só os que ainda não estão registrados no Firestore.
// Retorna a lista de Pix já processados (novos + já existentes), no formato usado
// pelo front-end, para o efi-proxy.js poder devolver direto na resposta.
async function processarPixRecebidos(pixArrayBruto) {
  const pixDoc = (await getDoc('formatura', 'pix')) || { logs: [], seen: [] };
  const logs = pixDoc.logs || [];
  const seen = pixDoc.seen || [];
  const novos = [];
  let mudou = false;

  for (const item of pixArrayBruto) {
    const e2eid = item.endToEndId;
    if (!e2eid) continue;

    // IMPORTANTE: a checagem de idempotência usa SOMENTE "seen", nunca "logs".
    // "logs" é o que aparece na tela e é esvaziado pelo botão "Limpar" do front-end —
    // se a checagem dependesse de "logs", um Pix limpo da tela passaria a parecer
    // "novo" de novo no próximo polling (já que não está mais em logs) e voltaria
    // sozinho, que é exatamente o bug relatado. "seen" é o registro permanente de
    // processamento: só cresce, nunca é esvaziado pelo "Limpar".
    const jaProcessado = seen.includes(String(e2eid));
    if (jaProcessado) continue;

    // Busca o detalhe OFICIAL e autenticado — usado principalmente para conferir o valor
    // e o horário com precisão. NOTA: a API da Efí normalmente NÃO retorna o nome do
    // pagador no Pix recebido (proteção de dados) — então "Pagador não identificado" é
    // o resultado esperado na maioria dos casos, não um defeito.
    // Se a busca de detalhe falhar (rede, rate limit, etc.), não descartamos o Pix: usamos
    // os dados que já vieram na listagem, para não perder o registro pra sempre.
    let detalhe = null;
    try {
      detalhe = await getPixPorE2eId(e2eid);
    } catch (err) {
      console.error('[efi-process-pix] falha ao buscar detalhe do Pix (usando dados da listagem):', e2eid, err.message);
    }

    const nome = extractNome(item) || extractNome(detalhe) || 'Pagador não identificado';
    const valor = Number(detalhe?.valor ?? item.valor ?? 0);
    const banco = bancoFromEndToEndId(e2eid) || 'Banco não identificado';
    const horarioBruto = detalhe?.horario || item.horario;
    const dt = horarioBruto ? new Date(horarioBruto) : new Date();

    console.log('[efi-process-pix] PIX RECEBIDO — nome:', nome, '| banco:', banco, '| valor:', valor);

    // IMPORTANTE: o front-end (index.html) espera os campos "data" e "hora" já formatados
    // em pt-BR (strings), e "id" no formato "pix_<e2eid>" — é o mesmo formato que
    // fetchEfiPayments() monta no client. Os dois caminhos gravam no mesmo documento
    // Firestore (formatura/pix), então o formato precisa ser idêntico nos dois lados,
    // senão o front-end mostra "undefined" ao receber a versão gravada pelo backend.
    const entry = {
      id: 'pix_' + e2eid,
      pixId: String(e2eid),
      txid: detalhe?.txid || item.txid || null,
      name: nome,
      bank: banco,
      value: valor,
      data: dt.toLocaleDateString('pt-BR'),
      hora: dt.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      ts: dt.getTime(),
      assignedTo: null,
    };
    logs.unshift(entry);
    if (logs.length > 200) logs.length = 200;
    novos.push(entry);
    mudou = true;

    seen.push(String(e2eid));
    if (seen.length > 500) seen.splice(0, seen.length - 500);

    // ── Repasse automático para a conta Nubank ──
    // Roda sempre que o Pix é processado pela primeira vez (ou seja, toda vez que
    // passa pelo "if (jaProcessado) continue" acima sem ser pulado).
    await tentarRepasse(e2eid, valor);
  }

  if (mudou) {
    await setDocREST('formatura', 'pix', { logs, seen, updatedAt: Date.now() });
    console.log('[efi-process-pix] Firestore atualizado. novos:', novos.length);
  }

  if (novos.length > 0) {
    await enviarPushNotifications(novos);
  }

  return logs;
}

module.exports = { processarPixRecebidos };
