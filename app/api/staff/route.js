import { getStaff } from '../../../lib/data';
export async function GET() {
  return Response.json(getStaff().filter(s => s.active !== false));
}
