/*
Given the refractionDirectionTexture (output of SSRefractedDirectionShader.wgsl), returns 
the refracted color from the environment texture. This shader is used to render the refraction
from distant environment map, not nearby geometry. See (SSRefractedDirectionShader.wgsl) to 
know how the refracted direction is computed.
*/

struct Camera {
    invViewMatrix: mat4x4<f32>,
    invProjMatrix: mat4x4<f32>,
    eye: vec3<f32>
};

struct vsOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) ndc: vec3<f32>,
};

struct fsInput{
    @builtin(position) fragCoord:vec4f,
    @location(0) ndc: vec3<f32>,
};

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var envSampler:sampler;

@group(1) @binding(0) var envTexture:texture_cube<f32>;
@group(1) @binding(1) var refractionDirectionTexture:texture_2d<f32>;

@group(2) @binding(0) var<uniform> camera: Camera;

@vertex
fn vs(@builtin(vertex_index) index:u32) -> vsOutput {
    let positions = array(
        vec2f(-1.0, -1.0),   // bottom left
        vec2f( 1.0, -1.0),   // bottom right
        vec2f(-1.0,  1.0),   // top left
        vec2f(-1.0,  1.0),   // top left
        vec2f( 1.0,  1.0),   // top right
        vec2f( 1.0, -1.0),   // bottom right
    );
    let pos = vec4<f32>(positions[index], 0.0, 1.0);
    var output: vsOutput;
    output.pos = pos;
    output.ndc = vec3<f32>(positions[index], 1.0);
    return output;
}


@fragment
fn fs(input:fsInput) -> @location(0) vec4f {
    let uv = input.fragCoord.xy / iResolution;
    let dir =  textureLoad(refractionDirectionTexture,vec2<i32>(input.fragCoord.xy),0);
    let dirView = vec4f(dir.xyz,0.0);
    let dirWorld = camera.invViewMatrix * dirView;
    let refracted = textureSampleLevel(envTexture, envSampler, normalize(dirWorld.xyz),0);

    let clip  = vec4<f32>(input.ndc.xy * input.fragCoord.w, input.fragCoord.z, input.fragCoord.w);
    let view  = camera.invProjMatrix * clip;
    let world = camera.invViewMatrix * vec4<f32>(view.xyz, 0.0);
    let env = textureSampleLevel(envTexture, envSampler, normalize(world.xyz),0);
    if(dir.w < 0.0){
        return env;
    }
    else{
        return refracted;
    }
}