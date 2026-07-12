// @ts-check
import BeoBoard from './BeoBoard';
import { getCateringMenu } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default function BeoPage() {
  const menu = getCateringMenu();
  return <BeoBoard initialMenu={menu} />;
}
