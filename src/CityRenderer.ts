// src/CityRenderer.ts
import * as THREE from 'three';
import type { ContributionDay } from './types';

const COLORS: Record<number, string> = {
  0: '#080314', 1: '#00e5ff', 2: '#9d4edd', 3: '#ff00a0', 4: '#39ff14'
};

interface SphericalCoords { theta: number; phi: number; radius: number; }
interface CityRendererOptions { bgColor?: number; fogDensity?: number; }

class CityRenderer {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  cityGroup: THREE.Group;
  animatedObjects: THREE.Object3D[] = [];
  matCache: Record<string, THREE.Material[]> = {};
  geoCache: Record<string, THREE.BoxGeometry> = {};
  animationFrameId: number = 0;
  baseMesh: THREE.Mesh | null = null;

  // ── Orbit state ────────────────────────────────────────────────────────────
  private _spherical: SphericalCoords = { theta: Math.PI / 4, phi: 0.9, radius: 90 };
  private _target    = new THREE.Vector3(0, 0, 0);
  private _isDragging   = false;
  private _isRightDrag  = false;
  private _lastMouse    = { x: 0, y: 0 };

  // Continuous velocity-based rotation — single velocity, zero mode switches.
  private _rotVel       = 0.003;
  private _baseRotSpeed = 0.003;   // settled "idle" auto-rotate magnitude
  private _FRICTION     = 0.982;   // per-frame coast decay (higher = silkier)
  private _SETTLE_LERP  = 0.018;

  private _resizeObs: ResizeObserver | null = null;
  private _onMouseDownBound:       (e: MouseEvent) => void;
  private _onWindowMouseMoveBound: (e: MouseEvent) => void;
  private _onWindowMouseUpBound:   () => void;
  private _onWheelBound:           (e: WheelEvent) => void;
  private _onContextMenuBound:     (e: MouseEvent) => void;

  constructor(container: HTMLDivElement, opts: CityRendererOptions = {}) {
    const bgColor    = opts.bgColor    ?? 0x04010a;
    const fogDensity = opts.fogDensity ?? 0.012;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(bgColor);
    this.scene.fog = new THREE.FogExp2(bgColor, fogDensity);

    const w = container.clientWidth, h = container.clientHeight;
    this.camera = new THREE.PerspectiveCamera(42, w / h, 0.1, 2000);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(w, h);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.4;
    this.renderer.shadowMap.enabled = false;
    container.appendChild(this.renderer.domElement);

    // Lights
    this.scene.add(new THREE.AmbientLight(0x150025, 1.0));
    const l1 = new THREE.DirectionalLight(0x00e5ff, 1.2); l1.position.set(-20, 50, 20); this.scene.add(l1);
    const l2 = new THREE.DirectionalLight(0xff00a0, 0.8); l2.position.set(20, 10, -20); this.scene.add(l2);
    const l3 = new THREE.PointLight(0x39ff14, 0.5, 80); l3.position.set(0, 30, 0); this.scene.add(l3);

    this.cityGroup = new THREE.Group();
    this.scene.add(this.cityGroup);

    this._onMouseDownBound       = this._onMouseDown.bind(this);
    this._onWindowMouseMoveBound = this._onWindowMouseMove.bind(this);
    this._onWindowMouseUpBound   = this._onWindowMouseUp.bind(this);
    this._onWheelBound           = this._onWheel.bind(this);
    this._onContextMenuBound     = (e) => e.preventDefault();
    this._initOrbitListeners();

    this._resizeObs = new ResizeObserver(() => {
      this.camera.aspect = container.clientWidth / container.clientHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(container.clientWidth, container.clientHeight);
    });
    this._resizeObs.observe(container);

    this._animate();
  }

  // ── Orbit input ────────────────────────────────────────────────────────────
  private _initOrbitListeners() {
    const el = this.renderer.domElement;
    el.addEventListener('mousedown',   this._onMouseDownBound);
    el.addEventListener('contextmenu', this._onContextMenuBound);
    el.addEventListener('wheel',       this._onWheelBound, { passive: true });
    window.addEventListener('mousemove', this._onWindowMouseMoveBound);
    window.addEventListener('mouseup',   this._onWindowMouseUpBound);
  }

  private _onMouseDown = (e: MouseEvent) => {
    this._isDragging  = true;
    this._isRightDrag = e.button === 2;
    this._lastMouse   = { x: e.clientX, y: e.clientY };
  };

  private _onWindowMouseMove = (e: MouseEvent) => {
    if (!this._isDragging) return;
    const dx = e.clientX - this._lastMouse.x;
    const dy = e.clientY - this._lastMouse.y;

    if (this._isRightDrag) {
      this._target.x -= dx * 0.05;
      this._target.z -= dy * 0.05;
    } else {
      const delta = -dx * 0.006;
      this._spherical.theta += delta;
      this._spherical.phi   -= dy * 0.005;
      this._spherical.phi    = Math.max(0.05, Math.min(Math.PI / 2 + 0.15, this._spherical.phi));
      this._rotVel = this._rotVel * 0.35 + delta * 0.65;
    }
    this._lastMouse = { x: e.clientX, y: e.clientY };
  };

  private _onWindowMouseUp = () => {
    if (!this._isDragging) return;
    this._isDragging = false;
    const MAX = 0.06;
    this._rotVel = Math.max(-MAX, Math.min(MAX, this._rotVel));
    if (Math.abs(this._rotVel) < 0.0005) {
      this._rotVel = this._baseRotSpeed;
    }
    this._baseRotSpeed = this._rotVel > 0
      ? Math.abs(this._baseRotSpeed)
      : -Math.abs(this._baseRotSpeed);
  };

  private _onWheel = (e: WheelEvent) => {
    this._spherical.radius = Math.max(3, Math.min(600, this._spherical.radius + e.deltaY * 0.12));
  };

  // ── Animation loop ─────────────────────────────────────────────────────────
  private _updateCamera() {
    if (!this._isDragging) {
      const dir  = this._rotVel >= 0 ? 1 : -1;
      const base = dir * Math.abs(this._baseRotSpeed);

      if (Math.abs(this._rotVel) > Math.abs(base) + 0.0002) {
        this._rotVel *= this._FRICTION;
        if (Math.abs(this._rotVel) < Math.abs(base)) this._rotVel = base;
      } else {
        this._rotVel += (base - this._rotVel) * this._SETTLE_LERP;
      }
    }

    this._spherical.theta += this._rotVel;

    const { theta, phi, radius } = this._spherical;
    this.camera.position.set(
      this._target.x + radius * Math.sin(phi) * Math.sin(theta),
      this._target.y + radius * Math.cos(phi),
      this._target.z + radius * Math.sin(phi) * Math.cos(theta)
    );
    this.camera.lookAt(this._target);
  }

  private _animate = () => {
    this.animationFrameId = requestAnimationFrame(this._animate);
    this._updateCamera();

    // Spin torus rings
    this.animatedObjects.forEach(o => {
      o.rotation.z += (o.userData.speed as number) || 0.01;
    });

    this.renderer.render(this.scene, this.camera);
  };

  resetCamera() {
    this._spherical    = { theta: Math.PI / 4, phi: 0.9, radius: 90 };
    this._target.set(0, 0, 0);
    this._rotVel       = this._baseRotSpeed;
  }

  // ── Geometry helpers ───────────────────────────────────────────────────────
  getGeo(h: number): THREE.BoxGeometry {
    const key = h.toString();
    if (!this.geoCache[key]) this.geoCache[key] = new THREE.BoxGeometry(1, h, 1);
    return this.geoCache[key];
  }

  buildingMats(level: number, h: number): THREE.Material[] {
    if (level === 0) return [new THREE.MeshPhongMaterial({ color: 0x0a0515, shininess: 5 })];
    const key = `${level}-${Math.round(h)}`;
    if (this.matCache[key]) return this.matCache[key];

    const c = document.createElement('canvas'); c.width = 64; c.height = 128;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#05020a'; ctx.fillRect(0, 0, 64, 128);
    const col = COLORS[level];
    ctx.fillStyle = col;
    ctx.fillRect(0, 0, 2, 128); ctx.fillRect(62, 0, 2, 128);
    for (let y = 8; y < 128; y += 10)
      for (let x = 6; x < 58; x += 14)
        if (Math.random() > 0.3) { ctx.globalAlpha = 0.5 + Math.random() * 0.5; ctx.fillStyle = col; ctx.fillRect(x, y, 8, 5); }
    ctx.globalAlpha = 1;
    for (let y = 5; y < 128; y += 18) { ctx.fillStyle = col; ctx.globalAlpha = 0.3 + Math.random() * 0.4; ctx.fillRect(4, y, 56, 1); }
    ctx.globalAlpha = 1;

    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(1, Math.max(1, h / 2));
    tex.magFilter = THREE.NearestFilter;

    const side = new THREE.MeshPhongMaterial({ map: tex, emissive: new THREE.Color(col), emissiveMap: tex, emissiveIntensity: 1.4, shininess: 100, color: 0x05020a });
    const top  = new THREE.MeshPhongMaterial({ color: 0x0a0515, emissive: new THREE.Color(col), emissiveIntensity: 0.5 });
    const mats = [side, side, top, top, side, side];
    this.matCache[key] = mats;
    return mats;
  }

  // ── City render ────────────────────────────────────────────────────────────
  renderCity(yearData: ContributionDay[], startDayOfWeek: number, _username: string) {
    while (this.cityGroup.children.length) this.cityGroup.remove(this.cityGroup.children[0]);
    this.animatedObjects = [];
    this.baseMesh = null;

    const todayStr   = new Date().toISOString().slice(0, 10);
    const valid      = yearData.filter(d => d.date <= todayStr);
    const step       = 1.2;
    const totalWeeks = Math.ceil((valid.length + startDayOfWeek) / 7);
    const offX       = ((totalWeeks - 1) * step) / 2;
    const offZ       = (6 * step) / 2;
    const maxCount   = Math.max(0, ...valid.map(d => d.count));

    // ── BASE PLATFORM ──────────────────────────────────────────────────────
    const bH = 0.55; const pad = 1.0;
    const bW = (totalWeeks - 1) * step + pad;
    const bD = 6 * step + pad;

    const topMat    = new THREE.MeshPhongMaterial({ color: 0x04010e, specular: 0x0a0820, shininess: 60 });
    const bottomMat = new THREE.MeshLambertMaterial({ color: 0x030008 });
    const makeSide  = (col: number) => new THREE.MeshStandardMaterial({
      color: 0x040010, emissive: new THREE.Color(col), emissiveIntensity: 1.2, roughness: 0.5, metalness: 0.6
    });

    this.baseMesh = new THREE.Mesh(new THREE.BoxGeometry(bW, bH, bD), [
      makeSide(0x00e5ff), makeSide(0x00e5ff), topMat, bottomMat,
      makeSide(0xff00a0), makeSide(0xff00a0),
    ]);
    this.baseMesh.position.set(0, -bH / 2, 0);
    this.cityGroup.add(this.baseMesh);

    const edgeLine = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.BoxGeometry(bW, bH, bD)),
      new THREE.LineBasicMaterial({ color: 0x00e5ff })
    );
    edgeLine.position.set(0, -bH / 2, 0);
    this.cityGroup.add(edgeLine);
    this.cityGroup.position.y = -6;

    // ── BUILDINGS ──────────────────────────────────────────────────────────
    let idx = startDayOfWeek;
    valid.forEach(day => {
      const w = Math.floor(idx / 7), d = idx % 7;
      const x = w * step - offX, z = d * step - offZ;
      const h = day.count === 0 ? 0.15 : Math.min(18, day.count * 0.5 + 0.5);
      const isTop = day.count > 0 && day.count === maxCount;

      if (isTop) {
        const g = new THREE.Group();
        const b1 = new THREE.Mesh(this.getGeo(h * 0.7), this.buildingMats(day.level, h * 0.7));
        b1.position.y = h * 0.35; g.add(b1);
        const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.55, h * 0.2, 0.55), this.buildingMats(day.level, h * 0.2));
        b2.position.y = h * 0.7 + h * 0.1; g.add(b2);
        [0.9, 1.3].forEach((r, ri) => {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(r, 0.04, 8, 32),
            new THREE.MeshBasicMaterial({ color: ri === 0 ? 0x00e5ff : 0xff00a0, transparent: true, opacity: 0.85 })
          );
          ring.rotation.x = Math.PI / 2; ring.position.y = h * 0.75;
          ring.userData = { speed: ri === 0 ? 0.03 : -0.02 };
          this.animatedObjects.push(ring); g.add(ring);
        });
        const laser = new THREE.Mesh(
          new THREE.CylinderGeometry(0.06, 0.06, 35, 6),
          new THREE.MeshBasicMaterial({ color: 0x39ff14, transparent: true, opacity: 0.55 })
        );
        laser.position.set(x, h + 17.5, z); this.cityGroup.add(laser);
        g.position.set(x, 0, z); this.cityGroup.add(g);
      } else {
        const cube = new THREE.Mesh(this.getGeo(h), this.buildingMats(day.level, h));
        cube.position.set(x, h / 2, z); this.cityGroup.add(cube);

        if (h > 5 && day.level >= 3) {
          const ring = new THREE.Mesh(
            new THREE.TorusGeometry(0.65, 0.035, 6, 20),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS[day.level]), transparent: true, opacity: 0.65 })
          );
          ring.rotation.x = Math.PI / 2;
          ring.position.set(x, h * 0.82, z);
          ring.userData = { speed: -0.025 };
          this.animatedObjects.push(ring); this.cityGroup.add(ring);
        }

        if (h > 3 && day.level > 0) {
          const sh = 0.5 + Math.random() * 1.5;
          const spire = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.055, sh, 4),
            new THREE.MeshLambertMaterial({ color: 0x110822 })
          );
          spire.position.set(x, h + sh / 2, z); this.cityGroup.add(spire);
          const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.055, 8, 8),
            new THREE.MeshBasicMaterial({ color: new THREE.Color(COLORS[day.level]) })
          );
          beacon.position.set(x, h + sh, z); this.cityGroup.add(beacon);
        }
      }
      idx++;
    });
  }

  // ── Cleanup ────────────────────────────────────────────────────────────────
  destroy() {
    cancelAnimationFrame(this.animationFrameId);
    const el = this.renderer.domElement;
    el.removeEventListener('mousedown',   this._onMouseDownBound);
    el.removeEventListener('contextmenu', this._onContextMenuBound);
    el.removeEventListener('wheel',       this._onWheelBound);
    window.removeEventListener('mousemove', this._onWindowMouseMoveBound);
    window.removeEventListener('mouseup',   this._onWindowMouseUpBound);
    if (this._resizeObs) this._resizeObs.disconnect();
    this.renderer.dispose();
    if (el.parentElement) el.parentElement.removeChild(el);
  }
}

export default CityRenderer;