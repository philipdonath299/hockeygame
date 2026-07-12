// ─── GAME ENGINE ──────────────────────────────────────────────────────────────
export class GameEngine {
    constructor(updateFn, renderFn) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        this.running  = false;
        this.lastTime = 0;
        this.FIXED_DT = 1 / 60;
        this.accumulator = 0;
    }

    start() {
        if (this.running) return;
        this.running  = true;
        this.lastTime = performance.now();
        requestAnimationFrame(t => this._loop(t));
    }

    stop() { this.running = false; }

    _loop(now) {
        if (!this.running) return;
        requestAnimationFrame(t => this._loop(t));

        let dt = (now - this.lastTime) / 1000;
        this.lastTime = now;
        if (dt > 0.2) dt = 0.2; // spiral-of-death guard

        this.accumulator += dt;
        while (this.accumulator >= this.FIXED_DT) {
            this.updateFn(this.FIXED_DT);
            this.accumulator -= this.FIXED_DT;
        }
        this.renderFn(this.accumulator / this.FIXED_DT);
    }
}

// ─── INPUT MANAGER ────────────────────────────────────────────────────────────
export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;

        this.joystick = {
            active:    false,
            touchId:   null,
            originX:   0,
            originY:   0,
            dx:        0,   // clamped delta, pixels
            dy:        0,
            vx:        0,   // normalized direction
            vy:        0,
            mag:       0,   // 0..1
            MAX_R:     55,
        };

        this.onRelease = null; // (vx, vy, mag) callback

        // Bind events
        const opts = { passive: false };
        canvas.addEventListener('touchstart',  e => this._onStart(e),  opts);
        canvas.addEventListener('touchmove',   e => this._onMove(e),   opts);
        canvas.addEventListener('touchend',    e => this._onEnd(e),    opts);
        canvas.addEventListener('touchcancel', e => this._onEnd(e),    opts);
    }

    _canvasPoint(touch) {
        const r  = this.canvas.getBoundingClientRect();
        const sx = this.canvas.width  / r.width;
        const sy = this.canvas.height / r.height;
        return {
            x: (touch.clientX - r.left) * sx,
            y: (touch.clientY - r.top)  * sy,
        };
    }

    _onStart(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            // Only accept touches on the LEFT 65% of the canvas
            const r = this.canvas.getBoundingClientRect();
            if (t.clientX - r.left > r.width * 0.65) continue;
            if (this.joystick.active) continue;

            const p = this._canvasPoint(t);
            this.joystick.active  = true;
            this.joystick.touchId = t.identifier;
            this.joystick.originX = p.x;
            this.joystick.originY = p.y;
            this._update(p.x, p.y);
        }
    }

    _onMove(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== this.joystick.touchId) continue;
            const p = this._canvasPoint(t);
            this._update(p.x, p.y);
        }
    }

    _onEnd(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== this.joystick.touchId) continue;
            if (this.onRelease && this.joystick.mag > 0.1) {
                this.onRelease(this.joystick.vx, this.joystick.vy, this.joystick.mag);
            }
            this.joystick.active  = false;
            this.joystick.touchId = null;
            this.joystick.dx      = 0;
            this.joystick.dy      = 0;
            this.joystick.vx      = 0;
            this.joystick.vy      = 0;
            this.joystick.mag     = 0;
        }
    }

    _update(x, y) {
        const js = this.joystick;
        let rawDx = x - js.originX;
        let rawDy = y - js.originY;
        const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);

        if (dist === 0) {
            js.vx = 0; js.vy = 0; js.mag = 0; js.dx = 0; js.dy = 0;
        } else {
            const clamped = Math.min(dist, js.MAX_R);
            js.vx  = rawDx / dist;
            js.vy  = rawDy / dist;
            js.mag = clamped / js.MAX_R;
            js.dx  = js.vx * clamped;
            js.dy  = js.vy * clamped;
        }
    }

    renderJoystick(ctx) {
        const js = this.joystick;
        if (!js.active) return;

        const ox = js.originX, oy = js.originY;
        const nx = ox + js.dx, ny = oy + js.dy;

        ctx.save();

        // Outer ring
        ctx.beginPath();
        ctx.arc(ox, oy, js.MAX_R, 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fill();

        // Direction spoke
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Nub
        const g = ctx.createRadialGradient(nx - 7, ny - 7, 2, nx, ny, 28);
        g.addColorStop(0, 'rgba(255,255,255,0.9)');
        g.addColorStop(1, 'rgba(180,180,180,0.55)');
        ctx.beginPath();
        ctx.arc(nx, ny, 28, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(0,0,0,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.restore();
    }
}
