import { Vector, Collision } from './physics.js';

function drawRoundRect(ctx, x, y, width, height, radius) {
    ctx.beginPath();
    ctx.moveTo(x + radius, y);
    ctx.lineTo(x + width - radius, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + radius);
    ctx.lineTo(x + width, y + height - radius);
    ctx.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    ctx.lineTo(x + radius, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - radius);
    ctx.lineTo(x, y + radius);
    ctx.quadraticCurveTo(x, y, x + radius, y);
    ctx.closePath();
}

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
        // Shoulders (rounded rect)
        ctx.save();
        ctx.translate(this.pos.x, this.pos.y);
        const heading = Vector.mag(this.vel) > 0.1 ? Math.atan2(this.vel.y, this.vel.x) : (this.team === 0 ? -Math.PI/2 : Math.PI/2);
        ctx.rotate(heading);

        // Stick
        ctx.beginPath();
        ctx.moveTo(15, 5); // Originating from hands
        ctx.lineTo(30, 20);
        ctx.lineTo(35, 15); // Blade
        ctx.strokeStyle = '#4a3b2c'; // Dark wood
        ctx.lineWidth = 4;
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.stroke();

        // Shoulders
        drawRoundRect(ctx, -12, -16, 24, 32, 8);
        ctx.fillStyle = this.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#000';
        ctx.stroke();
        
        // Helmet
        ctx.beginPath();
        ctx.arc(0, -2, 9, 0, Math.PI * 2);
        ctx.fillStyle = this.team === 0 ? '#222' : '#fff';
        ctx.fill();
        ctx.stroke();

        // Helmet stripe
        ctx.beginPath();
        ctx.moveTo(0, -11);
        ctx.lineTo(0, 7);
        ctx.strokeStyle = this.team === 0 ? '#fff' : '#222';
        ctx.lineWidth = 3;
        ctx.stroke();

        // Number on back
        ctx.rotate(-heading); // Keep text upright
        ctx.fillStyle = this.team === 0 ? '#fff' : '#000';
        ctx.font = 'bold 11px Oswald';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(this.id, 0, 0);
        
        ctx.restore();

        // Highlight ring & Name
        if (isControlled) {
            ctx.beginPath();
            ctx.arc(this.pos.x, this.pos.y, this.radius + 10, 0, Math.PI * 2);
            ctx.strokeStyle = '#ff3333'; // Bright red ring
            ctx.lineWidth = 4;
            ctx.stroke();

            // Name plate background
            const names = ['SMITH', 'JOHNSON', 'WILLIAMS', 'BROWN', 'JONES', 'MILLER', 'DAVIS', 'GARCIA', 'RODRIGUEZ', 'WILSON'];
            const pName = 'J. ' + names[this.id % names.length];
            ctx.font = 'bold 12px Oswald';
            const textWidth = ctx.measureText(pName).width;

            ctx.fillStyle = '#65c2db';
            drawRoundRect(ctx, this.pos.x - textWidth/2 - 6, this.pos.y + this.radius + 12, textWidth + 12, 16, 4);
            ctx.fill();
            ctx.strokeStyle = '#fff';
            ctx.lineWidth = 1.5;
            ctx.stroke();
            
            // Text
            ctx.fillStyle = '#000';
            ctx.fillText(pName, this.pos.x, this.pos.y + this.radius + 21);
        }
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
        ctx.fillStyle = '#111';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#555';
        ctx.stroke();
        
        // Lighting reflection dot
        ctx.beginPath();
        ctx.arc(this.pos.x - 2, this.pos.y - 2, 2, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.fill();
    }
}

export class Rink {
    constructor(width, height) {
        this.width = width;
        this.height = height;
        this.boardsRadius = 80;
        this.goalWidth = 120;
        this.goalOffset = 100;
        this.goalDepth = 30;
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

        // Draw Stadium Seats Background (Rows)
        ctx.fillStyle = '#222';
        ctx.fillRect(-1000, -1000, this.width + 2000, this.height + 2000);
        ctx.strokeStyle = '#333';
        ctx.lineWidth = 10;
        for (let i = 0; i < 20; i++) {
            drawRoundRect(ctx, -200 - i * 50, -200 - i * 50, this.width + 400 + i * 100, this.height + 400 + i * 100, this.boardsRadius + 100 + i * 50);
            ctx.stroke();
        }

        // Draw the rounded rink
        const r = this.boardsRadius;
        drawRoundRect(ctx, 0, 0, this.width, this.height, r);
        ctx.fillStyle = '#eaf5fa'; // Ice color
        ctx.fill();
        
        // Ice Spotlights (Soft gradients)
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        const spots = [
            {x: cx, y: cy}, {x: cx-200, y: cy-400}, {x: cx+200, y: cy-400},
            {x: cx-200, y: cy+400}, {x: cx+200, y: cy+400}
        ];
        spots.forEach(s => {
            const grad = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, 300);
            grad.addColorStop(0, 'rgba(255, 255, 255, 0.2)');
            grad.addColorStop(1, 'rgba(255, 255, 255, 0)');
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.arc(s.x, s.y, 300, 0, Math.PI * 2);
            ctx.fill();
        });
        ctx.restore();

        // Thick Boards border
        ctx.lineWidth = 12;
        ctx.strokeStyle = '#fff'; // Boards (white)
        ctx.stroke();

        // Ad boards / Text on boards
        ctx.save();
        ctx.clip(); // Keeps ads on the ice
        
        // Ads (Red text)
        ctx.fillStyle = '#ff0000';
        ctx.font = 'bold 24px Oswald';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        ctx.save();
        ctx.translate(this.width / 2, 10);
        ctx.rotate(Math.PI);
        ctx.fillText("BIG IDEA GAMES", 0, 0);
        ctx.restore();
        
        ctx.save();
        ctx.translate(this.width / 2, this.height - 10);
        ctx.fillText("SUPERSTAR HOCKEY", 0, 0);
        ctx.restore();
        ctx.restore();

        // Clip all ice markings to not bleed out of the rounded rink
        ctx.save();
        ctx.clip();

        // Center line (Red)
        ctx.fillStyle = '#c9302c';
        ctx.fillRect(0, cy - 4, this.width, 8);
        
        // Blue lines
        ctx.fillStyle = '#0055a4';
        ctx.fillRect(0, cy - 180, this.width, 8);
        ctx.fillRect(0, cy + 180, this.width, 8);
        
        // Center circle
        ctx.beginPath();
        ctx.arc(cx, cy, 80, 0, Math.PI * 2);
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0055a4';
        ctx.stroke();
        
        // ROCKY MOUNTAIN Logo
        ctx.save();
        ctx.translate(cx, cy);
        ctx.globalAlpha = 0.8;
        // Shield outline
        ctx.beginPath();
        ctx.moveTo(0, -60);
        ctx.lineTo(60, -30);
        ctx.lineTo(60, 40);
        ctx.lineTo(0, 70);
        ctx.lineTo(-60, 40);
        ctx.lineTo(-60, -30);
        ctx.closePath();
        ctx.fillStyle = '#fff';
        ctx.fill();
        ctx.strokeStyle = '#65c2db';
        ctx.lineWidth = 4;
        ctx.stroke();
        // Mountains
        ctx.fillStyle = '#65c2db';
        ctx.beginPath();
        ctx.moveTo(-56, 30);
        ctx.lineTo(-20, -20);
        ctx.lineTo(0, 5);
        ctx.lineTo(30, -40);
        ctx.lineTo(56, 30);
        ctx.fill();
        // Text
        ctx.fillStyle = '#65c2db';
        ctx.font = 'bold 16px Oswald';
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 3;
        ctx.strokeText("ROCKY MOUNTAIN", 0, 50);
        ctx.fillText("ROCKY MOUNTAIN", 0, 50);
        ctx.restore();

        // Goal lines (Red)
        ctx.strokeStyle = '#c9302c';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, this.goalOffset);
        ctx.lineTo(this.width, this.goalOffset);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(0, this.height - this.goalOffset);
        ctx.lineTo(this.width, this.height - this.goalOffset);
        ctx.stroke();
        
        // Center dot
        ctx.beginPath();
        ctx.arc(cx, cy, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#0055a4';
        ctx.fill();

        // Faceoff dots
        const drawDot = (dx, dy) => {
            ctx.beginPath();
            ctx.arc(cx + dx, cy + dy, 4, 0, Math.PI * 2);
            ctx.fillStyle = '#c9302c';
            ctx.fill();
        };
        drawDot(-150, -280);
        drawDot(150, -280);
        drawDot(-150, 280);
        drawDot(150, 280);
        
        // Creases (Light blue fill, red border)
        ctx.fillStyle = 'rgba(100, 150, 255, 0.2)';
        ctx.strokeStyle = '#c9302c';
        ctx.lineWidth = 3;
        
        ctx.beginPath();
        ctx.arc(cx, this.goalOffset, 45, 0, Math.PI);
        ctx.fill();
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(cx, this.height - this.goalOffset, 45, Math.PI, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        
        ctx.restore(); // remove clip

        // Goals rendering
        const drawGoal = (yOffset, dir) => {
            // Netting
            ctx.save();
            ctx.beginPath();
            ctx.moveTo(cx - this.goalWidth/2, yOffset);
            ctx.lineTo(cx - this.goalWidth/2 + 5, yOffset - this.goalDepth * dir);
            ctx.lineTo(cx + this.goalWidth/2 - 5, yOffset - this.goalDepth * dir);
            ctx.lineTo(cx + this.goalWidth/2, yOffset);
            ctx.fillStyle = 'rgba(255, 255, 255, 0.5)';
            ctx.fill();
            
            // Netting grid
            ctx.setLineDash([2, 2]);
            ctx.strokeStyle = '#aaa';
            ctx.lineWidth = 1;
            for(let i=0; i<this.goalWidth; i+=6) {
                ctx.beginPath(); ctx.moveTo(cx - this.goalWidth/2 + i, yOffset);
                ctx.lineTo(cx - this.goalWidth/2 + i * 0.9, yOffset - this.goalDepth * dir); ctx.stroke();
            }
            
            // Frame
            ctx.setLineDash([]);
            ctx.strokeStyle = '#d9534f'; // Red posts
            ctx.lineWidth = 5;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            ctx.moveTo(cx - this.goalWidth/2, yOffset);
            ctx.lineTo(cx - this.goalWidth/2 + 5, yOffset - this.goalDepth * dir);
            ctx.lineTo(cx + this.goalWidth/2 - 5, yOffset - this.goalDepth * dir);
            ctx.lineTo(cx + this.goalWidth/2, yOffset);
            ctx.stroke();
            ctx.restore();
        };

        drawGoal(this.goalOffset, 1); // Top
        drawGoal(this.height - this.goalOffset, -1); // Bottom
    }
}
