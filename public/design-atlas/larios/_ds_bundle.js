/* @ds-bundle: {"format":4,"namespace":"LariatLaRiOSDesignSystem_5761b2","components":[{"name":"BrandStamp","sourcePath":"components/brand/BrandStamp.jsx"},{"name":"StationRing","sourcePath":"components/brand/StationRing.jsx"},{"name":"Avatar","sourcePath":"components/core/Avatar.jsx"},{"name":"Bar","sourcePath":"components/core/Bar.jsx"},{"name":"Button","sourcePath":"components/core/Button.jsx"},{"name":"Kpi","sourcePath":"components/core/Kpi.jsx"},{"name":"Pill","sourcePath":"components/core/Pill.jsx"},{"name":"StatusDot","sourcePath":"components/core/StatusDot.jsx"},{"name":"Tag","sourcePath":"components/core/Tag.jsx"},{"name":"Card","sourcePath":"components/data/Card.jsx"},{"name":"DataTable","sourcePath":"components/data/DataTable.jsx"},{"name":"Tabs","sourcePath":"components/data/Tabs.jsx"},{"name":"Field","sourcePath":"components/forms/Field.jsx"},{"name":"Input","sourcePath":"components/forms/Input.jsx"},{"name":"Select","sourcePath":"components/forms/Select.jsx"},{"name":"Textarea","sourcePath":"components/forms/Textarea.jsx"}],"sourceHashes":{"components/brand/BrandStamp.jsx":"67388118f14d","components/brand/StationRing.jsx":"78430005b183","components/core/Avatar.jsx":"f5ad9e8f31b2","components/core/Bar.jsx":"c9c917e33b1d","components/core/Button.jsx":"256713ca5441","components/core/Kpi.jsx":"838519f51450","components/core/Pill.jsx":"f8053fe5164a","components/core/StatusDot.jsx":"5e1131583645","components/core/Tag.jsx":"739157cb6d07","components/data/Card.jsx":"8f9e0e96a636","components/data/DataTable.jsx":"111c855568cc","components/data/Tabs.jsx":"bf5fc1296500","components/forms/Field.jsx":"c3640f385af8","components/forms/Input.jsx":"5f0f067302c6","components/forms/Select.jsx":"b88ab9ed04e2","components/forms/Textarea.jsx":"e32599b75095","ui_kits/altitude/Altitude.jsx":"5f5de3b34839","ui_kits/cockpit-v2/ScreensFront.jsx":"11d17190fb54","ui_kits/cockpit-v2/ScreensHr.jsx":"6f689b9c1c5d","ui_kits/cockpit-v2/ScreensOffice.jsx":"b72eb15f8177","ui_kits/cockpit-v2/ScreensOps.jsx":"14cbe1d3cdf7","ui_kits/cockpit-v2/Shell2.jsx":"88d527e6e980","ui_kits/cockpit/Screens.jsx":"f088d7936ebd","ui_kits/cockpit/Shell.jsx":"b9da2782a0c0","ui_kits/cockpit/data.js":"b4f711184388","ui_kits/concept-rail/Rail.jsx":"d0ebda749ef6","ui_kits/concept-rail/RailViews.jsx":"fc6d70fa645a","ui_kits/concept-rail/tweaks-panel.jsx":"6591467622ed"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.LariatLaRiOSDesignSystem_5761b2 = window.LariatLaRiOSDesignSystem_5761b2 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/brand/BrandStamp.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * BrandStamp — the Lariat signature mark: a cattle-brand / lariat-loop
 * monogram. A single coiled rope loop with a trailing tail that hooks back,
 * plus a hard-stamped center dot (the "branding iron" punch). Drawn with
 * currentColor so it inherits the surrounding text color (gaslight amber when
 * active, bone otherwise) and scales with font-size (default 1em square).
 *
 * Ported verbatim from the shipping app (app/_components/BrandStamp.jsx).
 */
function BrandStamp({
  label = 'Lariat',
  decorative = false,
  size,
  className,
  style,
  ...rest
}) {
  const a11y = decorative ? {
    'aria-hidden': 'true'
  } : {
    role: 'img',
    'aria-label': label
  };
  const dim = size != null ? size : '1em';
  return /*#__PURE__*/React.createElement("svg", _extends({
    viewBox: "0 0 40 40",
    width: dim,
    height: dim,
    className: className,
    style: style,
    fill: "none",
    stroke: "currentColor",
    strokeWidth: "2.4",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  }, a11y, rest), /*#__PURE__*/React.createElement("ellipse", {
    cx: "20",
    cy: "17",
    rx: "11.5",
    ry: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M20 27 C 20 33, 23 36, 29 35.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "20",
    cy: "17",
    r: "2.6",
    fill: "currentColor",
    stroke: "none"
  }));
}
Object.assign(__ds_scope, { BrandStamp });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/BrandStamp.jsx", error: String((e && e.message) || e) }); }

// components/brand/StationRing.jsx
try { (() => {
/**
 * StationRing — the line-station progress ring from the cockpit's left rail.
 * A thin circular track with an amber (or tone-colored) fill sweep, a numeric
 * glyph punched in the center. Tone is derived from progress unless overridden:
 * flagged/not-started -> fire (oxblood), in-progress -> amber, done -> bone.
 *
 * Ported from the shipping app (app/_components/Sidebar.jsx · StationRing).
 */
function StationRing({
  done = 0,
  total = 0,
  flagged = 0,
  signedOff = false,
  glyph,
  size = 36,
  tone: toneOverride
}) {
  const r = 14;
  const c = 2 * Math.PI * r;
  const pct = total ? Math.min(1, done / total) : 0;
  const off = c * (1 - pct);
  const tone = toneOverride || (flagged > 0 ? 'fire' : signedOff || total && done >= total ? 'done' : done > 0 ? 'amber' : 'fire');
  const fillColor = tone === 'fire' ? 'var(--fire)' : tone === 'amber' ? 'var(--accent)' : tone === 'ok' ? 'var(--ok)' : 'var(--text)';
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'relative',
      width: size,
      height: size,
      flexShrink: 0,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    viewBox: "0 0 36 36",
    width: size,
    height: size,
    style: {
      transform: 'rotate(-90deg)'
    }
  }, /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "18",
    r: r,
    fill: "none",
    stroke: "var(--hair)",
    strokeWidth: "2.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "18",
    cy: "18",
    r: r,
    fill: "none",
    stroke: fillColor,
    strokeWidth: "2.5",
    strokeLinecap: "round",
    strokeDasharray: c,
    strokeDashoffset: off,
    style: {
      transition: 'stroke-dashoffset .4s var(--easing)'
    }
  })), glyph != null && /*#__PURE__*/React.createElement("span", {
    style: {
      position: 'absolute',
      fontFamily: 'var(--mono)',
      fontSize: size * 0.3,
      fontWeight: 700,
      color: 'var(--text)'
    }
  }, glyph));
}
Object.assign(__ds_scope, { StationRing });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/brand/StationRing.jsx", error: String((e && e.message) || e) }); }

// components/core/Avatar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Avatar — a round initials chip in the display grotesque on amber (the cook/staff mark).
 * Ported from the .av token primitive. Sizes sm / md / lg.
 */
const DIM = {
  sm: 22,
  md: 30,
  lg: 42
};
const FS = {
  sm: 11,
  md: 14,
  lg: 18
};
function Avatar({
  initials,
  name,
  size = 'md',
  tone = 'amber',
  style,
  ...rest
}) {
  const dim = DIM[size] || DIM.md;
  const label = initials || (name ? name.split(' ').map(w => w[0]).slice(0, 2).join('') : '?');
  const bg = tone === 'ink' ? 'var(--text)' : 'var(--accent)';
  const fg = tone === 'ink' ? 'var(--panel)' : 'var(--on-accent)';
  return /*#__PURE__*/React.createElement("span", _extends({
    title: name,
    style: {
      width: dim,
      height: dim,
      borderRadius: '50%',
      background: bg,
      color: fg,
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'var(--display)',
      fontSize: FS[size] || FS.md,
      fontWeight: 500,
      flexShrink: 0,
      ...style
    }
  }, rest), label);
}
Object.assign(__ds_scope, { Avatar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Avatar.jsx", error: String((e && e.message) || e) }); }

// components/core/Bar.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Bar — a thin data/progress bar. A sunk track with a tone-colored fill.
 * Ported from the .bar token primitive.
 */
function Bar({
  value = 0,
  tone = 'amber',
  height = 6,
  style,
  ...rest
}) {
  const color = {
    amber: 'var(--accent)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)'
  }[tone];
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      height,
      background: 'var(--panel-2)',
      borderRadius: 99,
      overflow: 'hidden',
      position: 'relative',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("i", {
    style: {
      display: 'block',
      height: '100%',
      width: `${Math.max(0, Math.min(100, value))}%`,
      background: color,
      borderRadius: 99,
      transition: 'width var(--dur-slow) var(--easing)'
    }
  }));
}
Object.assign(__ds_scope, { Bar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Bar.jsx", error: String((e && e.message) || e) }); }

// components/core/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Button — the LaRiOS action control. Compact, uppercase, wide-tracked; a
 * matte fill with a 1px border that lights to amber on hover and depresses on
 * press. Never rounded past --radius-sm. Ported from the token primitive
 * (.btn) in the shipping app.
 *
 * variants: primary (amber fill) · default (matte) · ghost (transparent) ·
 *           ink (bone fill) · danger (oxblood) · ok (sage)
 * sizes: xs · sm · md (default) · lg
 */
const PAD = {
  xs: '3px 8px',
  sm: '5px 10px',
  md: '8px 14px',
  lg: '12px 20px'
};
const FS = {
  xs: '9.5px',
  sm: '10px',
  md: '11.5px',
  lg: '13px'
};
function Button({
  children,
  variant = 'default',
  size = 'md',
  disabled = false,
  type = 'button',
  onClick,
  style,
  ...rest
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    padding: PAD[size] || PAD.md,
    fontFamily: 'var(--sans)',
    fontSize: FS[size] || FS.md,
    fontWeight: 700,
    letterSpacing: '.1em',
    textTransform: 'uppercase',
    border: '1px solid var(--hair)',
    borderRadius: 'var(--radius-sm)',
    background: 'var(--panel)',
    color: 'var(--text)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'background var(--dur), border-color var(--dur), color var(--dur), transform var(--dur-fast)',
    lineHeight: 1.1
  };
  const variants = {
    default: {},
    primary: {
      background: 'var(--accent)',
      color: 'var(--on-accent)',
      borderColor: 'var(--accent)'
    },
    ghost: {
      background: 'transparent'
    },
    ink: {
      background: 'var(--text)',
      color: 'var(--panel)',
      borderColor: 'var(--text)'
    },
    danger: {
      background: 'var(--fire)',
      color: 'var(--on-accent)',
      borderColor: 'var(--fire)'
    },
    ok: {
      background: 'var(--ok)',
      color: 'var(--on-accent)',
      borderColor: 'var(--ok)'
    }
  };
  const [hover, setHover] = React.useState(false);
  const [active, setActive] = React.useState(false);
  const hoverStyle = hover && !disabled ? variant === 'default' || variant === 'ghost' ? {
    borderColor: 'var(--accent)',
    color: 'var(--accent)'
  } : {
    filter: 'brightness(1.08)'
  } : null;
  return /*#__PURE__*/React.createElement("button", _extends({
    type: type,
    disabled: disabled,
    onClick: onClick,
    onMouseEnter: () => setHover(true),
    onMouseLeave: () => {
      setHover(false);
      setActive(false);
    },
    onMouseDown: () => setActive(true),
    onMouseUp: () => setActive(false),
    style: {
      ...base,
      ...variants[variant],
      ...hoverStyle,
      ...(active && !disabled ? {
        transform: 'scale(0.97)'
      } : null),
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Button.jsx", error: String((e && e.message) || e) }); }

// components/core/Kpi.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Kpi — a metric cell. Mono wide-tracked label, big display-grotesque value, and an
 * optional mono sub-line with an up/down/warn trend tone. Ported from the .kpi
 * token primitive. The value uses tabular figures.
 */
function Kpi({
  label,
  value,
  sub,
  trend,
  style,
  ...rest
}) {
  const subColor = {
    up: 'var(--ok)',
    down: 'var(--fire)',
    warn: 'var(--accent)'
  }[trend] || 'var(--text-muted)';
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      padding: '14px 16px',
      border: '1px solid var(--hair)',
      borderRadius: 'var(--radius)',
      background: 'var(--panel)',
      display: 'flex',
      flexDirection: 'column',
      gap: 4,
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: '9.5px',
      letterSpacing: '.24em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      fontWeight: 700
    }
  }, label), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--display)',
      fontSize: 38,
      lineHeight: 1,
      letterSpacing: '-.02em',
      fontVariantNumeric: 'tabular-nums',
      color: 'var(--text)'
    }
  }, value), sub != null && /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 11,
      color: subColor
    }
  }, sub));
}
Object.assign(__ds_scope, { Kpi });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Kpi.jsx", error: String((e && e.message) || e) }); }

// components/core/Pill.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Pill — a small status capsule. Uppercase, wide-tracked, tinted by tone.
 * Ported from the .pill token primitive. Tones map to the warm status
 * palette: ok (sage), warn (brass), alert (oxblood), amber, ink, lari.
 */
const TONES = {
  neutral: {
    background: 'var(--panel-2)',
    color: 'var(--text-muted)',
    border: '1px solid var(--hair)'
  },
  ok: {
    background: 'rgba(122,160,127,.18)',
    color: 'var(--ok)',
    border: '1px solid transparent'
  },
  warn: {
    background: 'rgba(194,145,47,.20)',
    color: 'var(--metal)',
    border: '1px solid transparent'
  },
  alert: {
    background: 'rgba(224,90,60,.18)',
    color: 'var(--fire)',
    border: '1px solid transparent'
  },
  amber: {
    background: 'var(--accent)',
    color: 'var(--on-accent)',
    border: '1px solid var(--accent)'
  },
  ink: {
    background: 'var(--text)',
    color: 'var(--panel)',
    border: 'none'
  },
  lari: {
    background: '#1d1a15',
    color: 'var(--ember-glow)',
    border: '1px solid var(--ember-deep)',
    fontFamily: 'var(--mono)',
    fontSize: '9.5px'
  }
};
function Pill({
  children,
  tone = 'neutral',
  dot = false,
  style,
  ...rest
}) {
  const t = TONES[tone] || TONES.neutral;
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 5,
      padding: '3px 8px',
      borderRadius: 99,
      fontSize: '10px',
      letterSpacing: '.14em',
      textTransform: 'uppercase',
      fontWeight: 700,
      fontFamily: 'var(--sans)',
      lineHeight: 1.2,
      ...t,
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: 'currentColor',
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Pill });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Pill.jsx", error: String((e && e.message) || e) }); }

// components/core/StatusDot.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * StatusDot — a bare tone dot. The atomic status signal used across boards,
 * nav, and tiles. Ported from the .dot token primitive.
 */
function StatusDot({
  tone = 'muted',
  size = 8,
  pulse = false,
  style,
  ...rest
}) {
  const color = {
    muted: 'var(--text-muted)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)',
    amber: 'var(--accent)'
  }[tone];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      width: size,
      height: size,
      borderRadius: '50%',
      background: color,
      display: 'inline-block',
      flexShrink: 0,
      boxShadow: pulse ? `0 0 0 3px color-mix(in srgb, ${color} 22%, transparent)` : 'none',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/core/Tag.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tag — a hairline mono micro-label with an optional leading dot. Squared
 * corners (2px). Ported from the .tag token primitive. Quieter than a Pill:
 * used for metadata, categories, station codes.
 */
function Tag({
  children,
  dot,
  dotTone = 'muted',
  style,
  ...rest
}) {
  const dotColor = {
    muted: 'var(--text-muted)',
    ok: 'var(--ok)',
    warn: 'var(--metal)',
    alert: 'var(--fire)',
    amber: 'var(--accent)'
  }[dotTone];
  return /*#__PURE__*/React.createElement("span", _extends({
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--mono)',
      fontSize: '9.5px',
      letterSpacing: '.18em',
      textTransform: 'uppercase',
      fontWeight: 700,
      color: 'var(--text-muted)',
      padding: '2px 6px',
      border: '1px solid var(--hair)',
      borderRadius: 2,
      ...style
    }
  }, rest), dot && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: '50%',
      background: dotColor,
      flexShrink: 0
    }
  }), children);
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/core/Tag.jsx", error: String((e && e.message) || e) }); }

// components/data/Card.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Card — a matte panel with a 1px hairline and minimal radius. Optional
 * header (title + right-slot). Depth is the border, not a shadow — pass
 * floating to add elevation for menus/modals only.
 */
function Card({
  title,
  right,
  children,
  floating = false,
  padded = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--hair)',
      borderRadius: 'var(--radius)',
      boxShadow: floating ? 'var(--shadow-2)' : 'none',
      overflow: 'hidden',
      ...style
    }
  }, rest), (title || right) && /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      padding: '10px 14px',
      borderBottom: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--display)',
      fontVariantCaps: 'small-caps',
      fontWeight: 500,
      fontSize: 14,
      letterSpacing: '.06em',
      color: 'var(--text)'
    }
  }, title), right), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: padded ? 14 : 0
    }
  }, children));
}
Object.assign(__ds_scope, { Card });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Card.jsx", error: String((e && e.message) || e) }); }

// components/data/DataTable.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * DataTable — a dense grid. Sticky mono uppercase header with a solid bottom
 * hairline, barely-perceptible zebra striping, right-aligned numeric columns
 * with tabular figures. Ported from the .data-table primitive + the grid
 * conventions in the shipping boards.
 *
 * columns: [{ key, label, align?: 'left'|'right', mono?: boolean, width? }]
 * rows:    array of objects keyed by column.key (values are ReactNodes)
 */
function DataTable({
  columns = [],
  rows = [],
  zebra = true,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      overflow: 'auto',
      border: '1px solid var(--hair)',
      borderRadius: 'var(--radius-sm)',
      ...style
    }
  }, rest), /*#__PURE__*/React.createElement("table", {
    style: {
      width: '100%',
      borderCollapse: 'collapse',
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 1,
      textAlign: c.align || 'left',
      padding: '8px 12px',
      fontFamily: 'var(--mono)',
      fontSize: 10,
      fontWeight: 700,
      letterSpacing: '.12em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      background: 'var(--panel-2)',
      borderBottom: '1px solid var(--hair)',
      whiteSpace: 'nowrap',
      width: c.width
    }
  }, c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((row, i) => /*#__PURE__*/React.createElement("tr", {
    key: row.id ?? i,
    style: {
      background: zebra && i % 2 ? 'var(--panel-2)' : 'var(--panel)'
    }
  }, columns.map(c => /*#__PURE__*/React.createElement("td", {
    key: c.key,
    style: {
      textAlign: c.align || 'left',
      padding: '8px 12px',
      color: 'var(--text)',
      borderBottom: '1px solid var(--hair)',
      fontFamily: c.mono || c.align === 'right' ? 'var(--mono)' : 'var(--sans)',
      fontVariantNumeric: c.mono || c.align === 'right' ? 'tabular-nums' : 'normal',
      whiteSpace: 'nowrap'
    }
  }, row[c.key])))))));
}
Object.assign(__ds_scope, { DataTable });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/DataTable.jsx", error: String((e && e.message) || e) }); }

// components/data/Tabs.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Tabs — a mono uppercase tab strip on a hairline baseline; the active tab
 * carries an amber underline. Ported from the .tabs primitive. Controlled via
 * value/onChange, or uncontrolled with defaultValue.
 */
function Tabs({
  tabs = [],
  value,
  defaultValue,
  onChange,
  style,
  ...rest
}) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]?.value);
  const active = value !== undefined ? value : internal;
  const pick = v => {
    if (value === undefined) setInternal(v);
    onChange?.(v);
  };
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      borderBottom: '1px solid var(--hair)',
      ...style
    }
  }, rest), tabs.map(t => {
    const on = t.value === active;
    return /*#__PURE__*/React.createElement("button", {
      key: t.value,
      onClick: () => pick(t.value),
      style: {
        padding: '10px 14px',
        fontFamily: 'var(--mono)',
        fontSize: 10.5,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: on ? 'var(--text)' : 'var(--text-muted)',
        background: 'none',
        border: 'none',
        borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
        marginBottom: -1,
        cursor: 'pointer',
        transition: 'color var(--dur)'
      }
    }, t.label);
  }));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/data/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/forms/Field.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Field — a label + control wrapper. The label is a mono/uppercase micro-cap
 * above the control (the standard form row). Pass the control as children.
 */
function Field({
  label,
  hint,
  htmlFor,
  children,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("div", _extends({
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      ...style
    }
  }, rest), label && /*#__PURE__*/React.createElement("label", {
    htmlFor: htmlFor,
    style: {
      fontFamily: 'var(--sans)',
      fontSize: 11,
      color: 'var(--text-muted)',
      textTransform: 'uppercase',
      letterSpacing: '.08em',
      fontWeight: 700
    }
  }, label), children, hint && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: 'var(--text-muted)',
      fontFamily: 'var(--sans)'
    }
  }, hint));
}
Object.assign(__ds_scope, { Field });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Field.jsx", error: String((e && e.message) || e) }); }

// components/forms/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/**
 * Input — a text field with an INSET look: the darker app-bg fill (recessed
 * below the panel surface) with a 1px hairline that lights amber on focus.
 * Compact by default. Ported from the .input primitive.
 */
function Input({
  size = 'md',
  invalid = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'lg' ? '12px 14px' : '8px 11px';
  const fs = size === 'lg' ? 15 : 13;
  return /*#__PURE__*/React.createElement("input", _extends({
    onFocus: e => {
      setFocus(true);
      rest.onFocus?.(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur?.(e);
    },
    style: {
      width: '100%',
      padding: pad,
      fontSize: fs,
      fontFamily: 'var(--sans)',
      background: 'var(--bg)',
      color: 'var(--text)',
      border: `1px solid ${invalid ? 'var(--fire)' : focus ? 'var(--accent)' : 'var(--hair)'}`,
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      boxSizing: 'border-box',
      transition: 'border-color var(--dur)',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Input.jsx", error: String((e && e.message) || e) }); }

// components/forms/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Select — inset dropdown matching Input. */
function Select({
  children,
  size = 'md',
  invalid = false,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  const pad = size === 'lg' ? '12px 14px' : '8px 11px';
  const fs = size === 'lg' ? 15 : 13;
  return /*#__PURE__*/React.createElement("select", _extends({
    onFocus: e => {
      setFocus(true);
      rest.onFocus?.(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur?.(e);
    },
    style: {
      width: '100%',
      padding: pad,
      fontSize: fs,
      fontFamily: 'var(--sans)',
      background: 'var(--bg)',
      color: 'var(--text)',
      border: `1px solid ${invalid ? 'var(--fire)' : focus ? 'var(--accent)' : 'var(--hair)'}`,
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      cursor: 'pointer',
      boxSizing: 'border-box',
      transition: 'border-color var(--dur)',
      ...style
    }
  }, rest), children);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Select.jsx", error: String((e && e.message) || e) }); }

// components/forms/Textarea.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
/** Textarea — inset multi-line field matching Input; vertical resize only. */
function Textarea({
  invalid = false,
  rows = 3,
  style,
  ...rest
}) {
  const [focus, setFocus] = React.useState(false);
  return /*#__PURE__*/React.createElement("textarea", _extends({
    rows: rows,
    onFocus: e => {
      setFocus(true);
      rest.onFocus?.(e);
    },
    onBlur: e => {
      setFocus(false);
      rest.onBlur?.(e);
    },
    style: {
      width: '100%',
      padding: '8px 11px',
      fontSize: 13,
      fontFamily: 'var(--sans)',
      background: 'var(--bg)',
      color: 'var(--text)',
      border: `1px solid ${invalid ? 'var(--fire)' : focus ? 'var(--accent)' : 'var(--hair)'}`,
      borderRadius: 'var(--radius-sm)',
      outline: 'none',
      resize: 'vertical',
      boxSizing: 'border-box',
      lineHeight: 1.5,
      transition: 'border-color var(--dur)',
      ...style
    }
  }, rest));
}
Object.assign(__ds_scope, { Textarea });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/forms/Textarea.jsx", error: String((e && e.message) || e) }); }

// ui_kits/altitude/Altitude.jsx
try { (() => {
// Altitude — the Rail × Cockpit synthesis.
//   A0 LINE  — role-aware rail (spine + queue). Home.
//   A1 SHEET — quick context, summoned from cards / spine / ⌘K.
//   A2 BOARD — the FULL cockpit-v2 board docked over the queue, with a
//              division › section breadcrumb and a "back to the line" strip
//              that always shows how many cards need you. Recent boards ride
//              as 3 transient chips — recency, not tab debt.
//   A3 ATLAS — the map: every division › section › board with a one-line doc,
//              searchable, launchable. Procedures + house rules live here too.
//   Esc always goes DOWN one altitude. ⌘K reaches everything from anywhere.
const DSa = window.LariatLaRiOSDesignSystem_5761b2;
const {
  BrandStamp: MarkA,
  Button: Ba,
  Pill: Pa,
  Tag: Ta,
  StatusDot: Da
} = DSa;
const KITa = window.RailKit;
const RR = window.RailRoles;
const {
  DIVISIONS
} = window.Shell2;

/* ── Full board routes (cockpit + cockpit-v2 screens, reused as-is) ── */
const Sc1 = window.Screens,
  S2 = window.Screens2;
const ROUTES = {
  'eighty-six': () => /*#__PURE__*/React.createElement(Sc1.EightySixScreen, null),
  temps: () => /*#__PURE__*/React.createElement(Sc1.TempLogScreen, null),
  inventory: () => /*#__PURE__*/React.createElement(Sc1.InventoryScreen, null),
  recipes: () => /*#__PURE__*/React.createElement(Sc1.RecipesScreen, null),
  beo: () => /*#__PURE__*/React.createElement(Sc1.BeoScreen, null),
  prep: () => /*#__PURE__*/React.createElement(S2.PrepScreen, null),
  specials: () => /*#__PURE__*/React.createElement(S2.SpecialsScreen, null),
  kds: () => /*#__PURE__*/React.createElement(S2.KdsScreen, null),
  cooling: () => /*#__PURE__*/React.createElement(S2.CoolingScreen, null),
  cleaning: () => /*#__PURE__*/React.createElement(S2.CleaningScreen, null),
  sanitizer: () => /*#__PURE__*/React.createElement(S2.SanitizerScreen, null),
  orderguide: () => /*#__PURE__*/React.createElement(S2.OrderGuideScreen, null),
  receiving: () => /*#__PURE__*/React.createElement(S2.ReceivingScreen, null),
  costing: () => /*#__PURE__*/React.createElement(S2.CostingScreen, null),
  tippool: () => /*#__PURE__*/React.createElement(S2.TipPoolScreen, null),
  breaks: () => /*#__PURE__*/React.createElement(S2.BreaksScreen, null),
  sick: () => /*#__PURE__*/React.createElement(S2.SickLeaveScreen, null),
  wage: () => /*#__PURE__*/React.createElement(S2.WageNoticeScreen, null),
  reviews: () => /*#__PURE__*/React.createElement(S2.ReviewsScreen, null),
  certs: () => /*#__PURE__*/React.createElement(S2.CertsScreen, null),
  goldstars: () => /*#__PURE__*/React.createElement(S2.GoldStarsScreen, null),
  audit: () => /*#__PURE__*/React.createElement(S2.AuditScreen, null),
  host: () => /*#__PURE__*/React.createElement(S2.HostStandScreen, null),
  floor: () => /*#__PURE__*/React.createElement(S2.FloorScreen, null),
  resos: () => /*#__PURE__*/React.createElement(S2.ReservationsScreen, null),
  bar: () => /*#__PURE__*/React.createElement(S2.BarScreen, null),
  tonight: () => /*#__PURE__*/React.createElement(S2.TonightScreen, null),
  stage: () => /*#__PURE__*/React.createElement(S2.StageScreen, null),
  sound: () => /*#__PURE__*/React.createElement(S2.SoundScreen, null),
  boxoffice: () => /*#__PURE__*/React.createElement(S2.BoxOfficeScreen, null),
  settlement: () => /*#__PURE__*/React.createElement(S2.SettlementScreen, null),
  'station:saute': () => /*#__PURE__*/React.createElement(Sc1.StationScreen, {
    id: "saute"
  }),
  'station:grill': () => /*#__PURE__*/React.createElement(Sc1.StationScreen, {
    id: "grill"
  }),
  'station:sauce': () => /*#__PURE__*/React.createElement(Sc1.StationScreen, {
    id: "sauce"
  })
};

/* ── Sheet → full-board bridge (A1 → A2 promote) ── */
const SHEET_BOARD = {
  temps: 'temps',
  fire: 'beo',
  eightysix: 'eighty-six',
  breaks: 'breaks',
  stage: 'stage',
  linecheck: 'station:saute',
  prepsheet: 'prep',
  cooling: 'cooling',
  datemarks: 'cooling',
  sidework: 'cleaning',
  invoices: 'costing',
  playbook: 'tonight',
  offers: 'tonight',
  soundcheck: 'sound',
  spllog: 'sound',
  avx: 'stage'
};

/* ── Atlas documentation — one line per board, kitchen voice ── */
const DOCS = {
  today: "The rush home — this is the line itself. Takes you back down.",
  'eighty-six': "What's out right now. Add it the second it dies.",
  prep: "What to make, how much, by when.",
  specials: "Tonight's features and their counts.",
  'station:saute': "Line check + sign-off — Sauté.",
  'station:grill': "Line check + sign-off — Grill.",
  'station:sauce': "Line check + sign-off — Sauce.",
  kds: "Expo tickets by age.",
  host: "Seat, quote, page.",
  floor: "The room live — tables by state.",
  resos: "The book — covers by block, pre-show flags.",
  bar: "Bottles, kegs, prep vs par.",
  recipes: "Scale, allergens, method — the book.",
  beo: "Banquet sheets — prep, fire, demands.",
  orderguide: "What to order, by vendor. Prints.",
  temps: "CCP holds — log every check.",
  cooling: "Two-stage cooling logs.",
  cleaning: "Side work by area and frequency.",
  sanitizer: "Wells at 200 ppm, logged.",
  inventory: "Stock vs par with fill bars.",
  receiving: "At the door — reject over 41°.",
  costing: "Plate cost vs menu price.",
  tippool: "The split — hours × points.",
  breaks: "Rest + meal clocks.",
  sick: "Balances — accrued, used, left.",
  wage: "Rate notices on file.",
  reviews: "Who's due, who's overdue.",
  certs: "Food handler + ServSafe expiry.",
  goldstars: "Shout-outs. Give a star.",
  audit: "Every signed action. Read-only.",
  tonight: "Show night — doors, sets, curfew.",
  stage: "Room config + run of show.",
  sound: "Scenes + live SPL vs limit.",
  boxoffice: "Sold, scanned, at the door.",
  settlement: "The night's math — artist share. Prints."
};

/* Procedures — documentation that launches the actual run (role+phase). */
const PROCEDURES = [{
  id: 'opening',
  name: 'Open the line',
  doc: "7a — temps → sanitizer → line checks → mise → sign-off."
}, {
  id: 'service',
  name: 'Run service',
  doc: "6p — the heat queue. Fires, holds, 86s."
}, {
  id: 'closing',
  name: 'Close the line',
  doc: "11p — TPHC → cooling → date marks → side work."
}];
function findCrumb(id) {
  for (const d of DIVISIONS) for (const s of d.sections) {
    const b = s.boards.find(x => x.id === id);
    if (b) return {
      div: d,
      sec: s,
      b
    };
  }
  return null;
}
function AltitudeApp() {
  const [role, setRole] = React.useState('cook');
  const [phase, setPhase] = React.useState('service');
  const [theme, setTheme] = React.useState('iron');
  const [sheet, setSheet] = React.useState(null);
  const [board, setBoard] = React.useState(null);
  const [atlas, setAtlas] = React.useState(false);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [aq, setAq] = React.useState('');
  const [doneIds, setDone] = React.useState({});
  const [recent, setRecent] = React.useState([]);
  const SHEETS = {
    ...KITa.SHEETS,
    ...RR.EXTRA_SHEETS
  };
  const openBoard = id => {
    if (id === 'today') {
      // Today IS the line — A0. Descend all the way home.
      setBoard(null);
      setSheet(null);
      setAtlas(false);
      setPal(false);
      return;
    }
    if (!ROUTES[id]) return;
    setBoard(id);
    setSheet(null);
    setAtlas(false);
    setPal(false);
    setRecent(r => [id, ...r.filter(x => x !== id)].slice(0, 3));
  };
  React.useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPal(p => !p);
      }
      if (e.key === 'Escape') {
        if (pal) setPal(false);else if (atlas) setAtlas(false);else if (sheet) setSheet(null);else if (board) setBoard(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [pal, atlas, sheet, board]);

  /* role model (same engine as the Rail) */
  const cook = RR.COOK[phase];
  const spine = role === 'cook' ? cook.spine : role === 'office' ? RR.OFFICE.spine : role === 'booking' ? RR.BOOKING.spine : role === 'stage' ? RR.STAGE.spine : KITa.SPINE;
  const clock = role === 'cook' ? cook.clock : role === 'office' ? RR.OFFICE.clock : role === 'booking' ? RR.BOOKING.clock : role === 'stage' ? RR.STAGE.clock : 'Fri · 6:38p — RUSH';
  const spineLabel = role === 'office' ? 'The week' : role === 'booking' ? 'The season' : role === 'stage' ? 'Show day' : 'The service day';
  let cards,
    qTitle,
    qSub,
    run = null;
  if (role === 'cook') {
    const steps = cook.steps.filter(s => !doneIds[s.id] && !s.done);
    const total = cook.steps.length,
      done = total - steps.length;
    cards = steps;
    qTitle = cook.label;
    qSub = phase === 'service' ? `${steps.length} open · cook line only` : `step ${Math.min(done + 1, total)} of ${total}`;
    run = phase === 'service' ? null : {
      done,
      total
    };
  } else if (role === 'manager') {
    cards = KITa.QUEUE.filter(c => !doneIds[c.id]);
    qTitle = 'Needs a human';
    qSub = `${cards.length} open · whole house`;
  } else if (role === 'booking') {
    cards = RR.BOOKING.work.filter(c => !doneIds[c.id]);
    qTitle = 'The pipeline';
    qSub = `${cards.length} open · holds, on-sales, announces`;
  } else if (role === 'stage') {
    cards = RR.STAGE.work.filter(c => !doneIds[c.id]);
    qTitle = 'The board';
    qSub = `${cards.length} open · sound, stage, AVX`;
  } else {
    cards = RR.OFFICE.work.filter(c => !doneIds[c.id]);
    qTitle = 'The workbench';
    qSub = `${cards.length} open · deadlines, not clocks`;
  }
  const quiet = role === 'office' ? ['Payroll draft balanced', 'All certs current except Kai (flagged)', 'Cloud bridge synced 4:02p'] : role === 'booking' ? RR.BOOKING.quiet : role === 'stage' ? RR.STAGE.quiet : KITa.QUIET;

  /* ⌘K — every board + procedure + quick action */
  const PAL_ALL = [...DIVISIONS.flatMap(d => d.sections.flatMap(s => s.boards.map(b => ({
    k: d.name,
    w: b.name,
    go: () => openBoard(b.id)
  })))), ...PROCEDURES.map(p => ({
    k: 'Run',
    w: p.name,
    go: () => {
      setRole('cook');
      setPhase(p.id);
      setAtlas(false);
      setBoard(null);
      setPal(false);
    }
  })), ...KITa.PALETTE.filter(r => r.k === 'Do').map(r => ({
    k: 'Do',
    w: r.w,
    go: () => {
      setSheet(r.sheet);
      setPal(false);
    }
  })), {
    k: 'Map',
    w: 'The Atlas — every board, documented',
    go: () => {
      setAtlas(true);
      setPal(false);
    }
  }, {
    k: 'Set',
    w: 'Settings — this screen & house rules',
    go: () => {
      setSheet('settings');
      setPal(false);
    }
  }];
  const crumb = board ? findCrumb(board) : null;
  const Board = board ? ROUTES[board] : null;
  const Sh = sheet && sheet !== 'settings' ? SHEETS[sheet] : null;
  const mark = id => setDone(d => ({
    ...d,
    [id]: true
  }));
  const atlasMatch = b => !aq || b.name.toLowerCase().includes(aq.toLowerCase()) || (DOCS[b.id] || '').toLowerCase().includes(aq.toLowerCase());
  return /*#__PURE__*/React.createElement("div", {
    className: `rail-app ${theme === 'iron' ? 'iron' : ''}`
  }, /*#__PURE__*/React.createElement("header", {
    className: "rl-band"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mark"
  }, /*#__PURE__*/React.createElement(MarkA, {
    decorative: true
  }), /*#__PURE__*/React.createElement("span", null, "The Lariat")), /*#__PURE__*/React.createElement("span", {
    className: "rl-role"
  }, [['cook', 'Cook'], ['manager', 'Mgr'], ['office', 'Office'], ['booking', 'Booking'], ['stage', 'Stage']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: role === k ? 'on' : '',
    onClick: () => {
      setRole(k);
      setSheet(null);
      setBoard(null);
    }
  }, l))), role === 'cook' && /*#__PURE__*/React.createElement("span", {
    className: "rl-phase"
  }, [['opening', '7a'], ['service', '6p'], ['closing', '11p']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: phase === k ? 'on' : '',
    onClick: () => {
      setPhase(k);
      setSheet(null);
    },
    title: "Simulate the clock"
  }, l))), (role === 'cook' || role === 'manager') && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat hot"
  }, /*#__PURE__*/React.createElement("b", null, "3"), " 86'd"), role === 'stage' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "96"), " dB \xB7 lim 100"), role === 'booking' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "212"), "/240 tonight"), /*#__PURE__*/React.createElement("span", {
    className: "clock"
  }, clock), /*#__PURE__*/React.createElement("button", {
    className: `rl-kbd alt-atlasbtn ${atlas ? 'on' : ''}`,
    onClick: () => setAtlas(!atlas),
    title: "The Atlas \u2014 every board, documented"
  }, "Atlas"), /*#__PURE__*/React.createElement("button", {
    className: "rl-kbd",
    onClick: () => setSheet('settings'),
    title: "Settings"
  }, "\u2699"), /*#__PURE__*/React.createElement("button", {
    className: "rl-kbd",
    onClick: () => setPal(true)
  }, "\u2318K")), /*#__PURE__*/React.createElement("nav", {
    className: "rl-spine"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, spineLabel), /*#__PURE__*/React.createElement("div", {
    className: "rl-track"
  }, spine.map((s, i) => s.t === 'NOW' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rl-now"
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    className: `rl-t ${s.state}`,
    onClick: () => s.sheet && setSheet(s.sheet)
  }, /*#__PURE__*/React.createElement("span", {
    className: "tt"
  }, s.t), /*#__PURE__*/React.createElement("span", {
    className: "tw"
  }, s.w))))), /*#__PURE__*/React.createElement("main", {
    className: "rl-queue"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-qhead"
  }, /*#__PURE__*/React.createElement("h1", null, qTitle), /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, qSub)), run && /*#__PURE__*/React.createElement("div", {
    className: "rl-run"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rt"
  }, cook.label), /*#__PURE__*/React.createElement("span", {
    className: "track"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${run.done / run.total * 100}%`
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "rn"
  }, run.done, "/", run.total, " done")), cards.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "rl-done"
  }, /*#__PURE__*/React.createElement("b", null, role === 'cook' ? phase === 'closing' ? 'Line is closed.' : 'Line is open.' : 'All clear.'), role === 'cook' ? 'Get a manager sign-off and clock out.' : 'Nothing needs you right now.'), cards.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    className: `rl-card ${c.sev || ''} ${c.up || role === 'cook' && phase !== 'service' && i === 0 ? 'up' : ''}`
  }, role === 'cook' && phase !== 'service' && /*#__PURE__*/React.createElement("span", {
    className: "step"
  }, cook.steps.findIndex(s => s.id === c.id) + 1), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, c.t), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, c.s)), /*#__PURE__*/React.createElement("span", {
    className: "src"
  }, c.src), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, c.sheet && /*#__PURE__*/React.createElement(Ba, {
    size: "xs",
    variant: "ghost",
    onClick: () => setSheet(c.sheet)
  }, "Open"), c.acts ? c.acts.map(([label, target], j) => /*#__PURE__*/React.createElement(Ba, {
    key: label,
    size: "xs",
    variant: j === 0 ? c.sev === 'crit' ? 'danger' : 'primary' : 'ghost',
    onClick: () => {
      if (target) setSheet(target);else mark(c.id);
    }
  }, label)) : /*#__PURE__*/React.createElement(Ba, {
    size: "xs",
    variant: "primary",
    onClick: () => mark(c.id)
  }, "Done"), c.acts && /*#__PURE__*/React.createElement(Ba, {
    size: "xs",
    variant: "ghost",
    onClick: () => mark(c.id)
  }, "Done")))), role === 'manager' && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-quiet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh"
  }, "Needs your PIN")), RR.APPROVALS.filter(a => !doneIds[a.id]).map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "rl-card rl-approve"
  }, /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, a.t), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, a.s)), /*#__PURE__*/React.createElement("span", {
    className: "pin"
  }, "PIN"), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, /*#__PURE__*/React.createElement(Ba, {
    size: "xs",
    variant: "primary",
    onClick: () => mark(a.id)
  }, "Approve"), /*#__PURE__*/React.createElement(Ba, {
    size: "xs",
    variant: "ghost",
    onClick: () => mark(a.id)
  }, "Deny"))))), /*#__PURE__*/React.createElement("div", {
    className: "rl-quiet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh"
  }, "Quiet \u2014 no action needed"), quiet.map(w => /*#__PURE__*/React.createElement("div", {
    key: w,
    className: "qrow"
  }, /*#__PURE__*/React.createElement(Da, {
    tone: "ok",
    size: 7
  }), w)))), Board && crumb && /*#__PURE__*/React.createElement("section", {
    className: "alt-dock"
  }, /*#__PURE__*/React.createElement("div", {
    className: "alt-return"
  }, /*#__PURE__*/React.createElement("button", {
    className: "alt-back",
    onClick: () => setBoard(null)
  }, "\u2190 The line", cards.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, cards.length, " need you")), /*#__PURE__*/React.createElement("span", {
    className: "alt-crumb"
  }, crumb.div.name, /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u203A"), crumb.sec.name, /*#__PURE__*/React.createElement("span", {
    className: "sep"
  }, "\u203A"), /*#__PURE__*/React.createElement("span", {
    className: "here"
  }, crumb.b.name)), /*#__PURE__*/React.createElement("span", {
    className: "alt-recent"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "Recent"), recent.map(id => {
    const c = findCrumb(id);
    return c && /*#__PURE__*/React.createElement("button", {
      key: id,
      className: `alt-rtab ${id === board ? 'on' : ''}`,
      onClick: () => openBoard(id)
    }, c.b.name);
  }))), /*#__PURE__*/React.createElement("div", {
    className: "alt-boardwrap"
  }, /*#__PURE__*/React.createElement(Board, null))), sheet === 'settings' ? /*#__PURE__*/React.createElement("aside", {
    className: "rl-sheet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sh-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, "Settings"), /*#__PURE__*/React.createElement(Ta, null, "esc"), /*#__PURE__*/React.createElement("button", {
    className: "rl-x",
    onClick: () => setSheet(null)
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "sh-body"
  }, /*#__PURE__*/React.createElement(RR.SettingsSheet, {
    theme: theme,
    setTheme: setTheme,
    role: role,
    setRole: setRole
  }))) : Sh && /*#__PURE__*/React.createElement("aside", {
    className: "rl-sheet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sh-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, Sh.title), SHEET_BOARD[sheet] && ROUTES[SHEET_BOARD[sheet]] && /*#__PURE__*/React.createElement("button", {
    className: "alt-promote",
    onClick: () => openBoard(SHEET_BOARD[sheet]),
    title: "Open the full board behind this sheet"
  }, "Full board \u2197"), /*#__PURE__*/React.createElement(Ta, null, "esc"), /*#__PURE__*/React.createElement("button", {
    className: "rl-x",
    onClick: () => setSheet(null)
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "sh-body"
  }, /*#__PURE__*/React.createElement(Sh.C, null))), atlas && /*#__PURE__*/React.createElement("section", {
    className: "alt-atlas"
  }, /*#__PURE__*/React.createElement("div", {
    className: "alt-atlas-head"
  }, /*#__PURE__*/React.createElement("h1", null, "The Atlas"), /*#__PURE__*/React.createElement("span", {
    className: "sub"
  }, "every board \xB7 one map \xB7 esc to descend"), /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Search boards + docs\u2026",
    value: aq,
    onChange: e => setAq(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    className: "alt-divgrid"
  }, DIVISIONS.map(d => {
    const secs = d.sections.map(s => ({
      ...s,
      boards: s.boards.filter(atlasMatch)
    })).filter(s => s.boards.length);
    const isLine = d.id === 'service';
    const procs = isLine ? PROCEDURES.filter(p => !aq || p.name.toLowerCase().includes(aq.toLowerCase()) || p.doc.toLowerCase().includes(aq.toLowerCase())) : [];
    if (!secs.length && !procs.length) return null;
    const count = d.sections.reduce((n, s) => n + s.boards.length, 0);
    return /*#__PURE__*/React.createElement("div", {
      key: d.id,
      className: "alt-div"
    }, /*#__PURE__*/React.createElement("div", {
      className: "alt-div-h"
    }, /*#__PURE__*/React.createElement("span", {
      className: "g"
    }, d.glyph), /*#__PURE__*/React.createElement("span", {
      className: "t"
    }, d.name), /*#__PURE__*/React.createElement("span", {
      className: "c"
    }, count, " boards")), secs.map(s => /*#__PURE__*/React.createElement("div", {
      key: s.name,
      className: "alt-sec"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sh"
    }, s.name), s.boards.map(b => /*#__PURE__*/React.createElement("button", {
      key: b.id,
      className: "alt-entry",
      onClick: () => openBoard(b.id)
    }, /*#__PURE__*/React.createElement("span", {
      className: "n"
    }, b.name), b.win && /*#__PURE__*/React.createElement("span", {
      className: "w"
    }, "\u29C9 WALL"), /*#__PURE__*/React.createElement("span", {
      className: "d"
    }, DOCS[b.id] || ''))))), procs.length > 0 && /*#__PURE__*/React.createElement("div", {
      className: "alt-sec"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sh"
    }, "Procedures"), procs.map(p => /*#__PURE__*/React.createElement("button", {
      key: p.id,
      className: "alt-entry",
      onClick: () => {
        setRole('cook');
        setPhase(p.id);
        setAtlas(false);
        setBoard(null);
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "n"
    }, p.name), /*#__PURE__*/React.createElement("span", {
      className: "p"
    }, "RUN"), /*#__PURE__*/React.createElement("span", {
      className: "d"
    }, p.doc)))), d.id === 'office' && /*#__PURE__*/React.createElement("div", {
      className: "alt-sec"
    }, /*#__PURE__*/React.createElement("div", {
      className: "sh"
    }, "House rules"), /*#__PURE__*/React.createElement("button", {
      className: "alt-entry",
      onClick: () => {
        setAtlas(false);
        setSheet('settings');
      }
    }, /*#__PURE__*/React.createElement("span", {
      className: "n"
    }, "Holds \xB7 breaks \xB7 tip split"), /*#__PURE__*/React.createElement("span", {
      className: "p"
    }, "PIN"), /*#__PURE__*/React.createElement("span", {
      className: "d"
    }, "The numbers the queue engine runs on."))));
  }))), pal && /*#__PURE__*/React.createElement("div", {
    className: "rl-veil",
    onClick: () => setPal(false)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-pal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Board, run, or thing to do \u2014 '86 trout', 'costing', 'open the line'\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  }), PAL_ALL.filter(r => r.w.toLowerCase().includes(q.toLowerCase())).slice(0, 9).map(r => /*#__PURE__*/React.createElement("div", {
    key: r.k + r.w,
    className: "row",
    onClick: r.go
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, r.k), r.w, /*#__PURE__*/React.createElement("span", {
    className: "hint"
  }, "\u21B5"))))));
}
window.AltitudeApp = AltitudeApp;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/altitude/Altitude.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit-v2/ScreensFront.jsx
try { (() => {
// Cockpit v2 — FOH + Shows boards: Host Stand (⧉), Floor Map, Reservations,
// Bar, Tonight, Box Office (⧉), Settlement (paper). Grounded in the real
// boards (HostStandView, FloorView, ReservationsBoardView, BarView,
// ShowsTonightView, ShowBoxOfficeView, ShowSettlementView).
const DSh = window.LariatLaRiOSDesignSystem_5761b2;
const {
  Button: Btn3,
  Pill: Pill3,
  Tag: Tag3,
  Kpi: Kpi3,
  Bar: Bar3,
  DataTable: Table3,
  Card: Card3,
  StatusDot: Dot3,
  Tabs: Tabs3
} = DSh;
const Head3 = window.BoardHead;

/* ── HOST STAND — runs on the host iPad (⧉) ── */
function HostStandScreen() {
  const waiting = [{
    id: 1,
    party: 'Whitfield · 4',
    quoted: '20 min',
    waited: '12 min',
    tone: 'ok'
  }, {
    id: 2,
    party: 'Chen · 2',
    quoted: '10 min',
    waited: '14 min',
    tone: 'alert'
  }, {
    id: 3,
    party: 'Okafor · 6',
    quoted: '35 min',
    waited: '8 min',
    tone: 'ok'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head3, {
    title: "Host",
    em: "stand",
    sub: "Runs on the host iPad as its own window (\u29C9). Waitlist, quotes, and seats."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi3, {
    label: "Waiting",
    value: "3",
    sub: "parties \xB7 12 covers"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Quoted now",
    value: "25m",
    sub: "4-top"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Open tables",
    value: "4",
    sub: "2 four-tops \xB7 2 two-tops"
  })), /*#__PURE__*/React.createElement(Card3, {
    title: "Waitlist",
    right: /*#__PURE__*/React.createElement(Btn3, {
      size: "sm",
      variant: "primary"
    }, "Add party"),
    padded: false
  }, /*#__PURE__*/React.createElement(Table3, {
    columns: [{
      key: 'party',
      label: 'Party'
    }, {
      key: 'quoted',
      label: 'Quoted',
      align: 'right'
    }, {
      key: 'waited',
      label: 'Waited',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: waiting.map(w => ({
      id: w.id,
      party: w.party,
      quoted: w.quoted,
      waited: /*#__PURE__*/React.createElement("span", {
        style: {
          color: w.tone === 'alert' ? 'var(--fire)' : 'var(--text)',
          fontWeight: 700
        }
      }, w.waited),
      act: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          gap: 6
        }
      }, /*#__PURE__*/React.createElement(Btn3, {
        size: "xs",
        variant: "ok"
      }, "Seat"), /*#__PURE__*/React.createElement(Btn3, {
        size: "xs",
        variant: "ghost"
      }, "Text"))
    }))
  })));
}

/* ── FLOOR MAP ── */
function FloorScreen() {
  const tables = [{
    t: 'T1',
    s: 'open'
  }, {
    t: 'T2',
    s: 'seated'
  }, {
    t: 'T3',
    s: 'entree'
  }, {
    t: 'T4',
    s: 'check'
  }, {
    t: 'T5',
    s: 'seated'
  }, {
    t: 'T6',
    s: 'entree'
  }, {
    t: 'T7',
    s: 'open'
  }, {
    t: 'T8',
    s: 'bussing'
  }, {
    t: 'T9',
    s: 'seated'
  }, {
    t: 'T10',
    s: 'open'
  }, {
    t: 'T11',
    s: 'check'
  }, {
    t: 'T12',
    s: 'open'
  }];
  const toneOf = {
    open: 'muted',
    seated: 'amber',
    entree: 'ok',
    check: 'warn',
    bussing: 'alert'
  };
  const colorOf = {
    open: 'var(--hair)',
    seated: 'var(--accent)',
    entree: 'var(--ok)',
    check: 'var(--metal)',
    bussing: 'var(--fire)'
  };
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head3, {
    title: "Floor,",
    em: "right now",
    sub: "Table states across the main room. Amber = seated, sage = entr\xE9es out, brass = check dropped."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 12,
      marginBottom: 14,
      flexWrap: 'wrap'
    }
  }, Object.keys(toneOf).map(k => /*#__PURE__*/React.createElement("span", {
    key: k,
    style: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6,
      fontFamily: 'var(--mono)',
      fontSize: 9.5,
      letterSpacing: '.16em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      fontWeight: 700
    }
  }, /*#__PURE__*/React.createElement(Dot3, {
    tone: toneOf[k],
    size: 7
  }), k))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12
    }
  }, tables.map(x => /*#__PURE__*/React.createElement("div", {
    key: x.t,
    style: {
      border: '1px solid var(--hair)',
      borderTop: `3px solid ${colorOf[x.s]}`,
      borderRadius: 'var(--radius-sm)',
      background: 'var(--panel)',
      padding: '16px 14px',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--display)',
      fontSize: 20,
      color: 'var(--text)'
    }
  }, x.t), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 9.5,
      letterSpacing: '.16em',
      textTransform: 'uppercase',
      color: x.s === 'open' ? 'var(--text-muted)' : colorOf[x.s],
      fontWeight: 700
    }
  }, x.s)))));
}

/* ── RESERVATIONS ── */
function ReservationsScreen() {
  const rows = [{
    id: 1,
    at: '6:30p',
    block: 'Early',
    party: 'Okafor · 6',
    note: 'Anniversary — dessert comp',
    s: 'Seated',
    tone: 'ok'
  }, {
    id: 2,
    at: '7:00p',
    block: 'Early',
    party: 'Delgado · 2',
    note: 'Window seat req',
    s: 'Confirmed',
    tone: 'neutral'
  }, {
    id: 3,
    at: '7:15p',
    block: 'Pre-show',
    party: 'Bright · 8',
    note: 'Pre-show — needs check by 8:30',
    s: 'Confirmed',
    tone: 'warn'
  }, {
    id: 4,
    at: '7:30p',
    block: 'Pre-show',
    party: 'Nowak · 4',
    note: '—',
    s: 'No answer',
    tone: 'alert'
  }, {
    id: 5,
    at: '8:45p',
    block: 'Late',
    party: 'Late seating · 2',
    note: 'Bar OK',
    s: 'Confirmed',
    tone: 'neutral'
  }];
  const covers = rows.reduce((s, r) => s + parseInt(r.party.split('·')[1], 10), 0);
  const blocks = ['Early', 'Pre-show', 'Late'];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head3, {
    title: "Tonight's",
    em: "book",
    sub: "Covers by time. Pre-show parties get flagged so the kitchen can pace."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi3, {
    label: "Covers booked",
    value: covers,
    sub: `${rows.length} parties`
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Pre-show",
    value: "12",
    sub: "hard out by 8:30",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Unconfirmed",
    value: "1",
    sub: "no answer",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Largest party",
    value: "8",
    sub: "Bright \xB7 7:15p"
  })), blocks.map(b => {
    const list = rows.filter(r => r.block === b);
    if (!list.length) return null;
    return /*#__PURE__*/React.createElement("div", {
      key: b,
      style: {
        marginBottom: 16
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: 'flex',
        alignItems: 'baseline',
        gap: 10,
        marginBottom: 8
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'var(--display)',
        fontWeight: 700,
        fontSize: 16,
        color: 'var(--text)'
      }
    }, b), /*#__PURE__*/React.createElement("span", {
      className: "tnum",
      style: {
        fontFamily: 'var(--mono)',
        fontSize: 10,
        letterSpacing: '.16em',
        textTransform: 'uppercase',
        color: 'var(--text-muted)'
      }
    }, list.length, " ", list.length > 1 ? 'parties' : 'party')), /*#__PURE__*/React.createElement(Card3, {
      padded: false
    }, /*#__PURE__*/React.createElement(Table3, {
      columns: [{
        key: 'at',
        label: 'Time',
        align: 'right',
        width: 70
      }, {
        key: 'party',
        label: 'Party'
      }, {
        key: 'note',
        label: 'Notes'
      }, {
        key: 's',
        label: 'Status',
        align: 'right'
      }, {
        key: 'act',
        label: '',
        align: 'right'
      }],
      rows: list.map(r => ({
        id: r.id,
        at: r.at,
        party: r.party,
        note: /*#__PURE__*/React.createElement("span", {
          style: {
            color: 'var(--text-muted)'
          }
        }, r.note),
        s: /*#__PURE__*/React.createElement(Pill3, {
          tone: r.tone,
          dot: true
        }, r.s),
        act: r.s === 'Seated' ? /*#__PURE__*/React.createElement(Tag3, {
          dot: true,
          dotTone: "ok"
        }, "In") : /*#__PURE__*/React.createElement(Btn3, {
          size: "xs"
        }, "Seat")
      }))
    })));
  }));
}

/* ── BAR ── */
function BarScreen() {
  const rows = [{
    id: 1,
    item: 'Bourbon — house pour',
    kind: 'Bottle',
    par: 6,
    on: 2,
    tone: 'alert'
  }, {
    id: 2,
    item: 'Mezcal',
    kind: 'Bottle',
    par: 3,
    on: 3,
    tone: 'ok'
  }, {
    id: 3,
    item: 'House amaro',
    kind: 'Bottle',
    par: 4,
    on: 3,
    tone: 'ok'
  }, {
    id: 4,
    item: 'Lime — juiced, qt',
    kind: 'Prep',
    par: 4,
    on: 1,
    tone: 'alert'
  }, {
    id: 5,
    item: 'Draft — Elevation IPA',
    kind: 'Keg',
    par: 2,
    on: 1,
    tone: 'warn'
  }, {
    id: 6,
    item: 'Simple syrup, qt',
    kind: 'Prep',
    par: 3,
    on: 3,
    tone: 'ok'
  }];
  const low = rows.filter(r => r.tone !== 'ok').length;
  const [tab, setTab] = React.useState('all');
  const list = tab === 'all' ? rows : rows.filter(r => r.kind === tab);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head3, {
    title: "Bar",
    em: "par",
    sub: "Bottles, kegs, and prep against par. Pull from the cage before the rush."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi3, {
    label: "Below par",
    value: low,
    sub: "need a pull",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Cocktail prep",
    value: "1",
    sub: "juice running low",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Kegs",
    value: "1/2",
    sub: "IPA half gone",
    trend: "warn"
  })), /*#__PURE__*/React.createElement(Tabs3, {
    tabs: [{
      value: 'all',
      label: 'All'
    }, {
      value: 'Bottle',
      label: 'Bottles'
    }, {
      value: 'Keg',
      label: 'Kegs'
    }, {
      value: 'Prep',
      label: 'Prep'
    }],
    value: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 14
    }
  }), /*#__PURE__*/React.createElement(Card3, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table3, {
    columns: [{
      key: 'item',
      label: 'Item'
    }, {
      key: 'kind',
      label: 'Kind'
    }, {
      key: 'par',
      label: 'Par',
      align: 'right'
    }, {
      key: 'on',
      label: 'On hand',
      align: 'right'
    }, {
      key: 'fill',
      label: '',
      width: 110
    }, {
      key: 's',
      label: '',
      align: 'right'
    }],
    rows: list.map(r => ({
      id: r.id,
      item: r.item,
      kind: /*#__PURE__*/React.createElement(Tag3, null, r.kind),
      par: r.par,
      on: r.on,
      fill: /*#__PURE__*/React.createElement(Bar3, {
        value: r.on / r.par * 100,
        tone: r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'
      }),
      s: r.tone !== 'ok' ? /*#__PURE__*/React.createElement(Pill3, {
        tone: r.tone,
        dot: true
      }, r.tone === 'alert' ? 'Pull now' : 'Watch') : /*#__PURE__*/React.createElement(Tag3, {
        dot: true,
        dotTone: "ok"
      }, "OK")
    }))
  })));
}

/* ── SHOWS — TONIGHT ── */
function TonightScreen() {
  return /*#__PURE__*/React.createElement("div", {
    className: "k-night",
    style: {
      margin: -28,
      marginBottom: 0,
      padding: 28,
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement(Head3, {
    title: "Tonight \u2014",
    em: "Wrenfield & The Coyotes",
    sub: "Doors 7:00p \xB7 show 8:00p \xB7 Americana / two sets \xB7 room set: standing + rail seats"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi3, {
    label: "Sold",
    value: "212",
    sub: "of 240 cap",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Scanned in",
    value: "0",
    sub: "doors at 7:00p"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Door price",
    value: "$28",
    sub: "$24 advance"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Guest list",
    value: "14",
    sub: "band + comps"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Card3, {
    title: "Run of show"
  }, [['5:00p', 'Load-in + line check'], ['6:00p', 'Soundcheck — full band'], ['7:00p', 'Doors · playlist scene 2'], ['8:00p', 'Set one · 70 min'], ['9:20p', 'Set two · 60 min'], ['10:30p', 'Curfew — hard out']].map(([t, w]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: 'flex',
      gap: 14,
      padding: '7px 0',
      borderBottom: '1px solid var(--hair)',
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      color: 'var(--accent)',
      width: 52,
      textAlign: 'right',
      flexShrink: 0
    }
  }, t), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text)'
    }
  }, w)))), /*#__PURE__*/React.createElement(Card3, {
    title: "Room & sound"
  }, [['Room config', 'Standing + rail seats'], ['Latest scene', 'Doors — playlist 2, house at 40%'], ['Console', 'Recall: Coyotes v3'], ['Backline', 'House kit + 2 DIs'], ['Merch', 'Table by the coat check — band keeps 100%']].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      gap: 14,
      padding: '7px 0',
      borderBottom: '1px solid var(--hair)',
      fontSize: 13.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)'
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text)',
      textAlign: 'right'
    }
  }, v))))));
}

/* ── BOX OFFICE — runs at the door (⧉) ── */
function BoxOfficeScreen() {
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head3, {
    title: "Box",
    em: "office",
    sub: "Runs at the door as its own window (\u29C9). Scan, sell, comp."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi3, {
    label: "Scanned in",
    value: "148",
    sub: "of 212 sold",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Door sales",
    value: "$672",
    sub: "24 tickets"
  }), /*#__PURE__*/React.createElement(Kpi3, {
    label: "Comps used",
    value: "9",
    sub: "of 14 listed"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 10,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Btn3, {
    variant: "primary",
    size: "lg"
  }, "Sell at door \u2014 $28"), /*#__PURE__*/React.createElement(Btn3, {
    size: "lg"
  }, "Scan ticket"), /*#__PURE__*/React.createElement(Btn3, {
    variant: "ghost",
    size: "lg"
  }, "Guest list")), /*#__PURE__*/React.createElement(Card3, {
    title: "Last through the door",
    padded: false
  }, /*#__PURE__*/React.createElement(Table3, {
    columns: [{
      key: 'at',
      label: 'At',
      align: 'right',
      width: 70
    }, {
      key: 'who',
      label: 'Ticket'
    }, {
      key: 'kind',
      label: 'Kind'
    }, {
      key: 's',
      label: '',
      align: 'right'
    }],
    rows: [{
      id: 1,
      at: '7:41p',
      who: '#A1187 · advance',
      kind: /*#__PURE__*/React.createElement(Tag3, null, "Scan"),
      s: /*#__PURE__*/React.createElement(Pill3, {
        tone: "ok",
        dot: true
      }, "In")
    }, {
      id: 2,
      at: '7:40p',
      who: 'Door sale ×2',
      kind: /*#__PURE__*/React.createElement(Tag3, null, "Card"),
      s: /*#__PURE__*/React.createElement(Pill3, {
        tone: "ok",
        dot: true
      }, "In")
    }, {
      id: 3,
      at: '7:39p',
      who: '#A0962 · advance',
      kind: /*#__PURE__*/React.createElement(Tag3, null, "Scan"),
      s: /*#__PURE__*/React.createElement(Pill3, {
        tone: "alert",
        dot: true
      }, "Dupe")
    }, {
      id: 4,
      at: '7:37p',
      who: 'Guest — Wrenfield +1',
      kind: /*#__PURE__*/React.createElement(Tag3, null, "Comp"),
      s: /*#__PURE__*/React.createElement(Pill3, {
        tone: "ok",
        dot: true
      }, "In")
    }]
  })));
}

/* ── SETTLEMENT — paper money sheet ── */
function SettlementScreen() {
  const lines = [{
    c: 'Gross',
    item: 'Ticket sales — 212 × blend',
    v: '$5,512.00'
  }, {
    c: 'Less',
    item: 'Ticketing fees',
    v: '−$276.00'
  }, {
    c: 'Less',
    item: 'Venue expense — sound tech',
    v: '−$250.00'
  }, {
    c: 'Split',
    item: 'Artist 70% of net',
    v: '$3,490.20'
  }, {
    c: 'Split',
    item: 'House 30% of net',
    v: '$1,495.80'
  }, {
    c: 'Plus',
    item: 'Merch — house 0%',
    v: '$0.00'
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "paper ck-book"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bk-eyebrow"
  }, "Show settlement \xB7 Wrenfield & The Coyotes \xB7 Fri Nov 14"), /*#__PURE__*/React.createElement("h2", null, "Settlement ", /*#__PURE__*/React.createElement("em", null, "sheet")), /*#__PURE__*/React.createElement("div", {
    className: "bk-sub"
  }, "Signed by band + manager at close. Prints from this sheet."), /*#__PURE__*/React.createElement("div", null, lines.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "ck-beo-row",
    style: {
      gridTemplateColumns: '64px 1fr auto'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "c"
  }, r.c), /*#__PURE__*/React.createElement("span", null, r.item), /*#__PURE__*/React.createElement("span", {
    className: "qty",
    style: {
      fontWeight: 700
    }
  }, r.v)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-total"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tl"
  }, "Due to artist"), /*#__PURE__*/React.createElement("span", {
    className: "tv"
  }, "$3,490.20")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Btn3, {
    variant: "primary",
    style: {
      background: 'var(--copper)',
      borderColor: 'var(--copper)',
      color: '#fff8ec'
    }
  }, "Mark settled"), /*#__PURE__*/React.createElement(Btn3, {
    variant: "ghost"
  }, "Print sheet")));
}

/* ── STAGE — the stage manager's setup + run of show (k-night) ── */
function StageScreen() {
  const rooms = [{
    key: 'standing',
    name: 'Standing + rail',
    cap: 240,
    staff: 3,
    min: 25,
    best: 'Loud, full-band nights'
  }, {
    key: 'seated',
    name: 'Seated cabaret',
    cap: 120,
    staff: 5,
    min: 45,
    best: 'Songwriter / listening room'
  }, {
    key: 'mixed',
    name: 'Mixed — rail + hi-tops',
    cap: 180,
    staff: 4,
    min: 35,
    best: 'Americana, two sets'
  }];
  const [room, setRoom] = React.useState('mixed');
  const cfg = rooms.find(r => r.key === room);
  const run = [{
    t: '5:00p',
    w: 'Load-in + line check',
    done: true
  }, {
    t: '6:00p',
    w: 'Soundcheck — full band',
    done: true
  }, {
    t: '7:00p',
    w: 'Doors · playlist scene 2',
    done: false
  }, {
    t: '8:00p',
    w: 'Set one · 70 min',
    done: false
  }, {
    t: '9:20p',
    w: 'Set two · 60 min',
    done: false
  }, {
    t: '10:30p',
    w: 'Curfew — hard out',
    done: false
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "k-night",
    style: {
      margin: -28,
      padding: 28,
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement(Head3, {
    title: "Stage",
    em: "setup",
    sub: "Room config, changeover, and the run of show. Set once per show; the wall reads from it."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Card3, {
    title: "Room configuration"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, rooms.map(r => /*#__PURE__*/React.createElement("button", {
    key: r.key,
    onClick: () => setRoom(r.key),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px',
      background: room === r.key ? 'var(--panel-2)' : 'transparent',
      border: `1px solid ${room === r.key ? 'var(--accent)' : 'var(--hair)'}`,
      borderRadius: 'var(--radius-sm)',
      cursor: 'pointer',
      textAlign: 'left',
      color: 'var(--text)'
    }
  }, /*#__PURE__*/React.createElement(Dot3, {
    tone: room === r.key ? 'amber' : 'muted'
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--display)',
      fontWeight: 600,
      fontSize: 15
    }
  }, r.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11.5,
      color: 'var(--text-muted)'
    }
  }, r.best)), /*#__PURE__*/React.createElement("span", {
    className: "tnum",
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, "cap ", r.cap))))), /*#__PURE__*/React.createElement(Card3, {
    title: "Tonight \u2014 set"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(2,1fr)',
      gap: 12
    }
  }, [['Capacity', cfg.cap], ['Changeover', cfg.min + ' min'], ['Crew', cfg.staff + ' staff'], ['Config', cfg.name]].map(([k, v]) => /*#__PURE__*/React.createElement("div", {
    key: k
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--display)',
      fontSize: 22,
      color: 'var(--accent)',
      fontVariantNumeric: 'tabular-nums'
    }
  }, v), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 8.5,
      letterSpacing: '.2em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)',
      fontWeight: 700,
      marginTop: 3
    }
  }, k)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 14
    }
  }, /*#__PURE__*/React.createElement(Btn3, {
    variant: "primary"
  }, "Save setup")))), /*#__PURE__*/React.createElement(Card3, {
    title: "Run of show",
    right: /*#__PURE__*/React.createElement(Pill3, {
      tone: "ok",
      dot: true
    }, "2 done")
  }, run.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.t,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 14,
      padding: '8px 0',
      borderBottom: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement(Dot3, {
    tone: r.done ? 'ok' : 'muted',
    size: 9
  }), /*#__PURE__*/React.createElement("span", {
    className: "tnum",
    style: {
      fontFamily: 'var(--mono)',
      color: 'var(--accent)',
      width: 56,
      fontSize: 13
    }
  }, r.t), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      color: r.done ? 'var(--text-muted)' : 'var(--text)',
      textDecoration: r.done ? 'line-through' : 'none'
    }
  }, r.w), !r.done && /*#__PURE__*/React.createElement(Btn3, {
    size: "xs"
  }, "Mark")))));
}

/* ── SOUND — scenes + live SPL meter against the night's limit (k-night) ── */
function SoundScreen() {
  const scenes = [{
    n: 'Soundcheck',
    ch: 24,
    mon: 6,
    at: '6:02p',
    limit: 102
  }, {
    n: 'Set 1 — full band',
    ch: 24,
    mon: 6,
    at: '6:40p',
    limit: 100
  }, {
    n: 'Set 2 — encore',
    ch: 22,
    mon: 5,
    at: '6:41p',
    limit: 100
  }, {
    n: 'Doors / playlist',
    ch: 2,
    mon: 0,
    at: '5:30p',
    limit: 92
  }];
  const [live, setLive] = React.useState(96);
  const limit = 100;
  React.useEffect(() => {
    const t = setInterval(() => setLive(90 + Math.round(Math.random() * 14)), 1400);
    return () => clearInterval(t);
  }, []);
  const tone = live > limit ? 'alert' : live > limit - 4 ? 'warn' : 'ok';
  const color = tone === 'alert' ? 'var(--fire)' : tone === 'warn' ? 'var(--metal)' : 'var(--ok)';
  return /*#__PURE__*/React.createElement("div", {
    className: "k-night",
    style: {
      margin: -28,
      padding: 28,
      minHeight: '100%'
    }
  }, /*#__PURE__*/React.createElement(Head3, {
    title: "Sound",
    em: "scenes",
    sub: "Recall a saved scene, watch the room against tonight's SPL limit."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: '1fr 1.3fr',
      gap: 12,
      marginBottom: 12
    }
  }, /*#__PURE__*/React.createElement(Card3, {
    title: "Live SPL"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--display)',
      fontWeight: 700,
      fontSize: 52,
      color,
      fontVariantNumeric: 'tabular-nums',
      lineHeight: 1
    }
  }, live), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 13,
      color: 'var(--text-muted)'
    }
  }, "dB(A)"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto'
    }
  }, /*#__PURE__*/React.createElement(Pill3, {
    tone: tone,
    dot: true
  }, tone === 'alert' ? 'Over limit' : tone === 'warn' ? 'Near limit' : 'In range'))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(Bar3, {
    value: live / 110 * 100,
    tone: tone,
    height: 8
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      marginTop: 6,
      fontFamily: 'var(--mono)',
      fontSize: 10,
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", null, "60"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--accent)'
    }
  }, "limit ", limit), /*#__PURE__*/React.createElement("span", null, "110"))), /*#__PURE__*/React.createElement(Card3, {
    title: "Scenes",
    right: /*#__PURE__*/React.createElement(Btn3, {
      size: "sm",
      variant: "primary"
    }, "Save scene"),
    padded: false
  }, /*#__PURE__*/React.createElement(Table3, {
    columns: [{
      key: 'n',
      label: 'Scene'
    }, {
      key: 'plot',
      label: 'Plot'
    }, {
      key: 'lim',
      label: 'Limit',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: scenes.map((s, i) => ({
      id: i,
      n: s.n,
      plot: /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: 'var(--mono)',
          fontSize: 11,
          color: 'var(--text-muted)'
        }
      }, s.ch, " ch \xB7 ", s.mon, " mon"),
      lim: /*#__PURE__*/React.createElement("span", {
        className: "tnum"
      }, s.limit, " dB"),
      act: /*#__PURE__*/React.createElement(Btn3, {
        size: "xs"
      }, "Recall")
    }))
  }))), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-note",
    style: {
      borderColor: 'var(--accent)',
      color: 'var(--text-muted)'
    }
  }, "SPL polls every few seconds. Over the limit two readings running arms the warn light at the board \u2014 pull the mains, don't ride it."));
}
window.Screens2 = Object.assign(window.Screens2 || {}, {
  HostStandScreen,
  FloorScreen,
  ReservationsScreen,
  BarScreen,
  TonightScreen,
  BoxOfficeScreen,
  SettlementScreen,
  StageScreen,
  SoundScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit-v2/ScreensFront.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit-v2/ScreensHr.jsx
try { (() => {
// Cockpit v2 — People / HR boards: Sick Leave, Wage Notices, Reviews,
// Gold Stars. Grounded in the real boards (SickLeaveView, WageNoticeView,
// PerformanceReviewsView, GoldStarsView). Kitchen-native copy.
const DSp = window.LariatLaRiOSDesignSystem_5761b2;
const {
  Button: Bp,
  Pill: Pp,
  Tag: Tp,
  Kpi: Kp,
  Bar: Barp,
  DataTable: Tp2,
  Card: Cp,
  Avatar: Avp,
  Field: Fp,
  Input: Ip,
  Select: Sp
} = DSp;
const HeadP = window.BoardHead;

/* ── SICK LEAVE — balances; add / use hours ── */
function SickLeaveScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    accrued: 40,
    used: 16,
    bal: 24
  }, {
    id: 2,
    who: 'Dev Tran',
    accrued: 32,
    used: 32,
    bal: 0
  }, {
    id: 3,
    who: 'Kai Ostrander',
    accrued: 40,
    used: 8,
    bal: 32
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    accrued: 24,
    used: 6,
    bal: 18
  }];
  const [who, setWho] = React.useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HeadP, {
    title: "Sick",
    em: "leave",
    sub: "Paid sick balances \u2014 accrued, used, and left. Log add or use against a name."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kp, {
    label: "On the books",
    value: "74h",
    sub: "paid sick, all staff"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "Used YTD",
    value: "62h",
    sub: "this location"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "At zero",
    value: "1",
    sub: "staff with no balance",
    trend: "warn"
  })), /*#__PURE__*/React.createElement("div", {
    className: "ck-toolbar"
  }, /*#__PURE__*/React.createElement(Fp, {
    label: "Staff"
  }, /*#__PURE__*/React.createElement(Sp, {
    value: who,
    onChange: e => setWho(e.target.value),
    style: {
      width: 180
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "\u2014 pick \u2014"), rows.map(r => /*#__PURE__*/React.createElement("option", {
    key: r.id
  }, r.who)))), /*#__PURE__*/React.createElement(Fp, {
    label: "Hours"
  }, /*#__PURE__*/React.createElement(Ip, {
    placeholder: "0.0",
    style: {
      width: 90
    }
  })), /*#__PURE__*/React.createElement(Fp, {
    label: "Kind"
  }, /*#__PURE__*/React.createElement(Sp, {
    style: {
      width: 130
    }
  }, /*#__PURE__*/React.createElement("option", null, "Add hours"), /*#__PURE__*/React.createElement("option", null, "Use hours"))), /*#__PURE__*/React.createElement(Bp, {
    variant: "primary"
  }, "Log")), /*#__PURE__*/React.createElement(Cp, {
    padded: false
  }, /*#__PURE__*/React.createElement(Tp2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'accrued',
      label: 'Accrued',
      align: 'right'
    }, {
      key: 'used',
      label: 'Used',
      align: 'right'
    }, {
      key: 'bar',
      label: '',
      width: 120
    }, {
      key: 'bal',
      label: 'Balance',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avp, {
        name: r.who,
        size: "sm"
      }), r.who),
      accrued: r.accrued + 'h',
      used: r.used + 'h',
      bar: /*#__PURE__*/React.createElement(Barp, {
        value: r.bal / r.accrued * 100,
        tone: r.bal === 0 ? 'alert' : r.bal < 12 ? 'warn' : 'ok'
      }),
      bal: /*#__PURE__*/React.createElement("span", {
        style: {
          color: r.bal === 0 ? 'var(--fire)' : 'var(--text)',
          fontWeight: 700
        }
      }, r.bal, "h")
    }))
  })));
}

/* ── WAGE NOTICES — labor-law notices on file (needs new / current) ── */
function WageNoticeScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    rate: '$18.50/hr',
    signed: 'Apr 2026',
    s: 'Current',
    tone: 'ok'
  }, {
    id: 2,
    who: 'Dev Tran',
    rate: '$16.00/hr + tips',
    signed: '— rate changed',
    s: 'Needs new',
    tone: 'alert'
  }, {
    id: 3,
    who: 'Kai Ostrander',
    rate: '$21.00/hr',
    signed: 'Jan 2026',
    s: 'Current',
    tone: 'ok'
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    rate: '$15.50/hr + tips',
    signed: 'New hire',
    s: 'Needs new',
    tone: 'alert'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HeadP, {
    title: "Wage",
    em: "notices",
    sub: "Signed pay-rate notices on file. A rate change means a new notice is owed."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kp, {
    label: "On file",
    value: "2",
    sub: "current + signed",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "Needs new",
    value: "2",
    sub: "rate change / new hire",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "Oldest",
    value: "Jan 2026",
    sub: "Kai O."
  })), /*#__PURE__*/React.createElement(Cp, {
    padded: false
  }, /*#__PURE__*/React.createElement(Tp2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'rate',
      label: 'Rate'
    }, {
      key: 'signed',
      label: 'Last signed',
      align: 'right'
    }, {
      key: 's',
      label: 'Status',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avp, {
        name: r.who,
        size: "sm"
      }), r.who),
      rate: /*#__PURE__*/React.createElement("span", {
        className: "tnum"
      }, r.rate),
      signed: r.signed,
      s: /*#__PURE__*/React.createElement(Pp, {
        tone: r.tone,
        dot: true
      }, r.s),
      act: r.tone === 'alert' ? /*#__PURE__*/React.createElement(Bp, {
        size: "xs",
        variant: "primary"
      }, "Issue notice") : /*#__PURE__*/React.createElement(Tp, {
        dot: true,
        dotTone: "ok"
      }, "On file")
    }))
  })));
}

/* ── REVIEWS — performance reviews due / done ── */
function ReviewsScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    role: 'Line lead',
    due: 'Overdue',
    last: 'Aug 2025',
    tone: 'alert'
  }, {
    id: 2,
    who: 'Dev Tran',
    role: 'Line cook',
    due: 'This month',
    last: 'Feb 2026',
    tone: 'warn'
  }, {
    id: 3,
    who: 'Kai Ostrander',
    role: 'Bar lead',
    due: 'Q1 2027',
    last: 'Mar 2026',
    tone: 'ok'
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    role: '90-day',
    due: 'Dec 8',
    last: 'New hire',
    tone: 'warn'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HeadP, {
    title: "Performance",
    em: "reviews",
    sub: "Who's up for a review and when they last had one."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kp, {
    label: "Overdue",
    value: "1",
    sub: "review late",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "This month",
    value: "2",
    sub: "coming up",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kp, {
    label: "Done, 90 days",
    value: "3",
    sub: "on schedule",
    trend: "up"
  })), /*#__PURE__*/React.createElement(Cp, {
    padded: false
  }, /*#__PURE__*/React.createElement(Tp2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'role',
      label: 'Role'
    }, {
      key: 'last',
      label: 'Last review',
      align: 'right'
    }, {
      key: 'due',
      label: 'Next due',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Avp, {
        name: r.who,
        size: "sm"
      }), r.who),
      role: /*#__PURE__*/React.createElement(Tp, null, r.role),
      last: r.last,
      due: /*#__PURE__*/React.createElement(Pp, {
        tone: r.tone,
        dot: true
      }, r.due),
      act: /*#__PURE__*/React.createElement(Bp, {
        size: "xs"
      }, "Start")
    }))
  })));
}

/* ── GOLD STARS — cook recognition ── */
function GoldStarsScreen() {
  const board = [{
    who: 'Rosa Mendez',
    stars: 12,
    why: 'Caught a temp fail before service'
  }, {
    who: 'Kai Ostrander',
    stars: 9,
    why: 'Covered a double, no complaints'
  }, {
    who: 'Dev Tran',
    stars: 7,
    why: 'Zero flagged line checks this month'
  }, {
    who: 'Marta Ibáñez',
    stars: 5,
    why: 'Fastest walk-in count on record'
  }];
  const [who, setWho] = React.useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(HeadP, {
    title: "Gold",
    em: "stars",
    sub: "Shout-outs for good work. Give a star, say why."
  }), /*#__PURE__*/React.createElement("div", {
    className: "ck-toolbar"
  }, /*#__PURE__*/React.createElement(Fp, {
    label: "Give a star to"
  }, /*#__PURE__*/React.createElement(Sp, {
    value: who,
    onChange: e => setWho(e.target.value),
    style: {
      width: 180
    }
  }, /*#__PURE__*/React.createElement("option", {
    value: ""
  }, "Pick a cook\u2026"), board.map(b => /*#__PURE__*/React.createElement("option", {
    key: b.who
  }, b.who)))), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement(Fp, {
    label: "Why"
  }, /*#__PURE__*/React.createElement(Ip, {
    placeholder: "e.g. Saved the sauce during the rush"
  }))), /*#__PURE__*/React.createElement(Bp, {
    variant: "primary"
  }, "\u2605 Give star")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(260px,1fr))',
      gap: 12
    }
  }, board.map((b, i) => /*#__PURE__*/React.createElement(Cp, {
    key: b.who
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement(Avp, {
    name: b.who
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 700,
      color: 'var(--text)'
    }
  }, b.who), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 10,
      color: 'var(--text-muted)',
      letterSpacing: '.1em'
    }
  }, i === 0 ? 'TOP OF THE BOARD' : `#${i + 1}`)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--display)',
      fontSize: 22,
      color: 'var(--accent)'
    }
  }, "\u2605 ", b.stars)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12.5,
      color: 'var(--text-muted)',
      fontFamily: 'var(--sans)'
    }
  }, "\"", b.why, "\"")))));
}
window.Screens2 = Object.assign(window.Screens2 || {}, {
  SickLeaveScreen,
  WageNoticeScreen,
  ReviewsScreen,
  GoldStarsScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit-v2/ScreensHr.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit-v2/ScreensOffice.jsx
try { (() => {
// Cockpit v2 — Office boards: Order Guide (paper ⧉), Receiving, Costing,
// Tip Pool, Breaks & Leave, Staff Certs, Audit Log. Grounded in the real
// boards (PurchasingOrderGuideView, ReceivingView, CostingView, TipPoolView,
// BreakBoardView, StaffCertsView, AuditLogView).
const DSf = window.LariatLaRiOSDesignSystem_5761b2;
const {
  Button: Btn2,
  Pill: Pill2,
  Tag: Tag2,
  Kpi: Kpi2,
  Bar: Bar2,
  DataTable: Table2,
  Card: Card2,
  Avatar: Av2,
  Field,
  Input: Inp,
  Select: Sel,
  Tabs: Tabs2
} = DSf;
const Head2 = window.BoardHead;

/* ── ORDER GUIDE — a paper sheet, copper implement; opens as its own window ── */
function OrderGuideScreen() {
  const rows = [{
    v: 'Shamrock',
    item: 'Ribeye, whole boneless',
    pack: '2× ~9lb',
    par: 4,
    order: 3,
    px: '$11.42/lb'
  }, {
    v: 'Shamrock',
    item: 'Trout, PNW farmed',
    pack: '10lb case',
    par: 3,
    order: 2,
    px: '$8.90/lb'
  }, {
    v: 'Sysco',
    item: 'Butter, unsalted 36ct',
    pack: 'case',
    par: 2,
    order: 1,
    px: '$118.20'
  }, {
    v: 'Sysco',
    item: 'Flour, AP 50lb',
    pack: 'bag',
    par: 3,
    order: 0,
    px: '$21.85'
  }, {
    v: 'WebstaurantStore',
    item: 'Deli containers, 32oz',
    pack: '240ct',
    par: 1,
    order: 1,
    px: '$64.99'
  }];
  return /*#__PURE__*/React.createElement("div", {
    className: "paper ck-book"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bk-eyebrow"
  }, "Purchasing \xB7 order guide \xB7 week of Nov 17"), /*#__PURE__*/React.createElement("h2", null, "Order ", /*#__PURE__*/React.createElement("em", null, "guide")), /*#__PURE__*/React.createElement("div", {
    className: "bk-sub"
  }, "Par against on-hand, by vendor. Prints as the call sheet. Opens as its own window (\u29C9)."), /*#__PURE__*/React.createElement("div", null, rows.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "ck-beo-row",
    style: {
      gridTemplateColumns: '120px 1fr 90px 110px 90px'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "c"
  }, r.v), /*#__PURE__*/React.createElement("span", null, r.item, " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: 12
    }
  }, "\xB7 ", r.pack)), /*#__PURE__*/React.createElement("span", {
    className: "qty"
  }, "par ", r.par), /*#__PURE__*/React.createElement("span", {
    className: "qty",
    style: {
      color: r.order > 0 ? 'var(--copper-deep)' : 'var(--text-muted)',
      fontWeight: 700
    }
  }, "order ", r.order), /*#__PURE__*/React.createElement("span", {
    className: "fire"
  }, r.px)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-total"
  }, /*#__PURE__*/React.createElement("span", {
    className: "tl"
  }, "This order \xB7 est."), /*#__PURE__*/React.createElement("span", {
    className: "tv"
  }, "$1,486.30")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Btn2, {
    variant: "primary",
    style: {
      background: 'var(--copper)',
      borderColor: 'var(--copper)',
      color: '#fff8ec'
    }
  }, "Send orders"), /*#__PURE__*/React.createElement(Btn2, {
    variant: "ghost"
  }, "Print sheet")));
}

/* ── RECEIVING ── */
function ReceivingScreen() {
  const rows = [{
    id: 1,
    v: 'Shamrock',
    item: 'Trout, 10lb case ×2',
    temp: '36°F',
    pkg: 'OK',
    tone: 'ok',
    s: 'Accepted'
  }, {
    id: 2,
    v: 'Shamrock',
    item: 'Ribeye, whole ×2',
    temp: '39°F',
    pkg: 'OK',
    tone: 'ok',
    s: 'Accepted'
  }, {
    id: 3,
    v: 'Sysco',
    item: 'Dairy — mixed',
    temp: '45°F',
    pkg: 'OK',
    tone: 'alert',
    s: 'Rejected · warm'
  }, {
    id: 4,
    v: 'Sysco',
    item: 'Dry goods',
    temp: '—',
    pkg: 'Torn bag',
    tone: 'warn',
    s: 'Short / noted'
  }];
  const [live, setLive] = React.useState('');
  const liveNum = parseFloat(live);
  const liveTone = live === '' ? null : liveNum > 41 ? 'alert' : liveNum > 38 ? 'warn' : 'ok';
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Receiving",
    em: "log",
    sub: "Check temps and packaging at the door. Reject anything over 41\xB0."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "Deliveries",
    value: "4",
    sub: "today"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Accepted",
    value: "2",
    sub: "in the door",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Rejected",
    value: "1",
    sub: "over 41\xB0",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Short / noted",
    value: "1",
    sub: "credit owed",
    trend: "warn"
  })), /*#__PURE__*/React.createElement("div", {
    className: "ck-toolbar"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Vendor"
  }, /*#__PURE__*/React.createElement(Sel, {
    style: {
      width: 150
    }
  }, /*#__PURE__*/React.createElement("option", null, "Shamrock"), /*#__PURE__*/React.createElement("option", null, "Sysco"), /*#__PURE__*/React.createElement("option", null, "WebstaurantStore"))), /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Delivery"
  }, /*#__PURE__*/React.createElement(Inp, {
    placeholder: "e.g. Trout, 10lb case \xD72"
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Temp \xB0F"
  }, /*#__PURE__*/React.createElement(Inp, {
    value: live,
    placeholder: "\u2014",
    style: {
      width: 90,
      borderColor: liveTone === 'alert' ? 'var(--fire)' : liveTone === 'warn' ? 'var(--metal)' : undefined
    },
    onChange: e => setLive(e.target.value)
  })), /*#__PURE__*/React.createElement(Btn2, {
    variant: liveTone === 'alert' ? 'danger' : 'primary'
  }, liveTone === 'alert' ? 'Reject' : 'Accept')), /*#__PURE__*/React.createElement(Card2, {
    title: "At the door today",
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'v',
      label: 'Vendor'
    }, {
      key: 'item',
      label: 'Delivery'
    }, {
      key: 'temp',
      label: 'Temp',
      align: 'right'
    }, {
      key: 'pkg',
      label: 'Packaging'
    }, {
      key: 's',
      label: 'Status',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      v: /*#__PURE__*/React.createElement(Tag2, null, r.v),
      item: r.item,
      temp: r.temp,
      pkg: r.pkg,
      s: /*#__PURE__*/React.createElement(Pill2, {
        tone: r.tone,
        dot: true
      }, r.s)
    }))
  })));
}

/* ── COSTING ── */
function CostingScreen() {
  const rows = [{
    id: 1,
    dish: 'Bison ribeye, frites',
    menu: '$52',
    cost: '$16.90',
    pct: 32.5,
    tone: 'warn'
  }, {
    id: 2,
    dish: 'Elk bolognese',
    menu: '$29',
    cost: '$7.25',
    pct: 25.0,
    tone: 'ok'
  }, {
    id: 3,
    dish: 'Trout amandine',
    menu: '$34',
    cost: '$9.52',
    pct: 28.0,
    tone: 'ok'
  }, {
    id: 4,
    dish: 'Squash agnolotti',
    menu: '$28',
    cost: '$5.60',
    pct: 20.0,
    tone: 'ok'
  }, {
    id: 5,
    dish: 'Trout board',
    menu: '$21',
    cost: '$8.19',
    pct: 39.0,
    tone: 'alert'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Plate",
    em: "costing",
    sub: "Cost against menu price. Anything past 35% goes oxblood."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "Food cost, blended",
    value: "28.4%",
    sub: "\u25BC 1.2 vs last week",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Over target",
    value: "2",
    sub: "dishes past 35%",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Price shocks",
    value: "3",
    sub: "vendor moves this week",
    trend: "warn"
  })), /*#__PURE__*/React.createElement(Card2, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'dish',
      label: 'Dish'
    }, {
      key: 'menu',
      label: 'Menu',
      align: 'right'
    }, {
      key: 'cost',
      label: 'Plate cost',
      align: 'right'
    }, {
      key: 'pct',
      label: 'Cost %',
      align: 'right'
    }, {
      key: 'bar',
      label: '',
      width: 110
    }],
    rows: rows.map(r => ({
      id: r.id,
      dish: r.dish,
      menu: r.menu,
      cost: r.cost,
      pct: /*#__PURE__*/React.createElement("span", {
        style: {
          color: r.tone === 'alert' ? 'var(--fire)' : r.tone === 'warn' ? 'var(--metal)' : 'var(--ok)',
          fontWeight: 700
        }
      }, r.pct.toFixed(1), "%"),
      bar: /*#__PURE__*/React.createElement(Bar2, {
        value: r.pct / 45 * 100,
        tone: r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'
      })
    }))
  })));
}

/* ── TIP POOL ── */
function TipPoolScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    role: 'Server',
    hrs: 7.5,
    pts: 10,
    out: '$212.40'
  }, {
    id: 2,
    who: 'Dev Tran',
    role: 'Server',
    hrs: 6.0,
    pts: 10,
    out: '$169.92'
  }, {
    id: 3,
    who: 'Kai Ostrander',
    role: 'Bar',
    hrs: 8.0,
    pts: 8,
    out: '$181.25'
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    role: 'Busser',
    hrs: 6.5,
    pts: 5,
    out: '$92.06'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Tip",
    em: "pool",
    sub: "Tonight's pool split by hours \xD7 points. Kinds: tip pool, service charge, direct tip."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "Pool tonight",
    value: "$655.63",
    sub: "tips + service charge"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Hours in pool",
    value: "28.0",
    sub: "4 staff"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Per point-hour",
    value: "$2.83"
  })), /*#__PURE__*/React.createElement(Card2, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'role',
      label: 'Role'
    }, {
      key: 'hrs',
      label: 'Hours',
      align: 'right'
    }, {
      key: 'pts',
      label: 'Points',
      align: 'right'
    }, {
      key: 'out',
      label: 'Payout',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Av2, {
        name: r.who,
        size: "sm"
      }), r.who),
      role: /*#__PURE__*/React.createElement(Tag2, null, r.role),
      hrs: r.hrs.toFixed(1),
      pts: r.pts,
      out: r.out
    }))
  })));
}

/* ── BREAKS & LEAVE ── */
function BreaksScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    on: '2:00p',
    brk: '30 min at 5:10p',
    s: 'Taken',
    tone: 'ok'
  }, {
    id: 2,
    who: 'Dev Tran',
    on: '3:00p',
    brk: 'Due by 8:00p',
    s: 'Due',
    tone: 'warn'
  }, {
    id: 3,
    who: 'Kai Ostrander',
    on: '4:00p',
    brk: 'Missed 10-min rest',
    s: 'Missed',
    tone: 'alert'
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    on: '4:30p',
    brk: 'Waived (signed)',
    s: 'Waived',
    tone: 'neutral'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Breaks &",
    em: "leave",
    sub: "Rest and meal breaks against the clock \u2014 missed breaks go oxblood."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "On shift",
    value: "4",
    sub: "clocked in"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Breaks taken",
    value: "1",
    sub: "logged",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Due soon",
    value: "1",
    sub: "before 8:00p",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Missed",
    value: "1",
    sub: "needs a waiver",
    trend: "down"
  })), /*#__PURE__*/React.createElement(Card2, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'on',
      label: 'Clocked in',
      align: 'right'
    }, {
      key: 'brk',
      label: 'Break'
    }, {
      key: 's',
      label: 'Status',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Av2, {
        name: r.who,
        size: "sm"
      }), r.who),
      on: r.on,
      brk: r.brk,
      s: /*#__PURE__*/React.createElement(Pill2, {
        tone: r.tone,
        dot: true
      }, r.s)
    }))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Btn2, {
    variant: "primary"
  }, "Start a break"), /*#__PURE__*/React.createElement(Btn2, {
    variant: "ghost"
  }, "Sick leave log")));
}

/* ── STAFF CERTS ── */
function CertsScreen() {
  const rows = [{
    id: 1,
    who: 'Rosa Mendez',
    cert: 'Food Protection Manager',
    exp: 'Mar 2028',
    tone: 'ok',
    s: 'Current'
  }, {
    id: 2,
    who: 'Dev Tran',
    cert: 'Food Handler',
    exp: 'Dec 2026',
    tone: 'warn',
    s: '5 months left'
  }, {
    id: 3,
    who: 'Kai Ostrander',
    cert: 'TIPS Alcohol',
    exp: 'Jul 2026',
    tone: 'alert',
    s: 'Expires this month'
  }, {
    id: 4,
    who: 'Marta Ibáñez',
    cert: 'Food Handler',
    exp: 'Aug 2027',
    tone: 'ok',
    s: 'Current'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Staff",
    em: "certs",
    sub: "Who's certified for what, and what's about to lapse."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "Current",
    value: "2",
    sub: "good standing",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Expiring",
    value: "1",
    sub: "within 6 months",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Lapsing",
    value: "1",
    sub: "this month",
    trend: "down"
  })), /*#__PURE__*/React.createElement(Card2, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'who',
      label: 'Staff'
    }, {
      key: 'cert',
      label: 'Certificate'
    }, {
      key: 'exp',
      label: 'Expires',
      align: 'right'
    }, {
      key: 's',
      label: 'Status',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      who: /*#__PURE__*/React.createElement("span", {
        style: {
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8
        }
      }, /*#__PURE__*/React.createElement(Av2, {
        name: r.who,
        size: "sm"
      }), r.who),
      cert: r.cert,
      exp: r.exp,
      s: /*#__PURE__*/React.createElement(Pill2, {
        tone: r.tone,
        dot: true
      }, r.s)
    }))
  })));
}

/* ── AUDIT LOG ── */
function AuditScreen() {
  const rows = [{
    id: 1,
    at: '6:42p',
    who: 'Rosa M.',
    what: "86'd Trout amandine",
    area: '86 board',
    flag: false
  }, {
    id: 2,
    at: '6:12p',
    who: 'Kai O.',
    what: 'Logged hot hold 128° — flagged',
    area: 'Temp log',
    flag: true
  }, {
    id: 3,
    at: '5:58p',
    who: 'Manager PIN',
    what: 'Voided check #238 — $64.00',
    area: 'POS',
    flag: true
  }, {
    id: 4,
    at: '5:41p',
    who: 'Dev T.',
    what: 'Signed off Sauté line check',
    area: 'Stations',
    flag: false
  }, {
    id: 5,
    at: '4:30p',
    who: 'Marta I.',
    what: 'Counted walk-in produce',
    area: 'Stock',
    flag: false
  }, {
    id: 6,
    at: '4:02p',
    who: 'Manager PIN',
    what: 'Comped 2 desserts — anniversary',
    area: 'POS',
    flag: true
  }, {
    id: 7,
    at: '3:14p',
    who: 'Rosa M.',
    what: 'Received Shamrock delivery',
    area: 'Receiving',
    flag: false
  }];
  const [tab, setTab] = React.useState('all');
  const list = tab === 'flagged' ? rows.filter(r => r.flag) : tab === 'pin' ? rows.filter(r => r.who === 'Manager PIN') : rows;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Head2, {
    title: "Audit",
    em: "log",
    sub: "Every signed action, newest first. Read-only."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi2, {
    label: "Actions today",
    value: rows.length,
    sub: "this location"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Manager PIN",
    value: "2",
    sub: "voids + comps",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi2, {
    label: "Flagged",
    value: "3",
    sub: "review recommended",
    trend: "down"
  })), /*#__PURE__*/React.createElement(Tabs2, {
    tabs: [{
      value: 'all',
      label: 'All'
    }, {
      value: 'flagged',
      label: 'Flagged'
    }, {
      value: 'pin',
      label: 'Manager PIN'
    }],
    value: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 14
    }
  }), /*#__PURE__*/React.createElement(Card2, {
    padded: false
  }, /*#__PURE__*/React.createElement(Table2, {
    columns: [{
      key: 'at',
      label: 'At',
      align: 'right',
      width: 70
    }, {
      key: 'who',
      label: 'Who'
    }, {
      key: 'what',
      label: 'Action'
    }, {
      key: 'area',
      label: 'Board',
      align: 'right'
    }],
    rows: list.map(r => ({
      id: r.id,
      at: r.at,
      who: r.who === 'Manager PIN' ? /*#__PURE__*/React.createElement(Tag2, {
        dot: true,
        dotTone: "amber"
      }, "PIN") : r.who,
      what: /*#__PURE__*/React.createElement("span", {
        style: {
          color: r.flag ? 'var(--fire)' : 'var(--text)'
        }
      }, r.what),
      area: /*#__PURE__*/React.createElement(Tag2, null, r.area)
    }))
  })));
}
window.Screens2 = Object.assign(window.Screens2 || {}, {
  OrderGuideScreen,
  ReceivingScreen,
  CostingScreen,
  TipPoolScreen,
  BreaksScreen,
  CertsScreen,
  AuditScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit-v2/ScreensOffice.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit-v2/ScreensOps.jsx
try { (() => {
// Cockpit v2 — Line + Safety boards: Prep, Specials, KDS/Expo, Cooling,
// Cleaning, Sanitizer. Grounded in the real boards (PrepView, SpecialsView,
// KdsPunchView, CoolingView/cooling.css, CleaningView, SanitizerView/sani.css).
const DSo = window.LariatLaRiOSDesignSystem_5761b2;
const {
  Button,
  Pill,
  Tag,
  StatusDot,
  Kpi,
  Bar,
  DataTable,
  Card,
  Field,
  Input,
  Select
} = DSo;
function BoardHead({
  title,
  em,
  sub
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "ck-board-head"
  }, /*#__PURE__*/React.createElement("h1", null, title, " ", em && /*#__PURE__*/React.createElement("em", null, em)), sub && /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, sub));
}
window.BoardHead = BoardHead;

/* ── PREP BOARD ── */
function PrepScreen() {
  const [tasks, setTasks] = React.useState([{
    id: 1,
    task: 'Brine 40 chicken thighs',
    station: 'Prep',
    by: 'Rosa M.',
    done: true
  }, {
    id: 2,
    task: 'Pommes purée — 2 batches',
    station: 'Sauté',
    by: 'Dev T.',
    done: true
  }, {
    id: 3,
    task: 'Pick + wash chicories',
    station: 'Garde',
    by: '—',
    done: false
  }, {
    id: 4,
    task: 'Demi reduction, pull at nappe',
    station: 'Sauce',
    by: 'Kai O.',
    done: false
  }, {
    id: 5,
    task: 'Portion trout, 6oz',
    station: 'Sauté',
    by: '—',
    done: false
  }]);
  const [txt, setTxt] = React.useState('');
  const done = tasks.filter(t => t.done).length;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "Prep",
    em: "board",
    sub: "What has to happen before the door opens."
  }), /*#__PURE__*/React.createElement("div", {
    className: "ck-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Add prep"
  }, /*#__PURE__*/React.createElement(Input, {
    value: txt,
    placeholder: "e.g. Dice mirepoix \u2014 4qt",
    onChange: e => setTxt(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter' && txt.trim()) {
        setTasks([{
          id: Date.now(),
          task: txt.trim(),
          station: 'Prep',
          by: '—',
          done: false
        }, ...tasks]);
        setTxt('');
      }
    }
  }))), /*#__PURE__*/React.createElement(Field, {
    label: "Station"
  }, /*#__PURE__*/React.createElement(Select, {
    style: {
      width: 140
    }
  }, /*#__PURE__*/React.createElement("option", null, "Any station"), /*#__PURE__*/React.createElement("option", null, "Prep"), /*#__PURE__*/React.createElement("option", null, "Saut\xE9"), /*#__PURE__*/React.createElement("option", null, "Grill"), /*#__PURE__*/React.createElement("option", null, "Sauce"), /*#__PURE__*/React.createElement("option", null, "Garde"))), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => {
      if (txt.trim()) {
        setTasks([{
          id: Date.now(),
          task: txt.trim(),
          station: 'Prep',
          by: '—',
          done: false
        }, ...tasks]);
        setTxt('');
      }
    }
  }, "Add")), /*#__PURE__*/React.createElement(Card, {
    title: "The board",
    right: /*#__PURE__*/React.createElement(Pill, {
      tone: done === tasks.length ? 'ok' : 'warn',
      dot: true
    }, done, "/", tasks.length, " done"),
    padded: false
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: 'st',
      label: '',
      width: 36
    }, {
      key: 'task',
      label: 'Task'
    }, {
      key: 'station',
      label: 'Station'
    }, {
      key: 'by',
      label: 'Cook'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: tasks.map(t => ({
      id: t.id,
      st: /*#__PURE__*/React.createElement(StatusDot, {
        tone: t.done ? 'ok' : 'muted',
        size: 9
      }),
      task: /*#__PURE__*/React.createElement("span", {
        style: {
          color: t.done ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: t.done ? 'line-through' : 'none'
        }
      }, t.task),
      station: /*#__PURE__*/React.createElement(Tag, null, t.station),
      by: t.by,
      act: t.done ? /*#__PURE__*/React.createElement(Tag, {
        dot: true,
        dotTone: "ok"
      }, "Done") : /*#__PURE__*/React.createElement(Button, {
        size: "xs",
        onClick: () => setTasks(tasks.map(x => x.id === t.id ? {
          ...x,
          done: true
        } : x))
      }, "Done")
    }))
  })));
}

/* ── SPECIALS ── */
function SpecialsScreen() {
  const specials = [{
    n: 'Elk chop, huckleberry jus',
    px: '$44',
    left: 14,
    total: 22
  }, {
    n: 'Squash agnolotti',
    px: '$28',
    left: 6,
    total: 18
  }, {
    n: 'Smoked trout board',
    px: '$21',
    left: 0,
    total: 12
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "Tonight's",
    em: "specials",
    sub: "Counts tick down as the window calls them."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(250px,1fr))',
      gap: 12
    }
  }, specials.map(s => /*#__PURE__*/React.createElement(Card, {
    key: s.n,
    title: s.n,
    right: s.left === 0 ? /*#__PURE__*/React.createElement(Pill, {
      tone: "alert",
      dot: true
    }, "86'd") : s.left <= 6 ? /*#__PURE__*/React.createElement(Pill, {
      tone: "warn",
      dot: true
    }, s.left, " left") : /*#__PURE__*/React.createElement(Pill, {
      tone: "ok",
      dot: true
    }, s.left, " left")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginBottom: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 22,
      color: 'var(--text)'
    }
  }, s.px), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 11,
      color: 'var(--text-muted)'
    }
  }, s.total - s.left, "/", s.total, " sold")), /*#__PURE__*/React.createElement(Bar, {
    value: s.left / s.total * 100,
    tone: s.left === 0 ? 'alert' : s.left <= 6 ? 'warn' : 'ok'
  })))));
}

/* ── KDS / EXPO — runs as its own wall window; shown here as a live preview ── */
function KdsScreen() {
  const tickets = [{
    t: '#241',
    tbl: 'T6',
    age: '2:14',
    items: ['2× Bison rib', '1× Trout (GF)', '1× Chicory'],
    tone: 'ok'
  }, {
    t: '#242',
    tbl: 'T3',
    age: '6:48',
    items: ['1× Elk chop', '2× Agnolotti'],
    tone: 'warn'
  }, {
    t: '#239',
    tbl: 'BAR',
    age: '11:02',
    items: ['1× Trout board'],
    tone: 'alert'
  }, {
    t: '#243',
    tbl: 'T9',
    age: '0:41',
    items: ['3× Bison rib', '1× Risotto (V)'],
    tone: 'ok'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "KDS /",
    em: "expo",
    sub: "Opens as its own wall window (\u29C9) \u2014 this is a live preview in the deepest surface."
  }), /*#__PURE__*/React.createElement("div", {
    className: "k-dark",
    style: {
      padding: 18,
      borderRadius: 'var(--radius)',
      border: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12
    }
  }, tickets.map(k => /*#__PURE__*/React.createElement("div", {
    key: k.t,
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--hair)',
      borderTop: `3px solid ${k.tone === 'alert' ? 'var(--fire)' : k.tone === 'warn' ? 'var(--metal)' : 'var(--ok)'}`,
      borderRadius: 'var(--radius-sm)',
      padding: '10px 12px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'baseline',
      marginBottom: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontWeight: 700,
      fontSize: 15,
      color: 'var(--text)'
    }
  }, k.t), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 12,
      color: k.tone === 'alert' ? 'var(--fire)' : 'var(--text-muted)'
    }
  }, k.age)), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 9.5,
      letterSpacing: '.16em',
      color: 'var(--text-muted)',
      marginBottom: 6
    }
  }, k.tbl), k.items.map(it => /*#__PURE__*/React.createElement("div", {
    key: it,
    style: {
      fontSize: 13,
      color: 'var(--text)',
      padding: '3px 0',
      borderBottom: '1px solid var(--hair-2)'
    }
  }, it)), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "xs",
    variant: "ok"
  }, "Bump")))))));
}

/* ── COOLING ── */
function CoolingScreen() {
  const batches = [{
    item: 'Demi-glace, 8qt',
    stage: 'Stage 1 · 135°→70° in 2h',
    clock: '0:42',
    tone: 'ok',
    read: '96°F'
  }, {
    item: 'Braise liquid, 12qt',
    stage: 'Stage 2 · 70°→41° in 4h',
    clock: '2:15',
    tone: 'warn',
    read: '58°F'
  }, {
    item: 'Soup — squash, 6qt',
    stage: 'Stage 2 · 70°→41° in 4h',
    clock: '3:51',
    tone: 'alert',
    read: '49°F'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "Cooling",
    em: "log",
    sub: "Two-stage cool: 135\xB0\u219270\xB0 in 2 hours, 70\xB0\u219241\xB0 in 4. Log every reading."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 12
    }
  }, batches.map(b => /*#__PURE__*/React.createElement("div", {
    key: b.item,
    style: {
      border: '1px solid var(--hair)',
      borderLeft: `4px solid ${b.tone === 'alert' ? 'var(--fire)' : b.tone === 'warn' ? 'var(--metal)' : 'var(--ok)'}`,
      borderRadius: 'var(--radius)',
      padding: '14px 18px',
      background: 'var(--panel)',
      display: 'flex',
      alignItems: 'center',
      gap: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 700,
      color: 'var(--text)'
    }
  }, b.item), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)',
      marginTop: 3
    }
  }, b.stage, " \xB7 last read ", /*#__PURE__*/React.createElement("span", {
    className: "tnum"
  }, b.read))), /*#__PURE__*/React.createElement("div", {
    style: {
      textAlign: 'right'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 26,
      fontWeight: 700,
      color: b.tone === 'alert' ? 'var(--fire)' : b.tone === 'warn' ? 'var(--metal)' : 'var(--text)'
    }
  }, b.clock), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 8.5,
      letterSpacing: '.2em',
      textTransform: 'uppercase',
      color: 'var(--text-muted)'
    }
  }, "Time left")), /*#__PURE__*/React.createElement(Button, {
    size: "sm"
  }, "Log temp")))));
}

/* ── CLEANING ── */
function CleaningScreen() {
  const init = [{
    id: 1,
    task: 'Hood filters',
    area: 'Hot line',
    freq: 'Weekly',
    due: 'Today',
    tone: 'warn',
    by: ''
  }, {
    id: 2,
    task: 'Walk-in shelving',
    area: 'BOH',
    freq: 'Weekly',
    due: 'Fri',
    tone: 'ok',
    by: 'Rosa M.'
  }, {
    id: 3,
    task: 'Floor drains',
    area: 'Dish',
    freq: 'Daily',
    due: 'Late',
    tone: 'alert',
    by: ''
  }, {
    id: 4,
    task: 'Slicer teardown',
    area: 'Prep',
    freq: 'Every 4h',
    due: '8:00p',
    tone: 'ok',
    by: ''
  }, {
    id: 5,
    task: 'Bar gun + drains',
    area: 'Bar',
    freq: 'Nightly',
    due: 'Close',
    tone: 'ok',
    by: ''
  }, {
    id: 6,
    task: 'Reach-in gaskets',
    area: 'Hot line',
    freq: 'Weekly',
    due: 'Wed',
    tone: 'ok',
    by: 'Dev T.'
  }];
  const [rows, setRows] = React.useState(init);
  const done = rows.filter(r => r.by).length;
  const late = rows.filter(r => r.tone === 'alert' && !r.by).length;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "Cleaning",
    em: "side work",
    sub: "Daily and weekly side work \u2014 late items go oxblood. Check off with your name."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3,1fr)',
      gap: 12,
      marginBottom: 18
    }
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "Done",
    value: `${done}/${rows.length}`,
    sub: "signed off",
    trend: done === rows.length ? 'up' : undefined
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Late",
    value: late,
    sub: "past due",
    trend: late ? 'down' : undefined
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Next up",
    value: "Hood filters",
    sub: "due today",
    trend: "warn"
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Side work",
    right: /*#__PURE__*/React.createElement(Pill, {
      tone: done === rows.length ? 'ok' : 'warn',
      dot: true
    }, done, "/", rows.length, " done"),
    padded: false
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: 'st',
      label: '',
      width: 34
    }, {
      key: 'task',
      label: 'Task'
    }, {
      key: 'area',
      label: 'Area'
    }, {
      key: 'freq',
      label: 'How often'
    }, {
      key: 'by',
      label: 'By'
    }, {
      key: 'due',
      label: 'Due',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      st: /*#__PURE__*/React.createElement(StatusDot, {
        tone: r.by ? 'ok' : r.tone,
        size: 9
      }),
      task: /*#__PURE__*/React.createElement("span", {
        style: {
          color: r.by ? 'var(--text-muted)' : 'var(--text)',
          textDecoration: r.by ? 'line-through' : 'none'
        }
      }, r.task),
      area: /*#__PURE__*/React.createElement(Tag, null, r.area),
      freq: r.freq,
      by: r.by || '—',
      due: /*#__PURE__*/React.createElement(Pill, {
        tone: r.by ? 'ok' : r.tone,
        dot: true
      }, r.by ? 'Done' : r.due),
      act: r.by ? /*#__PURE__*/React.createElement(Button, {
        size: "xs",
        variant: "ghost",
        onClick: () => setRows(rows.map(x => x.id === r.id ? {
          ...x,
          by: ''
        } : x))
      }, "Undo") : /*#__PURE__*/React.createElement(Button, {
        size: "xs",
        onClick: () => setRows(rows.map(x => x.id === r.id ? {
          ...x,
          by: 'You'
        } : x))
      }, "Done")
    }))
  })));
}

/* ── SANITIZER ── */
function SanitizerScreen() {
  const wells = [{
    n: 'Line — sauté well',
    ppm: 210,
    at: '5:40p',
    tone: 'ok'
  }, {
    n: 'Line — grill well',
    ppm: 195,
    at: '5:41p',
    tone: 'ok'
  }, {
    n: 'Prep sink',
    ppm: 120,
    at: '3:10p',
    tone: 'alert'
  }, {
    n: 'Dish — final rinse',
    ppm: 220,
    at: '5:12p',
    tone: 'ok'
  }, {
    n: 'Bar — rag bucket',
    ppm: null,
    at: '—',
    tone: 'alert'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(BoardHead, {
    title: "Sanitizer",
    em: "checks",
    sub: "Quat wells hold 150\u2013400 ppm. Re-mix anything low, then log it."
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
      gap: 12
    }
  }, wells.map(w => /*#__PURE__*/React.createElement("div", {
    key: w.n,
    style: {
      background: 'var(--panel)',
      border: '1px solid var(--hair)',
      borderLeft: `4px solid ${w.tone === 'alert' ? 'var(--fire)' : 'var(--ok)'}`,
      borderRadius: 'var(--radius)',
      padding: '12px 14px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13.5,
      fontWeight: 700,
      color: 'var(--text)'
    }
  }, w.n), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      justifyContent: 'space-between',
      marginTop: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 22,
      fontWeight: 700,
      color: w.tone === 'alert' ? 'var(--fire)' : 'var(--text)'
    }
  }, w.ppm != null ? `${w.ppm} ppm` : 'No log'), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 10.5,
      color: 'var(--text-muted)'
    }
  }, w.at))))));
}
window.Screens2 = Object.assign(window.Screens2 || {}, {
  PrepScreen,
  SpecialsScreen,
  KdsScreen,
  CoolingScreen,
  CleaningScreen,
  SanitizerScreen
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit-v2/ScreensOps.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit-v2/Shell2.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Cockpit v2 chrome — division rail, per-division sidebar, tab strip,
// theme toggle. Reuses v1's ServiceStrip + screens.
const DS2 = window.LariatLaRiOSDesignSystem_5761b2;
const {
  BrandStamp
} = DS2;
const Stamp2 = p => /*#__PURE__*/React.createElement(BrandStamp, _extends({
  decorative: true
}, p));

/* ── Division registry — the proposed IA.
   win:true ⇒ board opens as its own window (wall mount / printable sheet). */
const DIVISIONS = [{
  id: 'service',
  glyph: 'LN',
  name: 'Line',
  sections: [{
    name: 'Service',
    boards: [{
      id: 'today',
      name: 'Today',
      pinned: true
    }, {
      id: 'eighty-six',
      name: '86 Board',
      badge: true
    }, {
      id: 'prep',
      name: 'Prep'
    }, {
      id: 'specials',
      name: 'Specials'
    }]
  }, {
    name: 'Stations',
    boards: [{
      id: 'station:saute',
      name: 'Sauté'
    }, {
      id: 'station:grill',
      name: 'Grill'
    }, {
      id: 'station:sauce',
      name: 'Sauce'
    }]
  }, {
    name: 'Displays',
    boards: [{
      id: 'kds',
      name: 'KDS / Expo',
      win: true
    }]
  }]
}, {
  id: 'foh',
  glyph: 'FL',
  name: 'Floor',
  sections: [{
    name: 'Front of house',
    boards: [{
      id: 'host',
      name: 'Host Stand',
      win: true
    }, {
      id: 'floor',
      name: 'Floor Map'
    }, {
      id: 'resos',
      name: 'Reservations'
    }, {
      id: 'bar',
      name: 'Bar'
    }]
  }]
}, {
  id: 'books',
  glyph: 'BK',
  name: 'Books',
  sections: [{
    name: 'The books',
    boards: [{
      id: 'recipes',
      name: 'Recipe Book'
    }, {
      id: 'beo',
      name: 'BEO Board',
      win: true
    }, {
      id: 'orderguide',
      name: 'Order Guide',
      win: true
    }]
  }]
}, {
  id: 'safety',
  glyph: 'SF',
  name: 'Safety',
  sections: [{
    name: 'Food safety',
    boards: [{
      id: 'temps',
      name: 'Temp Log'
    }, {
      id: 'cooling',
      name: 'Cooling'
    }, {
      id: 'cleaning',
      name: 'Cleaning'
    }, {
      id: 'sanitizer',
      name: 'Sanitizer'
    }]
  }]
}, {
  id: 'office',
  glyph: 'OF',
  name: 'Office',
  sections: [{
    name: 'Stock & buying',
    boards: [{
      id: 'inventory',
      name: 'Stock & Par'
    }, {
      id: 'receiving',
      name: 'Receiving'
    }, {
      id: 'costing',
      name: 'Costing'
    }]
  }, {
    name: 'People',
    boards: [{
      id: 'tippool',
      name: 'Tip Pool'
    }, {
      id: 'breaks',
      name: 'Breaks & Leave'
    }, {
      id: 'sick',
      name: 'Sick Leave'
    }, {
      id: 'wage',
      name: 'Wage Notices'
    }, {
      id: 'reviews',
      name: 'Reviews'
    }, {
      id: 'certs',
      name: 'Staff Certs'
    }, {
      id: 'goldstars',
      name: 'Gold Stars'
    }]
  }, {
    name: 'Records',
    boards: [{
      id: 'audit',
      name: 'Audit Log'
    }]
  }]
}, {
  id: 'shows',
  glyph: 'SH',
  name: 'Shows',
  sections: [{
    name: 'Stage',
    boards: [{
      id: 'tonight',
      name: 'Tonight'
    }, {
      id: 'stage',
      name: 'Stage Setup'
    }, {
      id: 'sound',
      name: 'Sound'
    }, {
      id: 'boxoffice',
      name: 'Box Office',
      win: true
    }, {
      id: 'settlement',
      name: 'Settlement',
      win: true
    }]
  }]
}];
function DivisionRail({
  division,
  setDivision,
  badge86
}) {
  return /*#__PURE__*/React.createElement("nav", {
    className: "ck2-rail"
  }, DIVISIONS.map(d => /*#__PURE__*/React.createElement("button", {
    key: d.id,
    className: `ck2-div ${division === d.id ? 'active' : ''}`,
    onClick: () => setDivision(d.id),
    title: d.name
  }, /*#__PURE__*/React.createElement("span", {
    className: "g"
  }, d.glyph), /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, d.name), d.id === 'service' && badge86 > 0 && /*#__PURE__*/React.createElement("span", {
    className: "badge"
  }, badge86))), /*#__PURE__*/React.createElement("span", {
    className: "spacer"
  }));
}
function DivisionSidebar({
  division,
  activeTab,
  openBoard
}) {
  const d = DIVISIONS.find(x => x.id === division);
  const C = window.COCKPIT;
  return /*#__PURE__*/React.createElement("aside", {
    className: "ck2-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "hd"
  }, /*#__PURE__*/React.createElement(Stamp2, null), d.name), d.sections.map(sec => /*#__PURE__*/React.createElement(React.Fragment, {
    key: sec.name
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck2-sec"
  }, sec.name), sec.boards.map(b => /*#__PURE__*/React.createElement("button", {
    key: b.id,
    className: `ck2-board ${activeTab === b.id ? 'active' : ''}`,
    onClick: () => openBoard(b)
  }, /*#__PURE__*/React.createElement("span", null, b.name), b.badge && C.eightySix.length > 0 && /*#__PURE__*/React.createElement("span", {
    className: "cnt"
  }, C.eightySix.length), b.win && /*#__PURE__*/React.createElement("span", {
    className: "win",
    title: "Opens in its own window"
  }, "\u29C9"))))), /*#__PURE__*/React.createElement("div", {
    className: "ck2-legend"
  }, /*#__PURE__*/React.createElement("b", null, "\u29C9"), " opens its own window \u2014 wall displays, host iPad, printable sheets."));
}
function TabStrip({
  tabs,
  active,
  setActive,
  closeTab
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "ck2-tabs"
  }, tabs.map(t => /*#__PURE__*/React.createElement("button", {
    key: t.id,
    className: `ck2-tab ${t.id === active ? 'active' : ''} ${t.pinned ? 'pinned' : ''}`,
    onClick: () => setActive(t.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "dv"
  }, t.divGlyph), t.name, /*#__PURE__*/React.createElement("span", {
    className: "x",
    onClick: e => {
      e.stopPropagation();
      closeTab(t.id);
    }
  }, "\xD7"))));
}
function ThemeToggle({
  theme,
  setTheme
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "ck2-theme"
  }, /*#__PURE__*/React.createElement("button", {
    className: theme === 'iron' ? 'on' : '',
    onClick: () => setTheme('iron')
  }, "Iron"), /*#__PURE__*/React.createElement("button", {
    className: theme === 'ledger' ? 'on' : '',
    onClick: () => setTheme('ledger')
  }, "Ledger"));
}
function StubScreen({
  name,
  win
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "ck2-empty"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, name), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, "Not recreated in this proposal \u2014 the real board exists in LariatOS", win ? /*#__PURE__*/React.createElement(React.Fragment, null, " and ", /*#__PURE__*/React.createElement("b", null, "opens as its own window"), " (wall display / device / printable sheet), so it never competes for tab space in the cockpit.") : /*#__PURE__*/React.createElement(React.Fragment, null, " and would open here as a tab.")));
}
window.Shell2 = {
  DIVISIONS,
  DivisionRail,
  DivisionSidebar,
  TabStrip,
  ThemeToggle,
  StubScreen,
  Stamp2
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit-v2/Shell2.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit/Screens.jsx
try { (() => {
// Cockpit screens — Today (rush home), 86 Board, Temp Log. Compose the
// LaRiOS design-system components on the shell chrome. Kitchen-native copy.
const DS = window.LariatLaRiOSDesignSystem_5761b2;
const {
  Button,
  Pill,
  Tag,
  StatusDot,
  Kpi,
  Bar,
  DataTable,
  Card,
  Field,
  Input,
  Select,
  Tabs,
  Avatar
} = DS;
const S = window.Shell;
function toneColor(t) {
  return {
    alert: 'var(--fire)',
    warn: 'var(--metal)',
    ok: 'var(--ok)',
    amber: 'var(--accent)'
  }[t] || 'var(--text-muted)';
}

/* ── TODAY — the rush home ── */
function TodayScreen({
  go
}) {
  const C = window.COCKPIT;
  const ready = C.stations.filter(s => s.signedOff || s.done >= s.total).length;
  const flagged = C.stations.reduce((n, s) => n + s.flagged, 0);
  function tileStatus(s) {
    if (s.flagged > 0) return {
      label: `${s.flagged} flagged`,
      tone: 'alert'
    };
    if (s.signedOff) return {
      label: 'Signed off',
      tone: 'ok'
    };
    if (s.done >= s.total) return {
      label: 'Ready',
      tone: 'ok'
    };
    if (s.done > 0) return {
      label: `${s.done} of ${s.total}`,
      tone: 'amber'
    };
    return {
      label: 'Not checked',
      tone: 'alert'
    };
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-hero"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-datebar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "dot"
  }), "Fri \xB7 Nov 14 \xB7 The Lariat"), /*#__PURE__*/React.createElement("h1", null, "Today")), /*#__PURE__*/React.createElement("div", {
    className: "ck-statstack"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "n"
  }, ready), /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "Ready")), /*#__PURE__*/React.createElement("div", {
    className: "ck-stat hot"
  }, /*#__PURE__*/React.createElement("div", {
    className: "n"
  }, flagged), /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "Flagged")), /*#__PURE__*/React.createElement("div", {
    className: "ck-stat"
  }, /*#__PURE__*/React.createElement("div", {
    className: "n"
  }, C.eightySix.length), /*#__PURE__*/React.createElement("div", {
    className: "l"
  }, "86'd")))), /*#__PURE__*/React.createElement("div", {
    className: "ck-86",
    onClick: () => go('eighty-six'),
    style: {
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-86-l"
  }, "86'd right now"), /*#__PURE__*/React.createElement("div", {
    className: "ck-86-items"
  }, C.eightySix.map(e => /*#__PURE__*/React.createElement("span", {
    key: e.id,
    className: "ck-86-chip"
  }, e.item)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-sechead"
  }, /*#__PURE__*/React.createElement("h2", null, /*#__PURE__*/React.createElement(S.Stamp, null), "The line, ", /*#__PURE__*/React.createElement("em", null, "right now")), /*#__PURE__*/React.createElement("span", {
    className: "eyebrow"
  }, ready, " ready \xB7 ", flagged, " flagged \xB7 ", C.stations.length, " stations")), /*#__PURE__*/React.createElement("div", {
    className: "ck-grid"
  }, C.stations.map((s, i) => {
    const st = tileStatus(s);
    return /*#__PURE__*/React.createElement("button", {
      key: s.id,
      className: "ck-tile",
      onClick: () => go('station:' + s.id)
    }, /*#__PURE__*/React.createElement(StationRing, {
      done: s.done,
      total: s.total,
      flagged: s.flagged,
      signedOff: s.signedOff,
      glyph: i + 1,
      size: 40
    }), /*#__PURE__*/React.createElement("span", {
      className: "tn"
    }, s.name), /*#__PURE__*/React.createElement("span", {
      className: "tsx",
      style: {
        color: toneColor(st.tone)
      }
    }, st.label));
  })), /*#__PURE__*/React.createElement("div", {
    className: "ck-quick"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ck-action",
    onClick: () => go('eighty-six')
  }, "86 an item"), /*#__PURE__*/React.createElement("button", {
    className: "ck-action",
    onClick: () => go('inventory')
  }, "Log stock"), /*#__PURE__*/React.createElement("button", {
    className: "ck-action muted",
    onClick: () => go('recipes')
  }, "Recipes"), /*#__PURE__*/React.createElement("button", {
    className: "ck-action muted",
    onClick: () => go('temps')
  }, "Temp log")));
}

/* ── 86 BOARD ── */
function EightySixScreen() {
  const C = window.COCKPIT;
  const [out, setOut] = React.useState(C.eightySix);
  const [item, setItem] = React.useState('');
  function add() {
    if (!item.trim()) return;
    setOut([{
      id: Date.now(),
      item: item.trim(),
      by: 'You',
      at: 'now'
    }, ...out]);
    setItem('');
  }
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-board-head"
  }, /*#__PURE__*/React.createElement("h1", null, "What's ", /*#__PURE__*/React.createElement("em", null, "86'd")), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Out right now. Everyone sees it the second you add it.")), /*#__PURE__*/React.createElement("div", {
    className: "ck-toolbar"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grow"
  }, /*#__PURE__*/React.createElement(Field, {
    label: "86 an item"
  }, /*#__PURE__*/React.createElement(Input, {
    value: item,
    placeholder: "e.g. Ribeye 12oz",
    onChange: e => setItem(e.target.value),
    onKeyDown: e => e.key === 'Enter' && add()
  }))), /*#__PURE__*/React.createElement(Button, {
    variant: "danger",
    onClick: add
  }, "Mark out")), /*#__PURE__*/React.createElement(Card, {
    title: "Out right now",
    right: /*#__PURE__*/React.createElement(Pill, {
      tone: "alert",
      dot: true
    }, out.length, " out"),
    padded: false
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: 'item',
      label: 'Item'
    }, {
      key: 'by',
      label: 'By'
    }, {
      key: 'at',
      label: 'At',
      align: 'right'
    }, {
      key: 'act',
      label: '',
      align: 'right'
    }],
    rows: out.map(e => ({
      id: e.id,
      item: e.item,
      by: e.by,
      at: e.at,
      act: /*#__PURE__*/React.createElement(Button, {
        size: "xs",
        variant: "ghost",
        onClick: () => setOut(out.filter(x => x.id !== e.id))
      }, "Back on")
    }))
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 20
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "eyebrow",
    style: {
      marginBottom: 10
    }
  }, "Might also be out \u2014 uses an 86'd item"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      flexWrap: 'wrap'
    }
  }, C.maybeOut.map(m => /*#__PURE__*/React.createElement(Tag, {
    key: m,
    dot: true,
    dotTone: "amber"
  }, m)))));
}

/* ── TEMP LOG BOARD ── */
function TempLogScreen() {
  const C = window.COCKPIT;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-board-head"
  }, /*#__PURE__*/React.createElement("h1", null, "Temp ", /*#__PURE__*/React.createElement("em", null, "log")), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Cold holds under 41\xB0, hot holds over 135\xB0. Log every check.")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(4,1fr)',
      gap: 12,
      marginBottom: 20
    }
  }, /*#__PURE__*/React.createElement(Kpi, {
    label: "In range",
    value: C.temps.filter(t => t.tone === 'ok').length,
    sub: "holds",
    trend: "up"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "At limit",
    value: C.temps.filter(t => t.tone === 'warn').length,
    sub: "watch",
    trend: "warn"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Out",
    value: C.temps.filter(t => t.tone === 'alert').length,
    sub: "fix now",
    trend: "down"
  }), /*#__PURE__*/React.createElement(Kpi, {
    label: "Last check",
    value: "6:12p",
    sub: "12m ago"
  })), /*#__PURE__*/React.createElement(Card, {
    title: "Holds",
    right: /*#__PURE__*/React.createElement(Pill, {
      tone: "warn",
      dot: true
    }, "1 at limit"),
    padded: false
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: 'name',
      label: 'Hold'
    }, {
      key: 'ccp',
      label: 'CCP'
    }, {
      key: 'temp',
      label: 'Temp',
      align: 'right'
    }, {
      key: 'status',
      label: 'Status',
      align: 'right'
    }],
    rows: C.temps.map(t => ({
      id: t.id,
      name: t.name,
      ccp: /*#__PURE__*/React.createElement(Tag, null, t.ccp),
      temp: t.temp,
      status: /*#__PURE__*/React.createElement(Pill, {
        tone: t.tone === 'alert' ? 'alert' : t.tone === 'warn' ? 'warn' : 'ok',
        dot: true
      }, t.status)
    }))
  })));
}

/* ── INVENTORY / STOCK BOARD ── */
function InventoryScreen() {
  const C = window.COCKPIT;
  const [tab, setTab] = React.useState('all');
  const rows = tab === 'low' ? C.inventory.filter(r => r.tone !== 'ok') : C.inventory;
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-board-head"
  }, /*#__PURE__*/React.createElement("h1", null, "Stock on ", /*#__PURE__*/React.createElement("em", null, "hand")), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, "Counts against par. Pull what's low before the door opens.")), /*#__PURE__*/React.createElement(Tabs, {
    tabs: [{
      value: 'all',
      label: 'All'
    }, {
      value: 'low',
      label: 'Running low'
    }],
    value: tab,
    onChange: setTab
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      height: 16
    }
  }), /*#__PURE__*/React.createElement(Card, {
    padded: false
  }, /*#__PURE__*/React.createElement(DataTable, {
    columns: [{
      key: 'item',
      label: 'Item'
    }, {
      key: 'station',
      label: 'Station'
    }, {
      key: 'par',
      label: 'Par',
      align: 'right'
    }, {
      key: 'onHand',
      label: 'On hand',
      align: 'right'
    }, {
      key: 'fill',
      label: 'Fill',
      width: 120
    }, {
      key: 'status',
      label: 'Status',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      item: r.item,
      station: r.station,
      par: r.par,
      onHand: r.onHand,
      fill: /*#__PURE__*/React.createElement(Bar, {
        value: Math.round(r.onHand / r.par * 100),
        tone: r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok'
      }),
      status: /*#__PURE__*/React.createElement(Pill, {
        tone: r.tone,
        dot: true
      }, r.status)
    }))
  })));
}

/* ── generic placeholder for station + recipes ── */
function StationScreen({
  id
}) {
  const s = window.COCKPIT.stations.find(x => x.id === id) || window.COCKPIT.stations[0];
  const checks = [{
    n: 'Sauté pans oiled & staged',
    done: true
  }, {
    n: 'Mise labeled + dated',
    done: true
  }, {
    n: 'Sauce holding 140°+',
    done: s.done > 2
  }, {
    n: 'Backups pulled from walk-in',
    done: s.done > 3
  }, {
    n: 'Station wiped + sanitized',
    done: s.signedOff
  }, {
    n: 'Rag bucket 200ppm',
    done: s.signedOff
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-board-head"
  }, /*#__PURE__*/React.createElement("h1", null, s.name), /*#__PURE__*/React.createElement("div", {
    className: "sub"
  }, s.line, " \xB7 line check")), /*#__PURE__*/React.createElement(Card, {
    title: "Line check",
    right: s.flagged > 0 ? /*#__PURE__*/React.createElement(Pill, {
      tone: "alert",
      dot: true
    }, s.flagged, " flagged") : /*#__PURE__*/React.createElement(Pill, {
      tone: "ok",
      dot: true
    }, s.done, "/", s.total)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, checks.slice(0, s.total).map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12,
      padding: '10px 12px',
      border: '1px solid var(--hair)',
      borderRadius: 'var(--radius-sm)',
      background: 'var(--bg)'
    }
  }, /*#__PURE__*/React.createElement(StatusDot, {
    tone: c.done ? 'ok' : 'muted',
    size: 10
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontSize: 14,
      color: c.done ? 'var(--text)' : 'var(--text-muted)'
    }
  }, c.n), c.done ? /*#__PURE__*/React.createElement(Tag, {
    dot: true,
    dotTone: "ok"
  }, "Done") : /*#__PURE__*/React.createElement(Button, {
    size: "xs"
  }, "Check")))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 16,
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary"
  }, "Sign off station"), /*#__PURE__*/React.createElement(Button, {
    variant: "danger"
  }, "Flag a problem"))));
}
const RECIPES = [{
  n: 'Elk Bolognese',
  st: 'Sauté',
  all: ['Dairy', 'Gluten'],
  yield: '12 portions',
  batch: '1 hotel pan',
  active: '45 min',
  total: '3 hr',
  ing: [{
    a: 3,
    u: 'lb',
    item: 'Ground elk',
    sub: '80/20, cold'
  }, {
    a: 8,
    u: 'oz',
    item: 'Pancetta',
    sub: 'small dice'
  }, {
    a: 2,
    u: 'cup',
    item: 'Soffritto',
    sub: 'onion / carrot / celery'
  }, {
    a: 1.5,
    u: 'cup',
    item: 'Dry red wine'
  }, {
    a: 28,
    u: 'oz',
    item: 'San Marzano',
    sub: 'hand-crushed'
  }, {
    a: 1,
    u: 'cup',
    item: 'Whole milk'
  }, {
    a: 4,
    u: 'oz',
    item: 'Parmesan rind + grated'
  }],
  method: ['Render pancetta over medium until fat is clear. Raise heat, brown elk hard in batches — no steaming.', 'Add soffritto, sweat to soft. Deglaze with red wine, reduce to nearly dry.', 'Add tomato and milk, drop in Parm rind. Bare simmer 2 hr, stirring occasionally.', 'Pull rind, adjust salt. Cool per two-stage log if holding.'],
  note: 'Doubles cleanly to 2 pans. Milk is not optional — it sets the texture.'
}, {
  n: 'Trout Amandine',
  st: 'Sauté',
  all: ['Fish', 'Tree nut', 'Dairy'],
  yield: '1 portion',
  batch: 'à la minute',
  active: '8 min',
  total: '8 min',
  ing: [{
    a: 1,
    u: 'ea',
    item: 'Trout fillet',
    sub: '6 oz, skin on'
  }, {
    a: 2,
    u: 'oz',
    item: 'Sliced almonds'
  }, {
    a: 3,
    u: 'tbsp',
    item: 'Butter',
    sub: 'to brown'
  }, {
    a: 0.5,
    u: 'ea',
    item: 'Lemon',
    sub: 'juice + supremes'
  }, {
    a: 1,
    u: 'tbsp',
    item: 'Parsley',
    sub: 'chopped'
  }],
  method: ['Dredge trout flesh-side in seasoned flour. Sear flesh-down in oil until golden, flip, finish.', 'Wipe pan, add butter + almonds, swirl to nut-brown.', 'Off heat: lemon juice, parsley. Spoon over fish, plate with supremes.'],
  note: 'GF on request — swap dredge for rice flour, drop the almonds for pepitas.'
}, {
  n: 'House Brine',
  st: 'Prep',
  all: [],
  yield: '2 gal',
  batch: '2 gal Cambro',
  active: '15 min',
  total: '30 min',
  ing: [{
    a: 2,
    u: 'gal',
    item: 'Water'
  }, {
    a: 12,
    u: 'oz',
    item: 'Kosher salt'
  }, {
    a: 8,
    u: 'oz',
    item: 'Brown sugar'
  }, {
    a: 6,
    u: 'ea',
    item: 'Bay leaf'
  }, {
    a: 2,
    u: 'tbsp',
    item: 'Black peppercorn',
    sub: 'cracked'
  }],
  method: ['Bring half the water to a boil with salt, sugar, aromatics. Stir to dissolve.', 'Kill heat, add remaining cold water to chill. Cool to under 40° before use.', 'Date + label. Holds 5 days.'],
  note: 'Never brine warm — pull to the walk-in the second it hits temp.'
}, {
  n: 'Demi-Glace',
  st: 'Sauce',
  all: [],
  yield: '2 qt',
  batch: '2 qt',
  active: '30 min',
  total: '6 hr',
  ing: [{
    a: 10,
    u: 'lb',
    item: 'Roasted veal bones'
  }, {
    a: 1,
    u: 'lb',
    item: 'Mirepoix'
  }, {
    a: 6,
    u: 'oz',
    item: 'Tomato paste'
  }, {
    a: 2,
    u: 'cup',
    item: 'Red wine'
  }, {
    a: 2,
    u: 'gal',
    item: 'Water / stock'
  }],
  method: ['Brown bones, add mirepoix, paste — pincé until deep.', 'Deglaze wine, cover with liquid, bare simmer 5–6 hr, skimming.', 'Strain, reduce to nappe, cool per log.'],
  note: 'The backbone of the sauce station. Never let it boil — you\u2019ll cloud it.'
}, {
  n: 'Pommes Purée',
  st: 'Sauté',
  all: ['Dairy'],
  yield: '10 portions',
  batch: '1/6 pan',
  active: '25 min',
  total: '45 min',
  ing: [{
    a: 3,
    u: 'lb',
    item: 'Yukon gold'
  }, {
    a: 8,
    u: 'oz',
    item: 'Butter',
    sub: 'cold, cubed'
  }, {
    a: 1,
    u: 'cup',
    item: 'Warm cream'
  }],
  method: ['Boil potatoes whole in salted water until fork-tender. Peel warm.', 'Rice, then mount over low heat with cold butter, then warm cream.', 'Pass through tamis. Season, hold at 140°+.'],
  note: 'Ratio is rich on purpose. Keep it moving on the flat-top so it doesn\u2019t skin.'
}, {
  n: 'Bison Ribeye',
  st: 'Grill',
  all: [],
  yield: '1 portion',
  batch: 'à la minute',
  active: '12 min',
  total: '20 min',
  ing: [{
    a: 1,
    u: 'ea',
    item: 'Bison ribeye',
    sub: '14 oz, tempered'
  }, {
    a: 1,
    u: 'tbsp',
    item: 'Beef tallow'
  }, {
    a: 2,
    u: 'sprig',
    item: 'Thyme'
  }, {
    a: 2,
    u: 'clove',
    item: 'Garlic',
    sub: 'smashed'
  }],
  method: ['Temper 30 min, salt hard. Grill over high for the cross-hatch.', 'Move to the flat-top, baste with tallow, thyme, garlic to temp — bison runs lean, pull 5° early.', 'Rest 6 min. Slice against the grain.'],
  note: 'Lean — never past medium or it seizes. Rest is non-negotiable.'
}];
function fmtAmt(a, mult) {
  const v = a * mult;
  const r = Math.round(v * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r);
}
function RecipeDetail({
  recipe,
  onBack
}) {
  const [mult, setMult] = React.useState(1);
  const step = d => setMult(m => Math.max(0.5, Math.round((m + d) * 2) / 2));
  return /*#__PURE__*/React.createElement("div", {
    className: "paper ck-book"
  }, /*#__PURE__*/React.createElement("button", {
    className: "ck-rback",
    onClick: onBack
  }, "\u2190 The book"), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-head"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "bk-eyebrow"
  }, recipe.st, " station \xB7 The Lariat"), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-title"
  }, recipe.n.split(' ').slice(0, -1).join(' '), " ", /*#__PURE__*/React.createElement("em", null, recipe.n.split(' ').slice(-1)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-facts"
  }, /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("b", null, recipe.yield), /*#__PURE__*/React.createElement("span", null, "Yield")), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("b", null, recipe.active), /*#__PURE__*/React.createElement("span", null, "Active")), /*#__PURE__*/React.createElement("div", {
    className: "f"
  }, /*#__PURE__*/React.createElement("b", null, recipe.total), /*#__PURE__*/React.createElement("span", null, "Total")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap',
      marginTop: 12
    }
  }, recipe.all.length ? recipe.all.map(a => /*#__PURE__*/React.createElement(Pill, {
    key: a,
    tone: "alert"
  }, a)) : /*#__PURE__*/React.createElement(Tag, {
    dot: true,
    dotTone: "ok"
  }, "No allergens")), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-grid"
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-sech"
  }, "Ingredients", /*#__PURE__*/React.createElement("span", {
    className: "ck-scaler"
  }, /*#__PURE__*/React.createElement("button", {
    onClick: () => step(-0.5)
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    className: "mult"
  }, "\xD7", mult), /*#__PURE__*/React.createElement("button", {
    onClick: () => step(0.5)
  }, "+"))), recipe.ing.map(i => /*#__PURE__*/React.createElement("div", {
    key: i.item,
    className: "ck-ing"
  }, /*#__PURE__*/React.createElement("span", null, i.item, i.sub && /*#__PURE__*/React.createElement("span", {
    className: "sub2"
  }, " \xB7 ", i.sub)), /*#__PURE__*/React.createElement("span", {
    className: "amt"
  }, fmtAmt(i.a, mult), " ", i.u))), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-note"
  }, recipe.note)), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-sech"
  }, "Method"), /*#__PURE__*/React.createElement("div", {
    className: "ck-method"
  }, recipe.method.map((m, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "step"
  }, m))))));
}
function RecipesScreen() {
  const [open, setOpen] = React.useState(null);
  const [q, setQ] = React.useState('');
  if (open) {
    const r = RECIPES.find(x => x.n === open);
    if (r) return /*#__PURE__*/React.createElement(RecipeDetail, {
      recipe: r,
      onBack: () => setOpen(null)
    });
  }
  const list = RECIPES.filter(r => r.n.toLowerCase().includes(q.toLowerCase()));
  return /*#__PURE__*/React.createElement("div", {
    className: "paper ck-book"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bk-eyebrow"
  }, "The Lariat \xB7 est. 1885"), /*#__PURE__*/React.createElement("h2", null, "The ", /*#__PURE__*/React.createElement("em", null, "book")), /*#__PURE__*/React.createElement("div", {
    className: "bk-sub"
  }, "Recipes, allergens, and scale \u2014 straight from the line. Tap a card to open it."), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 400,
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement(Input, {
    placeholder: "Search the book\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))',
      gap: 12
    }
  }, list.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.n,
    className: "ck-recipe",
    onClick: () => setOpen(r.n)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rn"
  }, r.n), /*#__PURE__*/React.createElement("div", {
    className: "rs"
  }, r.st, " \xB7 ", r.yield), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      flexWrap: 'wrap'
    }
  }, r.all.length ? r.all.map(a => /*#__PURE__*/React.createElement(Pill, {
    key: a,
    tone: "alert"
  }, a)) : /*#__PURE__*/React.createElement(Tag, null, "No allergens")))), list.length === 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      color: 'var(--text-muted)',
      fontFamily: 'var(--sans)'
    }
  }, "Nothing in the book by that name.")));
}

/* ── BEO — the banquet event order. A printed kraft-paper sheet with three
   tabs (Sheet / Fire / Prep), mirroring the real board: cream .paper surface,
   espresso ink, the copper implement for accents. ── */
const BEO = {
  ref: 'BEO #241122',
  who: ['Harvest', 'dinner'],
  client: 'Hillside Farm Co.',
  date: 'Sat · Nov 22',
  doors: '6:00p',
  guests: 140,
  room: 'Main room',
  lines: [{
    c: 'Pass',
    item: 'Smoked trout crostini',
    qty: '160 pc',
    fire: '5:45p',
    cost: 1.85,
    prep: 'Cure + smoke trout Thu; toast points day-of',
    station: 'Garde'
  }, {
    c: 'Pass',
    item: 'Whipped ricotta + hot honey',
    qty: '160 pc',
    fire: '5:45p',
    cost: 1.10,
    prep: 'Whip ricotta AM; warm honey at pass',
    station: 'Garde'
  }, {
    c: 'First',
    item: 'Chicory salad, cider vinaigrette',
    qty: '140 cv',
    fire: '6:30p',
    cost: 3.20,
    prep: 'Wash/pick chicories; build vinaigrette Fri',
    station: 'Garde'
  }, {
    c: 'Main',
    item: 'Braised bison short rib',
    qty: '96 cv',
    fire: '7:05p',
    cost: 14.40,
    prep: 'Braise Thu, cool + portion; reheat in jus',
    station: 'Sauté'
  }, {
    c: 'Main',
    item: 'Trout amandine (GF)',
    qty: '32 cv',
    fire: '7:05p',
    cost: 9.50,
    prep: 'Portion 6oz; brown butter à la minute',
    station: 'Sauté'
  }, {
    c: 'Main',
    item: 'Squash risotto (V)',
    qty: '12 cv',
    fire: '7:05p',
    cost: 5.10,
    prep: 'Par-cook risotto 75%; finish to order',
    station: 'Sauté'
  }, {
    c: 'Sweet',
    item: 'Burnt-sugar custard',
    qty: '140 cv',
    fire: '8:15p',
    cost: 2.35,
    prep: 'Bake Fri; torch tops at service',
    station: 'Pastry'
  }],
  prepDemands: [{
    item: 'Bison short rib',
    need: '108 lb',
    unit: 'raw',
    order: '3 cases'
  }, {
    item: 'Whole trout',
    need: '38 lb',
    unit: 'PNW',
    order: '4 cases'
  }, {
    item: 'Ricotta',
    need: '14 lb',
    unit: 'whole-milk',
    order: '2 tubs'
  }, {
    item: 'Chicories (mixed)',
    need: '22 lb',
    unit: 'picked',
    order: '30 lb raw'
  }, {
    item: 'Kabocha squash',
    need: '16 lb',
    unit: 'peeled',
    order: '24 lb raw'
  }, {
    item: 'Cream, heavy',
    need: '3 gal',
    unit: '—',
    order: '3 gal'
  }]
};
function beoTotals() {
  // per-guarantee food total from line costs × guest count share
  const food = BEO.lines.reduce((s, l) => {
    const per = parseInt(l.qty, 10);
    return s + l.cost * per;
  }, 0);
  const service = food * 0.20;
  const taxable = food + service;
  const tax = taxable * 0.089;
  return {
    food,
    service,
    tax,
    total: taxable + tax
  };
}
const $ = n => '$' + n.toLocaleString('en-US', {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
function fireTone(fire) {
  // demo: bison/trout/risotto (7:05p) = firing soon (amber), pass (5:45) done, sweet (8:15) upcoming
  const map = {
    '5:45p': ['ok', 'Fired'],
    '6:30p': ['ok', 'Fired'],
    '7:05p': ['warn', 'Fire soon'],
    '8:15p': ['neutral', 'Upcoming']
  };
  return map[fire] || ['neutral', 'Upcoming'];
}
function BeoScreen() {
  const [tab, setTab] = React.useState('sheet');
  const t = beoTotals();

  // group lines by station for the Fire tab
  const byStation = {};
  BEO.lines.forEach(l => {
    (byStation[l.station] = byStation[l.station] || []).push(l);
  });
  return /*#__PURE__*/React.createElement("div", {
    className: "paper ck-book"
  }, /*#__PURE__*/React.createElement("div", {
    className: "bk-eyebrow"
  }, "Banquet event order \xB7 ", BEO.ref), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-head"
  }, /*#__PURE__*/React.createElement("div", {
    className: "who"
  }, BEO.who[0], " ", /*#__PURE__*/React.createElement("em", null, BEO.who[1]), " \u2014 ", BEO.client), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-meta"
  }, /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, /*#__PURE__*/React.createElement("b", null, BEO.date), /*#__PURE__*/React.createElement("span", null, "Date")), /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, /*#__PURE__*/React.createElement("b", null, BEO.doors), /*#__PURE__*/React.createElement("span", null, "Doors")), /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, /*#__PURE__*/React.createElement("b", null, BEO.guests), /*#__PURE__*/React.createElement("span", null, "Guaranteed")), /*#__PURE__*/React.createElement("div", {
    className: "m"
  }, /*#__PURE__*/React.createElement("b", null, BEO.room), /*#__PURE__*/React.createElement("span", null, "Room")))), /*#__PURE__*/React.createElement("div", {
    className: "ck-ptabs"
  }, [['sheet', 'Prep sheet'], ['fire', 'Fire schedule'], ['prep', 'Prep demands']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: `ck-ptab ${tab === k ? 'on' : ''}`,
    onClick: () => setTab(k)
  }, l))), tab === 'sheet' && /*#__PURE__*/React.createElement("div", null, BEO.lines.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-row",
    style: {
      borderBottom: 'none',
      paddingBottom: 2
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "c"
  }, r.c), /*#__PURE__*/React.createElement("span", null, r.item), /*#__PURE__*/React.createElement("span", {
    className: "qty"
  }, r.qty), /*#__PURE__*/React.createElement("span", {
    className: "fire"
  }, "fire ", r.fire)), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-row",
    style: {
      paddingTop: 0
    }
  }, /*#__PURE__*/React.createElement("span", null), /*#__PURE__*/React.createElement("span", {
    className: "ck-beo-prepnote"
  }, /*#__PURE__*/React.createElement("b", null, "Prep"), r.prep), /*#__PURE__*/React.createElement("span", {
    className: "qty",
    style: {
      color: 'var(--text-muted)'
    }
  }, $(r.cost), "/cv"), /*#__PURE__*/React.createElement("span", null)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-invoice"
  }, /*#__PURE__*/React.createElement("div", {
    className: "r"
  }, /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, "Food \xB7 per guarantee"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, $(t.food))), /*#__PURE__*/React.createElement("div", {
    className: "r"
  }, /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, "Service fee \xB7 20%"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, $(t.service))), /*#__PURE__*/React.createElement("div", {
    className: "r"
  }, /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, "Sales tax \xB7 8.9%"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, $(t.tax))), /*#__PURE__*/React.createElement("div", {
    className: "r grand"
  }, /*#__PURE__*/React.createElement("span", {
    className: "l"
  }, "Total"), /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, $(t.total))))), tab === 'fire' && /*#__PURE__*/React.createElement("div", null, Object.entries(byStation).map(([st, lines]) => /*#__PURE__*/React.createElement("div", {
    key: st,
    className: "ck-fire-st"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-fire-sth"
  }, /*#__PURE__*/React.createElement("span", {
    className: "nm"
  }, st), /*#__PURE__*/React.createElement("span", {
    className: "ct"
  }, lines.length, " course", lines.length > 1 ? 's' : '')), lines.map((l, i) => {
    const [tone, label] = fireTone(l.fire);
    const color = tone === 'warn' ? 'var(--metal)' : tone === 'ok' ? 'var(--ok)' : 'var(--text-muted)';
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      className: "ck-fire-course"
    }, /*#__PURE__*/React.createElement("span", {
      className: "at",
      style: {
        color
      }
    }, l.fire), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      className: "lbl"
    }, l.item), /*#__PURE__*/React.createElement("div", {
      className: "lines"
    }, l.qty, " \xB7 ", l.c)), /*#__PURE__*/React.createElement("span", {
      className: "ck-fire-pill",
      style: {
        color,
        border: `1px solid ${color}`
      }
    }, label));
  }))), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-note"
  }, "Age-colored around each course's fire time \u2014 sage = fired, brass = fire within 30 min, muted = upcoming. Mirrors the KDS color convention.")), tab === 'prep' && /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "ck-beo-row",
    style: {
      gridTemplateColumns: '1fr auto auto',
      color: 'var(--text-muted)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "c"
  }, "Ingredient"), /*#__PURE__*/React.createElement("span", {
    className: "c",
    style: {
      textAlign: 'right'
    }
  }, "Total needed"), /*#__PURE__*/React.createElement("span", {
    className: "c",
    style: {
      textAlign: 'right'
    }
  }, "To order")), BEO.prepDemands.map((p, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "ck-prep-row"
  }, /*#__PURE__*/React.createElement("span", null, p.item, p.unit !== '—' && /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--text-muted)',
      fontSize: 11.5
    }
  }, " \xB7 ", p.unit)), /*#__PURE__*/React.createElement("span", {
    className: "need"
  }, p.need), /*#__PURE__*/React.createElement("span", {
    className: "order"
  }, p.order))), /*#__PURE__*/React.createElement("div", {
    className: "ck-rd-note"
  }, "Cascaded from the menu tree \xD7 ", BEO.guests, " guests. Feeds straight into the Order Guide.")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18,
      display: 'flex',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    style: {
      background: 'var(--copper)',
      borderColor: 'var(--copper)',
      color: '#fff8ec'
    }
  }, "Share BEO"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost"
  }, "Print sheet")));
}
window.Screens = {
  TodayScreen,
  EightySixScreen,
  TempLogScreen,
  InventoryScreen,
  StationScreen,
  RecipesScreen,
  BeoScreen
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit/Screens.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit/Shell.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
// Cockpit shell chrome — service strip, left rail ("The Line"), command bar.
// Ported from app/_components/{ServiceStrip,Sidebar,CommandBar}.jsx.
const {
  useState
} = React;
const {
  BrandStamp,
  StationRing
} = window.LariatLaRiOSDesignSystem_5761b2;
const Stamp = p => /*#__PURE__*/React.createElement(BrandStamp, _extends({
  decorative: true
}, p));
const PHASES = [{
  key: 'prep',
  label: 'Prep',
  t: '8a–11a',
  state: 'past'
}, {
  key: 'open',
  label: 'Open',
  t: '11a–5p',
  state: 'past'
}, {
  key: 'rush',
  label: 'Rush',
  t: '5p–10p',
  state: 'now'
}, {
  key: 'close',
  label: 'Close',
  t: '10p–12a',
  state: 'future'
}];
function ServiceStrip() {
  return /*#__PURE__*/React.createElement("header", {
    className: "ck-strip"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-mark"
  }, /*#__PURE__*/React.createElement(Stamp, null), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("b", null, "The Lariat"), /*#__PURE__*/React.createElement("i", null, "Kitchen Cockpit"))), /*#__PURE__*/React.createElement("div", {
    className: "ck-phases"
  }, PHASES.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.key,
    className: `ck-phase ${p.state}`
  }, /*#__PURE__*/React.createElement("span", {
    className: "pd"
  }), /*#__PURE__*/React.createElement("span", {
    className: "pl"
  }, p.label), /*#__PURE__*/React.createElement("span", {
    className: "pt"
  }, p.t)))), /*#__PURE__*/React.createElement("div", {
    className: "ck-status"
  }, /*#__PURE__*/React.createElement("span", null, "Fri \xB7 Nov 14"), /*#__PURE__*/React.createElement("span", {
    className: "clk"
  }, "6:38p"), /*#__PURE__*/React.createElement("span", {
    className: "ck-heat"
  }, "RUSH")));
}
const PRIMARY = [{
  id: 'today',
  name: 'Today',
  key: '0'
}, {
  id: 'eighty-six',
  name: '86 Board',
  key: '8'
}, {
  id: 'inventory',
  name: 'Stock',
  key: 'I'
}];
const BOOKS = [{
  id: 'recipes',
  name: 'Recipe Book',
  key: 'R'
}, {
  id: 'beo',
  name: 'BEO Board',
  key: 'B'
}];
const COMPLIANCE = [{
  id: 'temps',
  name: 'Temp Log',
  key: 'T'
}, {
  id: 'cooling',
  name: 'Cooling',
  key: 'C'
}];
function Sidebar({
  view,
  go,
  cook,
  setCook
}) {
  return /*#__PURE__*/React.createElement("aside", {
    className: "ck-side"
  }, /*#__PURE__*/React.createElement("div", {
    className: "ck-brand"
  }, /*#__PURE__*/React.createElement(Stamp, null), /*#__PURE__*/React.createElement("span", null, "The Line"), /*#__PURE__*/React.createElement("small", null, "Cockpit")), PRIMARY.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `ck-nav ${view === n.id ? 'active' : ''}`,
    onClick: () => go(n.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, n.key), /*#__PURE__*/React.createElement("span", null, n.name))), /*#__PURE__*/React.createElement("div", {
    className: "ck-navsec"
  }, /*#__PURE__*/React.createElement(Stamp, null), /*#__PURE__*/React.createElement("span", null, "Stations")), window.COCKPIT.stations.slice(0, 6).map((s, i) => {
    const label = s.flagged > 0 ? `${s.flagged} FLAGGED` : s.signedOff ? 'SIGNED OFF' : `${s.done}/${s.total}`;
    return /*#__PURE__*/React.createElement("button", {
      key: s.id,
      className: `ck-station ${view === 'station:' + s.id ? 'active' : ''}`,
      onClick: () => go('station:' + s.id)
    }, /*#__PURE__*/React.createElement(StationRing, {
      done: s.done,
      total: s.total,
      flagged: s.flagged,
      signedOff: s.signedOff,
      glyph: i + 1,
      size: 30
    }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("span", {
      className: "sn"
    }, s.name), /*#__PURE__*/React.createElement("span", {
      className: "ss"
    }, label)), /*#__PURE__*/React.createElement("span", {
      className: "sk"
    }, i + 1));
  }), /*#__PURE__*/React.createElement("div", {
    className: "ck-navsec"
  }, /*#__PURE__*/React.createElement(Stamp, null), /*#__PURE__*/React.createElement("span", null, "Books")), BOOKS.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `ck-nav ${view === n.id ? 'active' : ''}`,
    onClick: () => go(n.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, n.key), /*#__PURE__*/React.createElement("span", null, n.name))), /*#__PURE__*/React.createElement("div", {
    className: "ck-navsec"
  }, /*#__PURE__*/React.createElement(Stamp, null), /*#__PURE__*/React.createElement("span", null, "Compliance")), COMPLIANCE.map(n => /*#__PURE__*/React.createElement("button", {
    key: n.id,
    className: `ck-nav ${view === n.id ? 'active' : ''}`,
    onClick: () => go(n.id)
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, n.key), /*#__PURE__*/React.createElement("span", null, n.name))), /*#__PURE__*/React.createElement("div", {
    className: "ck-cook"
  }, /*#__PURE__*/React.createElement("label", null, "You're clocked in as"), /*#__PURE__*/React.createElement("select", {
    value: cook,
    onChange: e => setCook(e.target.value)
  }, window.COCKPIT.staff.map(s => /*#__PURE__*/React.createElement("option", {
    key: s.id,
    value: s.id
  }, s.name)))));
}
function CommandBar() {
  return /*#__PURE__*/React.createElement("footer", {
    className: "ck-cmd"
  }, /*#__PURE__*/React.createElement("div", {
    className: "grp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ck-slot"
  }, /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "\u2318"), /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "K"), " Jump"), /*#__PURE__*/React.createElement("span", {
    className: "ck-slot"
  }, /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "/"), " Search"), /*#__PURE__*/React.createElement("span", {
    className: "ck-slot"
  }, /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "1"), "\u2013", /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "6"), " Stations"), /*#__PURE__*/React.createElement("span", {
    className: "ck-slot"
  }, /*#__PURE__*/React.createElement("kbd", {
    className: "ck-kbd"
  }, "8"), " ", /*#__PURE__*/React.createElement("span", {
    className: "accent"
  }, "86"))), /*#__PURE__*/React.createElement("div", {
    className: "grp"
  }, /*#__PURE__*/React.createElement("span", {
    className: "ck-slot"
  }, "The Lariat ", /*#__PURE__*/React.createElement("span", {
    style: {
      opacity: .4
    }
  }, "\xB7"), " v2.4")));
}
window.Shell = {
  ServiceStrip,
  Sidebar,
  CommandBar,
  Stamp
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/cockpit/data.js
try { (() => {
// Fake service data for the Cockpit UI kit. Mirrors the shape the real app
// pulls from /api/stations, /api/eighty-six, etc. Kitchen-native copy.
window.COCKPIT = {
  stations: [{
    id: 'saute',
    name: 'Sauté',
    line: 'Hot line',
    done: 6,
    total: 6,
    flagged: 0,
    signedOff: true
  }, {
    id: 'grill',
    name: 'Grill',
    line: 'Hot line',
    done: 4,
    total: 6,
    flagged: 0,
    signedOff: false
  }, {
    id: 'garde',
    name: 'Garde Manger',
    line: 'Cold line',
    done: 1,
    total: 5,
    flagged: 0,
    signedOff: false
  }, {
    id: 'sauce',
    name: 'Sauce',
    line: 'Hot line',
    done: 3,
    total: 6,
    flagged: 2,
    signedOff: false
  }, {
    id: 'pastry',
    name: 'Pastry',
    line: 'Cold line',
    done: 5,
    total: 5,
    flagged: 0,
    signedOff: false
  }, {
    id: 'fry',
    name: 'Fry',
    line: 'Hot line',
    done: 0,
    total: 4,
    flagged: 0,
    signedOff: false
  }],
  eightySix: [{
    id: 1,
    item: 'Ribeye 12oz',
    by: 'Rosa M.',
    at: '5:42p'
  }, {
    id: 2,
    item: 'Elk Bolognese',
    by: 'Dev T.',
    at: '6:03p'
  }, {
    id: 3,
    item: 'Trout amandine',
    by: 'Rosa M.',
    at: '6:20p'
  }],
  maybeOut: ['Steak frites', 'Surf & turf', 'Beef tips'],
  inventory: [{
    id: 1,
    item: 'Ribeye 12oz',
    station: 'Grill',
    par: 40,
    onHand: 12,
    tone: 'alert',
    status: 'Low'
  }, {
    id: 2,
    item: 'House brine',
    station: 'Prep',
    par: 6,
    onHand: 6,
    tone: 'ok',
    status: 'OK'
  }, {
    id: 3,
    item: 'Pommes purée',
    station: 'Sauté',
    par: 24,
    onHand: 9,
    tone: 'warn',
    status: 'Watch'
  }, {
    id: 4,
    item: 'Demi-glace',
    station: 'Sauce',
    par: 8,
    onHand: 8,
    tone: 'ok',
    status: 'OK'
  }, {
    id: 5,
    item: 'Trout fillet',
    station: 'Sauté',
    par: 20,
    onHand: 3,
    tone: 'alert',
    status: 'Low'
  }, {
    id: 6,
    item: 'Butter, unsalted',
    station: 'Prep',
    par: 30,
    onHand: 22,
    tone: 'ok',
    status: 'OK'
  }],
  temps: [{
    id: 1,
    name: 'Walk-in cooler',
    ccp: 'CCP-1',
    temp: '38°F',
    tone: 'ok',
    status: 'In range'
  }, {
    id: 2,
    name: 'Reach-in, line',
    ccp: 'CCP-1',
    temp: '41°F',
    tone: 'warn',
    status: 'At limit'
  }, {
    id: 3,
    name: 'Hot hold, soup',
    ccp: 'CCP-3',
    temp: '128°F',
    tone: 'alert',
    status: 'Below 135°'
  }, {
    id: 4,
    name: 'Freezer',
    ccp: 'CCP-1',
    temp: '2°F',
    tone: 'ok',
    status: 'In range'
  }, {
    id: 5,
    name: 'Salad well',
    ccp: 'CCP-1',
    temp: '39°F',
    tone: 'ok',
    status: 'In range'
  }],
  staff: [{
    id: 'rosa',
    name: 'Rosa Mendez'
  }, {
    id: 'dev',
    name: 'Dev Tran'
  }, {
    id: 'kai',
    name: 'Kai Ostrander'
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/cockpit/data.js", error: String((e && e.message) || e) }); }

// ui_kits/concept-rail/Rail.jsx
try { (() => {
// Service Rail concept — time spine + attention queue + transient sheets + ⌘K.
const DSr = window.LariatLaRiOSDesignSystem_5761b2;
const {
  BrandStamp: Mark,
  Button: B,
  Pill: P,
  Tag: T,
  StatusDot: D,
  Bar: BarR,
  DataTable: TableR,
  Field: F,
  Input: I
} = DSr;
const SPINE = [{
  t: '3:00p',
  w: 'Prep list done',
  state: 'past'
}, {
  t: '4:30p',
  w: 'Stock counts',
  state: 'past'
}, {
  t: '5:45p',
  w: 'Fire — pass apps',
  state: 'past',
  sheet: 'fire'
}, {
  t: '6:30p',
  w: 'Fire — first course',
  state: 'past',
  sheet: 'fire'
}, {
  t: 'NOW'
}, {
  t: '7:00p',
  w: 'Doors — scene 2',
  state: 'now',
  sheet: 'stage'
}, {
  t: '7:05p',
  w: 'Fire — mains',
  state: 'next',
  sheet: 'fire'
}, {
  t: '8:00p',
  w: 'Break — Dev T.',
  state: 'next',
  sheet: 'breaks'
}, {
  t: '8:15p',
  w: 'Fire — sweet',
  state: 'next',
  sheet: 'fire'
}, {
  t: '8:30p',
  w: 'Temp walk',
  state: 'next',
  sheet: 'temps'
}, {
  t: '10:30p',
  w: 'Curfew — hard out',
  state: 'crit',
  sheet: 'stage'
}];
const QUEUE = [{
  id: 1,
  sev: 'crit',
  t: 'Hot hold — soup at 128°',
  s: 'Below 135° for 9 min. Reheat to 165° or toss.',
  src: 'Temp log',
  acts: [['Fix it', 'temps'], ['Log', 'temps']]
}, {
  id: 2,
  sev: 'crit',
  t: 'Kai missed the 10-min rest',
  s: 'On shift 4h at 8:00p — break or signed waiver required.',
  src: 'Breaks',
  acts: [['Start break', null], ['Waive', 'breaks']]
}, {
  id: 3,
  sev: 'warn',
  t: 'Ribeye at 12 of 40 par',
  s: '86 cascade would hit Steak frites + Surf & turf.',
  src: 'Stock',
  acts: [['86 watch', 'eightysix'], ['Order', null]]
}, {
  id: 4,
  sev: 'warn',
  t: 'Bright · 8 needs the check by 8:30',
  s: 'Pre-show table — kitchen pacing on mains now.',
  src: 'Floor',
  acts: [['Tell station', null]]
}, {
  id: 5,
  sev: 'info',
  t: 'Fire mains in 22 min',
  s: '96 rib · 32 trout · 12 risotto — pull backups now.',
  src: 'BEO',
  acts: [['Fire sheet', 'fire']]
}, {
  id: 6,
  sev: 'info',
  t: 'SPL trending near limit',
  s: '98 dB(A) against a 100 limit — set two starts at 9:20.',
  src: 'Sound',
  acts: [['Sound', null]]
}];
const QUIET = ['Sauté signed off — 6/6', 'Sanitizer wells logged, all in range', 'Shamrock delivery accepted at 3:14p', 'Walk-in holding 38°'];
const PALETTE = [{
  k: 'Board',
  w: 'Temp log',
  sheet: 'temps'
}, {
  k: 'Board',
  w: '86 board',
  sheet: 'eightysix'
}, {
  k: 'Board',
  w: 'Fire schedule — Harvest dinner',
  sheet: 'fire'
}, {
  k: 'Board',
  w: 'Breaks & leave',
  sheet: 'breaks'
}, {
  k: 'Board',
  w: 'Stage — run of show',
  sheet: 'stage'
}, {
  k: 'Do',
  w: '86 an item…',
  sheet: 'eightysix'
}, {
  k: 'Do',
  w: 'Log a temp…',
  sheet: 'temps'
}];

/* ── Sheets — transient boards ── */
function SheetTemps() {
  const rows = [{
    id: 1,
    n: 'Hot hold, soup',
    v: '128°F',
    tone: 'alert',
    s: 'Below 135°'
  }, {
    id: 2,
    n: 'Walk-in cooler',
    v: '38°F',
    tone: 'ok',
    s: 'In range'
  }, {
    id: 3,
    n: 'Reach-in, line',
    v: '41°F',
    tone: 'warn',
    s: 'At limit'
  }, {
    id: 4,
    n: 'Freezer',
    v: '2°F',
    tone: 'ok',
    s: 'In range'
  }];
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(TableR, {
    columns: [{
      key: 'n',
      label: 'Hold'
    }, {
      key: 'v',
      label: 'Temp',
      align: 'right'
    }, {
      key: 's',
      label: '',
      align: 'right'
    }],
    rows: rows.map(r => ({
      id: r.id,
      n: r.n,
      v: r.v,
      s: /*#__PURE__*/React.createElement(P, {
        tone: r.tone === 'alert' ? 'alert' : r.tone === 'warn' ? 'warn' : 'ok',
        dot: true
      }, r.s)
    }))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginTop: 14,
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(F, {
    label: "Log a temp"
  }, /*#__PURE__*/React.createElement(I, {
    placeholder: "e.g. Hot hold 165"
  }))), /*#__PURE__*/React.createElement(B, {
    variant: "primary"
  }, "Log")));
}
function SheetFire() {
  const rows = [{
    c: 'Mains',
    at: '7:05p',
    w: '96 rib · 32 trout · 12 risotto',
    tone: 'warn'
  }, {
    c: 'Sweet',
    at: '8:15p',
    w: '140 custard — torch at pass',
    tone: 'neutral'
  }];
  return /*#__PURE__*/React.createElement("div", null, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.c,
    style: {
      display: 'flex',
      gap: 12,
      alignItems: 'baseline',
      padding: '10px 2px',
      borderBottom: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      fontWeight: 700,
      color: r.tone === 'warn' ? 'var(--metal)' : 'var(--text-muted)',
      width: 52
    }
  }, r.at), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement("b", {
    style: {
      color: 'var(--text)'
    }
  }, r.c), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: 'var(--text-muted)',
      marginTop: 2
    }
  }, r.w)), /*#__PURE__*/React.createElement(P, {
    tone: r.tone === 'warn' ? 'warn' : 'neutral',
    dot: true
  }, r.tone === 'warn' ? 'Fire soon' : 'Upcoming'))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, "Full sheet lives on the BEO \u2014 this is tonight's slice."));
}
function SheetEightySix() {
  const [out, setOut] = React.useState(['Ribeye 12oz', 'Elk Bolognese', 'Trout amandine']);
  const [v, setV] = React.useState('');
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 8,
      marginBottom: 14,
      alignItems: 'flex-end'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1
    }
  }, /*#__PURE__*/React.createElement(F, {
    label: "86 an item"
  }, /*#__PURE__*/React.createElement(I, {
    value: v,
    onChange: e => setV(e.target.value),
    onKeyDown: e => {
      if (e.key === 'Enter' && v.trim()) {
        setOut([v.trim(), ...out]);
        setV('');
      }
    },
    placeholder: "e.g. Ribeye 12oz"
  }))), /*#__PURE__*/React.createElement(B, {
    variant: "danger",
    onClick: () => {
      if (v.trim()) {
        setOut([v.trim(), ...out]);
        setV('');
      }
    }
  }, "Out")), out.map(o => /*#__PURE__*/React.createElement("div", {
    key: o,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 2px',
      borderBottom: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement(D, {
    tone: "alert",
    size: 8
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontWeight: 600,
      color: 'var(--text)'
    }
  }, o), /*#__PURE__*/React.createElement(B, {
    size: "xs",
    variant: "ghost",
    onClick: () => setOut(out.filter(x => x !== o))
  }, "Back on"))));
}
function SheetBreaks() {
  return /*#__PURE__*/React.createElement("div", null, [['Rosa Mendez', 'Taken 5:10p', 'ok'], ['Dev Tran', 'Due by 8:00p', 'warn'], ['Kai Ostrander', 'Missed rest', 'alert'], ['Marta Ibáñez', 'Waived (signed)', 'neutral']].map(([n, s, tone]) => /*#__PURE__*/React.createElement("div", {
    key: n,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '9px 2px',
      borderBottom: '1px solid var(--hair)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontWeight: 600,
      color: 'var(--text)'
    }
  }, n), /*#__PURE__*/React.createElement(P, {
    tone: tone,
    dot: true
  }, s))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12
    }
  }, /*#__PURE__*/React.createElement(B, {
    variant: "primary"
  }, "Start a break")));
}
function SheetStage() {
  return /*#__PURE__*/React.createElement("div", null, [['7:00p', 'Doors · playlist scene 2', true], ['8:00p', 'Set one · 70 min', false], ['9:20p', 'Set two · 60 min', false], ['10:30p', 'Curfew — hard out', false]].map(([t, w, now]) => /*#__PURE__*/React.createElement("div", {
    key: t,
    style: {
      display: 'flex',
      gap: 12,
      padding: '9px 2px',
      borderBottom: '1px solid var(--hair)',
      alignItems: 'baseline'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'var(--mono)',
      color: now ? 'var(--accent)' : 'var(--text-muted)',
      width: 52,
      fontWeight: 700
    }
  }, t), /*#__PURE__*/React.createElement("span", {
    style: {
      color: now ? 'var(--accent)' : 'var(--text)',
      fontWeight: now ? 700 : 500
    }
  }, w))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 12,
      fontSize: 12,
      color: 'var(--text-muted)'
    }
  }, "Mixed \u2014 rail + hi-tops \xB7 cap 180 \xB7 changeover 35 min / 4 staff."));
}
const SHEETS = {
  temps: {
    title: 'Temp log',
    C: SheetTemps
  },
  fire: {
    title: 'Fire — Harvest dinner',
    C: SheetFire
  },
  eightysix: {
    title: "86 board",
    C: SheetEightySix
  },
  breaks: {
    title: 'Breaks & leave',
    C: SheetBreaks
  },
  stage: {
    title: 'Stage — run of show',
    C: SheetStage
  }
};
function RailApp() {
  const [queue, setQueue] = React.useState(QUEUE);
  const [sheet, setSheet] = React.useState(null);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');
  React.useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPal(p => !p);
      }
      if (e.key === 'Escape') {
        setPal(false);
        setSheet(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const resolve = id => setQueue(qs => qs.filter(x => x.id !== id));
  const results = PALETTE.filter(r => r.w.toLowerCase().includes(q.toLowerCase()));
  const Sh = sheet ? SHEETS[sheet] : null;
  return /*#__PURE__*/React.createElement("div", {
    className: "rail-app iron"
  }, /*#__PURE__*/React.createElement("header", {
    className: "rl-band"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mark"
  }, /*#__PURE__*/React.createElement(Mark, {
    decorative: true
  }), /*#__PURE__*/React.createElement("span", null, "The Lariat")), /*#__PURE__*/React.createElement("span", {
    className: "rl-stat hot"
  }, /*#__PURE__*/React.createElement("b", null, "3"), " 86'd"), /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "212"), " sold \xB7 ", /*#__PURE__*/React.createElement("b", null, "148"), " in"), /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "42"), " covers"), /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "96"), " dB"), /*#__PURE__*/React.createElement("span", {
    className: "clock"
  }, "Fri \xB7 6:38p \u2014 RUSH"), /*#__PURE__*/React.createElement("button", {
    className: "rl-kbd",
    onClick: () => setPal(true)
  }, "\u2318K \u2014 find or do anything")), /*#__PURE__*/React.createElement("nav", {
    className: "rl-spine"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, "The service day"), /*#__PURE__*/React.createElement("div", {
    className: "rl-track"
  }, SPINE.map((s, i) => s.t === 'NOW' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rl-now"
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    className: `rl-t ${s.state}`,
    onClick: () => s.sheet && setSheet(s.sheet)
  }, /*#__PURE__*/React.createElement("span", {
    className: "tt"
  }, s.t), /*#__PURE__*/React.createElement("span", {
    className: "tw"
  }, s.w))))), /*#__PURE__*/React.createElement("main", {
    className: "rl-queue"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-qhead"
  }, /*#__PURE__*/React.createElement("h1", null, "Needs a human"), /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, queue.length, " open \xB7 ranked by heat")), queue.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "rl-done"
  }, /*#__PURE__*/React.createElement("b", null, "Line is quiet."), "Nothing needs you \u2014 the spine will call the next fire."), queue.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    className: `rl-card ${c.sev}`
  }, /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, c.t), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, c.s)), /*#__PURE__*/React.createElement("span", {
    className: "src"
  }, c.src), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, c.acts.map(([label, target], i) => /*#__PURE__*/React.createElement(B, {
    key: label,
    size: "xs",
    variant: i === 0 ? c.sev === 'crit' ? 'danger' : 'primary' : 'ghost',
    onClick: () => {
      if (target) setSheet(target);else resolve(c.id);
    }
  }, label)), /*#__PURE__*/React.createElement(B, {
    size: "xs",
    variant: "ghost",
    onClick: () => resolve(c.id)
  }, "Done")))), /*#__PURE__*/React.createElement("div", {
    className: "rl-quiet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh"
  }, "Quiet \u2014 no action needed"), QUIET.map(w => /*#__PURE__*/React.createElement("div", {
    key: w,
    className: "qrow"
  }, /*#__PURE__*/React.createElement(D, {
    tone: "ok",
    size: 7
  }), w)))), Sh && /*#__PURE__*/React.createElement("aside", {
    className: "rl-sheet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sh-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, Sh.title), /*#__PURE__*/React.createElement(T, null, "esc"), /*#__PURE__*/React.createElement("button", {
    className: "rl-x",
    onClick: () => setSheet(null)
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "sh-body"
  }, /*#__PURE__*/React.createElement(Sh.C, null))), pal && /*#__PURE__*/React.createElement("div", {
    className: "rl-veil",
    onClick: () => setPal(false)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-pal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Find a board, or do a thing \u2014 '86 trout', 'log temp'\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  }), results.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.w,
    className: "row",
    onClick: () => {
      setSheet(r.sheet);
      setPal(false);
      setQ('');
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, r.k), r.w, /*#__PURE__*/React.createElement("span", {
    className: "hint"
  }, "\u21B5"))))));
}
window.RailApp = RailApp;
window.RailKit = {
  SHEETS,
  SPINE,
  QUEUE,
  QUIET,
  PALETTE
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/concept-rail/Rail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/concept-rail/RailViews.jsx
try { (() => {
// Service Rail v2 — role-aware. One system, three lenses:
//   COOK    — procedure-driven. The clock picks the run (opening / service /
//             closing); cards are steps in order; sheets carry the detail.
//   MANAGER — exception-driven. Full heat queue + PIN-gated approvals.
//   OFFICE  — batch-driven. A week spine and a deadline workbench, no rush UI.
const DSv = window.LariatLaRiOSDesignSystem_5761b2;
const {
  BrandStamp: MarkV,
  Button: Bv,
  Pill: Pv,
  Tag: Tv,
  StatusDot: Dv,
  Field: Fv,
  Input: Iv,
  DataTable: TableV
} = DSv;
const KIT = window.RailKit;

/* ══ COOK — procedure runs by daypart ══ */
const COOK = {
  opening: {
    label: 'Open the line',
    clock: 'Fri · 7:40a — OPENING',
    spine: [{
      t: '7:00a',
      w: 'Walk-in + holds temped',
      state: 'past',
      sheet: 'temps'
    }, {
      t: '7:30a',
      w: 'Sanitizer wells mixed',
      state: 'past'
    }, {
      t: 'NOW'
    }, {
      t: '8:00a',
      w: 'Line checks — all stations',
      state: 'now',
      sheet: 'linecheck'
    }, {
      t: '9:00a',
      w: 'Mise pull from walk-in',
      state: 'next'
    }, {
      t: '10:00a',
      w: 'Prep board — first pass',
      state: 'next'
    }, {
      t: '10:45a',
      w: 'Pre-open sign-off',
      state: 'next'
    }, {
      t: '11:00a',
      w: 'Doors',
      state: 'crit'
    }],
    steps: [{
      id: 'o1',
      done: true,
      t: 'Temp the walk-in + every hold',
      s: 'Walk-in 38° · freezer 2° · reach-ins logged.',
      src: 'Temp log',
      sheet: 'temps'
    }, {
      id: 'o2',
      done: true,
      t: 'Mix sanitizer wells — 200 ppm',
      s: 'All five wells logged in range.',
      src: 'Sanitizer'
    }, {
      id: 'o3',
      t: 'Run the Sauté line check',
      s: '6 checks — pans, mise dates, sauce temps, backups.',
      src: 'Stations',
      sheet: 'linecheck',
      up: true
    }, {
      id: 'o4',
      t: 'Run the Grill line check',
      s: '6 checks — grates, tallow, proteins tempered.',
      src: 'Stations',
      sheet: 'linecheck'
    }, {
      id: 'o5',
      t: 'Pull mise per prep board',
      s: 'Purée ×2, demi, brine bucket, chicories.',
      src: 'Prep',
      sheet: 'prepsheet'
    }, {
      id: 'o6',
      t: 'Sign off the line',
      s: 'All stations green before doors at 11:00a.',
      src: 'Today'
    }]
  },
  service: {
    label: 'Service',
    clock: 'Fri · 6:38p — RUSH',
    spine: KIT.SPINE,
    steps: [{
      id: 's1',
      sev: 'crit',
      t: 'Hot hold — soup at 128°',
      s: 'Below 135° for 9 min. Reheat to 165° or toss.',
      src: 'Temp log',
      sheet: 'temps'
    }, {
      id: 's2',
      sev: 'info',
      t: 'Fire mains in 22 min',
      s: '96 rib · 32 trout · 12 risotto — pull backups now.',
      src: 'BEO',
      sheet: 'fire'
    }, {
      id: 's3',
      sev: 'warn',
      t: 'Ribeye at 12 of 40 par',
      s: 'Tell the window before it cascades.',
      src: 'Stock',
      sheet: 'eightysix'
    }]
  },
  closing: {
    label: 'Close the line',
    clock: 'Fri · 11:05p — CLOSE',
    spine: [{
      t: '10:00p',
      w: 'Last seating',
      state: 'past'
    }, {
      t: '10:30p',
      w: 'TPHC discard check',
      state: 'past',
      sheet: 'temps'
    }, {
      t: 'NOW'
    }, {
      t: '11:00p',
      w: 'Cooling — into the log',
      state: 'now',
      sheet: 'cooling'
    }, {
      t: '11:15p',
      w: 'Date-mark everything held',
      state: 'next',
      sheet: 'datemarks'
    }, {
      t: '11:30p',
      w: 'Side work by station',
      state: 'next',
      sheet: 'sidework'
    }, {
      t: '12:00a',
      w: 'Manager sign-off',
      state: 'crit'
    }],
    steps: [{
      id: 'c1',
      done: true,
      t: 'Discard TPHC items past 4 hours',
      s: 'Butter board + aioli tossed, logged 10:32p.',
      src: 'TPHC'
    }, {
      id: 'c2',
      t: 'Start cooling logs',
      s: 'Demi 8qt + braise liquid 12qt into the two-stage log.',
      src: 'Cooling',
      sheet: 'cooling',
      up: true
    }, {
      id: 'c3',
      t: 'Date-mark holds for tomorrow',
      s: 'Everything wrapped gets a day dot — 7-day max.',
      src: 'Date marks',
      sheet: 'datemarks'
    }, {
      id: 'c4',
      t: 'Station side work',
      s: 'Slicer teardown · hood wipe · drains · rag buckets out.',
      src: 'Cleaning',
      sheet: 'sidework'
    }, {
      id: 'c5',
      t: 'Flag anything 86\u2019d for the morning',
      s: 'Ribeye + trout stay out until Shamrock lands.',
      src: '86 board',
      sheet: 'eightysix'
    }]
  }
};

/* ══ OFFICE — week spine + deadline workbench ══ */
const OFFICE = {
  clock: 'Fri · Nov 14 — WEEK 46',
  spine: [{
    t: 'MON',
    w: 'Invoices in — match 3',
    state: 'past',
    sheet: 'invoices'
  }, {
    t: 'TUE',
    w: 'Sysco order out',
    state: 'past'
  }, {
    t: 'WED',
    w: 'Shamrock delivery',
    state: 'past'
  }, {
    t: 'NOW'
  }, {
    t: 'FRI',
    w: 'Payroll + tip pool close',
    state: 'now',
    sheet: 'invoices'
  }, {
    t: 'SAT',
    w: 'BEO #241122 — Harvest dinner',
    state: 'next',
    sheet: 'fire'
  }, {
    t: 'SUN',
    w: 'Inventory full count',
    state: 'next'
  }, {
    t: 'THU',
    w: 'Order guide due 2:00p',
    state: 'crit'
  }],
  work: [{
    id: 'w1',
    sev: 'warn',
    t: '3 invoices to match',
    s: 'Sysco ×2, Shamrock ×1 — $2,214.66 against receiving.',
    src: 'Invoices',
    sheet: 'invoices'
  }, {
    id: 'w2',
    sev: 'warn',
    t: 'BEO needs final counts by 5p',
    s: 'Hillside Farm guarantee locks at 140 — kitchen is planning on it.',
    src: 'BEO',
    sheet: 'fire'
  }, {
    id: 'w3',
    sev: 'info',
    t: '2 wage notices to issue',
    s: 'Dev (rate change) + Marta (new hire).',
    src: 'People'
  }, {
    id: 'w4',
    sev: 'info',
    t: 'Rosa\u2019s review is overdue',
    s: 'Last review Aug 2025 — book 30 min pre-shift.',
    src: 'Reviews'
  }, {
    id: 'w5',
    sev: 'info',
    t: 'Price shock: trout +9%',
    s: 'Shamrock moved $8.90 → $9.70/lb. Costing shifts to 30.6%.',
    src: 'Costing'
  }]
};

/* ══ BOOKING (Lauren) — the season spine + pipeline workbench ══ */
const BOOKING = {
  clock: 'Fri · Nov 14 — SEASON',
  spine: [{
    t: 'NOV 14',
    w: 'Wrenfield & The Coyotes · tonight',
    state: 'now',
    sheet: 'stage'
  }, {
    t: 'NOV 15',
    w: 'Harvest dinner · private buyout',
    state: 'next',
    sheet: 'fire'
  }, {
    t: 'NOV 21',
    w: 'High Lonesome — announce',
    state: 'next',
    sheet: 'playbook'
  }, {
    t: 'NOV 22',
    w: 'Cold River Ramblers',
    state: 'next'
  }, {
    t: 'NOW'
  }, {
    t: 'DEC 5',
    w: 'On-sale — NYE show',
    state: 'crit',
    sheet: 'playbook'
  }, {
    t: 'DEC 12',
    w: 'Hold · Sage & The Saddle',
    state: 'next',
    sheet: 'offers'
  }, {
    t: 'DEC 31',
    w: 'NYE — The Del Rios',
    state: 'next'
  }],
  work: [{
    id: 'b1',
    sev: 'crit',
    t: 'Offer expires tomorrow — Sage & The Saddle',
    s: '$1,200 vs door 70/30 · Dec 12 hold. Agent needs an answer.',
    src: 'Booking',
    sheet: 'offers'
  }, {
    id: 'b2',
    sev: 'warn',
    t: 'NYE on-sale goes live Dec 5',
    s: 'Price advance $45 / door $55 — playbook + socials not scheduled yet.',
    src: 'Playbook',
    sheet: 'playbook'
  }, {
    id: 'b3',
    sev: 'warn',
    t: 'Tonight is at 88% — push the last 28',
    s: '212 of 240 sold. One story + the marquee board tonight.',
    src: 'Box office'
  }, {
    id: 'b4',
    sev: 'info',
    t: 'High Lonesome announce Fri',
    s: 'Assets in — needs the announce post + email blast queued.',
    src: 'Playbook',
    sheet: 'playbook'
  }, {
    id: 'b5',
    sev: 'info',
    t: 'W-9 + contract back from Cold River',
    s: 'Countersign and file before advance call Monday.',
    src: 'Booking'
  }],
  quiet: ['Tonight settled projection: $3,490 to artist', 'Del Rios contract countersigned', 'Radio spot running through Nov 21']
};

/* ══ STAGE (Steve) — show-day tech run + live room ══ */
const STAGE = {
  clock: 'Fri · 6:38p — DOORS 7:00p',
  spine: [{
    t: '3:00p',
    w: 'AVX power-up + line check',
    state: 'past',
    sheet: 'avx'
  }, {
    t: '4:00p',
    w: 'Load-in — Coyotes (5 pc)',
    state: 'past'
  }, {
    t: '5:00p',
    w: 'Stage set — mixed rail config',
    state: 'past',
    sheet: 'stage'
  }, {
    t: '6:00p',
    w: 'Soundcheck — full band',
    state: 'past',
    sheet: 'soundcheck'
  }, {
    t: 'NOW'
  }, {
    t: '7:00p',
    w: 'Doors — scene 2 · house 40%',
    state: 'now',
    sheet: 'spllog'
  }, {
    t: '8:00p',
    w: 'Set one · recall Coyotes v3',
    state: 'next',
    sheet: 'spllog'
  }, {
    t: '9:20p',
    w: 'Set two · encore patch live',
    state: 'next'
  }, {
    t: '10:30p',
    w: 'Curfew — hard out · strike',
    state: 'crit',
    sheet: 'avx'
  }],
  work: [{
    id: 't1',
    sev: 'warn',
    t: 'SPL trending 98 against a 100 limit',
    s: 'Two readings running arms the warn light — trim the mains 2 dB before set one.',
    src: 'SPL log',
    sheet: 'spllog'
  }, {
    id: 't2',
    sev: 'warn',
    t: 'Monitor 3 buzzing on the DI',
    s: 'Swap the DI or lift the ground before doors.',
    src: 'Soundcheck',
    sheet: 'soundcheck'
  }, {
    id: 't3',
    sev: 'info',
    t: 'Recall scene — Doors / playlist 2',
    s: 'House playlist, wash at 40%, marquee on.',
    src: 'Scenes',
    sheet: 'soundcheck'
  }, {
    id: 't4',
    sev: 'info',
    t: 'Confirm stream feed for NYE promo',
    s: 'AVX matrix out 2 → lobby screen; test 30s capture.',
    src: 'AVX',
    sheet: 'avx'
  }],
  quiet: ['Backline set — house kit + 2 DIs', 'Scenes saved: soundcheck · set 1 · set 2 · doors', 'SPL logging every 5s to the show record']
};

/* ══ MANAGER — full queue + approvals ══ */
const APPROVALS = [{
  id: 'a1',
  t: 'Rest-break waiver — Kai O.',
  s: 'Missed the 10-min rest. Waiver needs your PIN or send him now.',
  src: 'Breaks'
}, {
  id: 'a2',
  t: 'Void check #238 — $64.00',
  s: 'Rung wrong table. Second void tonight.',
  src: 'POS'
}];

/* ══ Extra sheets ══ */
function ChecklistSheet({
  items
}) {
  const [rows, setRows] = React.useState(items.map((w, i) => ({
    id: i,
    w,
    done: false
  })));
  return /*#__PURE__*/React.createElement("div", null, rows.map(r => /*#__PURE__*/React.createElement("div", {
    key: r.id,
    className: `rl-chk ${r.done ? 'done' : ''}`
  }, /*#__PURE__*/React.createElement(Dv, {
    tone: r.done ? 'ok' : 'muted',
    size: 9
  }), /*#__PURE__*/React.createElement("span", {
    className: "w"
  }, r.w), !r.done && /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    onClick: () => setRows(rows.map(x => x.id === r.id ? {
      ...x,
      done: true
    } : x))
  }, "Done"))));
}
const EXTRA_SHEETS = {
  linecheck: {
    title: 'Sauté — line check',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Pans oiled & staged', 'Mise labeled + dated', 'Sauce holding 140°+', 'Backups pulled', 'Station wiped + sanitized', 'Rag bucket 200 ppm']
    })
  },
  prepsheet: {
    title: 'Mise pull — this morning',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Pommes purée ×2 batches', 'Demi-glace, 2qt', 'Brine bucket to station', 'Chicories washed + picked', 'Trout portioned 6oz']
    })
  },
  cooling: {
    title: 'Cooling — two-stage log',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Demi 8qt — in at 11:02p, 96°', 'Braise liquid 12qt — in at 11:04p, 104°', 'Set 12:45a check alarm']
    })
  },
  datemarks: {
    title: 'Date marks — tonight',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Braised rib portions — day dot SUN', 'Purée 1/6 pans ×2 — day dot WED', 'Vinaigrette qt — day dot THU', 'Toss anything unlabeled']
    })
  },
  sidework: {
    title: 'Side work — close',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Slicer teardown + sanitize', 'Hood + flat-top wipe', 'Floor drains — dish pit', 'Rag buckets emptied', 'Trash out · mats hosed']
    })
  },
  invoices: {
    title: 'Invoices — to match',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Sysco #88121 — $1,204.18 vs receiving', 'Sysco #88144 — $412.02 vs receiving', 'Shamrock #5521 — $598.46 · 1 short noted']
    })
  },
  playbook: {
    title: 'Playbook — NYE on-sale',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Announce post — Dec 1, 10a', 'Email blast — Dec 5, 9a', 'On-sale link live — Dec 5, 10a', 'Marquee board copy', 'Radio spot ×2 weeks', 'Advance $45 / door $55 confirmed']
    })
  },
  offers: {
    title: 'Offer — Sage & The Saddle',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Guarantee $1,200 + 70/30 after door', 'Dec 12 · seated cabaret · cap 120', 'Backline: house kit OK', 'Lodging: 2 rooms · The Surf', 'Reply to agent — expires Sat']
    })
  },
  soundcheck: {
    title: 'Soundcheck — full band',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Line check — 24 ch · 6 mon', 'Kick + snare gate thresholds', 'Vox verb — plate, short', 'Monitor 3 DI buzz — swap/lift', 'Save scene: Coyotes v3']
    })
  },
  spllog: {
    title: 'SPL — decibel log',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Limit tonight: 100 dB(A) — scene set 1', 'Now: 96–98 trending near limit', 'Log reading · auto every 5s', 'Over-limit ×2 arms the warn light', 'Trim mains −2 dB if it rides 99+']
    })
  },
  avx: {
    title: 'AVX — house systems',
    C: () => /*#__PURE__*/React.createElement(ChecklistSheet, {
      items: ['Amps on — racks A/B green', 'Matrix: out 1 mains · out 2 lobby', 'Projector + marquee on schedule', 'Stream capture 30s test', 'Strike: amps → desk → racks, in order']
    })
  }
};

/* ══ Settings — a sheet, not a page. Role-scoped: device stuff is open;
   house rules are PIN-gated; show settings appear for stage/booking/mgr. ══ */
function SettingsSheet({
  theme,
  setTheme,
  role,
  setRole
}) {
  const Seg = ({
    options,
    value,
    onPick
  }) => /*#__PURE__*/React.createElement("span", {
    className: "rl-role",
    style: {
      marginLeft: 0
    }
  }, options.map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: value === k ? 'on' : '',
    onClick: () => onPick(k)
  }, l)));
  const Row = ({
    k,
    small,
    children,
    pin
  }) => /*#__PURE__*/React.createElement("div", {
    className: "rl-set"
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, k, small && /*#__PURE__*/React.createElement("small", null, small)), pin && /*#__PURE__*/React.createElement("span", {
    className: "pin",
    style: {
      fontFamily: 'var(--mono)',
      fontSize: 9,
      letterSpacing: '.14em',
      color: 'var(--accent)',
      border: '1px dashed var(--accent)',
      borderRadius: 2,
      padding: '2px 6px',
      fontWeight: 700
    }
  }, "PIN"), children);
  return /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    className: "rl-set-h"
  }, "This screen"), /*#__PURE__*/React.createElement(Row, {
    k: "Lens",
    small: "Who this screen works for. Stays set on this device."
  }, /*#__PURE__*/React.createElement(Seg, {
    options: [['cook', 'Cook'], ['manager', 'Mgr'], ['stage', 'Stage']],
    value: role,
    onPick: setRole
  })), /*#__PURE__*/React.createElement(Row, {
    k: "Theme",
    small: "Iron \u2014 neutral charcoal \xB7 Ledger \u2014 warm char"
  }, /*#__PURE__*/React.createElement(Seg, {
    options: [['iron', 'Iron'], ['ledger', 'Ledger']],
    value: theme,
    onPick: setTheme
  })), /*#__PURE__*/React.createElement(Row, {
    k: "Room",
    small: "Boards and counts scope to this room."
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "Main room"), /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost"
  }, "Change")), /*#__PURE__*/React.createElement("div", {
    className: "rl-set-h"
  }, "House rules"), /*#__PURE__*/React.createElement(Row, {
    k: "Cold hold limit",
    pin: true
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "41\xB0F")), /*#__PURE__*/React.createElement(Row, {
    k: "Hot hold limit",
    pin: true
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "135\xB0F")), /*#__PURE__*/React.createElement(Row, {
    k: "Break rule",
    small: "30 min meal per 5h \xB7 10 min rest per 4h",
    pin: true
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "CO default")), /*#__PURE__*/React.createElement(Row, {
    k: "Tip split",
    small: "Pool = hours \xD7 role points",
    pin: true
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "hours \xD7 points")), /*#__PURE__*/React.createElement(Row, {
    k: "Par templates",
    small: "Stock + bar pars by season",
    pin: true
  }, /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost"
  }, "Open")), /*#__PURE__*/React.createElement("div", {
    className: "rl-set-h"
  }, "Tonight's show"), /*#__PURE__*/React.createElement(Row, {
    k: "SPL limit",
    small: "Two over-limit readings arm the warn light"
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "100 dB(A)"), /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost"
  }, "Edit")), /*#__PURE__*/React.createElement(Row, {
    k: "Curfew",
    small: "Hard out \u2014 strike follows"
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "10:30p")), /*#__PURE__*/React.createElement("div", {
    className: "rl-set-h"
  }, "System"), /*#__PURE__*/React.createElement(Row, {
    k: "Cloud bridge",
    small: "Last synced 4:02p"
  }, /*#__PURE__*/React.createElement("span", {
    className: "v",
    style: {
      color: 'var(--ok)'
    }
  }, "\u25CF connected")), /*#__PURE__*/React.createElement(Row, {
    k: "Version"
  }, /*#__PURE__*/React.createElement("span", {
    className: "v"
  }, "LariatOS v2.4 \xB7 rail concept")));
}

/* ══ App ══ */
function RailApp2() {
  const [role, setRole] = React.useState('cook');
  const [theme, setTheme] = React.useState('iron');
  const [phase, setPhase] = React.useState('opening');
  const [sheet, setSheet] = React.useState(null);
  const [pal, setPal] = React.useState(false);
  const [q, setQ] = React.useState('');
  const [doneIds, setDoneIds] = React.useState({});
  React.useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPal(p => !p);
      }
      if (e.key === 'Escape') {
        setPal(false);
        setSheet(null);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
  const SHEETS = {
    ...KIT.SHEETS,
    ...EXTRA_SHEETS
  };
  const Sh = sheet ? SHEETS[sheet] : null;
  const mark = id => setDoneIds(d => ({
    ...d,
    [id]: true
  }));

  // role model
  const cook = COOK[phase];
  const spine = role === 'cook' ? cook.spine : role === 'office' ? OFFICE.spine : role === 'booking' ? BOOKING.spine : role === 'stage' ? STAGE.spine : KIT.SPINE;
  const clock = role === 'cook' ? cook.clock : role === 'office' ? OFFICE.clock : role === 'booking' ? BOOKING.clock : role === 'stage' ? STAGE.clock : 'Fri · 6:38p — RUSH';
  const spineLabel = role === 'office' ? 'The week' : role === 'booking' ? 'The season' : role === 'stage' ? 'Show day' : 'The service day';
  let cards,
    qTitle,
    qSub,
    run = null;
  if (role === 'cook') {
    const steps = cook.steps.filter(s => !doneIds[s.id] && !s.done);
    const total = cook.steps.length;
    const done = total - steps.length;
    cards = steps;
    qTitle = cook.label;
    qSub = phase === 'service' ? `${steps.length} open · cook line only` : `step ${Math.min(done + 1, total)} of ${total}`;
    run = phase === 'service' ? null : {
      done,
      total
    };
  } else if (role === 'manager') {
    cards = KIT.QUEUE.filter(c => !doneIds[c.id]);
    qTitle = 'Needs a human';
    qSub = `${cards.length} open · whole house`;
  } else if (role === 'booking') {
    cards = BOOKING.work.filter(c => !doneIds[c.id]);
    qTitle = 'The pipeline';
    qSub = `${cards.length} open · holds, on-sales, announces`;
  } else if (role === 'stage') {
    cards = STAGE.work.filter(c => !doneIds[c.id]);
    qTitle = 'The board';
    qSub = `${cards.length} open · sound, stage, AVX`;
  } else {
    cards = OFFICE.work.filter(c => !doneIds[c.id]);
    qTitle = 'The workbench';
    qSub = `${cards.length} open · deadlines, not clocks`;
  }
  return /*#__PURE__*/React.createElement("div", {
    className: `rail-app ${theme === 'iron' ? 'iron' : ''}`
  }, /*#__PURE__*/React.createElement("header", {
    className: "rl-band"
  }, /*#__PURE__*/React.createElement("span", {
    className: "mark"
  }, /*#__PURE__*/React.createElement(MarkV, {
    decorative: true
  }), /*#__PURE__*/React.createElement("span", null, "The Lariat")), /*#__PURE__*/React.createElement("span", {
    className: "rl-role"
  }, [['cook', 'Cook'], ['manager', 'Mgr'], ['office', 'Office'], ['booking', 'Booking'], ['stage', 'Stage']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: role === k ? 'on' : '',
    onClick: () => {
      setRole(k);
      setSheet(null);
    }
  }, l))), role === 'cook' && /*#__PURE__*/React.createElement("span", {
    className: "rl-phase"
  }, [['opening', '7a'], ['service', '6p'], ['closing', '11p']].map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    className: phase === k ? 'on' : '',
    onClick: () => {
      setPhase(k);
      setSheet(null);
    },
    title: "Simulate the clock"
  }, l))), (role === 'cook' || role === 'manager') && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat hot"
  }, /*#__PURE__*/React.createElement("b", null, "3"), " 86'd"), role === 'manager' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "4"), " on shift"), role === 'office' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "$1.5k"), " order due"), role === 'booking' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "212"), "/240 tonight"), role === 'booking' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "2"), " holds open"), role === 'stage' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "96"), " dB \xB7 lim 100"), role === 'stage' && /*#__PURE__*/React.createElement("span", {
    className: "rl-stat"
  }, /*#__PURE__*/React.createElement("b", null, "24"), " ch live"), /*#__PURE__*/React.createElement("span", {
    className: "clock"
  }, clock), /*#__PURE__*/React.createElement("button", {
    className: "rl-kbd",
    onClick: () => setSheet('settings'),
    title: "Settings"
  }, "\u2699"), /*#__PURE__*/React.createElement("button", {
    className: "rl-kbd",
    onClick: () => setPal(true)
  }, "\u2318K \u2014 find or do anything")), /*#__PURE__*/React.createElement("nav", {
    className: "rl-spine"
  }, /*#__PURE__*/React.createElement("div", {
    className: "lbl"
  }, spineLabel), /*#__PURE__*/React.createElement("div", {
    className: "rl-track"
  }, spine.map((s, i) => s.t === 'NOW' ? /*#__PURE__*/React.createElement("div", {
    key: i,
    className: "rl-now"
  }) : /*#__PURE__*/React.createElement("button", {
    key: i,
    className: `rl-t ${s.state}`,
    onClick: () => s.sheet && setSheet(s.sheet)
  }, /*#__PURE__*/React.createElement("span", {
    className: "tt"
  }, s.t), /*#__PURE__*/React.createElement("span", {
    className: "tw"
  }, s.w))))), /*#__PURE__*/React.createElement("main", {
    className: "rl-queue"
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-qhead"
  }, /*#__PURE__*/React.createElement("h1", null, qTitle), /*#__PURE__*/React.createElement("span", {
    className: "n"
  }, qSub)), run && /*#__PURE__*/React.createElement("div", {
    className: "rl-run"
  }, /*#__PURE__*/React.createElement("span", {
    className: "rt"
  }, cook.label), /*#__PURE__*/React.createElement("span", {
    className: "track"
  }, /*#__PURE__*/React.createElement("i", {
    style: {
      width: `${run.done / run.total * 100}%`
    }
  })), /*#__PURE__*/React.createElement("span", {
    className: "rn"
  }, run.done, "/", run.total, " done")), cards.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "rl-done"
  }, /*#__PURE__*/React.createElement("b", null, role === 'cook' ? phase === 'closing' ? 'Line is closed.' : 'Line is open.' : 'All clear.'), role === 'cook' ? 'Get a manager sign-off and clock out.' : 'Nothing needs you right now.'), cards.map((c, i) => /*#__PURE__*/React.createElement("div", {
    key: c.id,
    className: `rl-card ${c.sev || ''} ${c.up || role === 'cook' && phase !== 'service' && i === 0 ? 'up' : ''}`
  }, role === 'cook' && phase !== 'service' && /*#__PURE__*/React.createElement("span", {
    className: "step"
  }, cook.steps.findIndex(s => s.id === c.id) + 1), /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, c.t), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, c.s)), /*#__PURE__*/React.createElement("span", {
    className: "src"
  }, c.src), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, c.sheet && /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost",
    onClick: () => setSheet(c.sheet)
  }, "Open"), c.acts ? c.acts.map(([label, target], j) => /*#__PURE__*/React.createElement(Bv, {
    key: label,
    size: "xs",
    variant: j === 0 ? c.sev === 'crit' ? 'danger' : 'primary' : 'ghost',
    onClick: () => {
      if (target) setSheet(target);else mark(c.id);
    }
  }, label)) : /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "primary",
    onClick: () => mark(c.id)
  }, "Done"), c.acts && /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost",
    onClick: () => mark(c.id)
  }, "Done")))), role === 'manager' && /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 18
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-quiet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh"
  }, "Needs your PIN")), APPROVALS.filter(a => !doneIds[a.id]).map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    className: "rl-card rl-approve"
  }, /*#__PURE__*/React.createElement("div", {
    className: "body"
  }, /*#__PURE__*/React.createElement("div", {
    className: "t"
  }, a.t), /*#__PURE__*/React.createElement("div", {
    className: "s"
  }, a.s)), /*#__PURE__*/React.createElement("span", {
    className: "pin"
  }, "PIN"), /*#__PURE__*/React.createElement("div", {
    className: "acts"
  }, /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "primary",
    onClick: () => mark(a.id)
  }, "Approve"), /*#__PURE__*/React.createElement(Bv, {
    size: "xs",
    variant: "ghost",
    onClick: () => mark(a.id)
  }, "Deny"))))), /*#__PURE__*/React.createElement("div", {
    className: "rl-quiet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "qh"
  }, "Quiet \u2014 no action needed"), (role === 'office' ? ['Payroll draft balanced', 'All certs current except Kai (flagged)', 'Cloud bridge synced 4:02p'] : role === 'booking' ? BOOKING.quiet : role === 'stage' ? STAGE.quiet : KIT.QUIET).map(w => /*#__PURE__*/React.createElement("div", {
    key: w,
    className: "qrow"
  }, /*#__PURE__*/React.createElement(Dv, {
    tone: "ok",
    size: 7
  }), w)))), sheet === 'settings' ? /*#__PURE__*/React.createElement("aside", {
    className: "rl-sheet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sh-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, "Settings"), /*#__PURE__*/React.createElement(Tv, null, "esc"), /*#__PURE__*/React.createElement("button", {
    className: "rl-x",
    onClick: () => setSheet(null)
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "sh-body"
  }, /*#__PURE__*/React.createElement(SettingsSheet, {
    theme: theme,
    setTheme: setTheme,
    role: role,
    setRole: setRole
  }))) : Sh && /*#__PURE__*/React.createElement("aside", {
    className: "rl-sheet"
  }, /*#__PURE__*/React.createElement("div", {
    className: "sh-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "t"
  }, Sh.title), /*#__PURE__*/React.createElement(Tv, null, "esc"), /*#__PURE__*/React.createElement("button", {
    className: "rl-x",
    onClick: () => setSheet(null)
  }, "\xD7")), /*#__PURE__*/React.createElement("div", {
    className: "sh-body"
  }, /*#__PURE__*/React.createElement(Sh.C, null))), pal && /*#__PURE__*/React.createElement("div", {
    className: "rl-veil",
    onClick: () => setPal(false)
  }, /*#__PURE__*/React.createElement("div", {
    className: "rl-pal",
    onClick: e => e.stopPropagation()
  }, /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Find a board, or do a thing \u2014 '86 trout', 'log temp'\u2026",
    value: q,
    onChange: e => setQ(e.target.value)
  }), KIT.PALETTE.filter(r => r.w.toLowerCase().includes(q.toLowerCase())).map(r => /*#__PURE__*/React.createElement("div", {
    key: r.w,
    className: "row",
    onClick: () => {
      setSheet(r.sheet);
      setPal(false);
      setQ('');
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, r.k), r.w, /*#__PURE__*/React.createElement("span", {
    className: "hint"
  }, "\u21B5"))), 'settings'.includes(q.toLowerCase()) && /*#__PURE__*/React.createElement("div", {
    className: "row",
    onClick: () => {
      setSheet('settings');
      setPal(false);
      setQ('');
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "k"
  }, "Set"), "Settings \u2014 this screen & house rules", /*#__PURE__*/React.createElement("span", {
    className: "hint"
  }, "\u21B5")))));
}
window.RailApp2 = RailApp2;
window.RailRoles = {
  COOK,
  OFFICE,
  BOOKING,
  STAGE,
  APPROVALS,
  EXTRA_SHEETS,
  SettingsSheet
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/concept-rail/RailViews.jsx", error: String((e && e.message) || e) }); }

// ui_kits/concept-rail/tweaks-panel.jsx
try { (() => {
// @ds-adherence-ignore -- omelette starter scaffold (raw elements/hex/px by design)

/* BEGIN USAGE */
// tweaks-panel.jsx
// Reusable Tweaks shell + form-control helpers.
// Exports (to window): useTweaks, TweaksPanel, TweakSection, TweakRow, TweakSlider,
//   TweakToggle, TweakRadio, TweakSelect, TweakText, TweakNumber, TweakColor, TweakButton.
//
// Owns the host protocol (listens for __activate_edit_mode / __deactivate_edit_mode,
// posts __edit_mode_available / __edit_mode_set_keys / __edit_mode_dismissed) so
// individual prototypes don't re-roll it. Ships a consistent set of controls so you
// don't hand-draw <input type="range">, segmented radios, steppers, etc.
//
// Usage (in an HTML file that loads React + Babel):
//
//   const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
//     "primaryColor": "#D97757",
//     "palette": ["#D97757", "#29261b", "#f6f4ef"],
//     "fontSize": 16,
//     "density": "regular",
//     "dark": false
//   }/*EDITMODE-END*/;
//
//   function App() {
//     const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
//     return (
//       <div style={{ fontSize: t.fontSize, color: t.primaryColor }}>
//         Hello
//         <TweaksPanel>
//           <TweakSection label="Typography" />
//           <TweakSlider label="Font size" value={t.fontSize} min={10} max={32} unit="px"
//                        onChange={(v) => setTweak('fontSize', v)} />
//           <TweakRadio  label="Density" value={t.density}
//                        options={['compact', 'regular', 'comfy']}
//                        onChange={(v) => setTweak('density', v)} />
//           <TweakSection label="Theme" />
//           <TweakColor  label="Primary" value={t.primaryColor}
//                        options={['#D97757', '#2A6FDB', '#1F8A5B', '#7A5AE0']}
//                        onChange={(v) => setTweak('primaryColor', v)} />
//           <TweakColor  label="Palette" value={t.palette}
//                        options={[['#D97757', '#29261b', '#f6f4ef'],
//                                  ['#475569', '#0f172a', '#f1f5f9']]}
//                        onChange={(v) => setTweak('palette', v)} />
//           <TweakToggle label="Dark mode" value={t.dark}
//                        onChange={(v) => setTweak('dark', v)} />
//         </TweaksPanel>
//       </div>
//     );
//   }
//
// TweakRadio is the segmented control for 2–3 short options (auto-falls-back to
// TweakSelect past ~16/~10 chars per label); reach for TweakSelect directly when
// options are many or long. For color tweaks always curate 3-4 options rather than
// a free picker; an option can also be a whole 2–5 color palette (the stored value
// is the array). The Tweak* controls are a floor, not a ceiling — build custom
// controls inside the panel if a tweak calls for UI they don't cover.
/* END USAGE */
// ─────────────────────────────────────────────────────────────────────────────

const __TWEAKS_STYLE = `
  .twk-panel{position:fixed;right:16px;bottom:16px;z-index:2147483646;width:280px;
    max-height:calc(100vh - 32px);display:flex;flex-direction:column;
    transform:scale(var(--dc-inv-zoom,1));transform-origin:bottom right;
    background:rgba(250,249,247,.78);color:#29261b;
    -webkit-backdrop-filter:blur(24px) saturate(160%);backdrop-filter:blur(24px) saturate(160%);
    border:.5px solid rgba(255,255,255,.6);border-radius:14px;
    box-shadow:0 1px 0 rgba(255,255,255,.5) inset,0 12px 40px rgba(0,0,0,.18);
    font:11.5px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif;overflow:hidden}
  .twk-hd{display:flex;align-items:center;justify-content:space-between;
    padding:10px 8px 10px 14px;cursor:move;user-select:none}
  .twk-hd b{font-size:12px;font-weight:600;letter-spacing:.01em}
  .twk-x{appearance:none;border:0;background:transparent;color:rgba(41,38,27,.55);
    width:22px;height:22px;border-radius:6px;cursor:default;font-size:13px;line-height:1}
  .twk-x:hover{background:rgba(0,0,0,.06);color:#29261b}
  .twk-body{padding:2px 14px 14px;display:flex;flex-direction:column;gap:10px;
    overflow-y:auto;overflow-x:hidden;min-height:0;
    scrollbar-width:thin;scrollbar-color:rgba(0,0,0,.15) transparent}
  .twk-body::-webkit-scrollbar{width:8px}
  .twk-body::-webkit-scrollbar-track{background:transparent;margin:2px}
  .twk-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15);border-radius:4px;
    border:2px solid transparent;background-clip:content-box}
  .twk-body::-webkit-scrollbar-thumb:hover{background:rgba(0,0,0,.25);
    border:2px solid transparent;background-clip:content-box}
  .twk-row{display:flex;flex-direction:column;gap:5px}
  .twk-row-h{flex-direction:row;align-items:center;justify-content:space-between;gap:10px}
  .twk-lbl{display:flex;justify-content:space-between;align-items:baseline;
    color:rgba(41,38,27,.72)}
  .twk-lbl>span:first-child{font-weight:500}
  .twk-val{color:rgba(41,38,27,.5);font-variant-numeric:tabular-nums}

  .twk-sect{font-size:10px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;
    color:rgba(41,38,27,.45);padding:10px 0 0}
  .twk-sect:first-child{padding-top:0}

  .twk-field{appearance:none;box-sizing:border-box;width:100%;min-width:0;height:26px;padding:0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;
    background:rgba(255,255,255,.6);color:inherit;font:inherit;outline:none}
  .twk-field:focus{border-color:rgba(0,0,0,.25);background:rgba(255,255,255,.85)}
  select.twk-field{padding-right:22px;
    background-image:url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'><path fill='rgba(0,0,0,.5)' d='M0 0h10L5 6z'/></svg>");
    background-repeat:no-repeat;background-position:right 8px center}

  .twk-slider{appearance:none;-webkit-appearance:none;width:100%;height:4px;margin:6px 0;
    border-radius:999px;background:rgba(0,0,0,.12);outline:none}
  .twk-slider::-webkit-slider-thumb{-webkit-appearance:none;appearance:none;
    width:14px;height:14px;border-radius:50%;background:#fff;
    border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}
  .twk-slider::-moz-range-thumb{width:14px;height:14px;border-radius:50%;
    background:#fff;border:.5px solid rgba(0,0,0,.12);box-shadow:0 1px 3px rgba(0,0,0,.2);cursor:default}

  .twk-seg{position:relative;display:flex;padding:2px;border-radius:8px;
    background:rgba(0,0,0,.06);user-select:none}
  .twk-seg-thumb{position:absolute;top:2px;bottom:2px;border-radius:6px;
    background:rgba(255,255,255,.9);box-shadow:0 1px 2px rgba(0,0,0,.12);
    transition:left .15s cubic-bezier(.3,.7,.4,1),width .15s}
  .twk-seg.dragging .twk-seg-thumb{transition:none}
  .twk-seg button{appearance:none;position:relative;z-index:1;flex:1;border:0;
    background:transparent;color:inherit;font:inherit;font-weight:500;min-height:22px;
    border-radius:6px;cursor:default;padding:4px 6px;line-height:1.2;
    overflow-wrap:anywhere}

  .twk-toggle{position:relative;width:32px;height:18px;border:0;border-radius:999px;
    background:rgba(0,0,0,.15);transition:background .15s;cursor:default;padding:0}
  .twk-toggle[data-on="1"]{background:#34c759}
  .twk-toggle i{position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;
    background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.25);transition:transform .15s}
  .twk-toggle[data-on="1"] i{transform:translateX(14px)}

  .twk-num{display:flex;align-items:center;box-sizing:border-box;min-width:0;height:26px;padding:0 0 0 8px;
    border:.5px solid rgba(0,0,0,.1);border-radius:7px;background:rgba(255,255,255,.6)}
  .twk-num-lbl{font-weight:500;color:rgba(41,38,27,.6);cursor:ew-resize;
    user-select:none;padding-right:8px}
  .twk-num input{flex:1;min-width:0;height:100%;border:0;background:transparent;
    font:inherit;font-variant-numeric:tabular-nums;text-align:right;padding:0 8px 0 0;
    outline:none;color:inherit;-moz-appearance:textfield}
  .twk-num input::-webkit-inner-spin-button,.twk-num input::-webkit-outer-spin-button{
    -webkit-appearance:none;margin:0}
  .twk-num-unit{padding-right:8px;color:rgba(41,38,27,.45)}

  .twk-btn{appearance:none;height:26px;padding:0 12px;border:0;border-radius:7px;
    background:rgba(0,0,0,.78);color:#fff;font:inherit;font-weight:500;cursor:default}
  .twk-btn:hover{background:rgba(0,0,0,.88)}
  .twk-btn.secondary{background:rgba(0,0,0,.06);color:inherit}
  .twk-btn.secondary:hover{background:rgba(0,0,0,.1)}

  .twk-swatch{appearance:none;-webkit-appearance:none;width:56px;height:22px;
    border:.5px solid rgba(0,0,0,.1);border-radius:6px;padding:0;cursor:default;
    background:transparent;flex-shrink:0}
  .twk-swatch::-webkit-color-swatch-wrapper{padding:0}
  .twk-swatch::-webkit-color-swatch{border:0;border-radius:5.5px}
  .twk-swatch::-moz-color-swatch{border:0;border-radius:5.5px}

  .twk-chips{display:flex;gap:6px}
  .twk-chip{position:relative;appearance:none;flex:1;min-width:0;height:46px;
    padding:0;border:0;border-radius:6px;overflow:hidden;cursor:default;
    box-shadow:0 0 0 .5px rgba(0,0,0,.12),0 1px 2px rgba(0,0,0,.06);
    transition:transform .12s cubic-bezier(.3,.7,.4,1),box-shadow .12s}
  .twk-chip:hover{transform:translateY(-1px);
    box-shadow:0 0 0 .5px rgba(0,0,0,.18),0 4px 10px rgba(0,0,0,.12)}
  .twk-chip[data-on="1"]{box-shadow:0 0 0 1.5px rgba(0,0,0,.85),
    0 2px 6px rgba(0,0,0,.15)}
  .twk-chip>span{position:absolute;top:0;bottom:0;right:0;width:34%;
    display:flex;flex-direction:column;box-shadow:-1px 0 0 rgba(0,0,0,.1)}
  .twk-chip>span>i{flex:1;box-shadow:0 -1px 0 rgba(0,0,0,.1)}
  .twk-chip>span>i:first-child{box-shadow:none}
  .twk-chip svg{position:absolute;top:6px;left:6px;width:13px;height:13px;
    filter:drop-shadow(0 1px 1px rgba(0,0,0,.3))}
`;

// ── useTweaks ───────────────────────────────────────────────────────────────
// Single source of truth for tweak values. setTweak persists via the host
// (__edit_mode_set_keys → host rewrites the EDITMODE block on disk).
function useTweaks(defaults) {
  const [values, setValues] = React.useState(defaults);
  // Accepts either setTweak('key', value) or setTweak({ key: value, ... }) so a
  // useState-style call doesn't write a "[object Object]" key into the persisted
  // JSON block.
  const setTweak = React.useCallback((keyOrEdits, val) => {
    const edits = typeof keyOrEdits === 'object' && keyOrEdits !== null ? keyOrEdits : {
      [keyOrEdits]: val
    };
    setValues(prev => ({
      ...prev,
      ...edits
    }));
    window.parent.postMessage({
      type: '__edit_mode_set_keys',
      edits
    }, '*');
    // Same-window signal so in-page listeners (deck-stage rail thumbnails)
    // can react — the parent message only reaches the host, not peers.
    window.dispatchEvent(new CustomEvent('tweakchange', {
      detail: edits
    }));
  }, []);
  return [values, setTweak];
}

// ── TweaksPanel ─────────────────────────────────────────────────────────────
// Floating shell. Registers the protocol listener BEFORE announcing
// availability — if the announce ran first, the host's activate could land
// before our handler exists and the toolbar toggle would silently no-op.
// The close button posts __edit_mode_dismissed so the host's toolbar toggle
// flips off in lockstep; the host echoes __deactivate_edit_mode back which
// is what actually hides the panel.
function TweaksPanel({
  title = 'Tweaks',
  children
}) {
  const [open, setOpen] = React.useState(false);
  const dragRef = React.useRef(null);
  const offsetRef = React.useRef({
    x: 16,
    y: 16
  });
  const PAD = 16;
  const clampToViewport = React.useCallback(() => {
    const panel = dragRef.current;
    if (!panel) return;
    const w = panel.offsetWidth,
      h = panel.offsetHeight;
    const maxRight = Math.max(PAD, window.innerWidth - w - PAD);
    const maxBottom = Math.max(PAD, window.innerHeight - h - PAD);
    offsetRef.current = {
      x: Math.min(maxRight, Math.max(PAD, offsetRef.current.x)),
      y: Math.min(maxBottom, Math.max(PAD, offsetRef.current.y))
    };
    panel.style.right = offsetRef.current.x + 'px';
    panel.style.bottom = offsetRef.current.y + 'px';
  }, []);
  React.useEffect(() => {
    if (!open) return;
    clampToViewport();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', clampToViewport);
      return () => window.removeEventListener('resize', clampToViewport);
    }
    const ro = new ResizeObserver(clampToViewport);
    ro.observe(document.documentElement);
    return () => ro.disconnect();
  }, [open, clampToViewport]);
  React.useEffect(() => {
    const onMsg = e => {
      const t = e?.data?.type;
      if (t === '__activate_edit_mode') setOpen(true);else if (t === '__deactivate_edit_mode') setOpen(false);
    };
    window.addEventListener('message', onMsg);
    window.parent.postMessage({
      type: '__edit_mode_available'
    }, '*');
    return () => window.removeEventListener('message', onMsg);
  }, []);
  const dismiss = () => {
    setOpen(false);
    window.parent.postMessage({
      type: '__edit_mode_dismissed'
    }, '*');
  };
  const onDragStart = e => {
    const panel = dragRef.current;
    if (!panel) return;
    const r = panel.getBoundingClientRect();
    const sx = e.clientX,
      sy = e.clientY;
    const startRight = window.innerWidth - r.right;
    const startBottom = window.innerHeight - r.bottom;
    const move = ev => {
      offsetRef.current = {
        x: startRight - (ev.clientX - sx),
        y: startBottom - (ev.clientY - sy)
      };
      clampToViewport();
    };
    const up = () => {
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  };
  if (!open) return null;
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("style", null, __TWEAKS_STYLE), /*#__PURE__*/React.createElement("div", {
    ref: dragRef,
    className: "twk-panel",
    "data-omelette-chrome": "",
    style: {
      right: offsetRef.current.x,
      bottom: offsetRef.current.y
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-hd",
    onMouseDown: onDragStart
  }, /*#__PURE__*/React.createElement("b", null, title), /*#__PURE__*/React.createElement("button", {
    className: "twk-x",
    "aria-label": "Close tweaks",
    onMouseDown: e => e.stopPropagation(),
    onClick: dismiss
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "twk-body"
  }, children)));
}

// ── Layout helpers ──────────────────────────────────────────────────────────

function TweakSection({
  label,
  children
}) {
  return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "twk-sect"
  }, label), children);
}
function TweakRow({
  label,
  value,
  children,
  inline = false
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: inline ? 'twk-row twk-row-h' : 'twk-row'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label), value != null && /*#__PURE__*/React.createElement("span", {
    className: "twk-val"
  }, value)), children);
}

// ── Controls ────────────────────────────────────────────────────────────────

function TweakSlider({
  label,
  value,
  min = 0,
  max = 100,
  step = 1,
  unit = '',
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label,
    value: `${value}${unit}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "range",
    className: "twk-slider",
    min: min,
    max: max,
    step: step,
    value: value,
    onChange: e => onChange(Number(e.target.value))
  }));
}
function TweakToggle({
  label,
  value,
  onChange
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-row twk-row-h"
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-lbl"
  }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: "twk-toggle",
    "data-on": value ? '1' : '0',
    role: "switch",
    "aria-checked": !!value,
    onClick: () => onChange(!value)
  }, /*#__PURE__*/React.createElement("i", null)));
}
function TweakRadio({
  label,
  value,
  options,
  onChange
}) {
  const trackRef = React.useRef(null);
  const [dragging, setDragging] = React.useState(false);
  // The active value is read by pointer-move handlers attached for the lifetime
  // of a drag — ref it so a stale closure doesn't fire onChange for every move.
  const valueRef = React.useRef(value);
  valueRef.current = value;

  // Segments wrap mid-word once per-segment width runs out. The track is
  // ~248px (280 panel − 28 body pad − 4 seg pad), each button loses 12px
  // to its own padding, and 11.5px system-ui averages ~6.3px/char — so 2
  // options fit ~16 chars each, 3 fit ~10. Past that (or >3 options), fall
  // back to a dropdown rather than wrap.
  const labelLen = o => String(typeof o === 'object' ? o.label : o).length;
  const maxLen = options.reduce((m, o) => Math.max(m, labelLen(o)), 0);
  const fitsAsSegments = maxLen <= ({
    2: 16,
    3: 10
  }[options.length] ?? 0);
  if (!fitsAsSegments) {
    // <select> emits strings — map back to the original option value so the
    // fallback stays type-preserving (numbers, booleans) like the segment path.
    const resolve = s => {
      const m = options.find(o => String(typeof o === 'object' ? o.value : o) === s);
      return m === undefined ? s : typeof m === 'object' ? m.value : m;
    };
    return /*#__PURE__*/React.createElement(TweakSelect, {
      label: label,
      value: value,
      options: options,
      onChange: s => onChange(resolve(s))
    });
  }
  const opts = options.map(o => typeof o === 'object' ? o : {
    value: o,
    label: o
  });
  const idx = Math.max(0, opts.findIndex(o => o.value === value));
  const n = opts.length;
  const segAt = clientX => {
    const r = trackRef.current.getBoundingClientRect();
    const inner = r.width - 4;
    const i = Math.floor((clientX - r.left - 2) / inner * n);
    return opts[Math.max(0, Math.min(n - 1, i))].value;
  };
  const onPointerDown = e => {
    setDragging(true);
    const v0 = segAt(e.clientX);
    if (v0 !== valueRef.current) onChange(v0);
    const move = ev => {
      if (!trackRef.current) return;
      const v = segAt(ev.clientX);
      if (v !== valueRef.current) onChange(v);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    ref: trackRef,
    role: "radiogroup",
    onPointerDown: onPointerDown,
    className: dragging ? 'twk-seg dragging' : 'twk-seg'
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-seg-thumb",
    style: {
      left: `calc(2px + ${idx} * (100% - 4px) / ${n})`,
      width: `calc((100% - 4px) / ${n})`
    }
  }), opts.map(o => /*#__PURE__*/React.createElement("button", {
    key: o.value,
    type: "button",
    role: "radio",
    "aria-checked": o.value === value
  }, o.label))));
}
function TweakSelect({
  label,
  value,
  options,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("select", {
    className: "twk-field",
    value: value,
    onChange: e => onChange(e.target.value)
  }, options.map(o => {
    const v = typeof o === 'object' ? o.value : o;
    const l = typeof o === 'object' ? o.label : o;
    return /*#__PURE__*/React.createElement("option", {
      key: v,
      value: v
    }, l);
  })));
}
function TweakText({
  label,
  value,
  placeholder,
  onChange
}) {
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("input", {
    className: "twk-field",
    type: "text",
    value: value,
    placeholder: placeholder,
    onChange: e => onChange(e.target.value)
  }));
}
function TweakNumber({
  label,
  value,
  min,
  max,
  step = 1,
  unit = '',
  onChange
}) {
  const clamp = n => {
    if (min != null && n < min) return min;
    if (max != null && n > max) return max;
    return n;
  };
  const startRef = React.useRef({
    x: 0,
    val: 0
  });
  const onScrubStart = e => {
    e.preventDefault();
    startRef.current = {
      x: e.clientX,
      val: value
    };
    const decimals = (String(step).split('.')[1] || '').length;
    const move = ev => {
      const dx = ev.clientX - startRef.current.x;
      const raw = startRef.current.val + dx * step;
      const snapped = Math.round(raw / step) * step;
      onChange(clamp(Number(snapped.toFixed(decimals))));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };
  return /*#__PURE__*/React.createElement("div", {
    className: "twk-num"
  }, /*#__PURE__*/React.createElement("span", {
    className: "twk-num-lbl",
    onPointerDown: onScrubStart
  }, label), /*#__PURE__*/React.createElement("input", {
    type: "number",
    value: value,
    min: min,
    max: max,
    step: step,
    onChange: e => onChange(clamp(Number(e.target.value)))
  }), unit && /*#__PURE__*/React.createElement("span", {
    className: "twk-num-unit"
  }, unit));
}

// Relative-luminance contrast pick — checkmarks drawn over a swatch need to
// read on both #111 and #fafafa without per-option configuration. Hex input
// only (#rgb / #rrggbb); named or rgb()/hsl() colors fall through to "light".
function __twkIsLight(hex) {
  const h = String(hex).replace('#', '');
  const x = h.length === 3 ? h.replace(/./g, c => c + c) : h.padEnd(6, '0');
  const n = parseInt(x.slice(0, 6), 16);
  if (Number.isNaN(n)) return true;
  const r = n >> 16 & 255,
    g = n >> 8 & 255,
    b = n & 255;
  return r * 299 + g * 587 + b * 114 > 148000;
}
const __TwkCheck = ({
  light
}) => /*#__PURE__*/React.createElement("svg", {
  viewBox: "0 0 14 14",
  "aria-hidden": "true"
}, /*#__PURE__*/React.createElement("path", {
  d: "M3 7.2 5.8 10 11 4.2",
  fill: "none",
  strokeWidth: "2.2",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  stroke: light ? 'rgba(0,0,0,.78)' : '#fff'
}));

// TweakColor — curated color/palette picker. Each option is either a single
// hex string or an array of 1-5 hex strings; the card adapts — a lone color
// renders solid, a palette renders colors[0] as the hero (left ~2/3) with the
// rest stacked in a sharp column on the right. onChange emits the
// option in the shape it was passed (string stays string, array stays array).
// Without options it falls back to the native color input for back-compat.
function TweakColor({
  label,
  value,
  options,
  onChange
}) {
  if (!options || !options.length) {
    return /*#__PURE__*/React.createElement("div", {
      className: "twk-row twk-row-h"
    }, /*#__PURE__*/React.createElement("div", {
      className: "twk-lbl"
    }, /*#__PURE__*/React.createElement("span", null, label)), /*#__PURE__*/React.createElement("input", {
      type: "color",
      className: "twk-swatch",
      value: value,
      onChange: e => onChange(e.target.value)
    }));
  }
  // Native <input type=color> emits lowercase hex per the HTML spec, so
  // compare case-insensitively. String() guards JSON.stringify(undefined),
  // which returns the primitive undefined (no .toLowerCase).
  const key = o => String(JSON.stringify(o)).toLowerCase();
  const cur = key(value);
  return /*#__PURE__*/React.createElement(TweakRow, {
    label: label
  }, /*#__PURE__*/React.createElement("div", {
    className: "twk-chips",
    role: "radiogroup"
  }, options.map((o, i) => {
    const colors = Array.isArray(o) ? o : [o];
    const [hero, ...rest] = colors;
    const sup = rest.slice(0, 4);
    const on = key(o) === cur;
    return /*#__PURE__*/React.createElement("button", {
      key: i,
      type: "button",
      className: "twk-chip",
      role: "radio",
      "aria-checked": on,
      "data-on": on ? '1' : '0',
      "aria-label": colors.join(', '),
      title: colors.join(' · '),
      style: {
        background: hero
      },
      onClick: () => onChange(o)
    }, sup.length > 0 && /*#__PURE__*/React.createElement("span", null, sup.map((c, j) => /*#__PURE__*/React.createElement("i", {
      key: j,
      style: {
        background: c
      }
    }))), on && /*#__PURE__*/React.createElement(__TwkCheck, {
      light: __twkIsLight(hero)
    }));
  })));
}
function TweakButton({
  label,
  onClick,
  secondary = false
}) {
  return /*#__PURE__*/React.createElement("button", {
    type: "button",
    className: secondary ? 'twk-btn secondary' : 'twk-btn',
    onClick: onClick
  }, label);
}
Object.assign(window, {
  useTweaks,
  TweaksPanel,
  TweakSection,
  TweakRow,
  TweakSlider,
  TweakToggle,
  TweakRadio,
  TweakSelect,
  TweakText,
  TweakNumber,
  TweakColor,
  TweakButton
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/concept-rail/tweaks-panel.jsx", error: String((e && e.message) || e) }); }

__ds_ns.BrandStamp = __ds_scope.BrandStamp;

__ds_ns.StationRing = __ds_scope.StationRing;

__ds_ns.Avatar = __ds_scope.Avatar;

__ds_ns.Bar = __ds_scope.Bar;

__ds_ns.Button = __ds_scope.Button;

__ds_ns.Kpi = __ds_scope.Kpi;

__ds_ns.Pill = __ds_scope.Pill;

__ds_ns.StatusDot = __ds_scope.StatusDot;

__ds_ns.Tag = __ds_scope.Tag;

__ds_ns.Card = __ds_scope.Card;

__ds_ns.DataTable = __ds_scope.DataTable;

__ds_ns.Tabs = __ds_scope.Tabs;

__ds_ns.Field = __ds_scope.Field;

__ds_ns.Input = __ds_scope.Input;

__ds_ns.Select = __ds_scope.Select;

__ds_ns.Textarea = __ds_scope.Textarea;

})();
