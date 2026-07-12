import { GameEngine, InputManager } from './engine.js';
import { Rink, Player, Puck }       from './entities.js';
import { resolveCircleCollision }   from './physics.js';

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SHOOT_POWER   = 14;
const PASS_POWER    = 11;
const TACKLE_SPD    = 4.5;   // minimum speed to dislodge puck on hit
const SWITCH_INTERVAL = 0.4; // seconds between auto-switch evaluations

// ─── GAME ─────────────────────────────────────────────────────────────────────
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx    = this.canvas.getContext('2d');

        // Camera (world coords of top-left corner of viewport)
        this.cam = { x: 0, y: 0 };

        // Score / game state
        this.scores      = [0, 0];
        this.shots       = [0, 0];
        this.gameState   = 'PLAYING'; // 'PLAYING' | 'GOAL' | 'PAUSED'
        this.goalTimer   = 0;
        this.switchTimer = 0;

        // Build world
        this.rink    = new Rink();
        this.puck    = new Puck(this.rink.w / 2, this.rink.h / 2);
        this.players = [];
        this.controlledIdx = -1;

        this._setupMatch();

        // Engine & input
        this.input  = new InputManager(this.canvas);
        this.engine = new GameEngine(dt => this._update(dt), alpha => this._render(alpha));

        this.input.onRelease = (vx, vy, mag) => this._handleRelease(vx, vy, mag);

        // Initial resize
        this._resize();
        window.addEventListener('resize', () => this._resize());

        // Pause button
        document.getElementById('pause-btn').addEventListener('click', () => this._togglePause());

        // Prevent pull-to-refresh / double-tap zoom
        document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
        document.addEventListener('gesturestart', e => e.preventDefault());

        this.engine.start();
    }

    // ── Setup / Reset ──────────────────────────────────────────────────────────
    _setupMatch() {
        this.players = [];
        const cx = this.rink.w / 2;
        const cy = this.rink.h / 2;

        // Team 0 – human (red), attacks top goal (team0 scores into top, team1 defends top)
        this.players.push(new Player(cx,       cy + 60,  0, 99));       // center
        this.players.push(new Player(cx - 110, cy + 130, 0, 8));        // LW
        this.players.push(new Player(cx + 110, cy + 130, 0, 19));       // RW
        this.players.push(new Player(cx,       this.rink.goalLineY1 - 55, 0, 31, true)); // goalie

        // Team 1 – AI (blue), attacks bottom goal
        this.players.push(new Player(cx,       cy - 60,  1, 87));
        this.players.push(new Player(cx - 110, cy - 130, 1, 71));
        this.players.push(new Player(cx + 110, cy - 130, 1, 58));
        this.players.push(new Player(cx,       this.rink.goalLineY0 + 55, 1, 30, true));

        this._resetPositions();
    }

    _resetPositions() {
        const cx = this.rink.w / 2;
        const cy = this.rink.h / 2;

        this.puck.pos = { x: cx, y: cy };
        this.puck.vel = { x: 0, y: 0 };
        this.puck.carrier = null;

        const starts = [
            { x: cx,       y: cy + 60  },
            { x: cx - 110, y: cy + 130 },
            { x: cx + 110, y: cy + 130 },
            { x: cx,       y: this.rink.goalLineY1 - 55 },
            { x: cx,       y: cy - 60  },
            { x: cx - 110, y: cy - 130 },
            { x: cx + 110, y: cy - 130 },
            { x: cx,       y: this.rink.goalLineY0 + 55 },
        ];

        this.players.forEach((p, i) => {
            p.pos    = { ...starts[i] };
            p.vel    = { x: 0, y: 0 };
            p.hasPuck = false;
            p.stunTimer = 0;
        });

        this._autoSwitch();
    }

    _resize() {
        // Fixed logical width; height scales to screen aspect ratio
        const W = 360;
        const H = Math.round(W * (window.innerHeight / window.innerWidth));
        if (this.canvas.width !== W || this.canvas.height !== H) {
            this.canvas.width  = W;
            this.canvas.height = H;
        }
        this.vw = W;
        this.vh = H;
    }

    _togglePause() {
        if (this.gameState === 'PLAYING') {
            this.gameState = 'PAUSED';
            this.engine.stop();
        } else if (this.gameState === 'PAUSED') {
            this.gameState = 'PLAYING';
            this.engine.start();
        }
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    _handleRelease(vx, vy, mag) {
        if (this.gameState !== 'PLAYING') return;
        const cp = this.players[this.controlledIdx];
        if (!cp) return;

        if (cp.hasPuck) {
            // Decide: shoot toward opponent goal, or pass to teammate
            const gx = this.rink.w / 2;
            const gy = this.rink.goalLineY0; // team0 attacks top goal
            const dgx = gx - cp.pos.x, dgy = gy - cp.pos.y;
            const gDist = Math.sqrt(dgx * dgx + dgy * dgy);
            const dotGoal = (vx * dgx + vy * dgy) / (gDist || 1);

            // Try to find a teammate in the aimed direction
            let bestMate = null, bestDot = 0.7;
            this.players.forEach(q => {
                if (q.team !== 0 || q === cp) return;
                const mx = q.pos.x - cp.pos.x, my = q.pos.y - cp.pos.y;
                const md = Math.sqrt(mx * mx + my * my) || 1;
                const d = (vx * mx + vy * my) / md;
                if (d > bestDot) { bestDot = d; bestMate = q; }
            });

            if (bestMate) {
                this._pass(bestMate);
            } else {
                this._shoot(vx, vy);
            }
        } else {
            // Check tackle: high-speed lunge at nearest opponent in aimed direction
            let bestOpp = null, bestDot = 0.65, bestDist = 200;
            this.players.forEach(q => {
                if (q.team === 0) return;
                const ox = q.pos.x - cp.pos.x, oy = q.pos.y - cp.pos.y;
                const od = Math.sqrt(ox * ox + oy * oy);
                if (od > bestDist) return;
                const dot = (vx * ox + vy * oy) / (od || 1);
                if (dot > bestDot) { bestDot = dot; bestDist = od; bestOpp = q; }
            });
            if (bestOpp) {
                // Lunge
                cp.vel.x = vx * 16;
                cp.vel.y = vy * 16;
            } else {
                // Dash / board check
                cp.vel.x += vx * 8;
                cp.vel.y += vy * 8;
            }
        }
    }

    _shoot(vx, vy) {
        const cp = this.players[this.controlledIdx];
        if (!cp || !cp.hasPuck) return;
        this.shots[0]++;
        document.getElementById('shots-home').textContent = this.shots[0];

        this.puck.vel.x = cp.vel.x + vx * SHOOT_POWER;
        this.puck.vel.y = cp.vel.y + vy * SHOOT_POWER;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 2);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 2);
        cp.hasPuck = false;
        this.puck.carrier = null;
    }

    _pass(target) {
        const cp = this.players[this.controlledIdx];
        if (!cp || !cp.hasPuck) return;
        const dx = target.pos.x - cp.pos.x, dy = target.pos.y - cp.pos.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        const vx = dx / d, vy = dy / d;

        this.puck.vel.x = cp.vel.x + vx * PASS_POWER;
        this.puck.vel.y = cp.vel.y + vy * PASS_POWER;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 2);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 2);
        cp.hasPuck = false;
        this.puck.carrier = null;
    }

    // ── Auto-switch ───────────────────────────────────────────────────────────
    _autoSwitch() {
        // If someone on team0 has puck, control them
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team === 0 && p.hasPuck && !p.isGoalie) { this.controlledIdx = i; return; }
        }
        // Otherwise control team0 skater closest to puck
        let best = -1, bestD = Infinity;
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team !== 0 || p.isGoalie) continue;
            const dx = p.pos.x - this.puck.pos.x, dy = p.pos.y - this.puck.pos.y;
            const d = dx * dx + dy * dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        this.controlledIdx = best;
    }

    // ── Update ────────────────────────────────────────────────────────────────
    _update(dt) {
        if (this.gameState === 'GOAL') {
            this.goalTimer -= dt;
            if (this.goalTimer <= 0) {
                this.gameState = 'PLAYING';
                document.getElementById('goal-overlay').classList.add('hidden');
                this._resetPositions();
            }
            return;
        }
        if (this.gameState !== 'PLAYING') return;

        // ── 1. Human input → force on controlled player
        const cp = this.players[this.controlledIdx];
        if (cp && this.input.joystick.active) {
            const { vx, vy, mag } = this.input.joystick;
            const force = mag * 1.8;
            cp.applyForce(vx * force, vy * force);
        }

        // ── 2. AI
        this._updateAI();

        // ── 3. Physics
        this.players.forEach(p => p.update(dt));
        if (!this.puck.carrier) this.puck.update(dt);

        // ── 4. Confinement
        this.rink.confine(this.puck);
        this.players.forEach(p => this.rink.confine(p));

        // ── 5. Collisions
        this._resolveCollisions();

        // ── 6. Puck pickup / carry
        this._updateCarrier();

        // ── 7. Goal check
        const scored = this.rink.checkGoal(this.puck);
        if (scored !== -1) this._handleGoal(scored);

        // ── 8. Periodic auto-switch
        this.switchTimer -= dt;
        if (this.switchTimer <= 0) {
            this.switchTimer = SWITCH_INTERVAL;
            this._autoSwitch();
        }
    }

    _updateAI() {
        const cx = this.rink.w / 2;
        const t0HasPuck = this.players.some(p => p.team === 0 && p.hasPuck);
        const t1HasPuck = this.players.some(p => p.team === 1 && p.hasPuck);

        // Team 0 attack goal is top (goalLineY0)
        const t0AttackY = this.rink.goalLineY0;
        const t1AttackY = this.rink.goalLineY1;

        this.players.forEach((p, i) => {
            if (i === this.controlledIdx) return;

            // ─ Goalie AI
            if (p.isGoalie) {
                const myGoalY = p.team === 0 ? t1AttackY : t0AttackY;
                // Track puck X, stay on goal line
                const tx = Math.max(cx - this.rink.goalW / 2 + 20,
                              Math.min(cx + this.rink.goalW / 2 - 20, this.puck.pos.x));
                const ty = p.team === 0 ? myGoalY - 40 : myGoalY + 40;
                p._arrive(tx, ty, 40);
                return;
            }

            // ─ Team 1 (AI opponents)
            if (p.team === 1) {
                if (p.hasPuck) {
                    // Skate toward player's goal (bottom)
                    p._seek(cx, t1AttackY);
                    // Shoot when past center and somewhat close
                    const dy = t1AttackY - p.pos.y;
                    if (dy < 200 && Math.random() < 0.015) {
                        this._aiShoot(p, cx, t1AttackY);
                    }
                } else if (t1HasPuck) {
                    // Support: get open near puck's Y
                    p._arrive(p.pos.x, this.puck.pos.y + (p.team === 1 ? -80 : 80), 60);
                } else {
                    // Defend / chase puck
                    const dpx = this.puck.pos.x - p.pos.x, dpy = this.puck.pos.y - p.pos.y;
                    const dp = dpx * dpx + dpy * dpy;
                    if (dp < 180 * 180) {
                        p._seek(this.puck.pos.x, this.puck.pos.y);
                    } else {
                        p._arrive(cx, t0AttackY + 80, 60); // retreat toward own end
                    }
                }
            }

            // ─ Team 0 skaters (AI-controlled teammates)
            else {
                if (t0HasPuck) {
                    // Support: get open in front of opponent goal
                    p._arrive(p.pos.x, t0AttackY + 100, 80);
                } else {
                    // Chase puck at half speed
                    const dpx = this.puck.pos.x - p.pos.x, dpy = this.puck.pos.y - p.pos.y;
                    const d = Math.sqrt(dpx * dpx + dpy * dpy) || 1;
                    p.applyForce((dpx / d) * 0.35, (dpy / d) * 0.35);
                }
            }
        });
    }

    _aiShoot(p, tx, ty) {
        this.shots[1]++;
        document.getElementById('shots-away').textContent = this.shots[1];
        const dx = tx - p.pos.x, dy = ty - p.pos.y;
        const d  = Math.sqrt(dx * dx + dy * dy) || 1;
        this.puck.vel.x = p.vel.x + (dx / d) * 10;
        this.puck.vel.y = p.vel.y + (dy / d) * 10;
        this.puck.pos.x = p.pos.x + (dx / d) * (p.radius + this.puck.radius + 3);
        this.puck.pos.y = p.pos.y + (dy / d) * (p.radius + this.puck.radius + 3);
        p.hasPuck = false;
        this.puck.carrier = null;
    }

    _resolveCollisions() {
        // Player vs player
        for (let i = 0; i < this.players.length; i++) {
            for (let j = i + 1; j < this.players.length; j++) {
                const a = this.players[i], b = this.players[j];
                const hit = resolveCircleCollision(a, b);
                if (hit && a.team !== b.team) {
                    // Tackle: fast player dislodges puck from slow carrier
                    if (a.hasPuck && Math.sqrt(b.vel.x**2+b.vel.y**2) > TACKLE_SPD) this._dislodge(a);
                    if (b.hasPuck && Math.sqrt(a.vel.x**2+a.vel.y**2) > TACKLE_SPD) this._dislodge(b);
                }
            }

            // Player vs puck (no carrier)
            const p = this.players[i];
            if (this.puck.carrier !== p) {
                resolveCircleCollision(p, this.puck);
            }
        }
    }

    _dislodge(carrier) {
        carrier.hasPuck  = false;
        carrier.stunTimer = 1.2;
        this.puck.carrier = null;
        // small kick to puck
        this.puck.vel.x += (Math.random() - 0.5) * 4;
        this.puck.vel.y += (Math.random() - 0.5) * 4;
        this._autoSwitch();
    }

    _updateCarrier() {
        if (this.puck.carrier) {
            const c = this.puck.carrier;
            // Keep puck on the stick end, in front of player
            const angle = c.angle; // facing angle
            const stickR = c.radius + this.puck.radius;
            this.puck.pos.x = c.pos.x + Math.cos(angle) * stickR;
            this.puck.pos.y = c.pos.y + Math.sin(angle) * stickR;
            this.puck.vel.x = 0;
            this.puck.vel.y = 0;
        } else {
            // Pickup: first unstunned player touching puck gets it
            for (const p of this.players) {
                if (p.stunTimer > 0) continue;
                const dx = p.pos.x - this.puck.pos.x;
                const dy = p.pos.y - this.puck.pos.y;
                if (dx * dx + dy * dy < (p.radius + this.puck.radius) ** 2) {
                    this.puck.carrier = p;
                    p.hasPuck = true;
                    if (p.team === 0) this._autoSwitch();
                    break;
                }
            }
        }
    }

    _handleGoal(teamThatScored) {
        this.gameState = 'GOAL';
        this.goalTimer = 3;
        this.scores[teamThatScored]++;
        document.getElementById(teamThatScored === 0 ? 'score-home' : 'score-away')
                .textContent = this.scores[teamThatScored];

        // Clear carrier so puck doesn't teleport
        if (this.puck.carrier) { this.puck.carrier.hasPuck = false; this.puck.carrier = null; }

        const ov = document.getElementById('goal-overlay');
        ov.classList.remove('hidden');
        // Goal overlay message
        ov.querySelector('.goal-text').textContent = teamThatScored === 0 ? 'GOAL!' : 'OPPONENT SCORES!';
    }

    // ── Render ────────────────────────────────────────────────────────────────
    _render(alpha) {
        const ctx  = this.ctx;
        const vw   = this.vw, vh = this.vh;
        const rink = this.rink;

        // Update camera: center on puck
        const targetCX = this.puck.pos.x - vw / 2;
        const targetCY = this.puck.pos.y - vh / 2;
        const camMaxX  = Math.max(0, rink.w - vw);
        const camMaxY  = Math.max(0, rink.h - vh);
        const clampedCX = Math.max(0, Math.min(targetCX, camMaxX));
        const clampedCY = Math.max(0, Math.min(targetCY, camMaxY));
        this.cam.x += (clampedCX - this.cam.x) * 0.12;
        this.cam.y += (clampedCY - this.cam.y) * 0.12;

        // Clear
        ctx.clearRect(0, 0, vw, vh);

        // World transform
        ctx.save();
        ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));

        // Rink
        rink.render(ctx);

        // Aiming line (when human has puck and joystick is active)
        const cp = this.players[this.controlledIdx];
        if (cp && cp.hasPuck && this.input.joystick.active && this.input.joystick.mag > 0.1) {
            const { vx, vy } = this.input.joystick;
            ctx.save();
            ctx.shadowBlur   = 12;
            ctx.shadowColor  = '#2ecc71';
            ctx.strokeStyle  = 'rgba(46,204,113,0.85)';
            ctx.lineWidth    = 3;
            ctx.setLineDash([8, 6]);
            ctx.beginPath();
            ctx.moveTo(this.puck.pos.x, this.puck.pos.y);
            ctx.lineTo(this.puck.pos.x + vx * 160, this.puck.pos.y + vy * 160);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // Puck shadow
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.puck.pos.x + 2, this.puck.pos.y + 4, this.puck.radius + 2, this.puck.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
        ctx.restore();

        // Players (sorted back to front by Y)
        [...this.players]
            .sort((a, b) => a.pos.y - b.pos.y)
            .forEach(p => p.render(ctx, this.players.indexOf(p) === this.controlledIdx));

        // Puck (on top)
        this.puck.render(ctx);

        ctx.restore(); // end world transform

        // HUD: joystick
        this.input.renderJoystick(ctx);
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => new Game());
