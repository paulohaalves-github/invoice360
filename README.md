# Invoice360

Aplicação Next.js que sincroniza faturas da **360Dialog** via e-mail IMAP, extrai os dados dos PDFs (incluindo o número WhatsApp) e permite acompanhar os custos por linha.

## O que faz

1. Conecta na caixa de e-mail (IMAP)
2. Filtra mensagens cujo assunto **contém** `Your 360dialog invoice`
3. Baixa o PDF anexo e extrai: número da fatura, datas, cliente, número WhatsApp e totais
4. Salva tudo em SQLite (`data/invoices.db`)
5. Exibe resumo por número, com filtros e apelidos (ex.: `553133261400` → `CSP BH`)

## Pré-requisitos

- Node.js 20+
- Conta de e-mail com acesso IMAP

## Configuração

```bash
npm install
cp .env.example .env
```

Edite o `.env` com as credenciais IMAP:


| Variável              | Descrição                                | Padrão                   |
| --------------------- | ---------------------------------------- | ------------------------ |
| `IMAP_HOST`           | Servidor IMAP                            | —                        |
| `IMAP_PORT`           | Porta                                    | `993`                    |
| `IMAP_SECURE`         | TLS (`true`/`false`)                     | `true`                   |
| `IMAP_USER`           | Usuário / e-mail                         | —                        |
| `IMAP_PASS`           | Senha ou app password                    | —                        |
| `IMAP_FOLDER`         | Pasta a varrer                           | `INBOX`                  |
| `IMAP_SEARCH_SUBJECT` | Texto que o assunto deve conter          | `Your 360dialog invoice` |
| `IMAP_MAX_MESSAGES`   | Quantos e-mails recentes varrer (`0` = todos) | `0`                      |




## Uso

```bash
npm run dev
```

Abra [http://localhost:3001](http://localhost:3001) e clique em **Sincronizar e-mails**.

Na tela você pode:

- Filtrar por **número WhatsApp** e **período de emissão**
- Ver o **resumo por número** (apelido, emissão, quantidade de faturas, total)
- Definir **apelidos** para cada número.



## Scripts


| Comando               | Descrição                                |
| --------------------- | ---------------------------------------- |
| `npm run dev`         | Servidor de desenvolvimento (porta 3001) |
| `npm run build`       | Build de produção                        |
| `npm start`           | Servidor de produção (porta 3001)        |
| `npm run lint`        | ESLint                                   |
| `npm run test:parser` | Testa o parser do PDF 360Dialog          |




## Estrutura

```
app/
  api/invoices/   # Listagem, filtros e resumo
  api/sync/       # Sincronização IMAP
  api/labels/     # Apelidos por número WhatsApp
  components/     # Dashboard
lib/
  db.ts           # SQLite
  imap-sync.ts    # Leitura IMAP + anexos
  pdf-parser.ts   # Extração do PDF 360Dialog
data/             # Banco e PDFs (ignorado no git)
```



## Dados locais

- Banco: `data/invoices.db`
- PDFs: `data/pdfs/`

Esses arquivos ficam fora do versionamento. Não é necessário criar a pasta `data/` manualmente — ela é criada na primeira sincronização.

## Observações

- Rode preferencialmente em máquina local ou VPS com disco (SQLite + IMAP não se encaixam bem em serverless puro).
- O filtro de assunto usa **contém** (não exige igualdade). Ex.: `Re: Your 360dialog invoice INV26-…` é importado.
- E-mails já processados não são reimportados (`message_id` único).

