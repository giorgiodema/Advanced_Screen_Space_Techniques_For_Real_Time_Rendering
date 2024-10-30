import { PerspectiveCamera } from "../utils/camera";
import SSRMirrorShader from "../shaders/SSR2Cams.wgsl";
import BRDFShader from "../shaders/BRDF.wgsl";
import BlendReflectionsShader from "../shaders/BlendReflectionsShader.wgsl";
import SSR2CamsDrawShader from "../shaders/SSR2CamsDraw.wgsl";
import SSR2CamsDrawEnvShader from "../shaders/SSR2CamsDrawEnv.wgsl";
import { mipLevelCount } from "../utils/textureUtils";
import { negate, saxpy } from "../utils/vectors";
import * as mathUtils from '../utils/math';


export class SSReflections2CamsUVPass{

    private device:GPUDevice;
    private frontCamera:PerspectiveCamera;

    public static readonly targetReflUVFormat = <GPUTextureFormat>'rgba32float';

    private resolutionSamplerCameraBindGroup:GPUBindGroup | undefined;
    private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
    private pipeline:GPURenderPipeline | undefined;
    private frontCameraBuffer:GPUBuffer | undefined;
    private rearCameraBuffer:GPUBuffer | undefined;

    constructor(
        device:GPUDevice,
        camera:PerspectiveCamera,
      ){
        this.device = device;
        this.frontCamera = camera;
    }

    public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
      // resources
      this.frontCameraBuffer = this.device.createBuffer({
        label:  "frontCameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.rearCameraBuffer = this.device.createBuffer({
        label:  "rearCameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      let resolutionBuffer = this.device.createBuffer({
        label:"resolution Buffer",
        size:32,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation:true
      });
      let resolutionArray = new Float32Array([
        canvasWidth,
        canvasHeight
      ]);
      let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
      dst.set(resolutionArray);
      resolutionBuffer.unmap();

      let basicSampler = this.device.createSampler({});
      // bind groups
      let resolutionSamplerCameraBindGroupLayout = this.device.createBindGroupLayout({
        label:"SSRMirror resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
          { binding:2,                                              // front camera
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:3,                                              // rear camera
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
        ]
      });
      this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
        label:"SSRMirror textures bind group",
        entries:[
          { binding:0, // front position
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:1, // front normal
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:2, // rear position
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:3, // rear normal
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerCameraBindGroup = this.device.createBindGroup({
        label:"SSRMirror resolution sampler bind group",
        layout:resolutionSamplerCameraBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler},
          {binding:2,resource:{buffer:this.frontCameraBuffer}},
          {binding:3,resource:{buffer:this.rearCameraBuffer}},
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"SSR Mirror Pipeline",
        vertex:{
            module:this.device.createShaderModule({code:SSRMirrorShader}),
        },
        layout:this.device.createPipelineLayout(
            {bindGroupLayouts:[ resolutionSamplerCameraBindGroupLayout,
                                this.GBufferBindGroupLayout]}),
        fragment:{
            module:this.device.createShaderModule({code:SSRMirrorShader}),
            targets:[
                {format:SSReflections2CamsUVPass.targetReflUVFormat},
            ],
            constants:{
              maxDistance:this.frontCamera.far,
            }
        }
      });
    }

    public render(
        encoder:GPUCommandEncoder,
        inFrontPositionTexture:GPUTexture,
        inFrontNormalTexture:GPUTexture,
        inRearPositionTexture:GPUTexture,
        inRearNormalTexture:GPUTexture,
        outReflUVTexture:GPUTexture,
        rearFovFactor:number=1.0,
        querySet:GPUQuerySet|undefined = undefined,
        startTimeId:number|undefined = undefined,
        endTimeId:number|undefined = undefined
    ){
        // error checks
        if(this.GBufferBindGroupLayout===undefined){
            throw Error("GBuffer Bind Group Layout is undefined");
        }
        if(this.frontCameraBuffer===undefined || this.rearCameraBuffer===undefined){
            throw Error("Camera Buffer is undefined");
        }
        if(this.pipeline === undefined){
            throw Error("Pipeline is undefined");
        }
        if(this.resolutionSamplerCameraBindGroup === undefined){
            throw Error("Resolution Sampler Camera Bind gorup is undefined");
        }
        // write buffers
        let rearCamera = new PerspectiveCamera(
          this.frontCamera.eye,
          saxpy(2.0,this.frontCamera.eye,negate(this.frontCamera.lookAt)),
          Math.max(Math.min(rearFovFactor*this.frontCamera.fov,180.0),0.0),
          this.frontCamera.near,
          this.frontCamera.far,
          this.frontCamera.ar
        );
        let frontCameraArray = this.frontCamera.getCameraBuffer();
        let rearCameraArray = rearCamera.getCameraBuffer();
        this.device.queue.writeBuffer(
          this.frontCameraBuffer,
          0,
          frontCameraArray
        );
        this.device.queue.writeBuffer(
          this.rearCameraBuffer,
          0,
          rearCameraArray
        );
        // create dynamic bind groups
        let GBufferBindGroup = this.device.createBindGroup({
            label:"GBufferViewer textures bind group",
            layout:this.GBufferBindGroupLayout,
            entries:[
            {binding:0,resource:inFrontPositionTexture.createView()},
            {binding:1,resource:inFrontNormalTexture.createView()},
            {binding:2,resource:inRearPositionTexture.createView()},
            {binding:3,resource:inRearNormalTexture.createView()},
            ]
        });
        // profiling stuff
        let timeStampWrites:GPURenderPassTimestampWrites|undefined = undefined;
        if(querySet!==undefined && startTimeId!==undefined && endTimeId!==undefined){
          timeStampWrites =<GPURenderPassTimestampWrites> {
            querySet:querySet,
            beginningOfPassWriteIndex:startTimeId,
            endOfPassWriteIndex:endTimeId
          };
        }
        // create render pass & draw
        let pass = encoder.beginRenderPass({
            colorAttachments:[
              { view:outReflUVTexture.createView(),
                loadOp:<GPULoadOp>'clear',
                clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
                storeOp:<GPUStoreOp>'store'
              }
            ],
            timestampWrites:timeStampWrites
          });
          pass.setPipeline(this.pipeline);
          pass.setBindGroup(0,this.resolutionSamplerCameraBindGroup);
          pass.setBindGroup(1,GBufferBindGroup);
          pass.draw(6);
          pass.end();
    }

}

export class SSR2CamsDrawPass{

    private device:GPUDevice;
    private frameBufferFormat:GPUTextureFormat;

    private sourceTexturesBindGroupLayout:GPUBindGroupLayout | undefined;
    private resolutionSamplerBindGroup:GPUBindGroup|undefined;
    private pipeline:GPURenderPipeline|undefined;

    constructor(device:GPUDevice,frameBufferFormat:GPUTextureFormat){
        this.device = device;
        this.frameBufferFormat = frameBufferFormat;
    }

    public async initializeRenderPipeline(canvasWidth:number, canvasHeight:number){
        // initialize resources
        let resolutionBuffer = this.device.createBuffer({
            label:"resolution Buffer",
            size:32,
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
        });
        let resolutionArray = new Float32Array([
            canvasWidth,
            canvasHeight
        ]);
        let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
        dst.set(resolutionArray);
        resolutionBuffer.unmap();
        let sampler = this.device.createSampler({});
        // initialize bind group layouts
        let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
            label:"SSR Draw resolutio sampler bind group layout",
            entries:[
                {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{}},
                {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
            ]
        });
        this.sourceTexturesBindGroupLayout = this.device.createBindGroupLayout({
            label:"SSR Draw source textures bind group layout",
            entries:[
                {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
                {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float'}},
                {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float'}},
            ]
        });
        // initialize bind group
        this.resolutionSamplerBindGroup = this.device.createBindGroup({
            layout:resolutionSamplerBindGroupLayout,
            entries:[
                {binding:0,resource:{buffer:resolutionBuffer}},
                {binding:1,resource:sampler}
            ]
        });
        // initialize pipeline
        this.pipeline = this.device.createRenderPipeline({
            label:"SSR Draw Pipeline",
            layout:this.device.createPipelineLayout({
                bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.sourceTexturesBindGroupLayout]}
            ),
            vertex:{
                module:this.device.createShaderModule({code:SSR2CamsDrawShader})
            },
            fragment:{
                module:this.device.createShaderModule({code:SSR2CamsDrawShader}),
                targets:[{format:this.frameBufferFormat}]
            },
        });
    }

    public render(
        encoder:GPUCommandEncoder,
        inReflUVTexture:GPUTexture,
        inFrontReflectionSourceTexture:GPUTexture,
        inRearReflectionSourceTexture:GPUTexture,
        outFrameBufferTexture:GPUTexture
    ){
        // error check
        if(this.sourceTexturesBindGroupLayout === undefined){
            throw Error("sourceTextureBindGroupLayout is undefined");
        }
        if(this.resolutionSamplerBindGroup === undefined){
            throw Error("Resolution sampler bind group is undefined");
        }
        if(this.pipeline === undefined){
            throw Error("Pipeline is undefined");
        }
        // create bind group
        let sourceTexturesBindGroup = this.device.createBindGroup({
            label:"SSR source textures bind group",
            layout:this.sourceTexturesBindGroupLayout,
            entries:[
                {binding:0, resource:inReflUVTexture.createView()},
                {binding:1, resource:inFrontReflectionSourceTexture.createView()},
                {binding:2, resource:inRearReflectionSourceTexture.createView()}
            ]
        });
        // set render pass and render
        let pass = encoder.beginRenderPass({
            colorAttachments:[{
                view:outFrameBufferTexture.createView(),
                loadOp:<GPULoadOp>'clear',
                storeOp:<GPUStoreOp>'store',
                clearValue:<GPUColor>{r:0,g:0,b:0,a:1}
            }],
        });

        pass.setBindGroup(0,this.resolutionSamplerBindGroup);
        pass.setBindGroup(1,sourceTexturesBindGroup);
        pass.setPipeline(this.pipeline);
        pass.draw(6);
        pass.end();
    }
}

export class SSR2CamsDrawPassWithEnv{

  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private frameBufferFormat:GPUTextureFormat;

  private sourceTexturesBindGroupLayout:GPUBindGroupLayout | undefined;
  private resolutionSamplerBindGroup:GPUBindGroup|undefined;
  private cameraBindGroup:GPUBindGroup|undefined;
  private cameraBuffer:GPUBuffer|undefined;
  private pipeline:GPURenderPipeline|undefined;

  constructor(device:GPUDevice,camera:PerspectiveCamera,frameBufferFormat:GPUTextureFormat){
      this.device = device;
      this.camera = camera;
      this.frameBufferFormat = frameBufferFormat;
  }

  public async initializeRenderPipeline(canvasWidth:number, canvasHeight:number){
      // initialize resources
      this.cameraBuffer = this.device.createBuffer({
        label:  "BlendVolumeEnvPass cameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      let resolutionBuffer = this.device.createBuffer({
          label:"resolution Buffer",
          size:32,
          usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
          mappedAtCreation:true
      });
      let resolutionArray = new Float32Array([
          canvasWidth,
          canvasHeight
      ]);
      let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
      dst.set(resolutionArray);
      resolutionBuffer.unmap();
      let sampler = this.device.createSampler({});
      // initialize bind group layouts
      let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
          label:"SSR Draw resolutio sampler bind group layout",
          entries:[
              {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{}},
              {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}},
          ]
      });
      this.sourceTexturesBindGroupLayout = this.device.createBindGroupLayout({
          label:"SSR Draw source textures bind group layout",
          entries:[
              {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
              {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float'}},
              {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float'}},
              {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'cube'}},
          ]
      });
      let cameraBindGroupLayout = this.device.createBindGroupLayout({entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:<GPUBufferBindingType>'uniform'}}
      ]});
      // initialize bind group
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
          layout:resolutionSamplerBindGroupLayout,
          entries:[
              {binding:0,resource:{buffer:resolutionBuffer}},
              {binding:1,resource:sampler}
          ]
      });
      this.cameraBindGroup = this.device.createBindGroup({
        layout:cameraBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:this.cameraBuffer}}
        ]
      });
      // initialize pipeline
      this.pipeline = this.device.createRenderPipeline({
          label:"SSR Draw Pipeline",
          layout:this.device.createPipelineLayout({
              bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.sourceTexturesBindGroupLayout,cameraBindGroupLayout]}
          ),
          vertex:{
              module:this.device.createShaderModule({code:SSR2CamsDrawEnvShader})
          },
          fragment:{
              module:this.device.createShaderModule({code:SSR2CamsDrawEnvShader}),
              targets:[{format:this.frameBufferFormat}]
          },
      });
  }

  public render(
      encoder:GPUCommandEncoder,
      inReflUVTexture:GPUTexture,
      inFrontReflectionSourceTexture:GPUTexture,
      inRearReflectionSourceTexture:GPUTexture,
      inEnvironment:GPUTexture,
      outFrameBufferTexture:GPUTexture
  ){
      // error check
      if(this.sourceTexturesBindGroupLayout === undefined){
          throw Error("sourceTextureBindGroupLayout is undefined");
      }
      if(this.resolutionSamplerBindGroup === undefined){
          throw Error("Resolution sampler bind group is undefined");
      }
      if(this.pipeline === undefined){
          throw Error("Pipeline is undefined");
      }
      if(this.cameraBuffer===undefined){
        throw Error("Camera buffer is undefined");
      }
      if(this.cameraBindGroup===undefined){
        throw Error("Camera bind group is undefined");
      }
      // write buffers
      let array = new ArrayBuffer(
        16 * 4 +    // viewMatrix
        16 * 4 +    // projMatrix
        4  * 3      // eye
      );
      let viewMatrixArrayView = new Float32Array(array,0,16);
      let projMatrixArrayView = new Float32Array(array,64,16);
      let eyeArrayView = new Float32Array(array,128,3);
      viewMatrixArrayView.set(mathUtils.inverse(this.camera.getViewMatrix()));
      projMatrixArrayView.set(mathUtils.inverse(this.camera.getProjectionMatrix()));
      eyeArrayView.set(this.camera.eye);

      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        array
      );
      // create bind group
      let sourceTexturesBindGroup = this.device.createBindGroup({
          label:"SSR source textures bind group",
          layout:this.sourceTexturesBindGroupLayout,
          entries:[
              {binding:0, resource:inReflUVTexture.createView()},
              {binding:1, resource:inFrontReflectionSourceTexture.createView()},
              {binding:2, resource:inRearReflectionSourceTexture.createView()},
              {binding:3,resource:inEnvironment.createView({dimension:'cube'})}
          ]
      });
      // set render pass and render
      let pass = encoder.beginRenderPass({
          colorAttachments:[{
              view:outFrameBufferTexture.createView(),
              loadOp:<GPULoadOp>'clear',
              storeOp:<GPUStoreOp>'store',
              clearValue:<GPUColor>{r:0,g:0,b:0,a:1}
          }],
      });

      pass.setBindGroup(0,this.resolutionSamplerBindGroup);
      pass.setBindGroup(1,sourceTexturesBindGroup);
      pass.setBindGroup(2,this.cameraBindGroup);
      pass.setPipeline(this.pipeline);
      pass.draw(6);
      pass.end();
  }
}

export class BlendReflections2CamsPass{

  private device:GPUDevice;
  private frameBufferFormat:GPUTextureFormat;

  private texturesBindGroupLayout:GPUBindGroupLayout|undefined;
  private resolutionSamplerBindGroup:GPUBindGroup|undefined;

  constructor(  device:GPUDevice,
                frameBufferFormat:GPUTextureFormat){
    this.device = device;
    this.frameBufferFormat = frameBufferFormat;
  }

  private pipeline:GPURenderPipeline | undefined;

  public initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
    // create resources
    let resolutionBuffer = this.device.createBuffer({
      label:"resolution Buffer",
      size:32,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      mappedAtCreation:true
    });
    let resolutionArray = new Float32Array([
      canvasWidth,
      canvasHeight
    ]);
    let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
    dst.set(resolutionArray);
    resolutionBuffer.unmap();
    let sampler = this.device.createSampler({
      addressModeU:'repeat',
      addressModeV:'repeat',
      minFilter:'linear',
      magFilter:'linear',
      mipmapFilter:'linear'
    });
    // create bind group layouts
    let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
      label:"SSRBlend resolution sampler bind group layout",
      entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}}
      ]
    });
    this.texturesBindGroupLayout = this.device.createBindGroupLayout({
      label:"SSRBlend textures bind group layout",
      entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:3,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:5,visibility:GPUShaderStage.FRAGMENT,texture:{}},
      ]
    });
    // create bind groups
    this.resolutionSamplerBindGroup = this.device.createBindGroup({
      label:"SSRBlend resolution Sampler Bind group",
      layout:resolutionSamplerBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:resolutionBuffer}},
        {binding:1,resource:sampler}
      ]
    });
    // create pipeline
    this.pipeline = this.device.createRenderPipeline({
      label:"SSRBlendReflections Pipeline",
      layout:this.device.createPipelineLayout({bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.texturesBindGroupLayout]}),
      vertex:{module:this.device.createShaderModule({code:BRDFShader + BlendReflectionsShader})},
      fragment:{
        module:this.device.createShaderModule({code:BRDFShader + BlendReflectionsShader}),
        targets:[{format:this.frameBufferFormat}],
        constants:{
          maxMipLevel:mipLevelCount(canvasWidth,canvasHeight)-2,
        }
      }
    });
  }

  public render(
    encoder:GPUCommandEncoder,
    outFrameBuffer:GPUTexture,
    inSSRReflections:GPUTexture,
    inMetallicRoughness:GPUTexture,
    inBaseColor:GPUTexture,
    inLit:GPUTexture,
    inPositionTexture:GPUTexture,
    inNormalTexture:GPUTexture
  ){
    if(this.pipeline===undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.texturesBindGroupLayout===undefined){
      throw Error("Textures bind group layout is undefined");
    }
    if(this.resolutionSamplerBindGroup===undefined){
      throw Error("resolution Sampler Bind Group is undefined");
    }

    let texturesBindGroup = this.device.createBindGroup({
      label:"SSR Blend textures bind group",
      layout:this.texturesBindGroupLayout,
      entries:[
        {binding:0,resource:inSSRReflections.createView()},
        {binding:1,resource:inMetallicRoughness.createView()},
        {binding:2,resource:inBaseColor.createView()},
        {binding:3,resource:inLit.createView()},
        {binding:4,resource:inPositionTexture.createView()},
        {binding:5,resource:inNormalTexture.createView()}
      ]
    });

    let pass = encoder.beginRenderPass({
      label:"SSR Blend render pass",
      colorAttachments:[
        {
          view:outFrameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          storeOp:<GPUStoreOp>'store',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:0}
        }
      ]
    });
    pass.setBindGroup(0,this.resolutionSamplerBindGroup);
    pass.setBindGroup(1,texturesBindGroup);
    pass.setPipeline(this.pipeline);
    pass.draw(6);
    pass.end();
  }

}