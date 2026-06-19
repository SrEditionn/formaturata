# O que mudou

## 1. Botão "Limpar" agora é compartilhado (correção do bug relatado)

Antes, os Pix ficavam salvos só no `localStorage` do seu navegador. Agora eles ficam
salvos no Firestore (mesmo banco de dados já usado pelas "Categorias"), então:

- Quando você clica em **Limpar**, a lista some para **todo mundo** que abrir o site.
- Pix novos aparecem para todo mundo em tempo real, sem precisar dar F5.

Isso já funciona assim que você publicar o `Formatura-v27.html` atualizado — não
precisa de nenhuma configuração extra para essa parte.

## 2. Notificação push real (funciona com o site fechado)

Agora existe um caminho **instantâneo**: o Mercado Pago avisa diretamente o seu
servidor (Netlify Function) no exato momento em que um Pix é aprovado, e o servidor
manda a notificação para o celular/computador de quem ativou — mesmo com o site
fechado ou minimizado.

### Arquivos novos
- `sw.js` — Service Worker, precisa ficar na raiz do site.
- `netlify/functions/mp-webhook.js` — recebe o aviso do Mercado Pago.
- `netlify/functions/mp-save-subscription.js` — guarda a inscrição de cada navegador.
- `netlify/functions/webpush-lib.js` — criptografia do protocolo Web Push (sem dependências externas).
- `netlify/functions/firestore-lib.js` — cliente simples para o Firestore via REST.
- `netlify/functions/mp-proxy.js` — igual ao que você já tinha (mantido sem mudanças).

### Passo a passo para ativar o push

**1. Publique todos os arquivos deste pacote no Netlify**, mantendo exatamente esta
estrutura de pastas (o `sw.js` precisa estar na raiz, não dentro de uma subpasta).

**2. Configure o webhook no painel do Mercado Pago:**
   1. Acesse https://www.mercadopago.com.br/developers/panel/app
   2. Entre na sua aplicação → **Webhooks** (ou "Notificações")
   3. Adicione a URL:
      ```
      https://SEU-SITE.netlify.app/.netlify/functions/mp-webhook
      ```
      (troque `SEU-SITE` pelo domínio real do seu site no Netlify)
   4. Marque o evento **Pagamentos** (`payment`)
   5. Salve

**3. No site, clique em "🔔 Ativar Notificações"** normalmente — isso já vai, nos
bastidores, registrar o Service Worker e inscrever o navegador para receber push.

**4. Teste:** peça para alguém te mandar um Pix de teste (ou use o ambiente de teste
do Mercado Pago). A notificação deve chegar mesmo com a aba fechada, em poucos
segundos.

### Observações importantes

- **Cada pessoa precisa clicar em "Ativar Notificações" no próprio navegador/celular**
  para receber push nele. Não existe um jeito de ativar para todo mundo de uma vez.
- Em iPhone, notificações push em sites (PWA) só funcionam se o site for **adicionado
  à tela de início** (Safari → Compartilhar → Adicionar à Tela de Início). É uma
  limitação da Apple, não do código.
- O ícone usado na notificação é `/icon-192.png` — se esse arquivo não existir no seu
  site, o navegador mostra um ícone padrão (não quebra nada, só fica menos bonito).
  Se quiser, me envie uma imagem que eu preparo esse ícone.
- O polling antigo (a cada 12 segundos, só funcionando com o site aberto) **continua
  existindo** como reforço — ele não foi removido, só passou a coexistir com o push.

## ⚠️ Importante: token do Mercado Pago exposto

O arquivo `mp-proxy.js` original contém o seu **access token de produção** do Mercado
Pago em texto puro. Eu mantive ele como estava (para o webhook funcionar, ele
precisa do mesmo token), mas recomendo fortemente que você:

1. Gere um novo token no painel do Mercado Pago (o atual deve ser considerado
   comprometido, já que passou por este chat).
2. Configure-o como **variável de ambiente** no Netlify (Site settings → Environment
   variables → `MP_ACCESS_TOKEN`) em vez de deixá-lo escrito direto no código.
3. Troque, nos arquivos `mp-proxy.js` e `mp-webhook.js`, a linha:
   ```js
   const MP_ACCESS_TOKEN = 'APP_USR-...';
   ```
   por:
   ```js
   const MP_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
   ```

Posso fazer essa troca para variável de ambiente agora mesmo, se você quiser — é
rápido e bem mais seguro.
