

export class PerspectiveCamera {
    public eye: Float32Array;
    public lookAt: Float32Array;
    public up: Float32Array = new Float32Array([0, 1, 0]);
    public fov: number; // Field of View in radians
    public near: number;
    public far: number;
    public ar:number; // aspect ratio

    constructor(eye: Float32Array, lookAt: Float32Array, fov: number, near: number, far: number, ar:number) {
        this.eye = eye;
        this.lookAt = lookAt;
        this.fov = fov;
        this.near = near;
        this.far = far;
        this.ar = ar;
    }

    set aspectRatio(ar:number){
        this.ar = ar;
    }

    getViewMatrix(): Float32Array {
        const zAxis = normalize(subtract(this.eye, this.lookAt)); // camera looks in the negative z
        const xAxis = normalize(cross(this.up, zAxis));           // camera right
        const yAxis = cross(zAxis, xAxis);

        return new Float32Array([
            // rotation matrix, aligns the world axis
            // with the camera axis
            xAxis[0], yAxis[0], zAxis[0], 0,
            xAxis[1], yAxis[1], zAxis[1], 0,
            xAxis[2], yAxis[2], zAxis[2], 0,
            // translation vector, translates the eye 
            // to the origin
            -dot(xAxis, this.eye), -dot(yAxis, this.eye), -dot(zAxis, this.eye), 1
        ]);
    }

    getProjectionMatrix(): Float32Array {
        const f = 1.0 / Math.tan(this.fov / 2);
        const nf = 1 / (this.near - this.far);

        return new Float32Array([
            f / this.ar, 0, 0, 0,
            0, f, 0, 0,
            0, 0, (this.far + this.near) * nf, -1,
            0, 0, (2 * this.far * this.near) * nf, 0
        ]);
    }

    updateEye(newEye: Float32Array): void {
        this.eye = newEye;
    }

    updateLookAt(newLookAt: Float32Array): void {
        this.lookAt = newLookAt;
    }

    getCameraBuffer():ArrayBuffer{
        let array = new ArrayBuffer(
            16 * 4 +    // viewMatrix
            16 * 4 +    // projMatrix
            4  * 3      // eye
        );
        let viewMatrixArrayView = new Float32Array(array,0,16);
        let projMatrixArrayView = new Float32Array(array,64,16);
        let eyeArrayView = new Float32Array(array,128,3);
        viewMatrixArrayView.set(this.getViewMatrix());
        projMatrixArrayView.set(this.getProjectionMatrix());
        eyeArrayView.set(this.eye);
        return array;
    }
}

// Vector and matrix operations
function subtract(a: Float32Array, b: Float32Array): Float32Array {
    return new Float32Array([a[0] - b[0], a[1] - b[1], a[2] - b[2]]);
}

function cross(a: Float32Array, b: Float32Array): Float32Array {
    return new Float32Array([
        a[1] * b[2] - a[2] * b[1],
        a[2] * b[0] - a[0] * b[2],
        a[0] * b[1] - a[1] * b[0]
    ]);
}

function dot(a: Float32Array, b: Float32Array): number {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function normalize(v: Float32Array): Float32Array {
    const length = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]);
    return new Float32Array([v[0] / length, v[1] / length, v[2] / length]);
}

export class OrbitCameraController {
    private camera: PerspectiveCamera;
    private canvas: HTMLCanvasElement;
    private azimuth: number = 0;  // Horizontal rotation angle
    private inclination: number = Math.PI / 2;  // Vertical rotation angle
    private radius: number = 10;  // Distance from the target
    private target: Float32Array = new Float32Array([0, 0, 0]); // The target to orbit around
    private mouseSensitivity: number = 0.01;
    private zoomSensitivity: number = 1.0;

    constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
        this.camera = camera;
        this.canvas = canvas;

        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.addEventListener('wheel', this.onMouseWheel.bind(this));
        this.updateCamera();
    }

    private onMouseMove(event: MouseEvent): void {
        if (event.buttons !== 1) return;

        this.azimuth += event.movementX * this.mouseSensitivity;
        this.inclination -= event.movementY * this.mouseSensitivity;
        this.inclination = Math.max(0.01, Math.min(Math.PI - 0.01, this.inclination));  // Clamp inclination

        this.updateCamera();
    }

    private onMouseWheel(event: WheelEvent): void {
        this.radius += event.deltaY * -0.01 * this.zoomSensitivity;
        this.radius = Math.max(1, this.radius);  // Prevent the camera from going into the target

        this.updateCamera();
    }

    private updateCamera(): void {
        const x = this.radius * Math.sin(this.inclination) * Math.cos(this.azimuth);
        const y = this.radius * Math.cos(this.inclination);
        const z = this.radius * Math.sin(this.inclination) * Math.sin(this.azimuth);

        this.camera.eye = new Float32Array([x, y, z]);
        this.camera.updateEye(this.camera.eye);
        this.camera.updateLookAt(this.target);
    }
}
export class FirstPersonCameraController {
    private camera: PerspectiveCamera;
    private canvas: HTMLCanvasElement;
    private movementSpeed: number = 0.05;
    private mouseSensitivity: number = 0.002;
    private pitch: number = 0;
    private yaw: number = 0;
    private keysPressed: Set<string> = new Set();

    constructor(camera: PerspectiveCamera, canvas: HTMLCanvasElement) {
        this.camera = camera;
        this.canvas = canvas;

        window.addEventListener('keydown', this.onKeyDown.bind(this));
        window.addEventListener('keyup', this.onKeyUp.bind(this));
        this.canvas.addEventListener('mousemove', this.onMouseMove.bind(this));
        this.canvas.requestPointerLock = this.canvas.requestPointerLock;
        this.canvas.addEventListener('click', () => {
            this.canvas.requestPointerLock();
        });

        this.updateDirectionVectors(); // Initialize direction vectors
        this.animate();
    }

    private onKeyDown(event: KeyboardEvent): void {
        this.keysPressed.add(event.key.toLowerCase());
    }

    private onKeyUp(event: KeyboardEvent): void {
        this.keysPressed.delete(event.key.toLowerCase());
    }

    private onMouseMove(event: MouseEvent): void {
        if (document.pointerLockElement === this.canvas) {
            this.yaw -= event.movementX * this.mouseSensitivity;
            this.pitch += event.movementY * this.mouseSensitivity; // Inverted Y axis
            this.pitch = Math.max(-Math.PI / 2, Math.min(Math.PI / 2, this.pitch)); // Clamp the pitch

            this.updateDirectionVectors();
        }
    }

    private updateDirectionVectors(): void {
        const direction = new Float32Array([
            Math.cos(this.pitch) * Math.sin(this.yaw),
            -Math.sin(this.pitch),
            Math.cos(this.pitch) * Math.cos(this.yaw)
        ]);

        const newLookAt = add(this.camera.eye, direction);
        this.camera.updateLookAt(newLookAt);
    }

    public update(): void {
        let movement = new Float32Array([0, 0, 0]);
        const forward = normalize(new Float32Array([
            Math.cos(this.pitch) * Math.sin(this.yaw),
            0, // Ensure forward movement is strictly horizontal
            Math.cos(this.pitch) * Math.cos(this.yaw)
        ]));
        const right = normalize(cross(new Float32Array([0, 1, 0]), forward));

        if (this.keysPressed.has('w')) movement = add(movement, forward);
        if (this.keysPressed.has('s')) movement = subtract(movement, forward);
        if (this.keysPressed.has('d')) movement = subtract(movement, right);
        if (this.keysPressed.has('a')) movement = add(movement, right);
        if (this.keysPressed.has('q')) movement = subtract(movement, this.camera.up);
        if (this.keysPressed.has('e')) movement = add(movement, this.camera.up);

        if (movement[0] !== 0 || movement[1] !== 0 || movement[2] !== 0) {
            movement = multiplyScalar(movement, this.movementSpeed);
            const newEye = add(this.camera.eye, movement);
            this.camera.updateEye(newEye);
            this.updateDirectionVectors(); // Ensure lookAt is updated correctly
        }
    }

    private animate() {
        requestAnimationFrame(() => this.animate());
        this.update(); // Update the camera based on current inputs
    }
}

// Helper functions for vector operations
function add(a: Float32Array, b: Float32Array): Float32Array {
    return new Float32Array([a[0] + b[0], a[1] + b[1], a[2] + b[2]]);
}

function multiplyScalar(v: Float32Array, scalar: number): Float32Array {
    return new Float32Array([v[0] * scalar, v[1] * scalar, v[2] * scalar]);
}
