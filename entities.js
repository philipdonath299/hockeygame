import { Vector, Collision } from './physics.js';

export class Entity {
    constructor(x, y, radius, mass) {
        this.pos = { x, y };
        this.vel = { x: 0, y: 0 };
        this.acc = { x: 0, y: 0 };
        this.radius = radius;
        this.mass = mass;
        this.restitution = 0.5;
        this.friction = 0.98; // Ice friction
        this.maxSpeed = 5;
    }

    applyForce(force) {
        const f = Vector.div(force, this.mass);
        this.acc = Vector.add(this.acc, f);
    }

    update(dt) {
        this.vel = Vector.add(this.vel, this.acc);
        this.vel = Vector.limit(this.vel, this.maxSpeed);
        // Apply friction
        this.vel = Vector.mult(this.vel, this.friction);
        
        // Position update using velocity (assuming dt is somewhat constant, simplified integration)
        // For true independence, multiply by dt * speedFactor
        this.pos.x += this.vel.x * dt * 60; 
        this.pos.y += this.vel.y * dt * 60;
        
        this.acc = { x: 0, y: 0 };
    }
}

export class Player extends Entity {
    constructor(x, y, team, id, isGoalie = false) {
        super(x, y, isGoalie ? 18 : 15, 10);
        this.team = team; // 0 for player, 1 for opponent
        this.id = id;
        this.isGoalie = isGoalie;
        this.maxSpeed = isGoalie ? 4.0 : 8.0; // Increased speed
        this.restitution = 0.2;
        this.hasPuck = false;
        this.stunTimer = 0;
        this.state = 'IDLE'; // IDLE, SEEK, PURSUIT, DEFEND
        
        this.color = team === 0 ? '#333' : '#fff';
        this.outline = team === 0 ? '#8b1c1c' : '#1c268b';
    }

    update(dt) {
        if (this.stunTimer > 0) {
            this.stunTimer -= dt;
            this.maxSpeed = this.isGoalie ? 2.0 : 3.5; // Slowed down while recovering
        } else {
            this.maxSpeed = this.isGoalie ? 4.0 : 8.0;
        }
        super.update(dt);
    }

    render(ctx, isControlled) {
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = this.outline;
        ctx.stroke();

        // Draw stick
        const heading = Vector.mag(this.vel) > 0.1 ? Math.atan2(this.vel.y, this.vel.x) : Math.PI/2;
        const stickLength = 20;
        ctx.beginPath();
        ctx.moveTo(this.pos.x, this.pos.y);
        ctx.lineTo(this.pos.x + Math.cos(heading) * stickLength, this.pos.y + Math.sin(heading) * stickLength);
        ctx.strokeStyle = '#a67c00'; // Wood color
        ctx.lineWidth = 3;
        ctx.stroke();

        // Render selection highlight if player is currently controlled via one-touch switching
        if (isControlled) {
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 6, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff0000';
            ctx.lineWidth = 2;
            ctx.setLineDash([5, 5]);
            ctx.stroke();
            ctx.setLineDash([]);
        }

        // Draw player number
        ctx.fillStyle = this.team === 0 ? '#fff' : '#000';
        ctx.font = '10px Oswald';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.id, this.pos.x, this.pos.y);
    }

    // Steering Behaviors
    seek(target) {
        const desired = Vector.sub(target, this.pos);
        const dmag = Vector.mag(desired);
        if (dmag === 0) return { x: 0, y: 0 };
        const normDesired = Vector.mult(Vector.normalize(desired), this.maxSpeed);
        return Vector.limit(Vector.sub(normDesired, this.vel), 0.6); // max force
    }

    arrive(target, slowdownRadius) {
        const desired = Vector.sub(target, this.pos);
        const d = Vector.mag(desired);
        if (d < 0.1) return { x: 0, y: 0 };
        
        let speed = this.maxSpeed;
        if (d < slowdownRadius) {
            speed = this.maxSpeed * (d / slowdownRadius);
        }
        
        const normDesired = Vector.mult(Vector.normalize(desired), speed);
        return Vector.limit(Vector.sub(normDesired, this.vel), 0.6);
    }
}

export class Puck extends Entity {
    constructor(x, y) {
        super(x, y, 6, 2);
        this.friction = 0.99; // Less friction, slides more
        this.maxSpeed = 15;
        this.restitution = 0.8; // Bouncy
        this.carrier = null;
    }

    render(ctx) {
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, this.radius, 0, Math.PI * 2);
        ctx.fillStyle = '#000';
        ctx.fill();
        // Dot in center
        ctx.beginPath();
        ctx.arc(this.pos.x, this.pos.y, 2, 0, Math.PI * 2);
        ctx.fillStyle = '#444';
        ctx.fill();
    }
}

export class Rink {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.boardsRadius = 150;
        this.goalWidth = 80;
        this.goalDepth = 30;
        this.goalOffset = 100;
    }

    // Handle collision with outer boards (including rounded corners)
    collideBoards(entity) {
        let collided = false;
        const r = this.boardsRadius;
        const eR = entity.radius;

        // 1. Basic AABB walls (straight sections)
        if (entity.pos.x < eR && entity.pos.y >= r && entity.pos.y <= this.height - r) {
            entity.pos.x = eR;
            entity.vel.x *= -entity.restitution;
            collided = true;
        } else if (entity.pos.x > this.width - eR && entity.pos.y >= r && entity.pos.y <= this.height - r) {
            entity.pos.x = this.width - eR;
            entity.vel.x *= -entity.restitution;
            collided = true;
        }

        if (entity.pos.y < eR && entity.pos.x >= r && entity.pos.x <= this.width - r) {
            entity.pos.y = eR;
            entity.vel.y *= -entity.restitution;
            collided = true;
        } else if (entity.pos.y > this.height - eR && entity.pos.x >= r && entity.pos.x <= this.width - r) {
            entity.pos.y = this.height - eR;
            entity.vel.y *= -entity.restitution;
            collided = true;
        }

        // 2. Rounded Corners
        const checkCorner = (cx, cy) => {
            const dx = entity.pos.x - cx;
            const dy = entity.pos.y - cy;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist > r - eR) {
                const overlap = dist - (r - eR);
                const nx = dx / dist;
                const ny = dy / dist;
                
                entity.pos.x -= nx * overlap;
                entity.pos.y -= ny * overlap;
                
                const dot = entity.vel.x * nx + entity.vel.y * ny;
                if (dot > 0) {
                    entity.vel.x -= (1 + entity.restitution) * dot * nx;
                    entity.vel.y -= (1 + entity.restitution) * dot * ny;
                }
                collided = true;
            }
        };

        if (entity.pos.x < r && entity.pos.y < r) checkCorner(r, r); // Top-left
        if (entity.pos.x > this.width - r && entity.pos.y < r) checkCorner(this.width - r, r); // Top-right
        if (entity.pos.x < r && entity.pos.y > this.height - r) checkCorner(r, this.height - r); // Bottom-left
        if (entity.pos.x > this.width - r && entity.pos.y > this.height - r) checkCorner(this.width - r, this.height - r); // Bottom-right

        return collided;
    }

    checkGoal(puck) {
        const gw = this.goalWidth / 2;
        // Top goal (Team 1 defends, Team 0 scores)
        if (puck.pos.y < this.goalOffset && puck.pos.y > this.goalOffset - this.goalDepth && puck.pos.x > this.width / 2 - gw && puck.pos.x < this.width / 2 + gw) return 0;
        // Bottom goal
        if (puck.pos.y > this.height - this.goalOffset && puck.pos.y < this.height - this.goalOffset + this.goalDepth && puck.pos.x > this.width / 2 - gw && puck.pos.x < this.width / 2 + gw) return 1;
        
        return -1;
    }

    render(ctx) {
        const cx = this.width / 2;
        const cy = this.height / 2;

        // Dark background outside the rink (stadium seats representation)
        ctx.fillStyle = '#1a1a24';
        ctx.fillRect(-2000, -2000, this.width + 4000, this.height + 4000);

        // Draw the rounded rink
        const r = this.boardsRadius;
        ctx.beginPath();
        if (ctx.roundRect) {
            ctx.roundRect(0, 0, this.width, this.height, r);
        } else {
            ctx.moveTo(r, 0);
            ctx.lineTo(this.width - r, 0);
            ctx.quadraticCurveTo(this.width, 0, this.width, r);
            ctx.lineTo(this.width, this.height - r);
            ctx.quadraticCurveTo(this.width, this.height, this.width - r, this.height);
            ctx.lineTo(r, this.height);
            ctx.quadraticCurveTo(0, this.height, 0, this.height - r);
            ctx.lineTo(0, r);
            ctx.quadraticCurveTo(0, 0, r, 0);
        }
        ctx.closePath();

        ctx.fillStyle = '#eaf5fa'; // Ice color
        ctx.fill();

        // Thick Boards border
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#f0d800'; // Yellow dash/board edge
        ctx.stroke();
        
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#0055a4'; // Blue trim
        ctx.stroke();

        // Clip all ice markings to not bleed out of the rounded rink
        ctx.save();
        ctx.clip();

        ctx.strokeStyle = '#c9302c'; // Red lines
        ctx.lineWidth = 3;

        // Center red line
        ctx.beginPath();
        ctx.moveTo(0, cy);
        ctx.lineTo(this.width, cy);
        ctx.stroke();

        // Blue lines
        ctx.strokeStyle = '#286090';
        ctx.beginPath();
        ctx.moveTo(0, cy - 250);
        ctx.lineTo(this.width, cy - 250);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, cy + 250);
        ctx.lineTo(this.width, cy + 250);
        ctx.stroke();
        
        // Goal lines (Red)
        ctx.strokeStyle = '#c9302c';
        ctx.beginPath();
        ctx.moveTo(0, this.goalOffset);
        ctx.lineTo(this.width, this.goalOffset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, this.height - this.goalOffset);
        ctx.lineTo(this.width, this.height - this.goalOffset);
        ctx.stroke();

        // Center circle
        ctx.beginPath();
        ctx.arc(cx, cy, 80, 0, Math.PI * 2);
        ctx.strokeStyle = '#286090';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Faceoff dots
        ctx.fillStyle = '#c9302c';
        const dots = [
            { x: cx, y: cy },
            { x: cx - 150, y: cy - 350 }, { x: cx + 150, y: cy - 350 },
            { x: cx - 150, y: cy + 350 }, { x: cx + 150, y: cy + 350 }
        ];
        dots.forEach(d => {
            ctx.beginPath();
            ctx.arc(d.x, d.y, 6, 0, Math.PI * 2);
            ctx.fill();
        });

        // Creases
        ctx.fillStyle = 'rgba(40, 96, 144, 0.3)';
        ctx.beginPath();
        ctx.arc(cx, this.goalOffset, 50, 0, Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, this.height - this.goalOffset, 50, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore(); // remove clip

        // Goals rendering (Draw them after clipping so they can sit on the line properly without being cut)
        ctx.strokeStyle = '#d9534f'; // Red goal posts
        ctx.lineWidth = 4;
        
        // Top goal
        ctx.beginPath();
        ctx.moveTo(cx - this.goalWidth/2, this.goalOffset);
        ctx.lineTo(cx - this.goalWidth/2, this.goalOffset - this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.goalOffset - this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.goalOffset);
        ctx.stroke();

        // Bottom goal
        ctx.beginPath();
        ctx.moveTo(cx - this.goalWidth/2, this.height - this.goalOffset);
        ctx.lineTo(cx - this.goalWidth/2, this.height - this.goalOffset + this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.height - this.goalOffset + this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.height - this.goalOffset);
        ctx.stroke();
    }
}
