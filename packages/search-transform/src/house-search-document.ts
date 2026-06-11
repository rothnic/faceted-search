import type { City, Neighborhood } from '../../domain/src/city.types.js';
import type { House } from '../../domain/src/house.types.js';

export type HouseSearchDocument = {
  id: string;
  objectID: string;
  title: string;
  description: string;
  semanticText: string;
  city: string;
  state: string;
  county?: string;
  neighborhood?: string;
  zipCode: string;
  lat: number;
  lng: number;
  price: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lotSizeAcres?: number;
  yearBuilt?: number;
  propertyType: string;
  listingStatus: string;
  schoolDistrict?: string;
  amenities: string[];
  tags: string[];
  cityFacet: string;
  stateFacet: string;
  countyFacet?: string;
  neighborhoodFacet?: string;
  propertyTypeFacet: string;
  listingStatusFacet: string;
  schoolDistrictFacet?: string;
  updatedAt: string;
};

export function buildSemanticText(house: House, city: City, neighborhood?: Neighborhood): string {
  return [
    house.title,
    house.description,
    city.name,
    neighborhood?.name,
    house.schoolDistrict,
    house.propertyType.replaceAll('_', ' '),
    house.amenities.join(' '),
    house.tags.join(' ')
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export function toHouseSearchDocument(house: House, city: City, neighborhood?: Neighborhood): HouseSearchDocument {
  return {
    id: house.id,
    objectID: house.id,
    title: house.title,
    description: house.description,
    semanticText: buildSemanticText(house, city, neighborhood),
    city: city.name,
    state: city.state,
    county: city.county,
    neighborhood: neighborhood?.name,
    zipCode: house.zipCode,
    lat: house.lat,
    lng: house.lng,
    price: house.price,
    bedrooms: house.bedrooms,
    bathrooms: house.bathrooms,
    squareFeet: house.squareFeet,
    lotSizeAcres: house.lotSizeAcres,
    yearBuilt: house.yearBuilt,
    propertyType: house.propertyType,
    listingStatus: house.listingStatus,
    schoolDistrict: house.schoolDistrict,
    amenities: house.amenities,
    tags: house.tags,
    cityFacet: city.name,
    stateFacet: city.state,
    countyFacet: city.county,
    neighborhoodFacet: neighborhood?.name,
    propertyTypeFacet: house.propertyType,
    listingStatusFacet: house.listingStatus,
    schoolDistrictFacet: house.schoolDistrict,
    updatedAt: house.updatedAt
  };
}
