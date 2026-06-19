// Netlify Function de TESTE — dispara uma notificação push de teste para
// todos os navegadores inscritos, sem depender de nenhum Pix real.
// Acesse pelo navegador:
//   https://SEU-SITE.netlify.app/.netlify/functions/mp-teste-push

const { sendWebPush } = require('./webpush-lib.js');
const { getDoc, setDocREST } = require('./firestore-lib.js');

const VAPID_PUBLIC_KEY = 'BE4MscUkWvkoRhjXPj_ixZ57h4-PBnUHlxsxKug1BW8T57EU-bkAR5zun0td8aJUxzu6_nQcru15_Z8J9XcPfNE';
const VAPID_PRIVATE_KEY = 'nOveZwVINacfN_lw7fZTkjDEFSpwHlswkSNOx07bCVg';
const VAPID_SUBJECT = 'mailto:contato@example.com';

exports.handler = async function () {
  let texto = '=== TESTE DE PUSH ===\n\n';
  try {
    const subsDoc = await getDoc('formatura', 'push_subscriptions');
    const subs = subsDoc?.subscriptions || [];
    texto += `Inscrições encontradas: ${subs.length}\n\n`;

    if (subs.length === 0) {
      texto += 'Nenhuma inscrição para testar.';
      return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: texto };
    }

    const payload = { title: '🔔 Teste de Push', body: 'Se você está vendo isso, o push funciona!' };

    const stillValid = [];
    for (const sub of subs) {
      try {
        const parsed = JSON.parse(sub);
        await sendWebPush(parsed, payload, VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT);
        texto += `[OK] Enviado para: ${parsed.endpoint.slice(0, 60)}...\n`;
        stillValid.push(sub);
      } catch (err) {
        texto += `[FALHOU] HTTP ${err.statusCode || '?'} - ${err.message}\n`;
        if (err.statusCode !== 404 && err.statusCode !== 410) stillValid.push(sub);
      }
    }

    if (stillValid.length !== subs.length) {
      await setDocREST('formatura', 'push_subscriptions', { subscriptions: stillValid });
      texto += `\nInscrições inválidas removidas. Restam: ${stillValid.length}\n`;
    }

    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: texto };
  } catch (err) {
    texto += 'ERRO GERAL: ' + err.message + '\n' + (err.stack || '');
    return { statusCode: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' }, body: texto };
  }
};
