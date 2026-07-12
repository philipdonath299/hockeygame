// Portable rounded-rect path helper (works on all mobile browsers)
function rrect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.arcTo(x + w, y, x + w, y + r, r);
    ctx.lineTo(x + w, y + h - r);
    ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
    ctx.lineTo(x + r, y + h);
    ctx.arcTo(x, y + h, x, y + h - r, r);
    ctx.lineTo(x, y + r);
    ctx.arcTo(x, y, x + r, y, r);
    ctx.closePath();
}

// ─── PUCK ────────────────────────────────────────────────────────────────────
export class Puck {
    constructor(x, y) {
        this.pos = { x, y };
        this.vel = { x: 0, y: 0 };
        this.radius = 7;
        this.mass = 0.3;
        this.friction = 0.985; // ice glide
        this.carrier = null;
    }

    update(dt) {
        this.vel.x *= this.friction;
        this.vel.y *= this.friction;
        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;
    }

    render(ctx) {
        ctx.save();
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.strokeStyle = '#555';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.restore();
    }
}

// ─── PLAYER ──────────────────────────────────────────────────────────────────
const PLAYER_NAMES = ['SMITH', 'JONES', 'MILLER', 'DAVIS', 'BROWN', 'TAYLOR', 'WILSON', 'MOORE', 'ANDERSON', 'THOMAS'];

export class Player {
    constructor(x, y, team, number, isGoalie = false) {
        this.pos = { x, y };
        this.vel = { x: 0, y: 0 };
        this.radius = isGoalie ? 14 : 12;
        this.mass = isGoalie ? 3 : 2;
        this.team = team;           // 0 = human team, 1 = AI team
        this.number = number;
        this.isGoalie = isGoalie;
        this.hasPuck = false;
        this.stunTimer = 0;

        this.maxSpeed = isGoalie ? 4.5 : 6.5;
        this.friction = 0.84;       // skate feel

        // Facing angle (radians). Starts facing up for team0, down for team1
        this.angle = team === 0 ? -Math.PI / 2 : Math.PI / 2;

        // Team colours
        this.colorBody  = team === 0 ? '#c0392b' : '#2980b9';
        this.colorAccent = team === 0 ? '#fff'   : '#fff';
    }

    applyForce(fx, fy) {
        this.vel.x += fx / this.mass;
        this.vel.y += fy / this.mass;
    }

    update(dt) {
        if (this.stunTimer > 0) this.stunTimer -= dt;

        // Apply friction
        this.vel.x *= this.friction;
        this.vel.y *= this.friction;

        // Clamp speed
        const spd = Math.sqrt(this.vel.x * this.vel.x + this.vel.y * this.vel.y);
        if (spd > this.maxSpeed) {
            this.vel.x = (this.vel.x / spd) * this.maxSpeed;
            this.vel.y = (this.vel.y / spd) * this.maxSpeed;
        }

        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;

        // Rotate to face movement direction smoothly
        if (spd > 0.3) {
            const targetAngle = Math.atan2(this.vel.y, this.vel.x);
            let delta = targetAngle - this.angle;
            while (delta > Math.PI)  delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            this.angle += delta * 0.25;
        }
    }

    render(ctx, isControlled) {
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        ctx.rotate(this.angle + Math.PI / 2); // sprite faces "up"

        // Shadow
        ctx.beginPath();
        ctx.ellipse(2, 4, this.radius, this.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();

        // Jersey body
        rrect(ctx, -10, -14, 20, 28, 7);
        ctx.fillStyle = this.colorBody;
        ctx.fill();
        ctx.strokeStyle = this.colorAccent;
        ctx.lineWidth = 2;
        ctx.stroke();

        // Helmet
        ctx.beginPath();
        ctx.arc(0, -14, 9, Math.PI, Math.PI * 2);
        ctx.fillStyle = this.colorBody;
        ctx.fill();
        ctx.strokeStyle = this.colorAccent;
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Visor stripe
        ctx.beginPath();
        ctx.moveTo(-9, -14);
        ctx.lineTo(9, -14);
        ctx.strokeStyle = 'rgba(255,255,255,0.5)';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Number
        ctx.rotate(0);
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${this.isGoalie ? 10 : 9}px Oswald`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.number, 0, 4);

        // Stick
        ctx.strokeStyle = '#5d3a1a';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(16, 14);
        ctx.lineTo(14, 20);
        ctx.stroke();

        ctx.restore();

        // Controlled-player highlight ring
        if (isControlled) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 8, 0, Math.PI * 2);
            ctx.strokeStyle = '#ffe500';
            ctx.lineWidth = 3;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);

            // Name tag
            const name = 'J. ' + PLAYER_NAMES[this.number % PLAYER_NAMES.length];
            ctx.font = 'bold 10px Oswald';
            const tw = ctx.measureText(name).width;
            const tx = this.pos.x - tw / 2 - 5;
            const ty = this.pos.y + this.radius + 14;
            rrect(ctx, tx, ty, tw + 10, 15, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.7)';
            ctx.fill();
            ctx.fillStyle = '#ffe500';
            ctx.fillText(name, this.pos.x, ty + 7.5);
            ctx.restore();
        }
    }

    // Steering helpers used by AI
    _seek(tx, ty) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d === 0) return;
        const force = 0.8;
        this.applyForce((dx / d) * force, (dy / d) * force);
    }

    _arrive(tx, ty, slowR = 60) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d === 0) return;
        const speed = d < slowR ? (d / slowR) * this.maxSpeed : this.maxSpeed;
        const force = 0.6;
        this.applyForce((dx / d) * force * (speed / this.maxSpeed),
                        (dy / d) * force * (speed / this.maxSpeed));
    }
}

// ─── RINK ────────────────────────────────────────────────────────────────────
export class Rink {
    constructor() {
        // World dimensions
        this.w = 500;
        this.h = 900;
        this.R = 70;                    // corner radius of rink oval

        // Goal geometry (in world coords)
        this.goalW = 90;                // opening width
        this.goalD = 28;                // depth
        this.goalLineY0 = 80;           // top goal line Y
        this.goalLineY1 = this.h - 80;  // bottom goal line Y
    }

    // Confine an entity to the rink. Returns true if a wall bounce happened.
    confine(entity) {
        const r = entity.radius;
        let bounced = false;
        const { w, h, R } = this;

        // Simple rectangular clamp first (handles most cases fast)
        if (entity.pos.x - r < 0) { entity.pos.x = r; entity.vel.x = Math.abs(entity.vel.x) * 0.5; bounced = true; }
        if (entity.pos.x + r > w) { entity.pos.x = w - r; entity.vel.x = -Math.abs(entity.vel.x) * 0.5; bounced = true; }
        if (entity.pos.y - r < 0) { entity.pos.y = r; entity.vel.y = Math.abs(entity.vel.y) * 0.5; bounced = true; }
        if (entity.pos.y + r > h) { entity.pos.y = h - r; entity.vel.y = -Math.abs(entity.vel.y) * 0.5; bounced = true; }

        // Corner arcs: push entity away from corner centers
        const corners = [
            { cx: R, cy: R },
            { cx: w - R, cy: R },
            { cx: R, cy: h - R },
            { cx: w - R, cy: h - R }
        ];
        for (const c of corners) {
            const dx = entity.pos.x - c.cx;
            const dy = entity.pos.y - c.cy;
            const d = Math.sqrt(dx * dx + dy * dy);
            const minD = R - r;
            if (d < minD && d > 0) {
                const nx = dx / d, ny = dy / d;
                entity.pos.x = c.cx + nx * minD;
                entity.pos.y = c.cy + ny * minD;
                const vn = entity.vel.x * nx + entity.vel.y * ny;
                if (vn < 0) {
                    entity.vel.x -= 1.5 * vn * nx;
                    entity.vel.y -= 1.5 * vn * ny;
                }
                bounced = true;
            }
        }
        return bounced;
    }

    // Returns which team scored (0 or 1), or -1
    checkGoal(puck) {
        const hw = this.goalW / 2;
        const cx = this.w / 2;

        // Top goal: team 0 scores (puck entered from below goal line and is inside depth)
        if (puck.pos.y < this.goalLineY0 &&
            puck.pos.y > this.goalLineY0 - this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) {
            return 0;
        }
        // Bottom goal: team 1 scores
        if (puck.pos.y > this.goalLineY1 &&
            puck.pos.y < this.goalLineY1 + this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) {
            return 1;
        }
        return -1;
    }

    render(ctx) {
        const { w, h, R } = this;
        const cx = w / 2, cy = h / 2;

        // ── Stadium background (dark)
        ctx.fillStyle = '#1a1a2e';
        ctx.fillRect(-500, -500, w + 1000, h + 1000);

        // Concentric crowd rows
        ctx.strokeStyle = 'rgba(80,80,80,0.6)';
        ctx.lineWidth = 8;
        for (let i = 1; i <= 12; i++) {
            const pad = i * 40;
            rrect(ctx, -pad, -pad, w + pad * 2, h + pad * 2, R + pad);
            ctx.stroke();
        }

        // ── Ice surface
        rrect(ctx, 0, 0, w, h, R);
        const iceGrad = ctx.createLinearGradient(0, 0, 0, h);
        iceGrad.addColorStop(0,   '#d8edf8');
        iceGrad.addColorStop(0.5, '#e8f4fc');
        iceGrad.addColorStop(1,   '#d8edf8');
        ctx.fillStyle = iceGrad;
        ctx.fill();

        // Save & clip to ice from here
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();

        // ── Ice markings
        // Goal lines (red)
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY0); ctx.lineTo(w, this.goalLineY0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY1); ctx.lineTo(w, this.goalLineY1); ctx.stroke();

        // Blue lines
        ctx.strokeStyle = '#2471a3';
        ctx.lineWidth = 6;
        const blueOff = 220;
        ctx.beginPath(); ctx.moveTo(0, cy - blueOff); ctx.lineTo(w, cy - blueOff); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy + blueOff); ctx.lineTo(w, cy + blueOff); ctx.stroke();

        // Red center line
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 5;
        ctx.setLineDash([12, 8]);
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        ctx.setLineDash([]);

        // Center circle
        ctx.strokeStyle = '#2471a3';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 70, 0, Math.PI * 2); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, cy, 4,  0, Math.PI * 2); ctx.fillStyle = '#c0392b'; ctx.fill();

        // Faceoff dots
        const fdots = [
            [cx - 120, cy - 180], [cx + 120, cy - 180],
            [cx - 120, cy + 180], [cx + 120, cy + 180],
        ];
        fdots.forEach(([fx, fy]) => {
            ctx.beginPath(); ctx.arc(fx, fy, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#c0392b'; ctx.fill();
            ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(fx, fy, 35, 0, Math.PI * 2); ctx.stroke();
        });

        // Crease semicircles
        ctx.fillStyle   = 'rgba(41,128,185,0.18)';
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, this.goalLineY0, 50, 0, Math.PI);           ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, this.goalLineY1, 50, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Center logo (shield)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.5;
        ctx.fillStyle = '#2471a3';
        ctx.beginPath();
        ctx.moveTo(0, -45); ctx.lineTo(40, -20); ctx.lineTo(40, 25); ctx.lineTo(0, 50); ctx.lineTo(-40, 25); ctx.lineTo(-40, -20);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();

        // ── Boards border (inside clip)
        rrect(ctx, 0, 0, w, h, R);
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 14;
        ctx.stroke();
        ctx.strokeStyle = '#2471a3';
        ctx.lineWidth = 3;
        ctx.stroke();

        ctx.restore(); // end ice clip

        // ── Goals (drawn outside clip so they slightly protrude)
        this._drawGoal(ctx, cx, this.goalLineY0, -1);  // top goal, opens upward
        this._drawGoal(ctx, cx, this.goalLineY1,  1);  // bottom goal, opens downward
    }

    _drawGoal(ctx, cx, ly, dir) {
        const hw = this.goalW / 2;
        const d  = this.goalD;

        // Net fill
        ctx.fillStyle = 'rgba(220,220,220,0.35)';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, ly - d * dir);
        ctx.lineTo(cx + hw, ly - d * dir);
        ctx.lineTo(cx + hw, ly);
        ctx.fill();

        // Net grid lines
        ctx.strokeStyle = 'rgba(180,180,180,0.6)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        for (let x = cx - hw; x <= cx + hw; x += 12) {
            ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x, ly - d * dir); ctx.stroke();
        }
        for (let i = 1; i <= 3; i++) {
            const gy = ly - (d / 3) * i * dir;
            ctx.beginPath(); ctx.moveTo(cx - hw, gy); ctx.lineTo(cx + hw, gy); ctx.stroke();
        }
        ctx.setLineDash([]);

        // Posts + crossbar
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, ly - d * dir);
        ctx.lineTo(cx + hw, ly - d * dir);
        ctx.lineTo(cx + hw, ly);
        ctx.stroke();
    }
}
