// Portable rounded-rect path helper (all mobile browsers)
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
        this.pos     = { x, y };
        this.vel     = { x: 0, y: 0 };
        this.radius  = 7;
        this.mass    = 0.3;
        this.friction = 0.986;
        this.carrier = null;

        // Trail
        this.trail = [];
        this.MAX_TRAIL = 14;
    }

    update(dt) {
        this.vel.x *= this.friction;
        this.vel.y *= this.friction;
        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;

        // Record trail
        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);
        if (spd > 1.5) {
            this.trail.push({ x: this.pos.x, y: this.pos.y, spd });
            if (this.trail.length > this.MAX_TRAIL) this.trail.shift();
        } else {
            if (this.trail.length > 0) this.trail.shift();
        }
    }

    render(ctx) {
        // Trail
        if (this.trail.length > 1) {
            for (let i = 1; i < this.trail.length; i++) {
                const t0 = this.trail[i - 1], t1 = this.trail[i];
                const a = i / this.trail.length;
                ctx.beginPath();
                ctx.moveTo(t0.x, t0.y);
                ctx.lineTo(t1.x, t1.y);
                ctx.strokeStyle = `rgba(150,180,255,${a * 0.35})`;
                ctx.lineWidth = a * 6;
                ctx.stroke();
            }
        }

        // Shadow
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.pos.x + 2, this.pos.y + 4, this.radius + 2, this.radius * 0.5, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.3)';
        ctx.fill();
        ctx.restore();

        // Puck body
        ctx.save();
        const g = ctx.createRadialGradient(this.pos.x - 2, this.pos.y - 2, 1, this.pos.x, this.pos.y, this.radius);
        g.addColorStop(0, '#555');
        g.addColorStop(1, '#111');
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = '#777';
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }
}

// ─── PLAYER ──────────────────────────────────────────────────────────────────
const PLAYER_NAMES = ['SMITH','JONES','MILLER','DAVIS','BROWN','TAYLOR','WILSON','MOORE','ANDERSON','THOMAS'];

export class Player {
    constructor(x, y, team, number, isGoalie = false) {
        this.pos      = { x, y };
        this.vel      = { x: 0, y: 0 };
        this.radius   = isGoalie ? 14 : 12;
        this.mass     = isGoalie ? 3 : 2;
        this.team     = team;
        this.number   = number;
        this.isGoalie = isGoalie;
        this.hasPuck  = false;
        this.stunTimer = 0;
        this.maxSpeed = isGoalie ? 4.5 : 6.8;
        this.friction = 0.83;
        this.angle    = team === 0 ? -Math.PI / 2 : Math.PI / 2;

        // Visual state
        this.skatePhase  = Math.random() * Math.PI * 2;
        this.hitFlash    = 0; // > 0 = flashing white from hit

        // Team palette
        if (team === 0) {
            this.cBody   = '#c0392b';
            this.cTrim   = '#e74c3c';
            this.cAccent = '#fff';
            this.cHelmet = '#8B0000';
        } else {
            this.cBody   = '#1a5276';
            this.cTrim   = '#2471a3';
            this.cAccent = '#fff';
            this.cHelmet = '#0a2f4e';
        }
    }

    applyForce(fx, fy) {
        this.vel.x += fx / this.mass;
        this.vel.y += fy / this.mass;
    }

    update(dt) {
        if (this.stunTimer > 0) this.stunTimer -= dt;
        if (this.hitFlash  > 0) this.hitFlash  -= dt;

        this.vel.x *= this.friction;
        this.vel.y *= this.friction;

        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);
        if (spd > this.maxSpeed) {
            this.vel.x = (this.vel.x / spd) * this.maxSpeed;
            this.vel.y = (this.vel.y / spd) * this.maxSpeed;
        }

        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;

        if (spd > 0.4) {
            const target = Math.atan2(this.vel.y, this.vel.x);
            let delta = target - this.angle;
            while (delta >  Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            this.angle += delta * 0.2;
        }

        // Skate animation phase
        if (spd > 0.5) this.skatePhase += dt * spd * 3;
    }

    render(ctx, isControlled) {
        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);

        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);

        // Skate trails (two lines behind player)
        if (spd > 1) {
            const back = this.angle + Math.PI;
            const spread = 5;
            for (let s = -1; s <= 1; s += 2) {
                const offX = Math.cos(this.angle + Math.PI / 2) * s * spread;
                const offY = Math.sin(this.angle + Math.PI / 2) * s * spread;
                ctx.beginPath();
                ctx.moveTo(offX, offY);
                ctx.lineTo(offX + Math.cos(back) * spd * 2.5, offY + Math.sin(back) * spd * 2.5);
                ctx.strokeStyle = `rgba(180,220,255,${Math.min(spd / 10, 0.4)})`;
                ctx.lineWidth = 1.5;
                ctx.stroke();
            }
        }

        ctx.rotate(this.angle + Math.PI / 2);

        // Shadow
        ctx.beginPath();
        ctx.ellipse(3, 5, this.radius + 2, this.radius * 0.45, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fill();

        // Hit flash
        if (this.hitFlash > 0 && Math.floor(this.hitFlash * 12) % 2 === 0) {
            rrect(ctx, -11, -15, 22, 30, 7);
            ctx.fillStyle = '#fff';
            ctx.fill();
        } else {
            // Jersey body
            rrect(ctx, -11, -15, 22, 30, 7);
            const jg = ctx.createLinearGradient(-11, -15, 11, 15);
            jg.addColorStop(0, this.cTrim);
            jg.addColorStop(1, this.cBody);
            ctx.fillStyle = jg;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Shoulder stripe
            ctx.fillStyle = 'rgba(255,255,255,0.2)';
            ctx.fillRect(-11, -6, 22, 4);

            // Helmet
            ctx.beginPath();
            ctx.arc(0, -15, 9, Math.PI, Math.PI * 2);
            ctx.fillStyle = this.cHelmet;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Visor
            ctx.beginPath();
            ctx.moveTo(-9, -15);
            ctx.lineTo(9, -15);
            ctx.strokeStyle = 'rgba(150,220,255,0.7)';
            ctx.lineWidth = 3;
            ctx.stroke();
        }

        // Number
        ctx.fillStyle = '#fff';
        ctx.font = `bold ${this.isGoalie ? 10 : 9}px Oswald`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.number, 0, 4);

        // Stick (always rendered, animates slightly with skate)
        const stickWobble = spd > 0.5 ? Math.sin(this.skatePhase) * 0.08 : 0;
        ctx.rotate(stickWobble);
        ctx.strokeStyle = '#6d4c2a';
        ctx.lineWidth = 2.5;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(9, 0);
        ctx.lineTo(18, 12);
        ctx.lineTo(16, 20);
        ctx.stroke();
        // Blade
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(14, 18);
        ctx.lineTo(20, 20);
        ctx.stroke();

        ctx.restore(); // un-rotate + un-translate

        // Controlled highlight
        if (isControlled) {
            // Pulsing ring
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.007);
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 8 + pulse * 3, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,229,0,${0.6 + pulse * 0.4})`;
            ctx.lineWidth = 2.5;
            ctx.setLineDash([4, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.restore();

            // Name tag below
            const name = PLAYER_NAMES[this.number % PLAYER_NAMES.length];
            ctx.save();
            ctx.font = 'bold 9px Oswald';
            const tw = ctx.measureText(name).width;
            const tx = this.pos.x - tw / 2 - 5;
            const ty = this.pos.y + this.radius + 12;
            rrect(ctx, tx, ty, tw + 10, 14, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.75)';
            ctx.fill();
            ctx.fillStyle = '#ffe500';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, this.pos.x, ty + 7);
            ctx.restore();
        }

        // Puck possession indicator
        if (this.hasPuck) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 5, 0, Math.PI * 2);
            ctx.strokeStyle = this.team === 0 ? 'rgba(231,76,60,0.7)' : 'rgba(52,152,219,0.7)';
            ctx.lineWidth = 3;
            ctx.stroke();
            ctx.restore();
        }
    }

    // AI helpers
    _seek(tx, ty) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;
        this.applyForce((dx/d) * 0.9, (dy/d) * 0.9);
    }

    _arrive(tx, ty, slowR = 60) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;
        const s = d < slowR ? (d / slowR) : 1;
        this.applyForce((dx/d) * 0.65 * s, (dy/d) * 0.65 * s);
    }
}

// ─── RINK ────────────────────────────────────────────────────────────────────
export class Rink {
    constructor() {
        this.w = 500;
        this.h = 900;
        this.R = 70;
        this.goalW = 90;
        this.goalD = 28;
        this.goalLineY0 = 80;
        this.goalLineY1 = this.h - 80;
    }

    confine(entity) {
        const r = entity.radius;
        const { w, h, R } = this;

        if (entity.pos.x - r < 0)   { entity.pos.x = r;     entity.vel.x = Math.abs(entity.vel.x) * 0.45; }
        if (entity.pos.x + r > w)   { entity.pos.x = w - r; entity.vel.x = -Math.abs(entity.vel.x) * 0.45; }
        if (entity.pos.y - r < 0)   { entity.pos.y = r;     entity.vel.y = Math.abs(entity.vel.y) * 0.45; }
        if (entity.pos.y + r > h)   { entity.pos.y = h - r; entity.vel.y = -Math.abs(entity.vel.y) * 0.45; }

        const corners = [
            { cx: R, cy: R }, { cx: w - R, cy: R },
            { cx: R, cy: h - R }, { cx: w - R, cy: h - R }
        ];
        for (const c of corners) {
            const dx = entity.pos.x - c.cx, dy = entity.pos.y - c.cy;
            const d = Math.sqrt(dx*dx + dy*dy);
            const minD = R - r;
            if (d < minD && d > 0) {
                const nx = dx/d, ny = dy/d;
                entity.pos.x = c.cx + nx * minD;
                entity.pos.y = c.cy + ny * minD;
                const vn = entity.vel.x * nx + entity.vel.y * ny;
                if (vn < 0) {
                    entity.vel.x -= 1.5 * vn * nx;
                    entity.vel.y -= 1.5 * vn * ny;
                }
            }
        }
    }

    checkGoal(puck) {
        const hw = this.goalW / 2;
        const cx = this.w / 2;
        if (puck.pos.y < this.goalLineY0 &&
            puck.pos.y > this.goalLineY0 - this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) return 0;
        if (puck.pos.y > this.goalLineY1 &&
            puck.pos.y < this.goalLineY1 + this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) return 1;
        return -1;
    }

    render(ctx) {
        const { w, h, R } = this;
        const cx = w / 2, cy = h / 2;

        // ── Dark stadium
        ctx.fillStyle = '#12121e';
        ctx.fillRect(-600, -600, w + 1200, h + 1200);

        // Crowd rows (concentric rounded rects with subtle colour variation)
        for (let i = 12; i >= 1; i--) {
            const pad = i * 42;
            const hue = 220 + i * 2;
            const lightness = 8 + i * 1.2;
            rrect(ctx, -pad, -pad, w + pad*2, h + pad*2, R + pad);
            ctx.fillStyle = `hsl(${hue},20%,${lightness}%)`;
            ctx.fill();
        }

        // Boards glow (outer rim on ice)
        rrect(ctx, -4, -4, w+8, h+8, R+4);
        ctx.strokeStyle = 'rgba(100,180,255,0.15)';
        ctx.lineWidth = 12;
        ctx.stroke();

        // ── Ice surface
        rrect(ctx, 0, 0, w, h, R);
        const iceG = ctx.createLinearGradient(0, 0, 0, h);
        iceG.addColorStop(0,   '#cce8f8');
        iceG.addColorStop(0.45,'#ddf0fc');
        iceG.addColorStop(0.55,'#ddf0fc');
        iceG.addColorStop(1,   '#cce8f8');
        ctx.fillStyle = iceG;
        ctx.fill();

        // Ice shine overlay
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();
        const shine = ctx.createRadialGradient(cx * 0.6, cy * 0.4, 0, cx, cy, Math.max(w, h));
        shine.addColorStop(0,   'rgba(255,255,255,0.18)');
        shine.addColorStop(0.4, 'rgba(255,255,255,0.05)');
        shine.addColorStop(1,   'rgba(200,220,255,0.02)');
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // ── Clip for ice markings
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();

        // Goal lines
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY0); ctx.lineTo(w, this.goalLineY0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY1); ctx.lineTo(w, this.goalLineY1); ctx.stroke();

        // Blue lines
        ctx.strokeStyle = '#1a5276';
        ctx.lineWidth = 7;
        const bOff = 210;
        ctx.beginPath(); ctx.moveTo(0, cy - bOff); ctx.lineTo(w, cy - bOff); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy + bOff); ctx.lineTo(w, cy + bOff); ctx.stroke();

        // Red center line (dashed)
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 5;
        ctx.setLineDash([14, 8]);
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        ctx.setLineDash([]);

        // Center circle
        ctx.strokeStyle = '#1a5276';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.arc(cx, cy, 72, 0, Math.PI * 2); ctx.stroke();

        // Center dot
        ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2);
        ctx.fillStyle = '#c0392b'; ctx.fill();

        // Faceoff dots + small circles
        const fdots = [
            [cx - 115, cy - 175], [cx + 115, cy - 175],
            [cx - 115, cy + 175], [cx + 115, cy + 175],
        ];
        fdots.forEach(([fx, fy]) => {
            ctx.strokeStyle = '#c0392b'; ctx.lineWidth = 2;
            ctx.beginPath(); ctx.arc(fx, fy, 32, 0, Math.PI * 2); ctx.stroke();
            ctx.beginPath(); ctx.arc(fx, fy, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#c0392b'; ctx.fill();
        });

        // Crease semicircles
        ctx.fillStyle   = 'rgba(36,113,163,0.14)';
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, this.goalLineY0, 52, 0, Math.PI);           ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, this.goalLineY1, 52, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Center ice logo
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#1a5276';
        ctx.beginPath();
        ctx.moveTo(0, -48); ctx.lineTo(42, -22); ctx.lineTo(42, 28);
        ctx.lineTo(0, 54); ctx.lineTo(-42, 28); ctx.lineTo(-42, -22);
        ctx.closePath(); ctx.fill();
        ctx.globalAlpha = 0.6;
        ctx.strokeStyle = '#5dade2';
        ctx.lineWidth = 2;
        ctx.stroke();
        // Mountain silhouette
        ctx.fillStyle = '#5dade2';
        ctx.globalAlpha = 0.5;
        ctx.beginPath();
        ctx.moveTo(-38, 22); ctx.lineTo(-14, -14); ctx.lineTo(2, 6);
        ctx.lineTo(22, -28); ctx.lineTo(38, 22);
        ctx.fill();
        ctx.globalAlpha = 1;
        ctx.restore();

        // Boards inner line
        rrect(ctx, 0, 0, w, h, R);
        ctx.strokeStyle = '#2471a3';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.restore(); // end ice clip

        // Boards outer white border
        rrect(ctx, 0, 0, w, h, R);
        ctx.strokeStyle = '#e8edf0';
        ctx.lineWidth = 14;
        ctx.stroke();

        // Board ad text
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();
        ctx.font = 'bold 11px Oswald';
        ctx.fillStyle = '#c0392b';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY', cx, 7);
        ctx.fillText('SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY', cx, h - 7);
        ctx.restore();

        // ── Goals
        this._drawGoal(ctx, cx, this.goalLineY0, -1);
        this._drawGoal(ctx, cx, this.goalLineY1,  1);
    }

    _drawGoal(ctx, cx, ly, dir) {
        const hw = this.goalW / 2, d = this.goalD;
        const bY = ly - d * dir; // crossbar Y

        // Net
        ctx.fillStyle = 'rgba(200,210,220,0.3)';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, bY);
        ctx.lineTo(cx + hw, bY);
        ctx.lineTo(cx + hw, ly);
        ctx.fill();

        // Net grid
        ctx.strokeStyle = 'rgba(160,170,180,0.5)';
        ctx.lineWidth = 0.7;
        ctx.setLineDash([3, 3]);
        for (let x = cx - hw; x <= cx + hw; x += 10) {
            ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x, bY); ctx.stroke();
        }
        for (let i = 1; i < 4; i++) {
            const gy = ly + (bY - ly) * (i / 4);
            ctx.beginPath(); ctx.moveTo(cx - hw, gy); ctx.lineTo(cx + hw, gy); ctx.stroke();
        }
        ctx.setLineDash([]);

        // Posts
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 5;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, bY);
        ctx.lineTo(cx + hw, bY);
        ctx.lineTo(cx + hw, ly);
        ctx.stroke();
    }
}
