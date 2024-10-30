override renderMipLevel:f32 = 0;

struct Camera {
    invViewMatrix: mat4x4<f32>,
    invProjMatrix: mat4x4<f32>,
    eye: vec3<f32>
};

struct vsOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) ndc: vec3<f32>,
};

@group(0) @binding(0) var<uniform> camera: Camera;
@group(1) @binding(0) var envTexture: texture_cube<f32>;
@group(1) @binding(1) var envSampler: sampler;

@vertex
fn vs(@builtin(vertex_index) index: u32) -> vsOutput {
    let positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),  // bottom left
        vec2<f32>( 1.0, -1.0),  // bottom right
        vec2<f32>(-1.0,  1.0),  // top left
        vec2<f32>(-1.0,  1.0),  // top left
        vec2<f32>( 1.0,  1.0),  // top right
        vec2<f32>( 1.0, -1.0)   // bottom right
    );

    let pos = vec4<f32>(positions[index], 0.0, 1.0);
    var output: vsOutput;
    output.pos = pos;
    output.ndc = vec3<f32>(positions[index], 1.0);
    return output;
}

@fragment
fn fs(input: vsOutput) -> @location(0) vec4<f32> {
    // Convert from NDC to clip space
    let clip  = vec4<f32>(input.ndc.xy * input.pos.w, input.pos.z, input.pos.w);
    // Convert from clip space to view space
    let view  = camera.invProjMatrix * clip;
    // Convert from view space to world space
    let world = camera.invViewMatrix * vec4<f32>(view.xyz, 0.0);
    // Sample the environment map
    let env = textureSampleLevel(envTexture, envSampler, normalize(world.xyz),renderMipLevel);
    return env;
}
