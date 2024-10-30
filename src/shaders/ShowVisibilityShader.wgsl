/*
The reflUV are structured as follows:
    --> If (reflUV.w == 0.0):
        --> reflUV.xy: UV coordinates into reflection buffer
        --> abs(reflUV.z) : distance travelled
        if(reflUV.z > 0):
            --> UV refer to the front buffer
        else:
            --> UV refer to rear buffer

    --> If (reflUV.w != 0.0):
        --> reflUV.xyz: reflection direction (in view space)
*/

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var inputTexture: texture_2d<f32>;

override showR:f32 = 1.0;
override showG:f32 = 1.0;
override showB:f32 = 1.0;
override showA:f32 = 1.0;

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
    
    let uvAndVisibility = textureLoad(inputTexture,vec2<i32>(i32(fragCoord.x),i32(fragCoord.y)),0);
    if(uvAndVisibility.w == 0){
        return vec4f(1.0);
    }
    else{
        return vec4f(0.0);
    }
}
