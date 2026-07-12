// Math & Physics utilities

export const Vector = {
    add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
    sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
    mult: (v, s) => ({ x: v.x * s, y: v.y * s }),
    mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
    normalize: (v) => {
        const m = Math.sqrt(v.x * v.x + v.y * v.y);
        return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
    },
    dist: (a, b) => {
        const dx = b.x - a.x, dy = b.y - a.y;
        return Math.sqrt(dx * dx + dy * dy);
    },
    dot: (a, b) => a.x * b.x + a.y * b.y,
    limit: (v, max) => {
        const m = Math.sqrt(v.x * v.x + v.y * v.y);
        if (m > max) return { x: (v.x / m) * max, y: (v.y / m) * max };
        return { x: v.x, y: v.y };
    }
};

export function resolveCircleCollision(a, b) {
    const dx = b.pos.x - a.pos.x;
    const dy = b.pos.y - a.pos.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minDist = a.radius + b.radius;

    if (dist >= minDist || dist === 0) return false;

    // Normal vector
    const nx = dx / dist;
    const ny = dy / dist;

    // Separate (push apart so they don't overlap)
    const overlap = (minDist - dist) * 0.5;
    a.pos.x -= nx * overlap;
    a.pos.y -= ny * overlap;
    b.pos.x += nx * overlap;
    b.pos.y += ny * overlap;

    // Relative velocity along normal
    const dvx = b.vel.x - a.vel.x;
    const dvy = b.vel.y - a.vel.y;
    const vn = dvx * nx + dvy * ny;

    // Already separating
    if (vn > 0) return true;

    const e = 0.4; // restitution
    const totalMass = a.mass + b.mass;
    const impulse = -(1 + e) * vn / totalMass;

    a.vel.x -= impulse * b.mass * nx;
    a.vel.y -= impulse * b.mass * ny;
    b.vel.x += impulse * a.mass * nx;
    b.vel.y += impulse * a.mass * ny;

    return true;
}
