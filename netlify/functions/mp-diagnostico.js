// Netlify Function de DIAGNÓSTICO — acesse pelo navegador (inclusive no celular):
//   https://SEU-SITE.netlify.app/.netlify/functions/mp-diagnostico
//
// Mostra, em texto simples, o que está salvo no Firestore agora:
// quantas subscriptions de push existem e quantos Pix estão registrados.
// Não precisa do painel do Netlify para usar isso.

const { getDoc } = require('./firestore-lib.js');

exports.handler = async function () {
  try {
    const subsDoc = await getDoc('formatura', 'push_subscriptions');
    const pixDoc = await getDoc('formatura', 'pix');

    const subs = subsDoc?.subscriptions || [];
    const logs = pixDoc?.logs || [];
    const seen = pixDoc?.seen || [];

    let texto = '=== DIAGNÓSTICO FORMATURA ===\n\n';
    texto += `Inscrições de push salvas: ${subs.length}\n`;
    if (subs.length === 0) {
      texto += '  -> NENHUMA inscrição encontrada. É provável que o botão\n';
      texto += '     "Ativar Notificações" não esteja conseguindo salvar a\n';
      texto += '     inscrição no servidor. Isso explicaria a notificação\n';
      texto += '     não estar chegando.\n';
    } else {
      subs.forEach((s, i) => {
        try {
          const parsed = JSON.parse(s);
          texto += `  [${i + 1}] endpoint: ${parsed.endpoint?.slice(0, 70)}...\n`;
        } catch (e) {
          texto += `  [${i + 1}] (inscrição com formato inválido)\n`;
        }
      });
    }

    texto += `\nPix registrados: ${logs.length}\n`;
    logs.slice(0, 5).forEach((l) => {
      texto += `  - ${l.name} | R$ ${l.amount} | id ${l.id}\n`;
    });

    texto += `\nIDs já marcados como "vistos": ${seen.length}\n`;

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: texto,
    };
  } catch (err) {
    return {
      statusCode: 200,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      body: 'ERRO ao consultar Firestore: ' + err.message,
    };
  }
};
