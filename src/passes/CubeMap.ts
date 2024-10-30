import { PerspectiveCamera } from '../utils/camera';
import EnvShader from '../shaders/EnvironmentShader.wgsl';
import * as mathUtils from '../utils/math';

export class CubeMapPass{
    private device:GPUDevice;
    private camera:PerspectiveCamera;
    private frameBufferFormat:GPUTextureFormat;
    private cubeMap:GPUTexture;
    private renderMipLevel:number;
  
    private cameraBuffer:GPUBuffer|undefined;
    private pipeline:GPURenderPipeline|undefined;
    private envSamplerBindGroup:GPUBindGroup|undefined;
    private cameraBindGroup:GPUBindGroup|undefined;
  
    constructor(device:GPUDevice,camera:PerspectiveCamera,frameBufferFormat:GPUTextureFormat,cubeMap:GPUTexture,renderMipLevel:number){
      this.device = device;
      this.camera = camera;
      this.frameBufferFormat = frameBufferFormat;
      this.cubeMap = cubeMap;
      this.renderMipLevel = renderMipLevel;
    }
  
    public async initializeRenderPipeline(){
      //---------------
      // Create Buffers
      //---------------
      this.cameraBuffer = this.device.createBuffer({
        label:  "cameraBuffer",
        size:   16 * 4 +    // viewMatrix
                16 * 4 +    // projMatrix
                4  * 4,     // eye,
        usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
      });
  
      let sampler = this.device.createSampler({
        addressModeU:'clamp-to-edge',
        addressModeV:'clamp-to-edge',
        magFilter:'linear',
        minFilter:'linear',
        mipmapFilter:'linear'
      });
      //---------------------------------------
      // Create Bind Group Layouts and Pipeline
      //---------------------------------------
      let cameraBindGroupLayout = this.device.createBindGroupLayout({entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,buffer:{type:<GPUBufferBindingType>'uniform'}}
      ]});
      let envSamplerBindGroupLayout = this.device.createBindGroupLayout({entries:[
        {binding:0,visibility:GPUShaderStage.FRAGMENT,texture:{sampleType:<GPUTextureSampleType>'float',viewDimension:<GPUTextureViewDimension>'cube'}},
        {binding:1,visibility:GPUShaderStage.FRAGMENT,sampler:{type:<GPUSamplerBindingType>'filtering'}}
      ]});
      this.pipeline = this.device.createRenderPipeline({
        label:"cubemap renderer pipeline",
        layout:this.device.createPipelineLayout({
          bindGroupLayouts:[cameraBindGroupLayout,envSamplerBindGroupLayout]
        }),
        vertex:{
          module:this.device.createShaderModule({
            code:EnvShader
          }),
        },
        fragment:{
          module:this.device.createShaderModule({
            code:EnvShader
          }),
          targets:[
            {format:this.frameBufferFormat}
          ],
          constants:{
            renderMipLevel:this.renderMipLevel
          }
        }
      });
  
      // ------------------
      // Create Bind Groups
      // ------------------
      this.envSamplerBindGroup = this.device.createBindGroup({
        label:"cubemap sampler bind group",
        layout:envSamplerBindGroupLayout,
        entries:[
          {binding:0, resource:this.cubeMap.createView({dimension:'cube'})},
          {binding:1, resource:sampler}
        ]
      });
      this.cameraBindGroup = this.device.createBindGroup({
        layout:cameraBindGroupLayout,
        entries:[
          {binding:0,resource:{buffer:this.cameraBuffer}}
        ]
      })
    }
  
    public render(frameBuffer:GPUTexture,encoder:GPUCommandEncoder){
      /**
       * @param {GPUTexture} frameBuffer - The texture used for rendering (color attachment)
       * @param {GPUCommandEncoder} encoder - The GPU encoder on which the draw call is issued,
       * this is useful to chain multiple multiple passes in the same encoder
       */
      if(this.cameraBuffer === undefined){
        throw Error("Camer Buffer is undefined");
      }
      if(this.cameraBindGroup === undefined){
        throw Error("Camera Bind Group is undefined");
      }
      if(this.envSamplerBindGroup === undefined){
        throw Error("envSampler Bind Group is undefined");
      }
      if(this.pipeline===undefined){
        throw Error("Pipeline is undefined");
      }
  
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
      let pass = encoder.beginRenderPass({
        colorAttachments:[
          {view:frameBuffer.createView(),loadOp:<GPULoadOp>'clear',storeOp:<GPUStoreOp>'store',clearValue:{r:0,g:0,b:0,a:0}}
        ]
      });
      pass.setPipeline(this.pipeline);
      pass.setBindGroup(0,this.cameraBindGroup);
      pass.setBindGroup(1,this.envSamplerBindGroup);
      pass.draw(6);
      pass.end();
    }
}