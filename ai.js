export class GameAI {
    constructor(game) {
        this.game = game;
        this.shootCooldowns = [0,0,0,0,0,0,0,0];
        this.tackleCooldowns = [0,0,0,0,0,0,0,0];
    }

    update(dt) {
        const cx   = this.game.rink.w / 2;
        const t0HP = this.game.players.some(p => p.team === 0 && p.hasPuck);
        const t1HP = this.game.players.some(p => p.team === 1 && p.hasPuck);
        const attackY0 = this.game.rink.goalLineY0;
        const attackY1 = this.game.rink.goalLineY1;

        this.shootCooldowns = this.shootCooldowns.map(c => Math.max(0, c - dt));
        this.tackleCooldowns = this.tackleCooldowns.map(c => Math.max(0, c - dt));

        this.game.players.forEach((p, i) => {
            if (i === this.game.controlledIdx) return;

            // ── Goalie AI ──────────────────────────────────────────────────────
            if (p.isGoalie) {
                const myLineY = p.team === 0 ? attackY1 : attackY0;
                const offset  = p.team === 0 ? -38 : 38;
                const hw = this.game.rink.goalW * 0.4;
                const tx = Math.max(cx - hw, Math.min(cx + hw, this.game.puck.pos.x));
                const dyToPuck = Math.abs(this.game.puck.pos.y - myLineY);
                if (dyToPuck < 100) {
                    p._seek(this.game.puck.pos.x, this.game.puck.pos.y);
                } else {
                    p._arrive(tx, myLineY + offset, 25);
                }
                return;
            }

            // ── Team 1 (AI opponents) ──────────────────────────────────────────
            if (p.team === 1) {
                if (p.hasPuck) {
                    const juke = Math.sin(Date.now() * 0.0015 + i * 1.3) * 35;
                    const targetX = cx + juke;
                    p._seek(targetX, attackY1);

                    let passed = false;
                    if (this.shootCooldowns[i] <= 0 && Math.random() < 0.03) {
                        let bestMate = null;
                        let bestY = p.pos.y;
                        this.game.players.forEach(q => {
                            if (q.team === 1 && q !== p && !q.isGoalie) {
                                if (q.pos.y > bestY + 40) {
                                    bestY = q.pos.y;
                                    bestMate = q;
                                }
                            }
                        });
                        if (bestMate) {
                            this.game._executePass(p, bestMate);
                            this.shootCooldowns[i] = 1.0;
                            passed = true;
                        }
                    }

                    if (!passed) {
                        const dyToGoal = attackY1 - p.pos.y;
                        const shootProb = dyToGoal < 300 ? (dyToGoal < 150 ? 0.04 : 0.015) : 0;
                        if (shootProb > 0 && Math.random() < shootProb && this.shootCooldowns[i] <= 0) {
                            const aimX = cx + (Math.random() - 0.5) * 30;
                            this.shoot(p, aimX, attackY1);
                            this.shootCooldowns[i] = 1.5;
                        }
                    }
                } else if (t1HP) {
                    const side = (i % 2 === 0 ? -1 : 1);
                    const laneX = cx + side * 110;
                    const laneY = Math.min(this.game.puck.pos.y + 20, attackY1 - 80);
                    p._arrive(laneX, laneY, 70);
                } else {
                    const dx = this.game.puck.pos.x - p.pos.x, dy = this.game.puck.pos.y - p.pos.y;
                    const d2 = dx*dx + dy*dy;
                    if (d2 < 250*250) {
                        p._seek(this.game.puck.pos.x, this.game.puck.pos.y);
                    } else {
                        const side = (i % 2 === 0 ? -1 : 1);
                        p._arrive(cx + side * 80, attackY0 + 140, 90);
                    }
                }
            }
            // ── Team 0 non-controlled skaters ─────────────────────────────────
            else {
                if (t0HP) {
                    const side = (i % 2 === 0 ? -1 : 1);
                    const laneY = attackY0 + 140;
                    p._arrive(cx + side * 110, laneY, 80);
                } else {
                    const dx = this.game.puck.pos.x - p.pos.x, dy = this.game.puck.pos.y - p.pos.y;
                    const d = Math.sqrt(dx*dx + dy*dy) || 1;
                    p.applyForce((dx/d) * 0.5, (dy/d) * 0.5);
                }
            }
        });
    }

    shoot(p, tx, ty) {
        this.game.shots[1]++;
        document.getElementById('shots-away').textContent = this.game.shots[1];
        this.game.sfx.wristShot();
        const dx = tx - p.pos.x, dy = ty - p.pos.y;
        const d  = Math.sqrt(dx*dx + dy*dy) || 1;
        const power = 10 + Math.random() * 5;
        this.game.puck.vel.x = p.vel.x * 0.2 + (dx/d) * power;
        this.game.puck.vel.y = p.vel.y * 0.2 + (dy/d) * power;
        this.game.puck.pos.x = p.pos.x + (dx/d) * (p.radius + this.game.puck.radius + 4);
        this.game.puck.pos.y = p.pos.y + (dy/d) * (p.radius + this.game.puck.radius + 4);
        p.hasPuck = false;
        this.game.puck.carrier = null;

        this.game.particles.emit(p.pos.x, p.pos.y, 8, {
            colors: ['#c8e8ff','#fff'],
            angle: Math.atan2(dy, dx) + Math.PI, spread: 0.6,
            minSpd: 1, maxSpd: 5, minDecay: 0.04, maxDecay: 0.08, shape: 'spark',
        });
    }
}
