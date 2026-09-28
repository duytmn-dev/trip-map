import { APP_CONFIG } from "./config.js";

const sleep = (milliseconds) => new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));

export const mapPointId = (coordinates) => `map-${coordinates.map((value) => value.toFixed(6)).join("-")}`;

export const isLocationCodeName = (value) => typeof value === "string"
  && /^[A-Z0-9]{4,8}\+[A-Z0-9]{2,}(?:[,\s]|$)/i.test(value.trim());

export const preferredPlaceName = (...names) => names.find((name) => typeof name === "string" && name.trim() && !isLocationCodeName(name))?.trim() ?? "";

export class TripStore {
  list() {
    let trips = [];
    try {
      const value = localStorage.getItem(APP_CONFIG.tripsStorageKey);
      if (value) {
        const saved = JSON.parse(value);
        if (!Array.isArray(saved)) throw new Error("INVALID_TRIPS_STORAGE");
        trips = saved.filter((trip) => trip && typeof trip.id === "string" && trip.id);
      }
    } catch (error) {
      console.error({ error }, "Không thể đọc danh sách chuyến đi");
    }
    try {
      const legacyValue = localStorage.getItem(APP_CONFIG.storageKey);
      const legacyTrip = legacyValue ? JSON.parse(legacyValue) : null;
      if (legacyTrip?.id && !trips.some((trip) => trip.id === legacyTrip.id)) trips.push(legacyTrip);
    } catch (error) {
      console.error({ error }, "Không thể đọc chuyến đi cũ");
    }
    return trips.sort((first, second) => (second.updatedAt ?? "").localeCompare(first.updatedAt ?? ""));
  }

  load(id) {
    return this.list().find((trip) => trip.id === id) ?? null;
  }

  save(trip) {
    try {
      if (!trip?.id) throw new Error("MISSING_TRIP_ID");
      const trips = this.list().filter((saved) => saved.id !== trip.id);
      trips.push(trip);
      localStorage.setItem(APP_CONFIG.tripsStorageKey, JSON.stringify(trips));
      localStorage.removeItem(APP_CONFIG.storageKey);
      return true;
    } catch (error) {
      console.error({ error }, "Không thể lưu chuyến đi");
      return false;
    }
  }

  clear() {
    localStorage.removeItem(APP_CONFIG.tripsStorageKey);
    localStorage.removeItem(APP_CONFIG.storageKey);
  }
}

export class OpenGeocodingService {
  constructor() {
    this.lastRequestAt = 0;
  }

  async search(query, options = {}) {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length < 2) return [];

    const queries = this.buildQueryVariants(normalizedQuery, options.context);
    try {
      for (const searchQuery of queries) {
        const results = await this.requestNominatim(searchQuery, options);
        if (results.length) return results;
      }
    } catch (error) {
      console.warn({ error: error.message }, "Nguồn tìm kiếm Nominatim không khả dụng");
    }

    try {
      for (const searchQuery of queries) {
        const results = await this.requestPhoton(searchQuery, options);
        if (results.length) return results;
      }
    } catch (error) {
      console.warn({ error: error.message }, "Nguồn tìm kiếm Photon không khả dụng");
    }
    return [];
  }

  async reverseNearby(coordinates) {
    const [longitude, latitude] = coordinates;
    const params = new URLSearchParams({ lon: String(longitude), lat: String(latitude), radius: "0.05", limit: "5" });
    const response = await fetch(`${APP_CONFIG.openServices.reverseGeocodingUrl}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`PHOTON_REVERSE_${response.status}`);
    const payload = await response.json();
    const namedPlaces = (payload.features ?? [])
      .filter((feature) => {
        const properties = feature.properties ?? {};
        return properties.name && !isLocationCodeName(properties.name)
          && ["amenity", "tourism", "shop", "leisure", "historic", "natural", "man_made"].includes(properties.osm_key)
          && Array.isArray(feature.geometry?.coordinates)
          && haversineDistance(coordinates, feature.geometry.coordinates) <= 35;
      })
      .sort((first, second) => haversineDistance(coordinates, first.geometry.coordinates) - haversineDistance(coordinates, second.geometry.coordinates));
    const match = namedPlaces[0];
    if (!match) return null;
    const properties = match.properties;
    return {
      name: properties.name,
      address: [properties.street, properties.district, properties.city, properties.state].filter(Boolean).join(", ") || properties.name,
      category: this.mapCategory(properties.osm_value, properties.osm_key),
      source: "OpenStreetMap",
    };
  }

  buildQueryVariants(query, context) {
    if (!context || query.toLocaleLowerCase("vi").includes(context.toLocaleLowerCase("vi"))) {
      return [query];
    }

    // Tìm đúng chuỗi người dùng nhập trước. Tên điểm đến chỉ là phương án
    // dự phòng, nhờ vậy địa chỉ ở khu vực khác không bị lọc sai.
    return [query, `${query}, ${context}`];
  }

  async requestNominatim(query, options) {

    const elapsed = Date.now() - this.lastRequestAt;
    const waitTime = Math.max(0, APP_CONFIG.openServices.minRequestIntervalMs - elapsed);
    if (waitTime > 0) await sleep(waitTime);

    const params = new URLSearchParams({
      format: "jsonv2",
      q: query,
      limit: String(options.limit ?? 7),
      "accept-language": "vi",
      addressdetails: "1",
      countrycodes: "vn",
    });
    if (Array.isArray(options.biasCenter) && options.biasCenter.length === 2) {
      const [longitude, latitude] = options.biasCenter;
      const radius = options.biasRadiusDegrees ?? 0.45;
      params.set("viewbox", `${longitude - radius},${latitude + radius},${longitude + radius},${latitude - radius}`);
      params.set("bounded", "0");
    }
    this.lastRequestAt = Date.now();

    const response = await fetch(`${APP_CONFIG.openServices.geocodingUrl}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`GEOCODING_${response.status}`);

    const results = await response.json();
    return results.map((item) => ({
      id: `osm-${item.osm_type}-${item.osm_id}`,
      name: item.name || item.display_name.split(",")[0],
      address: item.display_name,
      coordinates: [Number(item.lon), Number(item.lat)],
      category: this.mapCategory(item.type, item.category),
      source: "OpenStreetMap",
      rating: null,
      duration: 60,
    }));
  }

  async requestPhoton(query, options) {
    const params = new URLSearchParams({
      q: query,
      limit: String(options.limit ?? 7),
    });
    if (Array.isArray(options.biasCenter) && options.biasCenter.length === 2) {
      params.set("lon", String(options.biasCenter[0]));
      params.set("lat", String(options.biasCenter[1]));
    }

    const response = await fetch(`${APP_CONFIG.openServices.fallbackGeocodingUrl}?${params}`, {
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`PHOTON_${response.status}`);

    const payload = await response.json();
    return (payload.features ?? []).map((feature) => {
      const properties = feature.properties ?? {};
      const streetAddress = [properties.housenumber, properties.street].filter(Boolean).join(" ");
      const addressParts = [
        streetAddress,
        properties.district,
        properties.city,
        properties.county,
        properties.state,
        properties.country,
      ].filter(Boolean);
      const address = [...new Set(addressParts)].join(", ") || properties.name || query;
      return {
        id: `photon-${properties.osm_type ?? "place"}-${properties.osm_id ?? feature.geometry.coordinates.join("-")}`,
        name: properties.name || streetAddress || query,
        address,
        coordinates: feature.geometry.coordinates.map(Number),
        category: this.mapCategory(properties.osm_value, properties.osm_key),
        source: "Photon · OpenStreetMap",
        rating: null,
        duration: 60,
      };
    });
  }

  mapCategory(type, category) {
    if (["hotel", "hostel", "guest_house", "motel"].includes(type)) return "hotel";
    if (["restaurant", "cafe", "fast_food", "bar", "food_court"].includes(type)) return "food";
    if (["tourism", "historic", "natural"].includes(category)) return "sight";
    return "other";
  }
}

export class GoogleGeocodingService {
  async resolvePlaceId(placeId) {
    await loadGoogleMaps();
    const { Geocoder } = await window.google.maps.importLibrary("geocoding");
    const { results } = await new Geocoder().geocode({ placeId });
    const location = results[0]?.geometry.location;
    return location ? { coordinates: [location.lng(), location.lat()] } : null;
  }

  async resolveMapPoint(point) {
    await loadGoogleMaps();
    if (point.placeId) {
      try {
        const place = await this.resolvePlaceDetails(point.placeId);
        if (place) return { ...place, coordinates: place.coordinates ?? point.coordinates };
      } catch (error) {
        console.warn({ error: error.message }, "Không thể lấy tên địa điểm Google");
      }
    }
    const { Geocoder } = await window.google.maps.importLibrary("geocoding");
    const request = point.placeId
      ? { placeId: point.placeId }
      : { location: { lat: point.coordinates[1], lng: point.coordinates[0] } };
    const { results } = await new Geocoder().geocode(request);
    const result = results[0];
    if (!result) return null;
    if (!point.placeId && result.types?.some((type) => ["establishment", "point_of_interest", "cafe", "restaurant"].includes(type))) {
      try {
        const place = await this.resolvePlaceDetails(result.place_id);
        if (place) {
          const { place_id: _placeId, ...pickedPlace } = place;
          return { ...pickedPlace, id: mapPointId(point.coordinates), coordinates: point.coordinates };
        }
      } catch (error) {
        console.warn({ error: error.message }, "Không thể lấy tên điểm gần vị trí chọn");
      }
    }
    const firstAddressPart = result.formatted_address?.split(",")[0]?.trim() ?? "";
    const componentName = result.address_components?.find((component) => component.types?.some((type) => ["establishment", "point_of_interest"].includes(type)))?.long_name;
    const suggestedName = componentName || (point.placeId ? "" : firstAddressPart);
    const name = preferredPlaceName(suggestedName);
    const place = this.toPlace(result, name || "Điểm trên bản đồ");
    return {
      ...place,
      id: point.placeId ? `google-${point.placeId}` : mapPointId(point.coordinates),
      name,
      coordinates: point.placeId ? place.coordinates : point.coordinates,
      ...(point.placeId ? { place_id: point.placeId } : {}),
    };
  }

  async resolvePlaceDetails(placeId) {
    if (!placeId) return null;
    const { Place } = await window.google.maps.importLibrary("places");
    const details = new Place({ id: placeId, requestedLanguage: "vi" });
    await details.fetchFields({ fields: ["displayName", "formattedAddress", "location", "primaryType"] });
    if (!details.displayName?.trim() || isLocationCodeName(details.displayName)) return null;
    const type = details.primaryType ?? "";
    const category = /hotel|lodging|hostel|motel|resort/.test(type) ? "hotel"
      : /restaurant|cafe|coffee|food|bakery|dessert|ice_cream|bar/.test(type) ? "food"
        : /tourist|museum|park|landmark|church|temple/.test(type) ? "sight" : "other";
    return {
      id: `google-${placeId}`,
      name: details.displayName,
      address: details.formattedAddress || details.displayName,
      coordinates: details.location ? [details.location.lng(), details.location.lat()] : null,
      category,
      place_id: placeId,
      source: "Google Places",
      duration: 60,
    };
  }

  async search(query, options = {}) {
    await loadGoogleMaps();
    const { Geocoder } = await window.google.maps.importLibrary("geocoding");
    const geocoder = new Geocoder();
    const context = options.context?.trim();
    const queries = context && !query.toLocaleLowerCase("vi").includes(context.toLocaleLowerCase("vi"))
      ? [`${query}, ${context}`, query]
      : [query];

    for (const address of queries) {
      try {
        const { results } = await geocoder.geocode({
          address,
          region: "vn",
          componentRestrictions: { country: "VN" },
          ...(options.biasCenter ? { bounds: this.createBounds(options.biasCenter) } : {}),
        });
        const places = results
          .filter((result) => this.isInSearchArea(result, options.biasCenter))
          .slice(0, options.limit ?? 8)
          .map((result) => this.toPlace(result, query));
        if (places.length) return places;
      } catch (error) {
        if (error.code !== "ZERO_RESULTS") throw error;
      }
    }
    return [];
  }

  createBounds([longitude, latitude]) {
    return {
      north: latitude + 0.4,
      south: latitude - 0.4,
      east: longitude + 0.4,
      west: longitude - 0.4,
    };
  }

  isInSearchArea(result, center) {
    if (!center) return true;
    const location = result.geometry.location;
    return haversineDistance(center, [location.lng(), location.lat()]) <= 100000;
  }

  toPlace(result, query) {
    const types = result.types ?? [];
    const isHotel = types.includes("lodging") || /hotel|khách sạn|hostel|homestay|resort/i.test(query);
    const category = isHotel ? "hotel"
      : types.some((type) => ["restaurant", "cafe", "food"].includes(type)) ? "food"
        : types.some((type) => ["tourist_attraction", "museum", "park"].includes(type)) ? "sight"
          : "other";
    const name = types.includes("establishment") ? query : result.address_components?.[0]?.long_name ?? query;
    return {
      id: `google-${result.place_id}`,
      name,
      address: result.formatted_address,
      coordinates: [result.geometry.location.lng(), result.geometry.location.lat()],
      category,
      source: "Google Maps",
      rating: null,
      duration: 60,
    };
  }
}

export class PlaceSearchService {
  constructor(googleService = new GoogleGeocodingService(), openService = new OpenGeocodingService()) {
    this.googleService = googleService;
    this.openService = openService;
  }

  resolvePlaceId(placeId) {
    return this.googleService.resolvePlaceId(placeId);
  }

  async resolveMapPoint(point) {
    let googlePlace = null;
    try {
      googlePlace = await this.googleService.resolveMapPoint(point);
      if (googlePlace?.source === "Google Places" && preferredPlaceName(googlePlace.name)) return googlePlace;
    } catch (error) {
      console.warn({ error: error.message }, "Không thể tra điểm Google trên bản đồ");
    }
    try {
      const nearby = await this.openService.reverseNearby(point.coordinates);
      if (nearby) return {
        ...(googlePlace ?? { id: mapPointId(point.coordinates), coordinates: point.coordinates, duration: 60 }),
        name: nearby.name,
        address: googlePlace?.address || nearby.address,
        category: nearby.category,
        source: nearby.source,
      };
    } catch (error) {
      console.warn({ error: error.message }, "Không thể tra điểm OpenStreetMap gần vị trí chọn");
    }
    return googlePlace;
  }

  async search(query, options = {}) {
    let googleError = null;
    try {
      const places = await this.googleService.search(query, options);
      if (places.length) return { places, googleError };
    } catch (error) {
      googleError = error;
      console.warn({ error: error.message }, "Nguồn tìm kiếm Google Geocoding không khả dụng");
    }
    const places = await this.openService.search(query, options);
    return { places, googleError };
  }
}

export class RoutingService {
  async getRoute(places) {
    if (places.length < 2) return null;
    const coordinates = places.map((place) => place.coordinates.join(",")).join(";");
    const params = new URLSearchParams({ overview: "full", geometries: "geojson", steps: "false" });

    try {
      const response = await fetch(`${APP_CONFIG.openServices.routingUrl}/${APP_CONFIG.openServices.routingProfile}/${coordinates}?${params}`);
      if (!response.ok) throw new Error(`ROUTING_${response.status}`);
      const payload = await response.json();
      if (payload.code !== "Ok" || !payload.routes?.[0]) throw new Error("ROUTING_NO_ROUTE");
      const route = payload.routes[0];
      return {
        geometry: route.geometry,
        distance: route.distance,
        duration: route.duration * APP_CONFIG.transport.motorbikeDurationFactor,
        legs: route.legs.map((leg) => ({ ...leg, duration: leg.duration * APP_CONFIG.transport.motorbikeDurationFactor })),
        estimated: true,
        fallback: false,
        transportMode: APP_CONFIG.transport.mode,
      };
    } catch (error) {
      console.warn("Không thể lấy tuyến đường OSRM, dùng tuyến ước tính", error);
      return this.getFallbackRoute(places);
    }
  }

  async getRoutesFromOrigin(origin, destinations, onProgress = null) {
    if (!origin || !destinations.length) return null;
    const routedDestinations = [];
    const batchSize = 3;

    // Public OSRM không có batch geometry cho nhiều cặp độc lập. Chạy theo
    // nhóm nhỏ để tải sẵn đường thật mà không dồn quá nhiều request một lúc.
    for (let index = 0; index < destinations.length; index += batchSize) {
      const batch = destinations.slice(index, index + batchSize);
      const routes = await Promise.all(batch.map((place) => this.getRoute([origin, place])));
      routes.forEach((route, routeIndex) => {
        routedDestinations.push({ place: batch[routeIndex], route });
      });
      onProgress?.(Math.min(index + batch.length, destinations.length), destinations.length);
    }

    return this.createOriginRoute(origin, routedDestinations);
  }

  createOriginRoute(origin, routedDestinations) {
    const legs = routedDestinations.map(({ place, route }) => ({
      fromPlaceId: origin.id,
      toPlaceId: place.id,
      distance: route.distance,
      duration: route.duration,
      fallback: route.fallback,
    }));
    const features = routedDestinations
      .filter(({ route }) => !route.fallback && route.geometry)
      .map(({ place, route }) => ({
        type: "Feature",
        properties: { toPlaceId: place.id },
        geometry: route.geometry,
      }));
    return {
      geometry: { type: "FeatureCollection", features },
      distance: legs.reduce((total, leg) => total + leg.distance, 0),
      duration: legs.reduce((total, leg) => total + leg.duration, 0),
      legs,
      estimated: true,
      fallback: legs.some((leg) => leg.fallback),
      transportMode: APP_CONFIG.transport.mode,
      originPlaceId: origin.id,
    };
  }

  getFallbackRoute(places) {
    const legs = places.slice(1).map((place, index) => {
      const distance = haversineDistance(places[index].coordinates, place.coordinates);
      return {
        distance,
        duration: (distance / 1000 / APP_CONFIG.transport.fallbackSpeedKmh) * 3600,
      };
    });
    const distance = legs.reduce((total, leg) => total + leg.distance, 0);
    return {
      geometry: { type: "LineString", coordinates: places.map((place) => place.coordinates) },
      distance,
      duration: legs.reduce((total, leg) => total + leg.duration, 0),
      legs,
      estimated: true,
      fallback: true,
      transportMode: APP_CONFIG.transport.mode,
    };
  }
}

let googleMapsLoader = null;

const MARKER_ICONS = Object.freeze({
  hotel: '<path d="M3 20V5m0 12h18v3m0-8v8M3 12h18M6 12V7a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5" />',
  sight: '<path d="M5 7h3l2-3h4l2 3h3a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z" /><circle cx="12" cy="13" r="3" />',
  food: '<path d="M4 3v7a3 3 0 0 0 6 0V3M7 3v18M17 21V3c-3 2-4 6-4 10h4" />',
  other: '<path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" />',
});

function markerIcon(category) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${MARKER_ICONS[category]}</svg>`;
}

function loadGoogleMaps() {
  if (window.google?.maps?.marker) return Promise.resolve();
  if (!APP_CONFIG.map.apiKey) return Promise.reject(new Error("GOOGLE_MAPS_KEY_MISSING"));
  if (googleMapsLoader) return googleMapsLoader;

  googleMapsLoader = new Promise((resolve, reject) => {
    const callbackName = "roamlyGoogleMapsReady";
    const script = document.createElement("script");
    const url = new URL("https://maps.googleapis.com/maps/api/js");
    url.searchParams.set("key", APP_CONFIG.map.apiKey);
    url.searchParams.set("libraries", "marker");
    url.searchParams.set("callback", callbackName);
    url.searchParams.set("loading", "async");

    const timeout = setTimeout(() => reject(new Error("GOOGLE_MAPS_TIMEOUT")), 20000);
    window[callbackName] = () => {
      clearTimeout(timeout);
      delete window[callbackName];
      resolve();
    };
    script.onerror = () => {
      clearTimeout(timeout);
      delete window[callbackName];
      script.remove();
      reject(new Error("GOOGLE_MAPS_LOAD_FAILED"));
    };
    script.src = url.toString();
    script.async = true;
    document.head.append(script);
  }).catch((error) => {
    googleMapsLoader = null;
    throw error;
  });
  return googleMapsLoader;
}

export class MapController {
  constructor(containerId, onPlaceSelect = null, onError = null, onMapClick = null) {
    this.containerId = containerId;
    this.onPlaceSelect = onPlaceSelect;
    this.onError = onError;
    this.onMapClick = onMapClick;
    this.map = null;
    this.markers = [];
    this.routePolylines = [];
    this.viewportKey = null;
  }

  async initialize() {
    if (this.map) return;
    const container = document.getElementById(this.containerId);
    if (!container) throw new Error("MAP_CONTAINER_MISSING");
    window.gm_authFailure = () => this.onError?.(new Error("GOOGLE_MAPS_AUTH_FAILED"));
    await loadGoogleMaps();
    this.map = new window.google.maps.Map(container, {
      center: toGoogleLatLng(APP_CONFIG.map.defaultCenter),
      zoom: APP_CONFIG.map.defaultZoom,
      maxZoom: APP_CONFIG.map.maxZoom,
      mapId: APP_CONFIG.map.mapId,
      mapTypeControl: false,
      streetViewControl: false,
      zoomControl: false,
    });
    this.map.addListener("click", (event) => {
      if (!event.latLng) return;
      if (event.placeId) event.stop?.();
      this.onMapClick?.({
        placeId: event.placeId ?? null,
        coordinates: [event.latLng.lng(), event.latLng.lat()],
      });
    });
    this.infoWindow = new window.google.maps.InfoWindow();
  }

  resize() {
    if (this.map) window.google.maps.event.trigger(this.map, "resize");
  }

  zoomBy(delta) {
    const currentZoom = this.map?.getZoom();
    if (typeof currentZoom !== "number") return;
    this.map.setZoom(Math.max(0, Math.min(APP_CONFIG.map.maxZoom, currentZoom + delta)));
  }

  async showTrip(destination, places, route = null, options = {}) {
    await this.initialize();
    this.clearMarkers();
    this.clearRoute();

    const visiblePlaces = places.length ? places : [{ coordinates: destination.center, name: destination.name, category: "other" }];
    const hasHotel = visiblePlaces.some((place) => place.category === "hotel");
    const originId = options.originPlaceId ?? route?.originPlaceId;
    const visitedIds = new Set(options.visitedPlaceIds ?? []);
    const bounds = new window.google.maps.LatLngBounds();
    visiblePlaces.forEach((place, index) => {
      const routeLeg = route?.legs?.find((leg) => leg.toPlaceId === place.id);
      const isHotel = place.category === "hotel";
      const isOrigin = place.id === originId;
      const isVisited = visitedIds.has(place.id);
      const category = isHotel ? "hotel" : Object.hasOwn(MARKER_ICONS, place.category) ? place.category : "other";
      const detail = isOrigin ? "Vị trí hiện tại"
        : isVisited ? "Đã đi"
          : isHotel ? "Khách sạn"
            : routeLeg ? `${formatMinutes(routeLeg.duration)} xe máy`
              : hasHotel ? "Đang tính thời gian" : "Chọn khách sạn để tính";
      const markerHtml = `
        <div class="route-map-marker${isHotel ? " is-hotel" : ""}${isOrigin ? " is-current-origin" : ""}${isVisited ? " is-visited" : ""}">
          <span class="trip-marker marker-${category}">${markerIcon(category)}</span>
          ${isHotel ? "" : `<span class="marker-index">${isVisited ? "✓" : index + 1}</span>`}
          <span class="map-time-label"><strong>${escapeHtml(place.name)}</strong><small>${detail}</small></span>
        </div>
      `;
      const popupTime = `<small>${detail}</small>`;
      const content = document.createElement("div");
      content.innerHTML = markerHtml;
      const marker = new window.google.maps.marker.AdvancedMarkerElement({
        map: this.map,
        position: toGoogleLatLng(place.coordinates),
        title: place.name,
        content: content.firstElementChild,
        zIndex: isOrigin ? 1200 : isHotel ? 1000 : index + 1,
      });
      marker.addListener("click", (event) => {
        event?.stop?.();
        this.infoWindow.setContent(`<div class="map-popup"><strong>${escapeHtml(place.name)}</strong><small>${escapeHtml(place.address ?? destination.region)}</small>${popupTime}</div>`);
        this.infoWindow.open({ anchor: marker, map: this.map });
        this.onPlaceSelect?.(place);
      });
      this.markers.push(marker);
      bounds.extend(toGoogleLatLng(place.coordinates));
    });

    if (route?.geometry) this.drawRoute(route.geometry);
    if (options.viewportKey === undefined || options.viewportKey !== this.viewportKey) {
      if (visiblePlaces.length === 1) {
        this.map.setCenter(toGoogleLatLng(visiblePlaces[0].coordinates));
        this.map.setZoom(Math.round(destination.zoom ?? 12));
      } else {
        const compact = document.getElementById(this.containerId).clientWidth < 700;
        this.map.fitBounds(bounds, compact
          ? { top: 135, right: 40, bottom: 170, left: 40 }
          : { top: 100, right: 190, bottom: 120, left: 100 });
      }
      this.viewportKey = options.viewportKey ?? null;
    }
  }

  drawRoute(geometry) {
    this.clearRoute();
    const features = geometry.type === "FeatureCollection"
      ? geometry.features
      : [{ type: "Feature", properties: {}, geometry }];
    features.forEach((feature) => {
      const lines = feature.geometry.type === "MultiLineString"
        ? feature.geometry.coordinates
        : [feature.geometry.coordinates];
      lines.forEach((coordinates) => {
        const polyline = new window.google.maps.Polyline({
          map: this.map,
          path: coordinates.map(toGoogleLatLng),
          strokeColor: "#0b6b50",
          strokeOpacity: 0.68,
          strokeWeight: 4,
          clickable: false,
        });
        this.routePolylines.push({ polyline, toPlaceId: feature.properties?.toPlaceId ?? null });
      });
    });
  }

  focusPlaces(places) {
    if (!this.map || places.length < 2) return;
    const bounds = new window.google.maps.LatLngBounds();
    places.forEach((place) => bounds.extend(toGoogleLatLng(place.coordinates)));
    this.map.fitBounds(bounds, { top: 120, right: 190, bottom: 150, left: 120 });
  }

  showOnlyRoute(placeId) {
    this.routePolylines.forEach(({ polyline, toPlaceId }) => {
      if (toPlaceId === placeId) {
        polyline.setMap(this.map);
        polyline.setOptions({ strokeOpacity: 0.96, strokeWeight: 6 });
      } else {
        polyline.setMap(null);
      }
    });
  }

  showAllRoutes() {
    this.routePolylines.forEach(({ polyline }) => {
      polyline.setMap(this.map);
      polyline.setOptions({ strokeOpacity: 0.68, strokeWeight: 4 });
    });
  }

  clearMarkers() {
    this.infoWindow?.close();
    this.markers.forEach((marker) => { marker.map = null; });
    this.markers = [];
  }

  clearRoute() {
    this.routePolylines.forEach(({ polyline }) => polyline.setMap(null));
    this.routePolylines = [];
  }
}

export function haversineDistance(first, second) {
  const toRadians = (degrees) => (degrees * Math.PI) / 180;
  const earthRadius = 6371000;
  const latitudeDelta = toRadians(second[1] - first[1]);
  const longitudeDelta = toRadians(second[0] - first[0]);
  const latitudeA = toRadians(first[1]);
  const latitudeB = toRadians(second[1]);
  const value = Math.sin(latitudeDelta / 2) ** 2 + Math.cos(latitudeA) * Math.cos(latitudeB) * Math.sin(longitudeDelta / 2) ** 2;
  return 2 * earthRadius * Math.asin(Math.sqrt(value));
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML;
}

function formatMinutes(durationSeconds) {
  return `${Math.max(1, Math.round(durationSeconds / 60))} phút`;
}

function toGoogleLatLng(coordinates) {
  return { lat: Number(coordinates[1]), lng: Number(coordinates[0]) };
}
