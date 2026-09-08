const CACHE = "routine-log-v2";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))));
  self.clients.claim();
});
// 네트워크 우선: 온라인이면 항상 최신 파일을 받아오고, 캐시에도 갱신해둔다.
// 오프라인일 때만 캐시된 마지막 버전을 사용한다.
self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        const resClone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, resClone));
        return res;
      })
      .catch(() => caches.match(e.request).then((res) => res || caches.match("./index.html")))
  );
});
