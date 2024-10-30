const ior:f32 = 1.5;

override maxMipLevel:f32 = 10.0;

@group(0) @binding(0) var<uniform> iResolution: vec2f;
@group(0) @binding(1) var basicSampler:sampler;

@group(1) @binding(0) var reflectionsTexture:texture_2d<f32>;
@group(1) @binding(1) var transmissionsTexture:texture_2d<f32>;
@group(1) @binding(2) var metallicRoughnessTexture:texture_2d<f32>;
@group(1) @binding(3) var baseColorTexture:texture_2d<f32>;
@group(1) @binding(4) var litTexture:texture_2d<f32>;
@group(1) @binding(5) var positionTexture:texture_2d<f32>;
@group(1) @binding(6) var normalTexture:texture_2d<f32>;

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
    let metallicRoughnessTransmission = textureSample(metallicRoughnessTexture,basicSampler,uv).xyz;
    let normal = textureSample(normalTexture,basicSampler,uv).xyz;
    let position = textureSample(positionTexture,basicSampler,uv).xyz;
    let metalness = metallicRoughnessTransmission.x;
    let roughness = metallicRoughnessTransmission.y;
    let transmission = metallicRoughnessTransmission.z;
    let mipLevel = maxMipLevel * roughness;

    let a2 = roughness * roughness;
    let N = normal;
    let V = -normalize(position);
    let L = reflect(-V,N);
    let T = refract(-V,N,1.0/ior);
    let H = normalize(V+L);
    let VoH = saturate(dot(V,H));
    let NoV = saturate(dot(N,V));
    let NoL = saturate(dot(N,L));
    let NoT = abs(dot(N,T));
    let HT = normalize(V+T);
    let HToT = abs(dot(HT,T));
    let HToV = abs(dot(HT,V));

    let vis = clamp(Vis_Schlick( a2, NoV, NoL),0.0,10.0);
    
    var color = textureSample(litTexture,basicSampler,uv).rgb;
    let baseColor = textureSample(baseColorTexture,basicSampler,uv).rgb;
    let specular = textureSampleLevel(reflectionsTexture,basicSampler,uv,mipLevel).rgb;
    let transmitted = textureSampleLevel(transmissionsTexture,basicSampler,uv,mipLevel).rgb;

    var F0Dielectric = (1.0-ior)/(1.0+ior);
    F0Dielectric *= F0Dielectric;
    var F0Metal = baseColor;

    let FresnelDielectric = F0Dielectric + (1.0 - F0Dielectric) * pow(1.0 - abs(VoH),5.0);
    let FresnelMetal = F0Metal + (1.0 - F0Metal) * pow(1.0 - abs(VoH),5.0);
    
    //let visT = pow(Vis_SmithTransmission(a2, NoV, NoT, HToT, HToV),0.3);
    //let diffuseTransmitted = visT * transmission * transmitted + color * (1.0 - transmitted);
    let diffuseTransmitted = transmission * transmitted + color * (1.0 - transmitted);
    let metallicColor = NoL * FresnelMetal * F0Metal;
    let specularInt =  vis * textureSampleLevel(reflectionsTexture,basicSampler,uv,mipLevel).rgb; 
    let dielectricColor = NoL * FresnelDielectric * specularInt + NoT * (1.0 - FresnelDielectric) * diffuseTransmitted;

    color = mix(dielectricColor,metallicColor,metalness);
    return vec4f(color,1.0);
}