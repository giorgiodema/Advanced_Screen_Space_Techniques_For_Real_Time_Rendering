@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(1) var positionTexture: texture_2d<f32>;
@group(1) @binding(2) var normalTexture:texture_2d<f32>;
@group(1) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;
@group(1) @binding(4) var depthTexture:texture_depth_2d;

@vertex
fn vs(@builtin(vertex_index) index:u32) -> @builtin(position) vec4<f32> {
    let pos = array(
        vec2f(-1.0, -1.0),   // bottom left
        vec2f( 1.0, -1.0),   // bottom right
        vec2f(-1.0,  1.0),   // top left
        vec2f(-1.0,  1.0),   // top left
        vec2f( 1.0,  1.0),   // top right
        vec2f( 1.0, -1.0),   // bottom right
    );
    return vec4f(pos[index],0.0, 1.0);
}

@fragment
fn fs(@builtin(position) fragCoord:vec4f) -> @location(0) vec4<f32> {

    let grid = vec2f(3.0,2.0);
    let uv:vec2f = fragCoord.xy/iResolution.xy * grid;

    let baseColor = textureSample(baseColorTexture,basicSampler,uv);
    let position = textureSample(positionTexture,basicSampler,uv - vec2f(1.0,0.0));
    let normal = textureSample(normalTexture,basicSampler,uv - vec2f(2.0,0.0));
    let metallic = textureSample(metallicRoughnessTexture,basicSampler,uv-vec2f(0.0,1.0)).rrra;
    let roughness = textureSample(metallicRoughnessTexture,basicSampler,uv-vec2f(1.0,1.0)).ggga;
    let depth = vec4f(textureSample(depthTexture,basicSampler,uv-vec2f(2.0,1.0)));

    var color = vec4f(0.0);
    // top left
    if(uv.x <= 1.0 && uv.y <= 1.0){
        color = baseColor;
    }
    // top center
    else if(uv.x <= 2.0 && uv.y <= 1.0){
        color = position;
    }
    // top right
    else if(uv.x <= 3 && uv.y <= 1.0){
        color = normal;
    }
    // bottom left
    else if(uv.x <= 1.0){
        color = metallic;
    }
    // bottom center
    else if(uv.x <= 2.0){
        color = roughness;
    }
    // bottom right
    else if(uv.x <= 3){
        color = pow(depth,vec4f(128.0));
    }

    return color;
}
