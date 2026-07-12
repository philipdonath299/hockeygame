import { GameEngine, InputManager } from './engine.js';
import { Rink, Player, Puck } from './entities.js';
import { Vector, Collision } from './physics.js';

class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx = this.canvas.getContext('2d');
        this.resize();
        window.addEventListener('resize', () => this.resize());

        this.input = new InputManager(this.canvas);
        this.engine = new GameEngine((dt) => this.update(dt), (alpha) => this.render(alpha));

        this.gameState = 'PLAYING'; // PLAYING, GOAL, FACEOFF
        this.rink = new Rink(800, 1800); // Taller rink for mobile aspect ratios
        this.camera = { x: 0, y: 0 };
        this.puck = new Puck(400, 700);
        
        this.players = [];
        this.controlledPlayerIndex = -1; // Index in players array
        
        this.scores = [0, 0];
        this.shots = [0, 0];
        
        this.TACKLE_THRESHOLD = 3.0; // Velocity magnitude required to tackle
        
        this.setupMatch(3); // 3v3
        this.bindInput();
        this.engine.start();
    }

    resize() {
        // Fix internal width to 800 so the whole rink is visible horizontally
        this.width = 800;
        // Scale height proportionally to screen aspect ratio
        this.height = Math.floor(800 * (window.innerHeight / window.innerWidth));
        this.canvas.width = this.width;
        this.canvas.height = this.height;
    }

    setupMatch(teamSize) {
        this.players = [];
        const cx = 400; // this.rink.width / 2
        const cy = 900; // this.rink.height / 2
        
        // Team 0 (Player) - Attacks UP (Defends BOTTOM goal)
        this.players.push(new Player(cx, cy + 50, 0, 99)); // Center
        this.players.push(new Player(cx - 60, cy + 100, 0, 8));  // LW
        this.players.push(new Player(cx + 60, cy + 100, 0, 19)); // RW
        this.players.push(new Player(cx, 1700, 0, 31, true)); // Goalie
        
        // Team 1 (AI) - Attacks DOWN (Defends TOP goal)
        this.players.push(new Player(cx, cy - 50, 1, 87)); // Center
        this.players.push(new Player(cx - 60, cy - 100, 1, 71)); // RW
        this.players.push(new Player(cx + 60, cy - 100, 1, 58)); // LW
        this.players.push(new Player(cx, 100, 1, 30, true)); // Goalie
        
        this.resetPositions();
        this.gameState = 'PLAYING';
    }

    resetPositions() {
        const cx = 400;
        const cy = 900;
        this.puck.pos = { x: cx, y: cy };
        this.puck.vel = { x: 0, y: 0 };
        this.puck.carrier = null;
        
        const positions = [
            {x: cx, y: cy + 50}, {x: cx - 60, y: cy + 100}, {x: cx + 60, y: cy + 100}, {x: cx, y: 1700},
            {x: cx, y: cy - 50}, {x: cx - 60, y: cy - 100}, {x: cx + 60, y: cy - 100}, {x: cx, y: 100}
        ];
        
        this.players.forEach((p, i) => {
            p.pos = { ...positions[i] };
            p.vel = { x: 0, y: 0 };
            p.hasPuck = false;
        });
        
        this.evaluateAutoSwitch();
    }

    bindInput() {
        this.input.onTap = (x, y) => {
            const worldX = x + this.camera.x;
            const worldY = y + this.camera.y;
            
            if (this.puck.carrier && this.puck.carrier.team === 0) {
                // Find nearest friendly to pass to
                let bestTarget = null;
                let minSqDist = Infinity;
                
                this.players.forEach(p => {
                    if (p.team === 0 && p !== this.puck.carrier) {
                        const distSq = Math.pow(p.pos.x - worldX, 2) + Math.pow(p.pos.y - worldY, 2);
                        if (distSq < minSqDist) {
                            minSqDist = distSq;
                            bestTarget = p;
                        }
                    }
                });

                if (bestTarget) {
                    this.executePass(bestTarget);
                }
            }
        };

        this.input.onSwipe = (dx, dy) => {
            if (this.puck.carrier && this.puck.carrier.team === 0) {
                // Execute shot
                this.shots[0]++;
                document.getElementById('shots-home').innerText = this.shots[0];
                const dir = Vector.normalize({ x: dx, y: dy });
                const shotPower = 12; // Massive impulse
                
                this.puck.vel = Vector.add(this.puck.carrier.vel, Vector.mult(dir, shotPower));
                this.puck.pos = Vector.add(this.puck.pos, Vector.mult(dir, this.puck.radius + this.puck.carrier.radius + 2)); // Offset to avoid immediate re-catch
                this.puck.carrier.hasPuck = false;
                this.puck.carrier = null;
            }
        };
    }

    executePass(targetPlayer) {
        const dir = Vector.normalize(Vector.sub(targetPlayer.pos, this.puck.carrier.pos));
        const passPower = 8;
        this.puck.vel = Vector.add(this.puck.carrier.vel, Vector.mult(dir, passPower));
        this.puck.pos = Vector.add(this.puck.pos, Vector.mult(dir, this.puck.radius + this.puck.carrier.radius + 2));
        this.puck.carrier.hasPuck = false;
        this.puck.carrier = null;
    }

    evaluateAutoSwitch() {
        // Find best player to control on defense
        // Weight: Distance to puck + penalty if moving away
        
        let bestScore = Infinity;
        let bestIndex = -1;
        
        this.players.forEach((p, i) => {
            if (p.team === 0 && !p.isGoalie) {
                if (p.hasPuck) {
                    bestIndex = i; // Always control puck carrier on offense
                    bestScore = -1;
                } else if (bestScore !== -1) {
                    const distToPuck = Vector.dist(p.pos, this.puck.pos);
                    // Dot product to see if moving towards puck
                    const dirToPuck = Vector.normalize(Vector.sub(this.puck.pos, p.pos));
                    const velNorm = Vector.normalize(p.vel);
                    const approachAlignment = (dirToPuck.x * velNorm.x + dirToPuck.y * velNorm.y); // -1 to 1
                    
                    // Lower score is better. Penalize if moving away from puck.
                    const score = distToPuck - (approachAlignment * 20); 
                    
                    if (score < bestScore) {
                        bestScore = score;
                        bestIndex = i;
                    }
                }
            }
        });

        this.controlledPlayerIndex = bestIndex;
    }

    update(dt) {
        if (this.gameState !== 'PLAYING') return;

        // 1. Process Input for Active Player
        const controlledPlayer = this.players[this.controlledPlayerIndex];
        if (controlledPlayer) {
            if (this.input.joystick.active) {
                const forceMag = this.input.joystick.magnitude * 2.0; // Increased acceleration force
                const force = Vector.mult(this.input.joystick.vector, forceMag);
                controlledPlayer.applyForce(force);
            }
        }

        // 2. AI & Steering Behaviors
        this.updateAI();

        // 3. Physics Updates
        this.players.forEach(p => p.update(dt));
        if (!this.puck.carrier) {
            this.puck.update(dt);
        }

        // 4. Resolve Collisions
        this.resolveCollisions();

        // 5. Update Puck Carrier Logic
        this.updatePuckCarrier();

        // 6. Check Goals
        const goalTeam = this.rink.checkGoal(this.puck);
        if (goalTeam !== -1) {
            this.handleGoal(goalTeam);
        }
    }

    updateAI() {
        const team0HasPuck = this.players.some(p => p.team === 0 && p.hasPuck);
        const team1HasPuck = this.players.some(p => p.team === 1 && p.hasPuck);
        const topGoalPos = { x: 400, y: 0 };
        const bottomGoalPos = { x: 400, y: 1800 };

        this.players.forEach((p, i) => {
            if (i === this.controlledPlayerIndex) return; // Skip human controlled
            
            if (p.isGoalie) {
                // Goalie AI
                const myGoalY = p.team === 0 ? 1700 : 100;
                const goalPos = { x: 400, y: myGoalY };
                const dirToPuck = Vector.normalize(Vector.sub(this.puck.pos, goalPos));
                // Stay on the angle, slightly out of the net
                const target = Vector.add(goalPos, Vector.mult(dirToPuck, 30)); 
                
                const force = p.arrive(target, 20);
                p.applyForce(force);
                return; // done with goalie
            }
            
            if (p.team === 1) {
                // Opponent AI
                if (p.hasPuck) {
                    // Attack bottom goal
                    const force = p.seek(bottomGoalPos);
                    p.applyForce(force);
                    
                    // Simple shoot logic
                    if (p.pos.y > 900 && Math.random() < 0.01) {
                         // Shoot
                         this.shots[1]++;
                         document.getElementById('shots-away').innerText = this.shots[1];
                         const dir = Vector.normalize(Vector.sub(bottomGoalPos, p.pos));
                         this.puck.vel = Vector.add(p.vel, Vector.mult(dir, 10));
                         this.puck.pos = Vector.add(this.puck.pos, Vector.mult(dir, this.puck.radius + p.radius + 2));
                         p.hasPuck = false;
                         this.puck.carrier = null;
                    }

                } else if (team1HasPuck) {
                    // Support attack
                    const force = p.arrive({ x: p.pos.x, y: this.puck.pos.y + 100 }, 50);
                    p.applyForce(force);
                } else {
                    // Defend: close down puck or collapse to net
                    const distToPuck = Vector.dist(p.pos, this.puck.pos);
                    if (distToPuck < 150) {
                        const force = p.seek(this.puck.pos);
                        p.applyForce(force);
                    } else {
                        // Collapse
                        const force = p.arrive({ x: 400, y: 100 }, 50);
                        p.applyForce(force);
                    }
                }
            } else {
                // Teammate AI (Team 0)
                if (team0HasPuck) {
                    // Support puck carrier
                    const force = p.arrive({ x: p.pos.x, y: this.puck.pos.y - 100 }, 50);
                    p.applyForce(force);
                } else {
                    // Defend / Seek open ice
                    const force = p.seek(this.puck.pos);
                    p.applyForce(Vector.mult(force, 0.5)); // Slower closing speed than active player
                }
            }
        });
    }

    resolveCollisions() {
        this.rink.collideBoards(this.puck);
        
        for (let i = 0; i < this.players.length; i++) {
            this.rink.collideBoards(this.players[i]);
            
            for (let j = i + 1; j < this.players.length; j++) {
                const p1 = this.players[i];
                const p2 = this.players[j];
                
                if (Collision.circleCircle(p1, p2)) {
                    Collision.resolveElastic(p1, p2);
                    
                    // Tackling logic
                    if (p1.hasPuck && Vector.mag(p2.vel) > this.TACKLE_THRESHOLD && p1.team !== p2.team) {
                        this.dislodgePuck(p1, p2.vel);
                    } else if (p2.hasPuck && Vector.mag(p1.vel) > this.TACKLE_THRESHOLD && p1.team !== p2.team) {
                        this.dislodgePuck(p2, p1.vel);
                    }
                }
            }
            
            // Player vs Puck collision (if not carrier)
            if (this.puck.carrier !== this.players[i] && Collision.circleCircle(this.players[i], this.puck)) {
                if (!this.puck.carrier) {
                    Collision.resolveElastic(this.players[i], this.puck);
                }
            }
        }
    }
    
    dislodgePuck(carrier, hitVelocity) {
        carrier.hasPuck = false;
        carrier.stunTimer = 1.5; // Stunned for 1.5 seconds
        this.puck.carrier = null;
        // Puck spills out loosely based on the hit
        this.puck.vel = Vector.add(this.puck.vel, Vector.mult(hitVelocity, 0.5));
        this.evaluateAutoSwitch();
    }

    updatePuckCarrier() {
        if (this.puck.carrier) {
            // Snap puck to stick
            const offset = 12;
            const heading = Vector.mag(this.puck.carrier.vel) > 0.1 ? Math.atan2(this.puck.carrier.vel.y, this.puck.carrier.vel.x) : Math.PI/2;
            this.puck.pos = {
                x: this.puck.carrier.pos.x + Math.cos(heading) * offset,
                y: this.puck.carrier.pos.y + Math.sin(heading) * offset
            };
            this.puck.vel = { x: 0, y: 0 };
        } else {
            // Check if someone picks it up
            for (let p of this.players) {
                if (p.stunTimer <= 0 && Collision.circleCircle(p, this.puck)) {
                    this.puck.carrier = p;
                    p.hasPuck = true;
                    if (p.team === 0) {
                        this.evaluateAutoSwitch(); // Snap control to puck carrier
                    }
                    break; // Only one can carry
                }
            }
            
            // Re-evaluate defensive switch if puck is loose
            if (!this.puck.carrier) {
                this.evaluateAutoSwitch();
            }
        }
    }

    handleGoal(team) {
        this.gameState = 'GOAL';
        this.scores[team]++;
        document.getElementById(team === 0 ? 'score-home' : 'score-away').innerText = this.scores[team];
        
        const overlay = document.getElementById('goal-overlay');
        overlay.classList.remove('hidden');
        
        // Brief pause, then faceoff
        setTimeout(() => {
            overlay.classList.add('hidden');
            this.resetPositions();
        }, 3000);
    }

    render(alpha) {
        this.ctx.clearRect(0, 0, this.width, this.height);
        
        // Update Camera
        let targetCamX = this.puck.pos.x - this.width / 2;
        let targetCamY = this.puck.pos.y - this.height / 2;
        
        // Clamp camera to rink bounds (ensure we don't clamp negatively if screen is somehow taller than rink)
        targetCamX = Math.max(0, Math.min(targetCamX, Math.max(0, this.rink.width - this.width)));
        targetCamY = Math.max(0, Math.min(targetCamY, Math.max(0, this.rink.height - this.height)));
        
        // Smooth camera follow
        this.camera.x += (targetCamX - this.camera.x) * 0.1;
        this.camera.y += (targetCamY - this.camera.y) * 0.1;
        
        this.ctx.save();
        this.ctx.translate(-this.camera.x, -this.camera.y);
        
        this.rink.render(this.ctx);
        
        this.puck.render(this.ctx);
        this.players.forEach((p, i) => {
            p.render(this.ctx, i === this.controlledPlayerIndex);
        });

        // Draw Aiming Line (Green cone)
        if (this.input.action.touchId !== null && this.controlledPlayerIndex !== -1 && this.players[this.controlledPlayerIndex].hasPuck) {
            const p = this.players[this.controlledPlayerIndex];
            const worldX = this.input.action.current.x + this.camera.x;
            const worldY = this.input.action.current.y + this.camera.y;
            
            this.ctx.beginPath();
            this.ctx.moveTo(p.pos.x, p.pos.y);
            this.ctx.lineTo(worldX, worldY);
            
            // Neon green stroke
            this.ctx.strokeStyle = '#00ff00';
            this.ctx.lineWidth = 4;
            this.ctx.setLineDash([5, 5]);
            this.ctx.stroke();
            this.ctx.setLineDash([]);
            
            // Dot at end
            this.ctx.beginPath();
            this.ctx.arc(worldX, worldY, 8, 0, Math.PI * 2);
            this.ctx.fillStyle = '#00ff00';
            this.ctx.fill();
            this.ctx.strokeStyle = '#000';
            this.ctx.lineWidth = 2;
            this.ctx.stroke();
        }

        this.ctx.restore();
        
        this.renderVirtualJoystick();
    }

    renderVirtualJoystick() {
        const thresholdY = this.height * (1 - this.input.joystickZoneHeight);

        // Grey action zone box
        this.ctx.save();
        this.ctx.fillStyle = 'rgba(0, 0, 0, 0.1)';
        this.ctx.fillRect(40, thresholdY + 20, this.width - 80, this.height - thresholdY - 40);
        this.ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
        this.ctx.lineWidth = 2;
        this.ctx.strokeRect(40, thresholdY + 20, this.width - 80, this.height - thresholdY - 40);
        this.ctx.restore();

        if (!this.input.joystick.active) return;

        const { origin, current } = this.input.joystick;
        
        this.ctx.save();
        // Base ring (Thick black)
        this.ctx.beginPath();
        this.ctx.arc(origin.x, origin.y, 60, 0, Math.PI * 2);
        this.ctx.strokeStyle = '#000';
        this.ctx.lineWidth = 8;
        this.ctx.stroke();
        
        // Inner grey fill for base
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.2)';
        this.ctx.fill();

        // Nub (Solid black)
        this.ctx.beginPath();
        this.ctx.arc(current.x, current.y, 35, 0, Math.PI * 2);
        this.ctx.fillStyle = '#111';
        this.ctx.fill();
        
        // White arrows inside nub
        this.ctx.fillStyle = '#fff';
        const d = 20; // Distance from center
        const s = 4;  // Size of triangle
        const drawArrow = (x, y, rot) => {
            this.ctx.save();
            this.ctx.translate(current.x + x, current.y + y);
            this.ctx.rotate(rot);
            this.ctx.beginPath();
            this.ctx.moveTo(0, -s);
            this.ctx.lineTo(-s, s);
            this.ctx.lineTo(s, s);
            this.ctx.closePath();
            this.ctx.fill();
            this.ctx.restore();
        };
        
        drawArrow(0, -d, 0); // Up
        drawArrow(0, d, Math.PI); // Down
        drawArrow(-d, 0, -Math.PI/2); // Left
        drawArrow(d, 0, Math.PI/2); // Right

        this.ctx.restore();
    }
}

// Start game on load
window.onload = () => {
    new Game();
};

// Global iOS zoom and gesture prevention
document.addEventListener('gesturestart', function (e) {
    e.preventDefault();
});
document.addEventListener('gesturechange', function (e) {
    e.preventDefault();
});
document.addEventListener('gestureend', function (e) {
    e.preventDefault();
});

let lastTouchEnd = 0;
document.addEventListener('touchend', function (e) {
    const now = (new Date()).getTime();
    if (now - lastTouchEnd <= 300) {
        e.preventDefault();
    }
    lastTouchEnd = now;
}, { passive: false });

// Prevent pull-to-refresh
document.body.addEventListener('touchmove', function(e) { 
    e.preventDefault(); 
}, { passive: false });
