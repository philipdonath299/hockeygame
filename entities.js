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
    constructor(x, y, team, id) {
        super(x, y, 15, 10);
        this.team = team; // 0 for player, 1 for opponent
        this.id = id;
        this.maxSpeed = 8.0; // Increased speed
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
            this.maxSpeed = 3.5; // Slowed down while recovering
        } else {
            this.maxSpeed = 8.0;
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
        this.boardsRadius = 50;
        this.goalWidth = 80;
        this.goalDepth = 30;
    }

    // Handle collision with outer boards
    collideBoards(entity) {
        let collided = false;
        
        // Left & Right bounds
        if (entity.pos.x < entity.radius) {
            entity.pos.x = entity.radius;
            entity.vel.x *= -entity.restitution;
            collided = true;
        } else if (entity.pos.x > this.width - entity.radius) {
            entity.pos.x = this.width - entity.radius;
            entity.vel.x *= -entity.restitution;
            collided = true;
        }

        // Top & Bottom bounds (excluding goal areas)
        const isGoalX = entity.pos.x > (this.width / 2 - this.goalWidth / 2) && 
                        entity.pos.x < (this.width / 2 + this.goalWidth / 2);

        if (entity.pos.y < entity.radius) {
            if (!isGoalX) {
                entity.pos.y = entity.radius;
                entity.vel.y *= -entity.restitution;
                collided = true;
            }
        } else if (entity.pos.y > this.height - entity.radius) {
            if (!isGoalX) {
                entity.pos.y = this.height - entity.radius;
                entity.vel.y *= -entity.restitution;
                collided = true;
            }
        }
        return collided;
    }

    checkGoal(puck) {
        if (puck.pos.y < -this.goalDepth / 2) return 1; // Top goal scored (team 0 scored)
        if (puck.pos.y > this.height + this.goalDepth / 2) return 0; // Bottom goal scored (team 1 scored)
        return -1;
    }

    render(ctx) {
        const cx = this.width / 2;
        const cy = this.height / 2;

        ctx.fillStyle = '#eaf5fa'; // Ice color
        ctx.fillRect(0, 0, this.width, this.height);

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
        ctx.moveTo(0, cy - 150);
        ctx.lineTo(this.width, cy - 150);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, cy + 150);
        ctx.lineTo(this.width, cy + 150);
        ctx.stroke();

        // Center circle
        ctx.beginPath();
        ctx.arc(cx, cy, 60, 0, Math.PI * 2);
        ctx.strokeStyle = '#286090';
        ctx.stroke();

        // Faceoff dots
        ctx.fillStyle = '#c9302c';
        const dots = [
            { x: cx, y: cy },
            { x: cx - 60, y: cy - 200 }, { x: cx + 60, y: cy - 200 },
            { x: cx - 60, y: cy + 200 }, { x: cx + 60, y: cy + 200 }
        ];
        dots.forEach(d => {
            ctx.beginPath();
            ctx.arc(d.x, d.y, 4, 0, Math.PI * 2);
            ctx.fill();
        });

        // Crease
        ctx.fillStyle = 'rgba(40, 96, 144, 0.3)';
        ctx.beginPath();
        ctx.arc(cx, 0, 40, 0, Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, this.height, 40, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        // Goals rendering
        ctx.strokeStyle = '#d9534f'; // Red goal posts
        ctx.lineWidth = 4;
        
        // Top goal
        ctx.beginPath();
        ctx.moveTo(cx - this.goalWidth/2, 0);
        ctx.lineTo(cx - this.goalWidth/2, -this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, -this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, 0);
        ctx.stroke();

        // Bottom goal
        ctx.beginPath();
        ctx.moveTo(cx - this.goalWidth/2, this.height);
        ctx.lineTo(cx - this.goalWidth/2, this.height + this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.height + this.goalDepth);
        ctx.lineTo(cx + this.goalWidth/2, this.height);
        ctx.stroke();
    }
}
