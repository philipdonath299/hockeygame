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
        this.pos      = { x, y };
        this.vel      = { x: 0, y: 0 };
        this.radius   = 7;
        this.mass     = 0.28;
        this.friction = 0.987;
        this.carrier  = null;

        this.trail = [];
        this.MAX_TRAIL = 16;
    }

    update(dt) {
        this.vel.x *= this.friction;
        this.vel.y *= this.friction;
        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;

        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);
        if (spd > 1.5) {
            this.trail.push({ x: this.pos.x, y: this.pos.y, spd });
            if (this.trail.length > this.MAX_TRAIL) this.trail.shift();
        } else {
            if (this.trail.length > 0) this.trail.shift();
        }
    }

    render(ctx) {
        // Glow when moving fast
        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);

        // Trail
        if (this.trail.length > 1) {
            for (let i = 1; i < this.trail.length; i++) {
                const t0 = this.trail[i - 1], t1 = this.trail[i];
                const a = i / this.trail.length;
                ctx.beginPath();
                ctx.moveTo(t0.x, t0.y);
                ctx.lineTo(t1.x, t1.y);
                ctx.strokeStyle = `rgba(120,180,255,${a * 0.4})`;
                ctx.lineWidth = a * 7;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        }

        // Calculate simulated height (z) based on speed for 3D effect
        const z = Math.min(Math.max(spd - 12, 0) * 2.5, 12); 

        // Shadow
        ctx.save();
        ctx.beginPath();
        ctx.ellipse(this.pos.x + 2 + z*0.5, this.pos.y + 5 + z, this.radius + 3 + z*0.2, (this.radius * 0.5) + z*0.1, 0, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(0,0,0,${0.35 - (z/12)*0.25})`;
        ctx.fill();
        ctx.restore();

        // Apply elevation to puck body
        ctx.save();
        ctx.translate(0, -z);

        // Speed glow
        if (spd > 6) {
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 4, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(180,220,255,${Math.min((spd-6)/8, 0.25)})`;
            ctx.fill();
            ctx.restore();
        }

        // Puck body with rubber texture
        ctx.save();
        const g = ctx.createRadialGradient(this.pos.x - 2.5, this.pos.y - 2.5, 0.5, this.pos.x, this.pos.y, this.radius);
        g.addColorStop(0, '#666');
        g.addColorStop(0.4, '#333');
        g.addColorStop(1, '#111');
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        // Edge highlight
        ctx.strokeStyle = '#888';
        ctx.lineWidth = 0.8;
        ctx.stroke();
        // Top highlight
        ctx.beginPath();
        ctx.arc(this.pos.x - 2, this.pos.y - 2.5, this.radius * 0.4, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)';
        ctx.fill();
        ctx.restore();
        
        ctx.restore(); // restore elevation
        ctx.restore();
    }
}

// ─── PLAYER ──────────────────────────────────────────────────────────────────
const PLAYER_NAMES = [
    'SMITH','JONES','MILLER','DAVIS','BROWN',
    'TAYLOR','WILSON','MOORE','ANDERSON','THOMAS',
    'JACKSON','WHITE','HARRIS','MARTIN','THOMPSON',
];

export class Player {
    constructor(x, y, team, number, isGoalie = false, teamConfig = null, role = 'CENTER') {
        this.pos      = { x, y };
        this.vel      = { x: 0, y: 0 };
        this.radius   = isGoalie ? 15 : 13;
        
        // Base stats by role
        this.mass     = isGoalie ? 3.2 : 2.0;
        this.maxSpeed = isGoalie ? 4.8 : 8.0;
        
        if (!isGoalie) {
            if (role === 'LW') {
                this.mass = 1.6;     // Light & fast (Sniper)
                this.maxSpeed = 8.6; 
            } else if (role === 'RW') {
                this.mass = 2.5;     // Heavy & slow (Enforcer)
                this.maxSpeed = 7.4; 
            }
        }
        
        this.team     = team;
        this.number   = number;
        this.isGoalie = isGoalie;
        this.role     = role;
        this.hasPuck  = false;
        this.stunTimer = 0;
        this.friction = 0.77;
        this.angle    = team === 0 ? -Math.PI / 2 : Math.PI / 2;
        this.tackleFrames = 0;

        this.skatePhase  = Math.random() * Math.PI * 2;
        this.hitFlash    = 0;
        this.puckGlow    = 0; // glow when picking up puck
        this.stamina     = 1.0;
        this.isSprinting = false;

        // Team palette from config or fallback
        if (teamConfig) {
            this.cBody    = teamConfig.jersey;
            this.cTrim    = teamConfig.trim;
            this.cAccent  = '#fff';
            this.cHelmet  = teamConfig.helmet;
            this.cMain    = teamConfig.color;
            this.teamName = teamConfig.name;
        } else if (team === 0) {
            this.cBody    = '#c0392b';
            this.cTrim    = '#e74c3c';
            this.cAccent  = '#fff';
            this.cHelmet  = '#8B0000';
            this.cMain    = '#e74c3c';
            this.teamName = 'EAGLES';
        } else {
            this.cBody    = '#1a5276';
            this.cTrim    = '#2471a3';
            this.cAccent  = '#fff';
            this.cHelmet  = '#0a2f4e';
            this.cMain    = '#3498db';
            this.teamName = 'WOLVES';
        }
    }

    applyForce(fx, fy) {
        this.vel.x += fx / this.mass;
        this.vel.y += fy / this.mass;
    }

    update(dt) {
        if (this.stunTimer > 0) this.stunTimer -= dt;
        if (this.hitFlash  > 0) this.hitFlash  -= dt;
        if (this.tackleFrames > 0) this.tackleFrames--;
        if (this.puckGlow > 0) this.puckGlow -= dt * 2;

        // Anisotropic ice friction (realistic skating feel)
        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);
        if (spd > 0.01) {
            const fwdX = this.vel.x / spd, fwdY = this.vel.y / spd;
            const sideX = -fwdY, sideY = fwdX;
            const latV = this.vel.x * sideX + this.vel.y * sideY;
            this.vel.x -= sideX * latV * 0.20;
            this.vel.y -= sideY * latV * 0.20;
        }

        if (this.isSprinting && this.stamina > 0) {
            this.stamina -= dt * 0.35; // Drain stamina
            if (this.stamina < 0) this.stamina = 0;
        } else {
            this.stamina += dt * 0.15; // Recover stamina
            if (this.stamina > 1) this.stamina = 1.0;
        }

        this.vel.x *= this.friction;
        this.vel.y *= this.friction;

        const currentMax = (this.isSprinting && this.stamina > 0 && !this.isGoalie) ? this.maxSpeed * 1.35 : this.maxSpeed;
        const spd2 = Math.sqrt(this.vel.x**2 + this.vel.y**2);
        if (spd2 > currentMax) {
            this.vel.x = (this.vel.x / spd2) * currentMax;
            this.vel.y = (this.vel.y / spd2) * currentMax;
        }

        this.pos.x += this.vel.x;
        this.pos.y += this.vel.y;

        // Smooth angle tracking
        if (spd2 > 0.4) {
            const target = Math.atan2(this.vel.y, this.vel.x);
            let delta = target - this.angle;
            while (delta >  Math.PI) delta -= Math.PI * 2;
            while (delta < -Math.PI) delta += Math.PI * 2;
            this.angle += delta * 0.20;
        }

        if (spd2 > 0.5) this.skatePhase += dt * spd2 * 3.2;
    }

    render(ctx, isControlled) {
        const spd = Math.sqrt(this.vel.x**2 + this.vel.y**2);

        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);

        // ── Skate trails (ice cuts) ──────────────────────────────────────────
        if (spd > 1.2) {
            const back = this.angle + Math.PI;
            const spread = 5.5;
            for (let s = -1; s <= 1; s += 2) {
                const offX = Math.cos(this.angle + Math.PI / 2) * s * spread;
                const offY = Math.sin(this.angle + Math.PI / 2) * s * spread;
                const trailLen = spd * 2.8;
                ctx.beginPath();
                ctx.moveTo(offX, offY);
                ctx.lineTo(offX + Math.cos(back) * trailLen, offY + Math.sin(back) * trailLen);
                ctx.strokeStyle = `rgba(160,220,255,${Math.min(spd / 12, 0.45)})`;
                ctx.lineWidth = 1.5;
                ctx.lineCap = 'round';
                ctx.stroke();
            }
        }

        ctx.rotate(this.angle + Math.PI / 2);

        // ── Shadow ──────────────────────────────────────────────────────────
        ctx.beginPath();
        ctx.ellipse(3, 6, this.radius + 3, this.radius * 0.4, 0, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(0,0,0,0.25)';
        ctx.fill();

        if (this.hitFlash > 0 && Math.floor(this.hitFlash * 14) % 2 === 0) {
            // Flash white on hit
            rrect(ctx, -12, -17, 24, 33, 8);
            ctx.fillStyle = '#fff';
            ctx.shadowBlur = 12; ctx.shadowColor = '#fff';
            ctx.fill();
            ctx.shadowBlur = 0;
        } else {
            // ── Jersey body ──────────────────────────────────────────────────
            rrect(ctx, -12, -17, 24, 33, 8);
            const jg = ctx.createLinearGradient(-12, -17, 12, 16);
            jg.addColorStop(0, this.cTrim);
            jg.addColorStop(0.6, this.cBody);
            jg.addColorStop(1, this.cHelmet);
            ctx.fillStyle = jg;
            ctx.fill();

            // Jersey border
            ctx.strokeStyle = 'rgba(255,255,255,0.18)';
            ctx.lineWidth = 1.5;
            ctx.stroke();

            // Shoulder stripe (team color accent)
            ctx.fillStyle = 'rgba(255,255,255,0.15)';
            ctx.fillRect(-12, -5, 24, 5);

            // Goalie chest pad detail
            if (this.isGoalie) {
                rrect(ctx, -12, -3, 24, 16, 4);
                ctx.fillStyle = 'rgba(255,255,255,0.08)';
                ctx.fill();
                ctx.strokeStyle = 'rgba(255,255,255,0.12)';
                ctx.lineWidth = 1;
                ctx.stroke();
            }

            // ── Helmet ──────────────────────────────────────────────────────
            ctx.beginPath();
            ctx.arc(0, -17, this.isGoalie ? 11 : 10, Math.PI, Math.PI * 2);
            const hg = ctx.createRadialGradient(-3, -20, 1, 0, -17, 10);
            hg.addColorStop(0, this.cTrim);
            hg.addColorStop(1, this.cHelmet);
            ctx.fillStyle = hg;
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.15)';
            ctx.lineWidth = 1;
            ctx.stroke();

            // Visor (tinted glass effect)
            ctx.beginPath();
            ctx.moveTo(-9.5, -17);
            ctx.lineTo(9.5, -17);
            if (this.isGoalie) {
                // Full cage for goalie
                ctx.strokeStyle = 'rgba(220,240,255,0.8)';
                ctx.lineWidth = 2.5;
                ctx.stroke();
                // Cage bars
                for (let bx = -7; bx <= 7; bx += 3.5) {
                    ctx.beginPath();
                    ctx.moveTo(bx, -17);
                    ctx.lineTo(bx, -10);
                    ctx.strokeStyle = 'rgba(180,220,255,0.5)';
                    ctx.lineWidth = 0.8;
                    ctx.stroke();
                }
            } else {
                ctx.strokeStyle = 'rgba(150,225,255,0.75)';
                ctx.lineWidth = 3;
                ctx.stroke();
            }
        }

        // ── Jersey number ────────────────────────────────────────────────────
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.font = `bold ${this.isGoalie ? 11 : 10}px Oswald`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.number, 0, 5);

        // ── Stick ────────────────────────────────────────────────────────────
        if (!this.isGoalie) {
            const stickWobble = spd > 0.5 ? Math.sin(this.skatePhase) * 0.09 : 0;
            ctx.rotate(stickWobble);
            // Stick shaft
            ctx.strokeStyle = '#7d5a35';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(10, -2);
            ctx.lineTo(20, 14);
            ctx.lineTo(18, 23);
            ctx.stroke();
            // Blade
            ctx.strokeStyle = '#2a2a2a';
            ctx.lineWidth = 3.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(15, 21);
            ctx.lineTo(22, 23);
            ctx.stroke();
        } else {
            // Goalie stick (wider blade)
            ctx.strokeStyle = '#7d5a35';
            ctx.lineWidth = 2.5;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(10, 0);
            ctx.lineTo(18, 16);
            ctx.stroke();
            ctx.strokeStyle = '#2a2a2a';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.moveTo(11, 14);
            ctx.lineTo(26, 18);
            ctx.stroke();
            // Blocker pad
            ctx.fillStyle = this.cTrim;
            rrect(ctx, -14, 6, 10, 16, 3);
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,255,255,0.2)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        ctx.restore(); // un-rotate + un-translate

        // ── Controlled player highlight ──────────────────────────────────────
        if (isControlled) {
            const pulse = 0.5 + 0.5 * Math.sin(Date.now() * 0.008);

            // Outer glow ring
            ctx.save();
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 10 + pulse * 3, 0, Math.PI * 2);
            ctx.strokeStyle = `rgba(255,225,0,${0.55 + pulse * 0.45})`;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 10 * pulse;
            ctx.shadowColor = '#ffe500';
            ctx.setLineDash([5, 4]);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.shadowBlur = 0;
            ctx.restore();

            // Name tag
            const name = PLAYER_NAMES[this.number % PLAYER_NAMES.length];
            ctx.save();
            ctx.font = 'bold 9px Oswald';
            const tw = ctx.measureText(name).width;
            const tx = this.pos.x - tw / 2 - 5;
            const ty = this.pos.y + this.radius + 13;
            // Tag background
            rrect(ctx, tx, ty, tw + 10, 14, 4);
            ctx.fillStyle = 'rgba(0,0,0,0.78)';
            ctx.fill();
            ctx.strokeStyle = 'rgba(255,225,0,0.35)';
            ctx.lineWidth = 1;
            ctx.stroke();
            // Tag text
            ctx.fillStyle = '#ffe500';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(name, this.pos.x, ty + 7);
            ctx.restore();

            // Stamina ring
            if (this.stamina < 1.0 || this.isSprinting) {
                ctx.save();
                ctx.beginPath();
                ctx.arc(this.pos.x, this.pos.y, this.radius + 15, -Math.PI / 2, -Math.PI / 2 + this.stamina * Math.PI * 2);
                ctx.strokeStyle = this.stamina < 0.2 ? '#e74c3c' : (this.stamina < 0.5 ? '#f39c12' : '#2ecc71');
                ctx.lineWidth = 2.5;
                ctx.stroke();
                
                // Sprint trail
                if (this.isSprinting) {
                    ctx.shadowBlur = 8;
                    ctx.shadowColor = ctx.strokeStyle;
                    ctx.stroke();
                }
                ctx.restore();
            }
        }

        // ── Puck possession indicator ────────────────────────────────────────
        if (this.hasPuck) {
            ctx.save();
            const pg = 0.5 + 0.5 * Math.sin(Date.now() * 0.012);
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 4 + pg, 0, Math.PI * 2);
            ctx.strokeStyle = this.team === 0
                ? `rgba(231,76,60,${0.6 + pg * 0.4})`
                : `rgba(52,152,219,${0.6 + pg * 0.4})`;
            ctx.lineWidth = 2.5;
            ctx.shadowBlur = 8;
            ctx.shadowColor = this.cMain;
            ctx.stroke();
            ctx.shadowBlur = 0;
            ctx.restore();
        }

        // ── Stun stars ───────────────────────────────────────────────────────
        if (this.stunTimer > 0.3) {
            const starCount = 3;
            const starR = this.radius + 12;
            for (let s = 0; s < starCount; s++) {
                const a = (Date.now() * 0.006 + s * (Math.PI * 2 / starCount)) % (Math.PI * 2);
                ctx.save();
                ctx.translate(
                    this.pos.x + Math.cos(a) * starR,
                    this.pos.y + Math.sin(a) * starR - 4
                );
                ctx.font = '9px serif';
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.globalAlpha = Math.min(this.stunTimer, 0.9);
                ctx.fillText('⭐', 0, 0);
                ctx.restore();
            }
        }
    }

    // AI helpers
    _seek(tx, ty) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;
        this.applyForce((dx/d) * 1.0, (dy/d) * 1.0);
    }

    _arrive(tx, ty, slowR = 60) {
        const dx = tx - this.pos.x, dy = ty - this.pos.y;
        const d = Math.sqrt(dx*dx + dy*dy) || 1;
        const s = d < slowR ? (d / slowR) : 1;
        this.applyForce((dx/d) * 0.7 * s, (dy/d) * 0.7 * s);
    }
}

// ─── RINK ────────────────────────────────────────────────────────────────────
export class Rink {
    constructor() {
        this.w = 500;
        this.h = 900;
        this.R = 68;
        this.goalW = 88;
        this.goalD = 30;
        this.goalLineY0 = 78;
        this.goalLineY1 = this.h - 78;
    }

    confine(entity) {
        const r = entity.radius;
        const { w, h, R } = this;

        if (entity.pos.x - r < 0)   { entity.pos.x = r;     entity.vel.x = Math.abs(entity.vel.x) * 0.42; }
        if (entity.pos.x + r > w)   { entity.pos.x = w - r; entity.vel.x = -Math.abs(entity.vel.x) * 0.42; }
        if (entity.pos.y - r < 0)   { entity.pos.y = r;     entity.vel.y = Math.abs(entity.vel.y) * 0.42; }
        if (entity.pos.y + r > h)   { entity.pos.y = h - r; entity.vel.y = -Math.abs(entity.vel.y) * 0.42; }

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
                    entity.vel.x -= 1.55 * vn * nx;
                    entity.vel.y -= 1.55 * vn * ny;
                }
            }
        }
    }

    checkGoal(puck) {
        const hw = this.goalW / 2;
        const cx = this.w / 2;
        // Team 0 scores in top goal (y < goalLineY0)
        if (puck.pos.y < this.goalLineY0 &&
            puck.pos.y > this.goalLineY0 - this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) return 0;
        // Team 1 scores in bottom goal (y > goalLineY1)
        if (puck.pos.y > this.goalLineY1 &&
            puck.pos.y < this.goalLineY1 + this.goalD &&
            Math.abs(puck.pos.x - cx) < hw) return 1;
        return -1;
    }

    render(ctx) {
        const { w, h, R } = this;
        const cx = w / 2, cy = h / 2;

        // ── Dark arena/stadium background ─────────────────────────────────────
        ctx.fillStyle = '#070c16';
        ctx.fillRect(-600, -600, w + 1200, h + 1200);

        // Crowd: concentric rows with color variation
        for (let i = 14; i >= 1; i--) {
            const pad = i * 38;
            const hue = 215 + i * 3;
            const lt  = 6 + i * 1.1;
            rrect(ctx, -pad, -pad, w + pad*2, h + pad*2, R + pad);
            ctx.fillStyle = `hsl(${hue},22%,${lt}%)`;
            ctx.fill();
        }

        // Boards glow
        rrect(ctx, -5, -5, w+10, h+10, R+5);
        ctx.strokeStyle = 'rgba(80,160,255,0.12)';
        ctx.lineWidth = 14;
        ctx.stroke();

        // ── Ice surface ───────────────────────────────────────────────────────
        rrect(ctx, 0, 0, w, h, R);
        const iceG = ctx.createLinearGradient(0, 0, 0, h);
        iceG.addColorStop(0,    '#bde0f5');
        iceG.addColorStop(0.35, '#d8eefc');
        iceG.addColorStop(0.5,  '#e2f3ff');
        iceG.addColorStop(0.65, '#d8eefc');
        iceG.addColorStop(1,    '#bde0f5');
        ctx.fillStyle = iceG;
        ctx.fill();

        // Ice shine
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();
        const shine = ctx.createRadialGradient(cx * 0.55, cy * 0.4, 0, cx, cy, Math.max(w, h) * 0.75);
        shine.addColorStop(0,   'rgba(255,255,255,0.22)');
        shine.addColorStop(0.4, 'rgba(255,255,255,0.07)');
        shine.addColorStop(1,   'rgba(200,225,255,0.03)');
        ctx.fillStyle = shine;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        // ── Ice markings (clipped) ────────────────────────────────────────────
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();

        // Goal lines (red)
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 4;
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY0); ctx.lineTo(w, this.goalLineY0); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, this.goalLineY1); ctx.lineTo(w, this.goalLineY1); ctx.stroke();

        // Blue lines (thicker, more vibrant)
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 9;
        const bOff = 205;
        ctx.beginPath(); ctx.moveTo(0, cy - bOff); ctx.lineTo(w, cy - bOff); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, cy + bOff); ctx.lineTo(w, cy + bOff); ctx.stroke();

        // Center red line (dashed)
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 5;
        ctx.setLineDash([16, 9]);
        ctx.beginPath(); ctx.moveTo(0, cy); ctx.lineTo(w, cy); ctx.stroke();
        ctx.setLineDash([]);

        // Center circle
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 3.5;
        ctx.beginPath(); ctx.arc(cx, cy, 74, 0, Math.PI * 2); ctx.stroke();

        // Center dot
        ctx.beginPath(); ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#c0392b'; ctx.fill();

        // Faceoff circles (zone)
        const faceoffDots = [
            [cx - 112, cy - 178], [cx + 112, cy - 178],
            [cx - 112, cy + 178], [cx + 112, cy + 178],
        ];
        faceoffDots.forEach(([fx, fy]) => {
            // Large faceoff circle
            ctx.strokeStyle = '#c0392b';
            ctx.lineWidth = 2.5;
            ctx.beginPath(); ctx.arc(fx, fy, 34, 0, Math.PI * 2); ctx.stroke();
            // Center dot
            ctx.beginPath(); ctx.arc(fx, fy, 5, 0, Math.PI * 2);
            ctx.fillStyle = '#c0392b'; ctx.fill();
            // Hash marks
            for (let ha = 0; ha < 4; ha++) {
                const ang = ha * Math.PI / 2;
                ctx.beginPath();
                ctx.moveTo(fx + Math.cos(ang) * 34, fy + Math.sin(ang) * 34);
                ctx.lineTo(fx + Math.cos(ang) * 44, fy + Math.sin(ang) * 44);
                ctx.strokeStyle = '#c0392b';
                ctx.lineWidth = 2;
                ctx.stroke();
            }
        });

        // Crease (goalie crease) - blue filled semi-circle
        ctx.fillStyle   = 'rgba(21,101,192,0.18)';
        ctx.strokeStyle = '#c0392b';
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.arc(cx, this.goalLineY0, 54, 0, Math.PI);           ctx.fill(); ctx.stroke();
        ctx.beginPath(); ctx.arc(cx, this.goalLineY1, 54, Math.PI, Math.PI * 2); ctx.fill(); ctx.stroke();

        // Center ice logo (stylized "SH" monogram)
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.30;
        // Hexagon shape
        ctx.fillStyle = '#1565c0';
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
            const a = i * Math.PI / 3 - Math.PI / 6;
            const ri = 52;
            i === 0 ? ctx.moveTo(Math.cos(a)*ri, Math.sin(a)*ri) : ctx.lineTo(Math.cos(a)*ri, Math.sin(a)*ri);
        }
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = 0.50;
        ctx.strokeStyle = '#5dade2';
        ctx.lineWidth = 2;
        ctx.stroke();
        // SH text
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = '#5dade2';
        ctx.font = 'bold 28px Oswald';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('SH', 0, 1);
        ctx.globalAlpha = 1;
        ctx.restore();

        // Inner board line
        rrect(ctx, 0, 0, w, h, R);
        ctx.strokeStyle = '#1565c0';
        ctx.lineWidth = 4;
        ctx.stroke();

        ctx.restore(); // end ice clip

        // ── Boards outer border ───────────────────────────────────────────────
        rrect(ctx, 0, 0, w, h, R);
        ctx.strokeStyle = '#e8edf2';
        ctx.lineWidth = 16;
        ctx.stroke();

        // ── Board ads ─────────────────────────────────────────────────────────
        ctx.save();
        rrect(ctx, 0, 0, w, h, R);
        ctx.clip();
        ctx.font = 'bold 10px Oswald';
        ctx.fillStyle = '#c0392b';
        ctx.textBaseline = 'middle';
        ctx.textAlign = 'center';
        ctx.fillText('SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY', cx, 7);
        ctx.fillText('SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY  •  SUPERSTAR HOCKEY', cx, h - 7);
        ctx.restore();

        // ── Goals ─────────────────────────────────────────────────────────────
        this._drawGoal(ctx, cx, this.goalLineY0, -1);
        this._drawGoal(ctx, cx, this.goalLineY1,  1);
    }

    _drawGoal(ctx, cx, ly, dir) {
        const hw = this.goalW / 2, d = this.goalD;
        const bY = ly - d * dir;

        // Net shadow/fill
        ctx.fillStyle = 'rgba(180,200,220,0.25)';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, bY);
        ctx.lineTo(cx + hw, bY);
        ctx.lineTo(cx + hw, ly);
        ctx.fill();

        // Net grid (vertical)
        ctx.strokeStyle = 'rgba(140,160,180,0.5)';
        ctx.lineWidth = 0.8;
        ctx.setLineDash([3, 3]);
        for (let x = cx - hw; x <= cx + hw; x += 9) {
            ctx.beginPath(); ctx.moveTo(x, ly); ctx.lineTo(x, bY); ctx.stroke();
        }
        // Net grid (horizontal)
        const steps = 4;
        for (let i = 1; i < steps; i++) {
            const gy = ly + (bY - ly) * (i / steps);
            ctx.beginPath(); ctx.moveTo(cx - hw, gy); ctx.lineTo(cx + hw, gy); ctx.stroke();
        }
        ctx.setLineDash([]);

        // Posts + crossbar
        ctx.strokeStyle = '#e74c3c';
        ctx.lineWidth = 6;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(cx - hw, ly);
        ctx.lineTo(cx - hw, bY);
        ctx.lineTo(cx + hw, bY);
        ctx.lineTo(cx + hw, ly);
        ctx.stroke();

        // Post highlights
        ctx.strokeStyle = 'rgba(255,150,150,0.6)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - hw + 1, ly);
        ctx.lineTo(cx - hw + 1, bY + dir * 2);
        ctx.moveTo(cx + hw - 1, ly);
        ctx.lineTo(cx + hw - 1, bY + dir * 2);
        ctx.stroke();
    }
}
