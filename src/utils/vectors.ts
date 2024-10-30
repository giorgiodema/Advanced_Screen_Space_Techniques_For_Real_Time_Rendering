export function normalizeVector(vector:Float32Array):Float32Array{
    let n = new Float32Array(vector.length);
    let norm = 0.0;
    for(let i=0; i<vector.length;i++){
        norm += vector[i] * vector[i];
    }
    norm = Math.sqrt(norm);
    for(let i=0; i<vector.length;i++){
        n[i] = vector[i]/norm;
    }
    return n;
}

export function negate(vector:Float32Array):Float32Array{
    let n = new Float32Array(vector.length);
    for(let i=0; i<vector.length;i++){
        n[i] = - vector[i];
    }
    return n;
}

export function saxpy(a:number,x:Float32Array,y:Float32Array){
    if(x.length!=y.length){
        throw Error("incompatible vectors x and y");
    }
    let n = new Float32Array(x.length);
    for(let i=0;i<x.length;i++){
        n[i] = a * x[i] + y[i];
    }
    return n;
}