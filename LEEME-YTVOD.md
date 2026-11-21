# YTVOD · vídeos de YouTube con el chat de Twitch
Hecho por **@byalvaro__**

YTVOD es una app que solo enseña los vídeos que tienen chat. Para el chat usa tu extensión **Chat Replay**, y la coge de su repositorio **CHAT-DE-YT**, así que cada versión nueva de la extensión llega sola a la app. La extensión de Chrome sigue funcionando igual que siempre.

- Repositorio de la app: **ByAlvaroo/YTVOD** → https://byalvaroo.github.io/YTVOD/app/
- Repositorio de la extensión: **ByAlvaroo/CHAT-DE-YT** (de ahí sale el chat)

## 1. Publicar (una vez)
1. GitHub Desktop → **CHAT-DE-YT** → Commit + **Push** (extensión 1.9.0).
2. GitHub Desktop → **YTVOD** → Commit + **Push**.
3. En github.com, en **los dos** repositorios: **Settings → Pages** → *Deploy from a branch* → **main**, carpeta **/ (root)** → **Save**.
4. En Chrome, actualiza la extensión a la 1.9.0 (te saldrá el aviso en YouTube → ⚡ Automática).

## 2. Tus cuentas, ajustes y chats
Abre YTVOD en el mismo Chrome donde tienes la extensión (YTVOD.exe usa ese Chrome). La primera vez **se trae todo sola**: tus cuentas (con la sesión y la contraseña), tus ajustes, la sincronización de cada vídeo, tu token para publicar la configuración de ByAlvaro y los chats guardados. Para repetirlo: menú ☰ → **Traer todo de la extensión**.

En el iPad y el móvil no hay extensión: inicia sesión en Ajustes → Tu cuenta y te llega la configuración de ByAlvaro.

## 3. Clave de Google
Ponla en **app/config.js** (`apiKey: 'AIza…'`) y haz push. Así vale en todos los dispositivos. Necesita **Google Drive API** y **YouTube Data API v3** activadas y estar restringida a `https://byalvaroo.github.io/*` y `http://localhost:47821/*`.

## 4. Instalar
- **PC**: YTVOD.exe (si Windows avisa: Más información → Ejecutar de todas formas).
- **iPad / iPhone**: Safari → https://byalvaroo.github.io/YTVOD/app/ → Compartir → **Añadir a pantalla de inicio**.
- **Android**: Chrome → mismo enlace → ⋮ → **Instalar aplicación**.

## 5. Actualizaciones
- **Extensión**: publícala en CHAT-DE-YT como siempre y la app la usa sola.
- **App**: cambia los archivos de YTVOD, sube el número en `app/version.json` y haz push.
- La app coge la versión nueva al abrirla (en el inicio se actualiza sola; si estás viendo un vídeo, te pregunta y sigue en el mismo minuto).
