export type PropertyType = 'single_family' | 'townhouse' | 'condo' | 'multi_family' | 'land';
export type ListingStatus = 'active' | 'pending' | 'sold';

export type House = {
  id: string;
  title: string;
  description: string;
  cityId: string;
  neighborhoodId?: string;
  addressLine1: string;
  zipCode: string;
  lat: number;
  lng: number;
  price: number;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  lotSizeAcres?: number;
  yearBuilt?: number;
  propertyType: PropertyType;
  listingStatus: ListingStatus;
  schoolDistrict?: string;
  amenities: string[];
  tags: string[];
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
};
