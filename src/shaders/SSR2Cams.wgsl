/*
Given as input the GBuffer's view space positions (positionTexture) and view space
normals (normalTexture) computes the UV coordinates of the reflected color in the 
reflections buffer, when the reflection is visible in screen space, the visibility
and the reflected direction when the reflection is not visible in screen space. In 
particular the output is a single vec4f out, such that:
--> If (out.w == 0.0):
    --> out.xy: UV coordinates into reflection buffer
    --> abs(out.z) : distance travelled
    if(out.z > 0.0):
        --> UV refer to the front buffer
    else:
        --> UV refer to the rear buffer
--> If (out.w != 0.0):
    --> out.xyz: reflection direction (in view space)
*/

const resolution:f32 = 1.0;
const frontThickness:f32 = 0.001;
const rearThickness:f32 = 0.1;

override maxDistance:f32 = 10.0;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;
@group(0) @binding(2) var<uniform> frontCamera: Camera;
@group(0) @binding(3) var<uniform> rearCamera: Camera;

@group(1) @binding(0) var frontPositionTexture: texture_2d<f32>;
@group(1) @binding(1) var frontNormalTexture:texture_2d<f32>;
@group(1) @binding(2) var rearPositionTexture: texture_2d<f32>;
@group(1) @binding(3) var rearNormalTexture:texture_2d<f32>;

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

    var uv:vec2f = fragCoord.xy/iResolution.xy;

    // select front or back camera based on the orientation of the 
    // reflected vector with respect to the camera. If the reflection
    // vectors points outside the camera, then use the front camera, 
    // otherwise switch to the rear camera
    var positionFrom:vec4f = textureLoad(frontPositionTexture,vec2<i32>(fragCoord.xy),0);
    if(abs(positionFrom.z/maxDistance)>=1.0){
        return vec4f(0.0,0.0,0.0,-1.0);
    }
    let normalView:vec3f = textureLoad(frontNormalTexture,vec2<i32>(fragCoord.xy),0).xyz;
    /*
    let rearNormalView:vec3f = textureLoad(rearNormalTexture,vec2<i32>(fragCoord.xy),0).xyz;
    if(uv.x>=0.5){return vec4f(normalView,1.0);}
    else{return vec4f(rearNormalView,1.0);}
    */
    let unitPositionFrom:vec3f = normalize(positionFrom.xyz);
    var pivot:vec3f = normalize(reflect(unitPositionFrom,normalView));

    // find the intersection between the ray starting at positionFrom with
    // direction pivot and the xy plane (z = 0)
    let focalLength = rearCamera.projMatrix[1][1];
    let tstar = ((focalLength) - positionFrom.z) / pivot.z;
    var rearPositionFrom = positionFrom.xyz + tstar*pivot;
    rearPositionFrom = vec3f(-rearPositionFrom.x,rearPositionFrom.y,-rearPositionFrom.z);

    var thickness = frontThickness;

    var rayMarchFront:bool = true;
    if(dot(pivot,unitPositionFrom)<0.0){
        rayMarchFront = false;
        thickness = rearThickness;
        pivot = vec3f(-pivot.x,pivot.y,-pivot.z);
    }

    var startView:vec4f = vec4f(positionFrom.xyz,1.0);
    if(!rayMarchFront){
        startView = vec4f(rearPositionFrom.xyz,1.0);
    }
    var endView:vec4f = vec4f(positionFrom.xyz + pivot * maxDistance, 1.0);
    if(!rayMarchFront){
        endView = vec4f(rearPositionFrom.xyz + pivot * maxDistance, 1.0);
    }

    var startClip:vec4f = vec4f(frontCamera.projMatrix * startView);
    var endClip:vec4f = vec4f(frontCamera.projMatrix * endView);
    if(!rayMarchFront){
        startClip = vec4f(rearCamera.projMatrix * startView);
        endClip = vec4f(rearCamera.projMatrix * endView);
    }

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
    var intersectionFound = false;
    var currView = vec4f(0.0);
    var i:i32 = 0;
    for(i=0; i < i32(delta); i++){
        prevFrag = currFrag;
        currFrag += increment;
        currView = textureLoad(frontPositionTexture,vec2<i32>(currFrag),0);
        if(!rayMarchFront){
            currView = textureLoad(rearPositionTexture,vec2<i32>(currFrag),0);
        }
        var currClip = frontCamera.projMatrix * currView;
        if(!rayMarchFront){
            currClip = rearCamera.projMatrix * currView;
        }
        if( 
            abs(currClip.x) > abs(currClip.w) || 
            abs(currClip.y) > abs(currClip.w) || 
            abs(currClip.z) > abs(currClip.w))||
            currClip.z < 0.0{
                continue;
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
    }
    var distanceTravelled = length(currView-startView);
    // distanceTravelled cannot be zero
    if(distanceTravelled==0.0){
        distanceTravelled = thickness;
    }
    // output vector
    // out.xy -> uv coordinates of the reflected color in the framebuffer
    // out.w -> 0 if not visible, distanceTravelled if front buffer, -distanceTravelled if rear buffer
    var out = vec4f(0.0);
    if(intersectionFound){
        let currUV = currFrag/iResolution;
        let prevUV = prevFrag/iResolution;
        let reflUV = 0.5 * (currUV + prevUV);
        out.x = reflUV.x;
        out.y = reflUV.y;
        out.w = 0.0;
        if(rayMarchFront){
            out.z = distanceTravelled;
        }
        else{
            out.z = -distanceTravelled;
        }
    }
    else{
        pivot = normalize(reflect(unitPositionFrom,normalView));
        out.x = pivot.x;
        out.y = pivot.y;
        out.z = pivot.z;
        out.w = 1.0;
    }
    return out;
}
