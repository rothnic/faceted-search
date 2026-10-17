import { HouseReadError, readHouse } from '@/lib/house-backend';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  try { return Response.json(await readHouse(id, request.signal)); }
  catch (error) {
    const failure = error instanceof HouseReadError ? error : new HouseReadError('Home details are unavailable. Return to your results or try again.', 503);
    return Response.json({ error: failure.message }, { status: failure.status });
  }
}
