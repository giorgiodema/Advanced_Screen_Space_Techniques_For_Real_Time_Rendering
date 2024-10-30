import GBufferViewerShader from '../shaders/GBufferViewerShader.wgsl';
import GBufferTransmissionViewerShader from '../shaders/GBufferTransmissionViewerShader.wgsl';
import GBufferShader from '../shaders/GbufferShader.wgsl';
import GBufferTransmissionShader from '../shaders/GbufferTransmissionShader.wgsl';
import GBufferVolumeShader from '../shaders/GbufferVolumeShader.wgsl';
import GBufferVolumeShaderLayer1 from "../shaders/GbufferVolumeLayer1Shader.wgsl";
import GBufferVolumeShaderLayer2 from "../shaders/GbufferVolumeLayer2Shader.wgsl";
import GBufferVolumeLayerShader from "../shaders/GbufferVolumeLayer.wgsl";
import AttenuationDistanceColorShader from '../shaders/AttenutionDistanceColorShader.wgsl';
import { PerspectiveCamera } from '../utils/camera';
import { saxpy,negate } from '../utils/vectors';
import { GPUScene,GPUMesh,GPUIndexedMesh, GPUMaterialTransmission, GPUMaterialVolume } from '../utils/glTFLoader';

export class GBuffer{
  public static readonly baseColorTextureFormat:GPUTextureFormat = "rgba8unorm";
  public static readonly positionTextureFormat:GPUTextureFormat  = "rgba16float";
  public static readonly normalTextureFormat:GPUTextureFormat = "rgba16float";
  // the RG channels contain respectively the metalness and roughness parameters,
  // the B channel is used in transparent materials (either volumes or thin-transparent
  // materials) for the transparency parameter
  public static readonly metallicRoughnessTextureFormat:GPUTextureFormat = "rgba16float";
  public static readonly depthStencilTextureFormat:GPUTextureFormat = 'depth32float';

  public baseColorTexture:GPUTexture;
  public positionTexture:GPUTexture;
  public normalTexture:GPUTexture;
  public metallicRoughnessTexture:GPUTexture;
  public depthStencilTexture:GPUTexture;

  constructor(device:GPUDevice,canvasWidth:number, canvasHeight:number){
    this.baseColorTexture = device.createTexture({
      size:[canvasWidth,canvasHeight],
      format:GBuffer.baseColorTextureFormat,
      usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
    });
    this.positionTexture = device.createTexture({
        size:[canvasWidth,canvasHeight],
        format:GBuffer.positionTextureFormat,
        usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage. TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
    });
    this.normalTexture = device.createTexture({
        size:[canvasWidth,canvasHeight],
        format:GBuffer.normalTextureFormat,
        usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
    });
    this.metallicRoughnessTexture = device.createTexture({
        size:[canvasWidth,canvasHeight],
        format:GBuffer.metallicRoughnessTextureFormat,
        usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
    });
    this.depthStencilTexture = device.createTexture({
        size:[canvasWidth,canvasHeight],
        format:GBuffer.depthStencilTextureFormat,
        usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
    });
  }

  public destroy(){
    this.baseColorTexture.destroy();
    this.positionTexture.destroy();
    this.normalTexture.destroy();
    this.metallicRoughnessTexture.destroy();
    this.depthStencilTexture.destroy();
  }
}

export class AttenuationColorDistanceBuffer{
  public static readonly attenuationColorDistanceTextureFormat:GPUTextureFormat = "rgba16float";
  public attenuationColorDistanceTexture:GPUTexture;

  constructor(device:GPUDevice,canvasWidth:number,canvasHeight:number){
    this.attenuationColorDistanceTexture = device.createTexture(
      {
        size:[canvasWidth,canvasHeight],
        format:AttenuationColorDistanceBuffer.attenuationColorDistanceTextureFormat,
        usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC // COPY_SRC for debugging
      }
    );
  }

  public destroy(){
    this.attenuationColorDistanceTexture.destroy();
  }
}

export class AttenuationColorDistanceBufferPass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;
  private cameraBuffer:GPUBuffer | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];

  private minMaxDepthBindGroupLayout:GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          }
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        }
    ]
    });
    this.minMaxDepthBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferTransmission max depth bind group layout",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'unfilterable-float',
            viewDimension:<GPUTextureViewDimension>'2d'
          },
        }
      ]
    })

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBuffer Volume Shader",
      code:AttenuationDistanceColorShader,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout,this.minMaxDepthBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:AttenuationColorDistanceBuffer.attenuationColorDistanceTextureFormat}
        ],
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:gpuMaterial.buffer}},
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                inMaxDepth:GPUTexture,
                attenuationColorDistanceBuffer:AttenuationColorDistanceBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.minMaxDepthBindGroupLayout === undefined){
        throw Error("maxDepth bind group layout is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );
      // create dymanic bind groups
      let maxDepthBindGroup = this.device.createBindGroup({
        label:"GBufferTransmission maxDepth Bind Group",
        layout:this.minMaxDepthBindGroupLayout,
        entries:[
          {binding:0,resource:inMaxDepth.createView({aspect:'depth-only'})},
        ]
      })

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: attenuationColorDistanceBuffer.attenuationColorDistanceTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: this.maxDist }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          }
        ]
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);
      GBufferPass.setBindGroup(3,maxDepthBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferOpaquePass{
    private device:GPUDevice;
    private camera:PerspectiveCamera;
    private maxDist:number;
  
    private pipeline:GPURenderPipeline | undefined;
  
    private scene:GPUScene | undefined;
  
    private frontCameraBuffer:GPUBuffer | undefined;
    private rearCameraBuffer:GPUBuffer | undefined;
    private basicSampler:GPUSampler | undefined;
  
    private frontCameraBindGroup:GPUBindGroup | undefined;
    private rearCameraBindGroup:GPUBindGroup | undefined;
    private modelMatricesBindGroups:GPUBindGroup[] = [];
    private materialsBindGroups:GPUBindGroup[] = [];
  
    constructor(device:GPUDevice, camera:PerspectiveCamera){
      this.device = device;
      this.camera = camera;
      this.maxDist = this.camera.far;
    }
  
    public async initializePipeline(scene:GPUScene){
      if(!scene.loaded){
        await scene.load();
      }
      this.scene = scene;
      //-----------------------------------
      // create and allocate GPU resources
      // (Buffers, Textures, Samplers)
      //----------------------------------
      this.frontCameraBuffer = this.device.createBuffer({
        label:  "frontcameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      this.rearCameraBuffer = this.device.createBuffer({
        label:  "frontcameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
      // samplers
      this.basicSampler = this.device.createSampler({
        addressModeU:"repeat",
        addressModeV:"repeat",
        magFilter:"linear",
        minFilter:"linear",
        mipmapFilter:"linear"
      });
      // ------------------------------------
      // Create bind group layouts
      //-------------------------------------
      const cameraBindGroupLayout = this.device.createBindGroupLayout({
        label:"bind group layout for Camera",
        entries: [
            {
                binding: 0,                                // Camera Struct
                visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
                buffer: {
                  type: <GPUBufferBindingType> "uniform",
                }
            }
        ]
      });
      const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
        label:"bind group layout for model matrix",
        entries:[
          {
            binding: 0,                                   // modelMatrix
            visibility: GPUShaderStage.VERTEX,
            buffer:{
              type: <GPUBufferBindingType> "uniform",
            }
          },
          {
            binding: 1,                                   // normalMatrix
            visibility: GPUShaderStage.VERTEX,
            buffer:{
              type: <GPUBufferBindingType> "uniform",
            }
          }
        ]
      });
      const materialBindGroupLayout = this.device.createBindGroupLayout({
        label:"bind group layout for material",
        entries:[
          {
            binding:0,
            visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            sampler:{
              type:<GPUSamplerBindingType>"filtering"
            }
          },
          {
            binding:1,                                                            // Material struct
            visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer:{
              type:<GPUBufferBindingType> "uniform"
            }
          },
          {
            binding:2,                                                            // baseColorTexture
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            texture:{
              sampleType:<GPUTextureSampleType>'float',
              viewDimension:<GPUTextureViewDimension>'2d',
            }
          },
          {
            binding:3,                                                            // metallicRougnessTexture
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            texture:{
              sampleType:<GPUTextureSampleType>'float',
              viewDimension:<GPUTextureViewDimension>'2d',
            }
          },
      ]
      });
  
      //-----------------------------------------
      // initialize render pipeline
      //-----------------------------------------
      let module = this.device.createShaderModule({
        label:"GBuffer Shader",
        code:GBufferShader,
      });
      this.pipeline = this.device.createRenderPipeline({
        label:"GBuffer",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout]
        }),
        vertex: {
          entryPoint:"vs",
          module,
          buffers: [
            {
              arrayStride: 3 * 4, // 3 floats, 4 bytes each
              attributes: [
                {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
              ],
            },
            {
              arrayStride: 3 * 4, // 3 floats, 4 bytes each
              attributes: [
                {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
              ],
            },
            {
              arrayStride: 2 * 4, // 2 floats, 4 bytes each
              attributes: [
                {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
              ],
            },
          ],
        },
        fragment: {
          entryPoint:"fs",
          module,
          targets: [
            {format:GBuffer.baseColorTextureFormat},
            {format:GBuffer.positionTextureFormat},
            {format:GBuffer.normalTextureFormat},
            {format:GBuffer.metallicRoughnessTextureFormat},
          ],
        },
        depthStencil : {
            format: GBuffer.depthStencilTextureFormat,
            depthWriteEnabled: true,
            depthCompare: 'less',
        }
      });
      if(this.pipeline === undefined)
        throw Error("Could not initialize render Pipeline");
  
      //------------------------------
      // create bind groups
      //------------------------------
      this.frontCameraBindGroup = this.device.createBindGroup({
        label:"Camera bind group",
        layout: cameraBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:this.frontCameraBuffer}},
        ],
      });
      this.rearCameraBindGroup = this.device.createBindGroup({
        label:"Camera bind group",
        layout: cameraBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:this.rearCameraBuffer}},
        ],
      });
      // create bind group for model matrices, since
      // in a single render pass multiple meshes (with 
      // their own model matrix) will be rendered, create
      // a bind group for each mesh and then during 
      // rendering for each mesh bind the corresponding
      // bind group
      for(const gpuMesh of scene.opaqueMeshes){
        // modelMatrix bind group
        let transformBindGroup = this.device.createBindGroup({
          label:"model matrix bind group",
          layout: modelMatrixBindgroupLayout,
          entries:[
            {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
            {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
          ]
        });
        this.modelMatricesBindGroups.push(transformBindGroup);
        // material bind group
        // the shader assumes that all textures are defined
        // so if the texture for a specific attribute does not
        // exist (material.attributeTextureId < 0) then a placeholder
        // texture is created.
        let colorBaseTexture:GPUTexture;
        let metallicRoughnessTexture:GPUTexture;
        if(gpuMesh.material.baseColorTextureId>=0){
          colorBaseTexture = scene.textures[gpuMesh.material.baseColorTextureId];
        }
        else{
          colorBaseTexture = this.device.createTexture({
            size:{width:1,height:1},
            format:"rgba8unorm",
            usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
        }
        if(gpuMesh.material.metallicRoughnessTextureId>=0){
          metallicRoughnessTexture = scene.textures[gpuMesh.material.metallicRoughnessTextureId];
        }
        else{
          metallicRoughnessTexture = this.device.createTexture({
            size:{width:1,height:1},
            format:"rgba8unorm",
            usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });
        }
        let materialBindGroup = this.device.createBindGroup({
          label:"material bind group",
          layout:materialBindGroupLayout,
          entries:[
            {binding:0,resource:this.basicSampler},
            {binding:1,resource:{buffer:gpuMesh.material.buffer}},
            {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
            {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})}
          ]
        });
        this.materialsBindGroups.push(materialBindGroup);
      }
    }
  
    public render(encoder:GPUCommandEncoder,
                  gBuffer:GBuffer,
                  invertCamera:boolean = false,
                  rearFovFactor:number = 1.0,
                  querySet:GPUQuerySet|undefined = undefined,
                  startTimeId:number|undefined = undefined,
                  endTimeId:number|undefined = undefined)
    {
  
        if(this.frontCameraBuffer === undefined || this.rearCameraBuffer === undefined){
          throw Error("Camera Buffer is undefined");
        }
        if(this.pipeline === undefined){
          throw Error("Render pipeline is undefined");
        }
        if(this.frontCameraBindGroup === undefined || this.rearCameraBindGroup === undefined){
          throw Error("Camera Bind Group is undefined");
        }
        if(this.scene === undefined){
          throw Error("Scene is undefined");
        }
  
        // view and projection matrices  and light 
        // direction can change 
        // every frame, so copy the memory in the
        // gpu buffer here
        let frontCamera = this.camera;
        let rearCamera = new PerspectiveCamera(
          this.camera.eye,
          saxpy(2.0,this.camera.eye,negate(this.camera.lookAt)),
          Math.max(Math.min(rearFovFactor*this.camera.fov,180.0),0.0),
          this.camera.near,
          this.camera.far,
          this.camera.ar
        );
        let frontCameraArray = frontCamera.getCameraBuffer();
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
        // profiling stuff
        let timeStampWrites:GPURenderPassTimestampWrites|undefined = undefined;
        if(querySet!==undefined && startTimeId!==undefined && endTimeId!==undefined){
          timeStampWrites =<GPURenderPassTimestampWrites> {
            querySet:querySet,
            beginningOfPassWriteIndex:startTimeId,
            endOfPassWriteIndex:endTimeId
          };
        }
        // create the render pass
        const GBufferPass = encoder.beginRenderPass({
          label: 'glTF Render Pass',
          colorAttachments: [ // rendering targets
            {
              view: gBuffer.baseColorTexture.createView(),
              clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
              loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
              storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
            },
            {
              view: gBuffer.positionTexture.createView(),
              clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
              loadOp: <GPULoadOp>'clear',
              storeOp: <GPUStoreOp>'store'
            },
            {
              view: gBuffer.normalTexture.createView(),
              clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
              loadOp: <GPULoadOp>'clear',
              storeOp: <GPUStoreOp>'store'
            },
            {
              view: gBuffer.metallicRoughnessTexture.createView(),
              clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
              loadOp: <GPULoadOp>'clear',
              storeOp: <GPUStoreOp>'store'
            }
          ],
          depthStencilAttachment: {
            view: gBuffer.depthStencilTexture.createView(),
            depthLoadOp: 'clear',
            depthClearValue: 1.0,
            depthStoreOp: 'store',
            //stencilLoadOp: 'clear',
            //stencilClearValue: 0,
            //stencilStoreOp: 'store',
          },
          timestampWrites:timeStampWrites
        });
        GBufferPass.setPipeline(this.pipeline);
        if(!invertCamera){
          GBufferPass.setBindGroup(0,this.frontCameraBindGroup);
        }
        else{
          GBufferPass.setBindGroup(0,this.rearCameraBindGroup);
        }
        // loop over each mesh in the scene and bind the 
        // corresponding modelMatrix, the buffers have been
        // allocated when the glTF scene is loaded
        this.scene.opaqueMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
          GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
          GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
          GBufferPass.setVertexBuffer(0,gpuMesh.positions);
          GBufferPass.setVertexBuffer(1,gpuMesh.normals);
          GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
          if(gpuMesh instanceof GPUIndexedMesh){
            GBufferPass.setIndexBuffer(
              gpuMesh.indices,
              gpuMesh.indexFormat
            );
            GBufferPass.drawIndexed(gpuMesh.indexCount);
          }
          else{
            GBufferPass.draw(gpuMesh.vertexCount);
          }
        });
        GBufferPass.end();
    }
  
}
  
export class GBufferViewer{

  private device:GPUDevice;
  private frameBufferTextureFormat:GPUTextureFormat;

  private resolutionSamplerBindGroup:GPUBindGroup | undefined;
  private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
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
        label:"GBufferViewer resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
        ]
      });
      this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
        label:"GBufferViewer textures bind group",
        entries:[
          { binding:0, // baseColor
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:1, // position
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:2, // normal
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:3, // metallicRoughness
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          {
            binding:4, // depth
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'depth',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"GBufferViewer resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"GBufferViewer render pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.GBufferBindGroupLayout],
        }),
        vertex:{module:this.device.createShaderModule({code:GBufferViewerShader})},
        fragment:{
          module:this.device.createShaderModule({code:GBufferViewerShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ]
        }

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    gbuffer:GBuffer,
    frameBuffer:GPUTexture
  )
  {
    if(this.GBufferBindGroupLayout === undefined){
      throw Error("GBuffer bind group layout undefined");
    }
    if(this.pipeline === undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.resolutionSamplerBindGroup === undefined){
      throw Error("Resolution sampler bind group is undefined");
    }

    // create dynamic bind groups
    let GBufferBindGroup = this.device.createBindGroup({
      label:"GBufferViewer textures bind group",
      layout:this.GBufferBindGroupLayout,
      entries:[
        {binding:0,resource:gbuffer.baseColorTexture.createView()},
        {binding:1,resource:gbuffer.positionTexture.createView()},
        {binding:2,resource:gbuffer.normalTexture.createView()},
        {binding:3,resource:gbuffer.metallicRoughnessTexture.createView()},
        {binding:4,resource:gbuffer.depthStencilTexture.createView({aspect:'depth-only'})}
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
    pass.setBindGroup(1,GBufferBindGroup);
    pass.draw(6);
    pass.end();
  }
}

export class GBufferTransmissionPass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;

  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];

  private maxDepthBindGroupLayout:GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          }
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });
    this.maxDepthBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferTransmission max depth bind group layout",
      entries:[{
        binding:0,
        visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
        texture:{
          sampleType:<GPUTextureSampleType>'unfilterable-float',
          viewDimension:<GPUTextureViewDimension>'2d'
        }
      }
      ]
    })

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBuffer Shader",
      code:GBufferTransmissionShader,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout,this.maxDepthBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: 'less',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.transmissionMeshes){
      let gpuMaterial = <GPUMaterialTransmission>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                inMaxDepth:GPUTexture,
                gBuffer:GBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.maxDepthBindGroupLayout === undefined){
        throw Error("maxDepth bind group layout is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );
      // create dymanic bind groups
      let maxDepthBindGroup = this.device.createBindGroup({
        label:"GBufferTransmission maxDepth Bind Group",
        layout:this.maxDepthBindGroupLayout,
        entries:[
          {binding:0,resource:inMaxDepth.createView({aspect:'depth-only'})}
        ]
      })

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);
      GBufferPass.setBindGroup(3,maxDepthBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.transmissionMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferTransmissionViewer{

  private device:GPUDevice;
  private canvas:HTMLCanvasElement;
  private context:GPUCanvasContext;
  private frameBufferTextureFormat:GPUTextureFormat;

  private resolutionSamplerBindGroup:GPUBindGroup | undefined;
  private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
  private pipeline:GPURenderPipeline | undefined;

  constructor(
    device:GPUDevice,
    canvas:HTMLCanvasElement,
  ){
    this.device = device;
    this.canvas = canvas;
    const context = this.canvas.getContext('webgpu');
    if(context === null){
      throw Error("Context is undefined");
    }
    this.context = context;
    const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
    context.configure({
      device,
      format: presentationFormat,
    });
    this.frameBufferTextureFormat = presentationFormat;
  }
  
  public async initializeRenderPipeline(){
      // resources
      let resolutionBuffer = this.device.createBuffer({
        label:"resolution Buffer",
        size:32,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        mappedAtCreation:true
      });
      let resolutionArray = new Float32Array([
        this.canvas.width,
        this.canvas.height
      ]);
      let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
      dst.set(resolutionArray);
      resolutionBuffer.unmap();

      let basicSampler = this.device.createSampler({});
      // bind groups
      let resolutionSamplerBindGroupLayout = this.device.createBindGroupLayout({
        label:"GBufferViewer resolution Sampler Bind Group",
        entries:[
          { binding:0,                                              // iResolution
            visibility:GPUShaderStage.FRAGMENT,
            buffer:{type:<GPUBufferBindingType>'uniform'}},
          { binding:1,                                              // sampler
            visibility:GPUShaderStage.FRAGMENT,
            sampler:{type:<GPUSamplerBindingType>'filtering'}},
        ]
      });
      this.GBufferBindGroupLayout = this.device.createBindGroupLayout({
        label:"GBufferViewer textures bind group",
        entries:[
          { binding:0, // baseColor
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:1, // position
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:2, // normal
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          { binding:3, // metallicRoughness
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'2d'}
          },
          {
            binding:4, // depth
            visibility:GPUShaderStage.FRAGMENT,
            texture:{sampleType:<GPUTextureSampleType>'depth',viewDimension:<GPUTextureViewDimension>'2d'}
          }
        ]
      });
      this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"GBufferViewer resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:resolutionBuffer}},
          {binding:1,resource:basicSampler}
        ]
      });
      // pipeline
      this.pipeline = this.device.createRenderPipeline({
        label:"GBufferViewer render pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.GBufferBindGroupLayout],
        }),
        vertex:{module:this.device.createShaderModule({code:GBufferTransmissionViewerShader})},
        fragment:{
          module:this.device.createShaderModule({code:GBufferTransmissionViewerShader}),
          targets:[
            {format:this.frameBufferTextureFormat}
          ]
        }

      });
  }
  
  public render(
    encoder:GPUCommandEncoder,
    gbuffer:GBuffer,
  )
  {
    if(this.GBufferBindGroupLayout === undefined){
      throw Error("GBuffer bind group layout undefined");
    }
    if(this.pipeline === undefined){
      throw Error("Pipeline is undefined");
    }
    if(this.resolutionSamplerBindGroup === undefined){
      throw Error("Resolution sampler bind group is undefined");
    }

    // create dynamic bind groups
    let GBufferBindGroup = this.device.createBindGroup({
      label:"GBufferViewer textures bind group",
      layout:this.GBufferBindGroupLayout,
      entries:[
        {binding:0,resource:gbuffer.baseColorTexture.createView()},
        {binding:1,resource:gbuffer.positionTexture.createView()},
        {binding:2,resource:gbuffer.normalTexture.createView()},
        {binding:3,resource:gbuffer.metallicRoughnessTexture.createView()},
        {binding:4,resource:gbuffer.depthStencilTexture.createView({aspect:'depth-only'})}
      ]
    });

    let pass = encoder.beginRenderPass({
      colorAttachments:[
        { view:this.context.getCurrentTexture().createView(),
          loadOp:<GPULoadOp>'clear',
          clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
          storeOp:<GPUStoreOp>'store'
        }
      ]
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0,this.resolutionSamplerBindGroup);
    pass.setBindGroup(1,GBufferBindGroup);
    pass.draw(6);
    pass.end();
  }
}

export class GBufferVolumePass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;

  private overrideMinDepthBuffer:GPUBuffer | undefined;
  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];

  private minMaxDepthBindGroupLayout:GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.overrideMinDepthBuffer = this.device.createBuffer({
      label:"GBufferVolumePass overrideMinDepthBuffer",
      size:4,
      usage:GPUBufferUsage.UNIFORM |GPUBufferUsage.COPY_DST
    });
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          },
          {
            binding: 1,                                // overrideMin
            visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
            buffer: {
              type: <GPUBufferBindingType> "uniform",
            }
        }
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });
    this.minMaxDepthBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferTransmission max depth bind group layout",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'unfilterable-float',
            viewDimension:<GPUTextureViewDimension>'2d'
          },
        },
        {
          binding:1,
          visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'unfilterable-float',
            viewDimension:<GPUTextureViewDimension>'2d'
          },
        },
      ]
    })

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBuffer Volume Shader",
      code:GBufferVolumeShader,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout,this.minMaxDepthBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: 'less',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
        {binding:1,resource:{buffer:this.overrideMinDepthBuffer}}
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                inMinDepth:GPUTexture,
                inMaxDepth:GPUTexture,
                gBuffer:GBuffer,
                overrideMinDepth:number = -1.0)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.overrideMinDepthBuffer===undefined){
        throw Error("Override Min Depth Buffer is undefined");
      }
      if(this.minMaxDepthBindGroupLayout === undefined){
        throw Error("maxDepth bind group layout is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );
      let ovArray = new ArrayBuffer(4);
      let ovArrayFloat = new Float32Array(ovArray,0,1);
      ovArrayFloat.set([overrideMinDepth],0);
      this.device.queue.writeBuffer(
        this.overrideMinDepthBuffer,
        0,
        ovArray
      );
      // create dymanic bind groups
      let maxDepthBindGroup = this.device.createBindGroup({
        label:"GBufferTransmission maxDepth Bind Group",
        layout:this.minMaxDepthBindGroupLayout,
        entries:[
          {binding:0,resource:inMaxDepth.createView({aspect:'depth-only'})},
          {binding:1,resource:inMinDepth.createView({aspect:'depth-only'})},
        ]
      })

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);
      GBufferPass.setBindGroup(3,maxDepthBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferVolumeLayer1Pass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;
  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];


  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferVolumeLayer1Pass bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          },
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBufferVolumeLayer1Pass Shader",
      code:GBufferVolumeShaderLayer1,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: 'less',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                gBuffer:GBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferVolumeLayer2Pass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;

  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];

  private minDepthBindGroupLayout:GPUBindGroupLayout | undefined;

  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferVolumeLayer2Pass bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          }
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });
    this.minDepthBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferTransmission max depth bind group layout",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX|GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'unfilterable-float',
            viewDimension:<GPUTextureViewDimension>'2d'
          },
        },
      ]
    })

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBufferVolumeLayer1Pass Shader",
      code:GBufferVolumeShaderLayer2,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout,this.minDepthBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: 'less',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                inMinDepth:GPUTexture,
                gBuffer:GBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.minDepthBindGroupLayout === undefined){
        throw Error("maxDepth bind group layout is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );
      // create dymanic bind groups
      let minDepthBindGroup = this.device.createBindGroup({
        label:"GBufferTransmission maxDepth Bind Group",
        layout:this.minDepthBindGroupLayout,
        entries:[
          {binding:0,resource:inMinDepth.createView({aspect:'depth-only'})},
        ]
      });

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);
      GBufferPass.setBindGroup(3,minDepthBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferVolumeFrontPass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;
  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];


  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferVolumeLayer1Pass bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          },
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBufferVolumeLayer1Pass Shader",
      code:GBufferVolumeLayerShader,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: 'less',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                gBuffer:GBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 1.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}

export class GBufferVolumeBackPass{
  /**
   * For each fragment finds the thin surface
   * that is closer to the camera and returns
   * a GBuffer object, where the transmission
   * is stored in the a channel of the GBuffer 
   * metallicRoughnessTexture
   */
  private device:GPUDevice;
  private camera:PerspectiveCamera;
  private maxDist:number;
  private pipeline:GPURenderPipeline | undefined;
  
  private scene:GPUScene | undefined;
  private cameraBuffer:GPUBuffer | undefined;
  private basicSampler:GPUSampler | undefined;

  private cameraBindGroup:GPUBindGroup | undefined;
  private modelMatricesBindGroups:GPUBindGroup[] = [];
  private materialsBindGroups:GPUBindGroup[] = [];


  constructor(device:GPUDevice, camera:PerspectiveCamera){
    this.device = device;
    this.camera = camera;
    this.maxDist = this.camera.far;
  }

  public async initializePipeline(scene:GPUScene){
    if(!scene.loaded){
      await scene.load();
    }
    this.scene = scene;
    //-----------------------------------
    // create and allocate GPU resources
    // (Buffers, Textures, Samplers)
    //----------------------------------
    this.cameraBuffer = this.device.createBuffer({
      label:  "cameraBuffer",
      size:   16 * 4 +    // viewMatrix
              16 * 4 +    // projMatrix
              4  * 4,     // eye,
      usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });
    // samplers
    this.basicSampler = this.device.createSampler({
      addressModeU:"repeat",
      addressModeV:"repeat",
      magFilter:"linear",
      minFilter:"linear",
      mipmapFilter:"linear"
    });
    // ------------------------------------
    // Create bind group layouts
    //-------------------------------------
    const cameraBindGroupLayout = this.device.createBindGroupLayout({
      label:"GBufferVolumeLayer1Pass bind group layout for Camera",
      entries: [
          {
              binding: 0,                                // Camera Struct
              visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
              buffer: {
                type: <GPUBufferBindingType> "uniform",
              }
          },
      ]
    });
    const modelMatrixBindgroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for model matrix",
      entries:[
        {
          binding: 0,                                   // modelMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        },
        {
          binding: 1,                                   // normalMatrix
          visibility: GPUShaderStage.VERTEX,
          buffer:{
            type: <GPUBufferBindingType> "uniform",
          }
        }
      ]
    });
    const materialBindGroupLayout = this.device.createBindGroupLayout({
      label:"bind group layout for material",
      entries:[
        {
          binding:0,
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          sampler:{
            type:<GPUSamplerBindingType>"filtering"
          }
        },
        {
          binding:1,                                                            // Material struct
          visibility:GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          buffer:{
            type:<GPUBufferBindingType> "uniform"
          }
        },
        {
          binding:2,                                                            // baseColorTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:3,                                                            // metallicRougnessTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
        {
          binding:4,                                                            // transmissionTexture
          visibility: GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT,
          texture:{
            sampleType:<GPUTextureSampleType>'float',
            viewDimension:<GPUTextureViewDimension>'2d',
          }
        },
    ]
    });

    //-----------------------------------------
    // initialize render pipeline
    //-----------------------------------------
    let module = this.device.createShaderModule({
      label:"GBufferVolumeLayer1Pass Shader",
      code:GBufferVolumeLayerShader,
    });
    this.pipeline = this.device.createRenderPipeline({
      label:"GBuffer",
      layout:this.device.createPipelineLayout({
        bindGroupLayouts:[cameraBindGroupLayout,modelMatrixBindgroupLayout,materialBindGroupLayout]
      }),
      vertex: {
        entryPoint:"vs",
        module,
        buffers: [
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 0, offset: 0, format: <GPUVertexFormat>'float32x3'},  // position
            ],
          },
          {
            arrayStride: 3 * 4, // 3 floats, 4 bytes each
            attributes: [
              {shaderLocation: 1, offset: 0, format: <GPUVertexFormat>'float32x3'},  // normal
            ],
          },
          {
            arrayStride: 2 * 4, // 2 floats, 4 bytes each
            attributes: [
              {shaderLocation: 2, offset: 0, format: <GPUVertexFormat>'float32x2'},  // uvs
            ],
          },
        ],
      },
      fragment: {
        entryPoint:"fs",
        module,
        targets: [
          {format:GBuffer.baseColorTextureFormat},
          {format:GBuffer.positionTextureFormat},
          {format:GBuffer.normalTextureFormat},
          {format:GBuffer.metallicRoughnessTextureFormat},
        ],
      },
      depthStencil : {
          format: GBuffer.depthStencilTextureFormat,
          depthWriteEnabled: true,
          depthCompare: <GPUCompareFunction>'greater',
      }
    });
    if(this.pipeline === undefined)
      throw Error("Could not initialize render Pipeline");

    //------------------------------
    // create bind groups
    //------------------------------
    this.cameraBindGroup = this.device.createBindGroup({
      label:"Camera bind group",
      layout: cameraBindGroupLayout,
      entries:[
        {binding:0,resource:{buffer:this.cameraBuffer}},
      ],
    });
    // create bind group for model matrices, since
    // in a single render pass multiple meshes (with 
    // their own model matrix) will be rendered, create
    // a bind group for each mesh and then during 
    // rendering for each mesh bind the corresponding
    // bind group
    for(const gpuMesh of scene.volumeMeshes){
      let gpuMaterial = <GPUMaterialVolume>gpuMesh.material;
      // modelMatrix bind group
      let transformBindGroup = this.device.createBindGroup({
        label:"model matrix bind group",
        layout: modelMatrixBindgroupLayout,
        entries:[
          {binding:0, resource:{buffer:gpuMesh.modelMatrix}},
          {binding:1, resource:{buffer:gpuMesh.normalMatrix}}
        ]
      });
      this.modelMatricesBindGroups.push(transformBindGroup);
      // material bind group
      // the shader assumes that all textures are defined
      // so if the texture for a specific attribute does not
      // exist (material.attributeTextureId < 0) then a placeholder
      // texture is created.
      let colorBaseTexture:GPUTexture;
      let metallicRoughnessTexture:GPUTexture;
      let transmissionTexture:GPUTexture;
      if(gpuMaterial.baseColorTextureId>=0){
        colorBaseTexture = scene.textures[gpuMaterial.baseColorTextureId];
      }
      else{
        colorBaseTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.metallicRoughnessTextureId>=0){
        metallicRoughnessTexture = scene.textures[gpuMaterial.metallicRoughnessTextureId];
      }
      else{
        metallicRoughnessTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      if(gpuMaterial.transmissionTextureId >= 0){
        transmissionTexture = scene.textures[gpuMaterial.transmissionTextureId];
      }
      else{
        transmissionTexture = this.device.createTexture({
          size:{width:1,height:1},
          format:"rgba8unorm",
          usage:GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
        });
      }
      let materialBindGroup = this.device.createBindGroup({
        label:"material bind group",
        layout:materialBindGroupLayout,
        entries:[
          {binding:0,resource:this.basicSampler},
          {binding:1,resource:{buffer:gpuMaterial.buffer}},
          {binding:2,resource:colorBaseTexture.createView({dimension:"2d"})},
          {binding:3,resource:metallicRoughnessTexture.createView({dimension:"2d"})},
          {binding:4,resource:transmissionTexture.createView({dimension:'2d'})}
        ]
      });
      this.materialsBindGroups.push(materialBindGroup);
    }
  }

  public render(encoder:GPUCommandEncoder,
                gBuffer:GBuffer)
  {

      if(this.cameraBuffer === undefined){
        throw Error("Camera Buffer is undefined");
      }
      if(this.pipeline === undefined){
        throw Error("Render pipeline is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.scene === undefined){
        throw Error("Scene is undefined");
      }

      // view and projection matrices  and light 
      // direction can change 
      // every frame, so copy the memory in the
      // gpu buffer here
      let cameraBuffer = this.camera.getCameraBuffer();
      this.device.queue.writeBuffer(
        this.cameraBuffer,
        0,
        cameraBuffer
      );

      // create the render pass
      const GBufferPass = encoder.beginRenderPass({
        label: 'glTF Render Pass',
        colorAttachments: [ // rendering targets
          {
            view: gBuffer.baseColorTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 }, // Ensure this is a GPUColor (not an array)
            loadOp: <GPULoadOp>'clear', // Should be 'load' or 'clear'
            storeOp: <GPUStoreOp>'store' // Should be 'store' or 'discard'
          },
          {
            view: gBuffer.positionTexture.createView(),
            clearValue: <GPUColor>{ r: this.maxDist, g: this.maxDist, b: this.maxDist, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.normalTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 0, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          },
          {
            view: gBuffer.metallicRoughnessTexture.createView(),
            clearValue: <GPUColor>{ r: 0, g: 1, b: 0, a: 1 },
            loadOp: <GPULoadOp>'clear',
            storeOp: <GPUStoreOp>'store'
          }
        ],
        depthStencilAttachment: {
          view: gBuffer.depthStencilTexture.createView(),
          depthLoadOp: 'clear',
          depthClearValue: 0.0,
          depthStoreOp: 'store',
          //stencilLoadOp: 'clear',
          //stencilClearValue: 0,
          //stencilStoreOp: 'store',
        }
      });
      GBufferPass.setPipeline(this.pipeline);
      GBufferPass.setBindGroup(0,this.cameraBindGroup);

      // loop over each mesh in the scene and bind the 
      // corresponding modelMatrix, the buffers have been
      // allocated when the glTF scene is loaded
      this.scene.volumeMeshes.forEach((gpuMesh:GPUMesh, index:number) =>{
        GBufferPass.setBindGroup(1,this.modelMatricesBindGroups[index]);
        GBufferPass.setBindGroup(2,this.materialsBindGroups[index]);
        GBufferPass.setVertexBuffer(0,gpuMesh.positions);
        GBufferPass.setVertexBuffer(1,gpuMesh.normals);
        GBufferPass.setVertexBuffer(2,gpuMesh.uvs);
        if(gpuMesh instanceof GPUIndexedMesh){
          GBufferPass.setIndexBuffer(
            gpuMesh.indices,
            gpuMesh.indexFormat
          );
          GBufferPass.drawIndexed(gpuMesh.indexCount);
        }
        else{
          GBufferPass.draw(gpuMesh.vertexCount);
        }
      });
      GBufferPass.end();
  }

}