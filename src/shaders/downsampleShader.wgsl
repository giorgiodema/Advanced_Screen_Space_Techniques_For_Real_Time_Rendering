
@group(0) @binding(0) var samp: sampler;
@group(0) @binding(1) var text: texture_2d<f32>;

struct VSOutput {
    @builtin(position) position: vec4f,
    @location(0) texcoord: vec2f,
};

@vertex fn vs(
    @builtin(vertex_index) vertexIndex : u32
) -> VSOutput {
    let pos = array(

    vec2f( 0.0,  0.0),  // center
    vec2f( 1.0,  0.0),  // right, center
    vec2f( 0.0,  1.0),  // center, top

    // 2st triangle
    vec2f( 0.0,  1.0),  // center, top
    vec2f( 1.0,  0.0),  // right, center
    vec2f( 1.0,  1.0),  // right, top
    );

    var vsOutput: VSOutput;
    let xy = pos[vertexIndex];
    vsOutput.position = vec4f(xy * 2.0 - 1.0, 0.0, 1.0);
    vsOutput.texcoord = vec2f(xy.x, 1.0 - xy.y);
    return vsOutput;
}

@fragment fn fs(fsInput: VSOutput) -> @location(0) vec4f {
    return textureSample(text, samp, fsInput.texcoord);
}