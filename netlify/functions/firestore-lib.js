// Cliente mínimo para o Firestore via REST API (sem depender do firebase-admin SDK,
// para não precisar de `npm install` / Service Account no servidor).
//
// Usa a mesma apiKey pública já usada pelo cliente web (mesmo nível de acesso
// que o app já tem hoje rodando no navegador).

const PROJECT_ID = 'taterceiro-4bccc';
const API_KEY = 'AIzaSyDQ0oea2ZrAn_dtzqOWh_BBDQzWQS2Q6eU';
const BASE_URL = `https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)/documents`;

// Converte um valor JS simples para o formato de "Value" do Firestore
function toFirestoreValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') {
    return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  }
  if (Array.isArray(v)) {
    return { arrayValue: { values: v.map(toFirestoreValue) } };
  }
  if (typeof v === 'object') {
    const fields = {};
    for (const k of Object.keys(v)) fields[k] = toFirestoreValue(v[k]);
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}

// Converte um "Value" do Firestore de volta para um valor JS simples
function fromFirestoreValue(val) {
  if (!val) return null;
  if ('stringValue' in val) return val.stringValue;
  if ('booleanValue' in val) return val.booleanValue;
  if ('integerValue' in val) return parseInt(val.integerValue, 10);
  if ('doubleValue' in val) return val.doubleValue;
  if ('nullValue' in val) return null;
  if ('arrayValue' in val) {
    const arr = val.arrayValue.values || [];
    return arr.map(fromFirestoreValue);
  }
  if ('mapValue' in val) {
    const fields = val.mapValue.fields || {};
    const obj = {};
    for (const k of Object.keys(fields)) obj[k] = fromFirestoreValue(fields[k]);
    return obj;
  }
  return null;
}

function objToFirestoreFields(obj) {
  const fields = {};
  for (const k of Object.keys(obj)) fields[k] = toFirestoreValue(obj[k]);
  return fields;
}

function firestoreDocToObj(doc) {
  if (!doc || !doc.fields) return null;
  const obj = {};
  for (const k of Object.keys(doc.fields)) obj[k] = fromFirestoreValue(doc.fields[k]);
  return obj;
}

// Lê um documento. Retorna null se não existir.
async function getDoc(collection, id) {
  const res = await fetch(`${BASE_URL}/${collection}/${id}?key=${API_KEY}`);
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore GET falhou: HTTP ${res.status} ${text}`);
  }
  const doc = await res.json();
  return firestoreDocToObj(doc);
}

// Sobrescreve (cria ou substitui) um documento por completo
async function setDocREST(collection, id, dataObj) {
  const body = { fields: objToFirestoreFields(dataObj) };
  const res = await fetch(`${BASE_URL}/${collection}/${id}?key=${API_KEY}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Firestore PATCH falhou: HTTP ${res.status} ${text}`);
  }
  return res.json();
}

module.exports = { getDoc, setDocREST };
