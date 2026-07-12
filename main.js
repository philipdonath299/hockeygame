import { GameEngine, InputManager } from './engine.js';
import { Rink, Player, Puck }       from './entities.js';
import { resolveCircleCollision }   from './physics.js';

// ─── AUDIO ─────────────────────────────────────────────────────────────────────
class SFX {
    constructor() {
        try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }
        catch (e) { this.ctx = null; }
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
            o.connect(g); g.connect(this.ctx.destination);
            o.start(this.ctx.currentTime + when);
            o.stop(this.ctx.currentTime + when + dur);
        } catch (e) {}
    }
    _noise(dur, gain = 0.15) {
        if (!this.ctx) return;
        try {
            const buf = this.ctx.createBuffer(1, this.ctx.sampleRate * dur, this.ctx.sampleRate);
            const d = buf.getChannelData(0);
            for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
            const src = this.ctx.createBufferSource(); src.buffer = buf;
            const g = this.ctx.createGain();
            g.gain.setValueAtTime(gain, this.ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + dur);
            src.connect(g); g.connect(this.ctx.destination); src.start();
        } catch (e) {}
    }
    resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }
    hit(power = 1)   { this._noise(0.06 + power * 0.04, 0.2 + power * 0.1); this._beep(100 + power * 40, 0.08, 'square', 0.12 + power * 0.08); }
    wristShot()      { this._beep(280, 0.08, 'sawtooth', 0.18); this._noise(0.07, 0.1); }
    slapShot()       { this._noise(0.15, 0.25); this._beep(150, 0.15, 'sawtooth', 0.22); }
    pass()           { this._beep(440, 0.06, 'sine', 0.12); }
    save()           { this._beep(180, 0.18, 'square', 0.25); this._noise(0.1, 0.18); }
    tackle()         { this._noise(0.12, 0.3); this._beep(80, 0.1, 'square', 0.2); }
    pickup()         { this._beep(660, 0.05, 'sine', 0.08); }
    goal()           { [523,659,784,1047].forEach((f,i) => this._beep(f, 0.25, 'square', 0.3, i * 0.13)); }
    whistle()        { this._beep(2200, 0.3, 'sine', 0.25); this._beep(2000, 0.15, 'sine', 0.2, 0.32); }
    tick()           { this._beep(600, 0.04, 'square', 0.07); }
    charge(t)        { if (!this.ctx) return; this._beep(300 + t * 400, 0.05, 'sine', 0.06 + t * 0.06); }
}

// ─── PARTICLES ─────────────────────────────────────────────────────────────────
class ParticleSystem {
    constructor() { this.particles = []; }
    emit(x, y, count, opts = {}) {
        for (let i = 0; i < count; i++) {
            const angle = (opts.angle ?? Math.random() * Math.PI * 2) + (Math.random() - 0.5) * (opts.spread ?? Math.PI * 2);
            const spd = (opts.minSpd || 1) + Math.random() * ((opts.maxSpd || 4) - (opts.minSpd || 1));
            this.particles.push({
                x, y,
                vx: Math.cos(angle) * spd,
                vy: Math.sin(angle) * spd,
                life: 1,
                decay: (opts.minDecay || 0.025) + Math.random() * ((opts.maxDecay || 0.05) - (opts.minDecay || 0.025)),
                r: (opts.minR || 2) + Math.random() * ((opts.maxR || 3) - (opts.minR || 2)),
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
            p.vx *= 0.95; p.vy *= 0.95;
            p.life -= p.decay;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }
    render(ctx) {
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.beginPath();
            ctx.arc(p.x, p.y, p.r * p.life, 0, Math.PI * 2);
            ctx.fillStyle = p.color;
            ctx.fill();
            ctx.restore();
        });
    }
}

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const PERIOD_DURATION = 180;
const NUM_PERIODS     = 3;
const SWITCH_INTERVAL = 0.3;

// Shot power: wrist shot on quick release, slap shot if you hold the joystick
const WRIST_POWER     = 11;   // quick release (<0.25s)
const SLAP_POWER      = 18;   // charged release (>0.6s)
const PASS_POWER      = 12;

// Pickup radius (slightly bigger than sum of radii for a "magnetic" feel)
const PICKUP_BONUS    = 5;

// Tackle
const TACKLE_SPEED    = 20;   // lunge speed
const TACKLE_COOLDOWN = 1.4;  // seconds between tackles

// Body check threshold to dislodge puck
const CHECK_THRESHOLD = 5.0;

// ─── GAME ─────────────────────────────────────────────────────────────────────
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx    = this.canvas.getContext('2d');

        this.cam   = { x: 0, y: 0 };
        this.shake = { x: 0, y: 0, power: 0 };

        this.scores = [0, 0];
        this.shots  = [0, 0];

        this.gameState   = 'MENU';
        this.goalTimer   = 0;
        this.switchTimer = 0;
        this.period      = 1;
        this.clockTime   = PERIOD_DURATION;

        // Per-controlled-player state
        this.tackleTimer   = 0;   // cooldown
        this.joystickHeld  = 0;   // seconds joystick has been active with puck

        // Target pass recipient (shown visually during aim)
        this.passTarget = null;

        this.rink    = new Rink();
        this.puck    = new Puck(this.rink.w / 2, this.rink.h / 2);
        this.players = [];
        this.controlledIdx = -1;

        this.sfx       = new SFX();
        this.particles = new ParticleSystem();

        this._setupMatch();

        this.input  = new InputManager(this.canvas);
        this.engine = new GameEngine(dt => this._update(dt), alpha => this._render(alpha));

        this.input.onRelease = (vx, vy, mag) => {
            this.sfx.resume();
            this._handleRelease(vx, vy, mag);
        };

        this._resize();
        window.addEventListener('resize', () => this._resize());
        document.addEventListener('touchmove', e => e.preventDefault(), { passive: false });
        document.addEventListener('gesturestart', e => e.preventDefault());

        document.getElementById('pause-btn').addEventListener('pointerdown', e => {
            e.stopPropagation(); this._togglePause();
        });

        this.canvas.addEventListener('pointerdown', () => {
            this.sfx.resume();
            if (this.gameState === 'MENU') this._startGame();
            else if (this.gameState === 'GAMEOVER') {
                this._newGame();
            }
        });

        this.engine.start();
    }

    // ─── Setup ──────────────────────────────────────────────────────────────────
    _setupMatch() {
        this.players = [];
        const cx = this.rink.w / 2, cy = this.rink.h / 2;

        // Team 0 (red, human) — attacks top goal
        this.players.push(new Player(cx,       cy + 55,  0, 99));        // center  → i=0
        this.players.push(new Player(cx - 110, cy + 120, 0, 8));         // LW      → i=1
        this.players.push(new Player(cx + 110, cy + 120, 0, 19));        // RW      → i=2
        this.players.push(new Player(cx, this.rink.goalLineY1 - 50, 0, 31, true)); // GK → i=3

        // Team 1 (blue, AI) — attacks bottom goal
        this.players.push(new Player(cx,       cy - 55,  1, 87));        // center  → i=4
        this.players.push(new Player(cx - 110, cy - 120, 1, 71));        // LW      → i=5
        this.players.push(new Player(cx + 110, cy - 120, 1, 58));        // RW      → i=6
        this.players.push(new Player(cx, this.rink.goalLineY0 + 50, 1, 30, true)); // GK → i=7

        this._resetPositions();
    }

    _resetPositions() {
        const cx = this.rink.w / 2, cy = this.rink.h / 2;
        this.puck.pos = { x: cx, y: cy }; this.puck.vel = { x: 0, y: 0 };
        this.puck.carrier = null; this.puck.trail = [];

        const starts = [
            {x:cx, y:cy+55}, {x:cx-110, y:cy+120}, {x:cx+110, y:cy+120},
            {x:cx, y:this.rink.goalLineY1-50},
            {x:cx, y:cy-55}, {x:cx-110, y:cy-120}, {x:cx+110, y:cy-120},
            {x:cx, y:this.rink.goalLineY0+50},
        ];
        this.players.forEach((p, i) => {
            p.pos = { ...starts[i] }; p.vel = { x: 0, y: 0 };
            p.hasPuck = false; p.stunTimer = 0; p.hitFlash = 0;
        });
        this.tackleTimer = 0;
        this.joystickHeld = 0;
        this.passTarget = null;
        this._autoSwitch();
    }

    _startGame() {
        this.scores = [0, 0]; this.shots = [0, 0];
        this.period = 1; this.clockTime = PERIOD_DURATION;
        this._updateScoreUI(); this._updateClockUI();
        this.gameState = 'PLAYING';
        this.sfx.whistle();
    }

    _newGame() {
        document.getElementById('goal-overlay').classList.add('hidden');
        this._resetPositions();
        this._startGame();
    }

    _resize() {
        const W = 360, H = Math.round(W * (window.innerHeight / window.innerWidth));
        if (this.canvas.width !== W || this.canvas.height !== H) {
            this.canvas.width = W; this.canvas.height = H;
        }
        this.vw = W; this.vh = H;
    }

    _togglePause() {
        if (this.gameState === 'PLAYING') { this.gameState = 'PAUSED'; this.engine.stop(); }
        else if (this.gameState === 'PAUSED') { this.gameState = 'PLAYING'; this.engine.start(); }
    }

    _updateScoreUI() {
        document.getElementById('score-home').textContent = this.scores[0];
        document.getElementById('score-away').textContent = this.scores[1];
        document.getElementById('shots-home').textContent = this.shots[0];
        document.getElementById('shots-away').textContent = this.shots[1];
    }

    _updateClockUI() {
        const t = Math.max(0, Math.ceil(this.clockTime));
        document.getElementById('clock').textContent  = Math.floor(t/60) + ':' + String(t%60).padStart(2,'0');
        document.getElementById('period').textContent = ['1ST','2ND','3RD','OT'][Math.min(this.period-1,3)];
    }

    // ─── INPUT / RELEASE ────────────────────────────────────────────────────────
    //
    // SHOOTING: release joystick when you HAVE the puck.
    //   • Quick tap (<0.25s) + long range = wrist shot
    //   • Held (>0.5s) = slap shot (stronger, particles + sound)
    //
    // PASSING: if a teammate is within 45° of aim direction → pass to them
    //
    // TACKLING: release joystick when you DON'T have puck → lunge in that direction
    //   • Has a cooldown (TACKLE_COOLDOWN) to prevent spam
    //   • Lunge lasts ~0.25s before friction stops player
    //
    _handleRelease(vx, vy, mag) {
        if (this.gameState !== 'PLAYING') return;
        const cp = this.players[this.controlledIdx];
        if (!cp) return;

        if (cp.hasPuck) {
            // ── PASS or SHOOT ──────────────────────────────────
            // 1. Check if we're aiming at a teammate
            if (this.passTarget) {
                this._executePass(cp, this.passTarget);
                this.passTarget = null;
                this.joystickHeld = 0;
                return;
            }

            // 2. Determine shot power from hold time
            const held = this.joystickHeld;
            const power = held < 0.25
                ? WRIST_POWER                                  // wrist shot
                : WRIST_POWER + (SLAP_POWER - WRIST_POWER) * Math.min((held - 0.25) / 0.5, 1); // charged

            this._executeShot(cp, vx, vy, power);
            this.joystickHeld = 0;
            this.passTarget = null;
        } else {
            // ── TACKLE / DASH ──────────────────────────────────
            if (this.tackleTimer > 0) return; // still cooling down

            // Look for an opponent in the aimed direction, within range
            let target = null, bestDot = 0.55, bestDist = 220;
            this.players.forEach(q => {
                if (q.team === 0) return;
                const ox = q.pos.x - cp.pos.x, oy = q.pos.y - cp.pos.y;
                const od = Math.sqrt(ox*ox + oy*oy);
                if (od > bestDist) return;
                const dot = (vx*ox + vy*oy) / (od || 1);
                if (dot > bestDot) { bestDot = dot; bestDist = od; target = q; }
            });

            if (target) {
                // Lunge
                cp.vel.x = vx * TACKLE_SPEED;
                cp.vel.y = vy * TACKLE_SPEED;
                cp.tackling = true;
                cp.tackleFrames = 8; // frames of active hitbox
                this.tackleTimer = TACKLE_COOLDOWN;
                this.sfx.tackle();

                // Skate particles
                this.particles.emit(cp.pos.x, cp.pos.y, 8, {
                    colors: ['#aaddff','#fff'],
                    angle: Math.atan2(-vy, -vx), spread: 0.6,
                    minSpd: 2, maxSpd: 6, minDecay: 0.04, maxDecay: 0.09,
                });
            } else {
                // Skate burst (quick dash, no cooldown)
                cp.vel.x += vx * 8;
                cp.vel.y += vy * 8;
                this.particles.emit(cp.pos.x, cp.pos.y, 4, {
                    colors: ['#aaddff','#cef'],
                    angle: Math.atan2(-vy, -vx), spread: 0.5,
                    minSpd: 1, maxSpd: 3, minDecay: 0.06, maxDecay: 0.12,
                });
            }
        }
    }

    _executeShot(cp, vx, vy, power) {
        this.shots[0]++;
        document.getElementById('shots-home').textContent = this.shots[0];

        const charged = power > WRIST_POWER + 2;
        charged ? this.sfx.slapShot() : this.sfx.wristShot();

        // Add player velocity contribution (more realistic)
        this.puck.vel.x = cp.vel.x * 0.3 + vx * power;
        this.puck.vel.y = cp.vel.y * 0.3 + vy * power;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 3);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 3);
        cp.hasPuck = false;
        this.puck.carrier = null;

        // Ice spray
        const shotAngle = Math.atan2(vy, vx);
        this.particles.emit(cp.pos.x, cp.pos.y, charged ? 20 : 10, {
            colors: ['#c8e8ff','#fff','#aad8f8'],
            angle: shotAngle + Math.PI, spread: 0.7,
            minSpd: charged ? 3 : 1, maxSpd: charged ? 9 : 5,
            minDecay: 0.03, maxDecay: 0.07,
        });
    }

    _executePass(cp, target) {
        const dx = target.pos.x - cp.pos.x, dy = target.pos.y - cp.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        const vx = dx/d, vy = dy/d;

        this.sfx.pass();

        this.puck.vel.x = cp.vel.x * 0.2 + vx * PASS_POWER;
        this.puck.vel.y = cp.vel.y * 0.2 + vy * PASS_POWER;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 3);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 3);
        cp.hasPuck = false;
        this.puck.carrier = null;
    }

    // ─── AUTO-SWITCH ────────────────────────────────────────────────────────────
    // Priority: puck carrier > closest unstunned skater to puck
    _autoSwitch() {
        // If any team-0 skater has puck, control them immediately
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team === 0 && p.hasPuck && !p.isGoalie) { this._setControlled(i); return; }
        }
        // Otherwise, nearest team-0 skater to puck
        let best = -1, bestD = Infinity;
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team !== 0 || p.isGoalie) continue;
            const dx = p.pos.x - this.puck.pos.x, dy = p.pos.y - this.puck.pos.y;
            const d = dx*dx + dy*dy;
            if (d < bestD) { bestD = d; best = i; }
        }
        this._setControlled(best);
    }

    _setControlled(idx) {
        if (idx === this.controlledIdx) return;
        this.controlledIdx = idx;
        // Reset joystick charge on switch
        this.joystickHeld = 0;
        this.passTarget = null;
    }

    // ─── UPDATE ─────────────────────────────────────────────────────────────────
    _update(dt) {
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

        // Clock
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
        if (this.clockTime < 10 && Math.floor(this.clockTime * 10) % 10 === 0) this.sfx.tick();

        // Shake decay
        this.shake.power *= 0.82;
        this.shake.x = (Math.random() - 0.5) * this.shake.power;
        this.shake.y = (Math.random() - 0.5) * this.shake.power;

        // Timers
        if (this.tackleTimer > 0) this.tackleTimer -= dt;

        // ── 1. HUMAN CONTROLLED PLAYER INPUT ──────────────────────────────────
        const cp = this.players[this.controlledIdx];
        if (cp) {
            const js = this.input.joystick;

            if (js.active) {
                // Acceleration: proportional to joystick magnitude
                // Higher force when turning toward puck without puck
                const accel = cp.hasPuck ? 1.6 : 2.0;
                cp.applyForce(js.vx * js.mag * accel, js.vy * js.mag * accel);

                // Track how long joystick has been active while holding puck
                if (cp.hasPuck) {
                    this.joystickHeld += dt;
                    // Emit charge particles when charging a slap shot
                    if (this.joystickHeld > 0.4 && Math.random() < 0.3) {
                        this.sfx.charge(Math.min((this.joystickHeld - 0.4) / 0.4, 1));
                        this.particles.emit(this.puck.pos.x, this.puck.pos.y, 2, {
                            colors: ['#ffe500','#ff8800'],
                            minSpd: 0.5, maxSpd: 2.5,
                            minDecay: 0.06, maxDecay: 0.12,
                        });
                    }

                    // Find best pass target in aimed direction (preview)
                    let bestMate = null, bestDot = 0.78;
                    this.players.forEach(q => {
                        if (q.team !== 0 || q === cp || q.isGoalie) return;
                        const mx = q.pos.x - cp.pos.x, my = q.pos.y - cp.pos.y;
                        const md = Math.sqrt(mx*mx + my*my) || 1;
                        const dot = (js.vx * mx + js.vy * my) / md;
                        if (dot > bestDot) { bestDot = dot; bestMate = q; }
                    });
                    this.passTarget = bestMate;
                }
            } else {
                // Joystick released: reset held time if we didn't shoot already
                // (the release callback handles the actual action)
                if (!cp.hasPuck) this.joystickHeld = 0;
                this.passTarget = null;
            }
        }

        // ── 2. AI ─────────────────────────────────────────────────────────────
        this._updateAI();

        // ── 3. PHYSICS ────────────────────────────────────────────────────────
        this.players.forEach(p => p.update(dt));
        if (!this.puck.carrier) this.puck.update(dt);

        // ── 4. CONFINE ────────────────────────────────────────────────────────
        this.rink.confine(this.puck);
        this.players.forEach(p => this.rink.confine(p));

        // ── 5. COLLISIONS ─────────────────────────────────────────────────────
        this._resolveCollisions();

        // ── 6. PUCK CARRIER ───────────────────────────────────────────────────
        this._updateCarrier();

        // ── 7. GOAL ───────────────────────────────────────────────────────────
        const scored = this.rink.checkGoal(this.puck);
        if (scored !== -1) this._handleGoal(scored);

        // ── 8. AUTO-SWITCH (periodic) ─────────────────────────────────────────
        this.switchTimer -= dt;
        if (this.switchTimer <= 0) { this.switchTimer = SWITCH_INTERVAL; this._autoSwitch(); }

        // ── 9. PARTICLES ──────────────────────────────────────────────────────
        this.particles.update();
    }

    // ─── AI ─────────────────────────────────────────────────────────────────────
    _updateAI() {
        const cx   = this.rink.w / 2;
        const t0HP = this.players.some(p => p.team === 0 && p.hasPuck);
        const t1HP = this.players.some(p => p.team === 1 && p.hasPuck);
        const attackY0 = this.rink.goalLineY0; // team0 attacks top (y=small)
        const attackY1 = this.rink.goalLineY1; // team1 attacks bottom (y=large)

        this.players.forEach((p, i) => {
            if (i === this.controlledIdx) return;

            // ── Goalie AI ──────────────────────────────────────────────────────
            if (p.isGoalie) {
                const myLineY = p.team === 0 ? attackY1 : attackY0;
                const offset  = p.team === 0 ? -40 : 40;
                // Track puck X, clamped to goal width
                const hw = this.rink.goalW * 0.42;
                const tx = Math.max(cx - hw, Math.min(cx + hw, this.puck.pos.x));
                p._arrive(tx, myLineY + offset, 30);
                return;
            }

            // ── Team 1 (AI opponents) ──────────────────────────────────────────
            if (p.team === 1) {
                if (p.hasPuck) {
                    // Move toward player's goal (bottom), juke slightly
                    const juke = Math.sin(Date.now() * 0.002 + i) * 40;
                    p._seek(cx + juke, attackY1);

                    // Shoot when past halfway and in good range
                    const dyToGoal = attackY1 - p.pos.y;
                    if (dyToGoal < 250 && Math.random() < 0.02) {
                        this._aiShoot(p, cx, attackY1);
                    }
                } else if (t1HP) {
                    // Support: run into open ice near puck
                    const laneX = cx + (i % 2 === 0 ? -100 : 100);
                    p._arrive(laneX, this.puck.pos.y - 60, 80);
                } else {
                    // Pressure: chase puck, collapse to own end if far
                    const dx = this.puck.pos.x - p.pos.x, dy = this.puck.pos.y - p.pos.y;
                    const d2 = dx*dx + dy*dy;
                    if (d2 < 220*220) {
                        p._seek(this.puck.pos.x, this.puck.pos.y);
                    } else {
                        p._arrive(cx + (i % 2 === 0 ? -80 : 80), attackY0 + 120, 80);
                    }
                }
            }

            // ── Team 0 non-controlled skaters ─────────────────────────────────
            else {
                if (t0HP) {
                    // Support carrier: open lane in attacking zone
                    const laneX = cx + (i % 2 === 0 ? -110 : 110);
                    p._arrive(laneX, attackY0 + 120, 90);
                } else {
                    // Chase puck but slower than the controlled player
                    const dx = this.puck.pos.x - p.pos.x, dy = this.puck.pos.y - p.pos.y;
                    const d = Math.sqrt(dx*dx + dy*dy) || 1;
                    p.applyForce((dx/d) * 0.45, (dy/d) * 0.45);
                }
            }
        });
    }

    _aiShoot(p, tx, ty) {
        this.shots[1]++;
        document.getElementById('shots-away').textContent = this.shots[1];
        this.sfx.wristShot();
        const dx = tx - p.pos.x, dy = ty - p.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        const power = 9 + Math.random() * 4;
        this.puck.vel.x = p.vel.x * 0.2 + (dx/d) * power;
        this.puck.vel.y = p.vel.y * 0.2 + (dy/d) * power;
        this.puck.pos.x = p.pos.x + (dx/d) * (p.radius + this.puck.radius + 3);
        this.puck.pos.y = p.pos.y + (dy/d) * (p.radius + this.puck.radius + 3);
        p.hasPuck = false;
        this.puck.carrier = null;
    }

    // ─── COLLISIONS ─────────────────────────────────────────────────────────────
    _resolveCollisions() {
        for (let i = 0; i < this.players.length; i++) {
            for (let j = i + 1; j < this.players.length; j++) {
                const a = this.players[i], b = this.players[j];
                const hit = resolveCircleCollision(a, b);

                if (hit && a.team !== b.team) {
                    const spdA = Math.sqrt(a.vel.x**2 + a.vel.y**2);
                    const spdB = Math.sqrt(b.vel.x**2 + b.vel.y**2);

                    // Check if either player is in active tackle frames
                    const aChecking = a.tackleFrames > 0;
                    const bChecking = b.tackleFrames > 0;

                    // Dislodge if: (checking player hits carrier) OR (fast enough body check)
                    if (b.hasPuck && (aChecking || spdA > CHECK_THRESHOLD)) {
                        this._dislodge(b, a);
                    } else if (a.hasPuck && (bChecking || spdB > CHECK_THRESHOLD)) {
                        this._dislodge(a, b);
                    } else if (hit) {
                        // Soft bump
                        const mx = (a.pos.x+b.pos.x)/2, my = (a.pos.y+b.pos.y)/2;
                        this.particles.emit(mx, my, 4, {
                            colors: ['#fff','#ddd'],
                            minSpd: 1, maxSpd: 2.5, minDecay: 0.06, maxDecay: 0.12,
                        });
                    }
                }
            }

            // Player vs loose puck
            const p = this.players[i];
            if (this.puck.carrier !== p) {
                resolveCircleCollision(p, this.puck);
            }
        }
    }

    _dislodge(carrier, hitter) {
        carrier.hasPuck   = false;
        carrier.stunTimer = 1.0;
        carrier.hitFlash  = 0.5;
        hitter.hitFlash   = 0.2;
        this.puck.carrier = null;

        // Puck bounces in hit direction + some randomness
        const dx = carrier.pos.x - hitter.pos.x, dy = carrier.pos.y - hitter.pos.y;
        const d  = Math.sqrt(dx*dx+dy*dy) || 1;
        const power = Math.sqrt(hitter.vel.x**2+hitter.vel.y**2);
        this.puck.vel.x = (dx/d) * power * 0.6 + (Math.random()-0.5) * 3;
        this.puck.vel.y = (dy/d) * power * 0.6 + (Math.random()-0.5) * 3;

        this.sfx.hit(Math.min(power / 10, 1));
        this.shake.power = 8;

        this.particles.emit(carrier.pos.x, carrier.pos.y, 18, {
            colors: ['#fff','#ffd700','#ffaa00'],
            minSpd: 2, maxSpd: 8, minDecay: 0.03, maxDecay: 0.07,
        });

        this._autoSwitch();
    }

    // ─── PUCK CARRIER ───────────────────────────────────────────────────────────
    _updateCarrier() {
        if (this.puck.carrier) {
            const c = this.puck.carrier;
            // Puck stays just ahead of the player in their facing direction
            const stickR = c.radius + this.puck.radius;
            this.puck.pos.x = c.pos.x + Math.cos(c.angle) * stickR;
            this.puck.pos.y = c.pos.y + Math.sin(c.angle) * stickR;
            this.puck.vel.x = 0; this.puck.vel.y = 0;
            this.puck.trail = [];
        } else {
            // Pickup check: slightly generous radius (PICKUP_BONUS)
            for (const p of this.players) {
                if (p.stunTimer > 0) continue;
                const dx = p.pos.x - this.puck.pos.x, dy = p.pos.y - this.puck.pos.y;
                const pickR = p.radius + this.puck.radius + PICKUP_BONUS;
                if (dx*dx + dy*dy < pickR*pickR) {
                    this.puck.carrier = p;
                    p.hasPuck = true;
                    this.sfx.pickup();

                    // Immediate switch if team 0 picks it up
                    if (p.team === 0) {
                        // Find index of this player
                        const idx = this.players.indexOf(p);
                        if (!p.isGoalie) this._setControlled(idx);
                    }
                    this._autoSwitch();
                    break;
                }
            }
        }

        // Tick down tackle frames
        this.players.forEach(p => { if (p.tackleFrames > 0) p.tackleFrames--; });
    }

    // ─── GOAL ───────────────────────────────────────────────────────────────────
    _handleGoal(teamScored) {
        this.gameState = 'GOAL';
        this.goalTimer = 3.5;
        this.scores[teamScored]++;
        this._updateScoreUI();
        this.sfx.goal();
        this.shake.power = 20;

        if (this.puck.carrier) { this.puck.carrier.hasPuck = false; this.puck.carrier = null; }

        this.particles.emit(this.puck.pos.x, this.puck.pos.y, 70, {
            colors: teamScored === 0
                ? ['#e74c3c','#fff','#c0392b','#ffd700','#ff6b6b']
                : ['#2471a3','#fff','#1a5276','#ffd700','#74b9ff'],
            minSpd: 3, maxSpd: 14, minDecay: 0.012, maxDecay: 0.03, gravity: 0.08,
        });

        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        gt.textContent = teamScored === 0 ? 'GOAL! 🚨' : 'OPPONENT SCORES!';
        gt.style.color = teamScored === 0 ? '#e74c3c' : '#3498db';
        ov.classList.remove('hidden');
    }

    _showGameOver() {
        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        const [h, a] = this.scores;
        if      (h > a) { gt.textContent = 'YOU WIN! 🏆'; gt.style.color = '#2ecc71'; }
        else if (a > h) { gt.textContent = 'YOU LOSE 😔'; gt.style.color = '#e74c3c'; }
        else            { gt.textContent = 'TIE GAME!';    gt.style.color = '#fff'; }
        ov.classList.remove('hidden');
        this.sfx.whistle();
        // Show subtitle
        const sub = ov.querySelector('.goal-sub') || (() => {
            const d = document.createElement('div');
            d.className = 'goal-sub';
            d.style.cssText = 'color:rgba(255,255,255,0.6);font-size:14px;margin-top:16px;font-family:Oswald,sans-serif;letter-spacing:1px';
            ov.appendChild(d); return d;
        })();
        sub.textContent = `${h} – ${a}  •  TAP TO PLAY AGAIN`;
    }

    // ─── RENDER ─────────────────────────────────────────────────────────────────
    _render(alpha) {
        const ctx = this.ctx;
        const vw = this.vw, vh = this.vh;

        if (this.gameState === 'MENU') { this._renderMenu(ctx, vw, vh); return; }

        // Camera
        const tCX = this.puck.pos.x - vw / 2;
        const tCY = this.puck.pos.y - vh / 2;
        this.cam.x += (Math.max(0, Math.min(tCX, this.rink.w - vw)) - this.cam.x) * 0.12;
        this.cam.y += (Math.max(0, Math.min(tCY, this.rink.h - vh)) - this.cam.y) * 0.12;

        ctx.clearRect(0, 0, vw, vh);
        ctx.save();
        ctx.translate(-Math.round(this.cam.x) + this.shake.x, -Math.round(this.cam.y) + this.shake.y);

        this.rink.render(ctx);

        // ── Aiming line ──────────────────────────────────────────────────────
        const cp = this.players[this.controlledIdx];
        if (cp && cp.hasPuck && this.input.joystick.active && this.input.joystick.mag > 0.1) {
            const { vx, vy } = this.input.joystick;
            const lineLen = 160;
            const ax = this.puck.pos.x + vx * lineLen, ay = this.puck.pos.y + vy * lineLen;
            const isPass = !!this.passTarget;
            const charged = this.joystickHeld > 0.4;

            ctx.save();
            const aimColor = isPass ? '#3498db' : (charged ? '#ff8800' : '#2ecc71');
            ctx.shadowBlur = 16; ctx.shadowColor = aimColor;
            ctx.strokeStyle = aimColor + 'cc';
            ctx.lineWidth = isPass ? 2 : 2.5;
            ctx.setLineDash([10, 7]);
            ctx.beginPath();
            ctx.moveTo(this.puck.pos.x, this.puck.pos.y);
            ctx.lineTo(ax, ay);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;

            // Arrowhead
            const ang = Math.atan2(vy, vx);
            ctx.fillStyle = aimColor;
            ctx.beginPath();
            ctx.moveTo(ax, ay);
            ctx.lineTo(ax - Math.cos(ang-0.42)*13, ay - Math.sin(ang-0.42)*13);
            ctx.lineTo(ax - Math.cos(ang+0.42)*13, ay - Math.sin(ang+0.42)*13);
            ctx.closePath(); ctx.fill();

            // Shot power meter (arc around puck) when charging
            if (charged && !isPass) {
                const chargeT = Math.min((this.joystickHeld - 0.4) / 0.5, 1);
                ctx.beginPath();
                ctx.arc(this.puck.pos.x, this.puck.pos.y, 14, -Math.PI/2, -Math.PI/2 + chargeT * Math.PI * 2);
                ctx.strokeStyle = chargeT > 0.8 ? '#ff4444' : '#ff8800';
                ctx.lineWidth = 3;
                ctx.stroke();
            }

            ctx.restore();
        }

        // ── Pass target highlight ────────────────────────────────────────────
        if (this.passTarget) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.passTarget.pos.x, this.passTarget.pos.y, this.passTarget.radius + 12, 0, Math.PI * 2);
            ctx.strokeStyle = '#3498db';
            ctx.lineWidth = 2.5;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();
        }

        // ── Players ──────────────────────────────────────────────────────────
        [...this.players]
            .sort((a,b) => a.pos.y - b.pos.y)
            .forEach(p => p.render(ctx, this.players.indexOf(p) === this.controlledIdx));

        // ── Puck ─────────────────────────────────────────────────────────────
        this.puck.render(ctx);

        // ── Particles ────────────────────────────────────────────────────────
        this.particles.render(ctx);

        ctx.restore();

        // ── Tackle cooldown arc (HUD, screen space) ──────────────────────────
        if (this.tackleTimer > 0 && cp && !cp.hasPuck) {
            // Convert player world pos to screen
            const sx = cp.pos.x - this.cam.x;
            const sy = cp.pos.y - this.cam.y;
            const t = 1 - (this.tackleTimer / TACKLE_COOLDOWN);
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, cp.radius + 16, -Math.PI/2, -Math.PI/2 + t * Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,100,100,0.8)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
        }

        // ── Joystick ─────────────────────────────────────────────────────────
        this.input.renderJoystick(ctx);

        // ── Pause overlay ────────────────────────────────────────────────────
        if (this.gameState === 'PAUSED') {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(0, 0, vw, vh);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 40px Oswald';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText('PAUSED', vw/2, vh/2);
            ctx.font = '13px Oswald';
            ctx.fillStyle = 'rgba(255,255,255,0.5)';
            ctx.fillText('Tap ❚❚ to resume', vw/2, vh/2 + 36);
            ctx.restore();
        }
    }

    _renderMenu(ctx, vw, vh) {
        const bg = ctx.createLinearGradient(0, 0, 0, vh);
        bg.addColorStop(0, '#080812'); bg.addColorStop(1, '#0b1828');
        ctx.fillStyle = bg; ctx.fillRect(0, 0, vw, vh);

        // Mini rink preview
        ctx.save();
        const sc = vw / this.rink.w * 0.82;
        ctx.translate(vw/2, vh * 0.38);
        ctx.scale(sc, sc);
        ctx.translate(-this.rink.w/2, -this.rink.h/2);
        this.rink.render(ctx);
        ctx.restore();
        ctx.fillStyle = 'rgba(0,0,0,0.52)'; ctx.fillRect(0, 0, vw, vh);

        ctx.save();
        ctx.textAlign = 'center';

        // Logo
        ctx.shadowBlur = 28; ctx.shadowColor = '#2471a3';
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 52px Oswald';
        ctx.fillText('ARCADE', vw/2, vh * 0.21);
        ctx.fillStyle = '#3498db'; ctx.shadowColor = '#3498db';
        ctx.fillText('HOCKEY', vw/2, vh * 0.21 + 52);
        ctx.shadowBlur = 0;

        const pulse = 0.78 + 0.22 * Math.sin(Date.now() * 0.004);
        ctx.globalAlpha = pulse;
        const bw=220, bh=50, bx=vw/2-bw/2, by=vh*0.71;
        ctx.fillStyle = '#2471a3';
        ctx.beginPath();
        ctx.moveTo(bx+14,by); ctx.lineTo(bx+bw-14,by);
        ctx.arcTo(bx+bw,by,bx+bw,by+14,14);
        ctx.lineTo(bx+bw,by+bh-14);
        ctx.arcTo(bx+bw,by+bh,bx+bw-14,by+bh,14);
        ctx.lineTo(bx+14,by+bh);
        ctx.arcTo(bx,by+bh,bx,by+bh-14,14);
        ctx.lineTo(bx,by+14);
        ctx.arcTo(bx,by,bx+14,by,14);
        ctx.closePath(); ctx.fill();

        ctx.globalAlpha = 1;
        ctx.fillStyle = '#fff'; ctx.font = 'bold 22px Oswald';
        ctx.textBaseline = 'middle';
        ctx.fillText('TAP TO PLAY', vw/2, by + bh/2);

        ctx.font = '11px Oswald'; ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fillText('Joystick left  ·  Release to shoot / pass  ·  Swipe to tackle', vw/2, vh*0.88);
        ctx.restore();
    }
}

window.addEventListener('load', () => new Game());
