// Implementação própria do protocolo Web Push (RFC 8291 + RFC 8292 / VAPID),
// sem dependências externas — usa apenas o módulo 'crypto' nativo do Node.
// Isso evita precisar rodar `npm install` no ambiente de deploy.

const crypto = require('crypto');

function b64urlToBuf(str) {
  str = str.replace(/-/g, '+').replace(/_/g, '/');
  while (str.length % 4) str += '=';
  return Buffer.from(str, 'base64');
}

function bufToB64url(buf) {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Constrói o JWT VAPID (assinado com ECDSA P-256 / ES256)
function buildVapidHeader(audience, subject, publicKeyB64url, privateKeyB64url) {
  const header = { typ: 'JWT', alg: 'ES256' };
  const exp = Math.floor(Date.now() / 1000) + 12 * 60 * 60; // 12h
  const payload = { aud: audience, exp, sub: subject };

  const headerB64 = bufToB64url(Buffer.from(JSON.stringify(header)));
  const payloadB64 = bufToB64url(Buffer.from(JSON.stringify(payload)));
  const unsigned = headerB64 + '.' + payloadB64;

  // Reconstrói a chave privada EC a partir do 'd' (raw 32 bytes) em formato JWK
  const dBuf = b64urlToBuf(privateKeyB64url);
  const pubBuf = b64urlToBuf(publicKeyB64url); // 65 bytes: 0x04 || X(32) || Y(32)
  const xBuf = pubBuf.slice(1, 33);
  const yBuf = pubBuf.slice(33, 65);

  const jwk = {
    kty: 'EC',
    crv: 'P-256',
    d: bufToB64url(dBuf),
    x: bufToB64url(xBuf),
    y: bufToB64url(yBuf),
  };

  const privateKey = crypto.createPrivateKey({ key: jwk, format: 'jwk' });

  // ECDSA assinatura em formato 'raw' (r || s), exigido pelo JWT — Node por padrão usa DER, então convertemos
  const derSig = crypto.sign('sha256', Buffer.from(unsigned), { key: privateKey, dsaEncoding: 'der' });
  const rawSig = derToRawEcdsaSig(derSig, 32);

  const jwt = unsigned + '.' + bufToB64url(rawSig);
  return jwt;
}

// Converte assinatura ECDSA do formato DER para o formato raw (r || s) de tamanho fixo
function derToRawEcdsaSig(der, size) {
  // DER: 0x30 len 0x02 rlen r 0x02 slen s
  let offset = 2; // pula 0x30 e len
  if (der[0] !== 0x30) throw new Error('DER inválido');
  // r
  if (der[offset] !== 0x02) throw new Error('DER inválido (r)');
  let rlen = der[offset + 1];
  let rStart = offset + 2;
  let r = der.slice(rStart, rStart + rlen);
  offset = rStart + rlen;
  // s
  if (der[offset] !== 0x02) throw new Error('DER inválido (s)');
  let slen = der[offset + 1];
  let sStart = offset + 2;
  let s = der.slice(sStart, sStart + slen);

  function toFixed(buf, len) {
    buf = buf[0] === 0x00 && buf.length > len ? buf.slice(1) : buf;
    if (buf.length < len) {
      const pad = Buffer.alloc(len - buf.length, 0);
      buf = Buffer.concat([pad, buf]);
    }
    return buf;
  }

  return Buffer.concat([toFixed(r, size), toFixed(s, size)]);
}

// Criptografia do payload conforme RFC 8291 (aes128gcm)
function encryptPayload(payloadBuf, p256dhB64url, authB64url) {
  const userPublicKey = b64urlToBuf(p256dhB64url); // chave pública do navegador (65 bytes)
  const authSecret = b64urlToBuf(authB64url); // 16 bytes

  // Gera par de chaves efêmero do servidor
  const serverEcdh = crypto.createECDH('prime256v1');
  serverEcdh.generateKeys();
  const serverPublicKey = serverEcdh.getPublicKey(); // 65 bytes uncompressed

  const sharedSecret = serverEcdh.computeSecret(userPublicKey);

  // HKDF auth: extrai um PRK a partir do shared secret usando o auth secret como salt,
  // com info "WebPush: info\0" || ua_public || server_public
  const authInfo = Buffer.concat([
    Buffer.from('WebPush: info\0', 'utf8'),
    userPublicKey,
    serverPublicKey,
  ]);
  const prk = hmacSha256(authSecret, sharedSecret);
  const ikm = hkdfExpand(prk, authInfo, 32);

  const salt = crypto.randomBytes(16);

  const prkKey = hmacSha256(salt, ikm);
  const cekInfo = Buffer.from('Content-Encoding: aes128gcm\0', 'utf8');
  const cek = hkdfExpand(prkKey, cekInfo, 16);
  const nonceInfo = Buffer.from('Content-Encoding: nonce\0', 'utf8');
  const nonce = hkdfExpand(prkKey, nonceInfo, 12);

  // Padding: 2 bytes de tamanho do padding (aqui usamos 0) + delimitador 0x02 ao final do payload
  const paddedPayload = Buffer.concat([payloadBuf, Buffer.from([0x02])]);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(paddedPayload), cipher.final()]);
  const authTag = cipher.getAuthTag();
  const encryptedBody = Buffer.concat([ciphertext, authTag]);

  // Header aes128gcm: salt(16) || rs(4, record size) || idlen(1) || keyid(server public key, 65)
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096, 0);
  const idlen = Buffer.from([serverPublicKey.length]);
  const header = Buffer.concat([salt, rs, idlen, serverPublicKey]);

  return Buffer.concat([header, encryptedBody]);
}

function hmacSha256(key, data) {
  return crypto.createHmac('sha256', key).update(data).digest();
}

function hkdfExpand(prk, info, length) {
  // HKDF-Expand simplificado (1 bloco é suficiente pois length <= 32)
  const input = Buffer.concat([info, Buffer.from([0x01])]);
  return hmacSha256(prk, input).slice(0, length);
}

// Envia uma notificação push para uma subscription específica
// subscription = { endpoint, keys: { p256dh, auth } }
async function sendWebPush(subscription, payloadObj, vapidPublicKey, vapidPrivateKey, vapidSubject) {
  const endpoint = subscription.endpoint;
  const url = new URL(endpoint);
  const audience = url.protocol + '//' + url.host;

  const vapidJwt = buildVapidHeader(audience, vapidSubject, vapidPublicKey, vapidPrivateKey);

  const payloadBuf = Buffer.from(JSON.stringify(payloadObj), 'utf8');
  const encrypted = encryptPayload(payloadBuf, subscription.keys.p256dh, subscription.keys.auth);

  const res = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '60',
      'Authorization': `vapid t=${vapidJwt}, k=${vapidPublicKey}`,
    },
    body: encrypted,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(`Push falhou: HTTP ${res.status} ${text}`);
    err.statusCode = res.status;
    throw err;
  }
  return res;
}

module.exports = { sendWebPush, buildVapidHeader, encryptPayload };
