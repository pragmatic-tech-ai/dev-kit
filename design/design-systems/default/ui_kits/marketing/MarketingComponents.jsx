// Pragmatic Labs marketing components
const { useState } = React;

function Wordmark({ size = 18, color }) {
  const dotSize = Math.round(size * 0.28);
  return (
    <span style={{
      fontFamily: 'JetBrains Mono, monospace', fontWeight: 700,
      fontSize: size, letterSpacing: '-0.01em', color: color || 'var(--fg-0)',
      display: 'inline-flex', alignItems: 'center', gap: 1,
    }}>
      pragmatic
      <span style={{ width: dotSize, height: dotSize, borderRadius: 999, background: 'var(--brand-green)', display: 'inline-block', margin: '0 2px 2px 2px' }}></span>
      labs
    </span>
  );
}

function Nav() {
  return (
    <nav style={{
      position: 'sticky', top: 0, zIndex: 10,
      height: 56, background: 'var(--bg-0)',
      borderBottom: '1px solid var(--border)',
      display: 'flex', alignItems: 'center', padding: '0 32px', gap: 32,
    }}>
      <Wordmark size={16}/>
      <div style={{ display: 'flex', gap: 24, fontSize: 13, color: 'var(--fg-2)' }}>
        <a href="#product" style={{ color: 'inherit', textDecoration: 'none' }}>Product</a>
        <a href="#customers" style={{ color: 'inherit', textDecoration: 'none' }}>Customers</a>
        <a href="#pricing" style={{ color: 'inherit', textDecoration: 'none' }}>Pricing</a>
        <a href="#docs" style={{ color: 'inherit', textDecoration: 'none' }}>Docs</a>
        <a href="#changelog" style={{ color: 'inherit', textDecoration: 'none', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase' }}>Changelog</a>
      </div>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
        <a href="#signin" style={{ fontSize: 13, color: 'var(--fg-1)', textDecoration: 'none', padding: '7px 12px' }}>Sign in</a>
        <a href="#start" style={{ fontSize: 13, color: '#fff', background: 'var(--brand-green)', padding: '7px 12px', borderRadius: 6, textDecoration: 'none', fontWeight: 500 }}>Start free</a>
      </div>
    </nav>
  );
}

function Hero() {
  return (
    <section style={{
      padding: '96px 32px 80px',
      maxWidth: 1280, margin: '0 auto',
      display: 'grid', gridTemplateColumns: '1.1fr 1fr', gap: 64, alignItems: 'center',
    }}>
      <div>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--brand-green)', marginBottom: 24 }}>
          ATLAS — NOW IN PUBLIC BETA
        </div>
        <h1 style={{
          fontSize: 60, lineHeight: 1.05, letterSpacing: '-0.02em', fontWeight: 600, color: 'var(--fg-0)', margin: 0,
        }}>
          Architecture,<br/>the pragmatic way.
        </h1>
        <p style={{ fontSize: 17, lineHeight: 1.55, color: 'var(--fg-2)', maxWidth: 460, marginTop: 24 }}>
          Atlas keeps your capability map, ADRs, and service graph in the same place. Diff your architecture like you diff your code.
        </p>
        <div style={{ marginTop: 32, display: 'flex', gap: 12 }}>
          <a href="#start" style={{ background: 'var(--brand-green)', color: '#fff', padding: '11px 18px', borderRadius: 6, textDecoration: 'none', fontWeight: 500, fontSize: 15 }}>Start free</a>
          <a href="#demo" style={{ background: 'var(--bg-1)', border: '1px solid var(--border-strong)', color: 'var(--fg-0)', padding: '10px 18px', borderRadius: 6, textDecoration: 'none', fontWeight: 500, fontSize: 15 }}>Book a walkthrough →</a>
        </div>
        <div style={{ marginTop: 24, fontSize: 12, color: 'var(--fg-3)', fontFamily: 'JetBrains Mono, monospace' }}>
          Free for teams up to 5. No card required.
        </div>
      </div>
      <div style={{ border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden', background: 'var(--bg-1)', boxShadow: 'var(--shadow-md)' }}>
        <img src={(window.__resources && window.__resources.capMap) || "../../assets/illustration-capability-map.svg"} alt="Capability map" style={{ display: 'block', width: '100%' }}/>
      </div>
    </section>
  );
}

function LogoStrip() {
  const logos = ['NORTHWIND', 'CONTOSO', 'INITECH', 'HOOLI', 'STARK INDUSTRIES', 'WAYNE ENTERPRISES'];
  return (
    <section style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', padding: '28px 32px', background: 'var(--bg-0)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'center', gap: 48, justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>
          Used by architects at
        </div>
        {logos.map(l => (
          <div key={l} style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600, color: 'var(--fg-2)', letterSpacing: '0.05em' }}>{l}</div>
        ))}
      </div>
    </section>
  );
}

function FeatureGrid() {
  const features = [
    { icon: 'layers', title: 'Capability maps', body: 'Model what your business does, not how. Hierarchies, ownership, maturity — versioned.' },
    { icon: 'git-branch', title: 'Decisions, recorded', body: 'ADRs alongside the things they affect. No more PDFs in SharePoint.' },
    { icon: 'box', title: 'Service graph', body: 'Auto-generated from your repos. See blast radius before the incident does.' },
  ];
  return (
    <section id="product" style={{ padding: '96px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>WHAT'S IN ATLAS</div>
      <h2 style={{ fontSize: 44, lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 600, marginTop: 12, maxWidth: 720 }}>One workspace for the things that hold your system together.</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 56 }}>
        {features.map(f => (
          <div key={f.title} style={{ border: '1px solid var(--border)', borderRadius: 14, padding: 28, background: 'var(--bg-1)' }}>
            <i data-lucide={f.icon} style={{ width: 24, height: 24, color: 'var(--brand-green)', strokeWidth: 1.5 }}></i>
            <h3 style={{ fontSize: 20, fontWeight: 600, marginTop: 24, color: 'var(--fg-0)', letterSpacing: '-0.01em' }}>{f.title}</h3>
            <p style={{ fontSize: 14, lineHeight: 1.55, color: 'var(--fg-2)', marginTop: 8 }}>{f.body}</p>
            <a href="#" style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-0)', textDecoration: 'none', marginTop: 24, display: 'inline-block' }}>Learn more →</a>
          </div>
        ))}
      </div>
    </section>
  );
}

function Testimonial() {
  return (
    <section id="customers" style={{ background: 'var(--neutral-1000)', color: '#F5F5F2', padding: '96px 32px' }}>
      <div style={{ maxWidth: 920, margin: '0 auto' }}>
        <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--brand-green)' }}>CUSTOMERS — NORTHWIND</div>
        <blockquote style={{ fontFamily: 'Source Serif 4, Georgia, serif', fontSize: 36, lineHeight: 1.3, fontWeight: 400, margin: '24px 0 0', letterSpacing: '-0.01em' }}>
          "We replaced four tools with Atlas. Our architects spend their afternoons modeling, not wrangling slide decks."
        </blockquote>
        <div style={{ marginTop: 32, display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ width: 36, height: 36, borderRadius: 999, background: '#5F5C56', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: 'JetBrains Mono, monospace', fontSize: 13, fontWeight: 600 }}>JR</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 500 }}>Jordan Reyes</div>
            <div style={{ fontSize: 13, color: '#B5B3AC' }}>Principal Architect, Northwind</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function Pricing() {
  const plans = [
    { name: 'Free', price: '$0', sub: 'For teams up to 5', features: ['1 workspace', 'Capability map + ADRs', 'Public service graph', 'Community support'], cta: 'Start free', primary: false },
    { name: 'Team', price: '$24', sub: 'per architect / month', features: ['Unlimited workspaces', 'Versioned diffs', 'Repo integration', 'SSO + audit log', 'Priority support'], cta: 'Start 14-day trial', primary: true },
    { name: 'Enterprise', price: 'Talk to us', sub: 'Volume + custom', features: ['Dedicated tenancy', 'On-prem option', 'Custom SLAs', 'Solutions engineering'], cta: 'Contact sales', primary: false },
  ];
  return (
    <section id="pricing" style={{ padding: '96px 32px', maxWidth: 1280, margin: '0 auto' }}>
      <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>PRICING</div>
      <h2 style={{ fontSize: 44, lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 600, marginTop: 12 }}>Plain pricing.</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginTop: 56 }}>
        {plans.map(p => (
          <div key={p.name} style={{
            border: p.primary ? '1px solid var(--neutral-1000)' : '1px solid var(--border)',
            borderRadius: 14, padding: 28, background: 'var(--bg-1)',
            position: 'relative',
          }}>
            {p.primary && <div style={{ position: 'absolute', top: 16, right: 16, fontFamily: 'JetBrains Mono, monospace', fontSize: 10, letterSpacing: '0.10em', textTransform: 'uppercase', background: 'var(--brand-green)', color: '#fff', padding: '3px 8px', borderRadius: 2 }}>Most teams</div>}
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 12, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-2)' }}>{p.name}</div>
            <div style={{ fontSize: 44, fontWeight: 600, letterSpacing: '-0.02em', marginTop: 12, color: 'var(--fg-0)' }}>{p.price}</div>
            <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 4 }}>{p.sub}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '32px 0 0', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {p.features.map(f => (
                <li key={f} style={{ fontSize: 14, color: 'var(--fg-1)', display: 'flex', gap: 10, alignItems: 'center' }}>
                  <span style={{ color: 'var(--brand-green)', fontFamily: 'JetBrains Mono, monospace' }}>✓</span>{f}
                </li>
              ))}
            </ul>
            <a href="#" style={{
              display: 'block', textAlign: 'center', marginTop: 32,
              padding: '11px 18px', borderRadius: 6, fontWeight: 500, fontSize: 14,
              textDecoration: 'none',
              background: p.primary ? 'var(--brand-green)' : 'var(--bg-1)',
              color: p.primary ? '#fff' : 'var(--fg-0)',
              border: p.primary ? '1px solid var(--brand-green)' : '1px solid var(--border-strong)',
            }}>{p.cta}</a>
          </div>
        ))}
      </div>
    </section>
  );
}

function Footer() {
  const cols = [
    { title: 'Product', items: ['Atlas', 'Integrations', 'Changelog', 'Roadmap'] },
    { title: 'Resources', items: ['Docs', 'Manifesto', 'Blog', 'Community'] },
    { title: 'Company', items: ['About', 'Customers', 'Careers', 'Contact'] },
    { title: 'Legal', items: ['Terms', 'Privacy', 'Security', 'DPA'] },
  ];
  return (
    <footer style={{ borderTop: '1px solid var(--border)', padding: '64px 32px 48px', background: 'var(--bg-0)' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr', gap: 32 }}>
        <div>
          <Wordmark size={18}/>
          <div style={{ fontSize: 13, color: 'var(--fg-2)', marginTop: 16, maxWidth: 280, lineHeight: 1.5 }}>
            Tools for building complex systems. Made in Brooklyn and Lisbon.
          </div>
        </div>
        {cols.map(c => (
          <div key={c.title}>
            <div style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: 11, letterSpacing: '0.10em', textTransform: 'uppercase', color: 'var(--fg-3)' }}>{c.title}</div>
            <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0 0', display: 'flex', flexDirection: 'column', gap: 8 }}>
              {c.items.map(i => <li key={i}><a href="#" style={{ fontSize: 13, color: 'var(--fg-1)', textDecoration: 'none' }}>{i}</a></li>)}
            </ul>
          </div>
        ))}
      </div>
      <div style={{ maxWidth: 1280, margin: '48px auto 0', borderTop: '1px solid var(--border)', paddingTop: 24, display: 'flex', justifyContent: 'space-between', fontFamily: 'JetBrains Mono, monospace', fontSize: 11, color: 'var(--fg-3)', letterSpacing: '0.05em' }}>
        <span>© 2026 PRAGMATIC LABS, INC.</span>
        <span>SOC 2 TYPE II · ISO 27001</span>
      </div>
    </footer>
  );
}

Object.assign(window, { Nav, Hero, LogoStrip, FeatureGrid, Testimonial, Pricing, Footer, Wordmark });
