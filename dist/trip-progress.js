export function normalizeVisitedPlaceIds(places, visitedIds = []) {
  const availableIds = new Set(places.filter((place) => place.category !== "hotel").map((place) => place.id));
  return [...new Set(visitedIds)].filter((id) => availableIds.has(id));
}

export function toggleVisitedPlaceId(visitedIds, placeId) {
  return visitedIds.includes(placeId)
    ? visitedIds.filter((id) => id !== placeId)
    : [...visitedIds, placeId];
}

export function currentOrigin(places, visitedIds) {
  const byId = new Map(places.map((place) => [place.id, place]));
  for (let index = visitedIds.length - 1; index >= 0; index -= 1) {
    const place = byId.get(visitedIds[index]);
    if (place) return place;
  }
  return places.find((place) => place.category === "hotel") ?? null;
}

export function pendingDestinations(places, visitedIds) {
  const visited = new Set(visitedIds);
  return places.filter((place) => place.category !== "hotel" && !visited.has(place.id));
}
