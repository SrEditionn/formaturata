// Netlify Function: proxy seguro para a API Pix da Efí
// Arquivo: netlify/functions/efi-proxy.js
//
// Chamado pelo front-end via polling a cada 12s (fetchEfiPayments em index.html).
// Como o webhook em tempo real da Efí exige mTLS (não suportado em Netlify Functions
// gratuitamente — veja efi-webhook.js), ESTE polling é hoje a única via de atualização:
// a cada chamada, busca os Pix recentes na Efí, processa os que ainda não foram vistos
// (busca nome completo do pagador, grava no Firestore, dispara push notification e tenta
// o repasse automático para o Nubank) e devolve a lista consolidada para a tela.

const { listarPixRecebidos } = require('./efi-lib.js');
const { processarPixRecebidos } = require('./efi-process-pix.js');

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return { statusCode: 405, body: 'Method Not Allowed' };

  const params = event.queryStringParameters || {};
  const dias = Number(params.dias || 7);

  try {
    const fim = new Date();
    const inicio = new Date(fim.getTime() - dias * 24 * 60 * 60 * 1000);

    const data = await listarPixRecebidos({
      inicio: inicio.toISOString(),
      fim: fim.toISOString(),
    });

    const recebidos = Array.isArray(data?.pix) ? data.pix : [];

    // Processa (busca nome oficial, grava no Firestore, notifica, repassa pro Nubank) só
    // os Pix que ainda não tinham sido vistos antes; devolve a lista completa já persistida.
    const logs = await processarPixRecebidos(recebidos);

    const results = logs.map((l) => ({
      id: l.pixId,
      pixId: l.pixId,
      name: l.name,
      bank: l.bank,
      value: l.value,
      date: l.date,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ results }),
    };
  } catch (err) {
    console.error('[efi-proxy] erro:', err.message);
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
