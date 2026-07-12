import { GameEngine, InputManager } from './engine.js';
import { Rink, Player, Puck }       from './entities.js';
import { resolveCircleCollision }   from './physics.js';

// ─── AUDIO (Web Audio API — no files needed) ──────────────────────────────────
class SFX {
    constructor() {
        try {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        } catch (e) { this.ctx = null; }
    }

    _beep(freq, dur, type = 'sine', gain = 0.3, when = 0) {
        if (!this.ctx) return;
        try {
            const g = this.ctx.createGain();
            const o = this.ctx.createOscillator();
            g.gain.setValueAtTime(gain, this.ctx.currentTime + when);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + when + dur);
            o.frequency.setValueAtTime(freq, this.ctx.currentTime + when);
            o.type = type;
            o.connect(g);
            g.connect(this.ctx.destination);
            o.start(this.ctx.currentTime + when);
            o.stop(this.ctx.currentTime + when + dur);
        } catch (e) {}
    }

    _noise(dur, gain = 0.15) {
        if (!this.ctx) return;
        try {
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
            const data = buf.getChannelData(0);
            for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
            const src = this.ctx.createBufferSource();
            src.buffer = buf;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
            src.connect(g);
            g.connect(this.ctx.destination);
            src.start();
        } catch (e) {}
    }

    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

    hit()   { this._noise(0.08, 0.25); this._beep(120, 0.08, 'square', 0.15); }
    shoot() { this._beep(200, 0.12, 'sawtooth', 0.2); this._noise(0.1, 0.12); }
    save()  { this._beep(180, 0.18, 'square', 0.25); this._noise(0.1, 0.18); }
    goal()  {
        // Celebration fanfare
        [523, 659, 784, 1047].forEach((f, i) => this._beep(f, 0.25, 'square', 0.3, i * 0.13));
    }
    whistle() {
        this._beep(2200, 0.3, 'sine', 0.25);
        this._beep(2000, 0.15, 'sine', 0.2, 0.32);
    }
    tick() { this._beep(600, 0.04, 'square', 0.07); }
}

// ─── PARTICLES ────────────────────────────────────────────────────────────────
class ParticleSystem {
    constructor() { this.particles = []; }

    emit(x, y, count, opts = {}) {
        for (let i = 0; i < count; i++) {
            const angle = Math.random() * Math.PI * 2;
            const speed = (opts.minSpd || 1) + Math.random() * (opts.maxSpd || 4);
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * speed,
                vy: Math.sin(angle) * speed,
                life: 1,
                decay: (opts.minDecay || 0.02) + Math.random() * (opts.maxDecay || 0.04),
                radius: (opts.minR || 2) + Math.random() * (opts.maxR || 3),
                color: opts.colors ? opts.colors[Math.floor(Math.random() * opts.colors.length)] : '#fff',
                gravity: opts.gravity || 0,
            });
        }
    }

    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.96; p.vy *= 0.96;
            p.life -= p.decay;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }

    render(ctx) {
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.radius * p.life, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.restore();
        });
    }
}

// ─── CONSTANTS ────────────────────────────────────────────────────────────────
const SHOOT_POWER      = 14;
const PASS_POWER       = 11;
const TACKLE_SPD       = 4.2;
const SWITCH_INTERVAL  = 0.35;
const PERIOD_DURATION  = 180; // seconds (3 min per period)
const NUM_PERIODS      = 3;

// ─── GAME ─────────────────────────────────────────────────────────────────────
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx    = this.canvas.getContext('2d');

        this.cam    = { x: 0, y: 0 };
        this.shake  = { x: 0, y: 0, power: 0 };

        this.scores = [0, 0];
        this.shots  = [0, 0];

        this.gameState   = 'MENU';    // MENU | PLAYING | GOAL | PAUSED | GAMEOVER
        this.goalTimer   = 0;
        this.switchTimer = 0;

        // Clock
        this.period    = 1;
        this.clockTime = PERIOD_DURATION; // counts down

        this.rink    = new Rink();
        this.puck    = new Puck(this.rink.w / 2, this.rink.h / 2);
        this.players = [];
        this.controlledIdx = -1;

        this.sfx        = new SFX();
        this.particles  = new ParticleSystem();

        this._setupMatch();

        this.input  = new InputManager(this.canvas);
        this.engine = new GameEngine(dt => this._update(dt), alpha => this._render(alpha));

        this.input.onRelease = (vx, vy, mag) => {
            this.sfx.resume();
            this._handleRelease(vx, vy, mag);
        };

        this._resize();
        window.addEventListener('resize', () => this._resize());
        document.addEventListener('touchmove',   e => e.preventDefault(), { passive: false });
        document.addEventListener('gesturestart', e => e.preventDefault());

        // Pause button
        document.getElementById('pause-btn').addEventListener('pointerdown', e => {
            e.stopPropagation();
            this._togglePause();
        });

        // Any touch resumes audio (iOS policy) and starts menu
        this.canvas.addEventListener('pointerdown', () => {
            this.sfx.resume();
            if (this.gameState === 'MENU') this._startGame();
        });

        this.engine.start();
    }

    // ── Setup / Reset ──────────────────────────────────────────────────────────
    _setupMatch() {
        this.players = [];
        const cx = this.rink.w / 2, cy = this.rink.h / 2;
        const g0Y = this.rink.goalLineY1 - 50;
        const g1Y = this.rink.goalLineY0 + 50;

        this.players.push(new Player(cx,       cy + 55,  0, 99));
        this.players.push(new Player(cx - 110, cy + 120, 0, 8));
        this.players.push(new Player(cx + 110, cy + 120, 0, 19));
        this.players.push(new Player(cx, g0Y,  0, 31, true));

        this.players.push(new Player(cx,       cy - 55,  1, 87));
        this.players.push(new Player(cx - 110, cy - 120, 1, 71));
        this.players.push(new Player(cx + 110, cy - 120, 1, 58));
        this.players.push(new Player(cx, g1Y,  1, 30, true));

        this._resetPositions();
    }

    _resetPositions() {
        const cx = this.rink.w / 2, cy = this.rink.h / 2;
        this.puck.pos = { x: cx, y: cy };
        this.puck.vel = { x: 0, y: 0 };
        this.puck.carrier = null;
        this.puck.trail = [];

        const starts = [
            { x: cx,       y: cy + 55  }, { x: cx - 110, y: cy + 120 },
            { x: cx + 110, y: cy + 120 }, { x: cx, y: this.rink.goalLineY1 - 50 },
            { x: cx,       y: cy - 55  }, { x: cx - 110, y: cy - 120 },
            { x: cx + 110, y: cy - 120 }, { x: cx, y: this.rink.goalLineY0 + 50 },
        ];

        this.players.forEach((p, i) => {
            p.pos = { ...starts[i] };
            p.vel = { x: 0, y: 0 };
            p.hasPuck = false;
            p.stunTimer = 0;
        });
        this._autoSwitch();
    }

    _startGame() {
        this.scores = [0, 0];
        this.shots  = [0, 0];
        this.period = 1;
        this.clockTime = PERIOD_DURATION;
        this._updateScoreUI();
        this.gameState = 'PLAYING';
        this.sfx.whistle();
    }

    _resize() {
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

    _updateScoreUI() {
        document.getElementById('score-home').textContent  = this.scores[0];
        document.getElementById('score-away').textContent  = this.scores[1];
        document.getElementById('shots-home').textContent  = this.shots[0];
        document.getElementById('shots-away').textContent  = this.shots[1];
    }

    _updateClockUI() {
        const t = Math.max(0, Math.ceil(this.clockTime));
        const m = Math.floor(t / 60);
        const s = t % 60;
        document.getElementById('clock').textContent  = m + ':' + String(s).padStart(2, '0');
        document.getElementById('period').textContent =
            ['1ST', '2ND', '3RD', 'OT'][Math.min(this.period - 1, 3)];
    }

    // ── Input ─────────────────────────────────────────────────────────────────
    _handleRelease(vx, vy, mag) {
        if (this.gameState !== 'PLAYING') return;
        const cp = this.players[this.controlledIdx];
        if (!cp) return;

        if (cp.hasPuck) {
            // Look for teammate in aimed direction first (pass)
            let bestMate = null, bestDot = 0.72;
            this.players.forEach(q => {
                if (q.team !== 0 || q === cp || q.isGoalie) return;
                const mx = q.pos.x - cp.pos.x, my = q.pos.y - cp.pos.y;
                const md = Math.sqrt(mx*mx + my*my) || 1;
                const d  = (vx * mx + vy * my) / md;
                if (d > bestDot) { bestDot = d; bestMate = q; }
            });

            if (bestMate) {
                this._pass(bestMate);
            } else {
                this._shoot(vx, vy);
            }
        } else {
            // Tackle
            let bestOpp = null, bestDot = 0.6, bestDist = 210;
            this.players.forEach(q => {
                if (q.team === 0) return;
                const ox = q.pos.x - cp.pos.x, oy = q.pos.y - cp.pos.y;
                const od = Math.sqrt(ox*ox + oy*oy);
                if (od > bestDist) return;
                const dot = (vx * ox + vy * oy) / (od || 1);
                if (dot > bestDot) { bestDot = dot; bestDist = od; bestOpp = q; }
            });

            cp.vel.x = vx * (bestOpp ? 18 : 9);
            cp.vel.y = vy * (bestOpp ? 18 : 9);
        }
    }

    _shoot(vx, vy) {
        const cp = this.players[this.controlledIdx];
        if (!cp || !cp.hasPuck) return;
        this.shots[0]++;
        this.sfx.shoot();
        document.getElementById('shots-home').textContent = this.shots[0];

        this.puck.vel.x = cp.vel.x + vx * SHOOT_POWER;
        this.puck.vel.y = cp.vel.y + vy * SHOOT_POWER;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 3);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 3);
        cp.hasPuck = false;
        this.puck.carrier = null;

        // Ice spray particles at shot
        this.particles.emit(cp.pos.x, cp.pos.y, 10, {
            colors: ['#fff', '#c8e8ff', '#aaddff'],
            minSpd: 1, maxSpd: 5,
            minDecay: 0.03, maxDecay: 0.07,
        });
    }

    _pass(target) {
        const cp = this.players[this.controlledIdx];
        if (!cp || !cp.hasPuck) return;
        const dx = target.pos.x - cp.pos.x, dy = target.pos.y - cp.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;

        this.puck.vel.x = cp.vel.x + (dx/d) * PASS_POWER;
        this.puck.vel.y = cp.vel.y + (dy/d) * PASS_POWER;
        this.puck.pos.x = cp.pos.x + (dx/d) * (cp.radius + this.puck.radius + 3);
        this.puck.pos.y = cp.pos.y + (dy/d) * (cp.radius + this.puck.radius + 3);
        cp.hasPuck = false;
        this.puck.carrier = null;
    }

    // ── Auto-switch ───────────────────────────────────────────────────────────
    _autoSwitch() {
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team === 0 && p.hasPuck && !p.isGoalie) { this.controlledIdx = i; return; }
        }
        let best = -1, bestD = Infinity;
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team !== 0 || p.isGoalie) continue;
            const dx = p.pos.x - this.puck.pos.x, dy = p.pos.y - this.puck.pos.y;
            const d = dx*dx + dy*dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        this.controlledIdx = best;
    }

    // ── Update ────────────────────────────────────────────────────────────────
    _update(dt) {
        // Goal delay
        if (this.gameState === 'GOAL') {
            this.goalTimer -= dt;
            this.particles.update();
            if (this.goalTimer <= 0) {
                this.gameState = 'PLAYING';
                document.getElementById('goal-overlay').classList.add('hidden');
                this._resetPositions();
                this.sfx.whistle();
            }
            return;
        }
        if (this.gameState !== 'PLAYING') return;

        // ── Clock countdown
        this.clockTime -= dt;
        this._updateClockUI();

        if (this.clockTime <= 0) {
            if (this.period < NUM_PERIODS) {
                this.period++;
                this.clockTime = PERIOD_DURATION;
                this.sfx.whistle();
                this._resetPositions();
            } else {
                this.gameState = 'GAMEOVER';
                this._showGameOver();
                return;
            }
        }

        // Tick sound last 10 seconds
        if (this.clockTime < 10 && Math.floor(this.clockTime * 10) % 10 === 0) {
            this.sfx.tick();
        }

        // Screen shake decay
        this.shake.power *= 0.85;
        this.shake.x = (Math.random() - 0.5) * this.shake.power;
        this.shake.y = (Math.random() - 0.5) * this.shake.power;

        // ── 1. Human input
        const cp = this.players[this.controlledIdx];
        if (cp && this.input.joystick.active) {
            const { vx, vy, mag } = this.input.joystick;
            cp.applyForce(vx * mag * 1.9, vy * mag * 1.9);
        }

        // ── 2. AI
        this._updateAI();

        // ── 3. Physics
        this.players.forEach(p => p.update(dt));
        if (!this.puck.carrier) this.puck.update(dt);

        // ── 4. Confine
        this.rink.confine(this.puck);
        this.players.forEach(p => this.rink.confine(p));

        // ── 5. Collisions
        this._resolveCollisions();

        // ── 6. Carrier
        this._updateCarrier();

        // ── 7. Goal check
        const scored = this.rink.checkGoal(this.puck);
        if (scored !== -1) this._handleGoal(scored);

        // ── 8. Auto-switch
        this.switchTimer -= dt;
        if (this.switchTimer <= 0) { this.switchTimer = SWITCH_INTERVAL; this._autoSwitch(); }

        // ── 9. Particles
        this.particles.update();
    }

    // ── AI ────────────────────────────────────────────────────────────────────
    _updateAI() {
        const cx = this.rink.w / 2;
        const t0HasPuck = this.players.some(p => p.team === 0 && p.hasPuck);
        const t1HasPuck = this.players.some(p => p.team === 1 && p.hasPuck);
        const t0AtY  = this.rink.goalLineY0;   // team0 attacks top
        const t1AtY  = this.rink.goalLineY1;   // team1 attacks bottom

        this.players.forEach((p, i) => {
            if (i === this.controlledIdx) return;

            if (p.isGoalie) {
                const myLineY = p.team === 0 ? t1AtY : t0AtY;
                const safeOff = p.team === 0 ? -42 : 42;
                const tx = Math.max(cx - this.rink.goalW/2 + 18,
                            Math.min(cx + this.rink.goalW/2 - 18, this.puck.pos.x));
                p._arrive(tx, myLineY + safeOff, 35);
                return;
            }

            if (p.team === 1) {
                if (p.hasPuck) {
                    p._seek(cx + (Math.random() - 0.5) * 60, t1AtY);
                    const dy = t1AtY - p.pos.y;
                    if (dy < 220 && Math.random() < 0.018) {
                        this._aiShoot(p, cx, t1AtY);
                    }
                } else if (t1HasPuck) {
                    // Run support lane
                    const laneX = i % 2 === 0 ? cx - 90 : cx + 90;
                    p._arrive(laneX, this.puck.pos.y - 50, 70);
                } else {
                    const dx = this.puck.pos.x - p.pos.x, dy = this.puck.pos.y - p.pos.y;
                    if (dx*dx + dy*dy < 200*200) p._seek(this.puck.pos.x, this.puck.pos.y);
                    else p._arrive(cx, t0AtY + 90, 60);
                }
            } else {
                // Team 0 non-controlled teammates
                if (t0HasPuck) {
                    const laneX = i % 2 === 0 ? cx - 100 : cx + 100;
                    p._arrive(laneX, t0AtY + 110, 80);
                } else {
                    const dx = this.puck.pos.x - p.pos.x, dy = this.puck.pos.y - p.pos.y;
                    const d = Math.sqrt(dx*dx + dy*dy) || 1;
                    p.applyForce((dx/d) * 0.4, (dy/d) * 0.4);
                }
            }
        });
    }

    _aiShoot(p, tx, ty) {
        this.shots[1]++;
        document.getElementById('shots-away').textContent = this.shots[1];
        this.sfx.shoot();
        const dx = tx - p.pos.x, dy = ty - p.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        this.puck.vel.x = p.vel.x + (dx/d) * 10;
        this.puck.vel.y = p.vel.y + (dy/d) * 10;
        this.puck.pos.x = p.pos.x + (dx/d) * (p.radius + this.puck.radius + 3);
        this.puck.pos.y = p.pos.y + (dy/d) * (p.radius + this.puck.radius + 3);
        p.hasPuck = false;
        this.puck.carrier = null;
    }

    // ── Collisions ───────────────────────────────────────────────────────────
    _resolveCollisions() {
        for (let i = 0; i < this.players.length; i++) {
            for (let j = i + 1; j < this.players.length; j++) {
                const a = this.players[i], b = this.players[j];
                const hit = resolveCircleCollision(a, b);
                if (hit && a.team !== b.team) {
                    const spdA = Math.sqrt(a.vel.x**2 + a.vel.y**2);
                    const spdB = Math.sqrt(b.vel.x**2 + b.vel.y**2);
                    if (a.hasPuck && spdB > TACKLE_SPD) {
                        this._dislodge(a);
                        b.hitFlash = 0.4;
                        this.sfx.hit();
                        this.shake.power = 6;
                        this.particles.emit(a.pos.x, a.pos.y, 14, {
                            colors: ['#fff', '#ffd700', '#ffaa00'],
                            minSpd: 2, maxSpd: 7, minDecay: 0.04, maxDecay: 0.08,
                        });
                    } else if (b.hasPuck && spdA > TACKLE_SPD) {
                        this._dislodge(b);
                        a.hitFlash = 0.4;
                        this.sfx.hit();
                        this.shake.power = 6;
                        this.particles.emit(b.pos.x, b.pos.y, 14, {
                            colors: ['#fff', '#ffd700', '#ffaa00'],
                            minSpd: 2, maxSpd: 7, minDecay: 0.04, maxDecay: 0.08,
                        });
                    } else if (hit) {
                        // Normal body check — small spark
                        this.sfx.hit();
                        const mx = (a.pos.x + b.pos.x) / 2, my = (a.pos.y + b.pos.y) / 2;
                        this.particles.emit(mx, my, 5, {
                            colors: ['#fff', '#ddd'],
                            minSpd: 1, maxSpd: 3, minDecay: 0.05, maxDecay: 0.1,
                        });
                    }
                }
            }
            if (this.puck.carrier !== this.players[i]) {
                resolveCircleCollision(this.players[i], this.puck);
            }
        }
    }

    _dislodge(carrier) {
        carrier.hasPuck   = false;
        carrier.stunTimer = 1.2;
        this.puck.carrier = null;
        this.puck.vel.x  += (Math.random() - 0.5) * 5;
        this.puck.vel.y  += (Math.random() - 0.5) * 5;
        this._autoSwitch();
    }

    // ── Carrier ───────────────────────────────────────────────────────────────
    _updateCarrier() {
        if (this.puck.carrier) {
            const c = this.puck.carrier;
            const stickR = c.radius + this.puck.radius;
            this.puck.pos.x = c.pos.x + Math.cos(c.angle) * stickR;
            this.puck.pos.y = c.pos.y + Math.sin(c.angle) * stickR;
            this.puck.vel.x = 0; this.puck.vel.y = 0;
            this.puck.trail = [];
        } else {
            for (const p of this.players) {
                if (p.stunTimer > 0) continue;
                const dx = p.pos.x - this.puck.pos.x, dy = p.pos.y - this.puck.pos.y;
                if (dx*dx + dy*dy < (p.radius + this.puck.radius)**2) {
                    this.puck.carrier = p;
                    p.hasPuck = true;
                    if (p.team === 0) this._autoSwitch();
                    break;
                }
            }
        }
    }

    // ── Goal ──────────────────────────────────────────────────────────────────
    _handleGoal(teamThatScored) {
        this.gameState = 'GOAL';
        this.goalTimer = 3;
        this.scores[teamThatScored]++;
        this._updateScoreUI();
        this.sfx.goal();
        this.shake.power = 18;

        if (this.puck.carrier) { this.puck.carrier.hasPuck = false; this.puck.carrier = null; }

        // Big confetti burst at puck
        this.particles.emit(this.puck.pos.x, this.puck.pos.y, 60, {
            colors: teamThatScored === 0
                ? ['#e74c3c', '#fff', '#c0392b', '#ffd700']
                : ['#2471a3', '#fff', '#1a5276', '#ffd700'],
            minSpd: 2, maxSpd: 12,
            minDecay: 0.015, maxDecay: 0.035,
            gravity: 0.1,
        });

        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        gt.textContent = teamThatScored === 0 ? 'GOAL! 🚨' : 'OPPONENT SCORES!';
        gt.style.color = teamThatScored === 0 ? '#e74c3c' : '#3498db';
        ov.classList.remove('hidden');
    }

    _showGameOver() {
        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        const [h, a] = this.scores;
        if (h > a)      gt.textContent = 'YOU WIN! 🏆';
        else if (a > h) gt.textContent = 'YOU LOSE 😔';
        else            gt.textContent = 'TIE GAME!';
        gt.style.color = '#fff';
        ov.classList.remove('hidden');
        this.sfx.whistle();
    }

    // ── Render ────────────────────────────────────────────────────────────────
    _render(alpha) {
        const ctx  = this.ctx;
        const vw   = this.vw, vh = this.vh;
        const rink = this.rink;

        // ── MENU screen
        if (this.gameState === 'MENU') {
            this._renderMenu(ctx, vw, vh);
            return;
        }

        // Camera follow puck
        const tCX = this.puck.pos.x - vw / 2;
        const tCY = this.puck.pos.y - vh / 2;
        const cMaxX = Math.max(0, rink.w - vw);
        const cMaxY = Math.max(0, rink.h - vh);
        this.cam.x += (Math.max(0, Math.min(tCX, cMaxX)) - this.cam.x) * 0.12;
        this.cam.y += (Math.max(0, Math.min(tCY, cMaxY)) - this.cam.y) * 0.12;

        ctx.clearRect(0, 0, vw, vh);

        // World transform + shake
        ctx.save();
        ctx.translate(
            -Math.round(this.cam.x) + this.shake.x,
            -Math.round(this.cam.y) + this.shake.y
        );

        rink.render(ctx);

        // Aiming line
        const cp = this.players[this.controlledIdx];
        if (cp && cp.hasPuck && this.input.joystick.active && this.input.joystick.mag > 0.1) {
            const { vx, vy } = this.input.joystick;
            ctx.save();
            ctx.shadowBlur = 14; ctx.shadowColor = '#2ecc71';
            ctx.strokeStyle = 'rgba(46,204,113,0.8)';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([10, 6]);
            ctx.beginPath();
            ctx.moveTo(this.puck.pos.x, this.puck.pos.y);
            ctx.lineTo(this.puck.pos.x + vx * 170, this.puck.pos.y + vy * 170);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            // Arrowhead
            const ax = this.puck.pos.x + vx * 170, ay = this.puck.pos.y + vy * 170;
            const ang = Math.atan2(vy, vx);
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - Math.cos(ang - 0.4) * 12, ay - Math.sin(ang - 0.4) * 12);
            ctx.lineTo(ax - Math.cos(ang + 0.4) * 12, ay - Math.sin(ang + 0.4) * 12);
            ctx.closePath();
            ctx.fillStyle = '#2ecc71';
            ctx.fill();
            ctx.restore();
        }

        // Players (sorted by Y so back players render behind front ones)
        [...this.players]
            .sort((a, b) => a.pos.y - b.pos.y)
            .forEach(p => p.render(ctx, this.players.indexOf(p) === this.controlledIdx));

        // Puck
        this.puck.render(ctx);

        // Particles (in world space)
        this.particles.render(ctx);

        ctx.restore();

        // HUD: joystick (screen space)
        this.input.renderJoystick(ctx);

        // PAUSED overlay (screen space)
        if (this.gameState === 'PAUSED') {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, 0, vw, vh);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 38px Oswald';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('PAUSED', vw / 2, vh / 2);
            ctx.font = '14px Oswald';
            ctx.fillStyle = '#aaa';
            ctx.fillText('Tap ❚❚ to resume', vw / 2, vh / 2 + 38);
            ctx.restore();
        }
    }

    _renderMenu(ctx, vw, vh) {
        // Gradient background
        const bg = ctx.createLinearGradient(0, 0, 0, vh);
        bg.addColorStop(0, '#0a0a16');
        bg.addColorStop(1, '#0d1a2e');
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, vw, vh);

        // Animated rink preview (small, zoomed out)
        ctx.save();
        const scale = vw / this.rink.w * 0.85;
        ctx.translate(vw / 2, vh * 0.38);
        ctx.scale(scale, scale);
        ctx.translate(-this.rink.w / 2, -this.rink.h / 2);
        this.rink.render(ctx);
        ctx.restore();

        // Dark overlay on rink
        ctx.fillStyle = 'rgba(0,0,5,0.5)';
        ctx.fillRect(0, 0, vw, vh);

        // Title
        ctx.save();
        ctx.textAlign = 'center';

        // Shadow
        ctx.shadowBlur = 30;
        ctx.shadowColor = '#2471a3';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 52px Oswald';
        ctx.fillText('ARCADE', vw / 2, vh * 0.22);
        ctx.fillStyle = '#3498db';
        ctx.shadowColor = '#2471a3';
        ctx.fillText('HOCKEY', vw / 2, vh * 0.22 + 54);
        ctx.shadowBlur = 0;

        // Puck icon
        ctx.beginPath();
        ctx.arc(vw / 2, vh * 0.22 + 96, 12, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.strokeStyle = '#666';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Tap to start button
        const pulse = 0.8 + 0.2 * Math.sin(Date.now() * 0.004);
        ctx.globalAlpha = pulse;
        ctx.fillStyle = '#2471a3';
        // Rounded button
        const bw = 200, bh = 48, bx = vw/2 - bw/2, by = vh * 0.72;
        ctx.beginPath();
        ctx.moveTo(bx + 12, by);
        ctx.lineTo(bx + bw - 12, by);
        ctx.arcTo(bx + bw, by, bx + bw, by + 12, 12);
        ctx.lineTo(bx + bw, by + bh - 12);
        ctx.arcTo(bx + bw, by + bh, bx + bw - 12, by + bh, 12);
        ctx.lineTo(bx + 12, by + bh);
        ctx.arcTo(bx, by + bh, bx, by + bh - 12, 12);
        ctx.lineTo(bx, by + 12);
        ctx.arcTo(bx, by, bx + 12, by, 12);
        ctx.closePath();
        ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 20px Oswald';
        ctx.textBaseline = 'middle';
        ctx.fillText('TAP TO PLAY', vw / 2, by + bh / 2);

        // Controls hint
        ctx.font = '11px Oswald';
        ctx.fillStyle = 'rgba(255,255,255,0.5)';
        ctx.fillText('Joystick (left) · Release to shoot/pass', vw / 2, vh * 0.87);

        ctx.restore();
    }
}

// ── Boot ──────────────────────────────────────────────────────────────────────
window.addEventListener('load', () => new Game());
