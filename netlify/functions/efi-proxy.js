// Netlify Function: proxy seguro para a API Pix da Efí
// Arquivo: netlify/functions/efi-proxy.js
// Usado pelo polling do front-end (a cada 12s) como reforço além do webhook em tempo real.

const { listarPixRecebidos } = require('./efi-lib.js');
const { bancoFromEndToEndId } = require('./efi-bancos.js');

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

    const results = recebidos.map((p) => ({
      id: p.endToEndId,
      pixId: p.endToEndId,
      name: (p.pagador?.nome || p.devedor?.nome || 'Pagador não identificado'),
      bank: bancoFromEndToEndId(p.endToEndId) || 'Banco não identificado',
      value: Number(p.valor || 0),
      date: p.horario,
    }));

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
      body: JSON.stringify({ results }),
    };
  } catch (err) {
    return {
      statusCode: 502,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: err.message }),
    };
  }
};
