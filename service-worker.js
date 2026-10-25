/*
 * Fiets Knooppunten Opvolger — Service Worker
 * Versie: 4
 *
 * Updatebeleid:
 * - Een nieuwe worker wacht totdat de huidige fietstocht voorbij is.
 * - De app vraagt via een bericht om activatie wanneer de tocht eindigt.
 * - Als de gebruiker de app sluit, kan de wachtende worker daarna normaal activeren.
 * - Alleen oude caches van deze app worden verwijderd.
 *
 * Verhoog CACHE_NAME bij iedere nieuwe publicatie.
 */
'use strict';

const CACHE_PREFIX = 'fiets-knooppunten-';
const CACHE_NAME = `${CACHE_PREFIX}v4`;

const CORE_ASSETS = [
  './index.html',
  './manifest.json'
];

const OPTIONAL_ASSETS = [
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_NAME);

    // De kernbestanden zijn vereist voor de offline-appshell.
    await cache.addAll(CORE_ASSETS);

    // Optionele bestanden mogen een installatie niet blokkeren.
    await Promise.all(OPTIONAL_ASSETS.map(async (url) => {
      try {
        const response = await fetch(url, { cache: 'reload' });
        if (
          response.ok &&
          (response.type === 'basic' || response.type === 'cors')
        ) {
          await cache.put(url, response.clone());
        } else {
          console.warn(
            '[Fietsapp SW] Optioneel bestand niet gecachet:',
            url,
            response.status
          );
        }
      } catch (error) {
        console.warn(
          '[Fietsapp SW] Optioneel bestand niet beschikbaar:',
          url,
          error
        );
      }
    }));

    // Geen skipWaiting(): de app beslist wanneer de tocht voorbij is.
    console.info(
      '[Fietsapp SW] Nieuwe versie geïnstalleerd en wacht op activatie:',
      CACHE_NAME
    );
  })());
});

// Alleen de pagina mag na het beëindigen van de fietstocht om activatie vragen.
self.addEventListener('message', (event) => {
  if (
    event.data &&
    event.data.type === 'ACTIVATE_UPDATE_AFTER_TRIP'
  ) {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(cacheNames.map(async (cacheName) => {
      if (
        cacheName.startsWith(CACHE_PREFIX) &&
        cacheName !== CACHE_NAME
      ) {
        await caches.delete(cacheName);
        console.info(
          '[Fietsapp SW] Oude cache verwijderd:',
          cacheName
        );
      }
    }));

    await self.clients.claim();
    console.info('[Fietsapp SW] Actief:', CACHE_NAME);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  if (request.method !== 'GET') return;

  const requestURL = new URL(request.url);
  const isSameOrigin = requestURL.origin === self.location.origin;

  const isLeafletAsset =
    requestURL.origin === 'https://unpkg.com' &&
    /^\/leaflet@1\.9\.4\/dist\/leaflet\.(css|js)$/.test(
      requestURL.pathname
    );

  // Andere externe diensten, waaronder kaarttegels, vallen buiten deze cache.
  if (!isSameOrigin && !isLeafletAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cachedResponse = await cache.match(request);

    if (cachedResponse) return cachedResponse;

    try {
      return await fetch(request);
    } catch (error) {
      if (request.mode === 'navigate') {
        const appShell = await cache.match('./index.html');

        if (appShell) return appShell;
      }

      return new Response(
        'Je bent offline en dit bestand staat niet in de cache.',
        {
          status: 503,
          statusText: 'Offline',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8'
          }
        }
      );
    }
  })());
});
