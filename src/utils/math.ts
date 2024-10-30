export function quaternionToMatrix(x: number, y: number, z: number, w: number ): Float32Array {
    return new Float32Array([
      1 - 2 * y * y - 2 * z * z, 2 * x * y + 2 * z * w, 2 * x * z - 2 * y * w, 0,
      2 * x * y - 2 * z * w,  1 - 2 * x * x - 2 * z * z, 2 * y * z + 2 * x * w, 0,
      2 * x * z + 2 * y * w, 2 * y * z - 2 * x * w, 1 - 2 * x * x - 2 * y * y, 0,
      0, 0, 0, 1
    ]);
  }
  
  export function scaleMatrix(x: number, y: number, z: number ): Float32Array {
    return new Float32Array([
      x, 0, 0, 0, 
      0, y, 0, 0,
      0, 0, z, 0, 
      0, 0, 0, 1,
    ]);
  }
  
  export function translationMatrix(x: number, y: number, z: number ): Float32Array {
    return new Float32Array([
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      x, y, z, 1
  ]);
  }
  
  export function multiplyMatrices(a: Float32Array, b: Float32Array): Float32Array {
    let result = new Float32Array(16);
    for (let r = 0; r < 4; r++) {
        for (let c = 0; c < 4; c++) {
            for (let k = 0; k < 4; k++) {
                result[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k];
            }
        }
    }
    return result;
  }

  export function multiplyMatrixVector(m:Float32Array, v:Float32Array):Float32Array{
    if(m.length != 16 || v.length!= 4){
      throw Error("Expected 4x4 matrix and 4x1 vector");
    }
    let n = new Float32Array(v.length);
    for(let r = 0; r < 4; r++){
      for(let c = 0; c< 4; c++){
        n[r] += m[c * 4 + r] * v[c];
      }
    }
    return n;
  }

  export function id():Float32Array {
    return new Float32Array([
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0
    ]);
  }
  

  export function determinant(m:Float32Array):number {
    return (
        m[0] * m[5] * m[10] * m[15] - m[0] * m[5] * m[11] * m[14] - m[0] * m[9] * m[6] * m[15] +
        m[0] * m[9] * m[7] * m[14] + m[0] * m[13] * m[6] * m[11] - m[0] * m[13] * m[7] * m[10] -
        m[4] * m[1] * m[10] * m[15] + m[4] * m[1] * m[11] * m[14] + m[4] * m[9] * m[2] * m[15] -
        m[4] * m[9] * m[3] * m[14] - m[4] * m[13] * m[2] * m[11] + m[4] * m[13] * m[3] * m[10] +
        m[8] * m[1] * m[6] * m[15] - m[8] * m[1] * m[7] * m[14] - m[8] * m[5] * m[2] * m[15] +
        m[8] * m[5] * m[3] * m[14] + m[8] * m[13] * m[2] * m[7] - m[8] * m[13] * m[3] * m[6] -
        m[12] * m[1] * m[6] * m[11] + m[12] * m[1] * m[7] * m[10] + m[12] * m[5] * m[2] * m[11] -
        m[12] * m[5] * m[3] * m[10] - m[12] * m[9] * m[2] * m[7] + m[12] * m[9] * m[3] * m[6]
    );
}

export function inverse(matrix:Float32Array) {
  const det = determinant(matrix);
  if (det === 0) {
      throw new Error('Matrix is not invertible (determinant is zero).');
  }

  const inv = new Float32Array(16);

  // Compute the inverse matrix
  inv[0]  = (matrix[5] * matrix[10] * matrix[15] - matrix[5] * matrix[11] * matrix[14] - matrix[9] * matrix[6] * matrix[15] + matrix[9] * matrix[7] * matrix[14] + matrix[13] * matrix[6] * matrix[11] - matrix[13] * matrix[7] * matrix[10]) / det;
  inv[1]  = -(matrix[1] * matrix[10] * matrix[15] - matrix[1] * matrix[11] * matrix[14] - matrix[9] * matrix[2] * matrix[15] + matrix[9] * matrix[3] * matrix[14] + matrix[13] * matrix[2] * matrix[11] - matrix[13] * matrix[3] * matrix[10]) / det;
  inv[2]  = (matrix[1] * matrix[6] * matrix[15] - matrix[1] * matrix[7] * matrix[14] - matrix[5] * matrix[2] * matrix[15] + matrix[5] * matrix[3] * matrix[14] + matrix[13] * matrix[2] * matrix[7] - matrix[13] * matrix[3] * matrix[6]) / det;
  inv[3]  = -(matrix[1] * matrix[6] * matrix[11] - matrix[1] * matrix[7] * matrix[10] - matrix[5] * matrix[2] * matrix[11] + matrix[5] * matrix[3] * matrix[10] + matrix[9] * matrix[2] * matrix[7] - matrix[9] * matrix[3] * matrix[6]) / det;
  
  inv[4]  = -(matrix[4] * matrix[10] * matrix[15] - matrix[4] * matrix[11] * matrix[14] - matrix[8] * matrix[6] * matrix[15] + matrix[8] * matrix[7] * matrix[14] + matrix[12] * matrix[6] * matrix[11] - matrix[12] * matrix[7] * matrix[10]) / det;
  inv[5]  = (matrix[0] * matrix[10] * matrix[15] - matrix[0] * matrix[11] * matrix[14] - matrix[8] * matrix[2] * matrix[15] + matrix[8] * matrix[3] * matrix[14] + matrix[12] * matrix[2] * matrix[11] - matrix[12] * matrix[3] * matrix[10]) / det;
  inv[6]  = -(matrix[0] * matrix[6] * matrix[15] - matrix[0] * matrix[7] * matrix[14] - matrix[4] * matrix[2] * matrix[15] + matrix[4] * matrix[3] * matrix[14] + matrix[12] * matrix[2] * matrix[7] - matrix[12] * matrix[3] * matrix[6]) / det;
  inv[7]  = (matrix[0] * matrix[6] * matrix[11] - matrix[0] * matrix[7] * matrix[10] - matrix[4] * matrix[2] * matrix[11] + matrix[4] * matrix[3] * matrix[10] + matrix[8] * matrix[2] * matrix[7] - matrix[8] * matrix[3] * matrix[6]) / det;
  
  inv[8]  = (matrix[4] * matrix[9] * matrix[15] - matrix[4] * matrix[11] * matrix[13] - matrix[8] * matrix[5] * matrix[15] + matrix[8] * matrix[7] * matrix[13] + matrix[12] * matrix[5] * matrix[11] - matrix[12] * matrix[7] * matrix[9]) / det;
  inv[9]  = -(matrix[0] * matrix[9] * matrix[15] - matrix[0] * matrix[11] * matrix[13] - matrix[8] * matrix[1] * matrix[15] + matrix[8] * matrix[3] * matrix[13] + matrix[12] * matrix[1] * matrix[11] - matrix[12] * matrix[3] * matrix[9]) / det;
  inv[10] = (matrix[0] * matrix[5] * matrix[15] - matrix[0] * matrix[7] * matrix[13] - matrix[4] * matrix[1] * matrix[15] + matrix[4] * matrix[3] * matrix[13] + matrix[12] * matrix[1] * matrix[7] - matrix[12] * matrix[3] * matrix[5]) / det;
  inv[11] = -(matrix[0] * matrix[5] * matrix[11] - matrix[0] * matrix[7] * matrix[9] - matrix[4] * matrix[1] * matrix[11] + matrix[4] * matrix[3] * matrix[9] + matrix[8] * matrix[1] * matrix[7] - matrix[8] * matrix[3] * matrix[5]) / det;
  
  inv[12] = -(matrix[4] * matrix[9] * matrix[14] - matrix[4] * matrix[10] * matrix[13] - matrix[8] * matrix[5] * matrix[14] + matrix[8] * matrix[6] * matrix[13] + matrix[12] * matrix[5] * matrix[10] - matrix[12] * matrix[6] * matrix[9]) / det;
  inv[13] = (matrix[0] * matrix[9] * matrix[14] - matrix[0] * matrix[10] * matrix[13] - matrix[8] * matrix[1] * matrix[14] + matrix[8] * matrix[2] * matrix[13] + matrix[12] * matrix[1] * matrix[10] - matrix[12] * matrix[2] * matrix[9]) / det;
  inv[14] = -(matrix[0] * matrix[5] * matrix[14] - matrix[0] * matrix[6] * matrix[13] - matrix[4] * matrix[1] * matrix[14] + matrix[4] * matrix[2] * matrix[13] + matrix[12] * matrix[1] * matrix[6] - matrix[12] * matrix[2] * matrix[5]) / det;
  inv[15] = (matrix[0] * matrix[5] * matrix[10] - matrix[0] * matrix[6] * matrix[9] - matrix[4] * matrix[1] * matrix[10] + matrix[4] * matrix[2] * matrix[9] + matrix[8] * matrix[1] * matrix[6] - matrix[8] * matrix[2] * matrix[5]) / det;

  return inv;
}

export function transpose(m:Float32Array):Float32Array{
  return new Float32Array([
    m[0], m[4], m[8], m[12],
    m[1], m[5], m[9], m[13],
    m[2], m[6], m[10], m[14],
    m[3], m[7], m[11], m[15]
]);
}

export function inverseTranspose(m:Float32Array):Float32Array{
  return transpose(inverse(m));
}

export function upperLeft(m:Float32Array):Float32Array{
  return new Float32Array([
    m[0], m[1], m[2],
    m[4], m[5], m[6],
    m[8], m[9], m[10]
  ]);
}