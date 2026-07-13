export class ParticleSystem {
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
                shape: opts.shape || 'circle', // 'circle' | 'star' | 'spark'
            });
        }
    }
    update() {
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx; p.y += p.vy;
            p.vy += p.gravity;
            p.vx *= 0.94; p.vy *= 0.94;
            p.life -= p.decay;
            if (p.life <= 0) this.particles.splice(i, 1);
        }
    }
    render(ctx) {
        this.particles.forEach(p => {
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            if (p.shape === 'spark') {
                ctx.beginPath();
                ctx.moveTo(p.x, p.y);
                ctx.lineTo(p.x - p.vx * 4, p.y - p.vy * 4);
                ctx.strokeStyle = p.color;
                ctx.lineWidth = p.r * p.life;
                ctx.lineCap = 'round';
                ctx.stroke();
            } else {
                ctx.beginPath();
                ctx.arc(p.x, p.y, Math.max(0, p.r * p.life), 0, Math.PI * 2);
                ctx.fillStyle = p.color;
                ctx.fill();
            }
            ctx.restore();
        });
    }
}
