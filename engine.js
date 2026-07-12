export class GameEngine {
    constructor(updateFn, renderFn) {
        this.updateFn = updateFn;
        this.renderFn = renderFn;
        this.lastTime = performance.now();
        this.accumulator = 0;
        this.timestep = 1 / 60; // 60 updates per second (in seconds)
        this.rafId = null;
        this.running = false;
    }

    start() {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.rafId = requestAnimationFrame((t) => this.loop(t));
    }

    stop() {
        this.running = false;
        cancelAnimationFrame(this.rafId);
    }

    loop(currentTime) {
        if (!this.running) return;
        
        this.rafId = requestAnimationFrame((t) => this.loop(t));
        
        let frameTime = (currentTime - this.lastTime) / 1000; // Convert to seconds
        this.lastTime = currentTime;
        
        // Prevent spiral of death if tab is inactive
        if (frameTime > 0.25) {
            frameTime = 0.25;
        }

        this.accumulator += frameTime;

        while (this.accumulator >= this.timestep) {
            this.updateFn(this.timestep);
            this.accumulator -= this.timestep;
        }

        // Pass interpolation alpha for smooth rendering
        const alpha = this.accumulator / this.timestep;
        this.renderFn(alpha);
    }
}

export class InputManager {
    constructor(canvas) {
        this.canvas = canvas;
        
        // State
        this.joystick = {
            active: false,
            touchId: null,
            origin: { x: 0, y: 0 },
            current: { x: 0, y: 0 },
            vector: { x: 0, y: 0 }, // Normalized direction
            magnitude: 0, // 0 to 1
            startTime: 0
        };

        // Event hooks
        this.onJoystickRelease = null; // (vector, magnitude) => {}

        this.bindEvents();
    }

    bindEvents() {
        // passive: false is required to allow e.preventDefault()
        this.canvas.addEventListener('touchstart', this.handleTouchStart.bind(this), { passive: false });
        this.canvas.addEventListener('touchmove', this.handleTouchMove.bind(this), { passive: false });
        this.canvas.addEventListener('touchend', this.handleTouchEnd.bind(this), { passive: false });
        this.canvas.addEventListener('touchcancel', this.handleTouchEnd.bind(this), { passive: false });
    }

    handleTouchStart(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (touch.clientX - rect.left) * scaleX;
            const y = (touch.clientY - rect.top) * scaleY;

            // Restrict joystick origin to the left half of the screen
            if (touch.clientX - rect.left < rect.width * 0.6) {
                if (!this.joystick.active) {
                    this.joystick.active = true;
                    this.joystick.touchId = touch.identifier;
                    this.joystick.origin = { x, y };
                    this.joystick.current = { x, y };
                    this.joystick.startTime = performance.now();
                    this.updateJoystick();
                }
            }
        }
    }

    handleTouchMove(e) {
        e.preventDefault();
        const rect = this.canvas.getBoundingClientRect();

        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];
            const scaleX = this.canvas.width / rect.width;
            const scaleY = this.canvas.height / rect.height;
            const x = (touch.clientX - rect.left) * scaleX;
            const y = (touch.clientY - rect.top) * scaleY;

            if (touch.identifier === this.joystick.touchId) {
                this.joystick.current = { x, y };
                this.updateJoystick();
            }
        }
    }

    handleTouchEnd(e) {
        e.preventDefault();
        
        for (let i = 0; i < e.changedTouches.length; i++) {
            const touch = e.changedTouches[i];

            if (touch.identifier === this.joystick.touchId) {
                // Dispatch release event before clearing state
                if (this.onJoystickRelease && this.joystick.magnitude > 0.1) {
                    this.onJoystickRelease(this.joystick.vector, this.joystick.magnitude);
                }

                this.joystick.active = false;
                this.joystick.touchId = null;
                this.joystick.vector = { x: 0, y: 0 };
                this.joystick.magnitude = 0;
            }
        }
    }

    updateJoystick() {
        const dx = this.joystick.current.x - this.joystick.origin.x;
        const dy = this.joystick.current.y - this.joystick.origin.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        
        // Maximum pixels the joystick can move from origin
        const maxRadius = 50; 
        
        if (dist === 0) {
            this.joystick.vector = { x: 0, y: 0 };
            this.joystick.magnitude = 0;
        } else {
            const clampedDist = Math.min(dist, maxRadius);
            this.joystick.vector = { x: dx / dist, y: dy / dist };
            this.joystick.magnitude = clampedDist / maxRadius;
        }
    }
}
