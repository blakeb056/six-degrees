'use client';

import { useEffect, useState, useRef, useCallback } from 'react';
import Link from 'next/link';

// ── Intersection Observer hook for scroll-triggered animations ──
function useInView(options = {}) {
  const ref = useRef(null);
  const [inView, setInView] = useState(false);
  useEffect(() => {
    if (!ref.current) return;
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) setInView(true); }, { threshold: 0.15, ...options });
    obs.observe(ref.current);
    return () => obs.disconnect();
  }, []);
  return [ref, inView];
}

// ── Tier colors from the real app ──
const TIER = { S: '#FFD700', A: '#9B59B6', B: '#3498DB', C: '#95A5A6', D: '#BDC3C7' };
const GRADIENT = 'linear-gradient(135deg, #FFD700, #9B59B6, #3498DB)';

// ── Animated counter ──
function Counter({ end, duration = 2000, active }) {
  const [val, setVal] = useState(0);
  useEffect(() => {
    if (!active) return;
    let start = 0;
    const step = end / (duration / 16);
    const id = setInterval(() => {
      start += step;
      if (start >= end) { setVal(end); clearInterval(id); }
      else setVal(Math.floor(start));
    }, 16);
    return () => clearInterval(id);
  }, [active, end]);
  return <span>{val.toLocaleString()}</span>;
}

// ═══════════════════════════════════════════════════════════════
// HERO — Particle background + title reveal
// ═══════════════════════════════════════════════════════════════
function HeroSection() {
  const canvasRef = useRef(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setTimeout(() => setShow(true), 300);
    const c = canvasRef.current;
    if (!c) return;
    const ctx = c.getContext('2d');
    let w = c.width = window.innerWidth;
    let h = c.height = window.innerHeight;
    const nodes = Array.from({ length: 120 }, () => ({
      x: Math.random() * w, y: Math.random() * h,
      vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4,
      r: Math.random() * 2.5 + 1,
      color: [TIER.S, TIER.A, TIER.B, '#fff', TIER.S, TIER.A, TIER.B][Math.floor(Math.random() * 7)],
    }));
    let raf;
    function draw() {
      ctx.clearRect(0, 0, w, h);
      // connections
      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx.beginPath();
            ctx.moveTo(nodes[i].x, nodes[i].y);
            ctx.lineTo(nodes[j].x, nodes[j].y);
            ctx.strokeStyle = `rgba(52,152,219,${0.12 * (1 - dist / 150)})`;
            ctx.lineWidth = 0.5;
            ctx.stroke();
          }
        }
      }
      // nodes
      nodes.forEach(n => {
        n.x += n.vx; n.y += n.vy;
        if (n.x < 0 || n.x > w) n.vx *= -1;
        if (n.y < 0 || n.y > h) n.vy *= -1;
        ctx.beginPath();
        ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.globalAlpha = 0.6;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
      raf = requestAnimationFrame(draw);
    }
    draw();
    const onResize = () => { w = c.width = window.innerWidth; h = c.height = window.innerHeight; };
    window.addEventListener('resize', onResize);
    return () => { cancelAnimationFrame(raf); window.removeEventListener('resize', onResize); };
  }, []);

  return (
    <section style={{ position: 'relative', height: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
      <canvas ref={canvasRef} style={{ position: 'absolute', inset: 0, zIndex: 0 }} />
      {/* Radial vignette */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 50%, transparent 30%, #0a0a1a 75%)', zIndex: 1 }} />
      {/* Center glow */}
      <div style={{ position: 'absolute', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,152,219,0.08) 0%, transparent 70%)', top: '50%', left: '50%', transform: 'translate(-50%,-50%)', zIndex: 1 }} />

      <div style={{ position: 'relative', zIndex: 2, textAlign: 'center', maxWidth: 900, padding: '0 24px' }}>
        {/* Badge */}
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 16px',
          borderRadius: 20, border: '1px solid rgba(52,152,219,0.3)', background: 'rgba(52,152,219,0.08)',
          fontSize: 13, color: '#3498DB', fontWeight: 600, marginBottom: 32,
          opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(20px)',
          transition: 'all 0.8s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3498DB', animation: 'pulse-dot 2s infinite' }} />
          Research Project by Blake Burford
        </div>

        {/* Title */}
        <h1 style={{
          fontSize: 'clamp(48px, 8vw, 96px)', fontWeight: 800, lineHeight: 1.05, margin: 0,
          background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          opacity: show ? 1 : 0, transform: show ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1) 0.15s',
          letterSpacing: '-0.03em',
        }}>
          6 Degrees of<br />Separation
        </h1>

        {/* Subtitle */}
        <p style={{
          fontSize: 'clamp(16px, 2.5vw, 22px)', color: 'rgba(255,255,255,0.55)', maxWidth: 600, margin: '24px auto 0',
          lineHeight: 1.6, fontWeight: 400,
          opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(30px)',
          transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1) 0.35s',
        }}>
          Visualizing the hidden architecture of professional networks.
          Every connection is a degree. Every bridge is a path to power.
        </p>

        {/* CTA pills */}
        <div style={{
          display: 'flex', gap: 16, justifyContent: 'center', marginTop: 48, flexWrap: 'wrap',
          opacity: show ? 1 : 0, transform: show ? 'translateY(0)' : 'translateY(30px)',
          transition: 'all 1s cubic-bezier(0.16, 1, 0.3, 1) 0.55s',
        }}>
          <Link href="/" style={{
            padding: '14px 32px', borderRadius: 12, border: 'none', fontSize: 16, fontWeight: 700,
            background: GRADIENT, color: '#000', cursor: 'pointer', textDecoration: 'none',
            boxShadow: '0 4px 24px rgba(255,215,0,0.3)',
          }}>
            Open App
          </Link>
          <button onClick={() => document.getElementById('features')?.scrollIntoView({ behavior: 'smooth' })} style={{
            padding: '14px 32px', borderRadius: 12, border: '1px solid rgba(255,255,255,0.15)',
            fontSize: 16, fontWeight: 600, background: 'rgba(255,255,255,0.05)', color: '#fff',
            cursor: 'pointer', backdropFilter: 'blur(12px)',
          }}>
            See How It Works
          </button>
        </div>

        {/* Scroll indicator */}
        <div style={{
          position: 'absolute', bottom: -120, left: '50%', transform: 'translateX(-50%)',
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8,
          opacity: show ? 0.4 : 0, transition: 'opacity 1.5s ease 1.2s',
        }}>
          <span style={{ fontSize: 11, color: '#555', letterSpacing: 2, textTransform: 'uppercase' }}>Scroll</span>
          <div style={{ width: 1, height: 40, background: 'linear-gradient(to bottom, rgba(255,255,255,0.3), transparent)', animation: 'scroll-line 2s infinite' }} />
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// STATS BAR — Animated counters
// ═══════════════════════════════════════════════════════════════
function StatsBar() {
  const [ref, inView] = useInView();
  const stats = [
    { label: 'Connections Mapped', value: 2438, color: '#3498DB' },
    { label: 'Bridges Discovered', value: 25, color: '#FFD700' },
    { label: 'Power Scored', value: 575, color: '#9B59B6' },
    { label: 'Degrees Deep', value: 6, color: '#00ff88' },
  ];
  return (
    <section ref={ref} style={{ padding: '80px 24px', borderTop: '1px solid rgba(255,255,255,0.05)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto', display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 32 }}>
        {stats.map((s, i) => (
          <div key={i} style={{
            textAlign: 'center',
            opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(30px)',
            transition: `all 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 0.1}s`,
          }}>
            <div style={{ fontSize: 48, fontWeight: 800, color: s.color, lineHeight: 1 }}>
              <Counter end={s.value} active={inView} />
              {s.value > 100 ? '+' : ''}
            </div>
            <div style={{ fontSize: 13, color: '#666', marginTop: 8, fontWeight: 500, letterSpacing: 0.5 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// GALAXY SHOWCASE — Animated CSS rings
// ═══════════════════════════════════════════════════════════════
function GalaxySection() {
  const [ref, inView] = useInView();
  const rings = [
    { tier: 'S', color: TIER.S, r: 55, count: 10, label: 'S-Tier', speed: 60 },
    { tier: 'A', color: TIER.A, r: 95, count: 18, label: 'A-Tier', speed: 90 },
    { tier: 'B', color: TIER.B, r: 135, count: 30, label: 'B-Tier', speed: 120 },
    { tier: 'C', color: TIER.C, r: 175, count: 44, label: 'C-Tier', speed: 150 },
    { tier: 'D', color: TIER.D, r: 210, count: 56, label: 'D-Tier', speed: 180 },
  ];

  return (
    <section id="features" ref={ref} style={{ padding: '100px 24px', position: 'relative' }}>
      {/* Section label */}
      <div className="galaxy-grid" style={{ maxWidth: 1100, margin: '0 auto', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 48, alignItems: 'center' }}>
        {/* Left: text */}
        <div style={{
          opacity: inView ? 1 : 0, transform: inView ? 'translateX(0)' : 'translateX(-50px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TIER.S, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            Network Circle
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15, margin: 0, color: '#fff' }}>
            Your Network,<br />
            <span style={{ background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Visualized in Orbit
            </span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.5)', lineHeight: 1.7, marginTop: 20, maxWidth: 440 }}>
            Every connection orbits you by power tier. S-Tier innermost, D-Tier outermost.
            A living galaxy of influence — zoom, filter, and explore your entire professional universe.
          </p>
          {/* Tier legend */}
          <div style={{ display: 'flex', gap: 12, marginTop: 32, flexWrap: 'wrap' }}>
            {Object.entries(TIER).map(([t, c]) => (
              <div key={t} style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                borderRadius: 8, background: `${c}15`, border: `1px solid ${c}30`,
              }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: c }} />
                <span style={{ fontSize: 12, fontWeight: 600, color: c }}>{t}-Tier</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: animated galaxy */}
        <div className="galaxy-rings" style={{
          position: 'relative', width: 440, height: 440, margin: '0 auto',
          opacity: inView ? 1 : 0, transform: inView ? 'scale(1)' : 'scale(0.8)',
          transition: 'all 1.2s cubic-bezier(0.16,1,0.3,1) 0.2s',
        }}>
          {/* Glow */}
          <div style={{ position: 'absolute', top: '50%', left: '50%', width: '60%', height: '60%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(52,152,219,0.12) 0%, transparent 70%)', transform: 'translate(-50%,-50%)' }} />

          {/* Center node */}
          <div style={{
            position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%,-50%)',
            width: 40, height: 40, borderRadius: '50%', background: '#fff',
            boxShadow: '0 0 30px rgba(255,255,255,0.4), 0 0 60px rgba(52,152,219,0.2)', zIndex: 10,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 9, fontWeight: 800, color: '#0a0a1a',
          }}>
            YOU
          </div>

          {/* Rings */}
          {rings.map((ring, ri) => (
            <div key={ri} style={{
              position: 'absolute', top: '50%', left: '50%',
              width: ring.r * 2, height: ring.r * 2,
              borderRadius: '50%', border: `1px solid ${ring.color}15`,
              transform: 'translate(-50%,-50%)',
              animation: inView ? `spin-ring ${ring.speed}s linear infinite` : 'none',
            }}>
              {Array.from({ length: ring.count }).map((_, i) => {
                const angle = (i / ring.count) * Math.PI * 2;
                // Rounded because the browser's CSS parser rounds these anyway;
                // handing React full float precision makes its hydration check
                // compare 35.00406530937789 against the DOM's "35.0041px".
                const x = Math.round((Math.cos(angle) * ring.r + ring.r) * 100) / 100;
                const y = Math.round((Math.sin(angle) * ring.r + ring.r) * 100) / 100;
                return (
                  <div key={i} style={{
                    position: 'absolute', left: x - 3, top: y - 3,
                    width: 6, height: 6, borderRadius: '50%',
                    background: ring.color,
                    opacity: Number((0.6 + jitter(ri, i, 1) * 0.4).toFixed(3)),
                    animation: `breathe ${(2 + jitter(ri, i, 2) * 2).toFixed(2)}s ease-in-out infinite ${(jitter(ri, i, 3) * 2).toFixed(2)}s`,
                  }} />
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// BRIDGE CHAINS — 6 degrees visualization
// ═══════════════════════════════════════════════════════════════
function ChainSection() {
  const [ref, inView] = useInView();
  const degrees = [
    { d: 1, label: 'Your Connections', desc: 'Direct network — scored & tiered', color: '#3498DB', count: 575 },
    { d: 2, label: 'Bridge Connections', desc: 'Friends of your bridges', color: '#9B59B6', count: 1519 },
    { d: 3, label: 'Extended Reach', desc: 'Bridged from promoted D2s', color: '#FFD700', count: 344 },
    { d: 4, label: 'Industry Layer', desc: 'Company & sector intelligence', color: '#FF6B35', count: null },
    { d: 5, label: 'Market Layer', desc: 'Cross-industry connections', color: '#00ff88', count: null },
    { d: 6, label: 'Global Reach', desc: 'Anyone in the world', color: '#ff5050', count: null },
  ];

  return (
    <section ref={ref} style={{ padding: '100px 24px', position: 'relative' }}>
      <div style={{ maxWidth: 1000, margin: '0 auto' }}>
        <div style={{
          textAlign: 'center', marginBottom: 80,
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#FF6B35', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            Bridge Chains
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15, margin: 0 }}>
            <span style={{ color: '#fff' }}>Six Degrees.</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, #FF6B35, #FFD700)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Infinite Reach.
            </span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)', marginTop: 16, maxWidth: 560, margin: '16px auto 0' }}>
            Every person on Earth is at most 6 connections away. Our chain system maps the exact path from you to anyone.
          </p>
        </div>

        {/* Chain visualization */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 0, flexWrap: 'wrap' }}>
          {degrees.map((d, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center',
              opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
              transition: `all 0.8s cubic-bezier(0.16,1,0.3,1) ${0.1 * i + 0.3}s`,
            }}>
              {/* Node */}
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', width: 120 }}>
                <div style={{
                  width: 64, height: 64, borderRadius: '50%',
                  background: `${d.color}20`, border: `2px solid ${d.color}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 22, fontWeight: 800, color: d.color,
                  boxShadow: `0 0 24px ${d.color}30`,
                  animation: inView ? `breathe 3s ease-in-out infinite ${i * 0.5}s` : 'none',
                  position: 'relative',
                }}>
                  D{d.d}
                  {d.count && (
                    <span style={{
                      position: 'absolute', bottom: -8, fontSize: 9, fontWeight: 700,
                      background: d.color, color: '#000', padding: '2px 6px', borderRadius: 10,
                    }}>
                      {d.count.toLocaleString()}
                    </span>
                  )}
                </div>
                <div style={{ fontSize: 11, fontWeight: 700, color: d.color, marginTop: 16 }}>{d.label}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4, textAlign: 'center' }}>{d.desc}</div>
              </div>

              {/* Connector line */}
              {i < 5 && (
                <div style={{
                  width: 40, height: 2, position: 'relative',
                  background: `linear-gradient(to right, ${d.color}60, ${degrees[i + 1].color}60)`,
                  opacity: inView ? 1 : 0,
                  transition: `opacity 0.6s ease ${0.1 * i + 0.6}s`,
                }}>
                  <div style={{
                    position: 'absolute', top: -2, width: 6, height: 6, borderRadius: '50%',
                    background: d.color,
                    animation: inView ? `travel-dot 2s ease-in-out infinite ${i * 0.3}s` : 'none',
                  }} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// POWER SCORING — Tier cards
// ═══════════════════════════════════════════════════════════════
function ScoringSection() {
  const [ref, inView] = useInView();
  const tiers = [
    { tier: 'S', label: 'Supreme', score: '7.0+', color: TIER.S, glow: 'rgba(255,215,0,0.3)', people: 'C-Suite, VPs, Founders', icon: '👑' },
    { tier: 'A', label: 'Ace', score: '5.5+', color: TIER.A, glow: 'rgba(155,89,182,0.3)', people: 'Directors, Senior Leaders', icon: '💎' },
    { tier: 'B', label: 'Builder', score: '4.0+', color: TIER.B, glow: 'rgba(52,152,219,0.3)', people: 'Managers, Senior ICs', icon: '🔷' },
    { tier: 'C', label: 'Connector', score: '2.5+', color: TIER.C, glow: 'rgba(149,165,166,0.2)', people: 'Associates, Specialists', icon: '🔸' },
    { tier: 'D', label: 'Developing', score: '<2.5', color: TIER.D, glow: 'rgba(189,195,199,0.15)', people: 'Entry Level, Students', icon: '🌱' },
  ];

  return (
    <section ref={ref} style={{ padding: '100px 24px', background: 'linear-gradient(180deg, transparent, rgba(52,152,219,0.03), transparent)' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{
          textAlign: 'center', marginBottom: 64,
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: TIER.A, letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            Power Score
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800, lineHeight: 1.15 }}>
            <span style={{ color: '#fff' }}>Every Connection,</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, #FFD700, #9B59B6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Ranked by Power
            </span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)', marginTop: 16, maxWidth: 500, margin: '16px auto 0' }}>
            Seniority, company prestige, and circle proximity combine into one score.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: 16 }}>
          {tiers.map((t, i) => (
            <div key={i} style={{
              padding: 24, borderRadius: 16, position: 'relative', overflow: 'hidden',
              background: 'rgba(255,255,255,0.03)', border: `1px solid ${t.color}25`,
              opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
              transition: `all 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 0.08 + 0.2}s`,
            }}>
              {/* Glow */}
              <div style={{ position: 'absolute', top: -20, right: -20, width: 100, height: 100, borderRadius: '50%', background: `radial-gradient(circle, ${t.glow}, transparent)`, filter: 'blur(20px)' }} />

              <div style={{ fontSize: 28, marginBottom: 8 }}>{t.icon}</div>
              <div style={{
                fontSize: 32, fontWeight: 900, color: t.color, lineHeight: 1,
                textShadow: `0 0 20px ${t.glow}`,
              }}>
                {t.tier}
              </div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>{t.label}</div>
              <div style={{ fontSize: 11, color: '#555', marginTop: 2 }}>Score: {t.score}</div>
              <div style={{
                fontSize: 10, color: 'rgba(255,255,255,0.35)', marginTop: 12,
                padding: '6px 10px', borderRadius: 8, background: 'rgba(255,255,255,0.04)',
              }}>
                {t.people}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// FEATURES GRID — Paths, Outlink, XP
// ═══════════════════════════════════════════════════════════════
function FeaturesGrid() {
  const [ref, inView] = useInView();
  const features = [
    {
      title: 'Paths',
      subtitle: 'Company Intelligence',
      desc: 'Scan any company on LinkedIn and see every person mapped, scored, and organized by seniority. 80+ company normalizations built in.',
      color: '#00ff88',
      icon: '🏢',
      stat: '344 people scanned',
    },
    {
      title: 'Outlink',
      subtitle: 'Strategic Action Queue',
      desc: 'Your curated list of high-value D2 connections to request. Grouped by bridge, filtered by tier, with batch-open for efficient networking.',
      color: '#FF6B35',
      icon: '🚀',
      stat: '798 recommendations',
    },
    {
      title: 'XP System',
      subtitle: 'Gamified Networking',
      desc: 'Earn XP for every outreach sent and connection accepted. Higher tier connections = more points. Level up your networking game.',
      color: '#FFD700',
      icon: '⚡',
      stat: 'S-Tier = 25 XP',
    },
    {
      title: 'Bridge Clusters',
      subtitle: 'Deep Network Mining',
      desc: 'Select any D1 connection as a bridge. Automatically discover and score all their connections — your D2 layer.',
      color: '#9B59B6',
      icon: '🔗',
      stat: '25 bridges mapped',
    },
  ];

  return (
    <section ref={ref} style={{ padding: '100px 24px' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto' }}>
        <div style={{
          textAlign: 'center', marginBottom: 64,
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#00ff88', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            Full Arsenal
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800 }}>
            <span style={{ color: '#fff' }}>Tools That</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, #00ff88, #3498DB)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Make Moves
            </span>
          </h2>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 20 }}>
          {features.map((f, i) => (
            <div key={i} style={{
              padding: 28, borderRadius: 20, position: 'relative', overflow: 'hidden',
              background: 'rgba(255,255,255,0.02)',
              border: '1px solid rgba(255,255,255,0.06)',
              backdropFilter: 'blur(12px)',
              opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
              transition: `all 0.8s cubic-bezier(0.16,1,0.3,1) ${i * 0.1 + 0.2}s`,
            }}>
              {/* Corner glow */}
              <div style={{
                position: 'absolute', top: -30, left: -30, width: 120, height: 120, borderRadius: '50%',
                background: `radial-gradient(circle, ${f.color}10, transparent)`, filter: 'blur(20px)',
              }} />

              <div style={{ fontSize: 32, marginBottom: 12 }}>{f.icon}</div>
              <div style={{ fontSize: 11, fontWeight: 700, color: f.color, letterSpacing: 1, textTransform: 'uppercase' }}>{f.subtitle}</div>
              <h3 style={{ fontSize: 22, fontWeight: 800, color: '#fff', margin: '6px 0 10px' }}>{f.title}</h3>
              <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.4)', lineHeight: 1.6, margin: 0 }}>{f.desc}</p>
              <div style={{
                marginTop: 16, padding: '6px 12px', borderRadius: 8,
                background: `${f.color}10`, display: 'inline-block',
                fontSize: 11, fontWeight: 700, color: f.color,
              }}>
                {f.stat}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// TECH SECTION — The formula
// ═══════════════════════════════════════════════════════════════
function TechSection() {
  const [ref, inView] = useInView();
  return (
    <section ref={ref} style={{ padding: '100px 24px', background: 'linear-gradient(180deg, transparent, rgba(155,89,182,0.03), transparent)' }}>
      <div style={{ maxWidth: 800, margin: '0 auto', textAlign: 'center' }}>
        <div style={{
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#555', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            The Algorithm
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800 }}>
            <span style={{ background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Power Score Formula
            </span>
          </h2>
        </div>

        {/* Formula card */}
        <div style={{
          marginTop: 48, padding: 40, borderRadius: 20,
          background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
          backdropFilter: 'blur(24px)',
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0) scale(1)' : 'translateY(30px) scale(0.95)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1) 0.2s',
        }}>
          <div style={{
            fontFamily: '"Geist Mono", monospace', fontSize: 20, fontWeight: 700,
            background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
            marginBottom: 32,
          }}>
            P = (S &times; 0.5) + (C &times; 0.3) + B
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 24 }}>
            {[
              { sym: 'S', label: 'Seniority', desc: 'VP = 8, Director = 6, Manager = 4', weight: '50%', color: TIER.S },
              { sym: 'C', label: 'Company Prestige', desc: 'FAANG = 9, Fortune 500 = 7', weight: '30%', color: TIER.A },
              { sym: 'B', label: 'Circle Bonus', desc: 'Inner circle proximity boost', weight: '20%', color: TIER.B },
            ].map((item, i) => (
              <div key={i} style={{
                padding: 16, borderRadius: 12, background: `${item.color}08`,
                opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(20px)',
                transition: `all 0.8s cubic-bezier(0.16,1,0.3,1) ${0.3 + i * 0.1}s`,
              }}>
                <div style={{ fontSize: 28, fontWeight: 900, color: item.color }}>{item.sym}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#fff', marginTop: 4 }}>{item.label}</div>
                <div style={{ fontSize: 10, color: '#555', marginTop: 4 }}>{item.desc}</div>
                <div style={{ fontSize: 10, color: item.color, fontWeight: 700, marginTop: 8 }}>Weight: {item.weight}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Tier thresholds */}
        <div style={{
          marginTop: 32, display: 'flex', justifyContent: 'center', gap: 8, flexWrap: 'wrap',
          opacity: inView ? 1 : 0, transition: 'opacity 1s ease 0.6s',
        }}>
          {[
            { t: 'S', min: 7, color: TIER.S },
            { t: 'A', min: 5.5, color: TIER.A },
            { t: 'B', min: 4, color: TIER.B },
            { t: 'C', min: 2.5, color: TIER.C },
            { t: 'D', min: 0, color: TIER.D },
          ].map((t, i) => (
            <div key={i} style={{
              padding: '8px 16px', borderRadius: 10,
              background: `${t.color}12`, border: `1px solid ${t.color}30`,
              fontSize: 12, fontWeight: 700, color: t.color,
            }}>
              {t.t}-Tier: {t.min}+
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// STRING THEORY — Conceptual connection
// ═══════════════════════════════════════════════════════════════
function TheorySection() {
  const [ref, inView] = useInView();
  return (
    <section ref={ref} style={{ padding: '100px 24px', position: 'relative', overflow: 'hidden' }}>
      {/* Animated strings background */}
      <div style={{ position: 'absolute', inset: 0, opacity: inView ? 0.15 : 0, transition: 'opacity 2s ease' }}>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} style={{
            position: 'absolute',
            top: `${12 + i * 12}%`,
            left: 0, right: 0, height: 1,
            background: `linear-gradient(to right, transparent, ${[TIER.S, TIER.A, TIER.B, '#fff'][i % 4]}40, transparent)`,
            animation: `wave ${4 + i}s ease-in-out infinite ${i * 0.3}s`,
          }} />
        ))}
      </div>

      <div style={{ maxWidth: 700, margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 2 }}>
        <div style={{
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0)' : 'translateY(40px)',
          transition: 'all 1s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#ff5050', letterSpacing: 3, textTransform: 'uppercase', marginBottom: 16 }}>
            The Theory
          </div>
          <h2 style={{ fontSize: 44, fontWeight: 800 }}>
            <span style={{ color: '#fff' }}>Strings Connect</span>{' '}
            <span style={{ background: 'linear-gradient(135deg, #ff5050, #FFD700)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
              Everything
            </span>
          </h2>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8, marginTop: 24, maxWidth: 560, margin: '24px auto 0' }}>
            In string theory, fundamental particles are vibrating strings connected across dimensions.
            In social networks, people are nodes connected by invisible strings of trust,
            proximity, and shared experience.
          </p>
          <p style={{ fontSize: 17, color: 'rgba(255,255,255,0.45)', lineHeight: 1.8, marginTop: 16, maxWidth: 560, margin: '16px auto 0' }}>
            Six degrees of separation isn&rsquo;t just a theory &mdash; it&rsquo;s the architecture of human connection.
            Every string vibrates with potential. Every bridge shortens the distance.
          </p>

          {/* Floating quote */}
          <div style={{
            marginTop: 48, padding: '24px 32px', borderRadius: 16,
            background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)',
            fontStyle: 'italic', color: 'rgba(255,255,255,0.3)', fontSize: 15,
            opacity: inView ? 1 : 0, transition: 'opacity 1.5s ease 0.5s',
          }}>
            &ldquo;Everyone is connected to everyone else by six degrees or fewer.
            The question isn&rsquo;t <em>if</em> &mdash; it&rsquo;s <em>through whom</em>.&rdquo;
          </div>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// CTA — Final call to action
// ═══════════════════════════════════════════════════════════════
function CTASection() {
  const [ref, inView] = useInView();
  return (
    <section ref={ref} style={{
      padding: '100px 24px', textAlign: 'center', position: 'relative', overflow: 'hidden',
    }}>
      {/* Gradient overlay */}
      <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at 50% 80%, rgba(52,152,219,0.06) 0%, transparent 60%)' }} />

      <div style={{ position: 'relative', zIndex: 2 }}>
        <div style={{
          opacity: inView ? 1 : 0, transform: inView ? 'translateY(0) scale(1)' : 'translateY(40px) scale(0.95)',
          transition: 'all 1.2s cubic-bezier(0.16,1,0.3,1)',
        }}>
          <h2 style={{
            fontSize: 'clamp(36px, 6vw, 64px)', fontWeight: 800, lineHeight: 1.1,
            background: GRADIENT, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
          }}>
            Map Your Universe
          </h2>
          <p style={{ fontSize: 18, color: 'rgba(255,255,255,0.4)', marginTop: 16, maxWidth: 480, margin: '16px auto 0' }}>
            Your network is your most valuable asset. Start seeing it for what it really is.
          </p>
          <Link href="/" style={{
            display: 'inline-block', marginTop: 40,
            padding: '16px 48px', borderRadius: 14, fontSize: 18, fontWeight: 800,
            background: GRADIENT, color: '#000', textDecoration: 'none',
            boxShadow: '0 4px 32px rgba(255,215,0,0.3), 0 0 60px rgba(52,152,219,0.15)',
            animation: inView ? 'cta-glow 3s ease-in-out infinite' : 'none',
          }}>
            Enter the Galaxy
          </Link>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 80, paddingTop: 40, borderTop: '1px solid rgba(255,255,255,0.05)',
          display: 'flex', justifyContent: 'center', gap: 32, flexWrap: 'wrap',
          opacity: inView ? 0.4 : 0, transition: 'opacity 1.5s ease 0.5s',
        }}>
          <span style={{ fontSize: 12, color: '#444' }}>Built by Blake Burford</span>
          <span style={{ fontSize: 12, color: '#444' }}>Stead Labs</span>
          <span style={{ fontSize: 12, color: '#444' }}>2026</span>
        </div>
      </div>
    </section>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════
// Stable per-dot variation. These values are read during render, so they must
// come out identical on the server and in the browser. Math.random() gave a
// different number in each pass; the results are also rounded at the call site,
// because the browser rounds CSS values when it parses them and React's
// hydration check compares its own prop against the rounded DOM value.
function jitter(ring, index, salt) {
  const n = Math.sin((ring + 1) * 12.9898 + (index + 1) * 78.233 + salt * 37.719) * 43758.5453;
  return n - Math.floor(n);
}

export default function LaunchPage() {
  return (
    <div style={{ background: '#0a0a1a', color: '#fff', overflowX: 'hidden' }}>
      <style>{`
        @keyframes pulse-dot {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.6); }
        }
        @keyframes scroll-line {
          0% { opacity: 0.3; transform: scaleY(1); }
          50% { opacity: 0.8; transform: scaleY(1.3); }
          100% { opacity: 0.3; transform: scaleY(1); }
        }
        @keyframes breathe {
          0%, 100% { transform: scale(1); opacity: 0.7; }
          50% { transform: scale(1.15); opacity: 1; }
        }
        @keyframes spin-ring {
          from { transform: translate(-50%,-50%) rotate(0deg); }
          to { transform: translate(-50%,-50%) rotate(360deg); }
        }
        @keyframes travel-dot {
          0% { left: 0; }
          50% { left: calc(100% - 6px); }
          100% { left: 0; }
        }
        @keyframes wave {
          0%, 100% { transform: translateY(0) scaleY(1); }
          50% { transform: translateY(8px) scaleY(2); }
        }
        @keyframes cta-glow {
          0%, 100% { box-shadow: 0 4px 32px rgba(255,215,0,0.3), 0 0 60px rgba(52,152,219,0.15); }
          50% { box-shadow: 0 4px 48px rgba(255,215,0,0.5), 0 0 80px rgba(52,152,219,0.25); }
        }
        html { scroll-behavior: smooth; }
        body { overflow-x: hidden; overflow-y: auto !important; }

        @media (max-width: 900px) {
          .galaxy-grid { grid-template-columns: 1fr !important; text-align: center; }
          .galaxy-rings { width: 340px !important; height: 340px !important; }
        }
        @media (max-width: 768px) {
          section { padding: 64px 16px !important; }
          h2 { font-size: 28px !important; }
          .chain-row { flex-direction: column !important; }
        }
      `}</style>

      <HeroSection />
      <StatsBar />
      <GalaxySection />
      <ChainSection />
      <ScoringSection />
      <FeaturesGrid />
      <TechSection />
      <TheorySection />
      <CTASection />
    </div>
  );
}
