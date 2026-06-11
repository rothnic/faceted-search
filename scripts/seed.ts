import { postApi } from './api-client.js';

const result = await postApi('/api/seed');
console.log(`Seeded ${result.houses} houses and reset demo sync state.`);
