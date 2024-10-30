/*
Given as input the GBuffer's view space positions (positionTexture) and view space
normals (normalTexture) computes the UV coordinates of the refracted color in the 
lit opaque geometry buffer, when the refraction is visible in screen space, the visibility
and the refracted direction when the refraction is not visible in screen space. In 
particular the output is a single vec4f out, such that:
--> If (out.w == 0.0):
    --> out.xy: UV coordinates into refraction buffer
    --> out.z : distance travelled
--> If (out.w != 0.0):
    --> out.xyz: refraction direction (in view space)
    --> out.w: distance travelled
*/
const resolution:f32 = 1.0;
const thickness:f32 = 0.1;
const ior:f32 = 1.5;

override maxDistance:f32 = 10.0;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;
@group(0) @binding(2) var<uniform> camera: Camera;

@group(1) @binding(0) var positionTextureLayer1: texture_2d<f32>;
@group(1) @binding(1) var normalTextureLayer1:texture_2d<f32>;
@group(1) @binding(2) var positionTextureLayer2:texture_2d<f32>;
@group(1) @binding(3) var normalTextureLayer2:texture_2d<f32>;
@group(1) @binding(4) var positionTextureLayer3:texture_2d<f32>;

struct Camera{
    viewMatrix:mat4x4f,
    projMatrix:mat4x4f,
    eye:vec3f
};

struct RayMarchReturnType{
    reflUV:vec2f,
    intersectionFound:bool,
    distanceTravelled:f32
};

fn ssRayMarch(  startView:vec4f,
                endView:vec4f,
                camera:Camera,
                positionTexture:texture_2d<f32>,
                screenResolution:vec2f,
                marchResolution:f32,
                thickness:f32)->RayMarchReturnType
{
    var startClip:vec4f = vec4f(camera.projMatrix * startView);
    var endClip:vec4f = vec4f(camera.projMatrix * endView);

    let startDepth = startClip.z/startClip.w; // depth in NDC
    let endDepth = endClip.z/endClip.w; 

    var startFrag = vec2f(startClip.xy/startClip.w); // xy in [-1,1]
    startFrag = vec2f((startFrag.xy + 1.0) * 0.5);   // xy in [0,1], origin BL
    startFrag = vec2f(startFrag.x,1.0-startFrag.y); // xy in [0,1], origin TL
    startFrag = vec2f(startFrag.xy * screenResolution);  // xy in [width,height]

    var endFrag = vec2f(endClip.xy/endClip.w);  // xy in [-1,1]
    endFrag = vec2f((endFrag.xy + 1.0) * 0.5);  // xy in [0,1], origin BL
    endFrag = vec2f(endFrag.x,1.0-endFrag.y);   // xy in [0,1], origin TL
    endFrag = vec2f(endFrag.xy * screenResolution);  // xy in [width,height]

    let deltaX = endFrag.x - startFrag.x;
    let deltaY = endFrag.y - startFrag.y;

    var useX:f32;
    if(abs(deltaX) >= abs(deltaY)){
        useX = 1.0;
    }
    else{
        useX = 0.0;
    }
    var delta = mix(abs(deltaY),abs(deltaX),useX) * resolution;
    var diag = sqrt(screenResolution.x*screenResolution.x + screenResolution.y*screenResolution.y);
    // bound delta to prevent
    // performance issues
    if(delta <= 1.0){delta = 1.0;}
    if(delta >= diag){delta = diag;}
    let increment:vec2f = vec2f(deltaX,deltaY) / delta;

    var currFrag = vec2f(startFrag.xy);
    var prevFrag = vec2f(startFrag.xy);
    var currView = vec4f(startView);
    var intersectionFound = false;
    var i:i32 = 0;
    for(i=0; i < i32(delta); i++){
        currFrag += increment;
        currView = textureLoad(positionTexture,vec2<i32>(currFrag),0);
        let currClip = camera.projMatrix * currView;
        if( 
            abs(currClip.x) > abs(currClip.w) || 
            abs(currClip.y) > abs(currClip.w) || 
            abs(currClip.z) > abs(currClip.w)){
                break;
        }
        let sceneDepth = currClip.z/currClip.w;
        let t = f32(i)/f32(delta);
        // perspective correct interpolation between 
        // start and end depths
        let currRayDepth =  1.0/mix(1.0/startDepth,1.0/endDepth,t);
        let diff = currRayDepth - sceneDepth;
        if(diff > 0 && diff < thickness){
            intersectionFound = true;
            break;
        }
        prevFrag = currFrag;
    }
    let distanceTravelled = length(currView-startView);
    let currUV = currFrag/screenResolution;
    let prevUV = prevFrag/screenResolution;
    let reflUV = 0.5 * (currUV + prevUV);

    return RayMarchReturnType(reflUV,intersectionFound,distanceTravelled);
}



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

    let uv:vec2f = fragCoord.xy/iResolution.xy;

    let positionFrom1:vec4f = textureLoad(positionTextureLayer1,vec2<i32>(fragCoord.xy),0);
    if(abs(positionFrom1.z/maxDistance)>=1.0){
        return vec4f(0.0,0.0,0.0,-1.0);
    }
    let normalView1:vec3f = textureLoad(normalTextureLayer1,vec2<i32>(fragCoord.xy),0).xyz;
    let unitPositionFrom1:vec3f = normalize(positionFrom1.xyz);
    let pivot1:vec3f = normalize(refract(unitPositionFrom1,normalView1,1.0/ior));

    // find the intersection between the transmitted ray and the interior of
    // the volume object
    let startView1:vec4f = vec4f(positionFrom1.xyz,1.0);
    let endView1:vec4f = vec4f(positionFrom1.xyz + pivot1 * maxDistance, 1.0);
    let res1 = ssRayMarch(  startView1,
                            endView1,
                            camera,
                            positionTextureLayer2,
                            iResolution,
                            resolution,
                            thickness);
    // raymarch along the exit direction to find the intersection with the
    // opaque scene
    let startView2 = vec4f(positionFrom1.xyz + pivot1 * res1.distanceTravelled, 1.0);
    let unitPositionFrom2 = normalize(startView2.xyz);
    let fragCoord2 = res1.reflUV * iResolution;
    let normalView2 = textureLoad(normalTextureLayer2,vec2<i32>(fragCoord2.xy),0).xyz;
    var pivot2 = normalize(refract(pivot1,-normalView2,ior));
    // handle total internal reflection
    let thetai = acos(dot(pivot1,normalView2));
    let thetaCrit = asin(1.0/1.5);
    // handle total internal reflection
    if(thetai >= thetaCrit){
        pivot2 = normalView2;
    }
    var out = vec4f(0.0);
    let endView2 = vec4f(startView2.xyz + pivot2 * maxDistance, 1.0);

    let res2 = ssRayMarch(  startView2,
                            endView2,
                            camera,
                            positionTextureLayer3,
                            iResolution,
                            resolution,
                            thickness);


    var distanceTravelled = res1.distanceTravelled;
    if(distanceTravelled==0.0){
        distanceTravelled = thickness;
    }
    // even if no intersection is found, distanceTravelled
    // is still used
    if(res1.intersectionFound && res2.intersectionFound){
        out.x = res2.reflUV.x;
        out.y = res2.reflUV.y;
        out.z = res1.distanceTravelled;
        out.w = 0.0;
    }
    else if(res1.intersectionFound && !res2.intersectionFound){
        out.x = pivot2.x;
        out.y = pivot2.y;
        out.z = pivot2.z;
        out.w = distanceTravelled;
    }
    else{
        out.x = -normalView1.x;
        out.y = -normalView1.y;
        out.z = -normalView1.z;
        out.w = distanceTravelled;
    }
    return out;
}
