'use client';

// Top-down render of a sound_scenes.plot blob. Channels carry an optional
// `position.{x,y}` (0–100 percent of the stage rectangle). When absent
// the helper falls back to an even two-row grid (mics back, DIs/submixes
// front). Monitors render as small wedges along the downstage edge.
//
// Pure SVG, no deps. Matches the inline-SVG style of app/floor/FloorPlan.

const STAGE_W = 600;
const STAGE_H = 360;
const STAGE_MARGIN = 28;
const STAGE_TOP = STAGE_MARGIN;
const STAGE_BOTTOM = STAGE_H - STAGE_MARGIN;
const STAGE_LEFT = STAGE_MARGIN;
const STAGE_RIGHT = STAGE_W - STAGE_MARGIN;
const STAGE_INNER_W = STAGE_RIGHT - STAGE_LEFT;
const STAGE_INNER_H = STAGE_BOTTOM - STAGE_TOP;

const SOURCE_COLORS = {
  mic: 'var(--green, var(--sage, #5d7a66))',
  di: 'var(--yellow, var(--ember, #c85a2a))',
  submix: 'var(--accent, #7b6c5d)',
};

function clamp01(n) {
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, n)) / 100;
}

// Compute (x, y) for a channel. Explicit position wins. Otherwise lay
// out the unplaced channels in two rows: mics across the back, DIs +
// submixes across the front.
function layoutChannels(channels) {
  const placed = [];
  const unplacedBack = [];
  const unplacedFront = [];
  for (const c of channels) {
    if (c?.position && typeof c.position === 'object') {
      const x = clamp01(Number(c.position.x));
      const y = clamp01(Number(c.position.y));
      if (x != null && y != null) {
        placed.push({
          channel: c,
          x: STAGE_LEFT + x * STAGE_INNER_W,
          y: STAGE_TOP + y * STAGE_INNER_H,
        });
        continue;
      }
    }
    if (c?.source_type === 'mic') unplacedBack.push(c);
    else unplacedFront.push(c);
  }
  const stepBack = unplacedBack.length
    ? STAGE_INNER_W / (unplacedBack.length + 1)
    : 0;
  unplacedBack.forEach((c, i) => {
    placed.push({
      channel: c,
      x: STAGE_LEFT + stepBack * (i + 1),
      y: STAGE_TOP + STAGE_INNER_H * 0.28,
    });
  });
  const stepFront = unplacedFront.length
    ? STAGE_INNER_W / (unplacedFront.length + 1)
    : 0;
  unplacedFront.forEach((c, i) => {
    placed.push({
      channel: c,
      x: STAGE_LEFT + stepFront * (i + 1),
      y: STAGE_TOP + STAGE_INNER_H * 0.68,
    });
  });
  return placed;
}

function Marker({ x, y, channel }) {
  const t = channel?.source_type;
  const color = SOURCE_COLORS[t] || 'var(--muted)';
  const label = channel?.label || channel?.id || '';
  const id = String(channel?.id ?? '');
  // Shape: mic = circle, di = square, submix = diamond.
  let shape;
  if (t === 'di') {
    shape = (
      <rect
        x={-7}
        y={-7}
        width={14}
        height={14}
        fill={color}
        stroke="var(--ink, #1a1a1a)"
        strokeWidth={0.75}
      />
    );
  } else if (t === 'submix') {
    shape = (
      <polygon
        points="0,-9 9,0 0,9 -9,0"
        fill={color}
        stroke="var(--ink, #1a1a1a)"
        strokeWidth={0.75}
      />
    );
  } else {
    shape = (
      <circle
        r={7}
        fill={color}
        stroke="var(--ink, #1a1a1a)"
        strokeWidth={0.75}
      />
    );
  }
  return (
    <g
      transform={`translate(${x}, ${y})`}
      data-channel-id={id}
      data-source-type={t || 'unknown'}
      className="stage-plot-marker"
    >
      {shape}
      <text
        x={11}
        y={4}
        fontSize={11}
        fontFamily="JetBrains Mono, monospace"
        fill="var(--ink, #1a1a1a)"
      >
        {label}
      </text>
    </g>
  );
}

export default function StagePlotSvg({ plot }) {
  const channels = Array.isArray(plot?.channels) ? plot.channels : [];
  const monitors = Array.isArray(plot?.monitors) ? plot.monitors : [];
  const placed = layoutChannels(channels);

  // Monitors as wedges along the downstage edge.
  const monitorY = STAGE_BOTTOM - 12;
  const monitorStep = monitors.length
    ? STAGE_INNER_W / (monitors.length + 1)
    : 0;

  return (
    <svg
      viewBox={`0 0 ${STAGE_W} ${STAGE_H}`}
      width="100%"
      role="img"
      aria-label={`Stage plot · ${channels.length} channels · ${monitors.length} monitors`}
      style={{ display: 'block', background: 'var(--bg-card, transparent)' }}
    >
      {/* stage outline */}
      <rect
        x={STAGE_LEFT}
        y={STAGE_TOP}
        width={STAGE_INNER_W}
        height={STAGE_INNER_H}
        fill="none"
        stroke="var(--border, #ccc)"
        strokeWidth={1}
      />
      {/* back-of-stage label */}
      <text
        x={STAGE_LEFT + STAGE_INNER_W / 2}
        y={STAGE_TOP - 8}
        textAnchor="middle"
        fontSize={10}
        letterSpacing={2}
        fill="var(--muted)"
      >
        BACK OF STAGE
      </text>
      {/* audience strip */}
      <text
        x={STAGE_LEFT + STAGE_INNER_W / 2}
        y={STAGE_BOTTOM + 18}
        textAnchor="middle"
        fontSize={10}
        letterSpacing={2}
        fill="var(--muted)"
      >
        AUDIENCE
      </text>

      {/* monitors */}
      {monitors.map((m, i) => {
        const x = STAGE_LEFT + monitorStep * (i + 1);
        const label = m?.id || `M${i + 1}`;
        return (
          <g
            key={`mon-${label}-${i}`}
            transform={`translate(${x}, ${monitorY})`}
            className="stage-plot-monitor"
            data-monitor-id={String(m?.id ?? '')}
          >
            <polygon
              points="-12,0 12,0 8,8 -8,8"
              fill="var(--bg-elev, #f4ebe2)"
              stroke="var(--ink, #1a1a1a)"
              strokeWidth={0.75}
            />
            <text
              x={0}
              y={-3}
              textAnchor="middle"
              fontSize={9}
              fill="var(--muted)"
              fontFamily="JetBrains Mono, monospace"
            >
              {label}
            </text>
          </g>
        );
      })}

      {/* channels */}
      {placed.map((p, i) => (
        <Marker key={`chan-${p.channel?.id ?? i}`} x={p.x} y={p.y} channel={p.channel} />
      ))}

      {channels.length === 0 ? (
        <text
          x={STAGE_W / 2}
          y={STAGE_H / 2}
          textAnchor="middle"
          fontSize={13}
          fill="var(--muted)"
        >
          No channels in this scene yet.
        </text>
      ) : null}
    </svg>
  );
}
