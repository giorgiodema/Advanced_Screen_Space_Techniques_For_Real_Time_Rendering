@group(0) @binding(0) var<uniform> camera: Camera;

@group(1) @binding(0) var<uniform> modelMatrix: mat4x4f;
@group(1) @binding(1) var<uniform> normalMatrix: mat4x4f;

@group(2) @binding(0) var basicSampler:sampler;
@group(2) @binding(1) var<uniform> material:Material;
@group(2) @binding(2) var baseColorTexture: texture_2d<f32>;
@group(2) @binding(3) var metallicRoughnessTexture: texture_2d<f32>;

struct Camera{
    viewMatrix:mat4x4f,
    projMatrix:mat4x4f,
    eye:vec3f
};

struct Light{
    color:vec3f,
    direction:vec3f
};

struct Material{
    baseColorFactor: vec4f,
    useBaseColorTexture: i32,
    metallicFactor:f32,
    roughnessFactor:f32,
    useMetallicRoughnessTexture: i32
};

struct vsInput{
    @location(0) position:vec3f,
    @location(1) normal:vec3f,
    @location(2) uvs:vec2f
};

struct vsOutput{
    @builtin(position) position:vec4f,
    @location(0) worldPos:vec4f,
    @location(1) viewPos:vec4f,
    @location(2) worldNormal:vec3f,
    @location(3) viewNormal:vec3f,
    @location(4) uvs:vec2f
};

struct fsOutput{
    @location(0) baseColor:vec4f,       // Albedo for dielectrics or F0 for metals 
    @location(1) positionTexture:vec4f, // View Space Position
    @location(2) normalTexture:vec4f,   // View Space Normal
    @location(3) metallicRoughnessTexture:vec4f,    
};

@vertex
fn vs(input: vsInput) -> vsOutput {
    let localPos = vec4f(input.position,1.0);
    let worldPos = modelMatrix * localPos;
    let viewPos  = camera.viewMatrix  * worldPos;
    let clipPos  = camera.projMatrix  * viewPos;
    let worldNormal = normalize(normalMatrix * vec4f(input.normal,0.0)).xyz;
    let viewNormal = normalize(camera.viewMatrix * vec4f(worldNormal,0.0)).xyz;
    
    let out = vsOutput(
        clipPos,
        worldPos,
        viewPos,
        worldNormal,
        viewNormal,
        input.uvs
    );
    return out;
}

@fragment
fn fs(input: vsOutput) -> fsOutput {
    
    var baseColor:vec4f;
    var metallicFactor:f32;
    var roughnessFactor:f32;
    if(material.useBaseColorTexture >= 0) {
        baseColor = textureSample(baseColorTexture,basicSampler,input.uvs);
    }
    else {
        baseColor = material.baseColorFactor;
    }
    if(material.useMetallicRoughnessTexture >= 0){
        metallicFactor = textureSample(metallicRoughnessTexture,basicSampler,input.uvs).r;
        roughnessFactor = textureSample(metallicRoughnessTexture,basicSampler,input.uvs).g;
    }
    else{
        metallicFactor = material.metallicFactor;
        roughnessFactor = material.roughnessFactor;
    }

    let output = fsOutput(
        baseColor,
        input.viewPos,
        vec4f(input.viewNormal,1.0),
        vec4f(metallicFactor,roughnessFactor,0.0,0.0),
    );

    return output;
}
