import type { HouseSearchDocument } from './house-search-document.js';

export function toMeiliDocument(document: HouseSearchDocument) {
  return {
    ...document,
    updatedEpoch: Date.parse(document.updatedAt),
    _geo: {
      lat: document.lat,
      lng: document.lng
    }
  };
}
