/*
 * Animated knowledge-graph header banner for the docs site.
 *
 * A standalone port of "Knowledge Graph Banner.dc.html" (Claude Design project
 * "Techno graph background design", mirrored in design/techno-graph-background/).
 * The design renders a fixed 1920x360 canvas with two hard-coded keep-clear
 * zones; here the canvas takes the header's real size and the keep-clear zones
 * are measured from the header's title block and project-nav strip, so the
 * graph routes around the actual text at every viewport width.
 */
class GraphBanner
{
    static HeaderSelector = '.page-header';
    static CanvasSelector = '.header-graph';
    static TitleSelectors = '.project-name, .project-tagline, .btn';
    static NavSelector = '.project-nav';
    static ReducedMotionQuery = '(prefers-reduced-motion: reduce)';
    static CanvasFontLoads = ['500 12px "Inter Tight"', '400 10px "JetBrains Mono"', 'italic 400 9px "JetBrains Mono"'];
    static HubFont = '500 12px "Inter Tight", system-ui, sans-serif';
    static EntityFont = '400 10px "JetBrains Mono", ui-monospace, monospace';
    static RelationFont = 'italic 400 9px "JetBrains Mono", ui-monospace, monospace';

    static Ground = '#0A0A0B';
    static Green = '46,168,98';
    static Cyan = '58,166,185';
    static Grey = '160,164,170';
    static HubLabelColor = 'rgba(230,232,234,0.55)';

    static Seed = 7;
    static HubSpacing = 137;      // px between concept hubs (1920 / 14 in the design)
    static KidsPerHub = 5;
    static PulseCount = 18;
    static ZonePad = 12;          // extra clearance around measured title/nav boxes
    static ResizeDebounceMs = 150;

    static EdgeCore = 'core';
    static EdgeOwn = 'own';
    static EdgeCross = 'cross';

    static Concepts = ['Capability', 'Domain', 'Decision', 'Principle', 'Standard', 'Process', 'Data entity', 'Actor', 'Requirement', 'Risk', 'Interface'];
    static Entities = ['Billing', 'Identity', 'ADR-014', 'Order', 'Customer', 'API gateway', 'GDPR', 'Onboarding', 'Ledger', 'Pricing', 'Event bus', 'Audit log', 'Payments', 'ADR-031', 'Catalog', 'Consent', 'SLA 99.9', 'Invoice', 'Partner', 'Search', 'Tenant', 'Retention', 'ADR-007', 'Fulfilment', 'Policy', 'KYC', 'Routing', 'Schema v3'];
    static Relations = ['realizes', 'depends on', 'governs', 'owns', 'part of', 'informs', 'implements', 'constrains', 'supersedes', 'relates to'];

    constructor(header, canvas)
    {
        this.header = header;
        this.canvas = canvas;
        this.animate = !window.matchMedia(GraphBanner.ReducedMotionQuery).matches;
        this.raf = 0;
        this.resizeTimer = 0;
        this.builtWidth = -1;
    }

    static MountAll()
    {
        const header = document.querySelector(GraphBanner.HeaderSelector);
        const canvas = header && header.querySelector(GraphBanner.CanvasSelector);
        if (!canvas || !canvas.getContext)
        {
            return;
        }
        new GraphBanner(header, canvas).Start();
    }

    Start()
    {
        const fonts = document.fonts
            ? Promise.all(GraphBanner.CanvasFontLoads.map(f => document.fonts.load(f))).catch(() => null)
            : Promise.resolve();
        fonts.then(() => this.Build());
        if (window.ResizeObserver)
        {
            new ResizeObserver(() => this.ScheduleRebuild()).observe(this.header);
        }
    }

    ScheduleRebuild()
    {
        clearTimeout(this.resizeTimer);
        this.resizeTimer = setTimeout(() =>
        {
            if (this.header.clientWidth !== this.builtWidth || this.header.clientHeight !== this.builtHeight)
            {
                this.Build();
            }
        }, GraphBanner.ResizeDebounceMs);
    }

    // --- seeded randomness ------------------------------------------------

    Rnd()
    {
        this.s += 0x6D2B79F5;
        let t = this.s;
        t = Math.imul(t ^ t >>> 15, t | 1);
        t ^= t + Math.imul(t ^ t >>> 7, t | 61);
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    }

    Pick(a)
    {
        return a[Math.floor(this.Rnd() * a.length)];
    }

    Shuffle(src)
    {
        const a = src.slice();
        for (let i = a.length - 1; i > 0; i--)
        {
            const j = Math.floor(this.Rnd() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    // --- geometry ---------------------------------------------------------

    static Clamp(v, lo, hi)
    {
        return Math.max(lo, Math.min(hi, v));
    }

    static Qp(e, t)
    {
        const u = 1 - t;
        return {
            x: u * u * e.a.x + 2 * u * t * e.c.x + t * t * e.b.x,
            y: u * u * e.a.y + 2 * u * t * e.c.y + t * t * e.b.y,
        };
    }

    InZone(x, y, pad)
    {
        return this.zones.some(z => x > z.x - pad && x < z.x + z.w + pad && y > z.y - pad && y < z.y + z.h + pad);
    }

    MeasureZones()
    {
        const origin = this.header.getBoundingClientRect();
        const zones = [];
        const addUnion = (els) =>
        {
            const rects = Array.from(els).map(el => el.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
            if (!rects.length)
            {
                return;
            }
            const left = Math.min(...rects.map(r => r.left)), right = Math.max(...rects.map(r => r.right));
            const top = Math.min(...rects.map(r => r.top)), bottom = Math.max(...rects.map(r => r.bottom));
            const p = GraphBanner.ZonePad;
            zones.push({ x: left - origin.left - p, y: top - origin.top - p, w: right - left + 2 * p, h: bottom - top + 2 * p });
        };
        addUnion(this.header.querySelectorAll(GraphBanner.TitleSelectors));
        addUnion(this.header.querySelectorAll(GraphBanner.NavSelector));
        return zones;
    }

    // --- graph construction -----------------------------------------------

    Build()
    {
        cancelAnimationFrame(this.raf);
        const W = this.header.clientWidth, H = this.header.clientHeight;
        this.builtWidth = W;
        this.builtHeight = H;
        if (W === 0 || H === 0)
        {
            return;
        }
        this.W = W;
        this.H = H;
        this.dpr = Math.min(window.devicePixelRatio || 1, 2);
        this.canvas.width = W * this.dpr;
        this.canvas.height = H * this.dpr;
        this.ctx = this.canvas.getContext('2d');
        this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);

        this.s = GraphBanner.Seed * 2654435761 >>> 0;
        this.zones = this.MeasureZones();
        this.BuildGraph();
        this.RenderStatic();
        this.StartPulses();
        this.Frame();
    }

    BuildGraph()
    {
        const W = this.W, H = this.H;
        const nHub = Math.max(3, Math.round(W / GraphBanner.HubSpacing));
        const cross = Math.round(nHub * 1.4);
        const hubCols = [GraphBanner.Green, GraphBanner.Green, GraphBanner.Cyan];
        const cPool = this.Shuffle(GraphBanner.Concepts), ePool = this.Shuffle(GraphBanner.Entities);
        const hubs = [], nodes = [], edges = [];
        const step = W / nHub;

        for (let i = 0; i < nHub; i++)
        {
            let hx, hy, ok = false;
            for (let k = 0; k < 30 && !ok; k++)
            {
                hx = step * (i + 0.5) + (this.Rnd() - 0.5) * step * 0.4;
                hy = H * (0.1 + this.Rnd() * 0.8);
                ok = !this.InZone(hx, hy, 36);
            }
            if (!ok)
            {
                continue;
            }
            const h = { x: hx, y: hy, r: 5 + this.Rnd() * 2.5, hub: true, col: this.Pick(hubCols), label: cPool[i % cPool.length] };
            hubs.push(h);
            nodes.push(h);
        }

        let ei = 0;
        for (const h of hubs)
        {
            const n = Math.max(2, GraphBanner.KidsPerHub - 1 + Math.floor(this.Rnd() * 3));
            for (let i = 0; i < n; i++)
            {
                const ang = this.Rnd() * Math.PI * 2, rad = 50 + this.Rnd() * 70;
                const c = {
                    x: h.x + Math.cos(ang) * rad * 1.3,
                    y: GraphBanner.Clamp(h.y + Math.sin(ang) * rad * 0.8, 16, H - 16),
                    r: 2 + this.Rnd() * 1.6,
                    col: h.col,
                    parent: h,
                    label: this.Rnd() < 0.55 ? ePool[ei++ % ePool.length] : null,
                };
                if (this.InZone(c.x, c.y, 14) || c.x < 12 || c.x > W - 12)
                {
                    continue;
                }
                nodes.push(c);
                edges.push({ a: h, b: c, kind: GraphBanner.EdgeOwn, rel: this.Rnd() < 0.3 ? this.Pick(GraphBanner.Relations) : null });
            }
        }

        // concept-to-concept semantic links
        for (let i = 0; i < hubs.length - 1; i++)
        {
            edges.push({ a: hubs[i], b: hubs[i + 1], kind: GraphBanner.EdgeCore, rel: this.Pick(GraphBanner.Relations) });
            if (i < hubs.length - 2 && this.Rnd() < 0.35)
            {
                edges.push({ a: hubs[i], b: hubs[i + 2], kind: GraphBanner.EdgeCore, rel: this.Pick(GraphBanner.Relations) });
            }
        }

        // cross-links between entities of different concepts
        const leaves = nodes.filter(n => !n.hub);
        for (let k = 0, tries = 0; leaves.length > 1 && k < cross && tries < 400; tries++)
        {
            const a = this.Pick(leaves), b = this.Pick(leaves);
            if (a.parent === b.parent)
            {
                continue;
            }
            const d = Math.abs(a.x - b.x);
            if (d > step * 1.8 || d < 60)
            {
                continue;
            }
            edges.push({ a, b, kind: GraphBanner.EdgeCross, rel: this.Rnd() < 0.3 ? this.Pick(GraphBanner.Relations) : null });
            k++;
        }

        // curve each edge; try alternative bends until it clears the keep-clear zones, else drop it
        const kept = edges.filter(e => this.RouteClear(e));
        const linked = new Set();
        kept.forEach(e => { linked.add(e.a); linked.add(e.b); });

        this.hubs = hubs;
        this.edges = kept;
        this.nodes = nodes.filter(n => n.hub || linked.has(n));
    }

    RouteClear(e)
    {
        const mx = (e.a.x + e.b.x) / 2, my = (e.a.y + e.b.y) / 2, dx = e.b.x - e.a.x, dy = e.b.y - e.a.y, L = Math.hypot(dx, dy) || 1;
        const base = (e.kind === GraphBanner.EdgeCore ? 0.12 : e.kind === GraphBanner.EdgeCross ? 0.22 : 0.06) * (this.Rnd() < 0.5 ? -1 : 1);
        e.L = L;
        for (const m of [1, -1, 2.5, -2.5])
        {
            const bend = base * m * L;
            e.c = { x: mx - dy / L * bend, y: GraphBanner.Clamp(my + dx / L * bend, 4, this.H - 4) };
            let clear = true;
            for (let k = 0; k <= 16 && clear; k++)
            {
                const p = GraphBanner.Qp(e, k / 16);
                if (this.InZone(p.x, p.y, 10))
                {
                    clear = false;
                }
            }
            if (clear)
            {
                return true;
            }
        }
        return false;
    }

    // --- static layer -----------------------------------------------------

    RenderStatic()
    {
        const bg = document.createElement('canvas');
        bg.width = this.W * this.dpr;
        bg.height = this.H * this.dpr;
        const b = bg.getContext('2d');
        b.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        this.DrawEdges(b);
        this.DrawNodes(b);
        this.DrawLabels(b);
        this.bg = bg;
    }

    DrawEdges(b)
    {
        const grey = GraphBanner.Grey;
        for (const e of this.edges)
        {
            b.beginPath();
            b.moveTo(e.a.x, e.a.y);
            b.quadraticCurveTo(e.c.x, e.c.y, e.b.x, e.b.y);
            if (e.kind === GraphBanner.EdgeCore)
            {
                b.strokeStyle = `rgba(${e.a.col},0.30)`; b.lineWidth = 1; b.setLineDash([]);
            }
            else if (e.kind === GraphBanner.EdgeCross)
            {
                b.strokeStyle = `rgba(${grey},0.14)`; b.lineWidth = 1; b.setLineDash([3, 4]);
            }
            else
            {
                b.strokeStyle = `rgba(${grey},0.18)`; b.lineWidth = 0.8; b.setLineDash([]);
            }
            b.stroke();

            // arrowhead near target
            const p = GraphBanner.Qp(e, 0.86), q = GraphBanner.Qp(e, 0.9), ang = Math.atan2(q.y - p.y, q.x - p.x);
            b.setLineDash([]);
            b.fillStyle = e.kind === GraphBanner.EdgeCore ? `rgba(${e.a.col},0.45)` : `rgba(${grey},0.3)`;
            b.beginPath();
            b.moveTo(q.x, q.y);
            b.lineTo(q.x - Math.cos(ang - 0.45) * 5, q.y - Math.sin(ang - 0.45) * 5);
            b.lineTo(q.x - Math.cos(ang + 0.45) * 5, q.y - Math.sin(ang + 0.45) * 5);
            b.closePath();
            b.fill();
        }
    }

    DrawNodes(b)
    {
        const ground = GraphBanner.Ground;
        for (const n of this.nodes)
        {
            if (n.hub)
            {
                const g = b.createRadialGradient(n.x, n.y, 0, n.x, n.y, n.r * 5);
                g.addColorStop(0, `rgba(${n.col},0.14)`);
                g.addColorStop(1, `rgba(${n.col},0)`);
                b.fillStyle = g; b.beginPath(); b.arc(n.x, n.y, n.r * 5, 0, 6.283); b.fill();
                b.fillStyle = ground; b.beginPath(); b.arc(n.x, n.y, n.r + 3, 0, 6.283); b.fill();
                b.strokeStyle = `rgba(${n.col},0.35)`; b.lineWidth = 1; b.beginPath(); b.arc(n.x, n.y, n.r + 3, 0, 6.283); b.stroke();
                b.fillStyle = `rgba(${n.col},0.8)`; b.beginPath(); b.arc(n.x, n.y, n.r, 0, 6.283); b.fill();
            }
            else
            {
                b.fillStyle = ground; b.beginPath(); b.arc(n.x, n.y, n.r + 1.5, 0, 6.283); b.fill();
                b.strokeStyle = `rgba(${n.col},0.5)`; b.lineWidth = 1; b.beginPath(); b.arc(n.x, n.y, n.r, 0, 6.283); b.stroke();
            }
        }
    }

    // labels with collision avoidance: hubs → entities → relations
    DrawLabels(b)
    {
        const W = this.W, H = this.H, PAD = 4;
        const placed = this.zones.map(z => ({ x: z.x - 8, y: z.y - 8, w: z.w + 16, h: z.h + 16 }));
        const nodes = this.nodes;
        const hits = (r) =>
        {
            if (r.x < 4 || r.x + r.w > W - 4 || r.y < 2 || r.y + r.h > H - 2)
            {
                return true;
            }
            if (placed.some(p => r.x < p.x + p.w + PAD && r.x + r.w + PAD > p.x && r.y < p.y + p.h + PAD && r.y + r.h + PAD > p.y))
            {
                return true;
            }
            return nodes.some(n =>
            {
                if (r.owner === n)
                {
                    return false;
                }
                const m = (n.hub ? n.r + 3 : n.r) + 8;
                const cx = Math.max(r.x, Math.min(n.x, r.x + r.w)), cy = Math.max(r.y, Math.min(n.y, r.y + r.h));
                return Math.hypot(n.x - cx, n.y - cy) < m;
            });
        };
        const tryPlace = (cands) =>
        {
            for (const r of cands)
            {
                if (!hits(r))
                {
                    placed.push(r);
                    return r;
                }
            }
            return null;
        };

        b.textBaseline = 'middle';
        b.textAlign = 'left';
        b.font = GraphBanner.HubFont;
        for (const n of this.hubs)
        {
            if (!nodes.includes(n))
            {
                continue;
            }
            const w = b.measureText(n.label).width, h = 14, o = n.r + 7;
            const r = tryPlace([
                { x: n.x + o, y: n.y - o - h / 2 - 2, w, h, owner: n },
                { x: n.x + o, y: n.y + o - h / 2 + 2, w, h, owner: n },
                { x: n.x - o - w, y: n.y - o - h / 2 - 2, w, h, owner: n },
                { x: n.x - o - w, y: n.y + o - h / 2 + 2, w, h, owner: n },
            ]);
            if (r)
            {
                b.fillStyle = GraphBanner.HubLabelColor;
                b.fillText(n.label, r.x, r.y + h / 2);
            }
        }

        b.font = GraphBanner.EntityFont;
        for (const n of nodes.filter(x => !x.hub && x.label))
        {
            const w = b.measureText(n.label).width, h = 11, o = n.r + 5;
            const r = tryPlace([
                { x: n.x + o, y: n.y - h / 2, w, h, owner: n },
                { x: n.x - o - w, y: n.y - h / 2, w, h, owner: n },
                { x: n.x - w / 2, y: n.y - o - h, w, h, owner: n },
                { x: n.x - w / 2, y: n.y + o, w, h, owner: n },
            ]);
            if (r)
            {
                b.fillStyle = `rgba(${GraphBanner.Grey},0.34)`;
                b.fillText(n.label, r.x, r.y + h / 2);
            }
        }

        b.font = GraphBanner.RelationFont;
        const relEdges = this.edges
            .filter(e => e.rel && e.L > 90)
            .sort((x, y) => (y.kind === GraphBanner.EdgeCore) - (x.kind === GraphBanner.EdgeCore));
        for (const e of relEdges)
        {
            const w = b.measureText(e.rel).width + 6, h = 12;
            const r = tryPlace([0.5, 0.4, 0.6].map(t =>
            {
                const m = GraphBanner.Qp(e, t);
                return { x: m.x - w / 2, y: m.y - h / 2, w, h };
            }));
            if (!r)
            {
                continue;
            }
            b.fillStyle = GraphBanner.Ground;
            b.fillRect(r.x, r.y, r.w, r.h);
            b.fillStyle = `rgba(${GraphBanner.Grey},${e.kind === GraphBanner.EdgeCore ? 0.42 : 0.28})`;
            b.fillText(e.rel, r.x + 3, r.y + h / 2);
        }
    }

    // --- animation: traversal pulses (a query hops along edges) ------------

    SpawnPulse()
    {
        return { e: this.Pick(this.edges), t: 0, v: 0.004 + this.Rnd() * 0.004, rev: this.Rnd() < 0.5 };
    }

    StartPulses()
    {
        this.lit = new Map();
        this.pulses = [];
        if (!this.edges.length)
        {
            return;
        }
        for (let i = 0; i < GraphBanner.PulseCount; i++)
        {
            const p = this.SpawnPulse();
            p.t = this.Rnd();
            this.pulses.push(p);
        }
    }

    Frame()
    {
        const ctx = this.ctx;
        ctx.clearRect(0, 0, this.W, this.H);
        ctx.drawImage(this.bg, 0, 0, this.W, this.H);

        this.lit.forEach((a, n) =>
        {
            ctx.strokeStyle = `rgba(${n.col},${(0.5 * a).toFixed(3)})`;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(n.x, n.y, (n.hub ? n.r + 3 : n.r) + (1 - a) * 8, 0, 6.283);
            ctx.stroke();
            a -= 0.02;
            if (a <= 0)
            {
                this.lit.delete(n);
            }
            else
            {
                this.lit.set(n, a);
            }
        });

        this.pulses.forEach((p, i) => this.StepPulse(p, i));

        if (this.animate)
        {
            this.raf = requestAnimationFrame(() => this.Frame());
        }
    }

    StepPulse(p, i)
    {
        const ctx = this.ctx;
        if (this.animate)
        {
            p.t += p.v * (300 / Math.max(120, p.e.L));
        }
        if (p.t >= 1)
        {
            const end = p.rev ? p.e.a : p.e.b;
            this.lit.set(end, 1);
            const next = this.edges.filter(e => e !== p.e && (e.a === end || e.b === end));
            if (next.length && this.Rnd() < 0.75)
            {
                const e = this.Pick(next);
                this.pulses[i] = { e, t: 0, v: p.v, rev: e.b === end };
            }
            else
            {
                this.pulses[i] = this.SpawnPulse();
            }
            return;
        }
        const col = p.e.kind === GraphBanner.EdgeCore || p.e.kind === GraphBanner.EdgeOwn ? p.e.a.col : GraphBanner.Green;
        const pos = k => GraphBanner.Qp(p.e, p.rev ? 1 - k : k);
        for (let k = 1; k <= 8; k++)
        {
            const q = pos(Math.max(0, p.t - k * 0.012));
            ctx.fillStyle = `rgba(${col},${(0.2 * (1 - k / 9)).toFixed(3)})`;
            ctx.beginPath(); ctx.arc(q.x, q.y, 1.2, 0, 6.283); ctx.fill();
        }
        const h = pos(p.t);
        ctx.fillStyle = `rgba(${col},0.85)`;
        ctx.beginPath(); ctx.arc(h.x, h.y, 1.8, 0, 6.283); ctx.fill();
    }
}

if (document.readyState === 'loading')
{
    document.addEventListener('DOMContentLoaded', () => GraphBanner.MountAll());
}
else
{
    GraphBanner.MountAll();
}
