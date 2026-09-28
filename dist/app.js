import { APP_CONFIG } from "./config.js";
import { CATEGORY_META, DALAT_PLACES, DESTINATIONS } from "./data.js";
import { addPlaceToDay, findPlanDay, isPlaceInDay, placesForDay, routeForPlaces } from "./day-plan.js";
import { exportTripPlan, importTripPlan } from "./trip-json.js";
import { currentOrigin, normalizeVisitedPlaceIds, pendingDestinations, toggleVisitedPlaceId } from "./trip-progress.js";
import { TripSync } from "./sync.js";
import {
  MapController,
  isLocationCodeName,
  mapPointId,
  preferredPlaceName,
  PlaceSearchService,
  RoutingService,
  TripStore,
} from "./services.js";

const elements = {
  landing: document.querySelector("#landing-view"),
  planner: document.querySelector("#planner-view"),
  destinationForm: document.querySelector("#destination-form"),
  destinationInput: document.querySelector("#destination-input"),
  destinationResults: document.querySelector("#destination-results"),
  destinationGrid: document.querySelector("#destination-grid"),
  savedTripList: document.querySelector("#saved-trip-list"),
  tripDetailsForm: document.querySelector("#trip-details-form"),
  tripName: document.querySelector("#trip-name"),
  tripTitleHeader: document.querySelector("#trip-title-header"),
  startDate: document.querySelector("#start-date"),
  endDate: document.querySelector("#end-date"),
  tripNotes: document.querySelector("#trip-notes"),
  tripDestinationName: document.querySelector("#trip-destination-name"),
  saveStatus: document.querySelector("#save-status"),
  categoryTabs: document.querySelector("#category-tabs"),
  placeSearchForm: document.querySelector("#place-search-form"),
  placeSearchInput: document.querySelector("#place-search-input"),
  placeResults: document.querySelector("#place-results"),
  selectedCount: document.querySelector("#selected-count"),
  routeSummary: document.querySelector("#route-summary"),
  itineraryList: document.querySelector("#itinerary-list"),
  dayTabs: document.querySelector("#day-tabs"),
  mapDayTabs: document.querySelector("#map-day-tabs"),
  dayTheme: document.querySelector("#day-theme"),
  mapLoading: document.querySelector("#map-loading"),
  mapFallback: document.querySelector("#map-fallback"),
  mapOverviewTitle: document.querySelector("#map-overview-title"),
  mapOverviewDetail: document.querySelector("#map-overview-detail"),
  mapNavigationButton: document.querySelector("#map-navigation-button"),
  mapVisitedButton: document.querySelector("#map-visited-button"),
  mapRenameButton: document.querySelector("#map-rename-button"),
  mapPickCard: document.querySelector("#map-pick-card"),
  mapPickStatus: document.querySelector("#map-pick-status"),
  mapPickForm: document.querySelector("#map-pick-form"),
  mapPickName: document.querySelector("#map-pick-name"),
  mapPickCategory: document.querySelector("#map-pick-category"),
  toast: document.querySelector("#toast"),
  tripJsonInput: document.querySelector("#trip-json-input"),
  importStatus: document.querySelector("#import-status"),
  syncMessage: document.querySelector("#sync-message"),
};

const store = new TripStore();
const sync = new TripSync(store, handleTripsChange, handleSyncStatus);
const placeSearchService = new PlaceSearchService();
const routingService = new RoutingService();
let mapController = new MapController("map", handleMapPlaceSelect, showMapError, handleMapClick);

const state = {
  trip: null,
  step: 1,
  category: "all",
  placeCatalog: [],
  route: null,
  routeRequestId: 0,
  selectedMapPlaceId: null,
  placeSearchRequestId: 0,
  toastTimer: null,
  importing: false,
  activeDayIndex: null,
  mapPick: null,
  mapPickRequestId: 0,
  accountId: null,
};

function refreshIcons() {
  window.lucide?.createIcons({ attrs: { "stroke-width": 1.8 } });
}

function createDefaultTrip(destination = DESTINATIONS[0]) {
  const start = addDays(new Date(), 7);
  const end = addDays(start, 2);
  return {
    id: crypto.randomUUID?.() ?? `trip-${Date.now()}`,
    title: `${destination.name} cuối tuần`,
    destination,
    startDate: toLocalDateInput(start),
    endDate: toLocalDateInput(end),
    vibe: "nature",
    notes: "",
    places: [],
    visitedPlaceIds: [],
    updatedAt: new Date().toISOString(),
  };
}

function addDays(date, numberOfDays) {
  const result = new Date(date);
  result.setDate(result.getDate() + numberOfDays);
  return result;
}

function toLocalDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function saveTrip() {
  if (!state.trip) return;
  state.trip.updatedAt = new Date().toISOString();
  const tripId = state.trip.id;
  const updatedAt = state.trip.updatedAt;
  elements.saveStatus.textContent = sync.user ? "Đang đồng bộ…" : "Đang lưu…";
  sync.save(structuredClone(state.trip)).then((mode) => {
    if (state.trip?.id === tripId && state.trip.updatedAt === updatedAt) {
      elements.saveStatus.textContent = mode === "synced" ? "Đã đồng bộ" : "Đã lưu trên thiết bị";
    }
  }).catch((error) => {
    console.error({ error, tripId }, "Không thể lưu chuyến đi");
    if (state.trip?.id === tripId) elements.saveStatus.textContent = "Chỉ lưu trên thiết bị";
    showToast("Chưa đồng bộ được chuyến đi. Thử lại khi có mạng.");
  });
  renderSavedTrips();
}

function handleTripsChange() {
  renderSavedTrips();
  const remote = sync.user && state.trip && sync.load(state.trip.id);
  if (remote && remote.updatedAt > state.trip.updatedAt && !sync.pendingWrites.has(`${sync.user.uid}/${remote.id}`)) {
    const currentStep = state.step;
    openPlanner(remote, { persist: false }).then(() => setStep(currentStep));
  }
}

function handleSyncStatus({ mode, user }) {
  document.querySelectorAll('[data-action="sign-in"]').forEach((button) => { button.hidden = !sync.configured || Boolean(user); });
  document.querySelectorAll('[data-action="sign-out"]').forEach((button) => { button.hidden = !user; });
  const messages = {
    local: "Chỉ lưu trên thiết bị. Cần cấu hình Firebase để đồng bộ.",
    "signed-out": "Đăng nhập Google để xem cùng chuyến đi trên mọi thiết bị.",
    syncing: "Đang chuyển và tải chuyến đi của tài khoản…",
    pending: "Một số thay đổi chưa đồng bộ. Ứng dụng sẽ gửi lại khi có mạng.",
    synced: `Đã đồng bộ với ${user?.email ?? "tài khoản Google"}.`,
    error: "Đồng bộ đang lỗi. Chuyến chưa gửi vẫn được giữ trên thiết bị.",
  };
  elements.syncMessage.textContent = messages[mode] ?? "";
  if (state.accountId && state.accountId !== (user?.uid ?? null)) {
    state.trip = null;
    showLanding();
  }
  state.accountId = user?.uid ?? null;
}

function renderDestinations() {
  elements.destinationGrid.innerHTML = DESTINATIONS.map((destination) => `
    <button class="destination-card" type="button" data-destination-id="${destination.id}">
      <img src="${destination.photo}" alt="${escapeHtml(destination.name)}" loading="lazy" />
      <span class="destination-card-content">
        <span class="destination-tag">${escapeHtml(destination.tag)}</span>
        <h3>${escapeHtml(destination.name)}</h3>
        <p>${escapeHtml(destination.description)}</p>
      </span>
    </button>
  `).join("");
}

function renderSavedTrips() {
  const trips = sync.list();
  elements.savedTripList.innerHTML = trips.length ? trips.map((trip) => {
    const destination = trip.destination?.name || "Chưa chọn điểm đến";
    const dates = [trip.startDate, trip.endDate].filter(Boolean).map(formatPlanDate).join(" – ");
    const details = [destination, dates].filter(Boolean).join(" · ");
    return `<button class="saved-trip-card" type="button" data-trip-id="${escapeHtml(trip.id)}">
      <span class="saved-trip-icon"><i data-lucide="map-pinned"></i></span>
      <span class="saved-trip-content"><strong>${escapeHtml(trip.title || "Chuyến đi chưa đặt tên")}</strong><small>${escapeHtml(details)}</small></span>
      <span class="saved-trip-open">Mở <i data-lucide="arrow-right"></i></span>
    </button>`;
  }).join("") : `<p class="saved-trips-empty">Chưa có chuyến đi đã lưu. Tạo chuyến mới hoặc nhập JSON để bắt đầu.</p>`;
  refreshIcons();
}

function showLanding() {
  hideMapPick();
  elements.planner.hidden = true;
  elements.landing.hidden = false;
  elements.planner.classList.remove("mobile-map");
  window.scrollTo({ top: 0, behavior: "smooth" });
  renderSavedTrips();
}

async function openPlanner(trip, { persist = true } = {}) {
  hideMapPick();
  state.trip = normalizeTrip(trip);
  state.step = 1;
  state.category = "all";
  state.activeDayIndex = state.trip.plan?.days?.length ? 0 : null;
  state.placeCatalog = state.trip.plan
    ? [state.trip.plan.hub, ...state.trip.plan.places].map((record, index) => ({
      id: record.id,
      name: record.name,
      address: record.address || record.map_query || record.name,
      coordinates: record.coordinates,
      category: index === 0 ? "hotel" : record.map_category,
      source: "JSON chuyến đi",
      duration: index === 0 ? 0 : 60,
    }))
    : state.trip.destination.id === "dalat" ? DALAT_PLACES.map((place) => ({ ...place })) : [];
  const catalogIds = new Set(state.placeCatalog.map((place) => place.id));
  state.placeCatalog.push(...state.trip.places.filter((place) => !catalogIds.has(place.id)));
  elements.landing.hidden = true;
  elements.planner.hidden = false;
  populateTripForm();
  renderDayNavigation();
  renderPlaceResults();
  renderTravelTimes();
  setStep(1);
  if (persist) saveTrip();
  else elements.saveStatus.textContent = sync.user ? "Đã đồng bộ" : "Đã lưu trên thiết bị";
  refreshIcons();
  await initializeMap();
  await updateMap();
}

function normalizeTrip(trip) {
  const fallback = createDefaultTrip();
  const places = Array.isArray(trip.places) ? trip.places.map(({ dayIndex: _dayIndex, ...place }) => place) : [];
  return {
    ...fallback,
    ...trip,
    destination: trip.destination ?? fallback.destination,
    places,
    visitedPlaceIds: normalizeVisitedPlaceIds(places, trip.visitedPlaceIds ?? trip.plan?.visited_place_ids ?? []),
  };
}

function populateTripForm() {
  elements.tripName.value = state.trip.title;
  elements.tripTitleHeader.value = state.trip.title;
  elements.startDate.value = state.trip.startDate;
  elements.endDate.value = state.trip.endDate;
  elements.startDate.min = "";
  elements.endDate.min = state.trip.startDate;
  elements.tripNotes.value = state.trip.notes ?? "";
  elements.tripDestinationName.textContent = `${state.trip.destination.name}, ${state.trip.destination.region}`;
  const vibeInput = elements.tripDetailsForm.querySelector(`[name="vibe"][value="${state.trip.vibe}"]`);
  if (vibeInput) vibeInput.checked = true;
}

async function initializeMap() {
  elements.mapLoading.hidden = false;
  elements.mapFallback.hidden = true;
  try {
    await mapController.initialize();
    elements.mapLoading.hidden = true;
    requestAnimationFrame(() => mapController.resize());
  } catch (error) {
    showMapError(error);
  }
}

function showMapError(error) {
  console.error({ error: error.message }, "Không thể tải Google Maps");
  elements.mapLoading.hidden = true;
  elements.mapFallback.hidden = false;
  elements.mapFallback.querySelector("p").textContent = error.message === "GOOGLE_MAPS_KEY_MISSING"
    ? "Chưa cấu hình Google Maps API key. Kiểm tra key.md rồi thử lại."
    : error.message === "MAPS_APP_CHECK_UNAVAILABLE"
      ? "App Check chưa xác thực được trang này. Kiểm tra cấu hình Firebase rồi thử lại."
      : "Google Maps chưa tải được. Kiểm tra key, App Check, billing và kết nối rồi thử lại.";
}

function setStep(step) {
  state.step = Number(step);
  document.querySelectorAll(".progress-tab").forEach((button) => button.classList.toggle("active", Number(button.dataset.step) === state.step));
  document.querySelectorAll(".planner-step").forEach((panel) => panel.classList.toggle("active", Number(panel.dataset.stepPanel) === state.step));
  if (state.step === 2) renderPlaceResults();
  if (state.step === 3) {
    renderTravelTimes();
    updateRouteAndMap();
    elements.planner.classList.add("mobile-map");
    document.querySelectorAll("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button.dataset.mobileView === "map"));
  } else {
    elements.planner.classList.remove("mobile-map");
    state.step === 2 ? updateRouteAndMap() : updateMap();
  }
  document.querySelector("#planner-sidebar").scrollTo({ top: 0, behavior: "smooth" });
  refreshIcons();
}

function renderPlaceResults() {
  if (!state.trip) return;
  const results = state.category === "all" ? state.placeCatalog : state.placeCatalog.filter((place) => place.category === state.category);
  const currentDay = getCurrentDay();
  elements.selectedCount.textContent = String(state.trip.places.length);

  if (!results.length) {
    elements.placeResults.innerHTML = `<div class="results-message">Chưa có gợi ý sẵn cho khu vực này.<br />Nhập tên địa điểm phía trên và bấm <strong>Tìm</strong>.</div>`;
    return;
  }

  elements.placeResults.innerHTML = results.map((place) => {
    const selected = state.trip.places.some((item) => item.id === place.id);
    const addToCurrentDay = selected && place.category !== "hotel" && currentDay && !isPlaceInDay(currentDay, place.id);
    const visited = state.trip.visitedPlaceIds.includes(place.id);
    const meta = CATEGORY_META[place.category] ?? CATEGORY_META.other;
    const photo = place.photo
      ? `<img class="place-photo" src="${place.photo}" alt="" loading="lazy" />`
      : `<span class="place-placeholder"><i data-lucide="${meta.icon}"></i></span>`;
    return `
      <article class="place-card${selected ? " selected" : ""}${visited ? " visited" : ""}">
        ${photo}
        <h3>${escapeHtml(place.name)}</h3>
        <p title="${escapeHtml(place.address)}">${escapeHtml(place.address)}</p>
        <div class="place-meta"><span>${visited ? "✓ Đã đi" : escapeHtml(meta.label)}</span>${place.rating ? `<span class="rating">★ ${place.rating}</span>` : `<span>${escapeHtml(place.source ?? "Gợi ý")}</span>`}</div>
        <button class="place-toggle" type="button" ${addToCurrentDay ? 'data-action="add-to-day"' : ""} data-place-id="${escapeHtml(place.id)}" aria-label="${addToCurrentDay ? `Thêm ${escapeHtml(place.name)} vào Ngày ${state.activeDayIndex + 1}` : `${selected ? "Bỏ" : "Thêm"} ${escapeHtml(place.name)}`}"><i data-lucide="${selected && !addToCurrentDay ? "check" : "plus"}"></i></button>
      </article>
    `;
  }).join("");
  refreshIcons();
}

function togglePlace(placeId) {
  const existingIndex = state.trip.places.findIndex((place) => place.id === placeId);
  if (existingIndex >= 0) {
    state.trip.places.splice(existingIndex, 1);
    state.trip.visitedPlaceIds = state.trip.visitedPlaceIds.filter((id) => id !== placeId);
  } else {
    if (state.trip.places.length >= APP_CONFIG.maxPlacesPerTrip) {
      showToast(`MVP hỗ trợ tối đa ${APP_CONFIG.maxPlacesPerTrip} địa điểm`);
      return;
    }
    const place = state.placeCatalog.find((item) => item.id === placeId);
    if (!place) return;
    if (place.category === "hotel") {
      const previousHotel = state.trip.places.find((item) => item.category === "hotel");
      state.trip.places = state.trip.places.filter((item) => item.category !== "hotel");
      if (previousHotel) showToast("Đã đổi khách sạn làm điểm xuất phát");
    }
    state.trip.places.push({ ...place });
    if (place.category !== "hotel") {
      addPlaceToDay(getCurrentDay(), placeId);
      rememberPlaceInPlan(place);
    }
  }
  state.route = null;
  saveTrip();
  renderPlaceResults();
  renderTravelTimes();
  updateMap(state.trip.places, null);
  updateRouteAndMap();
}

function rememberPlaceInPlan(place) {
  const plan = state.trip.plan;
  if (!plan || plan.places.some((record) => record.id === place.id)) return;
  plan.places.push({
    id: place.id,
    name: place.name,
    address: place.address,
    map_query: `${place.name}, ${place.address}`,
    category: place.category,
    map_category: place.category,
    coordinates: place.coordinates,
    ...(place.place_id ? { place_id: place.place_id } : {}),
  });
}

function addSelectedPlaceToCurrentDay(placeId) {
  if (!state.trip.places.some((place) => place.id === placeId)) return;
  if (!addPlaceToDay(getCurrentDay(), placeId)) return;
  saveTrip();
  renderPlaceResults();
  renderTravelTimes();
  renderRouteSummary();
  updateMap(state.trip.places, state.route);
}

function toggleVisited(placeId) {
  const place = state.trip?.places.find((item) => item.id === placeId && item.category !== "hotel");
  if (!place) return;
  state.trip.visitedPlaceIds = toggleVisitedPlaceId(state.trip.visitedPlaceIds, placeId);
  state.route = null;
  state.selectedMapPlaceId = null;
  saveTrip();
  renderPlaceResults();
  renderTravelTimes();
  updateMap(state.trip.places, null);
  updateRouteAndMap();
  showToast(state.trip.visitedPlaceIds.includes(placeId) ? `Đã đánh dấu ${place.name}` : `Đã bỏ đánh dấu ${place.name}`);
}

function getHotel() {
  return state.trip?.places.find((place) => place.category === "hotel") ?? null;
}

function getDestinations() {
  const hotel = getHotel();
  return state.trip?.places.filter((place) => place.id !== hotel?.id) ?? [];
}

function getOrigin() {
  return currentOrigin(state.trip?.places ?? [], state.trip?.visitedPlaceIds ?? []);
}

function getPendingDestinations() {
  return pendingDestinations(state.trip?.places ?? [], state.trip?.visitedPlaceIds ?? []);
}

function getCurrentDay() {
  return findPlanDay(state.trip?.plan, state.activeDayIndex);
}

function getVisiblePlaces() {
  return placesForDay(state.trip?.places ?? [], getCurrentDay(), getOrigin()?.id);
}

function formatPlanDate(date) {
  const [year, month, day] = date.split("-");
  return `${day}/${month}/${year}`;
}

function renderDayNavigation() {
  const days = state.trip?.plan?.days ?? [];
  const hasDays = days.length > 0;
  elements.dayTabs.hidden = !hasDays;
  elements.mapDayTabs.hidden = !hasDays;
  elements.dayTheme.hidden = !hasDays;
  if (!hasDays) return;
  const markup = days.map((day, index) => `
    <button type="button" data-day-index="${index}" class="${state.activeDayIndex === index ? "active" : ""}" aria-pressed="${state.activeDayIndex === index}">Ngày ${index + 1}</button>
  `).join("");
  elements.dayTabs.innerHTML = markup;
  elements.mapDayTabs.innerHTML = markup;
  const day = getCurrentDay();
  elements.dayTheme.textContent = day ? [day.date && formatPlanDate(day.date), day.theme || "Lịch trình trong ngày"].filter(Boolean).join(" · ") : "Tổng quan các điểm của chuyến đi";
}

function renderTravelItem(place, selected = true) {
  const origin = getOrigin();
  const visited = selected && state.trip.visitedPlaceIds.includes(place.id);
  const routeLeg = state.route?.legs?.find((leg) => leg.toPlaceId === place.id);
  const duration = !selected ? "Chưa chọn" : visited ? place.id === origin?.id ? "Đang ở đây" : "Đã đi"
    : !origin ? "Chọn điểm xuất phát" : routeLeg ? formatDuration(routeLeg.duration) : "Đang tính…";
  const visitButton = selected
    ? `<button class="visit-toggle" type="button" role="checkbox" aria-checked="${visited}" aria-label="${visited ? "Bỏ đánh dấu đã đi" : "Đánh dấu đã đi"}: ${escapeHtml(place.name)}" data-action="toggle-visited" data-place-id="${escapeHtml(place.id)}">✓</button>`
    : "";
  return `<li class="travel-estimate${selected ? "" : " unselected"}${visited ? " visited" : ""}">${visitButton}<span><strong>${escapeHtml(place.name)}</strong><small>${visited ? "Đã ghé" : origin ? `Từ ${escapeHtml(origin.name)}` : "Chưa có điểm xuất phát"}</small></span><b>${duration}</b><button class="remove-place${selected ? "" : " add-day-place"}" type="button" data-action="remove-place" data-place-id="${escapeHtml(place.id)}" aria-label="${selected ? "Bỏ" : "Thêm"} ${escapeHtml(place.name)}"><i data-lucide="${selected ? "x" : "plus"}"></i></button></li>`;
}

function renderTravelTimes() {
  if (!state.trip) return;
  const origin = getOrigin();
  const day = getCurrentDay();
  if (!origin) {
    elements.routeSummary.innerHTML = `<span><i data-lucide="map-pin"></i><strong>Chưa có điểm xuất phát</strong></span><small>Chọn khách sạn hoặc một điểm đã đi</small>`;
  }
  const originItem = origin
    ? `<li class="travel-estimate origin-base"><span class="estimate-icon"><i data-lucide="${origin.category === "hotel" ? "bed-double" : "map-pin"}"></i></span><span><strong>${escapeHtml(origin.name)}</strong><small>${origin.category === "hotel" ? "Khách sạn · điểm xuất phát" : "Vị trí hiện tại · đã đi"}</small></span></li>`
    : `<li class="empty-itinerary"><i data-lucide="bed-double"></i><br />Hãy chọn một khách sạn làm điểm xuất phát.</li>`;
  let destinationItems;
  if (day) {
    const selectedIds = new Set(state.trip.places.map((place) => place.id));
    const catalogById = new Map(state.placeCatalog.map((place) => [place.id, place]));
    const seen = new Set();
    const renderGroup = (title, ids) => {
      const items = ids.filter((id) => !seen.has(id)).map((id) => {
        seen.add(id);
        const place = catalogById.get(id);
        return place ? renderTravelItem(place, selectedIds.has(id)) : "";
      }).join("");
      return `<li class="day-group-title">${title}</li>${items || `<li class="day-group-empty">Không có địa điểm</li>`}`;
    };
    destinationItems = renderGroup("Điểm chính", day.main_places) + renderGroup("Có thể ghé", day.optional_places);
  } else {
    destinationItems = getDestinations().map((place) => renderTravelItem(place)).join("");
  }
  elements.itineraryList.innerHTML = originItem + (destinationItems || `<li class="empty-itinerary">Thêm địa điểm để xem thời gian di chuyển.</li>`);
  refreshIcons();
}

async function updateRouteAndMap() {
  const requestId = ++state.routeRequestId;
  state.selectedMapPlaceId = null;
  const origin = getOrigin();
  const destinations = getPendingDestinations();
  elements.routeSummary.innerHTML = `<span><i data-lucide="bike"></i><strong>${origin ? `Đang tính từ ${escapeHtml(origin.name)}…` : "Chưa có điểm xuất phát"}</strong></span><small>Thời gian xe máy dự kiến</small>`;
  refreshIcons();
  const route = await routingService.getRoutesFromOrigin(origin, destinations, (completed, total) => {
    if (requestId !== state.routeRequestId) return;
    elements.routeSummary.innerHTML = `<span><i data-lucide="bike"></i><strong>Đang tạo sẵn tuyến ${completed}/${total}</strong></span><small>Từ ${escapeHtml(origin.name)} tới từng điểm</small>`;
    refreshIcons();
  });
  if (requestId !== state.routeRequestId) return;
  state.route = route;

  renderRouteSummary();
  renderTravelTimes();
  refreshIcons();
  await updateMap(state.trip.places, state.route);
}

function renderRouteSummary() {
  const origin = getOrigin();
  const visiblePlaces = getVisiblePlaces();
  const visited = new Set(state.trip.visitedPlaceIds);
  const destinations = visiblePlaces.filter((place) => place.category !== "hotel" && !visited.has(place.id));
  const visibleRoute = routeForPlaces(state.route, visiblePlaces, getCurrentDay());
  const readyRouteCount = visibleRoute?.geometry?.features?.length ?? 0;
  const detail = !origin ? "Chọn điểm xuất phát"
    : !destinations.length ? "Không còn điểm chưa đi trong ngày"
      : !state.route ? "Đang tính tuyến đường…"
        : `${readyRouteCount}/${destinations.length} tuyến đường bộ đã sẵn sàng`;
  elements.routeSummary.innerHTML = `<span><i data-lucide="map-pin"></i><strong>${origin ? `Từ ${escapeHtml(origin.name)}` : "Chưa có điểm xuất phát"}</strong></span><small>${detail}</small>`;
}

async function updateMap(places = null, route = null) {
  if (!state.trip || elements.planner.hidden || !mapController.map) return;
  const origin = getOrigin();
  const visiblePlaces = placesForDay(places ?? state.trip.places, getCurrentDay(), origin?.id);
  const visibleRoute = routeForPlaces(route, visiblePlaces, getCurrentDay());
  const viewportKey = JSON.stringify([state.trip.id, state.activeDayIndex, visiblePlaces.map((place) => [place.id, place.coordinates])]);
  try {
    await mapController.showTrip(state.trip.destination, visiblePlaces, visibleRoute, {
      originPlaceId: origin?.id,
      visitedPlaceIds: state.trip.visitedPlaceIds,
      viewportKey,
    });
    updateMapOverviewCard(visiblePlaces, visibleRoute);
  } catch (error) {
    console.error("Không thể cập nhật bản đồ", error);
    elements.mapFallback.hidden = false;
  }
}

function updateMapOverviewCard(places, route) {
  const origin = getOrigin();
  const visited = new Set(state.trip.visitedPlaceIds);
  const destinationCount = places.filter((place) => place.category !== "hotel" && !visited.has(place.id)).length;
  const readyRouteCount = route?.geometry?.features?.length ?? 0;
  elements.mapOverviewTitle.textContent = origin ? `Từ ${origin.name}` : "Chưa có điểm xuất phát";
  elements.mapOverviewDetail.textContent = route
    ? `${readyRouteCount}/${destinationCount} tuyến đã tạo · chạm một điểm để lọc`
    : origin ? destinationCount ? "Đang tính thời gian xe máy…" : "Không còn điểm chưa đi trong ngày" : "Chọn điểm xuất phát";
  elements.mapNavigationButton.hidden = true;
  elements.mapRenameButton.hidden = true;
  setMapVisitedAction(origin?.category === "hotel" ? null : origin);
}

function setMapVisitedAction(place) {
  elements.mapVisitedButton.hidden = !place || place.category === "hotel";
  if (!elements.mapVisitedButton.hidden) {
    elements.mapVisitedButton.textContent = state.trip.visitedPlaceIds.includes(place.id)
      ? "Bỏ đánh dấu đã đi" : "✓ Đánh dấu đã đi";
  }
}

function hideMapPick() {
  state.mapPickRequestId += 1;
  state.mapPick = null;
  elements.mapPickCard.hidden = true;
}

async function handleMapClick(point) {
  if (!state.trip) return;
  const requestId = ++state.mapPickRequestId;
  const tripId = state.trip.id;
  state.mapPick = null;
  elements.mapPickCard.hidden = false;
  elements.mapPickForm.hidden = true;
  elements.mapPickStatus.textContent = "Đang tìm địa điểm…";

  let place;
  try {
    place = await placeSearchService.resolveMapPoint(point);
  } catch (error) {
    console.warn({ error: error.message }, "Không thể tra địa điểm trên bản đồ");
  }
  if (requestId !== state.mapPickRequestId || state.trip?.id !== tripId) return;
  const coordinates = point.coordinates;
  const candidate = place ?? {
    id: mapPointId(coordinates),
    name: "",
    address: `${coordinates[1].toFixed(6)}, ${coordinates[0].toFixed(6)}`,
    coordinates,
    category: "other",
    source: "Chọn trên bản đồ",
    duration: 60,
  };
  const existing = state.placeCatalog.find((item) => item.id === candidate.id);
  const selected = state.trip.places.some((item) => item.id === candidate.id);
  state.mapPick = { ...(existing ?? candidate), ...candidate, name: preferredPlaceName(candidate.name, existing?.name), category: selected ? existing?.category ?? candidate.category : candidate.category };
  elements.mapPickStatus.textContent = !state.mapPick.name
    ? point.placeId ? "Chưa lấy được tên Google. Kiểm tra Places API (New) hoặc nhập tên thủ công." : "Chưa lấy được tên cho vị trí này. Hãy nhập tên thủ công."
    : state.mapPick.source === "OpenStreetMap" ? `Gợi ý từ OpenStreetMap · ${state.mapPick.address}` : state.mapPick.address;
  elements.mapPickName.value = state.mapPick.name;
  elements.mapPickCategory.value = state.mapPick.category;
  elements.mapPickCategory.disabled = selected;
  elements.mapPickForm.hidden = false;
}

function updatePickedPlace(candidate) {
  const catalogPlace = state.placeCatalog.find((place) => place.id === candidate.id);
  if (catalogPlace) Object.assign(catalogPlace, candidate);
  else state.placeCatalog.unshift(candidate);
  const selectedPlace = state.trip.places.find((place) => place.id === candidate.id);
  if (selectedPlace) Object.assign(selectedPlace, candidate);
  const planRecord = state.trip.plan?.hub?.id === candidate.id
    ? state.trip.plan.hub
    : state.trip.plan?.places.find((place) => place.id === candidate.id);
  if (planRecord) {
    planRecord.name = candidate.name;
    planRecord.address = candidate.address;
    if (!planRecord.map_query || isLocationCodeName(planRecord.map_query)) {
      planRecord.map_query = `${candidate.name}, ${candidate.address}`;
    }
    if (planRecord.type !== "hotel") planRecord.map_category = candidate.category;
  }
}

function addPickedPlace() {
  if (!state.mapPick || !state.trip) return;
  const name = elements.mapPickName.value.trim();
  if (!name) return;
  const candidate = { ...state.mapPick, name, category: elements.mapPickCategory.value };
  const selected = state.trip.places.some((place) => place.id === candidate.id);
  if (!selected && state.trip.places.length >= APP_CONFIG.maxPlacesPerTrip) {
    showToast(`MVP hỗ trợ tối đa ${APP_CONFIG.maxPlacesPerTrip} địa điểm`);
    return;
  }
  updatePickedPlace(candidate);
  if (selected) {
    if (isPlaceInDay(getCurrentDay(), candidate.id) || !getCurrentDay()) {
      saveTrip();
      renderPlaceResults();
      renderTravelTimes();
      updateMap(state.trip.places, state.route);
      showToast("Đã cập nhật địa điểm trong lịch trình");
    } else {
      addSelectedPlaceToCurrentDay(candidate.id);
      showToast("Đã thêm điểm vào ngày đang xem");
    }
  } else {
    togglePlace(candidate.id);
    showToast("Đã thêm điểm vào lịch trình");
  }
  hideMapPick();
}

async function handleMapPlaceSelect(place) {
  hideMapPick();
  const origin = getOrigin();
  if (!origin) {
    showToast("Hãy chọn điểm xuất phát trước");
    return;
  }
  if (place.category === "hotel" || place.id === origin.id || state.selectedMapPlaceId === place.id) {
    state.selectedMapPlaceId = null;
    await updateMap(state.trip.places, state.route);
    return;
  }
  const routeLeg = state.route?.legs?.find((leg) => leg.toPlaceId === place.id);
  state.selectedMapPlaceId = place.id;
  if (routeLeg) mapController.showOnlyRoute(place.id);
  else mapController.showAllRoutes();
  mapController.focusPlaces([origin, place]);
  elements.mapOverviewTitle.textContent = place.name;
  elements.mapOverviewDetail.textContent = state.trip.visitedPlaceIds.includes(place.id)
    ? "Điểm này đã đi · bỏ đánh dấu nếu muốn ghé lại"
    : routeLeg ? `${formatDuration(routeLeg.duration)} xe máy từ ${origin.name}${routeLeg.fallback ? " · tuyến ước lượng" : ""}`
      : "Đang tính tuyến từ vị trí hiện tại…";
  elements.mapNavigationButton.hidden = state.trip.visitedPlaceIds.includes(place.id);
  elements.mapRenameButton.hidden = false;
  setMapVisitedAction(place);
  refreshIcons();
}

function renameSelectedPlace() {
  const place = state.trip?.places.find((item) => item.id === state.selectedMapPlaceId);
  if (!place) return;
  const planRecord = state.trip.plan?.hub?.id === place.id
    ? state.trip.plan.hub
    : state.trip.plan?.places.find((record) => record.id === place.id);
  const placeId = planRecord?.place_id ?? place.place_id ?? (place.id.startsWith("google-") ? place.id.slice(7) : null);
  handleMapClick({ placeId, coordinates: place.coordinates });
}

function openSelectedInGoogleMaps() {
  const origin = getOrigin();
  const destination = state.trip?.places.find((place) => place.id === state.selectedMapPlaceId);
  if (!origin || !destination) {
    showToast("Chạm một địa điểm trên bản đồ trước");
    return;
  }
  openGoogleMapsDirections(origin, destination);
}

function toggleVisitedSelected() {
  const origin = getOrigin();
  const placeId = state.selectedMapPlaceId ?? (origin?.category === "hotel" ? null : origin?.id);
  if (placeId) toggleVisited(placeId);
}

function formatDuration(durationSeconds) {
  const totalMinutes = Math.max(1, Math.round(durationSeconds / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (!hours) return `${minutes} phút`;
  if (!minutes) return `${hours} giờ`;
  return `${hours} giờ ${minutes} phút`;
}

async function searchPlaces() {
  const query = elements.placeSearchInput.value.trim();
  if (query.length < 2) {
    showToast("Nhập ít nhất 2 ký tự để tìm");
    return;
  }
  const requestId = ++state.placeSearchRequestId;
  const submitButton = elements.placeSearchForm.querySelector("button[type='submit']");
  submitButton.disabled = true;
  submitButton.textContent = "Đang tìm…";
  elements.placeResults.innerHTML = `<div class="results-message">Đang tìm trên Google Maps, nếu cần sẽ thử OpenStreetMap…</div>`;
  try {
    const { places: results, googleError } = await placeSearchService.search(query, {
      context: state.trip.destination.name,
      biasCenter: state.trip.destination.center,
      limit: 8,
    });
    if (requestId !== state.placeSearchRequestId) return;
    const existingIds = new Set(state.placeCatalog.map((place) => place.id));
    state.placeCatalog = [...results.filter((place) => !existingIds.has(place.id)), ...state.placeCatalog];
    state.category = "all";
    document.querySelectorAll("[data-category]").forEach((button) => button.classList.toggle("active", button.dataset.category === "all"));
    renderPlaceResults();
    if (!results.length) {
      const hint = googleError
        ? "Google Geocoding chưa khả dụng. Kiểm tra Geocoding API, App Check và key."
        : "Thử nhập tên đầy đủ hoặc số nhà, tên đường và tỉnh/thành phố.";
      elements.placeResults.innerHTML = `<div class="results-message">Không tìm thấy “${escapeHtml(query)}”.<br />${hint}</div>`;
      showToast("Không tìm thấy địa chỉ phù hợp");
    } else {
      showToast(`Tìm thấy ${results.length} kết quả`);
    }
  } catch (error) {
    console.error("Không thể tìm địa điểm", error);
    elements.placeResults.innerHTML = `<div class="results-message">Dịch vụ tìm kiếm đang bận. Các gợi ý có sẵn vẫn dùng bình thường.</div>`;
  } finally {
    if (requestId === state.placeSearchRequestId) {
      submitButton.disabled = false;
      submitButton.textContent = "Tìm";
    }
  }
}

async function searchDestination(query) {
  const localMatches = DESTINATIONS.filter((destination) => destination.name.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")));
  if (localMatches.length) {
    renderDestinationSearchResults(localMatches);
    return;
  }
  elements.destinationResults.hidden = false;
  elements.destinationResults.innerHTML = `<div class="search-result"><div><strong>Đang tìm trên Google Maps, sau đó OpenStreetMap nếu cần…</strong></div></div>`;
  try {
    const { places: results } = await placeSearchService.search(query, { limit: 5 });
    const destinations = results.map((result) => ({
      id: result.id,
      name: result.name,
      region: result.address,
      center: result.coordinates,
      zoom: 12,
      photo: DESTINATIONS[0].photo,
      tag: "Tìm thấy",
      description: result.address,
    }));
    renderDestinationSearchResults(destinations);
  } catch (error) {
    console.error("Không thể tìm điểm đến", error);
    elements.destinationResults.innerHTML = `<div class="search-result"><div><strong>Chưa tìm được điểm đến</strong><small>Thử lại sau hoặc chọn một gợi ý phía dưới.</small></div></div>`;
  }
}

function renderDestinationSearchResults(destinations) {
  elements.destinationResults.hidden = false;
  if (!destinations.length) {
    elements.destinationResults.innerHTML = `<div class="search-result"><div><strong>Không tìm thấy kết quả</strong></div></div>`;
    return;
  }
  elements.destinationResults.innerHTML = destinations.map((destination) => `
    <button class="search-result" type="button" data-search-destination="${encodeURIComponent(JSON.stringify(destination))}">
      <i data-lucide="map-pin"></i><div><strong>${escapeHtml(destination.name)}</strong><small>${escapeHtml(destination.region)}</small></div>
    </button>
  `).join("");
  refreshIcons();
}

function openTripInGoogleMaps() {
  const origin = getOrigin();
  const visited = new Set(state.trip.visitedPlaceIds);
  const selectedDestination = state.trip.places.find((place) => place.id === state.selectedMapPlaceId && !visited.has(place.id));
  const destination = selectedDestination ?? getVisiblePlaces().find((place) => place.category !== "hotel" && !visited.has(place.id));
  if (origin && destination) {
    openGoogleMapsDirections(origin, destination);
    return;
  }
  const coordinates = origin?.coordinates ?? destination?.coordinates ?? state.trip.destination.center;
  const [longitude, latitude] = coordinates;
  const params = new URLSearchParams({ api: "1", query: `${latitude},${longitude}` });
  window.open(`https://www.google.com/maps/search/?${params}`, "_blank", "noopener,noreferrer");
}

function coordinateForGoogleMaps(place) {
  return `${place.coordinates[1]},${place.coordinates[0]}`;
}

function openGoogleMapsDirections(origin, destination) {
  const params = new URLSearchParams({
    api: "1",
    origin: coordinateForGoogleMaps(origin),
    destination: coordinateForGoogleMaps(destination),
    travelmode: "two-wheeler",
  });
  window.open(`https://www.google.com/maps/dir/?${params}`, "_blank", "noopener,noreferrer");
}

async function shareTrip() {
  const encoded = encodeTrip(state.trip);
  const url = `${window.location.href.split("#")[0]}#trip=${encoded}`;
  try {
    if (navigator.share) {
      await navigator.share({ title: state.trip.title, text: `Bản đồ ${state.trip.title}`, url });
    } else {
      await navigator.clipboard.writeText(url);
      showToast("Đã sao chép liên kết chuyến đi");
    }
  } catch (error) {
    if (error.name !== "AbortError") {
      console.error("Không thể chia sẻ chuyến đi", error);
      showToast("Không thể chia sẻ trên trình duyệt này");
    }
  }
}

async function loadTripJson(file) {
  if (!file || state.importing) return;
  state.importing = true;
  document.querySelectorAll('[data-action="import-json"]').forEach((button) => { button.disabled = true; });
  elements.importStatus.textContent = "Đang đọc JSON…";
  try {
    if (file.size > 1024 * 1024) throw new Error("File JSON vượt quá 1 MB");
    const data = JSON.parse(await file.text());
    const { trip } = await importTripPlan(data, async (record, destination) => {
      if (record.place_id) return placeSearchService.resolvePlaceId(record.place_id);
      const query = record.map_query || [record.name, record.address].filter(Boolean).join(", ");
      const { places } = await placeSearchService.search(query, {
        context: destination.name,
        biasCenter: destination.center,
        limit: 1,
      });
      return places[0] ?? null;
    }, (current, total) => {
      elements.importStatus.textContent = `Đang xác định vị trí ${current}/${total}…`;
    });
    await openPlanner(trip);
    setStep(3);
    elements.importStatus.textContent = "Đã nhập JSON chuyến đi";
    showToast(`Đã nhập ${trip.places.length} địa điểm`);
  } catch (error) {
    console.error({ error: error.message }, "Không thể nhập JSON chuyến đi");
    elements.importStatus.textContent = error instanceof SyntaxError ? "File không phải JSON hợp lệ" : error.message;
    showToast("Không thể nhập JSON chuyến đi");
  } finally {
    state.importing = false;
    document.querySelectorAll('[data-action="import-json"]').forEach((button) => { button.disabled = false; });
    elements.tripJsonInput.value = "";
  }
}

function downloadTripJson() {
  try {
    const plan = exportTripPlan(state.trip, state.placeCatalog);
    const blob = new Blob([`${JSON.stringify(plan, null, 2)}\n`], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${state.trip.id.replace(/[^a-z0-9_-]/gi, "-")}.json`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast("Đã tải JSON chuyến đi");
  } catch (error) {
    console.error({ error: error.message }, "Không thể xuất JSON chuyến đi");
    showToast(error.message);
  }
}

function encodeTrip(trip) {
  const bytes = new TextEncoder().encode(JSON.stringify(trip));
  let binary = "";
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeSharedTrip() {
  const match = window.location.hash.match(/^#trip=(.+)$/);
  if (!match) return null;
  try {
    const normalized = match[1].replaceAll("-", "+").replaceAll("_", "/");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    console.error("Liên kết chuyến đi không hợp lệ", error);
    return null;
  }
}

function showToast(message) {
  window.clearTimeout(state.toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  state.toastTimer = window.setTimeout(() => elements.toast.classList.remove("show"), 2600);
}

function escapeHtml(value = "") {
  const element = document.createElement("span");
  element.textContent = value;
  return element.innerHTML.replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

elements.destinationForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const query = elements.destinationInput.value.trim();
  if (query.length < 2) return showToast("Nhập nơi bạn muốn đến");
  searchDestination(query);
});

elements.destinationInput.addEventListener("input", () => {
  const query = elements.destinationInput.value.trim();
  if (!query) {
    elements.destinationResults.hidden = true;
    return;
  }
  const localMatches = DESTINATIONS.filter((destination) => destination.name.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi")));
  if (localMatches.length) renderDestinationSearchResults(localMatches);
});

elements.tripDetailsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  if (elements.startDate.value && elements.endDate.value && elements.endDate.value < elements.startDate.value) {
    showToast("Ngày kết thúc phải sau ngày bắt đầu");
    return;
  }
  const formData = new FormData(elements.tripDetailsForm);
  state.trip.title = formData.get("title").trim();
  state.trip.startDate = formData.get("startDate");
  state.trip.endDate = formData.get("endDate");
  state.trip.vibe = formData.get("vibe") ?? "nature";
  state.trip.notes = formData.get("notes").trim();
  elements.tripTitleHeader.value = state.trip.title;
  saveTrip();
  setStep(2);
});

elements.startDate.addEventListener("change", () => { elements.endDate.min = elements.startDate.value; });
elements.tripTitleHeader.addEventListener("change", () => {
  const title = elements.tripTitleHeader.value.trim();
  if (!title) return;
  state.trip.title = title;
  elements.tripName.value = title;
  saveTrip();
});

elements.placeSearchForm.addEventListener("submit", (event) => {
  event.preventDefault();
  searchPlaces();
});

elements.tripJsonInput.addEventListener("change", (event) => loadTripJson(event.target.files?.[0]));
elements.mapPickForm.addEventListener("submit", (event) => { event.preventDefault(); addPickedPlace(); });

document.addEventListener("click", (event) => {
  const target = event.target.closest("button");
  if (!target) return;

  if (target.dataset.scrollTo) {
    document.querySelector(`#${target.dataset.scrollTo}`)?.scrollIntoView({ behavior: "smooth" });
    return;
  }
  if (target.dataset.destinationId) {
    const destination = DESTINATIONS.find((item) => item.id === target.dataset.destinationId);
    if (destination) openPlanner(createDefaultTrip(destination));
    return;
  }
  if (target.dataset.searchDestination) {
    const destination = JSON.parse(decodeURIComponent(target.dataset.searchDestination));
    elements.destinationResults.hidden = true;
    openPlanner(createDefaultTrip(destination));
    return;
  }
  if (target.dataset.tripId) {
    const savedTrip = sync.load(target.dataset.tripId);
    if (savedTrip) openPlanner(savedTrip, { persist: false });
    return;
  }
  if (target.dataset.placeId && !target.dataset.action) {
    togglePlace(target.dataset.placeId);
    return;
  }
  if (target.dataset.category) {
    state.category = target.dataset.category;
    document.querySelectorAll("[data-category]").forEach((button) => button.classList.toggle("active", button === target));
    renderPlaceResults();
    return;
  }
  if (target.dataset.dayIndex !== undefined) {
    const index = Number(target.dataset.dayIndex);
    if (!Number.isInteger(index) || !findPlanDay(state.trip?.plan, index)) return;
    state.activeDayIndex = index;
    state.selectedMapPlaceId = null;
    hideMapPick();
    renderDayNavigation();
    renderPlaceResults();
    renderTravelTimes();
    renderRouteSummary();
    updateMap(state.trip.places, state.route);
    return;
  }
  if (target.dataset.step) {
    setStep(target.dataset.step);
    return;
  }
  if (target.dataset.mobileView) {
    const isMap = target.dataset.mobileView === "map";
    elements.planner.classList.toggle("mobile-map", isMap);
    document.querySelectorAll("[data-mobile-view]").forEach((button) => button.classList.toggle("active", button === target));
    if (isMap) requestAnimationFrame(() => { mapController.resize(); updateMap(state.trip.places, state.route); });
    return;
  }

  const action = target.dataset.action;
  if (!action) return;
  const actions = {
    "go-home": showLanding,
    "sign-in": async () => {
      try { await sync.signIn(); }
      catch (error) {
        if (error.code !== "auth/popup-closed-by-user") {
          console.error({ error }, "Không thể đăng nhập");
          showToast("Không thể đăng nhập Google. Kiểm tra cấu hình và thử lại.");
        }
      }
    },
    "sign-out": async () => {
      try { await sync.signOut(); }
      catch (error) {
        console.error({ error }, "Không thể đăng xuất");
        showToast("Không thể đăng xuất. Thử lại sau.");
      }
    },
    "new-trip": () => openPlanner(createDefaultTrip()),
    "go-step": () => setStep(target.dataset.targetStep),
    "clear-places": () => {
      state.trip.places = [];
      state.trip.visitedPlaceIds = [];
      state.route = null;
      state.routeRequestId += 1;
      saveTrip(); renderPlaceResults(); renderTravelTimes(); updateMap();
    },
    "remove-place": () => togglePlace(target.dataset.placeId),
    "add-to-day": () => addSelectedPlaceToCurrentDay(target.dataset.placeId),
    "toggle-visited": () => toggleVisited(target.dataset.placeId),
    "toggle-visited-selected": toggleVisitedSelected,
    "open-maps": openTripInGoogleMaps,
    "map-zoom-in": () => mapController.zoomBy(1),
    "map-zoom-out": () => mapController.zoomBy(-1),
    "cancel-map-pick": hideMapPick,
    "navigate-selected": openSelectedInGoogleMaps,
    "rename-selected": renameSelectedPlace,
    "share-trip": shareTrip,
    "import-json": () => elements.tripJsonInput.click(),
    "export-json": downloadTripJson,
    "retry-map": async () => {
      mapController = new MapController("map", handleMapPlaceSelect, showMapError, handleMapClick);
      await initializeMap();
      await updateMap(state.trip.places, state.route);
    },
  };
  actions[action]?.();
});

async function initializeApp() {
  renderDestinations();
  renderSavedTrips();
  refreshIcons();
  await sync.start();
  const sharedTrip = decodeSharedTrip();
  if (sharedTrip) {
    history.replaceState(null, "", window.location.pathname + window.location.search);
    await openPlanner(sharedTrip);
    setStep(3);
    showToast("Đã mở chuyến đi được chia sẻ");
  }
}

initializeApp();
