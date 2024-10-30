const ior:f32 = 1.5;

const maxConeAngle =  0.4 * 3.14;
const maxConeRadius = 1.0;

override maxMipLevel:f32 = 10.0;
override coneTracing:f32 = 1.0;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var reflectionsTexture:texture_2d<f32>;
@group(1) @binding(1) var metallicRoughnessTexture:texture_2d<f32>;
@group(1) @binding(2) var baseColorTexture:texture_2d<f32>;
@group(1) @binding(3) var litTexture:texture_2d<f32>;
@group(1) @binding(4) var positionTexture:texture_2d<f32>;
@group(1) @binding(5) var normalTexture:texture_2d<f32>;
@group(1) @binding(6) var reflUVTexture:texture_2d<f32>;

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
    let uv = fragCoord.xy / iResolution;
    let metallicRoughness = textureSample(metallicRoughnessTexture,basicSampler,uv).xy;
    let normal = textureSample(normalTexture,basicSampler,uv).xyz;
    let position = textureSample(positionTexture,basicSampler,uv).xyz;
    let reflUV = textureLoad(reflUVTexture,vec2<i32>(fragCoord.xy),0);
    let distanceTravelled =  abs(reflUV.z);
    let metalness = metallicRoughness.x;
    let roughness = metallicRoughness.y;

    var mipLevel = maxMipLevel * roughness;

    if(coneTracing==1.0 && reflUV.w==0.0){
        let coneAngle = maxConeAngle * roughness;
        var coneHeight = distanceTravelled;
        var coneRadius = coneHeight * tan(coneAngle);
        mipLevel = saturate(coneRadius / maxConeRadius);
        mipLevel = mipLevel * maxMipLevel;
    }

    // N = Normal of the macro surface.
    // H = Normal of the micro surface.
    // V = View vector going from surface's position towards the view's origin.
    // L = Light ray direction
    let a2 = roughness * roughness;
    let N = normal;
    let V = -normalize(position);
    let L = reflect(-V,N);
    let H = normalize(V+L);
    let VoH = saturate(dot(V,H));
    let NoV = saturate(dot(N,V));
    let NoL = saturate(dot(N,L));
    var color = textureSample(litTexture,basicSampler,uv).rgb;
    let baseColor = textureSample(baseColorTexture,basicSampler,uv).rgb;
    
    let vis = clamp(Vis_Schlick( a2, NoV, NoL),0.0,10.0);

    var F0Dielectric = (1.0-ior)/(1.0+ior);
    F0Dielectric *= F0Dielectric;
    var F0Metal = baseColor;

    let FresnelDielectric = F0Dielectric + (1.0 - F0Dielectric) * pow(1.0 - abs(VoH),5.0);
    let FresnelMetal = F0Metal + (1.0 - F0Metal) * pow(1.0 - abs(VoH),5.0);

    let specularInt = vis * textureSampleLevel(reflectionsTexture,basicSampler,uv,mipLevel).rgb; 
    let metallicColor = FresnelMetal * specularInt;
    let dielectricColor = FresnelDielectric * specularInt;
    let reflection = NoL * mix(dielectricColor,metallicColor,metalness);

    color += reflection;
    return vec4f(color,1.0);
}