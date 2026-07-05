export interface Vec2 {
  x: number;
  y: number;
}

export interface Survivor {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rescued: boolean;
  eaten: boolean;
  panicTimer: number; // flail animation
}

export interface Shark {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  targetId: number | null; // which survivor it's chasing
  stunTimer: number; // stunned after being rammed
  state: "circle" | "attack" | "flee";
  circleAngle: number;
  circleRadius: number;
  speed: number;
}

export interface Particle {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export interface Boat {
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  speed: number;
}

export interface Raft {
  x: number;
  y: number;
  radius: number;
}

export type Phase = "playing" | "gameover" | "levelup";
