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
        if (dt > 0.2) dt = 0.2;

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
            active: false, touchId: null,
            originX: 0, originY: 0,
            dx: 0, dy: 0,
            vx: 0, vy: 0,
            mag: 0,
            MAX_R: 58,
        };

        this.onRelease = null;

        const opts = { passive: false };
        canvas.addEventListener('touchstart',  e => this._onStart(e), opts);
        canvas.addEventListener('touchmove',   e => this._onMove(e),  opts);
        canvas.addEventListener('touchend',    e => this._onEnd(e),   opts);
        canvas.addEventListener('touchcancel', e => this._onEnd(e),   opts);

        // Mouse support for desktop testing
        canvas.addEventListener('mousedown',  e => this._onMouseStart(e));
        canvas.addEventListener('mousemove',  e => this._onMouseMove(e));
        canvas.addEventListener('mouseup',    e => this._onMouseEnd(e));
        canvas.addEventListener('mouseleave', e => this._onMouseEnd(e));
    }

    _pt(touch) {
        const r = this.canvas.getBoundingClientRect();
        return {
            x: (touch.clientX - r.left) * (this.canvas.width  / r.width),
            y: (touch.clientY - r.top)  * (this.canvas.height / r.height),
        };
    }

    _isRightZone(clientX) {
        const r = this.canvas.getBoundingClientRect();
        // Joystick only allowed on left 65% of screen
        return (clientX - r.left) > r.width * 0.65;
    }

    _onStart(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (this._isRightZone(t.clientX)) continue;
            if (this.joystick.active) continue;
            const p = this._pt(t);
            Object.assign(this.joystick, {
                active: true, touchId: t.identifier,
                originX: p.x, originY: p.y
            });
            this._update(p.x, p.y);
        }
    }

    _onMove(e) {
        e.preventDefault();
        for (const t of e.changedTouches) {
            if (t.identifier !== this.joystick.touchId) continue;
            const p = this._pt(t);
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
            Object.assign(this.joystick, {
                active: false, touchId: null,
                dx: 0, dy: 0, vx: 0, vy: 0, mag: 0
            });
        }
    }

    // Mouse support
    _onMouseStart(e) {
        if (this._isRightZone(e.clientX)) return;
        if (this.joystick.active) return;
        const p = this._pt(e);
        Object.assign(this.joystick, {
            active: true, touchId: 'mouse',
            originX: p.x, originY: p.y
        });
        this._update(p.x, p.y);
    }

    _onMouseMove(e) {
        if (this.joystick.touchId !== 'mouse') return;
        const p = this._pt(e);
        this._update(p.x, p.y);
    }

    _onMouseEnd(e) {
        if (this.joystick.touchId !== 'mouse') return;
        if (this.onRelease && this.joystick.mag > 0.1) {
            this.onRelease(this.joystick.vx, this.joystick.vy, this.joystick.mag);
        }
        Object.assign(this.joystick, {
            active: false, touchId: null,
            dx: 0, dy: 0, vx: 0, vy: 0, mag: 0
        });
    }

    _update(x, y) {
        const js = this.joystick;
        const rawDx = x - js.originX, rawDy = y - js.originY;
        const dist = Math.sqrt(rawDx * rawDx + rawDy * rawDy);
        if (dist === 0) { js.vx = 0; js.vy = 0; js.mag = 0; js.dx = 0; js.dy = 0; return; }
        const cl = Math.min(dist, js.MAX_R);
        js.vx = rawDx / dist; js.vy = rawDy / dist;
        js.mag = cl / js.MAX_R;
        js.dx = js.vx * cl; js.dy = js.vy * cl;
    }

    renderJoystick(ctx) {
        const js = this.joystick;
        if (!js.active) return;
        const ox = js.originX, oy = js.originY;
        const nx = ox + js.dx,  ny = oy + js.dy;

        ctx.save();

        // Outer base ring with subtle glow
        ctx.beginPath();
        ctx.arc(ox, oy, js.MAX_R, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.05)';
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.22)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Compass tick marks
        for (let a = 0; a < Math.PI * 2; a += Math.PI / 4) {
            const cos = Math.cos(a), sin = Math.sin(a);
            ctx.beginPath();
            ctx.moveTo(ox + cos * (js.MAX_R - 10), oy + sin * (js.MAX_R - 10));
            ctx.lineTo(ox + cos * js.MAX_R, oy + sin * js.MAX_R);
            ctx.strokeStyle = 'rgba(255,255,255,0.3)';
            ctx.lineWidth = 2;
            ctx.stroke();
        }

        // Direction line
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(nx, ny);
        ctx.strokeStyle = 'rgba(255,255,255,0.18)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // Nub (stick)
        const nubR = 28;
        const g = ctx.createRadialGradient(nx - 8, ny - 8, 2, nx, ny, nubR);
        g.addColorStop(0, 'rgba(255,255,255,0.95)');
        g.addColorStop(0.35, 'rgba(200,210,235,0.80)');
        g.addColorStop(1, 'rgba(100,120,160,0.55)');
        ctx.beginPath();
        ctx.arc(nx, ny, nubR, 0, Math.PI * 2);
        ctx.fillStyle = g;
        ctx.fill();
        ctx.strokeStyle = 'rgba(255,255,255,0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();

        // Magnitude arc on nub
        if (js.mag > 0.15) {
            ctx.beginPath();
            ctx.arc(nx, ny, nubR, -Math.PI / 2, -Math.PI / 2 + js.mag * Math.PI * 2);
            const arcColor = js.mag > 0.85 ? '#e74c3c' : js.mag > 0.5 ? '#f39c12' : '#2ecc71';
            ctx.strokeStyle = arcColor;
            ctx.lineWidth = 3;
            ctx.shadowBlur = 8;
            ctx.shadowColor = arcColor;
            ctx.stroke();
            ctx.shadowBlur = 0;
        }

        ctx.restore();
    }
}
