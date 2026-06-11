import type { House, ListingStatus, PropertyType } from '../../domain/src/house.types.js';
import { cities, neighborhoods } from './cities.fixture.js';

const schoolDistricts = [
  'Madison City Schools',
  'Huntsville City Schools',
  'Madison County Schools',
  'Limestone County Schools',
  'Decatur City Schools',
  'Morgan County Schools',
  'Athens City Schools',
  'Mountain Gap Schools'
];

const amenityPool = [
  'garage',
  'pool',
  'fenced_yard',
  'basement',
  'fireplace',
  'screened_porch',
  'waterfront',
  'walk_in_closet',
  'smart_home',
  'solar_panels'
];

const tagPool = [
  'family-friendly',
  'quiet',
  'starter-home',
  'new-construction',
  'mountain-view',
  'walkable',
  'low-maintenance',
  'near-restaurants',
  'cul-de-sac',
  'research-park-commute'
];

const propertyTypes: PropertyType[] = ['single_family', 'townhouse', 'condo', 'multi_family', 'land'];
const listingStatuses: ListingStatus[] = ['active', 'pending', 'sold'];

function dateFor(index: number) {
  return new Date(Date.UTC(2026, 0, 1 + index)).toISOString();
}

function around(value: number, index: number, scale = 0.012) {
  return value + (((index % 7) - 3) * scale) / 3;
}

function generatedHouse(index: number): House {
  const neighborhood = neighborhoods[index % neighborhoods.length];
  const city = cities.find((candidate) => candidate.id === neighborhood.cityId)!;
  const propertyType = propertyTypes[index % propertyTypes.length];
  const status = listingStatuses[index % listingStatuses.length];
  const bedrooms = propertyType === 'land' ? 0 : 2 + (index % 5);
  const bathrooms = propertyType === 'land' ? 0 : 1 + (index % 4) * 0.5;
  const amenities = amenityPool.filter((_, amenityIndex) => (index + amenityIndex) % 4 === 0).slice(0, 4);
  const tags = tagPool.filter((_, tagIndex) => (index * 2 + tagIndex) % 5 === 0).slice(0, 4);
  const price = propertyType === 'land' ? 95_000 + index * 2_500 : 215_000 + (index % 37) * 14_000;

  return {
    id: `house-${String(index).padStart(3, '0')}`,
    title: `${city.name} ${propertyType.replace('_', ' ')} in ${neighborhood.name}`,
    description: `${bedrooms || 'Build-ready'} bedroom property with ${amenities.join(', ') || 'open space'} and ${tags.join(', ') || 'flexible living'} near ${neighborhood.name}.`,
    cityId: city.id,
    neighborhoodId: neighborhood.id,
    addressLine1: `${100 + index} ${neighborhood.name} Drive`,
    zipCode: `35${String(700 + (index % 90)).padStart(3, '0')}`,
    lat: around(neighborhood.lat, index),
    lng: around(neighborhood.lng, index + 3),
    price,
    bedrooms,
    bathrooms,
    squareFeet: propertyType === 'land' ? 0 : 1_150 + (index % 42) * 70,
    lotSizeAcres: propertyType === 'land' ? 1.4 + (index % 8) * 0.35 : 0.15 + (index % 10) * 0.08,
    yearBuilt: 1985 + (index % 41),
    propertyType,
    listingStatus: status,
    schoolDistrict: schoolDistricts[index % schoolDistricts.length],
    amenities,
    tags,
    createdAt: dateFor(index),
    updatedAt: dateFor(index + 1)
  };
}

const targetedHouses: House[] = [
  {
    id: 'target-hampton-cove-garage',
    title: 'Hampton Cove garage home with mountain views',
    description: 'Active family home in Hampton Cove with a three-car garage, fenced yard, trails, and mountain views.',
    cityId: 'huntsville',
    neighborhoodId: 'hampton-cove',
    addressLine1: '12 Cove Mountain Lane',
    zipCode: '35763',
    lat: 34.657,
    lng: -86.474,
    price: 525000,
    bedrooms: 4,
    bathrooms: 3,
    squareFeet: 3100,
    lotSizeAcres: 0.42,
    yearBuilt: 2018,
    propertyType: 'single_family',
    listingStatus: 'active',
    schoolDistrict: 'Mountain Gap Schools',
    amenities: ['garage', 'fenced_yard', 'fireplace', 'screened_porch'],
    tags: ['family-friendly', 'quiet', 'mountain-view', 'cul-de-sac'],
    createdAt: dateFor(130),
    updatedAt: dateFor(131)
  },
  {
    id: 'target-madison-starter',
    title: 'Madison starter home near good schools',
    description: 'Low-maintenance starter home in Madison City Schools with a garage, modest yard, and quick access to parks.',
    cityId: 'madison',
    neighborhoodId: 'midtown-madison',
    addressLine1: '44 Mill Road',
    zipCode: '35758',
    lat: 34.7002,
    lng: -86.742,
    price: 289000,
    bedrooms: 3,
    bathrooms: 2,
    squareFeet: 1680,
    lotSizeAcres: 0.21,
    yearBuilt: 2012,
    propertyType: 'single_family',
    listingStatus: 'active',
    schoolDistrict: 'Madison City Schools',
    amenities: ['garage', 'fenced_yard', 'smart_home'],
    tags: ['starter-home', 'family-friendly', 'low-maintenance'],
    createdAt: dateFor(132),
    updatedAt: dateFor(133)
  },
  {
    id: 'target-quiet-schools',
    title: 'Quiet cul-de-sac home for a growing family',
    description: 'Spacious home near good schools with a fenced yard, playroom, quiet street, and room for a growing family.',
    cityId: 'madison',
    neighborhoodId: 'heritage-provence',
    addressLine1: '18 Provence Circle',
    zipCode: '35756',
    lat: 34.722,
    lng: -86.779,
    price: 435000,
    bedrooms: 4,
    bathrooms: 3,
    squareFeet: 2760,
    lotSizeAcres: 0.31,
    yearBuilt: 2019,
    propertyType: 'single_family',
    listingStatus: 'active',
    schoolDistrict: 'Madison City Schools',
    amenities: ['fenced_yard', 'garage', 'walk_in_closet'],
    tags: ['quiet', 'family-friendly', 'cul-de-sac'],
    createdAt: dateFor(134),
    updatedAt: dateFor(135)
  },
  {
    id: 'target-research-park-new',
    title: 'New construction near Research Park',
    description: 'Modern house close to Research Park, restaurants, shopping, and Redstone Arsenal commute routes.',
    cityId: 'huntsville',
    neighborhoodId: 'research-park',
    addressLine1: '500 Innovation Way',
    zipCode: '35806',
    lat: 34.7205,
    lng: -86.679,
    price: 610000,
    bedrooms: 4,
    bathrooms: 3.5,
    squareFeet: 2980,
    lotSizeAcres: 0.24,
    yearBuilt: 2026,
    propertyType: 'single_family',
    listingStatus: 'active',
    schoolDistrict: 'Huntsville City Schools',
    amenities: ['garage', 'smart_home', 'walk_in_closet'],
    tags: ['new-construction', 'near-restaurants', 'research-park-commute'],
    createdAt: dateFor(136),
    updatedAt: dateFor(137)
  },
  {
    id: 'target-waterfront-expensive',
    title: 'Waterfront home near Huntsville',
    description: 'Waterfront property with pool, screened porch, and luxury finishes just outside Huntsville.',
    cityId: 'owens-cross-roads',
    neighborhoodId: 'goldsmith-schiffman',
    addressLine1: '9 Flint River Bend',
    zipCode: '35763',
    lat: 34.626,
    lng: -86.492,
    price: 760000,
    bedrooms: 4,
    bathrooms: 4,
    squareFeet: 3600,
    lotSizeAcres: 0.8,
    yearBuilt: 2021,
    propertyType: 'single_family',
    listingStatus: 'active',
    schoolDistrict: 'Madison County Schools',
    amenities: ['waterfront', 'pool', 'screened_porch', 'garage'],
    tags: ['luxury', 'quiet', 'family-friendly'],
    createdAt: dateFor(138),
    updatedAt: dateFor(139)
  },
  {
    id: 'target-retiree-low-maintenance',
    title: 'Low maintenance condo close to restaurants',
    description: 'Single-level condo with walkable dining, low maintenance finishes, and quiet community amenities.',
    cityId: 'huntsville',
    neighborhoodId: 'five-points',
    addressLine1: '77 Pratt Avenue',
    zipCode: '35801',
    lat: 34.746,
    lng: -86.567,
    price: 315000,
    bedrooms: 2,
    bathrooms: 2,
    squareFeet: 1390,
    lotSizeAcres: 0.06,
    yearBuilt: 2020,
    propertyType: 'condo',
    listingStatus: 'active',
    schoolDistrict: 'Huntsville City Schools',
    amenities: ['walk_in_closet', 'smart_home'],
    tags: ['low-maintenance', 'near-restaurants', 'walkable', 'quiet'],
    createdAt: dateFor(140),
    updatedAt: dateFor(141)
  }
];

export const houses: House[] = [...targetedHouses, ...Array.from({ length: 120 }, (_, index) => generatedHouse(index + 1))];

export const fixtureCatalog = {
  cities,
  neighborhoods,
  schoolDistricts,
  amenities: amenityPool,
  propertyTypes,
  listingStatuses,
  tags: tagPool
};
