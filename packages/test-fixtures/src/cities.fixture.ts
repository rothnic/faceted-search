import type { City, Neighborhood } from '../../domain/src/city.types.js';

export const cities: City[] = [
  { id: 'huntsville', name: 'Huntsville', state: 'AL', county: 'Madison', centerLat: 34.7304, centerLng: -86.5861 },
  { id: 'madison', name: 'Madison', state: 'AL', county: 'Madison', centerLat: 34.6993, centerLng: -86.7483 },
  { id: 'athens', name: 'Athens', state: 'AL', county: 'Limestone', centerLat: 34.8029, centerLng: -86.9717 },
  { id: 'decatur', name: 'Decatur', state: 'AL', county: 'Morgan', centerLat: 34.6059, centerLng: -86.9833 },
  { id: 'owens-cross-roads', name: 'Owens Cross Roads', state: 'AL', county: 'Madison', centerLat: 34.5884, centerLng: -86.4589 }
];

export const neighborhoods: Neighborhood[] = [
  { id: 'hampton-cove', cityId: 'huntsville', name: 'Hampton Cove', lat: 34.6559, lng: -86.4736 },
  { id: 'twickenham', cityId: 'huntsville', name: 'Twickenham', lat: 34.7299, lng: -86.5822 },
  { id: 'five-points', cityId: 'huntsville', name: 'Five Points', lat: 34.7449, lng: -86.5686 },
  { id: 'blossomwood', cityId: 'huntsville', name: 'Blossomwood', lat: 34.7339, lng: -86.5546 },
  { id: 'research-park', cityId: 'huntsville', name: 'Research Park', lat: 34.7211, lng: -86.6817 },
  { id: 'jones-valley', cityId: 'huntsville', name: 'Jones Valley', lat: 34.6911, lng: -86.5492 },
  { id: 'midtown-madison', cityId: 'madison', name: 'Midtown Madison', lat: 34.6999, lng: -86.7431 },
  { id: 'clift-farm', cityId: 'madison', name: 'Clift Farm', lat: 34.7552, lng: -86.7471 },
  { id: 'triana-village', cityId: 'madison', name: 'Triana Village', lat: 34.6003, lng: -86.7345 },
  { id: 'heritage-provence', cityId: 'madison', name: 'Heritage Provence', lat: 34.7217, lng: -86.7793 },
  { id: 'county-line', cityId: 'madison', name: 'County Line', lat: 34.7152, lng: -86.8001 },
  { id: 'downtown-athens', cityId: 'athens', name: 'Downtown Athens', lat: 34.8031, lng: -86.9709 },
  { id: 'east-limestone', cityId: 'athens', name: 'East Limestone', lat: 34.7727, lng: -86.8611 },
  { id: 'capshaw', cityId: 'athens', name: 'Capshaw', lat: 34.7704, lng: -86.7887 },
  { id: 'downtown-decatur', cityId: 'decatur', name: 'Downtown Decatur', lat: 34.6065, lng: -86.9862 },
  { id: 'burningtree', cityId: 'decatur', name: 'Burningtree', lat: 34.6304, lng: -86.9494 },
  { id: 'priceville', cityId: 'decatur', name: 'Priceville', lat: 34.5251, lng: -86.8947 },
  { id: 'goldsmith-schiffman', cityId: 'owens-cross-roads', name: 'Goldsmith Schiffman', lat: 34.6272, lng: -86.4913 },
  { id: 'hampton-ridge', cityId: 'owens-cross-roads', name: 'Hampton Ridge', lat: 34.6235, lng: -86.4552 },
  { id: 'mcmullen-cove', cityId: 'owens-cross-roads', name: 'McMullen Cove', lat: 34.6542, lng: -86.4315 }
];

export const redstoneArsenal = { label: 'Redstone Arsenal', lat: 34.6841, lng: -86.6540 };
