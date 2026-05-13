// Small pulsing orb that marks every LaRi surface. Pure presentational —
// no state, no fetch. Uses design tokens from styles/tokens.css (#235):
//   --ember-glow, --ember, --ember-deep
// The CSS class is in styles/globals.css (.lari-orb + @keyframes
// lari-pulse). Pass size="sm" for a tighter 14px version on dense
// chrome (KDS); default 22px reads from the cockpit rail.

export default function LariOrb({ size = 'md', live = true }) {
  const cls = ['lari-orb'];
  if (size === 'sm') cls.push('sm');
  if (!live) cls.push('still');
  return (
    <span className={cls.join(' ')} aria-hidden="true">
      <span className="lari-orb-core" />
      {live ? <span className="lari-orb-ring" /> : null}
    </span>
  );
}
