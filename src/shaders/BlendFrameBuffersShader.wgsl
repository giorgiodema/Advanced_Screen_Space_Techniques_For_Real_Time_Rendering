
@group(0) @binding(0) var frameBuffer1:texture_2d<f32>;
@group(0) @binding(1) var frameBuffer2:texture_2d<f32>;
@group(0) @binding(2) var depth1:texture_2d<f32>;
@group(0) @binding(3) var depth2:texture_2d<f32>;

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
fn fs(@builtin(position) fragCoord:vec4f) -> @location(0) vec4f {
    let f1 = textureLoad(frameBuffer1,vec2<i32>(fragCoord.xy),0);
    let f2 = textureLoad(frameBuffer2,vec2<i32>(fragCoord.xy),0);
    let d1 = textureLoad(depth1,vec2<i32>(fragCoord.xy),0).x;
    let d2 = textureLoad(depth2,vec2<i32>(fragCoord.xy),0).x;
    if(d1 < d2){
        return pow(f1,vec4f(0.4545));
    }
    else{
        return pow(f2,vec4f(0.4545));
    }
}