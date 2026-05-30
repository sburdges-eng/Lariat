import { getStaff } from '../../../lib/data';
import { cleanStaffForPicker } from '../../../lib/staffDisplay';

export async function GET() {
  return Response.json(cleanStaffForPicker(getStaff()));
}
