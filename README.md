# Habiestilo Digital Signage (Vertical 9:16)

Mini-site de digital signage vertical (`1080x1920`, compatível com **Xopvision** em **Samsung OM55N / Tizen 4.0 / Chromium 56**) sincronizado com os imóveis de `https://www.habiestilo.com`, com animações de entrada, *crossfade* entre fotos, QR Code dinâmico e mini dashboard de gestão.

## Funcionalidades

- **Ecrã Digital Signage (`/`)**:
  - Palco `1080x1920` escalado automaticamente, compatível com Tizen 4.0 (Chromium 56) e zonas HTML5 / Web URL do Xopvision.
  - 25s por imóvel, 5s por foto com *fade-in / fade-out*, QR Code dinâmico para o anúncio e atualização automática sem interromper o imóvel atual.
- **Mini Dashboard (`/dashboard`)**:
  - Lista os imóveis ativos e inativos com pesquisa e filtros (`Todos`, `Venda`, `Arrendamento`, `Inativos`).
  - Mostra alterações entre sincronizações: **Saíram os imóveis**, **Mudança de valor nos imóveis** e **Foram adicionados os imóveis** (com histórico).
  - Permite **reordenar** (*drag & drop* ou `▲` / `▼`) e **inativar/ativar** imóveis, mantendo as preferências entre sincronizações.
  - Botão **Sincronizar Agora** + suporte a sincronização via comando (`npm run sync`).

## Correr localmente

1. Instalar dependências:
   ```bash
   npm install
   ```
2. Sincronizar imóveis:
   ```bash
   npm run sync
   ```
3. Iniciar servidor:
   ```bash
   npm start
   ```
   - Digital Signage: `http://localhost:3000`
   - Mini Dashboard: `http://localhost:3000/dashboard`

## Publicar online gratuitamente (Render + PostgreSQL gratuito)

O projeto inclui `render.yaml` e `Dockerfile`, além de suporte automático a **PostgreSQL** via `DATABASE_URL` (para que a ordem personalizada, imóveis inativos e histórico não se percam quando o servidor reiniciar) e proteção por palavra-passe no `/dashboard`.

1. **Criar repositório no GitHub** e enviar este projeto (os ficheiros locais `data/` e `.env` já estão no `.gitignore`).
2. **Base de dados gratuita (recomendado)**:
   - Crie um projeto gratuito no **Neon** (`neon.tech`) ou **Supabase** (`supabase.com`) e copie a connection string PostgreSQL (`DATABASE_URL`).
   - A tabela `signage_store` é criada automaticamente no arranque.
3. **Deploy no Render (ou Koyeb / Docker)**:
   - No **Render**, escolha **New → Blueprint** (lê `render.yaml`) ou **New → Web Service** ligado ao seu repositório.
   - Defina as variáveis de ambiente:
     - `DATABASE_URL`: a connection string PostgreSQL do passo 2.
     - `ADMIN_USER`: ex. `admin`.
     - `ADMIN_PASSWORD`: palavra-passe forte para proteger o `/dashboard` e os endpoints de alteração/sync.
     - `AUTO_SYNC_MINUTES`: opcional (ex. `0` para sincronizar apenas via botão/comando, ou `60` para sincronizar de hora em hora automaticamente).
4. **Configurar no Xopvision (Samsung OM55N)**:
   - Adicione um widget **Web URL / HTML5** a apontar para `https://<o-seu-servico>.onrender.com/` (público, sem login).
   - Se o ecrã estiver montado na horizontal sem rotação no Tizen, pode usar `?rotate=90` ou `?rotate=270`.
   - Para gerir os imóveis, aceda a `https://<o-seu-servico>.onrender.com/dashboard` (pedirá `ADMIN_USER` e `ADMIN_PASSWORD`).

## Variáveis de ambiente

Consulte [`.env.example`](.env.example) para a lista completa de variáveis disponíveis.
