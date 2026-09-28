import { APP_CONFIG } from "./config.js";
import { DESTINATIONS } from "./data.js";

const SCHEMA_VERSION = "1.1.0";
const MAP_CATEGORIES = new Set(["sight", "food", "other"]);

function requireText(value, path) {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${path} phải là chuỗi không rỗng`);
  return value.trim();
}

function validCoordinates(value) {
  return Array.isArray(value) && value.length === 2
    && Number.isFinite(value[0]) && Number.isFinite(value[1])
    && Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

function requireDate(value, path) {
  const parts = typeof value === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) : null;
  const date = parts ? new Date(Date.UTC(Number(parts[1]), Number(parts[2]) - 1, Number(parts[3]))) : null;
  if (!date || date.toISOString().slice(0, 10) !== value) {
    throw new Error(`${path} phải là ngày YYYY-MM-DD`);
  }
  return value;
}

function optionalDate(value, path) {
  return value == null || value === "" ? null : requireDate(value, path);
}

export function validateTripPlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) throw new Error("JSON phải là một object");
  if (plan.schema_version !== SCHEMA_VERSION) throw new Error(`Chỉ hỗ trợ schema_version ${SCHEMA_VERSION}`);
  const trip = plan.trip;
  if (!trip || typeof trip !== "object") throw new Error("Thiếu trip");
  requireText(trip.id, "trip.id");
  requireText(trip.name, "trip.name");
  requireText(trip.destination, "trip.destination");
  const startDate = optionalDate(trip.start_date, "trip.start_date");
  const endDate = optionalDate(trip.end_date, "trip.end_date");
  if (startDate && endDate && endDate < startDate) throw new Error("trip.end_date phải từ trip.start_date trở đi");
  if (!plan.hub || typeof plan.hub !== "object") throw new Error("Thiếu hub");
  if (plan.hub.type !== "hotel") throw new Error("hub.type phải là hotel");
  requireText(plan.hub.id, "hub.id");
  requireText(plan.hub.name, "hub.name");
  if (plan.hub.coordinates != null && !validCoordinates(plan.hub.coordinates)) throw new Error("hub.coordinates phải là [kinh độ, vĩ độ]");
  if (plan.hub.place_id != null) requireText(plan.hub.place_id, "hub.place_id");
  if (!Array.isArray(plan.places)) throw new Error("places phải là mảng");
  if (!Array.isArray(plan.days)) throw new Error("days phải là mảng");
  if (!Array.isArray(plan.selected_place_ids)) throw new Error("selected_place_ids phải là mảng");
  const ids = new Set([plan.hub.id]);
  for (const [index, place] of plan.places.entries()) {
    if (!place || typeof place !== "object") throw new Error(`places[${index}] phải là object`);
    const id = requireText(place.id, `places[${index}].id`);
    requireText(place.name, `places[${index}].name`);
    if (ids.has(id)) throw new Error(`ID địa điểm bị trùng: ${id}`);
    ids.add(id);
    if (!MAP_CATEGORIES.has(place.map_category)) throw new Error(`places[${index}].map_category không hợp lệ`);
    if (place.coordinates != null && !validCoordinates(place.coordinates)) throw new Error(`places[${index}].coordinates phải là [kinh độ, vĩ độ]`);
    if (place.place_id != null) requireText(place.place_id, `places[${index}].place_id`);
  }
  for (const [index, day] of plan.days.entries()) {
    if (!day || typeof day !== "object") throw new Error(`days[${index}] phải là object`);
    const date = optionalDate(day.date, `days[${index}].date`);
    if (date && ((startDate && date < startDate) || (endDate && date > endDate))) {
      throw new Error(`days[${index}].date ngoài khoảng chuyến đi`);
    }
    for (const field of ["main_places", "optional_places"]) {
      if (!Array.isArray(day[field])) throw new Error(`days[${index}].${field} phải là mảng`);
      for (const id of day[field]) if (!ids.has(id) || id === plan.hub.id) throw new Error(`days[${index}].${field} tham chiếu ID không tồn tại: ${id}`);
    }
  }
  const selected = new Set();
  for (const id of plan.selected_place_ids) {
    if (!ids.has(id) || id === plan.hub.id) throw new Error(`selected_place_ids tham chiếu ID không tồn tại: ${id}`);
    if (selected.has(id)) throw new Error(`selected_place_ids trùng ID: ${id}`);
    selected.add(id);
  }
  if (plan.visited_place_ids != null) {
    if (!Array.isArray(plan.visited_place_ids)) throw new Error("visited_place_ids phải là mảng");
    const visited = new Set();
    for (const id of plan.visited_place_ids) {
      if (!selected.has(id)) throw new Error(`visited_place_ids tham chiếu điểm chưa chọn: ${id}`);
      if (visited.has(id)) throw new Error(`visited_place_ids trùng ID: ${id}`);
      visited.add(id);
    }
  }
  if (selected.size + 1 > APP_CONFIG.maxPlacesPerTrip) throw new Error(`Tối đa ${APP_CONFIG.maxPlacesPerTrip} địa điểm đã chọn gồm khách sạn`);
  if (plan.planner_rules?.hub_id && plan.planner_rules.hub_id !== plan.hub.id) throw new Error("planner_rules.hub_id khác hub.id");
  return plan;
}

async function toMapPlace(record, category, resolver, destination) {
  let coordinates = record.coordinates;
  if (!coordinates) {
    try {
      const result = await resolver(record, destination);
      coordinates = result?.coordinates;
    } catch (error) {
      throw new Error(`Không xác định được tọa độ: ${record.name}`, { cause: error });
    }
  }
  if (!validCoordinates(coordinates)) throw new Error(`Không xác định được tọa độ: ${record.name}`);
  record.coordinates = coordinates;
  return {
    id: record.id,
    name: record.name,
    address: record.address || record.map_query || record.name,
    coordinates,
    category,
    source: "JSON chuyến đi",
    duration: category === "hotel" ? 0 : 60,
  };
}

export async function importTripPlan(input, resolver, onProgress = () => {}) {
  const plan = structuredClone(validateTripPlan(input));
  const destination = DESTINATIONS.find((item) => item.name === plan.trip.destination)
    || { id: `json-${plan.trip.id}`, name: plan.trip.destination, region: "", center: null, zoom: 12, photo: DESTINATIONS[0].photo };
  const records = [plan.hub, ...plan.places];
  const catalog = [];
  for (const [index, record] of records.entries()) {
    onProgress(index + 1, records.length);
    catalog.push(await toMapPlace(record, index === 0 ? "hotel" : record.map_category, resolver, destination));
  }
  if (!destination.center) destination.center = catalog[0].coordinates;
  const selected = new Set(plan.selected_place_ids);
  return {
    catalog,
    trip: {
      id: plan.trip.id,
      title: plan.trip.name,
      destination,
      startDate: plan.trip.start_date ?? "",
      endDate: plan.trip.end_date ?? "",
      vibe: "nature",
      notes: plan.trip.notes || "",
      places: catalog.filter((place) => place.category === "hotel" || selected.has(place.id)),
      visitedPlaceIds: [...(plan.visited_place_ids ?? [])],
      plan,
      updatedAt: new Date().toISOString(),
    },
  };
}

export function exportTripPlan(trip, catalog) {
  const selectedHotel = trip.places.find((place) => place.category === "hotel");
  if (!selectedHotel) throw new Error("Cần chọn khách sạn trước khi xuất JSON");
  const original = trip.plan ?? {
    schema_version: SCHEMA_VERSION,
    trip: { id: trip.id },
    days: [],
    places: [],
    planner_rules: {},
  };
  const originalById = new Map(original.places.map((place) => [place.id, place]));
  const allPlaces = new Map([...catalog, ...trip.places].filter((place) => place.category !== "hotel").map((place) => [place.id, place]));
  const places = [...allPlaces.values()].map((place) => stripGoogleCoordinates({
    ...(originalById.get(place.id) ?? {}),
    id: place.id,
    name: place.name,
    address: place.address,
    map_query: originalById.get(place.id)?.map_query ?? `${place.name}, ${place.address}`,
    category: originalById.get(place.id)?.category ?? place.category,
    map_category: place.category,
    coordinates: place.coordinates,
  }));
  const plan = {
    ...original,
    schema_version: SCHEMA_VERSION,
    trip: { ...original.trip, id: trip.id, name: trip.title, destination: trip.destination.name, start_date: trip.startDate || null, end_date: trip.endDate || null, notes: trip.notes ?? "" },
    hub: stripGoogleCoordinates({ ...(original.hub?.id === selectedHotel.id ? original.hub : {}), id: selectedHotel.id, type: "hotel", name: selectedHotel.name, address: selectedHotel.address, map_query: original.hub?.id === selectedHotel.id ? original.hub.map_query : `${selectedHotel.name}, ${selectedHotel.address}`, coordinates: selectedHotel.coordinates }),
    days: original.days,
    places,
    selected_place_ids: trip.places.filter((place) => place.category !== "hotel").map((place) => place.id),
    visited_place_ids: trip.visitedPlaceIds ?? [],
    planner_rules: { ...original.planner_rules, hub_id: selectedHotel.id },
  };
  return validateTripPlan(plan);
}

function stripGoogleCoordinates(record) {
  if (!record.place_id) return record;
  const { coordinates: _coordinates, ...portableRecord } = record;
  return portableRecord;
}
