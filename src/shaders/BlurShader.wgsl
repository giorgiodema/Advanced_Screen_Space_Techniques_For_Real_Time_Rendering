@group(0) @binding(0) var srcTexture : texture_2d<f32>;
@group(0) @binding(1) var dstTexture : texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var kernelTexture : texture_2d<f32>;
@group(0) @binding(3) var<uniform> textureSize : vec2<u32>;

override kernelSize:f32;

@compute @workgroup_size(16, 16)
fn main(@builtin(global_invocation_id) GlobalInvocationID : vec3<u32>) {
    let x = GlobalInvocationID.x;
    let y = GlobalInvocationID.y;

    if (x >= textureSize.x || y >= textureSize.y) {
        return;
    }

    let halfKernelSize = kernelSize / 2.0;

    var color : vec4<f32> = vec4<f32>(0.0);
    var sum : f32 = 0.0;

    for (var ky : u32 = 0u; f32(ky) < kernelSize; ky = ky + 1u) {
        for (var kx : u32 = 0u; f32(kx) < kernelSize; kx = kx + 1u) {
            let sampleX = clamp(i32(x) + i32(kx) - i32(halfKernelSize), 0, i32(textureSize.x) - 1);
            let sampleY = clamp(i32(y) + i32(ky) - i32(halfKernelSize), 0, i32(textureSize.y) - 1);
            let sample = textureLoad(srcTexture, vec2<u32>(u32(sampleX), u32(sampleY)), 0);
            let weight = textureLoad(kernelTexture, vec2<u32>(kx, ky), 0).r;
            color = color + sample * weight;
            sum = sum + weight;
        }
    }

    color = color / sum; // Normalize the color
    textureStore(dstTexture, vec2<u32>(x, y), color);
}
