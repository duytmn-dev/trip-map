export function findPlanDay(plan, index) {
  return plan?.days?.[index] ?? null;
}

export function isPlaceInDay(day, placeId) {
  return Boolean(day && (day.main_places.includes(placeId) || day.optional_places.includes(placeId)));
}

export function addPlaceToDay(day, placeId) {
  if (!day || isPlaceInDay(day, placeId)) return false;
  day.main_places.push(placeId);
  return true;
}

export function placesForDay(places, day, originId = null) {
  if (!day) return places;
  const hotel = places.find((place) => place.category === "hotel");
  const selectedById = new Map(places.map((place) => [place.id, place]));
  const plannedIds = [...new Set([...day.main_places, ...day.optional_places])];
  if (originId && !plannedIds.includes(originId) && originId !== hotel?.id) plannedIds.push(originId);
  return [hotel, ...plannedIds.map((id) => selectedById.get(id))].filter(Boolean);
}

export function routeForPlaces(route, places, day) {
  if (!route || !day) return route;
  const visibleIds = new Set(places.map((place) => place.id));
  return {
    ...route,
    legs: route.legs.filter((leg) => visibleIds.has(leg.toPlaceId)),
    geometry: route.geometry && {
      ...route.geometry,
      features: route.geometry.features.filter((feature) => visibleIds.has(feature.properties?.toPlaceId)),
    },
  };
}
