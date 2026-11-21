// ===== YTVOD · configuración =====
// apiKey: tu clave de Google (API key) con «Google Drive API» y «YouTube Data API v3» activadas.
//         Restríngela a tus webs (https://byalvaroo.github.io/* y http://localhost:47821/*): así nadie más puede usarla.
// extPaths: de dónde se coge el chat (se usa la versión más nueva): primero la extensión publicada en CHAT-DE-YT y, si no, la copia de este repositorio.
// searchesPerDay: cuántos títulos nuevos puede buscar cada dispositivo al día en YouTube (cada búsqueda gasta 100 de 10.000 unidades diarias gratis).
window.CHAT_REPLAY = {
  apiKey: 'AIzaSyAJh3w5tZEFQYVn_ziuF1rt0LGHwhXvioQ',
  searchesPerDay: 40,
  extPaths: ['/CHAT-DE-YT/chat-replay-youtube/', '../chat-replay-youtube/']
};
