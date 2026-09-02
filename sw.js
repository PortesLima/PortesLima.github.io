// Service worker do Bolso Certo — só cache de arquivo estático (shell do app).
// NUNCA toca em dado do usuário: transacoes/orcamentos/contas ficam em localStorage e o
// sync é com googleapis.com (cross-origin, ignorado abaixo). Ver seção "PWA / Service
// worker" no CLAUDE.md.
//
// CACHE: bumpar JUNTO com APP_VERSION no index.html a cada deploy que os usuários precisem
// ver na hora. Trocar este byte faz o browser detectar o SW novo, precachear o index.html
// novo e apagar os caches antigos no 'activate'.
const CACHE = 'bolso-certo-2026-09-02.5';
const SHELL = ['./', './index.html'];

self.addEventListener('install', (e) => {
  // NÃO faz skipWaiting aqui de propósito: o SW novo espera em 'waiting' e a página mostra a
  // faixa "Nova versão disponível". Só assume o controle quando o usuário manda ('skip-waiting')
  // ou quando fecha e reabre o app.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {}));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  let url;
  try { url = new URL(req.url); } catch (_) { return; }
  // CDNs (Chart.js, jsPDF, Google Identity, PostHog) e a API do Drive (googleapis.com)
  // NUNCA passam pelo SW — dependem de rede e têm cache HTTP próprio. Deixa o browser tratar.
  if (url.origin !== self.location.origin) return;

  // navegação (o HTML): network-first — online sempre pega o HTML fresco e reabastece o
  // cache; offline cai para o último HTML bom. Nunca "gruda" numa versão velha com rede.
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const r = await fetch(req);
        const c = await caches.open(CACHE);
        c.put('./index.html', r.clone());
        return r;
      } catch (_) {
        return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }

  // demais same-origin (na prática só o próprio sw.js): stale-while-revalidate
  e.respondWith((async () => {
    const cached = await caches.match(req);
    const rede = fetch(req).then((r) => {
      if (r && r.ok) caches.open(CACHE).then((c) => c.put(req, r.clone()));
      return r;
    }).catch(() => cached);
    return cached || rede;
  })());
});
