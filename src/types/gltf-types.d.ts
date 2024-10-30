// gltf-types.d.ts

export interface GlTF {
    asset: GlTFAsset;
    scenes?: GlTFScene[];
    scene?:number;
    nodes?: GlTFNode[];
    meshes?: GlTFMesh[];
    accessors?: GlTFAccessor[];
    bufferViews?: GlTFBufferView[];
    buffers?: GlTFBuffer[];
    materials?: GlTFMaterial[];
    textures?: GlTFTexture[];
    images?: GlTFImage[];
    animations?: GlTFAnimation[];
    samplers?: GlTFSampler[];
    cameras?: GlTFCamera[];
    extensionsUsed?: string[];
    extensionsRequired?: string[];
    extensions?: {
        KHR_lights_punctual?: KHRLightsPunctualExtension;
    };
    extras?: any;
}

interface KHRLightsPunctualExtension {
    lights: GLTFLight[];
}

export interface GlTFAsset {
    version: string;
    minVersion?: string;
    generator?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFScene {
    nodes: number[];
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFNode {
    extensions?: {
        KHR_lights_punctual?: NodeLightReference;
    };
    mesh?: number;
    children?: number[];
    name?: string;
    translation?: number[];
    rotation?: number[];
    scale?: number[];
    matrix?: number[];
    camera?: number;
    skin?: number;
    weights?: number[];
    extras?: any;
}

interface NodeLightReference {
    light: number;
}

interface GLTFLight {
    color?: [number, number, number]; // RGB value, default: [1.0, 1.0, 1.0]
    intensity?: number; // Light intensity, default: 1.0
    range?: number; // Distance cutoff, default: infinite
    type: 'directional' | 'point' | 'spot'; // Type of the light
    name?: string; // Name of the light
    spot?: GLTFSpotLight; // Spot light properties if type is 'spot'
}

interface GLTFSpotLight {
    innerConeAngle?: number; // Inner cone angle in radians, default: 0.0
    outerConeAngle?: number; // Outer cone angle in radians, default: Math.PI / 4.0
}


export interface GlTFMesh {
    primitives: GlTFMeshPrimitive[];
    weights?: number[];
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFMeshPrimitive {
    attributes: { [key: string]: number };
    indices?: number;
    material?: number;
    mode?: number;
    targets?: { [key: string]: number }[];
    extensions?: any;
    extras?: any;
}

export interface GlTFAccessor {
    bufferView?: number;
    byteOffset?: number;
    componentType: number;
    normalized?: boolean;
    count: number;
    type: string;
    max?: number[];
    min?: number[];
    sparse?: GlTFAccessorSparse;
    extensions?: any;
    extras?: any;
}

export interface GlTFAccessorSparse {
    count: number;
    indices: GlTFAccessorSparseIndices;
    values: GlTFAccessorSparseValues;
}

export interface GlTFAccessorSparseIndices {
    bufferView: number;
    byteOffset?: number;
    componentType: number;
    extensions?: any;
    extras?: any;
}

export interface GlTFAccessorSparseValues {
    bufferView: number;
    byteOffset?: number;
    extensions?: any;
    extras?: any;
}

export interface GlTFBufferView {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
    target?: number;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFBuffer {
    uri?: string;
    byteLength: number;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFMaterial {
    name?: string;
    pbrMetallicRoughness?: GlTFPbrMetallicRoughness;
    normalTexture?: GlTFMaterialNormalTextureInfo;
    occlusionTexture?: GlTFMaterialOcclusionTextureInfo;
    emissiveTexture?: GlTFTextureInfo;
    emissiveFactor?: number[];
    alphaMode?: string;
    alphaCutoff?: number;
    doubleSided?: boolean;
    extensions?: {
        KHR_materials_transmission?:GlTFMaterialsTransmission,
        KHR_materials_volume?:GlTFMaterialsVolume,
    };
    extras?: any;
}

export interface GlTFMaterialsTransmission{
    transmissionFactor?: number, // default 0
    transmissionTexture?: GlTFTextureInfo
}

export interface GlTFMaterialsVolume{
    thicknessFactor?:number, // default 0
    thicknessTexture?:GlTFTextureInfo,
    attenuationDistance?:number,// default +inf
    attenuationColor?:number[3],//defailt [1,1,1]
}

export interface GlTFPbrMetallicRoughness {
    baseColorFactor?: number[];
    baseColorTexture?: GlTFTextureInfo;
    metallicFactor?: number;
    roughnessFactor?: number;
    metallicRoughnessTexture?: GlTFTextureInfo;
    extensions?: any;
    extras?: any;
}

export interface GlTFMaterialNormalTextureInfo extends GlTFTextureInfo {
    scale?: number;
}

export interface GlTFMaterialOcclusionTextureInfo extends GlTFTextureInfo {
    strength?: number;
}

export interface GlTFTextureInfo {
    index: number;
    texCoord?: number;
    extensions?: any;
    extras?: any;
}

export interface GlTFTexture {
    sampler?: number;
    source?: number;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFImage {
    uri?: string;
    mimeType?: string;
    bufferView?: number;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFAnimation {
    channels: GlTFAnimationChannel[];
    samplers: GlTFAnimationSampler[];
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFAnimationChannel {
    sampler: number;
    target: GlTFAnimationChannelTarget;
    extensions?: any;
    extras?: any;
}

export interface GlTFAnimationChannelTarget {
    node: number;
    path: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFAnimationSampler {
    input: number;
    output: number;
    interpolation?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFSampler {
    magFilter?: number;
    minFilter?: number;
    wrapS?: number;
    wrapT?: number;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFCamera {
    type: string;
    orthographic?: GlTFCameraOrthographic;
    perspective?: GlTFCameraPerspective;
    name?: string;
    extensions?: any;
    extras?: any;
}

export interface GlTFCameraOrthographic {
    xmag: number;
    ymag: number;
    zfar: number;
    znear: number;
    extensions?: any;
    extras?: any;
}

export interface GlTFCameraPerspective {
    aspectRatio?: number;
    yfov: number;
    zfar?: number;
    znear: number;
    extensions?: any;
    extras?: any;
}