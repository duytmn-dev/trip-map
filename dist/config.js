export const APP_CONFIG = Object.freeze({
  map: {
    provider: "google",
    defaultCenter: [108.2772, 14.0583],
    defaultZoom: 5,
    maxZoom: 21,
    apiKey: globalThis.ROAMLY_CONFIG?.googleMapsApiKey ?? "",
    mapId: globalThis.ROAMLY_CONFIG?.googleMapsMapId ?? "DEMO_MAP_ID",
  },
  openServices: {
    geocodingUrl: "https://nominatim.openstreetmap.org/search",
    fallbackGeocodingUrl: "https://photon.komoot.io/api/",
    reverseGeocodingUrl: "https://photon.komoot.io/reverse",
    routingUrl: "https://router.project-osrm.org/route/v1",
    routingProfile: "driving",
    minRequestIntervalMs: 1100,
  },
  transport: {
    mode: "motorbike",
    // OSRM public không có profile xe máy riêng. Cộng 10% cho dừng/đỗ
    // và giao thông đô thị; đây là số dự kiến, không phải ETA thời gian thực.
    motorbikeDurationFactor: 1.1,
    fallbackSpeedKmh: 28,
  },
  storageKey: "roamly.mvp.trip.v1",
  tripsStorageKey: "roamly.mvp.trips.v2",
  maxPlacesPerTrip: 24,
});
