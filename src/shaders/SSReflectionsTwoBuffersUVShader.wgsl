/*
Given as input the GBuffer's view space positions (positionTexture) and view space
normals (normalTexture) computes the UV coordinates of the reflected color in the 
reflections buffer, when the reflection is visible in screen space, the visibility
and the reflected direction when the reflection is not visible in screen space. In 
particular the output is a single vec4f out, such that:
--> If (out.w == 0.0):
    --> out.xy: UV coordinates into reflection buffer
    --> out.z : distance travelled
    if(out.z > 0):
        --> UV refer to the front buffer
    else:
        --> UV refer to rear buffer
--> If (out.w != 0.0):
    --> out.xyz: reflection direction (in view space)
*/
const resolution:f32 = 1.0;
const thickness:f32 = 0.1;

override maxDistance:f32 = 10.0;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;
@group(0) @binding(2) var<uniform> camera: Camera;

@group(1) @binding(0) var startPositionTexture: texture_2d<f32>;
@group(1) @binding(1) var startNormalTexture:texture_2d<f32>;
@group(1) @binding(2) var targetPositionTexture: texture_2d<f32>;

struct Camera{
    viewMatrix:mat4x4f,
    projMatrix:mat4x4f,
    eye:vec3f
};


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

    let positionFrom:vec4f = textureLoad(startPositionTexture,vec2<i32>(fragCoord.xy),0);
    if(abs(positionFrom.z/maxDistance)>=1.0){
        return vec4f(0.0,0.0,0.0,-1.0);
    }
    let normalView:vec3f = textureLoad(startNormalTexture,vec2<i32>(fragCoord.xy),0).xyz;
    let unitPositionFrom:vec3f = normalize(positionFrom.xyz);
    let pivot:vec3f = normalize(reflect(unitPositionFrom,normalView));
    // if the reflection vector is facing the camera, then the ray will either
    // go out of screen or hit the back of an object (not visible in screen space)
    if(dot(pivot,unitPositionFrom)<0.0){
        return vec4f(0.0);
    }

    let startView:vec4f = vec4f(positionFrom.xyz,1.0);
    let endView:vec4f = vec4f(positionFrom.xyz + pivot * maxDistance, 1.0);

    var startClip:vec4f = vec4f(camera.projMatrix * startView);
    var endClip:vec4f = vec4f(camera.projMatrix * endView);

    let startDepth = startClip.z/startClip.w; // depth in NDC
    let endDepth = endClip.z/endClip.w; 

    var startFrag = vec2f(startClip.xy/startClip.w); // xy in [-1,1]
    startFrag = vec2f((startFrag.xy + 1.0) * 0.5);   // xy in [0,1], origin BL
    // the  WebGPU Coordinate Systems is defined as 
    // --> NDC: x in [-1,1], y in [-1,1], z in [0,1]
    // --> uv: x in [0,1], y in [0,1] with the origin at TOP LEFT corner.
    // --> framebuffer: x in [0,width], y in [0,height] 
    //                  with the origin is at the TOP LEFT corner. 
    // When transforming the xy NDC coordinates to uv coordinates the
    // origin must move from bottom left to top left, hence the y axis
    // must be inverted
    startFrag = vec2f(startFrag.x,1.0-startFrag.y); // xy in [0,1], origin TL
    startFrag = vec2f(startFrag.xy * iResolution);  // xy in [width,height]

    var endFrag = vec2f(endClip.xy/endClip.w);  // xy in [-1,1]
    endFrag = vec2f((endFrag.xy + 1.0) * 0.5);  // xy in [0,1], origin BL
    endFrag = vec2f(endFrag.x,1.0-endFrag.y);   // xy in [0,1], origin TL
    endFrag = vec2f(endFrag.xy * iResolution);  // xy in [width,height]

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
    var diag = sqrt(iResolution.x*iResolution.x + iResolution.y*iResolution.y);
    // bound delta to prevent
    // performance issues
    if(delta <= 1.0){delta = 1.0;}
    if(delta >= diag){delta = diag;}
    let increment:vec2f = vec2f(deltaX,deltaY) / delta;

    var currFrag = vec2f(startFrag.xy);
    var prevFrag = vec2f(startFrag.xy);
    var currView = vec4f(0.0);
    var intersectionFound = false;
    var i:i32 = 0;
    for(i=0; i < i32(delta); i++){
        currFrag += increment;
        currView = textureLoad(targetPositionTexture,vec2<i32>(currFrag),0);
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

    var out = vec4f(0.0);
    if(intersectionFound){
        let currUV = currFrag/iResolution;
        let prevUV = prevFrag/iResolution;
        let reflUV = 0.5 * (currUV + prevUV);
        out.x = reflUV.x;
        out.y = reflUV.y;
        out.z = distanceTravelled;
    }
    else{
        out.x = pivot.x;
        out.y = pivot.y;
        out.z = pivot.z;
        out.w = 1.0;
    }
    return out;
}
