@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var inputTexture: texture_2d<f32>;

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

    let grid = vec2f(2.0,2.0);
    let uv:vec2f = fragCoord.xy/iResolution.xy * grid;

    let tl = textureSample(inputTexture,basicSampler,uv).rrrr;
    let tr = textureSample(inputTexture,basicSampler,uv - vec2f(1.0,0.0)).gggg;
    let bl = textureSample(inputTexture,basicSampler,uv-vec2f(0.0,1.0)).bbbb;
    let br = textureSample(inputTexture,basicSampler,uv-vec2f(1.0,1.0)).aaaa;

    var color = vec4f(0.0);
    // top left
    if(uv.x <= 1.0 && uv.y <= 1.0){
        color = tl;
    }
    // top right
    else if(uv.x <= 2.0 && uv.y <= 1.0){
        color = tr;
    }
    // bottom left
    else if(uv.x <= 1.0){
        color = bl;
    }
    // bottom right
    else if(uv.x <= 2.0){
        color = br;
    }

    return color;
}
