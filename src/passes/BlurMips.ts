import BlurShader from '../shaders/BlurShader.wgsl';
import DownsampleShader from '../shaders/downsampleShader.wgsl';

function generateGaussianKernel(size:number, sigma:number):Float32Array {
  const kernel = new Float32Array(size * size);
  const mean = Math.floor(size / 2);
  let sum = 0; // For normalization

  for (let x = 0; x < size; x++) {
      for (let y = 0; y < size; y++) {
          const dx = x - mean;
          const dy = y - mean;
          const value = Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
          kernel[y * size + x] = value;
          sum += value;
      }
  }

  // Normalize the kernel
  for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= sum;
  }

  return kernel;
}

export class BlurMips{

  private device:GPUDevice;
  private inTextureFormat:GPUTextureFormat;

  private kernelTexture:GPUTexture|undefined;
  private blurComputePipeline:GPUComputePipeline | undefined;
  private downsamplePipeline:GPURenderPipeline | undefined;
  private downsampleSampler:GPUSampler | undefined;
  private blurBindGroupLayout:GPUBindGroupLayout | undefined;
  private downsampleLayout:GPUBindGroupLayout|undefined;

  constructor(device:GPUDevice,inTextureFormat:GPUTextureFormat){
    this.device = device;
    this.inTextureFormat = inTextureFormat;
  }

  private getNumMipMaps(width:number,height:number):number{
    let max = Math.max(width,height);
    return 1 + Math.floor(Math.log2(max));
  }

  public initializeRenderPipeline(){
    //--------------------------------
    // create pipeline to blur texture
    //--------------------------------
    // create buffers
    const kernelSize = 5;
    const kernelSigma = 1;
    const gaussianKernel = generateGaussianKernel(kernelSize,kernelSigma);
    this.kernelTexture = this.device.createTexture({
      label:"kernel texture descriptor",
      size: [kernelSize, kernelSize, 1],
      format: 'r32float',
      usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST
    });
    this.device.queue.writeTexture(
      { texture: this.kernelTexture },
      gaussianKernel,
      {
          bytesPerRow: kernelSize * 4,
          rowsPerImage: kernelSize
      },
      {
          width: kernelSize,
          height: kernelSize,
          depthOrArrayLayers: 1
      }
    );
    // create bind group
    this.blurBindGroupLayout = this.device.createBindGroupLayout({
      entries: [
          // src texture
          { binding: 0, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: <GPUTextureSampleType>'unfilterable-float' } },
          // dst texture
          { binding: 1, visibility: GPUShaderStage.COMPUTE, storageTexture: { access: <GPUStorageTextureAccess>'write-only', format: this.inTextureFormat } },
          // kernel
          { binding: 2, visibility: GPUShaderStage.COMPUTE, texture: {sampleType: <GPUTextureSampleType>'unfilterable-float'} },
          // texture size
          { binding: 3, visibility: GPUShaderStage.COMPUTE, buffer: { type: <GPUBufferBindingType>'uniform' } }
      ]
    });
    // Create compute pipeline
    this.blurComputePipeline = this.device.createComputePipeline({
      label:"blur pipeline",
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [this.blurBindGroupLayout] }),
      compute: {
          module: this.device.createShaderModule({ code: BlurShader }),
          entryPoint: 'main',
          constants:{
            kernelSize:kernelSize
          }
      }
    });
    // create pipeline to downsample texture
    this.downsampleSampler = this.device.createSampler({
      minFilter:'linear',
      magFilter:'linear'
    });
    this.downsampleLayout = this.device.createBindGroupLayout({
      label:"downsample bind group layout",
      entries:[
        {binding:0, visibility:GPUShaderStage.FRAGMENT,sampler:{type:<GPUSamplerBindingType>'filtering'}},
        {binding:1, visibility:GPUShaderStage.FRAGMENT,texture:{}}
      ]
    });
    this.downsamplePipeline = this.device.createRenderPipeline({
      label:"downsample pipeline",
      layout: this.device.createPipelineLayout({bindGroupLayouts:[this.downsampleLayout]}),
      vertex:{
        module: this.device.createShaderModule({code:DownsampleShader})
      },
      fragment:{
        module:this.device.createShaderModule({code:DownsampleShader}),
        targets:[
          {format:this.inTextureFormat}
        ]
      }
    });
  }

  public render(
    encoder:GPUCommandEncoder,
    inTexture:GPUTexture,
  ):GPUTexture{
    // error checks
    if(this.kernelTexture === undefined){
      throw Error("Kernel Texture is undefined");
    }
    if(this.blurComputePipeline===undefined || this.downsamplePipeline===undefined){
      throw Error("Pieline is undefined");
    }
    if(this.downsampleSampler===undefined){
      throw Error("Sampler is undefined");
    }
    if(this.downsampleLayout===undefined || this.blurBindGroupLayout===undefined){
      throw Error("Bind Group Layouts undefined");
    }
    let numMips = this.getNumMipMaps(inTexture.width,inTexture.height);
    let dst = this.device.createTexture({
      label:"dst texture descriptor",
      size:[inTexture.width,inTexture.height,inTexture.depthOrArrayLayers],
      mipLevelCount:numMips,
      dimension:inTexture.dimension,
      format:inTexture.format,
      usage:  GPUTextureUsage.COPY_DST | 
              GPUTextureUsage.COPY_SRC | 
              GPUTextureUsage.RENDER_ATTACHMENT | 
              GPUTextureUsage.STORAGE_BINDING | 
              GPUTextureUsage.TEXTURE_BINDING
    });
    // Copy the src into the first
    // mip level of dst
    encoder.copyTextureToTexture(
      {
        texture:inTexture,
        mipLevel:0
      },
      {texture:dst,
        mipLevel:0
      },
      [inTexture.width,inTexture.height,inTexture.depthOrArrayLayers]
    );
    let width = inTexture.width;
    let height = inTexture.height;
    for(let mip = 1; mip < numMips - 1; mip ++){
      for(let layer = 0; layer < inTexture.depthOrArrayLayers; layer ++){
        // blur dst[mip-1,level] and store in an auxiliary texture aux
        let aux = this.device.createTexture({
          label:"aux texture descriptor",
          size:[width,height],
          mipLevelCount:1,
          dimension:inTexture.dimension,
          format:inTexture.format,
          usage:dst.usage
        });
        const textureSizeBuffer = this.device.createBuffer({
          size: 2 * 4,
          usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.device.queue.writeBuffer(textureSizeBuffer, 0, new Uint32Array([inTexture.width,inTexture.height]));
        let blurBindGroup = this.device.createBindGroup({
          label:"blur bind group",
          layout:this.blurBindGroupLayout,
          entries:[
            {binding:0,resource:dst.createView({baseMipLevel:mip-1,mipLevelCount:1,baseArrayLayer:layer,arrayLayerCount:1,dimension:<GPUTextureViewDimension>'2d'})},
            {binding:1,resource:aux.createView({baseMipLevel:0,mipLevelCount:1,dimension:<GPUTextureViewDimension>'2d'})},
            {binding:2,resource:this.kernelTexture.createView()},
            {binding:3,resource:{buffer:textureSizeBuffer}}
          ]
        });
        const blendPassEncoder = encoder.beginComputePass();
        blendPassEncoder.setPipeline(this.blurComputePipeline);
        blendPassEncoder.setBindGroup(0,blurBindGroup);
        blendPassEncoder.dispatchWorkgroups(Math.ceil(width / 16), Math.ceil(height / 16));
        blendPassEncoder.end();
        // downsample aux and store in dst[mip,layer]
        let downsampleBindGroup = this.device.createBindGroup({
          label:"downsample bind group",
          layout:this.downsampleLayout,
          entries:[
            {binding:0,resource:this.downsampleSampler},
            {binding:1,resource:aux.createView({})}
          ]
        });
        const downsamplePassEncoder = encoder.beginRenderPass({
          label:"downsample pass",
          colorAttachments:[
            { view:dst.createView({
                format:this.inTextureFormat,
                baseMipLevel:mip,
                mipLevelCount:1,
                baseArrayLayer:layer,
                arrayLayerCount:1}),
            loadOp:<GPULoadOp>'load',
            storeOp:<GPUStoreOp>'store'
            }
          ]
        });
        downsamplePassEncoder.setPipeline(this.downsamplePipeline);
        downsamplePassEncoder.setBindGroup(0,downsampleBindGroup);
        downsamplePassEncoder.draw(6);
        downsamplePassEncoder.end();
      }
      width = Math.floor(width / 2);
      height = Math.floor(height / 2);
    }
    return dst;
  }
}