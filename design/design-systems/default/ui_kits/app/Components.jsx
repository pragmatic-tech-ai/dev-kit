// Atlas app components
const { useState, useEffect, useRef } = React;

function Wordmark({ size = 14 }) {
  const dotSize = Math.round(size * 0.28);
  return (
    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontWeight: 700, fontSize: size, letterSpacing: '-0.01em', color: 'var(--fg-0)', display: 'inline-flex', alignItems: 'center' }}>
      pragmatic
      <span style={{ width: dotSize, height: dotSize, borderRadius: 999, background: 'var(--brand-green)', display: 'inline-block', margin: '0 2px 2px 2px' }}></span>
      labs
    </span>
  );
}

function AppShell({ onOpenPalette }) {
  return (
    <header style={{
      height: 48, borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 12px', gap: 12,
      background: 'var(--bg-0)', flexShrink: 0,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingRight: 12, borderRight: '1px solid var(--border)', height: '100%' }}>
        <svg width="20" height="20" viewBox="0 0 64 64" fill="none"><rect x="6" y="6" width="52" height="52" rx="2" stroke="currentColor" strokeWidth="3.5"/><circle cx="48" cy="16" r="6" fill="#2EA862"/></svg>
        <Wordmark size={13}/>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--fg-1)' }}>
        <span style={{ fontWeight: 500 }}>Northwind</span>
        <span style={{ color: 'var(--fg-3)' }}>/</span>
        <span style={{ color: 'var(--fg-2)' }}>Platform</span>
        <i data-lucide="chevron-down" style={{ width: 14, height: 14, color: 'var(--fg-3)', strokeWidth: 1.5, marginLeft: 2 }}></i>
      </div>
      <button onClick={onOpenPalette} style={{
        marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8,
        background: 'var(--bg-1)', border: '1px solid var(--border)',
        borderRadius: 6, padding: '5px 10px', fontFamily: 'var(--font-sans)',
        fontSize: 12, color: 'var(--fg-3)', cursor: 'pointer', minWidth: 240,
      }}>
        <i data-lucide="search" style={{ width: 13, height: 13, strokeWidth: 1.5 }}></i>
        Search or run a command
        <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, padding: '1px 5px', background: 'var(--bg-2)', borderRadius: 3 }}>⌘K</span>
      </button>
      <button style={{ background: 'transparent', border: 0, padding: 6, color: 'var(--fg-2)', cursor: 'pointer', borderRadius: 6 }}>
        <i data-lucide="bell" style={{ width: 16, height: 16, strokeWidth: 1.5 }}></i>
      </button>
      <div style={{ width: 28, height: 28, borderRadius: 999, background: '#2EA862', color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>JR</div>
    </header>
  );
}

function Sidebar({ active, onChange }) {
  const sections = [
    { id: 'overview', label: 'Overview', icon: 'home' },
    { id: 'map', label: 'Capability map', icon: 'layers', count: 142 },
    { id: 'adrs', label: 'Decisions', icon: 'file-text', count: 38 },
    { id: 'services', label: 'Service graph', icon: 'box', count: 61 },
    { id: 'activity', label: 'Activity', icon: 'activity' },
  ];
  const recents = [
    { id: 'r1', label: 'Billing capability' },
    { id: 'r2', label: 'ADR-0042 · Event sourcing' },
    { id: 'r3', label: 'auth-service' },
  ];
  return (
    <aside style={{
      width: 240, borderRight: '1px solid var(--border)',
      background: 'var(--bg-0)', display: 'flex', flexDirection: 'column',
      flexShrink: 0, padding: '12px 0',
    }}>
      <div style={{ padding: '0 12px' }}>
        {sections.map(s => (
          <button key={s.id} onClick={() => onChange(s.id)} style={{
            display: 'flex', alignItems: 'center', gap: 10, width: '100%',
            padding: '7px 10px', borderRadius: 6, border: 0,
            background: active === s.id ? 'var(--bg-2)' : 'transparent',
            color: active === s.id ? 'var(--fg-0)' : 'var(--fg-1)',
            fontFamily: 'var(--font-sans)', fontSize: 13,
            fontWeight: active === s.id ? 500 : 400,
            cursor: 'pointer', textAlign: 'left',
          }}>
            <i data-lucide={s.icon} style={{ width: 15, height: 15, strokeWidth: 1.5, color: 'var(--fg-2)' }}></i>
            {s.label}
            {s.count != null && <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-3)' }}>{s.count}</span>}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 24, padding: '0 22px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 8 }}>Recent</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {recents.map(r => (
            <a key={r.id} href="#" style={{ fontSize: 12, color: 'var(--fg-2)', textDecoration: 'none', padding: '3px 0' }}>{r.label}</a>
          ))}
        </div>
      </div>
      <div style={{ marginTop: 'auto', padding: '12px', borderTop: '1px solid var(--border)' }}>
        <button style={{
          display: 'flex', alignItems: 'center', gap: 10, width: '100%',
          padding: '7px 10px', borderRadius: 6, border: 0, background: 'transparent',
          color: 'var(--fg-2)', fontFamily: 'var(--font-sans)', fontSize: 13, cursor: 'pointer', textAlign: 'left',
        }}>
          <i data-lucide="settings" style={{ width: 15, height: 15, strokeWidth: 1.5 }}></i>
          Settings
        </button>
      </div>
    </aside>
  );
}

function Toolbar({ zoom, onZoom }) {
  return (
    <div style={{
      position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
      display: 'flex', alignItems: 'center', gap: 4,
      background: 'var(--bg-1)', border: '1px solid var(--border)',
      borderRadius: 12, padding: 4, boxShadow: 'var(--shadow-md)',
      backdropFilter: 'blur(12px)',
    }}>
      {['mouse-pointer-2', 'hand', 'square', 'spline'].map((ic, i) => (
        <button key={ic} style={{ width: 32, height: 32, border: 0, background: i === 0 ? 'var(--bg-2)' : 'transparent', borderRadius: 8, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--fg-1)' }}>
          <i data-lucide={ic} style={{ width: 14, height: 14, strokeWidth: 1.5 }}></i>
        </button>
      ))}
      <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }}></div>
      <button style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--fg-1)' }} onClick={() => onZoom(zoom - 10)}>−</button>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-2)', minWidth: 36, textAlign: 'center' }}>{zoom}%</span>
      <button style={{ width: 32, height: 32, border: 0, background: 'transparent', borderRadius: 8, cursor: 'pointer', color: 'var(--fg-1)' }} onClick={() => onZoom(zoom + 10)}>+</button>
    </div>
  );
}

function Canvas({ selectedId, onSelect }) {
  // A capability map rendered as a pseudo-canvas
  const nodes = [
    { id: 'customer', x: 80, y: 60, w: 180, h: 64, title: 'Customer', sub: '5 sub-capabilities', level: 1 },
    { id: 'product', x: 290, y: 60, w: 180, h: 64, title: 'Product', sub: '8 sub-capabilities', level: 1 },
    { id: 'operations', x: 500, y: 60, w: 180, h: 64, title: 'Operations', sub: '6 sub-capabilities', level: 1 },
    { id: 'identity', x: 60, y: 200, w: 130, h: 52, title: 'Identity', sub: 'L2', level: 2 },
    { id: 'onboarding', x: 200, y: 200, w: 130, h: 52, title: 'Onboarding', sub: 'L2', level: 2 },
    { id: 'catalog', x: 340, y: 200, w: 130, h: 52, title: 'Catalog', sub: 'L2', level: 2 },
    { id: 'pricing', x: 480, y: 200, w: 130, h: 52, title: 'Pricing', sub: 'L2', level: 2 },
    { id: 'billing', x: 620, y: 200, w: 130, h: 52, title: 'Billing', sub: 'L2 · 12 services', level: 2, highlight: true },
  ];
  const edges = [
    ['customer', 'identity'], ['customer', 'onboarding'],
    ['product', 'catalog'], ['product', 'pricing'],
    ['operations', 'billing'],
  ];
  const byId = Object.fromEntries(nodes.map(n => [n.id, n]));
  return (
    <div style={{ flex: 1, position: 'relative', background: 'var(--bg-0)', overflow: 'hidden',
      backgroundImage: 'radial-gradient(circle, var(--neutral-300) 1px, transparent 1px)',
      backgroundSize: '24px 24px', backgroundPosition: '0 0',
    }}>
      <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
        {edges.map(([a, b], i) => {
          const A = byId[a], B = byId[b];
          return <path key={i} d={`M${A.x + A.w/2},${A.y + A.h} L${B.x + B.w/2},${B.y}`} stroke="var(--border-strong)" strokeWidth="1" fill="none"/>;
        })}
      </svg>
      {nodes.map(n => (
        <div key={n.id} onClick={() => onSelect(n.id)} style={{
          position: 'absolute', left: n.x, top: n.y, width: n.w, height: n.h,
          background: n.highlight ? 'var(--brand-green-soft)' : 'var(--bg-1)',
          border: selectedId === n.id ? '2px solid var(--brand-green)' : (n.highlight ? '1px solid var(--brand-green)' : '1px solid var(--border)'),
          borderRadius: 8, padding: '10px 14px', cursor: 'pointer',
          display: 'flex', flexDirection: 'column', justifyContent: 'center',
          fontFamily: 'JetBrains Mono, monospace',
          boxShadow: selectedId === n.id ? '0 0 0 2px var(--brand-green-soft)' : 'none',
          transition: 'border-color 120ms cubic-bezier(0.2,0,0,1)',
        }}>
          <div style={{ fontWeight: 600, fontSize: 12, color: 'var(--fg-0)' }}>{n.title}</div>
          <div style={{ fontSize: 10, color: 'var(--fg-2)', marginTop: 2 }}>{n.sub}</div>
        </div>
      ))}
      <div style={{ position: 'absolute', bottom: 16, left: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
        CAPABILITY MAP — RETAIL · v3.2
      </div>
    </div>
  );
}

function Inspector({ nodeId }) {
  const data = {
    customer: { title: 'Customer', kind: 'Domain', owner: 'platform-team', level: 1, services: 14, adrs: 6, status: 'mature' },
    billing: { title: 'Billing', kind: 'Capability', owner: 'billing-team', level: 2, services: 12, adrs: 4, status: 'evolving' },
    onboarding: { title: 'Onboarding', kind: 'Capability', owner: 'growth-team', level: 2, services: 7, adrs: 3, status: 'evolving' },
  }[nodeId] || { title: 'Nothing selected', kind: '—', owner: '—', level: '—', services: 0, adrs: 0, status: '—' };

  return (
    <aside style={{
      width: 320, borderLeft: '1px solid var(--border)',
      background: 'var(--bg-0)', display: 'flex', flexDirection: 'column',
      flexShrink: 0,
    }}>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>{data.kind}</div>
        <div style={{ fontSize: 18, fontWeight: 600, marginTop: 4, letterSpacing: '-0.01em', color: 'var(--fg-0)' }}>{data.title}</div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 2, background: 'var(--state-success-soft)', color: 'var(--state-success)' }}>{data.status}</span>
          <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, fontWeight: 500, padding: '3px 8px', borderRadius: 2, background: 'var(--bg-2)', color: 'var(--fg-1)' }}>L{data.level}</span>
        </div>
      </div>
      <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <Field label="Owner" value={data.owner}/>
        <Field label="Services" value={data.services}/>
        <Field label="Decisions" value={data.adrs}/>
        <Field label="Last edited" value="2 days ago"/>
      </div>
      <div style={{ padding: '14px 18px' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)', marginBottom: 10 }}>Recent decisions</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {[
            { id: 'ADR-0042', title: 'Adopt event sourcing', status: 'accepted' },
            { id: 'ADR-0038', title: 'Move to per-tenant DB', status: 'accepted' },
            { id: 'ADR-0034', title: 'Drop synchronous webhook', status: 'superseded' },
          ].map(a => (
            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '6px 0' }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-3)', minWidth: 60 }}>{a.id}</span>
              <span style={{ fontSize: 12, color: 'var(--fg-1)', flex: 1 }}>{a.title}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: a.status === 'accepted' ? 'var(--state-success)' : 'var(--fg-3)' }}>{a.status}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-3)', minWidth: 80, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{label}</span>
      <span style={{ fontSize: 13, color: 'var(--fg-0)' }}>{value}</span>
    </div>
  );
}

function CommandPalette({ open, onClose }) {
  if (!open) return null;
  const items = [
    { ic: 'plus', label: 'Create capability', kbd: '↵' },
    { ic: 'plus', label: 'Create ADR' },
    { ic: 'search', label: 'Find capability "billing"' },
    { ic: 'git-branch', label: 'View service graph' },
    { ic: 'arrow-right', label: 'Go to Settings' },
  ];
  return (
    <div onClick={onClose} style={{
      position: 'fixed', inset: 0, background: 'rgba(10,10,11,0.40)',
      display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
      paddingTop: 120, zIndex: 100,
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        width: 520, background: 'var(--bg-1)',
        border: '1px solid var(--border)', borderRadius: 10,
        boxShadow: 'var(--shadow-lg)', overflow: 'hidden',
      }}>
        <input autoFocus placeholder="Search or run a command…" style={{
          width: '100%', padding: '14px 18px', border: 0,
          fontFamily: 'var(--font-sans)', fontSize: 14, color: 'var(--fg-0)',
          borderBottom: '1px solid var(--border)', outline: 'none', background: 'transparent',
        }}/>
        <div style={{ padding: 6 }}>
          {items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '8px 12px', borderRadius: 6,
              background: i === 0 ? 'var(--bg-2)' : 'transparent',
              fontSize: 13, color: 'var(--fg-1)', cursor: 'pointer',
            }}>
              <i data-lucide={it.ic} style={{ width: 14, height: 14, strokeWidth: 1.5, color: 'var(--fg-2)' }}></i>
              {it.label}
              {it.kbd && <span style={{ marginLeft: 'auto', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--fg-3)' }}>{it.kbd}</span>}
            </div>
          ))}
        </div>
        <div style={{ padding: '8px 14px', borderTop: '1px solid var(--border)', fontFamily: 'JetBrains Mono, monospace', fontSize: 10, color: 'var(--fg-3)', display: 'flex', gap: 16 }}>
          <span>↑↓ navigate</span>
          <span>↵ select</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}

function ADRList() {
  const adrs = [
    { id: 'ADR-0042', title: 'Adopt event sourcing for billing', author: 'PS', date: '2026-04-28', status: 'accepted' },
    { id: 'ADR-0041', title: 'Move auth-service to Rust', author: 'JR', date: '2026-04-22', status: 'in review' },
    { id: 'ADR-0040', title: 'Per-tenant database isolation', author: 'AL', date: '2026-04-15', status: 'accepted' },
    { id: 'ADR-0039', title: 'Drop synchronous webhook delivery', author: 'MK', date: '2026-04-10', status: 'superseded' },
    { id: 'ADR-0038', title: 'Standardize on OpenTelemetry', author: 'PS', date: '2026-04-02', status: 'accepted' },
  ];
  const colors = { 'accepted': ['var(--state-success-soft)', 'var(--state-success)'], 'in review': ['var(--state-info-soft)', 'var(--state-info)'], 'superseded': ['var(--bg-2)', 'var(--fg-2)'] };
  return (
    <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 24 }}>
        <h1 style={{ fontSize: 28, fontWeight: 600, letterSpacing: '-0.01em', margin: 0, color: 'var(--fg-0)' }}>Decisions</h1>
        <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, color: 'var(--fg-3)' }}>{adrs.length} of 38</span>
        <button style={{ marginLeft: 'auto', padding: '7px 12px', borderRadius: 6, border: 0, background: 'var(--brand-green)', color: '#fff', fontFamily: 'var(--font-sans)', fontSize: 13, fontWeight: 500, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <i data-lucide="plus" style={{ width: 13, height: 13, strokeWidth: 2 }}></i>New ADR
        </button>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-1)', overflow: 'hidden' }}>
        {adrs.map((a, i) => {
          const [bg, fg] = colors[a.status];
          return (
            <div key={a.id} style={{
              display: 'grid', gridTemplateColumns: '90px 1fr 90px 90px 100px',
              alignItems: 'center', padding: '14px 20px', gap: 16,
              borderBottom: i < adrs.length - 1 ? '1px solid var(--border)' : '0',
              fontSize: 13,
            }}>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', color: 'var(--fg-3)' }}>{a.id}</span>
              <span style={{ color: 'var(--fg-0)', fontWeight: 500 }}>{a.title}</span>
              <span style={{ width: 24, height: 24, borderRadius: 999, background: '#5F5C56', color: '#fff', fontFamily: 'JetBrains Mono, monospace', fontWeight: 600, fontSize: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a.author}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-2)' }}>{a.date}</span>
              <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 10, padding: '3px 8px', borderRadius: 2, background: bg, color: fg, justifySelf: 'start' }}>{a.status}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

Object.assign(window, { AppShell, Sidebar, Toolbar, Canvas, Inspector, CommandPalette, ADRList });
