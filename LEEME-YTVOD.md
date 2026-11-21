# YTVOD · vídeos de YouTube con el chat de Twitch
Hecho por **@byalvaro__**

YTVOD es una app que solo enseña los vídeos que tienen chat. Va **totalmente aparte** de tu extensión **Chat Replay**: usa su propia copia del chat (la carpeta `chat-replay-youtube` de este repositorio), no cambia nada de la extensión y **nunca publica** en tu configuración de ByAlvaro (solo la lee).

- Repositorio de la app: **ByAlvaroo/YTVOD** → https://byalvaroo.github.io/YTVOD/app/

## 1. Publicar (una vez)
1. GitHub Desktop → **YTVOD** → Commit + **Push**.
2. En github.com, en el repositorio YTVOD: **Settings → Pages** → *Deploy from a branch* → **main**, carpeta **/ (root)** → **Save**.

## 2. Tus cuentas y ajustes
En la app: ⚙ → **Tu cuenta** → inicia sesión. La configuración de ByAlvaro (ajustes y sincronización de cada vídeo) llega sola, solo para leer: lo que cambies en la app se queda en la app.

## 3. Clave de Google
Ponla en **app/config.js** (`apiKey: 'AIza…'`) y haz push. Así vale en todos los dispositivos. Necesita **Google Drive API** y **YouTube Data API v3** activadas y estar restringida a `https://byalvaroo.github.io/*` y `http://localhost:47821/*`.

## 4. Instalar
- **PC**: YTVOD.exe (si Windows avisa: Más información → Ejecutar de todas formas).
- **iPad / iPhone**: Safari → https://byalvaroo.github.io/YTVOD/app/ → Compartir → **Añadir a pantalla de inicio**.
- **Android**: Chrome → mismo enlace → ⋮ → **Instalar aplicación**.

## 5. Actualizaciones
- **Extensión**: va aparte; la app no la usa ni la toca. Si quieres llevar a la app algo nuevo del chat, se copia a la carpeta `chat-replay-youtube` de YTVOD.
- **App**: cambia los archivos de YTVOD, sube el número en `app/version.json` y haz push.
- La app coge la versión nueva al abrirla (en el inicio se actualiza sola; si estás viendo un vídeo, te pregunta y sigue en el mismo minuto).
