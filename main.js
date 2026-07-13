import { GameEngine, InputManager } from './engine.js';
import { Rink, Player, Puck }       from './entities.js';
import { resolveCircleCollision }   from './physics.js';

import { SFX } from './audio.js';
import { ParticleSystem } from './particles.js';
import { GameAI } from './ai.js';
import { StorageManager } from './storage.js';

// ─── CONSTANTS ─────────────────────────────────────────────────────────────────
const PERIOD_DURATION = 180; // 3 minutes per period
const NUM_PERIODS     = 3;
const SWITCH_INTERVAL = 0.25;

const WRIST_POWER     = 12;
const SLAP_POWER      = 20;
const PASS_POWER      = 13;
const PICKUP_BONUS    = 12;
const TACKLE_SPEED    = 22;
const TACKLE_COOLDOWN = 1.0;
const CHECK_THRESHOLD = 4.5;

// Team config
const TEAMS = [
    { name: 'EAGLES', abbr: 'EAG', emoji: '🦅', color: '#e74c3c', dark: '#8B0000', jersey: '#c0392b', trim: '#e74c3c', helmet: '#7B0000' },
    { name: 'WOLVES',  abbr: 'WLV', emoji: '🐺', color: '#3498db', dark: '#0a2f4e', jersey: '#1a5276', trim: '#2471a3', helmet: '#0a2f4e' },
];

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
        this.periodBannerTimer = 0;

        this.tackleTimer   = 0;
        this.joystickHeld  = 0;
        this.passTarget = null;

        // Button action state
        this.btnShootPressed = false;
        this.btnPassPressed  = false;
        this.btnHitPressed   = false;

        this.rink    = new Rink();
        this.puck    = new Puck(this.rink.w / 2, this.rink.h / 2);
        this.players = [];
        this.controlledIdx = -1;

        this.sfx       = new SFX();
        this.particles = new ParticleSystem();
        this.ai        = new GameAI(this);
        this.storage   = new StorageManager();

        // Last scorer name for goal overlay
        this.lastScorerName = '';

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
            if (this.gameState === 'GAMEOVER') this._newGame();
        });

        this._initMenuUI();

        // Action buttons
        this._setupActionButtons();

        this._updateScoreUI();
        this._updateClockUI();

        this.engine.start();
    }

    _initMenuUI() {
        document.getElementById('btn-play').addEventListener('click', () => {
            this.sfx.resume();
            this.sfx.buttonPress();
            document.getElementById('start-menu').classList.add('hidden');
            this._showTeamSelection();
        });

        document.getElementById('btn-start-match').addEventListener('click', (e) => {
            if (e.target.classList.contains('disabled')) return;
            this.sfx.buttonPress();
            document.getElementById('team-selection').classList.add('hidden');
            document.getElementById('ui-layer').classList.remove('hidden');
            this._startGame();
        });
    }

    _showTeamSelection() {
        const container = document.getElementById('team-cards');
        container.innerHTML = '';
        
        TEAMS.forEach((team, idx) => {
            const card = document.createElement('div');
            card.className = `team-card ${idx === this.storage.data.lastTeamIndex ? 'selected' : ''}`;
            card.innerHTML = `<div class="emoji">${team.emoji}</div><div class="name">${team.name}</div>`;
            card.onclick = () => {
                document.querySelectorAll('.team-card').forEach(c => c.classList.remove('selected'));
                card.classList.add('selected');
                this.storage.data.lastTeamIndex = idx;
                this.storage.save();
                this.sfx.buttonPress();
                this._setupMatch(); // Refresh the teams
            };
            container.appendChild(card);
        });

        document.getElementById('btn-start-match').classList.remove('disabled');
        document.getElementById('team-selection').classList.remove('hidden');
    }
    _setupActionButtons() {
        const btnShoot = document.getElementById('btn-shoot');
        const btnPass  = document.getElementById('btn-pass');
        const btnHit   = document.getElementById('btn-hit');

        const handleBtn = (btn, action) => {
            btn.addEventListener('pointerdown', e => {
                e.stopPropagation();
                this.sfx.resume();
                this.sfx.buttonPress();
                if (this.gameState !== 'PLAYING') return;
                action();
            });
        };

        handleBtn(btnShoot, () => {
            const cp = this.players[this.controlledIdx];
            if (!cp || !cp.hasPuck) return;
            // Auto-aim shoot toward opponent goal
            const goalY = this.rink.goalLineY0; // team0 attacks top
            const goalX = this.rink.w / 2;
            const dx = goalX - cp.pos.x, dy = goalY - cp.pos.y;
            const d = Math.sqrt(dx*dx+dy*dy) || 1;
            this._executeShot(cp, dx/d, dy/d, WRIST_POWER + 2);
        });

        handleBtn(btnPass, () => {
            const cp = this.players[this.controlledIdx];
            if (!cp || !cp.hasPuck) return;
            // Find best open teammate
            let best = null, bestScore = -Infinity;
            this.players.forEach(q => {
                if (q.team !== 0 || q === cp || q.isGoalie) return;
                // Prefer teammates closer to the opponent goal
                const goalDist = Math.abs(q.pos.y - this.rink.goalLineY0);
                const score = -goalDist;
                if (score > bestScore) { bestScore = score; best = q; }
            });
            if (best) this._executePass(cp, best);
        });

        handleBtn(btnHit, () => {
            const cp = this.players[this.controlledIdx];
            if (!cp || cp.hasPuck || this.tackleTimer > 0) return;
            // Find closest opponent
            let target = null, bestDist = 200;
            this.players.forEach(q => {
                if (q.team === 0 || q.isGoalie) return;
                const dx = q.pos.x - cp.pos.x, dy = q.pos.y - cp.pos.y;
                const d = Math.sqrt(dx*dx+dy*dy);
                if (d < bestDist) { bestDist = d; target = q; }
            });
            if (target) {
                const dx = target.pos.x - cp.pos.x, dy = target.pos.y - cp.pos.y;
                const d = Math.sqrt(dx*dx+dy*dy) || 1;
                cp.vel.x = (dx/d) * TACKLE_SPEED;
                cp.vel.y = (dy/d) * TACKLE_SPEED;
                cp.tackling = true;
                cp.tackleFrames = 10;
                this.tackleTimer = TACKLE_COOLDOWN;
                this.sfx.tackle();
                this.particles.emit(cp.pos.x, cp.pos.y, 10, {
                    colors: ['#aaddff','#fff'],
                    angle: Math.atan2(-dy/d, -dx/d), spread: 0.6,
                    minSpd: 2, maxSpd: 7, minDecay: 0.04, maxDecay: 0.09,
                });
            }
        });
    }

    // ─── Setup ──────────────────────────────────────────────────────────────────
    _setupMatch() {
        this.players = [];
        const cx = this.rink.w / 2, cy = this.rink.h / 2;

        const myTeamIdx = this.storage ? this.storage.data.lastTeamIndex : 0;
        let aiTeamIdx = Math.floor(Math.random() * TEAMS.length);
        if (aiTeamIdx === myTeamIdx) aiTeamIdx = (aiTeamIdx + 1) % TEAMS.length;

        const myTeam = TEAMS[myTeamIdx];
        const aiTeam = TEAMS[aiTeamIdx];

        // Team 0 (human) — attacks top goal (goalLineY0)
        this.players.push(new Player(cx,       cy + 55,  0, 99, false, myTeam, 'CENTER'));
        this.players.push(new Player(cx - 110, cy + 130, 0, 8,  false, myTeam, 'LW'));
        this.players.push(new Player(cx + 110, cy + 130, 0, 19, false, myTeam, 'RW'));
        this.players.push(new Player(cx, this.rink.goalLineY1 - 45, 0, 31, true, myTeam));

        // Team 1 (AI) — attacks bottom goal (goalLineY1)
        this.players.push(new Player(cx,       cy - 55,  1, 87, false, aiTeam, 'CENTER'));
        this.players.push(new Player(cx - 110, cy - 130, 1, 71, false, aiTeam, 'LW'));
        this.players.push(new Player(cx + 110, cy - 130, 1, 58, false, aiTeam, 'RW'));
        this.players.push(new Player(cx, this.rink.goalLineY0 + 45, 1, 30, true, aiTeam));

        this._resetPositions();
    }

    _resetPositions() {
        const cx = this.rink.w / 2, cy = this.rink.h / 2;
        this.puck.pos = { x: cx, y: cy }; this.puck.vel = { x: 0, y: 0 };
        this.puck.carrier = null; this.puck.trail = [];

        const starts = [
            {x:cx,       y:cy+55},  {x:cx-110, y:cy+130}, {x:cx+110, y:cy+130},
            {x:cx,       y:this.rink.goalLineY1-45},
            {x:cx,       y:cy-55},  {x:cx-110, y:cy-130}, {x:cx+110, y:cy-130},
            {x:cx,       y:this.rink.goalLineY0+45},
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
        this.gameState = 'FACEOFF';
        this.faceoffTimer = 2.0;
        this.puck.pos.x = this.rink.w / 2;
        this.puck.pos.y = this.rink.h / 2;
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

    _showPeriodBanner(text) {
        const banner = document.getElementById('period-banner');
        document.getElementById('pb-value').textContent = text;
        banner.classList.add('show');
        this.periodBannerTimer = 2.5;
    }

    // ─── INPUT / RELEASE ────────────────────────────────────────────────────────
    _handleRelease(vx, vy, mag) {
        if (this.gameState !== 'PLAYING') return;
        const cp = this.players[this.controlledIdx];
        if (!cp) return;

        if (cp.hasPuck) {
            // Pass or shoot
            if (this.passTarget) {
                this._executePass(cp, this.passTarget);
                this.passTarget = null;
                this.joystickHeld = 0;
                return;
            }

            const held = this.joystickHeld;
            const power = held < 0.25
                ? WRIST_POWER
                : WRIST_POWER + (SLAP_POWER - WRIST_POWER) * Math.min((held - 0.25) / 0.5, 1);

            this._executeShot(cp, vx, vy, power);
            this.joystickHeld = 0;
            this.passTarget = null;
        } else {
            // Tackle / dash
            if (this.tackleTimer > 0) return;

            let target = null, bestDot = 0.5, bestDist = 240;
            this.players.forEach(q => {
                if (q.team === 0) return;
                const ox = q.pos.x - cp.pos.x, oy = q.pos.y - cp.pos.y;
                const od = Math.sqrt(ox*ox + oy*oy);
                if (od > bestDist) return;
                const dot = (vx*ox + vy*oy) / (od || 1);
                if (dot > bestDot) { bestDot = dot; bestDist = od; target = q; }
            });

            if (target) {
                cp.vel.x = vx * TACKLE_SPEED;
                cp.vel.y = vy * TACKLE_SPEED;
                cp.tackling = true;
                cp.tackleFrames = 10;
                this.tackleTimer = TACKLE_COOLDOWN;
                this.sfx.tackle();

                this.particles.emit(cp.pos.x, cp.pos.y, 10, {
                    colors: ['#aaddff','#fff'],
                    angle: Math.atan2(-vy, -vx), spread: 0.6,
                    minSpd: 2, maxSpd: 7, minDecay: 0.04, maxDecay: 0.09,
                });
            } else {
                cp.vel.x += vx * 9;
                cp.vel.y += vy * 9;
                this.particles.emit(cp.pos.x, cp.pos.y, 5, {
                    colors: ['#aaddff','#cef'],
                    angle: Math.atan2(-vy, -vx), spread: 0.5,
                    minSpd: 1, maxSpd: 3.5, minDecay: 0.05, maxDecay: 0.1, shape: 'spark',
                });
            }
        }
    }

    _executeShot(cp, vx, vy, power) {
        this.shots[0]++;
        document.getElementById('shots-home').textContent = this.shots[0];

        const charged = power > WRIST_POWER + 2;
        charged ? this.sfx.slapShot() : this.sfx.wristShot();

        this.puck.vel.x = cp.vel.x * 0.3 + vx * power;
        this.puck.vel.y = cp.vel.y * 0.3 + vy * power;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 4);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 4);
        cp.hasPuck = false;
        this.puck.carrier = null;

        const shotAngle = Math.atan2(vy, vx);
        this.particles.emit(cp.pos.x, cp.pos.y, charged ? 22 : 12, {
            colors: ['#c8e8ff','#fff','#aad8f8'],
            angle: shotAngle + Math.PI, spread: 0.7,
            minSpd: charged ? 3 : 1.5, maxSpd: charged ? 10 : 6,
            minDecay: 0.03, maxDecay: 0.07, shape: 'spark',
        });
    }

    _executePass(cp, target) {
        const dx = target.pos.x - cp.pos.x, dy = target.pos.y - cp.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        const vx = dx/d, vy = dy/d;

        this.sfx.pass();

        this.puck.vel.x = cp.vel.x * 0.2 + vx * PASS_POWER;
        this.puck.vel.y = cp.vel.y * 0.2 + vy * PASS_POWER;
        this.puck.pos.x = cp.pos.x + vx * (cp.radius + this.puck.radius + 4);
        this.puck.pos.y = cp.pos.y + vy * (cp.radius + this.puck.radius + 4);
        cp.hasPuck = false;
        this.puck.carrier = null;

        // Pass line particles
        const steps = 5;
        for (let i = 1; i <= steps; i++) {
            const t = i / (steps + 1);
            this.particles.emit(
                cp.pos.x + dx * t, cp.pos.y + dy * t, 2,
                { colors: ['#3498db','#74b9ff'], minSpd: 0.3, maxSpd: 1.5, minDecay: 0.08, maxDecay: 0.15 }
            );
        }
    }

    // ─── AUTO-SWITCH ────────────────────────────────────────────────────────────
    _autoSwitch() {
        for (let i = 0; i < this.players.length; i++) {
            const p = this.players[i];
            if (p.team === 0 && p.hasPuck && !p.isGoalie) { this._setControlled(i); return; }
        }
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
        this.joystickHeld = 0;
        this.passTarget = null;
    }

    // ─── UPDATE ─────────────────────────────────────────────────────────────────
    _update(dt) {
        if (this.gameState === 'GOAL') {
            this.goalTimer -= dt;
            this.particles.update();
            if (this.goalTimer <= 0) {
                this.gameState = 'FACEOFF';
                this.faceoffTimer = 2.0;
                document.getElementById('goal-overlay').classList.add('hidden');
                this._resetPositions();
            }
            return;
        }
        
        if (this.gameState === 'FACEOFF') {
            this.faceoffTimer -= dt;
            this.particles.update();
            if (this.faceoffTimer <= 0) {
                this.gameState = 'PLAYING';
                this.sfx.whistle();
                // Add some initial random bounce to the puck on drop
                this.puck.vel.x = (Math.random() - 0.5) * 5;
                this.puck.vel.y = (Math.random() - 0.5) * 5;
            }
            return;
        }

        if (this.gameState !== 'PLAYING') return;

        // Period banner countdown
        if (this.periodBannerTimer > 0) {
            this.periodBannerTimer -= dt;
            if (this.periodBannerTimer <= 0) {
                document.getElementById('period-banner').classList.remove('show');
            }
        }

        // Clock
        this.clockTime -= dt;
        this._updateClockUI();
        if (this.clockTime <= 0) {
            if (this.period < NUM_PERIODS) {
                this.period++;
                this.clockTime = PERIOD_DURATION;
                this.sfx.periodEnd();
                this._resetPositions();
                this._updateClockUI();
                const labels = ['','1ST','2ND','3RD','OT'];
                this._showPeriodBanner(labels[Math.min(this.period, 4)]);
                setTimeout(() => this.sfx.whistle(), 600);
            } else {
                this.gameState = 'GAMEOVER';
                this._showGameOver();
                return;
            }
        }
        if (this.clockTime < 10 && Math.floor(this.clockTime * 10) % 10 === 0) this.sfx.tick();

        // Shake decay
        this.shake.power *= 0.8;
        this.shake.x = (Math.random() - 0.5) * this.shake.power;
        this.shake.y = (Math.random() - 0.5) * this.shake.power;

        if (this.tackleTimer > 0) this.tackleTimer -= dt;

        // ── 1. HUMAN CONTROLLED PLAYER INPUT ──────────────────────────────────
        const cp = this.players[this.controlledIdx];
        if (cp) {
            const js = this.input.joystick;

            if (js.active) {
                const accel = cp.hasPuck ? 1.7 : 2.2;
                cp.applyForce(js.vx * js.mag * accel, js.vy * js.mag * accel);
                cp.isSprinting = js.mag > 0.85 && cp.stamina > 0;

                // Skate scrape sound and ice spray on sharp turns
                const spd = Math.sqrt(cp.vel.x**2 + cp.vel.y**2);
                if (spd > 3.0 && js.mag > 0.5) {
                    const dot = (cp.vel.x * js.vx + cp.vel.y * js.vy) / spd;
                    if (dot < 0.2 && Math.random() < 0.25) {
                        this.sfx.skrape(1.0 - Math.max(0, dot));
                        this.particles.emit(cp.pos.x, cp.pos.y + 10, 2, {
                            colors: ['#fff', '#e0f0ff'], minSpd: 1, maxSpd: 3, minDecay: 0.05, maxDecay: 0.1
                        });
                    }
                }

                if (cp.hasPuck) {
                    this.joystickHeld += dt;
                    if (this.joystickHeld > 0.4 && Math.random() < 0.35) {
                        this.sfx.charge(Math.min((this.joystickHeld - 0.4) / 0.4, 1));
                        this.particles.emit(this.puck.pos.x, this.puck.pos.y, 2, {
                            colors: ['#ffe500','#ff8800'],
                            minSpd: 0.5, maxSpd: 3, minDecay: 0.06, maxDecay: 0.12,
                        });
                    }

                    // Pass target preview
                    let bestMate = null, bestDot = 0.4;
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
                if (!cp.hasPuck) this.joystickHeld = 0;
                this.passTarget = null;
                cp.isSprinting = false;
            }
        }

        // ── 2. AI ─────────────────────────────────────────────────────────────
        this.ai.update(dt);

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

        // ── 8. AUTO-SWITCH ────────────────────────────────────────────────────
        this.switchTimer -= dt;
        if (this.switchTimer <= 0) { this.switchTimer = SWITCH_INTERVAL; this._autoSwitch(); }

        // ── 9. PARTICLES ──────────────────────────────────────────────────────
        const puckSpd = Math.sqrt(this.puck.vel.x**2 + this.puck.vel.y**2);
        if (puckSpd > 14.0 && Math.random() < 0.8) {
            this.particles.emit(this.puck.pos.x, this.puck.pos.y, 1, {
                colors: ['#ff4500','#ff8c00','#ffd700', '#fff'],
                minSpd: 0.1, maxSpd: 1.5, minDecay: 0.05, maxDecay: 0.1, shape: 'spark'
            });
        }
        this.particles.update();
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

                    const aChecking = a.tackleFrames > 0;
                    const bChecking = b.tackleFrames > 0;

                    if (b.hasPuck && (aChecking || spdA > CHECK_THRESHOLD)) {
                        const canTackle = a.team === 0 || this._aiTackleCooldowns[this.players.indexOf(a)] === 0;
                        if (canTackle) {
                            this._dislodge(b, a);
                            if (a.team === 1) this._aiTackleCooldowns[this.players.indexOf(a)] = 2.0; // AI cooldown
                        }
                    } else if (a.hasPuck && (bChecking || spdB > CHECK_THRESHOLD)) {
                        const canTackle = b.team === 0 || this._aiTackleCooldowns[this.players.indexOf(b)] === 0;
                        if (canTackle) {
                            this._dislodge(a, b);
                            if (b.team === 1) this._aiTackleCooldowns[this.players.indexOf(b)] = 2.0; // AI cooldown
                        }
                    } else if (hit) {
                        const mx = (a.pos.x+b.pos.x)/2, my = (a.pos.y+b.pos.y)/2;
                        this.particles.emit(mx, my, 4, {
                            colors: ['#fff','#ddd'], minSpd: 1, maxSpd: 3, minDecay: 0.06, maxDecay: 0.12,
                        });
                    }
                }
            }

            const p = this.players[i];
            if (this.puck.carrier !== p) {
                resolveCircleCollision(p, this.puck);
            }
        }
    }

    _dislodge(carrier, hitter) {
        carrier.hasPuck   = false;
        carrier.stunTimer = 0.5;
        carrier.hitFlash  = 0.5;
        hitter.hitFlash   = 0.2;
        this.puck.carrier = null;

        const dx = carrier.pos.x - hitter.pos.x, dy = carrier.pos.y - hitter.pos.y;
        const d  = Math.sqrt(dx*dx+dy*dy) || 1;
        const power = Math.sqrt(hitter.vel.x**2+hitter.vel.y**2);
        this.puck.vel.x = (dx/d) * power * 0.65 + (Math.random()-0.5) * 4;
        this.puck.vel.y = (dy/d) * power * 0.65 + (Math.random()-0.5) * 4;

        this.sfx.hit(Math.min(power / 10, 1));
        this.shake.power = 10;

        // Hit sparks
        this.particles.emit(carrier.pos.x, carrier.pos.y, 22, {
            colors: ['#fff','#ffd700','#ffaa00','#ff6600'],
            minSpd: 2, maxSpd: 10, minDecay: 0.03, maxDecay: 0.07, shape: 'spark',
        });
        // Stars for big hit
        this.particles.emit(carrier.pos.x, carrier.pos.y, 8, {
            colors: ['#fff','#fffb00'],
            minSpd: 1, maxSpd: 4, minDecay: 0.02, maxDecay: 0.05, gravity: 0.05,
        });

        this._autoSwitch();
    }

    // ─── PUCK CARRIER ───────────────────────────────────────────────────────────
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
                const pickR = p.radius + this.puck.radius + PICKUP_BONUS;
                if (dx*dx + dy*dy < pickR*pickR) {
                    this.puck.carrier = p;
                    p.hasPuck = true;
                    this.sfx.pickup();

                    if (p.team === 0) {
                        const idx = this.players.indexOf(p);
                        if (!p.isGoalie) this._setControlled(idx);
                    }
                    this._autoSwitch();
                    break;
                }
            }
        }

        this.players.forEach(p => { if (p.tackleFrames > 0) p.tackleFrames--; });
    }

    // ─── GOAL ───────────────────────────────────────────────────────────────────
    _handleGoal(teamScored) {
        this.gameState = 'GOAL';
        this.goalTimer = 3.8;
        this.scores[teamScored]++;
        this._updateScoreUI();
        this.sfx.goal();
        this.sfx.crowdCheer(3.0, 1.5); // Massive cheer!
        this.shake.power = 45; // Massive shake

        if (this.puck.carrier) { this.puck.carrier.hasPuck = false; this.puck.carrier = null; }

        // Big celebration burst
        for (let burst = 0; burst < 3; burst++) {
            setTimeout(() => {
                this.particles.emit(this.puck.pos.x, this.puck.pos.y, 30, {
                    colors: teamScored === 0
                        ? ['#e74c3c','#fff','#c0392b','#ffd700','#ff6b6b','#ffaaaa']
                        : ['#2471a3','#fff','#1a5276','#ffd700','#74b9ff','#aad4ff'],
                    minSpd: 4, maxSpd: 16, minDecay: 0.010, maxDecay: 0.028, gravity: 0.10, shape: 'spark',
                });
                this.particles.emit(this.puck.pos.x, this.puck.pos.y, 15, {
                    colors: ['#fff','#fffb00'],
                    minSpd: 2, maxSpd: 8, minDecay: 0.012, maxDecay: 0.025, gravity: 0.06,
                });
            }, burst * 220);
        }

        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        const scorerEl = document.getElementById('goal-scorer');
        gt.textContent = teamScored === 0 ? 'GOAL! 🚨' : 'GOAL! 🚨';
        gt.style.color = teamScored === 0 ? '#ff4d4d' : '#4db8ff';
        scorerEl.textContent = teamScored === 0 ? `${TEAMS[0].name} SCORE!` : `${TEAMS[1].name} SCORE!`;
        ov.classList.remove('hidden');
    }

    _showGameOver() {
        const ov = document.getElementById('goal-overlay');
        const gt = ov.querySelector('.goal-text');
        const scorerEl = document.getElementById('goal-scorer');
        const [h, a] = this.scores;
        if      (h > a) { gt.textContent = 'YOU WIN! 🏆'; gt.style.color = '#2ecc71'; }
        else if (a > h) { gt.textContent = 'YOU LOSE 😔'; gt.style.color = '#e74c3c'; }
        else            { gt.textContent = 'TIE GAME! 🤝'; gt.style.color = '#fff'; }
        scorerEl.textContent = `${h} – ${a}  •  TAP TO PLAY AGAIN`;
        ov.classList.remove('hidden');
        this.sfx.whistle();
    }

    // ─── RENDER ─────────────────────────────────────────────────────────────────
    _render(alpha) {
        const ctx = this.ctx;
        const vw = this.vw, vh = this.vh;

        if (this.gameState === 'MENU') { this._renderMenu(ctx, vw, vh); return; }

        // Camera: track puck, clamp to rink bounds
        const tCX = this.puck.pos.x - vw / 2;
        const tCY = this.puck.pos.y - vh / 2;
        this.cam.x += (Math.max(0, Math.min(tCX, this.rink.w - vw)) - this.cam.x) * 0.1;
        this.cam.y += (Math.max(0, Math.min(tCY, this.rink.h - vh)) - this.cam.y) * 0.1;

        ctx.clearRect(0, 0, vw, vh);
        ctx.save();
        ctx.translate(-Math.round(this.cam.x) + this.shake.x, -Math.round(this.cam.y) + this.shake.y);

        this.rink.render(ctx);

        // ── Aiming line ──────────────────────────────────────────────────────
        const cp = this.players[this.controlledIdx];
        if (cp && cp.hasPuck && this.input.joystick.active && this.input.joystick.mag > 0.1) {
            const { vx, vy } = this.input.joystick;
            const lineLen = 170;
            const ax = this.puck.pos.x + vx * lineLen, ay = this.puck.pos.y + vy * lineLen;
            const isPass = !!this.passTarget;
            const charged = this.joystickHeld > 0.4;

            ctx.save();
            const aimColor = isPass ? '#3498db' : (charged ? '#ff6600' : '#00e5b0');
            ctx.shadowBlur = 18; ctx.shadowColor = aimColor;
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
            ctx.lineTo(ax - Math.cos(ang-0.45)*14, ay - Math.sin(ang-0.45)*14);
            ctx.lineTo(ax - Math.cos(ang+0.45)*14, ay - Math.sin(ang+0.45)*14);
            ctx.closePath(); ctx.fill();

            // Shot power arc
            if (charged && !isPass) {
                const chargeT = Math.min((this.joystickHeld - 0.4) / 0.5, 1);
                ctx.beginPath();
                ctx.arc(this.puck.pos.x, this.puck.pos.y, 15, -Math.PI/2, -Math.PI/2 + chargeT * Math.PI * 2);
                ctx.strokeStyle = chargeT > 0.8 ? '#ff2222' : '#ff6600';
                ctx.lineWidth = 3.5;
                ctx.shadowBlur = 12; ctx.shadowColor = ctx.strokeStyle;
                ctx.stroke();
                ctx.shadowBlur = 0;
            }

            ctx.restore();
        }

        // ── Pass target highlight ────────────────────────────────────────────
        if (this.passTarget) {
            ctx.save();
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.012);
            ctx.beginPath();
            ctx.arc(this.passTarget.pos.x, this.passTarget.pos.y, this.passTarget.radius + 10 + pulse * 4, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(52,152,219,${0.7 + pulse * 0.3})`;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 12; ctx.shadowColor = '#3498db';
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
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

        // ── Tackle cooldown arc (screen space) ──────────────────────────────
        if (this.tackleTimer > 0 && cp && !cp.hasPuck) {
            const sx = cp.pos.x - this.cam.x;
            const sy = cp.pos.y - this.cam.y;
            const t = 1 - (this.tackleTimer / TACKLE_COOLDOWN);
            ctx.save();
            ctx.beginPath();
            ctx.arc(sx, sy, cp.radius + 17, -Math.PI/2, -Math.PI/2 + t * Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,120,40,0.85)';
            ctx.lineWidth = 2.5;
            ctx.stroke();
            ctx.restore();
        }

        // ── Joystick ─────────────────────────────────────────────────────────
        this.input.renderJoystick(ctx);

        // ── Pause overlay ────────────────────────────────────────────────────
        if (this.gameState === 'PAUSED') {
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, vw, vh);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 32px Oswald';
            ctx.fillText('PAUSED', vw/2, vh/2);
        } else if (this.gameState === 'FACEOFF') {
            ctx.save();
            ctx.fillStyle = 'rgba(0,0,0,0.4)';
            ctx.fillRect(0, 0, vw, vh);
            ctx.fillStyle = '#fff';
            ctx.font = 'bold 36px Oswald';
            ctx.shadowBlur = 10; ctx.shadowColor = '#000';
            const scale = 1 + (this.faceoffTimer / 2.0);
            ctx.translate(vw/2, vh/2 - 50);
            ctx.scale(scale, scale);
            ctx.fillText(this.faceoffTimer > 0.5 ? 'GET READY' : 'DROP!', 0, 0);
            ctx.restore();
            
            // Draw puck held by referee (larger, elevated)
            ctx.save();
            const px = vw/2 + (this.puck.pos.x - this.cam.x);
            const py = vh/2 + (this.puck.pos.y - this.cam.y);
            const z = Math.max(0, this.faceoffTimer * 40); // Puck height
            
            // Ref shadow
            ctx.beginPath();
            ctx.ellipse(px, py, 15, 6, 0, 0, Math.PI * 2);
            ctx.fillStyle = 'rgba(0,0,0,0.5)';
            ctx.fill();
            
            // Render actual puck elevated
            ctx.translate(px, py - z);
            ctx.scale(1.5, 1.5);
            ctx.translate(-this.puck.pos.x, -this.puck.pos.y);
            this.puck.render(ctx);
            ctx.restore();
        }
    }

    _rrect(ctx, x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x+r, y);
        ctx.lineTo(x+w-r, y);
        ctx.arcTo(x+w, y, x+w, y+r, r);
        ctx.lineTo(x+w, y+h-r);
        ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
        ctx.lineTo(x+r, y+h);
        ctx.arcTo(x, y+h, x, y+h-r, r);
        ctx.lineTo(x, y+r);
        ctx.arcTo(x, y, x+r, y, r);
        ctx.closePath();
    }

    _renderMenu(ctx, vw, vh) {
        // Slowly pan camera over the rink for a cinematic menu background
        this.cam.x = (this.rink.w / 2) + Math.sin(Date.now() * 0.0002) * 200 - vw / 2;
        this.cam.y = (this.rink.h / 2) + Math.cos(Date.now() * 0.00015) * 300 - vh / 2;

        ctx.clearRect(0, 0, vw, vh);
        ctx.save();
        ctx.translate(-Math.round(this.cam.x), -Math.round(this.cam.y));
        this.rink.render(ctx);
        ctx.restore();
    }

    _drawMenuBadge(ctx, team, r) {
        // Circle
        const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, r*0.1, 0, 0, r);
        grad.addColorStop(0, team.trim);
        grad.addColorStop(1, team.dark);
        ctx.beginPath();
        ctx.arc(0, 0, r, 0, Math.PI * 2);
        ctx.fillStyle = grad;
        ctx.shadowBlur = 20;
        ctx.shadowColor = team.color;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Emoji
        ctx.font = `${r * 0.9}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(team.emoji, 0, 2);
    }
}

window.addEventListener('load', () => new Game());
