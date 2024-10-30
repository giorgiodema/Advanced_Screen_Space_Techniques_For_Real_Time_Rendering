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
struct Camera {
    invViewMatrix: mat4x4<f32>,
    invProjMatrix: mat4x4<f32>,
    eye: vec3<f32>
};


@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var reflUV:texture_2d<f32>;
@group(1) @binding(1) var frontReflSource:texture_2d<f32>;
@group(1) @binding(2) var rearReflSource:texture_2d<f32>;
@group(1) @binding(3) var envTexture:texture_cube<f32>;

@group(2) @binding(0) var<uniform> camera: Camera;

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

    let frontReflColor = textureSample(frontReflSource,basicSampler,uvAndVisibility.xy);
    let rearReflColor = textureSample(rearReflSource,basicSampler,uvAndVisibility.xy);
    if(uvAndVisibility.w == 0.0){
        if(uvAndVisibility.z > 0.0){
            return frontReflColor;
        }
        else{
            return rearReflColor;
        }
    }
    else{
        let dir = vec4f(uvAndVisibility.xyz,0.0);
        let dirWorld = camera.invViewMatrix * dir;
        let env = textureSampleLevel(envTexture, basicSampler, normalize(dirWorld.xyz),0);
        return env;      
    }
}