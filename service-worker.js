/*
 * Fiets Knooppunten Opvolger — Service Worker
 * Versie: 3
 *
 * Updatebeleid:
 * - Geen skipWaiting(): een nieuwe worker wacht totdat de huidige app-client(s)
 *   gesloten zijn. Zo wordt een actieve fietstocht niet middenin vervangen.
 * - Bij activatie worden uitsluitend oude caches van deze app verwijderd.
 * - De kernbestanden zijn vereist; externe Leaflet-bestanden en iconen zijn
 *   optioneel, zodat een tijdelijke netwerkfout de installatie niet blokkeert.
 *
 * Bij iedere publicatie van een nieuwe release: verhoog CACHE_NAME.
 */

'use strict';

const CACHE_PREFIX = 'fiets-knooppunten-';
const CACHE_NAME = `${CACHE_PREFIX}v3`;

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
    // Als deze niet beschikbaar zijn, mislukt de installatie.
    // De vorige actieve worker blijft dan behouden.
    await cache.addAll(CORE_ASSETS);

    // Optionele bestanden: een netwerkfout of ontbrekend icoon
    // mag de installatie van de nieuwe service worker niet blokkeren.
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

    // Geen skipWaiting(): bestaande app-clients krijgen de tijd
    // om af te sluiten voordat deze worker de oude vervangt.
    console.info(
      '[Fietsapp SW] Nieuwe versie geïnstalleerd; wacht op activatie:',
      CACHE_NAME
    );
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const cacheNames = await caches.keys();

    await Promise.all(cacheNames.map(async (cacheName) => {
      // Verwijder uitsluitend oude caches van deze fietsapp.
      // Caches van andere apps op hetzelfde domein blijven behouden.
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

    // De nieuwe worker mag nu clients binnen zijn scope bedienen.
    await self.clients.claim();

    console.info('[Fietsapp SW] Actief:', CACHE_NAME);
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Alleen GET-verzoeken afhandelen.
  if (request.method !== 'GET') return;

  const requestURL = new URL(request.url);
  const isSameOrigin = requestURL.origin === self.location.origin;

  // Alleen de vooraf gecachete Leaflet-bestanden van deze CDN meenemen.
  const isLeafletAsset =
    requestURL.origin === 'https://unpkg.com' &&
    /^\/leaflet@1\.9\.4\/dist\/leaflet\.(css|js)$/.test(
      requestURL.pathname
    );

  // Andere externe diensten, zoals OpenStreetMap-tegels,
  // blijven buiten deze cachelogica.
  if (!isSameOrigin && !isLeafletAsset) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Gebruik eerst de bestanden uit de cache van deze versie.
    const cachedResponse = await cache.match(request);

    if (cachedResponse) {
      return cachedResponse;
    }

    try {
      // Bestand staat niet in de cache: probeer het netwerk.
      return await fetch(request);
    } catch (error) {
      // Bij offline navigatie de opgeslagen app tonen.
      if (request.mode === 'navigate') {
        const appShell = await cache.match('./index.html');

        if (appShell) {
          return appShell;
        }
      }

      // Geef een duidelijke fout als het bestand offline
      // niet beschikbaar is.
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