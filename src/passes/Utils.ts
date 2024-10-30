import ShowTextureChannelsShader from "../shaders/ShowTextureChannels.wgsl";
import ShowTextureShader from "../shaders/ShowTexture.wgsl";
import BlendFrameBuffersShader from "../shaders/BlendFrameBuffersShader.wgsl";
import BlendFrameBuffersAndEnvShader from "../shaders/BlendFrameBuffersAndEnvShader.wgsl";
import BlendFrameBuffersAndDepthShader from "../shaders/BlendFrameBuffersAndDepthShader.wgsl";
import { PerspectiveCamera } from "../utils/camera";
import * as mathUtils from '../utils/math';

export class BlendFrameBuffersPass{
  private device:GPUDevice;
  private presentationFormat:GPUTextureFormat;

  private pipeline:GPURenderPipeline | undefined;
  private texturesBindGroupLayout: GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice,presentationFormat:GPUTextureFormat){
    this.device = device;
    this.presentationFormat = presentationFormat;
  }

  public initializeRenderPipeline(){
    this.texturesBindGroupLayout = this.device.createBindGroupLayout({
      label:"BlendFrameBuffers Textures bind group layout",
      entries:[
        {binding:0, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:1, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:2, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:3, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
      ]
    });
    let module = this.device.createShaderModule({code:BlendFrameBuffersShader});
    this.pipeline = this.device.createRenderPipeline({
      label:"BlendFrameBuffers pipeline",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[this.texturesBindGroupLayout]
      }),
      vertex:{
        module:module
      },
      fragment:{
        module:module,
        targets:[
          {format:this.presentationFormat}
        ]
      }
    })
  }

  public render(
    encoder:GPUCommandEncoder,
    outFrameBuffer:GPUTexture,
    inFrameBuffer1:GPUTexture,
    inFrameBuffer2:GPUTexture,
    inDepthBuffer1:GPUTexture,
    inDepthBuffer2:GPUTexture
  ){

    if( this.texturesBindGroupLayout===undefined ||
        this.pipeline === undefined
    ){
      throw Error("BlendFrameBufferPass not initialized");
    }

    let texturesBindGroup = this.device.createBindGroup({
      layout:this.texturesBindGroupLayout,
      entries:[
        {binding:0, resource:inFrameBuffer1.createView()},
        {binding:1, resource:inFrameBuffer2.createView()},
        {binding:2, resource:inDepthBuffer1.createView()},
        {binding:3, resource:inDepthBuffer2.createView()}
      ]
    });

    let pass = encoder.beginRenderPass({
      label:"BlendFrameBuffers Render Pass",
      colorAttachments:[
        {
          view:outFrameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          storeOp:<GPUStoreOp>'store',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:1}
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,texturesBindGroup);
    pass.draw(6);
    pass.end();

  }
}

export class BlendFrameBuffersAndEnvPass{
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private presentationFormat:GPUTextureFormat;

  private pipeline:GPURenderPipeline | undefined;
  private texturesBindGroupLayout: GPUBindGroupLayout | undefined;
  private resolutionSamplerBindGroup:GPUBindGroup|undefined;
  private cameraBindGroup:GPUBindGroup|undefined;
  private cameraBuffer:GPUBuffer|undefined;

  constructor(device:GPUDevice,camera:PerspectiveCamera,presentationFormat:GPUTextureFormat){
    this.device = device;
    this.camera = camera;
    this.presentationFormat = presentationFormat;
  }

  public initializeRenderPipeline(canvasWidth:number, canvasHeight:number){
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
    this.texturesBindGroupLayout = this.device.createBindGroupLayout({
      label:"BlendFrameBuffers Textures bind group layout",
      entries:[
        {binding:0, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:1, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:2, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:3, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:4,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'cube'}},
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
    let module = this.device.createShaderModule({code:BlendFrameBuffersAndEnvShader});
    this.pipeline = this.device.createRenderPipeline({
      label:"BlendFrameBuffers pipeline",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[this.texturesBindGroupLayout,resolutionSamplerBindGroupLayout,cameraBindGroupLayout]
      }),
      vertex:{
        module:module
      },
      fragment:{
        module:module,
        targets:[
          {format:this.presentationFormat}
        ]
      }
    })
  }

  public render(
    encoder:GPUCommandEncoder,
    outFrameBuffer:GPUTexture,
    inFrameBuffer1:GPUTexture,
    inFrameBuffer2:GPUTexture,
    inDepthBuffer1:GPUTexture,
    inDepthBuffer2:GPUTexture,
    inEnv:GPUTexture,
  ){

    if( this.texturesBindGroupLayout===undefined ||
        this.pipeline === undefined){
      throw Error("BlendFrameBufferPass not initialized");
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

    let texturesBindGroup = this.device.createBindGroup({
      layout:this.texturesBindGroupLayout,
      entries:[
        {binding:0, resource:inFrameBuffer1.createView()},
        {binding:1, resource:inFrameBuffer2.createView()},
        {binding:2, resource:inDepthBuffer1.createView()},
        {binding:3, resource:inDepthBuffer2.createView()},
        {binding:4, resource:inEnv.createView({dimension:"cube"})}
      ]
    });

    let pass = encoder.beginRenderPass({
      label:"BlendFrameBuffers Render Pass",
      colorAttachments:[
        {
          view:outFrameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          storeOp:<GPUStoreOp>'store',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:1}
        }
      ]
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,texturesBindGroup);
    pass.setBindGroup(1,this.resolutionSamplerBindGroup);
    pass.setBindGroup(2,this.cameraBindGroup);
    pass.draw(6);
    pass.end();

  }
}


export class BlendFrameBuffersAndDepthPass{
  private device:GPUDevice;
  private presentationFormat:GPUTextureFormat;

  private pipeline:GPURenderPipeline | undefined;
  private texturesBindGroupLayout: GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice,presentationFormat:GPUTextureFormat){
    this.device = device;
    this.presentationFormat = presentationFormat;
  }

  public initializeRenderPipeline(){
    this.texturesBindGroupLayout = this.device.createBindGroupLayout({
      label:"BlendFrameBuffers Textures bind group layout",
      entries:[
        {binding:0, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:1, visibility:GPUShaderStage.FRAGMENT,texture:{}},
        {binding:2, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
        {binding:3, visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'unfilterable-float'}},
      ]
    });
    let module = this.device.createShaderModule({code:BlendFrameBuffersAndDepthShader});
    this.pipeline = this.device.createRenderPipeline({
      label:"BlendFrameBuffers pipeline",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[this.texturesBindGroupLayout]
      }),
      vertex:{
        module:module
      },
      fragment:{
        module:module,
        targets:[
          {format:this.presentationFormat},
          {format:<GPUTextureFormat>'r32float'}
        ]
      }
    })
  }

  public render(
    encoder:GPUCommandEncoder,
    outFrameBuffer:GPUTexture,
    outDepthBuffer:GPUTexture,
    inFrameBuffer1:GPUTexture,
    inFrameBuffer2:GPUTexture,
    inDepthBuffer1:GPUTexture,
    inDepthBuffer2:GPUTexture,
    querySet:GPUQuerySet|undefined = undefined,
    startTimeId:number|undefined = undefined,
    endTimeId:number|undefined = undefined
  ){

    if( this.texturesBindGroupLayout===undefined ||
        this.pipeline === undefined
    ){
      throw Error("BlendFrameBufferPass not initialized");
    }

    let texturesBindGroup = this.device.createBindGroup({
      layout:this.texturesBindGroupLayout,
      entries:[
        {binding:0, resource:inFrameBuffer1.createView()},
        {binding:1, resource:inFrameBuffer2.createView()},
        {binding:2, resource:inDepthBuffer1.createView()},
        {binding:3, resource:inDepthBuffer2.createView()}
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
    let pass = encoder.beginRenderPass({
      label:"BlendFrameBuffers Render Pass",
      colorAttachments:[
        {
          view:outFrameBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          storeOp:<GPUStoreOp>'store',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:1}
        },
        {
          view:outDepthBuffer.createView(),
          loadOp:<GPULoadOp>'clear',
          storeOp:<GPUStoreOp>'store',
          clearValue:<GPUColor>{r:1,g:0,b:0,a:1}
        }
      ],
      timestampWrites:timeStampWrites
    });

    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,texturesBindGroup);
    pass.draw(6);
    pass.end();

  }
}

export class ShowTextureChannelsPass{

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
          label:"showTextureChannels resolution Sampler Bind Group",
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
          label:"showTextureChannels textures bind group",
          entries:[
            { binding:0, // inputTexture
              visibility:GPUShaderStage.FRAGMENT,
              texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
            }
          ]
        });
        this.resolutionSamplerBindGroup = this.device.createBindGroup({
          label:"showTextureChannels resolution sampler bind group",
          layout:resolutionSamplerBindGroupLayout,
          entries:[
            {binding:0,resource:{buffer:resolutionBuffer}},
            {binding:1,resource:basicSampler}
          ]
        });
        // pipeline
        this.pipeline = this.device.createRenderPipeline({
          label:"showTextureChannels render pipeline",
          layout:this.device.createPipelineLayout({
            bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.InputTextureBindGroupLayout],
          }),
          vertex:{module:this.device.createShaderModule({code:ShowTextureChannelsShader})},
          fragment:{
            module:this.device.createShaderModule({code:ShowTextureChannelsShader}),
            targets:[
              {format:this.frameBufferTextureFormat}
            ]
          }
  
        });
    }
    
    public render(
      encoder:GPUCommandEncoder,
      inputTexture:GPUTexture,
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
          {binding:0,resource:inputTexture.createView()},
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

export class ShowUnfilterableTexturePass{

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
  
  public async initializeRenderPipeline(canvasWidth:number,canvasHeight:number,showR:boolean=true,showG:boolean=true,showB:boolean=true,showA:boolean=true){
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
        vertex:{module:this.device.createShaderModule({code:ShowTextureShader})},
        fragment:{
          module:this.device.createShaderModule({code:ShowTextureShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ],
          constants:{
            showR: showR ? 1.0 : 0.0,
            showG: showG ? 1.0 : 0.0,
            showB: showB ? 1.0 : 0.0,
            showA: showA ? 1.0 : 0.0
          }
        },

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    inputTexture:GPUTexture,
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
        {binding:0,resource:inputTexture.createView()},
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