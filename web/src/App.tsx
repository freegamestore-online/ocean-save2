import { GameShell, GameTopbar } from "@freegamestore/games";
import { useRef, useState, useCallback, useEffect } from "react";
import { useGameLoop } from "./hooks/useGameLoop";
import { useHighScore } from "./hooks/useHighScore";
import { drawGlow, drawText, lerp, dist, clamp } from "./lib/canvas";
import type { Boat, Shark, Survivor, Particle, Raft, Phase } from "./types";

// ─── constants ───────────────────────────────────────────────────────────────
const BOAT_MAX_SPEED = 280;
const BOAT_ACCEL = 600;
const BOAT_FRICTION = 0.92;
const BOAT_RADIUS = 18;
const SHARK_RADIUS = 20;
const SURVIVOR_RADIUS = 12;
const RAFT_RADIUS = 48;
const RAM_RADIUS = BOAT_RADIUS + SHARK_RADIUS + 4;
const EAT_RADIUS = SHARK_RADIUS + SURVIVOR_RADIUS + 2;
const RESCUE_RADIUS = BOAT_RADIUS + SURVIVOR_RADIUS + 8;

let nextId = 1;
function uid() { return nextId++; }

function makeShark(cx: number, cy: number, level: number): Shark {
  const angle = Math.random() * Math.PI * 2;
  const r = 180 + Math.random() * 120;
  return {
    id: uid(),
    x: cx + Math.cos(angle) * r,
    y: cy + Math.sin(angle) * r,
    vx: 0,
    vy: 0,
    angle,
    targetId: null,
    stunTimer: 0,
    state: "circle",
    circleAngle: angle,
    circleRadius: r,
    speed: 80 + level * 12 + Math.random() * 30,
  };
}

function makeSurvivor(raft: Raft): Survivor {
  const angle = Math.random() * Math.PI * 2;
  const r = Math.random() * (raft.radius - 8);
  return {
    id: uid(),
    x: raft.x + Math.cos(angle) * r,
    y: raft.y + Math.sin(angle) * r,
    vx: (Math.random() - 0.5) * 10,
    vy: (Math.random() - 0.5) * 10,
    rescued: false,
    eaten: false,
    panicTimer: 0,
  };
}

function makeParticle(x: number, y: number, color: string, count = 6): Particle[] {
  return Array.from({ length: count }, () => ({
    id: uid(),
    x, y,
    vx: (Math.random() - 0.5) * 200,
    vy: (Math.random() - 0.5) * 200,
    life: 0.6 + Math.random() * 0.4,
    maxLife: 1,
    color,
    size: 3 + Math.random() * 4,
  }));
}

// ─── drawing helpers ──────────────────────────────────────────────────────────
function drawOcean(ctx: CanvasRenderingContext2D, w: number, h: number, t: number) {
  // Deep ocean gradient
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, "#0a4a6e");
  grad.addColorStop(1, "#041f30");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, w, h);

  // Animated wave lines
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#5dd3f3";
  ctx.lineWidth = 1.5;
  for (let i = 0; i < 8; i++) {
    const y = ((t * 30 + i * (h / 8)) % h);
    ctx.beginPath();
    for (let x = 0; x <= w; x += 20) {
      const wy = y + Math.sin((x / 60) + t * 1.5 + i) * 6;
      if (x === 0) ctx.moveTo(x, wy); else ctx.lineTo(x, wy);
    }
    ctx.stroke();
  }
  ctx.restore();
}

function drawRaft(ctx: CanvasRenderingContext2D, raft: Raft, t: number) {
  ctx.save();
  ctx.translate(raft.x, raft.y);

  // Glow
  drawGlow(ctx, 0, 0, raft.radius * 2, "#d4a96a");

  // Raft planks
  const bob = Math.sin(t * 1.2) * 2;
  ctx.translate(0, bob);
  ctx.fillStyle = "#a0724a";
  ctx.strokeStyle = "#7a5230";
  ctx.lineWidth = 2;
  const r = raft.radius;
  for (let i = -2; i <= 2; i++) {
    const plankY = i * 16;
    const hw = Math.sqrt(Math.max(0, r * r - plankY * plankY));
    ctx.beginPath();
    ctx.roundRect(-hw, plankY - 7, hw * 2, 14, 3);
    ctx.fill();
    ctx.stroke();
  }

  // Rope outline
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  ctx.strokeStyle = "#d4a96a";
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.restore();
}

function drawSurvivor(ctx: CanvasRenderingContext2D, s: Survivor, t: number) {
  if (s.rescued || s.eaten) return;
  ctx.save();
  ctx.translate(s.x, s.y);

  const panic = s.panicTimer > 0;
  const wave = panic ? Math.sin(t * 20) * 5 : Math.sin(t * 3 + s.id) * 2;

  // Body
  ctx.fillStyle = panic ? "#ff6b6b" : "#ffd166";
  ctx.beginPath();
  ctx.arc(0, wave, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#e05a00";
  ctx.lineWidth = 2;
  ctx.stroke();

  // Face
  ctx.fillStyle = "#333";
  ctx.beginPath();
  ctx.arc(-3, wave - 1, 1.5, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(3, wave - 1, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Arms waving when panicking
  if (panic) {
    ctx.strokeStyle = "#ffd166";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(-10, wave);
    ctx.lineTo(-18, wave - 8 + Math.sin(t * 15) * 5);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(10, wave);
    ctx.lineTo(18, wave - 8 + Math.sin(t * 15 + 1) * 5);
    ctx.stroke();
  }

  ctx.restore();
}

function drawShark(ctx: CanvasRenderingContext2D, shark: Shark, t: number) {
  ctx.save();
  ctx.translate(shark.x, shark.y);
  ctx.rotate(shark.angle + Math.PI / 2);

  const stunned = shark.stunTimer > 0;
  const col = stunned ? "#aaaaaa" : "#2d6a8a";
  const finCol = stunned ? "#888" : "#1a4a60";

  // Tail wag
  const wag = Math.sin(t * 8 + shark.id) * 0.3;

  // Body
  ctx.fillStyle = col;
  ctx.beginPath();
  ctx.ellipse(0, 0, 10, 20, wag * 0.3, 0, Math.PI * 2);
  ctx.fill();

  // Dorsal fin
  ctx.fillStyle = finCol;
  ctx.beginPath();
  ctx.moveTo(0, -20);
  ctx.lineTo(-8, -8);
  ctx.lineTo(8, -8);
  ctx.closePath();
  ctx.fill();

  // Tail
  ctx.beginPath();
  ctx.moveTo(0, 18);
  ctx.lineTo(-10 + wag * 20, 28);
  ctx.lineTo(10 + wag * 20, 28);
  ctx.closePath();
  ctx.fill();

  // Eye
  ctx.fillStyle = stunned ? "#ff0" : "#ff2020";
  ctx.beginPath();
  ctx.arc(-4, -10, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#000";
  ctx.beginPath();
  ctx.arc(-4, -10, 1.5, 0, Math.PI * 2);
  ctx.fill();

  if (stunned) {
    ctx.restore();
    ctx.save();
    ctx.translate(shark.x, shark.y - 28);
    ctx.font = "bold 14px Manrope, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("💫", 0, 0);
    ctx.restore();
    return;
  }

  ctx.restore();
}

function drawBoat(ctx: CanvasRenderingContext2D, boat: Boat, t: number) {
  ctx.save();
  ctx.translate(boat.x, boat.y);
  ctx.rotate(boat.angle + Math.PI / 2);

  const bob = Math.sin(t * 2.5) * 1.5;
  ctx.translate(0, bob);

  // Hull
  ctx.fillStyle = "#e63946";
  ctx.strokeStyle = "#9b1a24";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, -22);
  ctx.bezierCurveTo(14, -10, 14, 10, 10, 20);
  ctx.lineTo(-10, 20);
  ctx.bezierCurveTo(-14, 10, -14, -10, 0, -22);
  ctx.fill();
  ctx.stroke();

  // Deck
  ctx.fillStyle = "#f4a261";
  ctx.beginPath();
  ctx.ellipse(0, 0, 9, 15, 0, 0, Math.PI * 2);
  ctx.fill();

  // Propeller wake
  ctx.strokeStyle = "#7dd3fc";
  ctx.lineWidth = 2;
  ctx.globalAlpha = 0.6;
  ctx.beginPath();
  ctx.arc(-5, 22, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(5, 22, 4, 0, Math.PI * 2);
  ctx.stroke();
  ctx.globalAlpha = 1;

  ctx.restore();
}

function drawParticles(ctx: CanvasRenderingContext2D, particles: Particle[]) {
  for (const p of particles) {
    const alpha = p.life / p.maxLife;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = p.color;
    ctx.beginPath();
    ctx.arc(p.x, p.y, p.size * alpha, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

// ─── main component ───────────────────────────────────────────────────────────
export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [highScore, updateHighScore] = useHighScore("oceansave2_highscore");

  // Game state refs (mutated in loop, no re-renders)
  const stateRef = useRef({
    phase: "playing" as Phase,
    score: 0,
    lives: 3,
    level: 1,
    survivorsLeft: 0,
    survivorsRescued: 0,
    boat: { x: 200, y: 200, vx: 0, vy: 0, angle: 0, speed: 0 } as Boat,
    raft: { x: 0, y: 0, radius: RAFT_RADIUS } as Raft,
    survivors: [] as Survivor[],
    sharks: [] as Shark[],
    particles: [] as Particle[],
    target: null as { x: number; y: number } | null,
    t: 0,
    w: 600,
    h: 600,
    levelUpTimer: 0,
    shakeTimer: 0,
  });

  // React state for UI
  const [uiScore, setUiScore] = useState(0);
  const [uiLives, setUiLives] = useState(3);
  const [uiPhase, setUiPhase] = useState<Phase>("playing");
  const [uiLevel, setUiLevel] = useState(1);
  const [uiSurvivors, setUiSurvivors] = useState(0);

  const syncUi = useCallback(() => {
    const s = stateRef.current;
    setUiScore(s.score);
    setUiLives(s.lives);
    setUiPhase(s.phase);
    setUiLevel(s.level);
    setUiSurvivors(s.survivorsLeft);
  }, []);

  const initLevel = useCallback((level: number) => {
    const s = stateRef.current;
    const w = s.w;
    const h = s.h;
    s.raft = { x: w / 2, y: h / 2, radius: RAFT_RADIUS };
    s.boat = { x: w / 2 + 120, y: h / 2 + 120, vx: 0, vy: 0, angle: 0, speed: 0 };
    s.target = null;
    s.particles = [];

    const survivorCount = 3 + level;
    s.survivors = Array.from({ length: survivorCount }, () => makeSurvivor(s.raft));
    s.survivorsLeft = survivorCount;
    s.survivorsRescued = 0;

    const sharkCount = 1 + Math.floor(level * 1.4);
    s.sharks = Array.from({ length: sharkCount }, () => makeShark(w / 2, h / 2, level));
  }, []);

  const startGame = useCallback(() => {
    const s = stateRef.current;
    s.score = 0;
    s.lives = 3;
    s.level = 1;
    s.phase = "playing";
    s.t = 0;
    initLevel(1);
    syncUi();
  }, [initLevel, syncUi]);

  // Canvas resize
  useEffect(() => {
    const resize = () => {
      const el = containerRef.current;
      const canvas = canvasRef.current;
      if (!el || !canvas) return;
      const rect = el.getBoundingClientRect();
      canvas.width = rect.width;
      canvas.height = rect.height;
      stateRef.current.w = rect.width;
      stateRef.current.h = rect.height;
      // Re-center raft on resize
      const s = stateRef.current;
      if (s.phase === "playing") {
        const dx = rect.width / 2 - s.raft.x;
        const dy = rect.height / 2 - s.raft.y;
        s.raft.x = rect.width / 2;
        s.raft.y = rect.height / 2;
        for (const sv of s.survivors) { sv.x += dx; sv.y += dy; }
        for (const sh of s.sharks) { sh.x += dx; sh.y += dy; }
        s.boat.x = clamp(s.boat.x + dx, 0, rect.width);
        s.boat.y = clamp(s.boat.y + dy, 0, rect.height);
      }
    };
    resize();
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  // Pointer / touch target
  const setPointerTarget = useCallback((clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    stateRef.current.target = {
      x: clientX - rect.left,
      y: clientY - rect.top,
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const onMouseMove = (e: MouseEvent) => {
      if (e.buttons > 0) setPointerTarget(e.clientX, e.clientY);
    };
    const onMouseDown = (e: MouseEvent) => setPointerTarget(e.clientX, e.clientY);
    const onTouchStart = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) setPointerTarget(t.clientX, t.clientY);
    };
    const onTouchMove = (e: TouchEvent) => {
      e.preventDefault();
      const t = e.touches[0];
      if (t) setPointerTarget(t.clientX, t.clientY);
    };

    canvas.addEventListener("mousemove", onMouseMove);
    canvas.addEventListener("mousedown", onMouseDown);
    canvas.addEventListener("touchstart", onTouchStart, { passive: false });
    canvas.addEventListener("touchmove", onTouchMove, { passive: false });
    return () => {
      canvas.removeEventListener("mousemove", onMouseMove);
      canvas.removeEventListener("mousedown", onMouseDown);
      canvas.removeEventListener("touchstart", onTouchStart);
      canvas.removeEventListener("touchmove", onTouchMove);
    };
  }, [setPointerTarget]);

  // Init on mount
  useEffect(() => { startGame(); }, [startGame]);

  // ─── game loop ──────────────────────────────────────────────────────────────
  useGameLoop((dt: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const s = stateRef.current;
    const { w, h } = s;
    s.t += dt;

    // ── update ──────────────────────────────────────────────────────────────
    if (s.phase === "playing") {
      // Move boat toward target
      if (s.target) {
        const dx = s.target.x - s.boat.x;
        const dy = s.target.y - s.boat.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d > 4) {
          const desiredAngle = Math.atan2(dy, dx) - Math.PI / 2;
          s.boat.angle = desiredAngle;
          const accel = Math.min(BOAT_ACCEL * dt, d / dt * 0.2);
          s.boat.vx += (dx / d) * accel;
          s.boat.vy += (dy / d) * accel;
        } else {
          s.target = null;
        }
      }

      const spd = Math.sqrt(s.boat.vx * s.boat.vx + s.boat.vy * s.boat.vy);
      if (spd > BOAT_MAX_SPEED) {
        s.boat.vx = (s.boat.vx / spd) * BOAT_MAX_SPEED;
        s.boat.vy = (s.boat.vy / spd) * BOAT_MAX_SPEED;
      }
      s.boat.vx *= Math.pow(BOAT_FRICTION, dt * 60);
      s.boat.vy *= Math.pow(BOAT_FRICTION, dt * 60);
      s.boat.x = clamp(s.boat.x + s.boat.vx * dt, BOAT_RADIUS, w - BOAT_RADIUS);
      s.boat.y = clamp(s.boat.y + s.boat.vy * dt, BOAT_RADIUS, h - BOAT_RADIUS);

      // Update survivors (gentle drift on raft)
      for (const sv of s.survivors) {
        if (sv.rescued || sv.eaten) continue;
        sv.vx = lerp(sv.vx, 0, dt * 2);
        sv.vy = lerp(sv.vy, 0, dt * 2);
        sv.x += sv.vx * dt;
        sv.y += sv.vy * dt;
        // Keep on raft
        const dr = dist(sv.x, sv.y, s.raft.x, s.raft.y);
        if (dr > RAFT_RADIUS - SURVIVOR_RADIUS) {
          const ang = Math.atan2(sv.y - s.raft.y, sv.x - s.raft.x);
          sv.x = s.raft.x + Math.cos(ang) * (RAFT_RADIUS - SURVIVOR_RADIUS);
          sv.y = s.raft.y + Math.sin(ang) * (RAFT_RADIUS - SURVIVOR_RADIUS);
        }
        if (sv.panicTimer > 0) sv.panicTimer -= dt;
      }

      // Update sharks
      for (const shark of s.sharks) {
        if (shark.stunTimer > 0) {
          shark.stunTimer -= dt;
          // Drift
          shark.vx *= Math.pow(0.85, dt * 60);
          shark.vy *= Math.pow(0.85, dt * 60);
          shark.x += shark.vx * dt;
          shark.y += shark.vy * dt;
          continue;
        }

        // Find a target survivor if none
        if (shark.targetId === null || shark.state === "circle") {
          // Occasionally pick a survivor to attack
          const alive = s.survivors.filter(sv => !sv.rescued && !sv.eaten);
          if (alive.length > 0 && Math.random() < dt * (0.3 + s.level * 0.08)) {
            const pick = alive[Math.floor(Math.random() * alive.length)];
            if (pick) {
              shark.targetId = pick.id;
              shark.state = "attack";
            }
          }
        }

        if (shark.state === "attack" && shark.targetId !== null) {
          const target = s.survivors.find(sv => sv.id === shark.targetId);
          if (!target || target.rescued || target.eaten) {
            shark.state = "circle";
            shark.targetId = null;
          } else {
            // Chase survivor
            const dx = target.x - shark.x;
            const dy = target.y - shark.y;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d > 0) {
              shark.vx = lerp(shark.vx, (dx / d) * shark.speed, dt * 3);
              shark.vy = lerp(shark.vy, (dy / d) * shark.speed, dt * 3);
              shark.angle = Math.atan2(dy, dx) - Math.PI / 2;
            }
            // Panic nearby survivors
            if (d < 80) target.panicTimer = 0.5;
          }
        } else {
          // Circle the raft
          shark.circleAngle += dt * (0.4 + shark.speed * 0.003);
          const tx = s.raft.x + Math.cos(shark.circleAngle) * shark.circleRadius;
          const ty = s.raft.y + Math.sin(shark.circleAngle) * shark.circleRadius;
          const dx = tx - shark.x;
          const dy = ty - shark.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d > 0) {
            shark.vx = lerp(shark.vx, (dx / d) * shark.speed, dt * 2);
            shark.vy = lerp(shark.vy, (dy / d) * shark.speed, dt * 2);
            shark.angle = Math.atan2(dy, dx) - Math.PI / 2;
          }
        }

        shark.x += shark.vx * dt;
        shark.y += shark.vy * dt;

        // Eat survivor?
        for (const sv of s.survivors) {
          if (sv.rescued || sv.eaten) continue;
          if (dist(shark.x, shark.y, sv.x, sv.y) < EAT_RADIUS) {
            sv.eaten = true;
            s.survivorsLeft--;
            s.lives--;
            s.shakeTimer = 0.4;
            s.particles.push(...makeParticle(sv.x, sv.y, "#ff4444", 10));
            s.particles.push(...makeParticle(sv.x, sv.y, "#ffffff", 6));
            shark.state = "circle";
            shark.targetId = null;
            if (s.lives <= 0) {
              s.phase = "gameover";
              updateHighScore(s.score);
            }
            syncUi();
            break;
          }
        }

        // Boat rams shark?
        if (dist(s.boat.x, s.boat.y, shark.x, shark.y) < RAM_RADIUS) {
          const spd2 = Math.sqrt(s.boat.vx * s.boat.vx + s.boat.vy * s.boat.vy);
          if (spd2 > 60) {
            const dx = shark.x - s.boat.x;
            const dy = shark.y - s.boat.y;
            const d2 = Math.sqrt(dx * dx + dy * dy) || 1;
            shark.vx = (dx / d2) * 300 + s.boat.vx * 0.5;
            shark.vy = (dy / d2) * 300 + s.boat.vy * 0.5;
            shark.stunTimer = 1.5 + Math.random() * 0.5;
            shark.state = "circle";
            shark.targetId = null;
            s.score += 50;
            s.particles.push(...makeParticle(shark.x, shark.y, "#7dd3fc", 8));
            s.particles.push(...makeParticle(shark.x, shark.y, "#ffffff", 4));
            syncUi();
          }
        }
      }

      // Rescue survivors (boat near raft edge picks up survivors)
      for (const sv of s.survivors) {
        if (sv.rescued || sv.eaten) continue;
        if (dist(s.boat.x, s.boat.y, sv.x, sv.y) < RESCUE_RADIUS) {
          sv.rescued = true;
          s.survivorsLeft--;
          s.survivorsRescued++;
          s.score += 100 + s.level * 20;
          s.particles.push(...makeParticle(sv.x, sv.y, "#ffd166", 10));
          s.particles.push(...makeParticle(sv.x, sv.y, "#06d6a0", 6));
          syncUi();
        }
      }

      // Level complete?
      if (s.survivorsLeft === 0 && s.survivors.length > 0) {
        s.phase = "levelup";
        s.levelUpTimer = 2.0;
        s.score += 200 * s.level;
        updateHighScore(s.score);
        syncUi();
      }
    }

    if (s.phase === "levelup") {
      s.levelUpTimer -= dt;
      if (s.levelUpTimer <= 0) {
        s.level++;
        s.phase = "playing";
        initLevel(s.level);
        syncUi();
      }
    }

    // Update particles
    s.particles = s.particles.filter(p => {
      p.life -= dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= Math.pow(0.9, dt * 60);
      p.vy *= Math.pow(0.9, dt * 60);
      return p.life > 0;
    });

    if (s.shakeTimer > 0) s.shakeTimer -= dt;

    // ── render ──────────────────────────────────────────────────────────────
    ctx.save();
    if (s.shakeTimer > 0) {
      const shake = s.shakeTimer * 8;
      ctx.translate(
        (Math.random() - 0.5) * shake,
        (Math.random() - 0.5) * shake
      );
    }

    drawOcean(ctx, w, h, s.t);
    drawRaft(ctx, s.raft, s.t);

    // Draw boat target indicator
    if (s.target && s.phase === "playing") {
      ctx.save();
      ctx.globalAlpha = 0.4 + Math.sin(s.t * 10) * 0.2;
      ctx.strokeStyle = "#f4a261";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(s.target.x, s.target.y, 12, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.restore();
    }

    for (const sv of s.survivors) drawSurvivor(ctx, sv, s.t);
    for (const shark of s.sharks) drawShark(ctx, shark, s.t);
    drawBoat(ctx, s.boat, s.t);
    drawParticles(ctx, s.particles);

    // Level up overlay
    if (s.phase === "levelup") {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.fillStyle = "#041f30";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      drawText(ctx, `LEVEL ${s.level} CLEAR!`, w / 2, h / 2 - 24, {
        font: "bold 36px Fraunces, serif",
        color: "#ffd166",
        shadow: "#d4a96a",
        shadowBlur: 20,
      });
      drawText(ctx, `+${200 * s.level} pts`, w / 2, h / 2 + 20, {
        font: "bold 22px Manrope, sans-serif",
        color: "#06d6a0",
      });
      ctx.restore();
    }

    // Game over overlay
    if (s.phase === "gameover") {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.fillStyle = "#041f30";
      ctx.fillRect(0, 0, w, h);
      ctx.globalAlpha = 1;
      drawText(ctx, "GAME OVER", w / 2, h / 2 - 40, {
        font: "bold 42px Fraunces, serif",
        color: "#ff6b6b",
        shadow: "#ff0000",
        shadowBlur: 24,
      });
      drawText(ctx, `Score: ${s.score}`, w / 2, h / 2 + 10, {
        font: "bold 24px Manrope, sans-serif",
        color: "#ffffff",
      });
      drawText(ctx, `Best: ${Math.max(s.score, highScore)}`, w / 2, h / 2 + 44, {
        font: "18px Manrope, sans-serif",
        color: "#7dd3fc",
      });
      ctx.restore();
    }

    ctx.restore();
  }, false);

  // ─── render ─────────────────────────────────────────────────────────────────
  const livesIcons = Array.from({ length: 3 }, (_, i) => (
    <span key={i} className={i < uiLives ? "opacity-100" : "opacity-20"}>🧑</span>
  ));

  return (
    <GameShell
      topbar={
        <GameTopbar
          title="Ocean Save 2"
          score={uiScore}
          highScore={highScore}
        />
      }
    >
      <div ref={containerRef} className="relative w-full h-full overflow-hidden select-none">
        <canvas ref={canvasRef} className="absolute inset-0 w-full h-full touch-none" />

        {/* HUD */}
        <div className="absolute top-2 left-2 flex items-center gap-2 pointer-events-none">
          <div className="flex gap-1 text-lg">{livesIcons}</div>
          <div
            className="text-xs font-bold px-2 py-1 rounded-full"
            style={{ background: "rgba(4,31,48,0.7)", color: "#7dd3fc", fontFamily: "Manrope, sans-serif" }}
          >
            LVL {uiLevel}
          </div>
          <div
            className="text-xs px-2 py-1 rounded-full"
            style={{ background: "rgba(4,31,48,0.7)", color: "#ffd166", fontFamily: "Manrope, sans-serif" }}
          >
            🧑 {uiSurvivors} left
          </div>
        </div>

        {/* Game over button */}
        {uiPhase === "gameover" && (
          <div className="absolute inset-0 flex items-end justify-center pb-16 pointer-events-auto">
            <button
              onClick={startGame}
              className="px-8 py-4 rounded-2xl font-bold text-xl text-white shadow-lg active:scale-95 transition-transform"
              style={{
                background: "linear-gradient(135deg, #e63946, #c1121f)",
                fontFamily: "Fraunces, serif",
                minWidth: 200,
                minHeight: 56,
              }}
            >
              Play Again
            </button>
          </div>
        )}

        {/* Instructions (first few seconds) */}
        {uiPhase === "playing" && uiLevel === 1 && (
          <div
            className="absolute bottom-4 left-1/2 -translate-x-1/2 text-center px-4 py-2 rounded-xl pointer-events-none"
            style={{
              background: "rgba(4,31,48,0.75)",
              color: "#7dd3fc",
              fontFamily: "Manrope, sans-serif",
              fontSize: 13,
            }}
          >
            🚤 Tap/click to steer · Ram 🦈 sharks · Rescue 🧑 survivors
          </div>
        )}
      </div>
    </GameShell>
  );
}
