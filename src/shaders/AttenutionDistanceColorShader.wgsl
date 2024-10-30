@group(0) @binding(0) var<uniform> camera: Camera;

@group(1) @binding(0) var<uniform> modelMatrix: mat4x4f;
@group(1) @binding(1) var<uniform> normalMatrix: mat4x4f;

@group(2) @binding(0) var<uniform> material:Material;

@group(3) @binding(0) var maxDepthTexture: texture_2d<f32>;


struct Camera{
    viewMatrix:mat4x4f,
    projMatrix:mat4x4f,
    eye:vec3f
};

struct Material{
    // the material GPU buffer is created
    // in  class GPUMaterialVolume in
    // utils/glTFLoader.ts
    baseColorFactor: vec4f,
    useBaseColorTexture: i32,
    metallicFactor:f32,
    roughnessFactor:f32,
    useMetallicRoughnessTexture: i32,
    attenuationColor:vec4f,
    attenuationDistance:f32,
    transmissionFactor:f32,
    useTransmissionTexture: i32
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
fn fs(input: vsOutput) -> @location(0) vec4f {

    let maxDepth = textureLoad(maxDepthTexture,vec2<i32>(i32(input.position.x),i32(input.position.y)),0).x;
    if(input.position.z >= maxDepth){
        discard;
    }
    return vec4f(material.attenuationColor.rgb,material.attenuationDistance);
}
