struct Camera {
    invViewMatrix: mat4x4<f32>,
    invProjMatrix: mat4x4<f32>,
    eye: vec3<f32>
};


@group(0) @binding(0) var frameBuffer1:texture_2d<f32>;
@group(0) @binding(1) var frameBuffer2:texture_2d<f32>;
@group(0) @binding(2) var depth1:texture_2d<f32>;
@group(0) @binding(3) var depth2:texture_2d<f32>;
@group(0) @binding(4) var envTexture:texture_cube<f32>;

@group(1) @binding(0) var<uniform> iResolution: vec2f;
@group(1) @binding(1) var basicSampler:sampler;

@group(2) @binding(0) var<uniform> camera: Camera;

struct vsOutput {
    @builtin(position) pos: vec4<f32>,
    @location(0) ndc: vec3<f32>,
};

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
fn fs(input: vsOutput) -> @location(0) vec4f {
    let f1 = textureLoad(frameBuffer1,vec2<i32>(input.pos.xy),0);
    let f2 = textureLoad(frameBuffer2,vec2<i32>(input.pos.xy),0);
    let d1 = textureLoad(depth1,vec2<i32>(input.pos.xy),0).x;
    let d2 = textureLoad(depth2,vec2<i32>(input.pos.xy),0).x;

    let clip  = vec4<f32>(input.ndc.xy * input.pos.w, input.pos.z, input.pos.w);
    let view  = camera.invProjMatrix * clip;
    let world = camera.invViewMatrix * vec4<f32>(view.xyz, 0.0);
    let env = textureSample(envTexture, basicSampler, normalize(world.xyz));
    if(min(d1,d2)>=1.0){
        return env;
    }
    if(d1 < d2){
        return pow(f1,vec4f(0.4545));
    }
    else{
        return pow(f2,vec4f(0.4545));
    }
}