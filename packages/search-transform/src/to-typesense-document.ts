import type { HouseSearchDocument } from './house-search-document.js';

export function toTypesenseDocument(document: HouseSearchDocument) {
  return {
    ...document,
    object_id: document.objectID,
    semantic_text: document.semanticText,
    updatedEpoch: Date.parse(document.updatedAt),
    location: [document.lat, document.lng]
  };
}
