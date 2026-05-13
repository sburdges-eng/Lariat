// @ts-nocheck — pre-#250 baseline. Remove once this file is migrated to JSDoc typedefs or .ts. See GH #250 / docs/checkjs-migration.md
import BeoBoard from './BeoBoard.jsx';
import { getCateringMenu } from '../../lib/data';

export const dynamic = 'force-dynamic';

export default function BeoPage() {
  const menu = getCateringMenu();
  return <BeoBoard initialMenu={menu} />;
}
