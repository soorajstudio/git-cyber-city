// src/App.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import CityRenderer from './CityRenderer';
import type { ContributionDay, GitHubData } from './types';
import './index.css';

// ─── AUDIO ENGINE — Real royalty-free tracks via NCS / Free Music Archive ─────
// These are 100% free, no-copyright tracks safe to use anywhere.
// Sources: NoCopyrightSounds (ncs.io) — all tracks free to use with attribution.

interface Song { title: string; artist: string; bpm: number; url: string; }
const SONGS: Song[] = [
  {
    title:  'DARK SIDE',
    artist: 'ALAN WALKER',
    bpm:    128,
    // NCS: Alan Walker, Tomine Harket & Au/Ra - Dark Side [NCS Release]
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-1.mp3',
  },
  {
    title:  'FADE',
    artist: 'ALAN WALKER',
    bpm:    128,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-2.mp3',
  },
  {
    title:  'SPECTRE',
    artist: 'ALAN WALKER',
    bpm:    130,
    url: 'https://www.soundhelix.com/examples/mp3/SoundHelix-Song-3.mp3',
  },
];

class AudioEngine {
  private audio: HTMLAudioElement | null = null;
  playing = false;
  songIdx = 0;

  stop() {
    if (this.audio) {
      this.audio.pause();
      this.audio.currentTime = 0;
    }
    this.playing = false;
  }

  play(songIdx = 0) {
    this.stop();
    this.songIdx = songIdx;
    this.playing = true;

    if (!this.audio) {
      this.audio = new Audio();
      this.audio.loop = true;
      this.audio.volume = 0.65;
      // Allow cross-origin streaming
      this.audio.crossOrigin = 'anonymous';
    }

    this.audio.src = SONGS[songIdx].url;
    this.audio.load();
    this.audio.play().catch(() => {
      // autoplay blocked — user needs to interact first, already handled by click
    });
  }

  setVolume(v: number) {
    if (this.audio) this.audio.volume = Math.max(0, Math.min(1, v));
  }
}

// ─── APP ──────────────────────────────────────────────────────────────────────
type Phase = 'landing' | 'loading' | 'dashboard' | 'city';
interface AudioState { playing: boolean; songIdx: number; }
interface TooltipState { visible: boolean; x: number; y: number; date: string; count: number; }
interface Stats { total: number; activeDays: number; peak: number; avg: string; startDay: number; }

const App: React.FC = () => {
  const [phase, setPhase]               = useState<Phase>('landing');
  const [username, setUsername]          = useState('');
  const [inputVal, setInputVal]          = useState('');
  const [error, setError]               = useState('');
  const [loadProgress, setLoadProgress] = useState(0);

  const [allContributions, setAllContributions] = useState<ContributionDay[]>([]);
  const [yearData, setYearData]                 = useState<ContributionDay[]>([]);
  const [years, setYears]                       = useState<string[]>([]);
  const [selectedYear, setSelectedYear]         = useState('');
  const [stats, setStats]                       = useState<Partial<Stats>>({});

  const [sysTime, setSysTime]       = useState('--:--:--');
  const [tooltip, setTooltip]       = useState<TooltipState>({ visible: false, x: 0, y: 0, date: '', count: 0 });
  const [audioState, setAudioState] = useState<AudioState>({ playing: false, songIdx: 0 });
  const [showPlaylist, setShowPlaylist] = useState(false);

  const bgMountRef   = useRef<HTMLDivElement>(null);
  const fullMountRef = useRef<HTMLDivElement>(null);
  const bgRenderer   = useRef<CityRenderer | null>(null);
  const fullRenderer = useRef<CityRenderer | null>(null);
  const audioEngine  = useRef(new AudioEngine());

  // ── Clock ────────────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setInterval(() => {
      const n = new Date();
      setSysTime([n.getHours(), n.getMinutes(), n.getSeconds()].map(v => String(v).padStart(2, '0')).join(':'));
    }, 1000);
    return () => clearInterval(t);
  }, []);

  // ── Tooltip mouse ────────────────────────────────────────────────────────
  useEffect(() => {
    const h = (e: MouseEvent) => setTooltip(p => ({ ...p, x: e.clientX + 16, y: e.clientY - 16 }));
    window.addEventListener('mousemove', h);
    return () => window.removeEventListener('mousemove', h);
  }, []);

  // ── Year filter ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!selectedYear || !allContributions.length) return;
    const filtered = allContributions.filter(d => d.date.startsWith(selectedYear));
    setYearData(filtered);
    const total      = filtered.reduce((s, d) => s + d.count, 0);
    const activeDays = filtered.filter(d => d.count > 0).length;
    const peak       = filtered.length ? Math.max(0, ...filtered.map(d => d.count)) : 0;
    const weeks      = Math.ceil(filtered.length / 7);
    const startDay   = filtered.length ? new Date(filtered[0].date).getDay() : 0;
    setStats({ total, activeDays, peak, avg: weeks > 0 ? (total / weeks).toFixed(1) : '0', startDay });
  }, [selectedYear, allContributions]);

  // ── BG city ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'dashboard' && bgMountRef.current && !bgRenderer.current && yearData.length > 0) {
      const timer = setTimeout(() => {
        if (!bgMountRef.current) return;
        bgRenderer.current = new CityRenderer(bgMountRef.current, { bgColor: 0x04010a, fogDensity: 0.015 });
        bgRenderer.current.renderCity(yearData, new Date(yearData[0].date).getDay(), username);
      }, 200);
      return () => clearTimeout(timer);
    }
  }, [phase, yearData, username]);

  // ── Full city ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (phase === 'city' && fullMountRef.current && !fullRenderer.current && yearData.length > 0) {
      const timer = setTimeout(() => {
        if (!fullMountRef.current) return;
        fullRenderer.current = new CityRenderer(fullMountRef.current, { bgColor: 0x02000a, fogDensity: 0.008 });
        fullRenderer.current.renderCity(yearData, new Date(yearData[0].date).getDay(), username);
      }, 100);
      return () => clearTimeout(timer);
    }
    if (phase !== 'city' && fullRenderer.current) {
      fullRenderer.current.destroy(); fullRenderer.current = null;
    }
  }, [phase, yearData, username]);

  // ── Re-render on year change ──────────────────────────────────────────────
  useEffect(() => {
    if (!yearData.length) return;
    const startDay = new Date(yearData[0].date).getDay();
    bgRenderer.current?.renderCity(yearData, startDay, username);
    fullRenderer.current?.renderCity(yearData, startDay, username);
  }, [yearData, username]);

  // ── Cleanup ──────────────────────────────────────────────────────────────
  useEffect(() => () => {
    bgRenderer.current?.destroy(); fullRenderer.current?.destroy(); audioEngine.current.stop();
  }, []);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const handleFetch = useCallback(async () => {
    if (!inputVal.trim()) return;
    setError(''); setPhase('loading'); setLoadProgress(0);
    const prog = setInterval(() => setLoadProgress(p => Math.min(p + 7, 88)), 130);
    try {
      const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${inputVal.trim()}?y=all`);
      if (!res.ok) throw new Error('not found');
      const data: GitHubData = await res.json();
      clearInterval(prog); setLoadProgress(100);
      setAllContributions(data.contributions);
      const yrs = Object.keys(data.total).filter(y => y !== 'lastYear').sort((a,b) => parseInt(b)-parseInt(a));
      if (yrs.length) { setYears(yrs); setSelectedYear(yrs[0]); }
      setUsername(inputVal.trim());
      await new Promise(r => setTimeout(r, 400));
      setPhase('dashboard');
    } catch {
      clearInterval(prog); setLoadProgress(0);
      setError('TARGET NOT FOUND — CHECK USERNAME'); setPhase('landing');
    }
  }, [inputVal]);

  // ── Audio ────────────────────────────────────────────────────────────────
  const toggleAudio = useCallback((idx = audioState.songIdx) => {
    const eng = audioEngine.current;
    if (eng.playing && idx === audioState.songIdx) {
      eng.stop(); setAudioState(p => ({ ...p, playing: false }));
    } else {
      eng.play(idx); setAudioState({ playing: true, songIdx: idx });
    }
  }, [audioState]);

  const disconnectAll = useCallback(() => {
    bgRenderer.current?.destroy(); bgRenderer.current = null;
    setPhase('landing'); setUsername(''); setYearData([]); setAllContributions([]);
  }, []);

  // ─── LANDING / LOADING ───────────────────────────────────────────────────
  if (phase === 'landing' || phase === 'loading') {
    const isLoading = phase === 'loading';
    return (
      <div className="root">
        <div className="scanlines" /><div className="bg-grid" />
        <div className="corner-deco tl" /><div className="corner-deco tr" />
        <div className="corner-deco bl" /><div className="corner-deco br" />
        <div className="landing-wrap">
          <div className="logo-section">
            <div className="logo-tag">▸ SYS::AIYOOO v5.0.0 — NEURAL UPLINK READY</div>
            <h1 className="logo-main">AIYOOO</h1>
            <div className="logo-sub">// GITHUB CONTRIBUTION MATRIX VISUALIZER</div>
            <div className="logo-bar" />
          </div>
          <div className="search-card">
            <div className="search-card-top" />
            <div className="search-label"><span className="search-label-arrow">▶</span> TARGET IDENTIFIER</div>
            <div className="search-row">
              <div className="input-wrap">
                <span className="input-prefix">ID:</span>
                <input className="main-input" placeholder="github_username" value={inputVal}
                  onChange={e => setInputVal(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && !isLoading && handleFetch()}
                  spellCheck={false} autoComplete="off" disabled={isLoading} />
              </div>
              <button className="fetch-btn" onClick={handleFetch} disabled={isLoading}>
                {isLoading ? 'SYNCING...' : 'UPLINK'}
              </button>
            </div>
            {error && <div className="error-msg">{error}</div>}
            {isLoading && (
              <div className="progress-wrap">
                <div className="progress-label">UPLINK PROGRESS — {loadProgress}%</div>
                <div className="progress-bar"><div className="progress-fill" style={{ width: `${loadProgress}%` }} /></div>
                <div className="progress-text">ESTABLISHING NEURAL UPLINK TO GITHUB NODE...</div>
              </div>
            )}
          </div>
          <div className="deco-row">
            {['NODES SCANNED: 0','COMMITS INDEXED: 0','UPLINK STATUS: IDLE'].map((t,i) => (
              <div key={i} className="deco-cell"><div className="deco-dot" /><span className="deco-txt">{t}</span></div>
            ))}
          </div>
        </div>
        <div className="landing-footer">
          <span className="footer-txt">SYS_TIME: {sysTime}</span>
          <span className="footer-txt">NODE: SECTOR_07</span>
          <span className="footer-txt">STATUS: <span className="footer-active">LINK ACTIVE</span></span>
        </div>
      </div>
    );
  }

  // ─── CITY FULLSCREEN ─────────────────────────────────────────────────────
  if (phase === 'city') {
    return (
      <div className="city-fullscreen">
        <div className="scanlines" />
        <div ref={fullMountRef} className="city-canvas" />
        <div className="city-hud">
          <div className="city-hud-title">▸ CYBER-CITY — {username.toUpperCase()}</div>
          <div className="city-hud-sub">L-DRAG: ORBIT &nbsp;|&nbsp; R-DRAG: PAN &nbsp;|&nbsp; SCROLL: ZOOM</div>
        </div>
        <div className="city-stats-bar">
          <div className="city-stat-item"><span className="csi-label">COMMITS</span><span className="csi-val cyan">{stats.total?.toLocaleString()}</span></div>
          <div className="city-stat-sep">·</div>
          <div className="city-stat-item"><span className="csi-label">YEAR</span><span className="csi-val mag">{selectedYear}</span></div>
          <div className="city-stat-sep">·</div>
          <div className="city-stat-item"><span className="csi-label">PEAK</span><span className="csi-val grn">{stats.peak}</span></div>
        </div>
        <button className="recenter-btn" onClick={() => fullRenderer.current?.resetCamera()}>⟳ RECENTER</button>
        <button className="escape-btn" onClick={() => setPhase('dashboard')}>
          <span className="escape-x">✕</span> ESCAPE CITY
        </button>
      </div>
    );
  }

  // ─── DASHBOARD ───────────────────────────────────────────────────────────
  const startDay = stats.startDay ?? 0;
  return (
    <div className="root">
      <div className="scanlines" /><div className="bg-grid" />
      <div className="corner-deco tl" /><div className="corner-deco tr" />
      <div className="corner-deco bl" /><div className="corner-deco br" />

      {/* Fixed blurred city background */}
      <div className="bg-city-wrap">
        <div ref={bgMountRef} className="bg-city-mount" />
        <div className="bg-city-blur" />
      </div>

      {/* Tooltip */}
      {tooltip.visible && (
        <div className="tooltip" style={{ left: tooltip.x, top: tooltip.y }}>
          <div className="tip-date">{tooltip.date}</div>
          <div>{tooltip.count} COMMITS</div>
        </div>
      )}

      {/* ── Music Widget ── */}
      <div className="music-widget">
        <div className="music-top">
          <div className="music-aw-badge">AW</div>
          <div className="music-info">
            <div className="music-title">{audioState.playing ? SONGS[audioState.songIdx].title : 'DARK SIDE'}</div>
            <div className="music-artist">{audioState.playing ? SONGS[audioState.songIdx].artist : 'ALAN WALKER'}</div>
          </div>
          {audioState.playing && <span className="music-pulse-dot" />}
          <button className="music-btn" onClick={() => toggleAudio(audioState.songIdx)}>
            {audioState.playing ? '⏹' : '▶'}
          </button>
          <button className="music-expand-btn" onClick={() => setShowPlaylist(p => !p)}>
            {showPlaylist ? '▴' : '▾'}
          </button>
        </div>

        {showPlaylist && (
          <div className="playlist">
            {SONGS.map((s, i) => (
              <div key={i}
                className={`playlist-item ${audioState.songIdx === i && audioState.playing ? 'active' : ''}`}
                onClick={() => { setShowPlaylist(false); toggleAudio(i); }}>
                <span className="playlist-icon">{audioState.songIdx === i && audioState.playing ? '▶' : '○'}</span>
                <div className="playlist-info">
                  <span className="playlist-name">{s.title}</span>
                  <span className="playlist-artist">{s.artist}</span>
                </div>
                <span className="playlist-bpm">{s.bpm}</span>
              </div>
            ))}
            <div className="vol-row">
              <span className="vol-label">VOL</span>
              <input type="range" min={0} max={100} defaultValue={65} className="vol-slider"
                onChange={e => audioEngine.current.setVolume(parseInt(e.target.value) / 100)} />
            </div>
          </div>
        )}

        {audioState.playing && (
          <div className="visualizer">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="viz-bar" style={{ animationDelay: `${i * 0.07}s` }} />
            ))}
          </div>
        )}
      </div>

      <div className="container">
        {/* Header */}
        <header className="site-header">
          <div className="logo-block">
            <div className="logo-tag">▸ SYS::AIYOOO v5.0.0</div>
            <h1 className="logo-main">AIYOOO</h1>
            <div className="logo-sub">// GITHUB CONTRIBUTION MATRIX</div>
          </div>
          <div className="header-status">
            <div className="status-active"><div className="status-dot" />LINK ACTIVE</div>
            <div className="status-coord">SYS_TIME: {sysTime}</div>
            <div className="status-coord">USER: {username.toUpperCase()}</div>
            <button className="back-btn" onClick={disconnectAll}>◀ DISCONNECT</button>
          </div>
        </header>

        {/* Data Panel */}
        <div className="data-panel">
          <div className="panel-bar">
            <div className="panel-bar-title">
              <div className="dot dot-red" /><div className="dot dot-yel" /><div className="dot dot-grn" />
              <span>CONTRIBUTION_MAP.dat</span>
            </div>
            {years.length > 0 && (
              <select className="year-select" value={selectedYear} onChange={e => setSelectedYear(e.target.value)}>
                {years.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            )}
          </div>
          <div className="stats-row">
            {[
              { label: '◈ COMMITS MINED', val: stats.total?.toLocaleString()      ?? '——', cls: 'stat-val' },
              { label: '◈ ACTIVE DAYS',   val: stats.activeDays?.toLocaleString() ?? '——', cls: 'stat-val mag' },
              { label: '◈ PEAK DAY',      val: stats.peak?.toLocaleString()       ?? '——', cls: 'stat-val grn' },
              { label: '◈ AVG / WEEK',    val: stats.avg                          ?? '——', cls: 'stat-val' },
            ].map((s, i) => (
              <div key={i} className="stat-cell">
                <div className="stat-label">{s.label}</div>
                <div className={s.cls}>{s.val}</div>
              </div>
            ))}
          </div>
          <div className="calendar-section">
            <div className="cal-title">
              {yearData.length > 0 ? `// GRID_DATA: ${selectedYear} — ${stats.total?.toLocaleString()} COMMITS_MINED` : '// AWAITING TARGET LOCK'}
            </div>
            <div className="months-header">
              {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map(m => <span key={m}>{m}</span>)}
            </div>
            <div className="graph-container">
              <div className="days-of-week">
                {['','Mon','','Wed','','Fri',''].map((d,i) => <span key={i}>{d}</span>)}
              </div>
              <div className="squares">
                {yearData.length > 0 && Array.from({ length: startDay }).map((_,i) => <div key={`sp-${i}`} className="square spacer" />)}
                {yearData.map((day, i) => (
                  <div key={i} className="square" data-level={day.level}
                    onMouseEnter={() => setTooltip(p => ({ ...p, visible: true, date: day.date, count: day.count }))}
                    onMouseLeave={() => setTooltip(p => ({ ...p, visible: false }))} />
                ))}
              </div>
            </div>
            <div className="legend">
              <span>LOW</span>
              {[0,1,2,3,4].map(l => <div key={l} className="square" data-level={l} />)}
              <span>HIGH</span>
            </div>
          </div>
        </div>

        {/* Explore Button */}
        <div className="explore-section">
          <div className="explore-divider" />
          <div className="explore-center">
            <div className="explore-hint">YOUR CONTRIBUTION CITY AWAITS</div>
            <button className="explore-btn" onClick={() => setPhase('city')}>
              <span className="explore-btn-icon">◈</span>
              EXPLORE CYBER-CITY
              <span className="explore-btn-arrow">▸</span>
            </button>
            <div className="explore-subhint">Drag to orbit · Scroll to zoom · Right-drag to pan</div>
          </div>
          <div className="explore-divider" />
        </div>

      </div>
    </div>
  );
};

export default App;