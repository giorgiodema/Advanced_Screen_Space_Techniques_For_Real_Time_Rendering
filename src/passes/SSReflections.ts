import { PerspectiveCamera } from "../utils/camera";
import SSReflectionsUVShader from "../shaders/SSReflectionsUVShader.wgsl";
import SSVolumeUVShader from "../shaders/SSVolumeUVShader.wgsl";
import SSReflectionsTwoBuffersUVShader from "../shaders/SSReflectionsTwoBuffersUVShader.wgsl";
import SSReflectionsDrawShader from "../shaders/SSReflectionsDrawShader.wgsl";
import SSReflectionsDrawEnvShader from "../shaders/SSReflectionsDrawEnvShader.wgsl";
import BRDFShader from "../shaders/BRDF.wgsl";
import BlendReflectionsShader from "../shaders/BlendReflectionsShader.wgsl";
import BlendTransmissionShader from "../shaders/BlendTransmissionShader.wgsl";
import BlendVolumeShader from "../shaders/BlendVolumeShader.wgsl";
import BlendVolumeShaderEnvProxy from "../shaders/BlendVolumeShaderEnvProxy.wgsl";
import SSRefractedDirectionShader from "../shaders/SSRefractedDirectionShader.wgsl";
import BlendVolumeEnvShader from "../shaders/BlendVolumeEnvShader.wgsl";
import ShowUVShader from "../shaders/ShowUVShader.wgsl";
import ShowDistanceShader from "../shaders/ShowDistanceTravelled.wgsl";
import ShowVisibilityShader from "../shaders/ShowVisibilityShader.wgsl";
import * as mathUtils from '../utils/math';

import { mipLevelCount } from "../utils/textureUtils";


export class SSReflectionsUVPass{
    /**
     * This render pass implement Screen Space Reflections. Instead of 
     * computing directly the reflected color it outputs, for each fragment, 
     * the uv coordinates of the reflected color, as if the surface was a 
     * perfect mirror. The inputs of the render pass are the position and 
     * normal texture from the gBuffer, and the output is a texture with uv
     * coordinates and a visibility channel, where the value is either 1, if
     * the reflection can be computed with SSR or 0 otherwise, hence only the 
     * uvs where the visibility is 1 should be used.
     */
    private device:GPUDevice;
    private camera:PerspectiveCamera;

    public static readonly targetReflUVFormat = <GPUTextureFormat>'rgba32float';

    private resolutionSamplerCameraBindGroup:GPUBindGroup | undefined;
    private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
    private pipeline:GPURenderPipeline | undefined;
    private cameraBuffer:GPUBuffer | undefined;

    constructor(
        device:GPUDevice,
        camera:PerspectiveCamera,
      ){
        this.device = device;
        this.camera = camera;
    }

    public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
      // resources
      this.cameraBuffer = this.device.createBuffer({
        label:  "cameraBuffer",
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
          { binding:2,                                              // camera
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
        ]
      });
      this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
        label:"SSRMirror textures bind group",
        entries:[
          { binding:0, // position
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:1, // normal
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
          {binding:2,resource:{buffer:this.cameraBuffer}}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"SSR Mirror Pipeline",
        vertex:{
            module:this.device.createShaderModule({code:SSReflectionsUVShader}),
        },
        layout:this.device.createPipelineLayout(
            {bindGroupLayouts:[ resolutionSamplerCameraBindGroupLayout,
                                this.GBufferBindGroupLayout]}),
        fragment:{
            module:this.device.createShaderModule({code:SSReflectionsUVShader}),
            targets:[
                {format:SSReflectionsUVPass.targetReflUVFormat},
            ]
        }
      });
    }

    public render(
        encoder:GPUCommandEncoder,
        inPositionTexture:GPUTexture,
        inNormalTexture:GPUTexture,
        outReflUVTexture:GPUTexture,
        querySet:GPUQuerySet|undefined = undefined,
        startTimeId:number|undefined = undefined,
        endTimeId:number|undefined = undefined
    ){
        // error checks
        if(this.GBufferBindGroupLayout===undefined){
            throw Error("GBuffer Bind Group Layout is undefined");
        }
        if(this.cameraBuffer===undefined){
            throw Error("Camera Buffer is undefined");
        }
        if(this.pipeline === undefined){
            throw Error("Pipeline is undefined");
        }
        if(this.resolutionSamplerCameraBindGroup === undefined){
            throw Error("Resolution Sampler Camera Bind gorup is undefined");
        }
        // write buffers
        let cameraBuffer = this.camera.getCameraBuffer();
        this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
        );
        // create dynamic bind groups
        let GBufferBindGroup = this.device.createBindGroup({
            label:"GBufferViewer textures bind group",
            layout:this.GBufferBindGroupLayout,
            entries:[
            {binding:0,resource:inPositionTexture.createView()},
            {binding:1,resource:inNormalTexture.createView()},
            ]
        });
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

export class SSTransmissionUVPass{
  /**
   * The only difference with SSReflectionsUVPass is that the start 
   * position and reflection vectors are determined from the first
   * buffer, while raymarching is done in the second buffer.
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;

  public static readonly targetReflUVFormat = <GPUTextureFormat>'rgba32float';

  private resolutionSamplerCameraBindGroup:GPUBindGroup | undefined;
  private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;
  private cameraBuffer:GPUBuffer | undefined;

  constructor(
      device:GPUDevice,
      camera:PerspectiveCamera,
    ){
      this.device = device;
      this.camera = camera;
  }

  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
    // resources
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
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
        { binding:2,                                              // camera
          visibility:GPUShaderStage.FRAGMENT,
          buffer:{type:<GPUBufferBindingType>'uniform'}},
      ]
    });
    this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
      label:"SSRMirror textures bind group",
      entries:[
        { binding:0, // start position
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:1, // start normal
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:2, // target position
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
        {binding:2,resource:{buffer:this.cameraBuffer}}
      ]
    });
    // pipeline
    this.pipeline = this.device.createRenderPipeline({
      label:"SSR Mirror Pipeline",
      vertex:{
          module:this.device.createShaderModule({code:SSReflectionsTwoBuffersUVShader}),
      },
      layout:this.device.createPipelineLayout(
          {bindGroupLayouts:[ resolutionSamplerCameraBindGroupLayout,
                              this.GBufferBindGroupLayout]}),
      fragment:{
          module:this.device.createShaderModule({code:SSReflectionsTwoBuffersUVShader}),
          targets:[
              {format:SSReflectionsUVPass.targetReflUVFormat},
          ]
      }
    });
  }

  public render(
      encoder:GPUCommandEncoder,
      inStartPositionTexture:GPUTexture,
      inStartNormalTexture:GPUTexture,
      inTargetPositionTexture:GPUTexture,
      outReflUVTexture:GPUTexture,
  ){
      // error checks
      if(this.GBufferBindGroupLayout===undefined){
          throw Error("GBuffer Bind Group Layout is undefined");
      }
      if(this.cameraBuffer===undefined){
          throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
          throw Error("Pipeline is undefined");
      }
      if(this.resolutionSamplerCameraBindGroup === undefined){
          throw Error("Resolution Sampler Camera Bind gorup is undefined");
      }
      // write buffers
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
      this.cameraBuffer,
      0,
      cameraBuffer
      );
      // create dynamic bind groups
      let GBufferBindGroup = this.device.createBindGroup({
          label:"GBufferViewer textures bind group",
          layout:this.GBufferBindGroupLayout,
          entries:[
          {binding:0,resource:inStartPositionTexture.createView()},
          {binding:1,resource:inStartNormalTexture.createView()},
          {binding:2,resource:inTargetPositionTexture.createView()}
          ]
      });
      // create render pass & draw
      let pass = encoder.beginRenderPass({
          colorAttachments:[
            { view:outReflUVTexture.createView(),
              loadOp:<GPULoadOp>'clear',
              clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
              storeOp:<GPUStoreOp>'store'
            }
          ]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0,this.resolutionSamplerCameraBindGroup);
        pass.setBindGroup(1,GBufferBindGroup);
        pass.draw(6);
        pass.end();
  }

}

export class SSXDrawPass{
    /**
     * This render pass takes the uv and visibility texture from the 
     * SSRVisibilityUVPass and a texture with the lit scene (without reflections),
     * and for each fragment computes the reflected color as if all surfaces were 
     * perfect mirrors.
     */
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
                module:this.device.createShaderModule({code:SSReflectionsDrawShader})
            },
            fragment:{
                module:this.device.createShaderModule({code:SSReflectionsDrawShader}),
                targets:[{format:this.frameBufferFormat}]
            },
        });
    }

    public render(
        encoder:GPUCommandEncoder,
        inUVTexture:GPUTexture,
        inSourceTexture:GPUTexture,
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
                {binding:0, resource:inUVTexture.createView()},
                {binding:1, resource:inSourceTexture.createView()}
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

export class SSXDrawPassWithEnv{
  /**
   * This render pass takes the uv and visibility texture from the 
   * SSRVisibilityUVPass and a texture with the lit scene (without reflections),
   * and for each fragment computes the reflected color as if all surfaces were 
   * perfect mirrors.
   */
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
              {binding:2,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'cube'}},
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
              module:this.device.createShaderModule({code:SSReflectionsDrawEnvShader})
          },
          fragment:{
              module:this.device.createShaderModule({code:SSReflectionsDrawEnvShader}),
              targets:[{format:this.frameBufferFormat}]
          },
      });
  }

  public render(
      encoder:GPUCommandEncoder,
      inUVTexture:GPUTexture,
      inSourceTexture:GPUTexture,
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
              {binding:0, resource:inUVTexture.createView()},
              {binding:1, resource:inSourceTexture.createView()},
              {binding:2,resource:inEnvironment.createView({dimension:'cube'})}
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

export class BlendReflectionsPass{

  private device:GPUDevice;
  private frameBufferFormat:GPUTextureFormat;
  private enableConeTracing:boolean;

  private texturesBindGroupLayout:GPUBindGroupLayout|undefined;
  private resolutionSamplerBindGroup:GPUBindGroup|undefined;

  constructor(  device:GPUDevice,
                frameBufferFormat:GPUTextureFormat,
                enableConeTracing:boolean = true){
    this.device = device;
    this.frameBufferFormat = frameBufferFormat;
    this.enableConeTracing = enableConeTracing;
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
        {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}}
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
          coneTracing:this.enableConeTracing ? 1.0 : 0.0
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
    inNormalTexture:GPUTexture,
    inReflUVTexture:GPUTexture,
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
        {binding:5,resource:inNormalTexture.createView()},
        {binding:6,resource:inReflUVTexture.createView()}
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

export class BlendTransmissionPass{

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
        {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{}},
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
      vertex:{module:this.device.createShaderModule({code:BRDFShader + BlendTransmissionShader})},
      fragment:{
        module:this.device.createShaderModule({code:BRDFShader + BlendTransmissionShader}),
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
    inSSReflections:GPUTexture,
    inSSTransmissions:GPUTexture,
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
        {binding:0,resource:inSSReflections.createView()},
        {binding:1,resource:inSSTransmissions.createView()},
        {binding:2,resource:inMetallicRoughness.createView()},
        {binding:3,resource:inBaseColor.createView()},
        {binding:4,resource:inLit.createView()},
        {binding:5,resource:inPositionTexture.createView()},
        {binding:6,resource:inNormalTexture.createView()}
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

export class BlendVolumePass{

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
        {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:8,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:9,visibility:GPUShaderStage.FRAGMENT,texture:{}},
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
      vertex:{module:this.device.createShaderModule({code:BRDFShader + BlendVolumeShader})},
      fragment:{
        module:this.device.createShaderModule({code:BRDFShader + BlendVolumeShader}),
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
    inSSReflections:GPUTexture,
    inSSTransmissions:GPUTexture,
    inMetallicRoughness:GPUTexture,
    inBaseColor:GPUTexture,
    inLit:GPUTexture,
    inPositionTexture:GPUTexture,
    inNormalTexture:GPUTexture,
    inAttenuationColorDistanceTexture:GPUTexture,
    inVolumeRefractionUV:GPUTexture,
    inMipMappedOpaqueLit:GPUTexture
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
        {binding:0,resource:inSSReflections.createView()},
        {binding:1,resource:inSSTransmissions.createView()},
        {binding:2,resource:inMetallicRoughness.createView()},
        {binding:3,resource:inBaseColor.createView()},
        {binding:4,resource:inLit.createView()},
        {binding:5,resource:inPositionTexture.createView()},
        {binding:6,resource:inNormalTexture.createView()},
        {binding:7,resource:inAttenuationColorDistanceTexture.createView()},
        {binding:8,resource:inVolumeRefractionUV.createView()},
        {binding:9,resource:inMipMappedOpaqueLit.createView()}
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

export class SSVolumeUVPass{
  /**
   * This render pass implement Screen Space Reflections. Instead of 
   * computing directly the reflected color it outputs, for each fragment, 
   * the uv coordinates of the reflected color, as if the surface was a 
   * perfect mirror. The inputs of the render pass are the position and 
   * normal texture from the gBuffer, and the output is a texture with uv
   * coordinates and a visibility channel, where the value is either 1, if
   * the reflection can be computed with SSR or 0 otherwise, hence only the 
   * uvs where the visibility is 1 should be used.
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;

  public static readonly targetReflUVFormat = <GPUTextureFormat>'rgba32float';

  private resolutionSamplerCameraBindGroup:GPUBindGroup | undefined;
  private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;
  private cameraBuffer:GPUBuffer | undefined;

  constructor(
      device:GPUDevice,
      camera:PerspectiveCamera,
    ){
      this.device = device;
      this.camera = camera;
  }

  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
    // resources
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
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
        { binding:2,                                              // camera
          visibility:GPUShaderStage.FRAGMENT,
          buffer:{type:<GPUBufferBindingType>'uniform'}},
      ]
    });
    this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
      label:"SSRMirror textures bind group",
      entries:[
        { binding:0, // position Layer 1
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:1, // normal Layer 1
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:2, // position Layer 2
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:3, // normal Layer 2
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:4, // position Layer 3
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
        {binding:2,resource:{buffer:this.cameraBuffer}}
      ]
    });
    // pipeline
    this.pipeline = this.device.createRenderPipeline({
      label:"SSR Mirror Pipeline",
      vertex:{
          module:this.device.createShaderModule({code:SSVolumeUVShader}),
      },
      layout:this.device.createPipelineLayout(
          {bindGroupLayouts:[ resolutionSamplerCameraBindGroupLayout,
                              this.GBufferBindGroupLayout]}),
      fragment:{
          module:this.device.createShaderModule({code:SSVolumeUVShader}),
          targets:[
              {format:SSReflectionsUVPass.targetReflUVFormat},
          ]
      }
    });
  }

  public render(
      encoder:GPUCommandEncoder,
      inPositionTextureLayer1:GPUTexture,
      inNormalTextureLayer1:GPUTexture,
      inPositionTextureLayer2:GPUTexture,
      inNormalTextureLayer2:GPUTexture,
      inPositionTextureLayer3:GPUTexture,
      outReflUVTexture:GPUTexture,
      querySet:GPUQuerySet|undefined = undefined,
      startTimeId:number|undefined = undefined,
      endTimeId:number|undefined = undefined
  ){
      // error checks
      if(this.GBufferBindGroupLayout===undefined){
          throw Error("GBuffer Bind Group Layout is undefined");
      }
      if(this.cameraBuffer===undefined){
          throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
          throw Error("Pipeline is undefined");
      }
      if(this.resolutionSamplerCameraBindGroup === undefined){
          throw Error("Resolution Sampler Camera Bind gorup is undefined");
      }
      // write buffers
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
      this.cameraBuffer,
      0,
      cameraBuffer
      );
      // create dynamic bind groups
      let GBufferBindGroup = this.device.createBindGroup({
          label:"GBufferViewer textures bind group",
          layout:this.GBufferBindGroupLayout,
          entries:[
          {binding:0,resource:inPositionTextureLayer1.createView()},
          {binding:1,resource:inNormalTextureLayer1.createView()},
          {binding:2,resource:inPositionTextureLayer2.createView()},
          {binding:3,resource:inNormalTextureLayer2.createView()},
          {binding:4,resource:inPositionTextureLayer3.createView()}
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

export class SSVolumeRefractionDirectionPass{
  /**
   * This render pass implement Screen Space Reflections for a dinstant 
   * environment map.  Instead of computing directly the refracted color, 
   * it outputs the direction of the refracted ray exiting the surface.
   * This direction can be used to index a distant environment map to 
   * compute the refracted color. The output is a vec4, where the 
   * xyz components are the output direction, while w is the distance 
   * travelled inside the object.
   **/
  private device:GPUDevice;
  private camera:PerspectiveCamera;

  public static readonly targetRefractedDirectionFormat = <GPUTextureFormat>'rgba32float';

  private resolutionSamplerCameraBindGroup:GPUBindGroup | undefined;
  private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;
  private cameraBuffer:GPUBuffer | undefined;

  constructor(
      device:GPUDevice,
      camera:PerspectiveCamera,
    ){
      this.device = device;
      this.camera = camera;
  }

  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
    // resources
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
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
      label:"SS Refraction Direction resolution Sampler Bind Group",
      entries:[
        { binding:0,                                              // iResolution
          visibility:GPUShaderStage.FRAGMENT,
          buffer:{type:<GPUBufferBindingType>'uniform'}},
        { binding:1,                                              // sampler
          visibility:GPUShaderStage.FRAGMENT,
          sampler:{type:<GPUSamplerBindingType>'filtering'}},
        { binding:2,                                              // camera
          visibility:GPUShaderStage.FRAGMENT,
          buffer:{type:<GPUBufferBindingType>'uniform'}},
      ]
    });
    this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
      label:"SS Refraction Direction textures bind group",
      entries:[
        { binding:0, // position Layer 1
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:1, // normal Layer 1
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:2, // position Layer 2
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        },
        { binding:3, // normal Layer 2
          visibility:GPUShaderStage.FRAGMENT,
          texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
        }
      ]
    });
    this.resolutionSamplerCameraBindGroup = this.device.createBindGroup({
      label:"SS Refraction Direction resolution sampler bind group",
      layout:resolutionSamplerCameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:resolutionBuffer}},
        {binding:1,resource:basicSampler},
        {binding:2,resource:{buffer:this.cameraBuffer}}
      ]
    });
    // pipeline
    this.pipeline = this.device.createRenderPipeline({
      label:"SS Refraction Direction Pipeline",
      vertex:{
          module:this.device.createShaderModule({code:SSRefractedDirectionShader,label:"SSVolumeRefractionDirectionPass shader"}),
      },
      layout:this.device.createPipelineLayout(
          {bindGroupLayouts:[ resolutionSamplerCameraBindGroupLayout,
                              this.GBufferBindGroupLayout]}),
      fragment:{
          module:this.device.createShaderModule({code:SSRefractedDirectionShader, label:"SSVolumeRefractionDirectionPass shader"}),
          targets:[
              {format:SSReflectionsUVPass.targetReflUVFormat},
          ],
          constants:{
            maxDistance:this.camera.far
          }
      }
    });
  }

  public render(
      encoder:GPUCommandEncoder,
      inPositionTextureLayer1:GPUTexture,
      inNormalTextureLayer1:GPUTexture,
      inPositionTextureLayer2:GPUTexture,
      inNormalTextureLayer2:GPUTexture,
      outRefrDirectionTexture:GPUTexture,
  ){
      // error checks
      if(this.GBufferBindGroupLayout===undefined){
          throw Error("GBuffer Bind Group Layout is undefined");
      }
      if(this.cameraBuffer===undefined){
          throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
          throw Error("Pipeline is undefined");
      }
      if(this.resolutionSamplerCameraBindGroup === undefined){
          throw Error("Resolution Sampler Camera Bind gorup is undefined");
      }
      // write buffers
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
      this.cameraBuffer,
      0,
      cameraBuffer
      );
      // create dynamic bind groups
      let GBufferBindGroup = this.device.createBindGroup({
          label:"GBufferViewer textures bind group",
          layout:this.GBufferBindGroupLayout,
          entries:[
          {binding:0,resource:inPositionTextureLayer1.createView()},
          {binding:1,resource:inNormalTextureLayer1.createView()},
          {binding:2,resource:inPositionTextureLayer2.createView()},
          {binding:3,resource:inNormalTextureLayer2.createView()}
          ]
      });
      // create render pass & draw
      let pass = encoder.beginRenderPass({
          colorAttachments:[
            { view:outRefrDirectionTexture.createView(),
              loadOp:<GPULoadOp>'clear',
              clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
              storeOp:<GPUStoreOp>'store'
            }
          ]
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0,this.resolutionSamplerCameraBindGroup);
        pass.setBindGroup(1,GBufferBindGroup);
        pass.draw(6);
        pass.end();
  }

}

export class BlendVolumeEnvPass{

  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private frameBufferFormat:GPUTextureFormat;

  private texturesBindGroupLayout:GPUBindGroupLayout|undefined;
  private resolutionSamplerBindGroup:GPUBindGroup|undefined;
  private cameraBindGroup:GPUBindGroup|undefined;
  private cameraBuffer:GPUBuffer|undefined;

  constructor(  device:GPUDevice,
                camera:PerspectiveCamera,
                frameBufferFormat:GPUTextureFormat){
    this.device = device;
    this.camera = camera;
    this.frameBufferFormat = frameBufferFormat;
  }

  private pipeline:GPURenderPipeline | undefined;

  public initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
    // create resources
    this.cameraBuffer = this.device.createBuffer({
      label:  "BlendVolumeEnvPass cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    let resolutionBuffer = this.device.createBuffer({
      label:"BlendVolumeEnvPass resolution Buffer",
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
      addressModeU:'clamp-to-edge',
      addressModeV:'clamp-to-edge',
      magFilter:'linear',
      minFilter:'linear',
      mipmapFilter:'linear'
    });
    // create bind group layouts
    let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
      label:"BlendVolumeEnvPass resolution sampler bind group layout",
      entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{}}
      ]
    });
    this.texturesBindGroupLayout = this.device.createBindGroupLayout({
      label:"BlendVolumeEnvPass textures bind group layout",
      entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'cube'}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float', viewDimension:<GPUTextureViewDimension>'2d'}},
      ]
    });
    let cameraBindGroupLayout = this.device.createBindGroupLayout({entries:[
      {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:<GPUBufferBindingType>'uniform'}}
    ]});
    // create bind groups
    this.resolutionSamplerBindGroup = this.device.createBindGroup({
      label:"BlendVolumeEnvPass resolution Sampler Bind group",
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
    })
    // create pipeline
    this.pipeline = this.device.createRenderPipeline({
      label:"BlendVolumeEnvPass Pipeline",
      layout:this.device.createPipelineLayout({bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.texturesBindGroupLayout,cameraBindGroupLayout]}),
      vertex:{module:this.device.createShaderModule({code:BlendVolumeEnvShader,label:"BlendVolumeEnvPass shader"})},
      fragment:{
        module:this.device.createShaderModule({code:BlendVolumeEnvShader, label:"BlendVolumeEnvPass shader"}),
        targets:[{format:this.frameBufferFormat}],
      }
    });
  }

  public render(
    encoder:GPUCommandEncoder,
    outFrameBuffer:GPUTexture,
    inVolumeRefractionDirection:GPUTexture,
    inEnvironment:GPUTexture
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
    if(this.cameraBindGroup===undefined){
      throw Error("camera bind group is undefined");
    }
    if(this.cameraBuffer===undefined){
      throw Error("camera buffer is undefined");
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
    // create dynamic bind groups
    let texturesBindGroup = this.device.createBindGroup({
      label:"BlendVolumeEnvPass textures bind group",
      layout:this.texturesBindGroupLayout,
      entries:[
        {binding:0,resource:inEnvironment.createView({dimension:'cube'})},
        {binding:1,resource:inVolumeRefractionDirection.createView()},
      ]
    });

    let pass = encoder.beginRenderPass({
      label:"BlendVolumeEnvPass render pass",
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
    pass.setBindGroup(2,this.cameraBindGroup);
    pass.setPipeline(this.pipeline);
    pass.draw(6);
    pass.end();
  }

}


export class ShowUVPass{

  private device:GPUDevice;
  private frameBufferTextureFormat:GPUTextureFormat;

  private resolutionSamplerBindGroup:GPUBindGroup | undefined;
  private InputTextureBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;

  constructor(
    device:GPUDevice,
    presentationFormat:GPUTextureFormat
  ){
    this.device = device;
    this.frameBufferTextureFormat = presentationFormat;
  }
  
  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
      // resources
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
      let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
        ]
      });
      this.InputTextureBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture textures bind group",
        entries:[
          { binding:0, // inputTexture
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'unfilterable-float',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"showTexture resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"showTexture render pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.InputTextureBindGroupLayout],
        }),
        vertex:{module:this.device.createShaderModule({code:ShowUVShader})},
        fragment:{
          module:this.device.createShaderModule({code:ShowUVShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ],
        },

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    uvAndVisibilityTexture:GPUTexture,
    frameBuffer:GPUTexture
  )
  {
    if(this.InputTextureBindGroupLayout === undefined){
      throw Error("GBuffer bind group layout undefined");
    }
    if(this.pipeline === undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.resolutionSamplerBindGroup === undefined){
      throw Error("Resolution sampler bind group is undefined");
    }

    // create dynamic bind groups
    let inputTextureBindGroup = this.device.createBindGroup({
      label:"showTextureChannels textures bind group",
      layout:this.InputTextureBindGroupLayout,
      entries:[
        {binding:0,resource:uvAndVisibilityTexture.createView()},
      ]
    });

    let pass = encoder.beginRenderPass({
      colorAttachments:[
        { view:frameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
          storeOp:<GPUStoreOp>'store'
        }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.resolutionSamplerBindGroup);
    pass.setBindGroup(1,inputTextureBindGroup);
    pass.draw(6);
    pass.end();
  }
}

export class ShowVisibilityPass{

  private device:GPUDevice;
  private frameBufferTextureFormat:GPUTextureFormat;

  private resolutionSamplerBindGroup:GPUBindGroup | undefined;
  private InputTextureBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;

  constructor(
    device:GPUDevice,
    presentationFormat:GPUTextureFormat
  ){
    this.device = device;
    this.frameBufferTextureFormat = presentationFormat;
  }
  
  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
      // resources
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
      let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
        ]
      });
      this.InputTextureBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture textures bind group",
        entries:[
          { binding:0, // inputTexture
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'unfilterable-float',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"showTexture resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"showTexture render pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.InputTextureBindGroupLayout],
        }),
        vertex:{module:this.device.createShaderModule({code:ShowVisibilityShader})},
        fragment:{
          module:this.device.createShaderModule({code:ShowVisibilityShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ],
        },

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    uvAndVisibilityTexture:GPUTexture,
    frameBuffer:GPUTexture
  )
  {
    if(this.InputTextureBindGroupLayout === undefined){
      throw Error("GBuffer bind group layout undefined");
    }
    if(this.pipeline === undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.resolutionSamplerBindGroup === undefined){
      throw Error("Resolution sampler bind group is undefined");
    }

    // create dynamic bind groups
    let inputTextureBindGroup = this.device.createBindGroup({
      label:"showTextureChannels textures bind group",
      layout:this.InputTextureBindGroupLayout,
      entries:[
        {binding:0,resource:uvAndVisibilityTexture.createView()},
      ]
    });

    let pass = encoder.beginRenderPass({
      colorAttachments:[
        { view:frameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
          storeOp:<GPUStoreOp>'store'
        }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.resolutionSamplerBindGroup);
    pass.setBindGroup(1,inputTextureBindGroup);
    pass.draw(6);
    pass.end();
  }
}

export class ShowDistanceTravelledPass{

  private device:GPUDevice;
  private frameBufferTextureFormat:GPUTextureFormat;

  private resolutionSamplerBindGroup:GPUBindGroup | undefined;
  private InputTextureBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;

  constructor(
    device:GPUDevice,
    presentationFormat:GPUTextureFormat
  ){
    this.device = device;
    this.frameBufferTextureFormat = presentationFormat;
  }
  
  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number){
      // resources
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
      let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
        ]
      });
      this.InputTextureBindGroupLayout = this.device.createBindGroupLayout({
        label:"showTexture textures bind group",
        entries:[
          { binding:0, // inputTexture
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'unfilterable-float',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"showTexture resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"showTexture render pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.InputTextureBindGroupLayout],
        }),
        vertex:{module:this.device.createShaderModule({code:ShowDistanceShader})},
        fragment:{
          module:this.device.createShaderModule({code:ShowDistanceShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ],
        },

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    uvAndVisibilityTexture:GPUTexture,
    frameBuffer:GPUTexture
  )
  {
    if(this.InputTextureBindGroupLayout === undefined){
      throw Error("GBuffer bind group layout undefined");
    }
    if(this.pipeline === undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.resolutionSamplerBindGroup === undefined){
      throw Error("Resolution sampler bind group is undefined");
    }

    // create dynamic bind groups
    let inputTextureBindGroup = this.device.createBindGroup({
      label:"showTextureChannels textures bind group",
      layout:this.InputTextureBindGroupLayout,
      entries:[
        {binding:0,resource:uvAndVisibilityTexture.createView()},
      ]
    });

    let pass = encoder.beginRenderPass({
      colorAttachments:[
        { view:frameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
          storeOp:<GPUStoreOp>'store'
        }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.resolutionSamplerBindGroup);
    pass.setBindGroup(1,inputTextureBindGroup);
    pass.draw(6);
    pass.end();
  }
}

export class BlendVolumeProxyEnvPass{

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
        {binding:6,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:7,visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:8,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:9,visibility:GPUShaderStage.FRAGMENT,texture:{}},
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
      vertex:{module:this.device.createShaderModule({code:BRDFShader + BlendVolumeShaderEnvProxy})},
      fragment:{
        module:this.device.createShaderModule({code:BRDFShader + BlendVolumeShaderEnvProxy}),
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
    inSSReflections:GPUTexture,
    inSSTransmissions:GPUTexture,
    inMetallicRoughness:GPUTexture,
    inBaseColor:GPUTexture,
    inLit:GPUTexture,
    inPositionTexture:GPUTexture,
    inNormalTexture:GPUTexture,
    inAttenuationColorDistanceTexture:GPUTexture,
    inVolumeRefractionUV:GPUTexture,
    inMipMappedOpaqueLit:GPUTexture
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
        {binding:0,resource:inSSReflections.createView()},
        {binding:1,resource:inSSTransmissions.createView()},
        {binding:2,resource:inMetallicRoughness.createView()},
        {binding:3,resource:inBaseColor.createView()},
        {binding:4,resource:inLit.createView()},
        {binding:5,resource:inPositionTexture.createView()},
        {binding:6,resource:inNormalTexture.createView()},
        {binding:7,resource:inAttenuationColorDistanceTexture.createView()},
        {binding:8,resource:inVolumeRefractionUV.createView()},
        {binding:9,resource:inMipMappedOpaqueLit.createView()}
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