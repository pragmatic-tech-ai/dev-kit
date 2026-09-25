/* @ds-bundle: {"format":3,"namespace":"PragmaticLabsDesignSystem_019de5","components":[],"sourceHashes":{"ui_kits/app/Components.jsx":"463483df6220","ui_kits/marketing/MarketingComponents.jsx":"ca5daa383373"},"inlinedExternals":[],"unexposedExports":[]} */

(() => {

const __ds_ns = (window.PragmaticLabsDesignSystem_019de5 = window.PragmaticLabsDesignSystem_019de5 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// ui_kits/app/Components.jsx
try { (() => {
// Atlas app components
const {
  useState,
  useEffect,
  useRef
} = React;
function Wordmark({
  size = 14
}) {
  const dotSize = Math.round(size * 0.28);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 700,
      fontSize: size,
      letterSpacing: '-0.01em',
      color: 'var(--fg-0)',
      display: 'inline-flex',
      alignItems: 'center'
    }
  }, "pragmatic", /*#__PURE__*/React.createElement("span", {
    style: {
      width: dotSize,
      height: dotSize,
      borderRadius: 999,
      background: 'var(--brand-green)',
      display: 'inline-block',
      margin: '0 2px 2px 2px'
    }
  }), "labs");
}
function AppShell({
  onOpenPalette
}) {
  return /*#__PURE__*/React.createElement("header", {
    style: {
      height: 48,
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 12px',
      gap: 12,
      background: 'var(--bg-0)',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      paddingRight: 12,
      borderRight: '1px solid var(--border)',
      height: '100%'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    width: "20",
    height: "20",
    viewBox: "0 0 64 64",
    fill: "none"
  }, /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "6",
    width: "52",
    height: "52",
    rx: "2",
    stroke: "currentColor",
    strokeWidth: "3.5"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "48",
    cy: "16",
    r: "6",
    fill: "#2EA862"
  })), /*#__PURE__*/React.createElement(Wordmark, {
    size: 13
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      fontSize: 13,
      color: 'var(--fg-1)'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontWeight: 500
    }
  }, "Northwind"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-3)'
    }
  }, "/"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--fg-2)'
    }
  }, "Platform"), /*#__PURE__*/React.createElement("i", {
    "data-lucide": "chevron-down",
    style: {
      width: 14,
      height: 14,
      color: 'var(--fg-3)',
      strokeWidth: 1.5,
      marginLeft: 2
    }
  })), /*#__PURE__*/React.createElement("button", {
    onClick: onOpenPalette,
    style: {
      marginLeft: 'auto',
      display: 'flex',
      alignItems: 'center',
      gap: 8,
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 6,
      padding: '5px 10px',
      fontFamily: 'var(--font-sans)',
      fontSize: 12,
      color: 'var(--fg-3)',
      cursor: 'pointer',
      minWidth: 240
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "search",
    style: {
      width: 13,
      height: 13,
      strokeWidth: 1.5
    }
  }), "Search or run a command", /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      padding: '1px 5px',
      background: 'var(--bg-2)',
      borderRadius: 3
    }
  }, "\u2318K")), /*#__PURE__*/React.createElement("button", {
    style: {
      background: 'transparent',
      border: 0,
      padding: 6,
      color: 'var(--fg-2)',
      cursor: 'pointer',
      borderRadius: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "bell",
    style: {
      width: 16,
      height: 16,
      strokeWidth: 1.5
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 28,
      height: 28,
      borderRadius: 999,
      background: '#2EA862',
      color: '#fff',
      fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 600,
      fontSize: 11,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center'
    }
  }, "JR"));
}
function Sidebar({
  active,
  onChange
}) {
  const sections = [{
    id: 'overview',
    label: 'Overview',
    icon: 'home'
  }, {
    id: 'map',
    label: 'Capability map',
    icon: 'layers',
    count: 142
  }, {
    id: 'adrs',
    label: 'Decisions',
    icon: 'file-text',
    count: 38
  }, {
    id: 'services',
    label: 'Service graph',
    icon: 'box',
    count: 61
  }, {
    id: 'activity',
    label: 'Activity',
    icon: 'activity'
  }];
  const recents = [{
    id: 'r1',
    label: 'Billing capability'
  }, {
    id: 'r2',
    label: 'ADR-0042 · Event sourcing'
  }, {
    id: 'r3',
    label: 'auth-service'
  }];
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 240,
      borderRight: '1px solid var(--border)',
      background: 'var(--bg-0)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0,
      padding: '12px 0'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '0 12px'
    }
  }, sections.map(s => /*#__PURE__*/React.createElement("button", {
    key: s.id,
    onClick: () => onChange(s.id),
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '7px 10px',
      borderRadius: 6,
      border: 0,
      background: active === s.id ? 'var(--bg-2)' : 'transparent',
      color: active === s.id ? 'var(--fg-0)' : 'var(--fg-1)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: active === s.id ? 500 : 400,
      cursor: 'pointer',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": s.icon,
    style: {
      width: 15,
      height: 15,
      strokeWidth: 1.5,
      color: 'var(--fg-2)'
    }
  }), s.label, s.count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      color: 'var(--fg-3)'
    }
  }, s.count)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      padding: '0 22px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)',
      marginBottom: 8
    }
  }, "Recent"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 4
    }
  }, recents.map(r => /*#__PURE__*/React.createElement("a", {
    key: r.id,
    href: "#",
    style: {
      fontSize: 12,
      color: 'var(--fg-2)',
      textDecoration: 'none',
      padding: '3px 0'
    }
  }, r.label)))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 'auto',
      padding: '12px',
      borderTop: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("button", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      width: '100%',
      padding: '7px 10px',
      borderRadius: 6,
      border: 0,
      background: 'transparent',
      color: 'var(--fg-2)',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      cursor: 'pointer',
      textAlign: 'left'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "settings",
    style: {
      width: 15,
      height: 15,
      strokeWidth: 1.5
    }
  }), "Settings")));
}
function Toolbar({
  zoom,
  onZoom
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 16,
      left: '50%',
      transform: 'translateX(-50%)',
      display: 'flex',
      alignItems: 'center',
      gap: 4,
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 12,
      padding: 4,
      boxShadow: 'var(--shadow-md)',
      backdropFilter: 'blur(12px)'
    }
  }, ['mouse-pointer-2', 'hand', 'square', 'spline'].map((ic, i) => /*#__PURE__*/React.createElement("button", {
    key: ic,
    style: {
      width: 32,
      height: 32,
      border: 0,
      background: i === 0 ? 'var(--bg-2)' : 'transparent',
      borderRadius: 8,
      cursor: 'pointer',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      color: 'var(--fg-1)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": ic,
    style: {
      width: 14,
      height: 14,
      strokeWidth: 1.5
    }
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 1,
      height: 20,
      background: 'var(--border)',
      margin: '0 4px'
    }
  }), /*#__PURE__*/React.createElement("button", {
    style: {
      width: 32,
      height: 32,
      border: 0,
      background: 'transparent',
      borderRadius: 8,
      cursor: 'pointer',
      color: 'var(--fg-1)'
    },
    onClick: () => onZoom(zoom - 10)
  }, "\u2212"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      color: 'var(--fg-2)',
      minWidth: 36,
      textAlign: 'center'
    }
  }, zoom, "%"), /*#__PURE__*/React.createElement("button", {
    style: {
      width: 32,
      height: 32,
      border: 0,
      background: 'transparent',
      borderRadius: 8,
      cursor: 'pointer',
      color: 'var(--fg-1)'
    },
    onClick: () => onZoom(zoom + 10)
  }, "+"));
}
function Canvas({
  selectedId,
  onSelect
}) {
  // A capability map rendered as a pseudo-canvas
  const nodes = [{
    id: 'customer',
    x: 80,
    y: 60,
    w: 180,
    h: 64,
    title: 'Customer',
    sub: '5 sub-capabilities',
    level: 1
  }, {
    id: 'product',
    x: 290,
    y: 60,
    w: 180,
    h: 64,
    title: 'Product',
    sub: '8 sub-capabilities',
    level: 1
  }, {
    id: 'operations',
    x: 500,
    y: 60,
    w: 180,
    h: 64,
    title: 'Operations',
    sub: '6 sub-capabilities',
    level: 1
  }, {
    id: 'identity',
    x: 60,
    y: 200,
    w: 130,
    h: 52,
    title: 'Identity',
    sub: 'L2',
    level: 2
  }, {
    id: 'onboarding',
    x: 200,
    y: 200,
    w: 130,
    h: 52,
    title: 'Onboarding',
    sub: 'L2',
    level: 2
  }, {
    id: 'catalog',
    x: 340,
    y: 200,
    w: 130,
    h: 52,
    title: 'Catalog',
    sub: 'L2',
    level: 2
  }, {
    id: 'pricing',
    x: 480,
    y: 200,
    w: 130,
    h: 52,
    title: 'Pricing',
    sub: 'L2',
    level: 2
  }, {
    id: 'billing',
    x: 620,
    y: 200,
    w: 130,
    h: 52,
    title: 'Billing',
    sub: 'L2 · 12 services',
    level: 2,
    highlight: true
  }];
  const edges = [['customer', 'identity'], ['customer', 'onboarding'], ['product', 'catalog'], ['product', 'pricing'], ['operations', 'billing']];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      position: 'relative',
      background: 'var(--bg-0)',
      overflow: 'hidden',
      backgroundImage: 'radial-gradient(circle, var(--neutral-300) 1px, transparent 1px)',
      backgroundSize: '24px 24px',
      backgroundPosition: '0 0'
    }
  }, /*#__PURE__*/React.createElement("svg", {
    style: {
      position: 'absolute',
      inset: 0,
      width: '100%',
      height: '100%',
      pointerEvents: 'none'
    }
  }, edges.map(([a, b], i) => {
    const A = byId[a],
      B = byId[b];
    return /*#__PURE__*/React.createElement("path", {
      key: i,
      d: `M${A.x + A.w / 2},${A.y + A.h} L${B.x + B.w / 2},${B.y}`,
      stroke: "var(--border-strong)",
      strokeWidth: "1",
      fill: "none"
    });
  })), nodes.map(n => /*#__PURE__*/React.createElement("div", {
    key: n.id,
    onClick: () => onSelect(n.id),
    style: {
      position: 'absolute',
      left: n.x,
      top: n.y,
      width: n.w,
      height: n.h,
      background: n.highlight ? 'var(--brand-green-soft)' : 'var(--bg-1)',
      border: selectedId === n.id ? '2px solid var(--brand-green)' : n.highlight ? '1px solid var(--brand-green)' : '1px solid var(--border)',
      borderRadius: 8,
      padding: '10px 14px',
      cursor: 'pointer',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      fontFamily: 'JetBrains Mono, monospace',
      boxShadow: selectedId === n.id ? '0 0 0 2px var(--brand-green-soft)' : 'none',
      transition: 'border-color 120ms cubic-bezier(0.2,0,0,1)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontWeight: 600,
      fontSize: 12,
      color: 'var(--fg-0)'
    }
  }, n.title), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 10,
      color: 'var(--fg-2)',
      marginTop: 2
    }
  }, n.sub))), /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      bottom: 16,
      left: 16,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, "CAPABILITY MAP \u2014 RETAIL \xB7 v3.2"));
}
function Inspector({
  nodeId
}) {
  const data = {
    customer: {
      title: 'Customer',
      kind: 'Domain',
      owner: 'platform-team',
      level: 1,
      services: 14,
      adrs: 6,
      status: 'mature'
    },
    billing: {
      title: 'Billing',
      kind: 'Capability',
      owner: 'billing-team',
      level: 2,
      services: 12,
      adrs: 4,
      status: 'evolving'
    },
    onboarding: {
      title: 'Onboarding',
      kind: 'Capability',
      owner: 'growth-team',
      level: 2,
      services: 7,
      adrs: 3,
      status: 'evolving'
    }
  }[nodeId] || {
    title: 'Nothing selected',
    kind: '—',
    owner: '—',
    level: '—',
    services: 0,
    adrs: 0,
    status: '—'
  };
  return /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 320,
      borderLeft: '1px solid var(--border)',
      background: 'var(--bg-0)',
      display: 'flex',
      flexDirection: 'column',
      flexShrink: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, data.kind), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 18,
      fontWeight: 600,
      marginTop: 4,
      letterSpacing: '-0.01em',
      color: 'var(--fg-0)'
    }
  }, data.title), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 6,
      marginTop: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      fontWeight: 500,
      padding: '3px 8px',
      borderRadius: 2,
      background: 'var(--state-success-soft)',
      color: 'var(--state-success)'
    }
  }, data.status), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      fontWeight: 500,
      padding: '3px 8px',
      borderRadius: 2,
      background: 'var(--bg-2)',
      color: 'var(--fg-1)'
    }
  }, "L", data.level))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "Owner",
    value: data.owner
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Services",
    value: data.services
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Decisions",
    value: data.adrs
  }), /*#__PURE__*/React.createElement(Field, {
    label: "Last edited",
    value: "2 days ago"
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '14px 18px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)',
      marginBottom: 10
    }
  }, "Recent decisions"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, [{
    id: 'ADR-0042',
    title: 'Adopt event sourcing',
    status: 'accepted'
  }, {
    id: 'ADR-0038',
    title: 'Move to per-tenant DB',
    status: 'accepted'
  }, {
    id: 'ADR-0034',
    title: 'Drop synchronous webhook',
    status: 'superseded'
  }].map(a => /*#__PURE__*/React.createElement("div", {
    key: a.id,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '6px 0'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      color: 'var(--fg-3)',
      minWidth: 60
    }
  }, a.id), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: 'var(--fg-1)',
      flex: 1
    }
  }, a.title), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      color: a.status === 'accepted' ? 'var(--state-success)' : 'var(--fg-3)'
    }
  }, a.status))))));
}
function Field({
  label,
  value
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      color: 'var(--fg-3)',
      minWidth: 80,
      textTransform: 'uppercase',
      letterSpacing: '0.05em'
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: 'var(--fg-0)'
    }
  }, value));
}
function CommandPalette({
  open,
  onClose
}) {
  if (!open) return null;
  const items = [{
    ic: 'plus',
    label: 'Create capability',
    kbd: '↵'
  }, {
    ic: 'plus',
    label: 'Create ADR'
  }, {
    ic: 'search',
    label: 'Find capability "billing"'
  }, {
    ic: 'git-branch',
    label: 'View service graph'
  }, {
    ic: 'arrow-right',
    label: 'Go to Settings'
  }];
  return /*#__PURE__*/React.createElement("div", {
    onClick: onClose,
    style: {
      position: 'fixed',
      inset: 0,
      background: 'rgba(10,10,11,0.40)',
      display: 'flex',
      alignItems: 'flex-start',
      justifyContent: 'center',
      paddingTop: 120,
      zIndex: 100
    }
  }, /*#__PURE__*/React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      width: 520,
      background: 'var(--bg-1)',
      border: '1px solid var(--border)',
      borderRadius: 10,
      boxShadow: 'var(--shadow-lg)',
      overflow: 'hidden'
    }
  }, /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    placeholder: "Search or run a command\u2026",
    style: {
      width: '100%',
      padding: '14px 18px',
      border: 0,
      fontFamily: 'var(--font-sans)',
      fontSize: 14,
      color: 'var(--fg-0)',
      borderBottom: '1px solid var(--border)',
      outline: 'none',
      background: 'transparent'
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: 6
    }
  }, items.map((it, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: 10,
      padding: '8px 12px',
      borderRadius: 6,
      background: i === 0 ? 'var(--bg-2)' : 'transparent',
      fontSize: 13,
      color: 'var(--fg-1)',
      cursor: 'pointer'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": it.ic,
    style: {
      width: 14,
      height: 14,
      strokeWidth: 1.5,
      color: 'var(--fg-2)'
    }
  }), it.label, it.kbd && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: 'auto',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      color: 'var(--fg-3)'
    }
  }, it.kbd)))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: '8px 14px',
      borderTop: '1px solid var(--border)',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      color: 'var(--fg-3)',
      display: 'flex',
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u2191\u2193 navigate"), /*#__PURE__*/React.createElement("span", null, "\u21B5 select"), /*#__PURE__*/React.createElement("span", null, "esc close"))));
}
function ADRList() {
  const adrs = [{
    id: 'ADR-0042',
    title: 'Adopt event sourcing for billing',
    author: 'PS',
    date: '2026-04-28',
    status: 'accepted'
  }, {
    id: 'ADR-0041',
    title: 'Move auth-service to Rust',
    author: 'JR',
    date: '2026-04-22',
    status: 'in review'
  }, {
    id: 'ADR-0040',
    title: 'Per-tenant database isolation',
    author: 'AL',
    date: '2026-04-15',
    status: 'accepted'
  }, {
    id: 'ADR-0039',
    title: 'Drop synchronous webhook delivery',
    author: 'MK',
    date: '2026-04-10',
    status: 'superseded'
  }, {
    id: 'ADR-0038',
    title: 'Standardize on OpenTelemetry',
    author: 'PS',
    date: '2026-04-02',
    status: 'accepted'
  }];
  const colors = {
    'accepted': ['var(--state-success-soft)', 'var(--state-success)'],
    'in review': ['var(--state-info-soft)', 'var(--state-info)'],
    'superseded': ['var(--bg-2)', 'var(--fg-2)']
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      padding: '32px 48px',
      overflowY: 'auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      alignItems: 'baseline',
      gap: 12,
      marginBottom: 24
    }
  }, /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 28,
      fontWeight: 600,
      letterSpacing: '-0.01em',
      margin: 0,
      color: 'var(--fg-0)'
    }
  }, "Decisions"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      color: 'var(--fg-3)'
    }
  }, adrs.length, " of 38"), /*#__PURE__*/React.createElement("button", {
    style: {
      marginLeft: 'auto',
      padding: '7px 12px',
      borderRadius: 6,
      border: 0,
      background: 'var(--brand-green)',
      color: '#fff',
      fontFamily: 'var(--font-sans)',
      fontSize: 13,
      fontWeight: 500,
      cursor: 'pointer',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": "plus",
    style: {
      width: 13,
      height: 13,
      strokeWidth: 2
    }
  }), "New ADR")), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--border)',
      borderRadius: 10,
      background: 'var(--bg-1)',
      overflow: 'hidden'
    }
  }, adrs.map((a, i) => {
    const [bg, fg] = colors[a.status];
    return /*#__PURE__*/React.createElement("div", {
      key: a.id,
      style: {
        display: 'grid',
        gridTemplateColumns: '90px 1fr 90px 90px 100px',
        alignItems: 'center',
        padding: '14px 20px',
        gap: 16,
        borderBottom: i < adrs.length - 1 ? '1px solid var(--border)' : '0',
        fontSize: 13
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        color: 'var(--fg-3)'
      }
    }, a.id), /*#__PURE__*/React.createElement("span", {
      style: {
        color: 'var(--fg-0)',
        fontWeight: 500
      }
    }, a.title), /*#__PURE__*/React.createElement("span", {
      style: {
        width: 24,
        height: 24,
        borderRadius: 999,
        background: '#5F5C56',
        color: '#fff',
        fontFamily: 'JetBrains Mono, monospace',
        fontWeight: 600,
        fontSize: 10,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    }, a.author), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 11,
        color: 'var(--fg-2)'
      }
    }, a.date), /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: 'JetBrains Mono, monospace',
        fontSize: 10,
        padding: '3px 8px',
        borderRadius: 2,
        background: bg,
        color: fg,
        justifySelf: 'start'
      }
    }, a.status));
  })));
}
Object.assign(window, {
  AppShell,
  Sidebar,
  Toolbar,
  Canvas,
  Inspector,
  CommandPalette,
  ADRList
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/app/Components.jsx", error: String((e && e.message) || e) }); }

// ui_kits/marketing/MarketingComponents.jsx
try { (() => {
// Pragmatic Labs marketing components
const {
  useState
} = React;
function Wordmark({
  size = 18,
  color
}) {
  const dotSize = Math.round(size * 0.28);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontWeight: 700,
      fontSize: size,
      letterSpacing: '-0.01em',
      color: color || 'var(--fg-0)',
      display: 'inline-flex',
      alignItems: 'center',
      gap: 1
    }
  }, "pragmatic", /*#__PURE__*/React.createElement("span", {
    style: {
      width: dotSize,
      height: dotSize,
      borderRadius: 999,
      background: 'var(--brand-green)',
      display: 'inline-block',
      margin: '0 2px 2px 2px'
    }
  }), "labs");
}
function Nav() {
  return /*#__PURE__*/React.createElement("nav", {
    style: {
      position: 'sticky',
      top: 0,
      zIndex: 10,
      height: 56,
      background: 'var(--bg-0)',
      borderBottom: '1px solid var(--border)',
      display: 'flex',
      alignItems: 'center',
      padding: '0 32px',
      gap: 32
    }
  }, /*#__PURE__*/React.createElement(Wordmark, {
    size: 16
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'flex',
      gap: 24,
      fontSize: 13,
      color: 'var(--fg-2)'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#product",
    style: {
      color: 'inherit',
      textDecoration: 'none'
    }
  }, "Product"), /*#__PURE__*/React.createElement("a", {
    href: "#customers",
    style: {
      color: 'inherit',
      textDecoration: 'none'
    }
  }, "Customers"), /*#__PURE__*/React.createElement("a", {
    href: "#pricing",
    style: {
      color: 'inherit',
      textDecoration: 'none'
    }
  }, "Pricing"), /*#__PURE__*/React.createElement("a", {
    href: "#docs",
    style: {
      color: 'inherit',
      textDecoration: 'none'
    }
  }, "Docs"), /*#__PURE__*/React.createElement("a", {
    href: "#changelog",
    style: {
      color: 'inherit',
      textDecoration: 'none',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      letterSpacing: '0.10em',
      textTransform: 'uppercase'
    }
  }, "Changelog")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginLeft: 'auto',
      display: 'flex',
      gap: 8,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#signin",
    style: {
      fontSize: 13,
      color: 'var(--fg-1)',
      textDecoration: 'none',
      padding: '7px 12px'
    }
  }, "Sign in"), /*#__PURE__*/React.createElement("a", {
    href: "#start",
    style: {
      fontSize: 13,
      color: '#fff',
      background: 'var(--brand-green)',
      padding: '7px 12px',
      borderRadius: 6,
      textDecoration: 'none',
      fontWeight: 500
    }
  }, "Start free")));
}
function Hero() {
  return /*#__PURE__*/React.createElement("section", {
    style: {
      padding: '96px 32px 80px',
      maxWidth: 1280,
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: '1.1fr 1fr',
      gap: 64,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--brand-green)',
      marginBottom: 24
    }
  }, "ATLAS \u2014 NOW IN PUBLIC BETA"), /*#__PURE__*/React.createElement("h1", {
    style: {
      fontSize: 60,
      lineHeight: 1.05,
      letterSpacing: '-0.02em',
      fontWeight: 600,
      color: 'var(--fg-0)',
      margin: 0
    }
  }, "Architecture,", /*#__PURE__*/React.createElement("br", null), "the pragmatic way."), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 17,
      lineHeight: 1.55,
      color: 'var(--fg-2)',
      maxWidth: 460,
      marginTop: 24
    }
  }, "Atlas keeps your capability map, ADRs, and service graph in the same place. Diff your architecture like you diff your code."), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32,
      display: 'flex',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("a", {
    href: "#start",
    style: {
      background: 'var(--brand-green)',
      color: '#fff',
      padding: '11px 18px',
      borderRadius: 6,
      textDecoration: 'none',
      fontWeight: 500,
      fontSize: 15
    }
  }, "Start free"), /*#__PURE__*/React.createElement("a", {
    href: "#demo",
    style: {
      background: 'var(--bg-1)',
      border: '1px solid var(--border-strong)',
      color: 'var(--fg-0)',
      padding: '10px 18px',
      borderRadius: 6,
      textDecoration: 'none',
      fontWeight: 500,
      fontSize: 15
    }
  }, "Book a walkthrough \u2192")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 24,
      fontSize: 12,
      color: 'var(--fg-3)',
      fontFamily: 'JetBrains Mono, monospace'
    }
  }, "Free for teams up to 5. No card required.")), /*#__PURE__*/React.createElement("div", {
    style: {
      border: '1px solid var(--border)',
      borderRadius: 14,
      overflow: 'hidden',
      background: 'var(--bg-1)',
      boxShadow: 'var(--shadow-md)'
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: window.__resources && window.__resources.capMap || "../../assets/illustration-capability-map.svg",
    alt: "Capability map",
    style: {
      display: 'block',
      width: '100%'
    }
  })));
}
function LogoStrip() {
  const logos = ['NORTHWIND', 'CONTOSO', 'INITECH', 'HOOLI', 'STARK INDUSTRIES', 'WAYNE ENTERPRISES'];
  return /*#__PURE__*/React.createElement("section", {
    style: {
      borderTop: '1px solid var(--border)',
      borderBottom: '1px solid var(--border)',
      padding: '28px 32px',
      background: 'var(--bg-0)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1280,
      margin: '0 auto',
      display: 'flex',
      alignItems: 'center',
      gap: 48,
      justifyContent: 'space-between',
      flexWrap: 'wrap'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, "Used by architects at"), logos.map(l => /*#__PURE__*/React.createElement("div", {
    key: l,
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      fontWeight: 600,
      color: 'var(--fg-2)',
      letterSpacing: '0.05em'
    }
  }, l))));
}
function FeatureGrid() {
  const features = [{
    icon: 'layers',
    title: 'Capability maps',
    body: 'Model what your business does, not how. Hierarchies, ownership, maturity — versioned.'
  }, {
    icon: 'git-branch',
    title: 'Decisions, recorded',
    body: 'ADRs alongside the things they affect. No more PDFs in SharePoint.'
  }, {
    icon: 'box',
    title: 'Service graph',
    body: 'Auto-generated from your repos. See blast radius before the incident does.'
  }];
  return /*#__PURE__*/React.createElement("section", {
    id: "product",
    style: {
      padding: '96px 32px',
      maxWidth: 1280,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, "WHAT'S IN ATLAS"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 44,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      fontWeight: 600,
      marginTop: 12,
      maxWidth: 720
    }
  }, "One workspace for the things that hold your system together."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 16,
      marginTop: 56
    }
  }, features.map(f => /*#__PURE__*/React.createElement("div", {
    key: f.title,
    style: {
      border: '1px solid var(--border)',
      borderRadius: 14,
      padding: 28,
      background: 'var(--bg-1)'
    }
  }, /*#__PURE__*/React.createElement("i", {
    "data-lucide": f.icon,
    style: {
      width: 24,
      height: 24,
      color: 'var(--brand-green)',
      strokeWidth: 1.5
    }
  }), /*#__PURE__*/React.createElement("h3", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      marginTop: 24,
      color: 'var(--fg-0)',
      letterSpacing: '-0.01em'
    }
  }, f.title), /*#__PURE__*/React.createElement("p", {
    style: {
      fontSize: 14,
      lineHeight: 1.55,
      color: 'var(--fg-2)',
      marginTop: 8
    }
  }, f.body), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-0)',
      textDecoration: 'none',
      marginTop: 24,
      display: 'inline-block'
    }
  }, "Learn more \u2192")))));
}
function Testimonial() {
  return /*#__PURE__*/React.createElement("section", {
    id: "customers",
    style: {
      background: 'var(--neutral-1000)',
      color: '#F5F5F2',
      padding: '96px 32px'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 920,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--brand-green)'
    }
  }, "CUSTOMERS \u2014 NORTHWIND"), /*#__PURE__*/React.createElement("blockquote", {
    style: {
      fontFamily: 'Source Serif 4, Georgia, serif',
      fontSize: 36,
      lineHeight: 1.3,
      fontWeight: 400,
      margin: '24px 0 0',
      letterSpacing: '-0.01em'
    }
  }, "\"We replaced four tools with Atlas. Our architects spend their afternoons modeling, not wrangling slide decks.\""), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 32,
      display: 'flex',
      alignItems: 'center',
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 36,
      height: 36,
      borderRadius: 999,
      background: '#5F5C56',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 13,
      fontWeight: 600
    }
  }, "JR"), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      fontWeight: 500
    }
  }, "Jordan Reyes"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: '#B5B3AC'
    }
  }, "Principal Architect, Northwind")))));
}
function Pricing() {
  const plans = [{
    name: 'Free',
    price: '$0',
    sub: 'For teams up to 5',
    features: ['1 workspace', 'Capability map + ADRs', 'Public service graph', 'Community support'],
    cta: 'Start free',
    primary: false
  }, {
    name: 'Team',
    price: '$24',
    sub: 'per architect / month',
    features: ['Unlimited workspaces', 'Versioned diffs', 'Repo integration', 'SSO + audit log', 'Priority support'],
    cta: 'Start 14-day trial',
    primary: true
  }, {
    name: 'Enterprise',
    price: 'Talk to us',
    sub: 'Volume + custom',
    features: ['Dedicated tenancy', 'On-prem option', 'Custom SLAs', 'Solutions engineering'],
    cta: 'Contact sales',
    primary: false
  }];
  return /*#__PURE__*/React.createElement("section", {
    id: "pricing",
    style: {
      padding: '96px 32px',
      maxWidth: 1280,
      margin: '0 auto'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, "PRICING"), /*#__PURE__*/React.createElement("h2", {
    style: {
      fontSize: 44,
      lineHeight: 1.1,
      letterSpacing: '-0.02em',
      fontWeight: 600,
      marginTop: 12
    }
  }, "Plain pricing."), /*#__PURE__*/React.createElement("div", {
    style: {
      display: 'grid',
      gridTemplateColumns: 'repeat(3, 1fr)',
      gap: 16,
      marginTop: 56
    }
  }, plans.map(p => /*#__PURE__*/React.createElement("div", {
    key: p.name,
    style: {
      border: p.primary ? '1px solid var(--neutral-1000)' : '1px solid var(--border)',
      borderRadius: 14,
      padding: 28,
      background: 'var(--bg-1)',
      position: 'relative'
    }
  }, p.primary && /*#__PURE__*/React.createElement("div", {
    style: {
      position: 'absolute',
      top: 16,
      right: 16,
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 10,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      background: 'var(--brand-green)',
      color: '#fff',
      padding: '3px 8px',
      borderRadius: 2
    }
  }, "Most teams"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 12,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-2)'
    }
  }, p.name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 44,
      fontWeight: 600,
      letterSpacing: '-0.02em',
      marginTop: 12,
      color: 'var(--fg-0)'
    }
  }, p.price), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--fg-2)',
      marginTop: 4
    }
  }, p.sub), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: '32px 0 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }
  }, p.features.map(f => /*#__PURE__*/React.createElement("li", {
    key: f,
    style: {
      fontSize: 14,
      color: 'var(--fg-1)',
      display: 'flex',
      gap: 10,
      alignItems: 'center'
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: 'var(--brand-green)',
      fontFamily: 'JetBrains Mono, monospace'
    }
  }, "\u2713"), f))), /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      display: 'block',
      textAlign: 'center',
      marginTop: 32,
      padding: '11px 18px',
      borderRadius: 6,
      fontWeight: 500,
      fontSize: 14,
      textDecoration: 'none',
      background: p.primary ? 'var(--brand-green)' : 'var(--bg-1)',
      color: p.primary ? '#fff' : 'var(--fg-0)',
      border: p.primary ? '1px solid var(--brand-green)' : '1px solid var(--border-strong)'
    }
  }, p.cta)))));
}
function Footer() {
  const cols = [{
    title: 'Product',
    items: ['Atlas', 'Integrations', 'Changelog', 'Roadmap']
  }, {
    title: 'Resources',
    items: ['Docs', 'Manifesto', 'Blog', 'Community']
  }, {
    title: 'Company',
    items: ['About', 'Customers', 'Careers', 'Contact']
  }, {
    title: 'Legal',
    items: ['Terms', 'Privacy', 'Security', 'DPA']
  }];
  return /*#__PURE__*/React.createElement("footer", {
    style: {
      borderTop: '1px solid var(--border)',
      padding: '64px 32px 48px',
      background: 'var(--bg-0)'
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1280,
      margin: '0 auto',
      display: 'grid',
      gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr',
      gap: 32
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement(Wordmark, {
    size: 18
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: 'var(--fg-2)',
      marginTop: 16,
      maxWidth: 280,
      lineHeight: 1.5
    }
  }, "Tools for building complex systems. Made in Brooklyn and Lisbon.")), cols.map(c => /*#__PURE__*/React.createElement("div", {
    key: c.title
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      letterSpacing: '0.10em',
      textTransform: 'uppercase',
      color: 'var(--fg-3)'
    }
  }, c.title), /*#__PURE__*/React.createElement("ul", {
    style: {
      listStyle: 'none',
      padding: 0,
      margin: '12px 0 0',
      display: 'flex',
      flexDirection: 'column',
      gap: 8
    }
  }, c.items.map(i => /*#__PURE__*/React.createElement("li", {
    key: i
  }, /*#__PURE__*/React.createElement("a", {
    href: "#",
    style: {
      fontSize: 13,
      color: 'var(--fg-1)',
      textDecoration: 'none'
    }
  }, i))))))), /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 1280,
      margin: '48px auto 0',
      borderTop: '1px solid var(--border)',
      paddingTop: 24,
      display: 'flex',
      justifyContent: 'space-between',
      fontFamily: 'JetBrains Mono, monospace',
      fontSize: 11,
      color: 'var(--fg-3)',
      letterSpacing: '0.05em'
    }
  }, /*#__PURE__*/React.createElement("span", null, "\xA9 2026 PRAGMATIC LABS, INC."), /*#__PURE__*/React.createElement("span", null, "SOC 2 TYPE II \xB7 ISO 27001")));
}
Object.assign(window, {
  Nav,
  Hero,
  LogoStrip,
  FeatureGrid,
  Testimonial,
  Pricing,
  Footer,
  Wordmark
});
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/marketing/MarketingComponents.jsx", error: String((e && e.message) || e) }); }

})();
