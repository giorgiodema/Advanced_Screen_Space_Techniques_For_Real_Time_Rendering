import * as Matrix from '../utils/math'


let m = new Float32Array([
    0.05   , 0.0866 , 0.0, 0.0,
    -1.732 , 1.0    , 0.0, 0.0,
    0.0    , 0.0    , 0.8, 0.0,
    1.0    , -1.0   , 2.0, 1.0
]);

let minv = Matrix.inverse(m);
let minvTrue = new Float32Array([
    5.00022, -0.433019, 0.0 , 0.0,
    8.66038, 0.250011,  0.0 , 0.0,
    0.0,     0.0     ,  1.25, 0.0,
    3.66016, 0.68303 ,  -2.5, 1.0
]);
console.log("Result:");
console.log(minv);
console.log("Expected:");
console.log(minvTrue);

let minvTransp = Matrix.transpose(minv);
let minvTranspTrue = new Float32Array([
    5.0022, 8.66038, 0.0, 3.66016,
    -0.433019, 0.250011, 0.0, 0.68303,
    0.0,0.0,1.25,-2.5,
    0.0,0.0,0.0,1.0
]);
console.log("Result:");
console.log(minvTransp);
console.log("Expected:");
console.log(minvTranspTrue);
