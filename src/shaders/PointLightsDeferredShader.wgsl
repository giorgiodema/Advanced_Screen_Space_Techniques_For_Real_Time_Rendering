


//--------------------------------------------------------------------------------------------


struct DirectionalLight{
    intensity:f32,
    color:vec3f,
    direction:vec3f,
    castShadow:f32,
};

struct PointLight{
    intensity:f32,
    color:vec3f,
    position:vec3f,
    castShadow:f32,
};

struct SpotLight {
    position: vec3f,
    color: vec3f,
    direction: vec3f,
    intensity: f32,
    innerConeAngle: f32,
    outerConeAngle: f32,
    castShadow: f32,
};



struct Camera{
    viewMatrix:mat4x4f,
    projMatrix:mat4x4f,
    eye:vec3f
};

override directionalLightsCount:u32 = 0;
override pointLightsCount:u32 = 0;
override spotLightsCount:u32 = 0;

const directionalLightIntensityScale = 1.0;
const pointLightIntensityScale = 1.0;
const spotLightIntensityScale = 1.0;

const dielectricIOR:f32 = 1.5;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var baseColorTexture: texture_2d<f32>;
@group(1) @binding(1) var positionTexture: texture_2d<f32>;
@group(1) @binding(2) var normalTexture:texture_2d<f32>;
@group(1) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;

@group(2) @binding(0) var<uniform> directionalLights:array<DirectionalLight,10>;
@group(2) @binding(1) var<uniform> pointLights:array<PointLight,10>;
@group(2) @binding(2) var<uniform> spotLights:array<SpotLight,10>;

@group(3) @binding(0) var<uniform> camera:Camera;



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

    //return vec4f(1.0,0.0,0.0,1.0);
    let uv:vec2f = fragCoord.xy/iResolution.xy;

    let baseColor:vec3f = textureSample(baseColorTexture,basicSampler,uv).rgb;
    let position:vec3f = textureSample(positionTexture,basicSampler,uv).xyz;
    let normal:vec3f = textureSample(normalTexture,basicSampler,uv).xyz;
    let metallic:f32 = textureSample(metallicRoughnessTexture,basicSampler,uv).r;
    let roughness:f32 = textureSample(metallicRoughnessTexture,basicSampler,uv).g;

    let a2 = roughness * roughness;
    let N = normal;
    let V = -normalize(position);
    let NoV = saturate(dot(N,V));
    var color = vec3f(0.0);

    for(var i = 0u; i < directionalLightsCount; i+= 1u){
        let dlight = directionalLights[i];
        let dlColor = directionalLightIntensityScale * dlight.color * dlight.intensity;
        
        let L = normalize((camera.viewMatrix * vec4f(-dlight.direction,0.0)).xyz);
        let H = normalize(L+V);
        let NoH = saturate(dot(N,H));
        let NoL = saturate(dot(N,L));
        let VoH = saturate(dot(V,H));

        let brdf = surfaceBRDF(metallic,baseColor,dielectricIOR,a2,NoH,NoV,NoL,VoH);
        color += saturate(dlColor * brdf * NoL);
        color = saturate(color);
    }
    for(var i = 0u; i < pointLightsCount; i+= 1u){
        let plight = pointLights[i];
        let plightPosViewSpace = (camera.viewMatrix * vec4f(plight.position,1.0)).xyz;
        let dist = length(plightPosViewSpace - position);
        let distSquared = dist * dist;
        let plColor =pointLightIntensityScale *  plight.color * plight.intensity / (distSquared + 1.0);
        
        let L = normalize(plightPosViewSpace - position);
        let H = normalize(L+V);
        let NoH = saturate(dot(N,H));
        let NoL = saturate(dot(N,L));
        let VoH = saturate(dot(V,H));
        let brdf = surfaceBRDF(metallic,baseColor,dielectricIOR,a2,NoH,NoV,NoL,VoH);
        color += saturate(plColor * brdf * NoL);
        color = saturate(color);
    }
    for(var i = 0u; i < spotLightsCount; i+= 1u){
        let splight = spotLights[i];

        let splightPosViewSpace = (camera.viewMatrix * vec4f(splight.position,1.0)).xyz;
        let spDir = (camera.viewMatrix * vec4f(-splight.direction,0.0)).xyz;
        let cosTheta = dot(spDir, normalize(splightPosViewSpace-position) );
        let cosInnerCone = cos(splight.innerConeAngle);
        let cosOuterCone = cos(splight.outerConeAngle);
        var falloff = smoothstep(cosOuterCone,cosInnerCone,cosTheta);

        var distSquared = length(splightPosViewSpace - position);
        distSquared *= distSquared;
        let plColor = spotLightIntensityScale * falloff * splight.color * splight.intensity / (distSquared + 1.0);
        
        let L = normalize(splightPosViewSpace - position);
        let H = normalize(L+V);
        let NoH = saturate(dot(N,H));
        let NoL = saturate(dot(N,L));
        let VoH = saturate(dot(V,H));

        let brdf = surfaceBRDF(metallic,baseColor,dielectricIOR,a2,NoH,NoV,NoL,VoH);
        color += saturate(plColor * brdf * NoL);
        color = saturate(color);
    }

    return vec4f(color,1.0);
}
