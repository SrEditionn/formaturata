# Migração Mercado Pago → Efí — guia de configuração

O código já está todo migrado. Falta só configurar as variáveis de ambiente no Netlify
(nunca no código/Git) e fazer 1 chamada única para registrar o webhook na Efí.

## 1. Variáveis de ambiente no Netlify

Site settings → Environment variables → Add a variable. Adicione exatamente estas:

| Variável | Valor |
|---|---|
| `EFI_CLIENT_ID` | `Client_Id_74294355ed6f0bae48a722675133a15f0e19ed8a` |
| `EFI_CLIENT_SECRET` | `Client_Secret_bff3aeeb26ba3bdb4289958034fde087e536b5ff` |
| `EFI_CERTIFICADO_BASE64` | conteúdo do arquivo `efi_certificado_base64.txt` (anexo) — é o seu `.p12` convertido para base64 |
| `EFI_CERT_PASSPHRASE` | a senha do certificado `.p12`, **se houver** (deixe em branco se não tiver) |
| `EFI_AMBIENTE` | `producao` |
| `EFI_PIX_KEY` | `taterceiro@gmail.com` |
| `EFI_PIX_KEY_ORIGEM_ENVIO` | `taterceiro@gmail.com` (mesma chave — confirme com a Efí se a chave de envio precisa ser diferente da de recebimento) |
| `NUBANK_PIX_KEY` | `43a2f26e-13e1-43be-bc34-385a168d1314` |
| `SETUP_SECRET` | invente uma senha forte só sua, ex: `b323ab8d82217697c81602f95144160c` (troque por outra) |

⚠️ **Importante sobre segurança:** você colou o Client_ID, Client_Secret e o certificado de
produção nesta conversa. Eu não consigo apagar isso do histórico do chat por você — o ideal
é, depois de configurar tudo, **gerar um novo certificado e um novo Client_Secret no painel
da Efí** e usar os novos no lugar destes. Mantenha as credenciais sempre como variável de
ambiente, nunca dentro de um arquivo que vá pro GitHub.

## 2. Registrar o webhook (rodar 1 vez, depois do deploy)

Depois de configurar as variáveis acima e o site já estar publicado, acesse uma vez:

```
https://SEU-SITE.netlify.app/.netlify/functions/efi-register-webhook?secret=SUA_SETUP_SECRET
```

Isso avisa a Efí para chamar `efi-webhook` toda vez que um Pix cair na sua chave. Se der
`ok: true`, está tudo certo. Se dar erro, me mande a mensagem que aparecer.

## 3. Repasse automático para o Nubank

Você confirmou que o produto "Conta Digital / Envio de Pix" está liberado na sua conta Efí,
então com as variáveis `EFI_PIX_KEY_ORIGEM_ENVIO` e `NUBANK_PIX_KEY` configuradas (seção 1),
o repasse automático já fica ativo: assim que um Pix é confirmado, o `efi-webhook.js` chama
`enviarPix` e manda o valor total recebido pra chave `43a2f26e-13e1-43be-bc34-385a168d1314`,
sem nenhum desconto.

Se em algum momento o envio falhar (ex: saldo insuficiente, chave de origem sem permissão
de envio naquele momento, etc.), isso fica registrado no log do Netlify Functions e o
dinheiro simplesmente fica te aguardando na conta Efí — o recebimento e a exibição na tela
não são afetados de jeito nenhum.

Se quiser reter uma taxa ou só repassar acima de um valor mínimo, me avise que eu ajusto a regra.

## 4. O que mudou no painel de Pix do site

- Agora aparece o **nome completo de quem pagou** em destaque.
- Embaixo do nome, o **banco de origem** (menor, identificado automaticamente pelo
  `endToEndId` do Pix).
- Embaixo do banco, o **valor**.
- Data e horário continuam no canto direito, como já era.

## 5. Arquivos trocados

- `netlify/functions/efi-lib.js` — cliente da API Pix da Efí (OAuth2 + mTLS com o certificado)
- `netlify/functions/efi-webhook.js` — recebe a notificação de Pix da Efí (substitui `mp-webhook.js`)
- `netlify/functions/efi-proxy.js` — lista os Pix recentes pro front-end (substitui `mp-proxy.js`)
- `netlify/functions/efi-register-webhook.js` — endpoint de configuração única do webhook
- `netlify/functions/efi-save-subscription.js` — salva inscrições de notificação (substitui `mp-save-subscription.js`, lógica igual)
- `netlify/functions/efi-bancos.js` — tabela ISPB → nome do banco
- `index.html` e `sw.js` — todas as referências ao Mercado Pago foram trocadas pela Efí

Nenhum arquivo ficou com token/segredo dentro do código — tudo lê de variável de ambiente
agora (o `mp-proxy.js` antigo tinha o token do Mercado Pago direto no código-fonte, isso foi corrigido).
