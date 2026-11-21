# YTVOD · vídeos de YouTube con el chat de Twitch
Hecho por **@byalvaro__**

YTVOD es una app que solo enseña los vídeos que tienen chat. Para el chat usa el código de tu extensión **Chat Replay**: mismos ajustes, misma sincronización y la misma configuración de ByAlvaro. La extensión de Chrome sigue funcionando igual que siempre.

---

## 1. Probarla ya en el PC (sin subir nada)
1. Haz doble clic en **YTVOD.exe**. Se abre en su propia ventana, usando Chrome o Edge.
   - La primera vez Windows puede decir «Windows protegió tu PC». Pulsa **Más información → Ejecutar de todas formas** (sale porque el programa no está firmado).
2. Menú ☰ → **Clave de Google** → pega tu clave → **Guardar y probar** (cómo crearla, en el punto 2).
3. La app mira tu carpeta de Drive y, si un chat se llama igual que un vídeo de YouTube, lo añade al inicio sin hacer nada más.

Mientras no subas la app a GitHub, YTVOD.exe usa la copia que lleva dentro. En cuanto la subas, coge siempre la versión de GitHub.

## 2. Crear la clave de Google (gratis, unos 5 minutos)
La necesitas porque una web no puede leer Drive como lo hace la extensión: Google lo bloquea.
1. Entra en **console.cloud.google.com** con tu cuenta de Google y crea un proyecto (por ejemplo, «YTVOD»).
2. **APIs y servicios → Biblioteca**: activa **Google Drive API** y **YouTube Data API v3**.
3. **APIs y servicios → Credenciales → Crear credenciales → Clave de API**.
4. En la clave, pulsa **Editar**:
   - *Restricciones de aplicación* → **Sitios web** → añade `https://byalvaroo.github.io/*` y `http://localhost:47821/*`.
   - *Restricciones de API* → elige solo **Google Drive API** y **YouTube Data API v3**.
5. Copia la clave (empieza por `AIza…`) y ponla en **app/config.js**, en `apiKey: '…'`. Así funciona para todo el mundo. Con esas restricciones nadie la puede usar desde otra web.

No pide tarjeta. YouTube da 10.000 unidades gratis al día: cada búsqueda de un título nuevo gasta 100 y la lista de vídeos casi nada. Cada dispositivo busca como mucho 40 títulos al día (se cambia en config.js).

## 3. Subirla a GitHub (para el iPad, el móvil y los demás)
1. Copia todo lo de este zip dentro de tu carpeta **Documents\GitHub\CHAT-DE-YT**, reemplazando lo que haya: `app/`, `chat-replay-youtube/`, `chat-replay-youtube.zip`, `sw.js` y `.nojekyll`.
2. En el `version.json` de la raíz pon `"version": "1.9.0"` y en `resumen` algo como «Compatible con la app YTVOD».
3. GitHub Desktop → **Commit** → **Push origin**.
4. En github.com → repositorio **CHAT-DE-YT** → **Settings → Pages** → *Source*: **Deploy from a branch** → rama **main**, carpeta **/ (root)** → **Save**.
5. Al minuto, la app está en: **https://byalvaroo.github.io/CHAT-DE-YT/app/**

## 4. Instalarla
- **iPad / iPhone**: abre el enlace en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**. Queda como una app más, a pantalla completa.
- **Android**: abre el enlace en Chrome → menú ⋮ → **Instalar aplicación**.
- **PC**: YTVOD.exe. También puedes abrir el enlace en Chrome o Edge → **Instalar YTVOD**.

## 5. Actualizaciones (automáticas)
- **Cambias la extensión** (subes una versión nueva de `chat-replay-youtube` como siempre): la app la usa sola, porque carga el chat desde esa misma carpeta de GitHub.
- **Cambias la app** (carpeta `app/`): sube el número en `app/version.json` y pon una frase en `resumen`.
- Al abrir la app (en el PC, el iPad o el móvil) coge la versión nueva. En el inicio se actualiza sola; si estás viendo un vídeo, te pregunta y sigue en el mismo minuto.

## Cómo encuentra los vídeos
- Salen los vídeos de **tu configuración de ByAlvaro** (los que ya tienen chat) y los que tienen chat en ese dispositivo.
- La app busca en YouTube el **título de cada chat de tu Drive** y lo une solo si el título es **idéntico**. No cuentan las mayúsculas, las tildes ni los signos, porque Windows no deja poner `?`, `:` o `"` en los nombres de archivo.
- Si lo encuentras con tu cuenta **ByAlvaro** (con tu token puesto), se publica en tu configuración y a los demás les aparece sin gastar búsquedas.
- Los chats que no encuentra salen abajo, en **«Chats sin vídeo»**, con los botones **Buscar** y **Pegar enlace**.
- **＋ Añadir**: pega cualquier enlace de YouTube. Se abre con el chat igual que con la extensión.

## Ten en cuenta
- Los vídeos se ven con el **reproductor oficial de YouTube**, así que pueden salir anuncios.
- Algunos dueños no dejan ver sus vídeos fuera de YouTube: la app lo avisa y te ofrece abrirlo en YouTube, donde funciona la extensión.
- El mapa de calor y los marcadores salen en una barra **debajo** del vídeo, porque la barra de YouTube incrustado no se puede tocar.
- Pantalla completa: usa el botón **Pantalla completa** de la app (no el de YouTube) para tener el chat al lado. En el móvil, gira la pantalla.
- Tus ajustes se guardan en cada dispositivo. La configuración de ByAlvaro llega a todos los dispositivos sola.
