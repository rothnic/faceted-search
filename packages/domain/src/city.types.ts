export type City = {
  id: string;
  name: string;
  state: string;
  county?: string;
  centerLat: number;
  centerLng: number;
};

export type Neighborhood = {
  id: string;
  cityId: string;
  name: string;
  lat: number;
  lng: number;
};
