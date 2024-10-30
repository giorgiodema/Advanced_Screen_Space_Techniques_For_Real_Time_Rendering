/*
Given as input the GBuffer's view space positions (positionTexture) and view space
normals (normalTexture) computes the UV coordinates of the reflected color in the 
reflections buffer, when the reflection is visible in screen space, the visibility
and the reflected direction when the reflection is not visible in screen space. In 
particular the output is a single vec4f out, such that:
--> If (out.w == 0.0):
    --> out.xy: UV coordinates into reflection buffer
    --> out.z : distance travelled
--> If (out.w != 0.0):
    --> out.xyz: reflection direction (in view space)
*/

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var reflUV:texture_2d<f32>;
@group(1) @binding(1) var reflSource:texture_2d<f32>;


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
    let uvAndVisibility = textureLoad(reflUV,vec2<i32>(fragCoord.xy),0);
    //return vec4f(uvAndVisibility.z);
    let reflColor = textureSample(reflSource,basicSampler,uvAndVisibility.xy);
    if(uvAndVisibility.w == 0.0){
        return reflColor;
    }
    else{
        return vec4f(0.0);
    }
}