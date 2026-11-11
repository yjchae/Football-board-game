// ─────────────────────────────────────────────
// 서비스 워커: 홈 화면 앱이 빠르게 열리고, 인터넷이 끊겨도
// (오프라인 엔진으로) 게임을 할 수 있게 앱 파일을 기기에 저장한다.
// AI 서버 요청은 절대 저장하지 않는다.
// ─────────────────────────────────────────────
const CACHE = 'card-football-v1';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'];
const CACHEABLE_HOSTS = [self.location.host, 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (!CACHEABLE_HOSTS.includes(url.host)) return; // AI API 등은 그대로 통과

  // 화면(HTML): 최신 버전 우선, 오프라인이면 저장본
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html')),
    );
    return;
  }

  // JS/CSS/폰트/아이콘: 저장본 우선 (파일명에 해시가 있어 안전)
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok || res.type === 'opaque') {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
