import type { HouseSearchRequest, SearchProviderId } from './search-provider.interface.js';

export type SavedHouseSearch = {
  id: string;
  name: string;
  provider: SearchProviderId;
  criteria: HouseSearchRequest;
  currentHitCount: number;
  lastEvaluatedAt?: string;
  newMatchesSinceLastEvaluation: number;
  seenHouseIds: string[];
  createdAt: string;
  updatedAt: string;
};
