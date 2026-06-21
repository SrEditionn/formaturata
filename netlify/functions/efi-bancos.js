// Tabela de consulta ISPB -> nome do banco.
// O endToEndId de um Pix tem o formato: E + ISPB(8 dígitos) + AAAAMMDDHHmm + 11 caracteres aleatórios.
// O ISPB identifica a instituição financeira de quem ORIGINOU o Pix (o pagador),
// então conseguimos mostrar "de qual banco" o Pix saiu sem precisar de nenhuma API extra.
//
// Lista cobre os participantes mais comuns do Pix no Brasil. Não é exaustiva — qualquer
// ISPB que não estiver aqui simplesmente cai no fallback "Banco não identificado".
// Lista oficial e atualizada: https://www.bcb.gov.br/estabilidadefinanceira/proin

const ISPB_TO_BANCO = {
  '00000000': 'Banco do Brasil',
  '00360305': 'Caixa Econômica Federal',
  '60701190': 'Itaú Unibanco',
  '60746948': 'Bradesco',
  '90400888': 'Santander',
  '00416968': 'Banco Inter',
  '18236120': 'Nubank',
  '01027058': 'C6 Bank',
  '09089356': 'PicPay',
  '22896431': 'Original',
  '13140088': 'BV (Banco Votorantim)',
  '92894922': 'Banrisul',
  '04902979': 'Mercado Pago',
  '38129387': 'PagBank (PagSeguro)',
  '14388334': 'Mercantil do Brasil',
  '07237373': 'Sofisa',
  '23522214': 'Banco Sicoob',
  '02038232': 'Banco Sicredi',
  '31872495': 'Banco XP',
  '02992423': 'Banco BS2',
  '10573521': 'Neon',
  '33172537': 'Banco Modal',
  '24074692': 'Banco Pan',
  '32062580': 'Banco Daycoval',
  '33041260': 'Caixa Econômica (CEF Legado)',
  '08561701': 'CCM Desp Trâns SP e RJ',
  '11476673': 'Agibank',
  '15173776': 'Banco Topázio',
  '29011467': 'Will Bank',
  '13935893': 'Banco Stone',
  '37880206': 'Stone Pagamentos',
  '03311443': 'BTG Pactual',
  '30306294': 'BTG Pactual (Digital)',
  '12865507': 'Will Financeira',
};

function bancoFromEndToEndId(e2eid) {
  if (!e2eid || typeof e2eid !== 'string' || e2eid.length < 9) return null;
  // formato: E + 8 dígitos de ISPB
  const ispb = e2eid.slice(1, 9);
  return ISPB_TO_BANCO[ispb] || null;
}

module.exports = { bancoFromEndToEndId, ISPB_TO_BANCO };
