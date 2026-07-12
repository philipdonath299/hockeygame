// Math & Physics utilities

export const Vector = {
    add: (v1, v2) => ({ x: v1.x + v2.x, y: v1.y + v2.y }),
    sub: (v1, v2) => ({ x: v1.x - v2.x, y: v1.y - v2.y }),
    mult: (v, scalar) => ({ x: v.x * scalar, y: v.y * scalar }),
    div: (v, scalar) => ({ x: v.x / scalar, y: v.y / scalar }),
    mag: (v) => Math.sqrt(v.x * v.x + v.y * v.y),
    normalize: (v) => {
        const m = Vector.mag(v);
        return m === 0 ? { x: 0, y: 0 } : { x: v.x / m, y: v.y / m };
    },
    dist: (v1, v2) => Math.sqrt(Math.pow(v2.x - v1.x, 2) + Math.pow(v2.y - v1.y, 2)),
    limit: (v, max) => {
        const m = Vector.mag(v);
        if (m > max) {
            return Vector.mult(Vector.normalize(v), max);
        }
        return { ...v };
    }
};

export const Collision = {
    circleCircle: (c1, c2) => {
        const dist = Vector.dist(c1.pos, c2.pos);
        return dist < (c1.radius + c2.radius);
    },
    
    // Resolve collision between two circles (e.g. player and puck)
    resolveElastic: (c1, c2) => {
        const normal = Vector.normalize(Vector.sub(c1.pos, c2.pos));
        const relativeVelocity = Vector.sub(c1.vel, c2.vel);
        const velocityAlongNormal = relativeVelocity.x * normal.x + relativeVelocity.y * normal.y;
        
        // Do not resolve if velocities are separating
        if (velocityAlongNormal > 0) return;

        // Restitution (bounciness)
        const e = Math.min(c1.restitution || 0.5, c2.restitution || 0.5);
        
        let j = -(1 + e) * velocityAlongNormal;
        j /= 1 / c1.mass + 1 / c2.mass;

        const impulse = Vector.mult(normal, j);

        c1.vel = Vector.add(c1.vel, Vector.mult(impulse, 1 / c1.mass));
        c2.vel = Vector.sub(c2.vel, Vector.mult(impulse, 1 / c2.mass));
        
        // Positional correction to prevent sinking
        const percent = 0.8; // usually 0.2 to 0.8
        const slop = 0.01; // usually 0.01 to 0.1
        const penetration = (c1.radius + c2.radius) - Vector.dist(c1.pos, c2.pos);
        if (penetration > slop) {
            const correctionMag = (penetration / (1/c1.mass + 1/c2.mass)) * percent;
            const correction = Vector.mult(normal, correctionMag);
            c1.pos = Vector.add(c1.pos, Vector.mult(correction, 1/c1.mass));
            c2.pos = Vector.sub(c2.pos, Vector.mult(correction, 1/c2.mass));
        }
    }
};
