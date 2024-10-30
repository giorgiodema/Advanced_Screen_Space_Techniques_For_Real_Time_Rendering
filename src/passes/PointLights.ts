import { PerspectiveCamera } from "../utils/camera";
import PointLightsDeferredShader from "../shaders/PointLightsDeferredShader.wgsl";
import BRDFShader from "../shaders/BRDF.wgsl";
import { negate, normalizeVector, saxpy } from "../utils/vectors";

const maxDirectionalLights = 10;
const maxPointLights = 10;
const maxSpotLights = 10;

export class DirectionalLight{
    public intensity:number;
    public color:Float32Array;
    public direction:Float32Array;
    public castShadow:boolean;

    constructor(intensity:number,color:Float32Array, direction:Float32Array, castShadow:boolean){
        this.intensity = intensity;
        this.color = color;
        this.direction = direction;
        this.castShadow = castShadow;
    }

    public static getBufferByteLength(){return 48};

    public getArrayBuffer(): ArrayBuffer {
        const buffer = new ArrayBuffer(16 * 3); // 3 * 16 bytes = 48 bytes
        const view = new DataView(buffer);

        // Write intensity at offset 0
        view.setFloat32(0, this.intensity, true); // true for little-endian

        // Write color (vec3<f32>) at offset 16 (next 16-byte aligned position)
        const colorOffset = 16;
        view.setFloat32(colorOffset, this.color[0], true);
        view.setFloat32(colorOffset + 4, this.color[1], true);
        view.setFloat32(colorOffset + 8, this.color[2], true);

        // Write direction (vec3<f32>) at offset 32 (next 16-byte aligned position)
        const directionOffset = 32;
        view.setFloat32(directionOffset, this.direction[0], true);
        view.setFloat32(directionOffset + 4, this.direction[1], true);
        view.setFloat32(directionOffset + 8, this.direction[2], true);

        // Write castShadow at offset 44 (last float in the last 16-byte chunk)
        view.setFloat32(44, this.castShadow ? 1.0 : 0.0, true);

        return buffer;
    }
}

export class PointLight{
    public intensity:number;
    public color:Float32Array;
    public position:Float32Array;
    public castShadow:boolean;

    constructor(intensity:number,color:Float32Array, position:Float32Array, castShadow:boolean){
        this.intensity = intensity;
        this.color = color;
        this.position = position;
        this.castShadow = castShadow;
    }

    public static getBufferByteLength(){return 48};

    public getArrayBuffer(): ArrayBuffer {
        const buffer = new ArrayBuffer(16 * 3); // 3 * 16 bytes = 48 bytes
        const view = new DataView(buffer);

        // Write intensity at offset 0
        view.setFloat32(0, this.intensity, true); // true for little-endian

        // Write color (vec3<f32>) at offset 16 (next 16-byte aligned position)
        const colorOffset = 16;
        view.setFloat32(colorOffset, this.color[0], true);
        view.setFloat32(colorOffset + 4, this.color[1], true);
        view.setFloat32(colorOffset + 8, this.color[2], true);

        // Write position (vec3<f32>) at offset 32 (next 16-byte aligned position)
        const positionOffset = 32;
        view.setFloat32(positionOffset, this.position[0], true);
        view.setFloat32(positionOffset + 4, this.position[1], true);
        view.setFloat32(positionOffset + 8, this.position[2], true);

        // Write castShadow at offset 44 (last float in the last 16-byte chunk)
        view.setFloat32(44, this.castShadow ? 1.0 : 0.0, true);

        return buffer;
    }
}

export class SpotLight {
    public position: Float32Array;
    public color: Float32Array;
    public direction: Float32Array;
    public intensity: number;
    public innerConeAngle: number;
    public outerConeAngle: number;
    public castShadow: boolean;

    constructor(intensity:number, color:Float32Array, position:Float32Array, direction:Float32Array, innerConeAngle:number, outerConeAngle:number, castShadow:boolean){
        this.intensity = intensity;
        this.color = color;
        this.position = position;
        this.color = color;
        this.direction = direction;
        this.intensity = intensity;
        this.innerConeAngle = innerConeAngle;
        this.outerConeAngle = outerConeAngle;
        this.castShadow = castShadow;
    }

    public static getBufferByteLength() { return 64; }

    public getArrayBuffer(): ArrayBuffer {
        const buffer = new ArrayBuffer(64);
        const view = new DataView(buffer);

        const positionOffset = 0;
        view.setFloat32(positionOffset, this.position[0], true);
        view.setFloat32(positionOffset + 4, this.position[1], true);
        view.setFloat32(positionOffset + 8, this.position[2], true);

        const colorOffset = 16;
        view.setFloat32(colorOffset, this.color[0], true);
        view.setFloat32(colorOffset + 4, this.color[1], true);
        view.setFloat32(colorOffset + 8, this.color[2], true);

        const directionOffset = 32;
        view.setFloat32(directionOffset, this.direction[0], true);
        view.setFloat32(directionOffset + 4, this.direction[1], true);
        view.setFloat32(directionOffset + 8, this.direction[2], true);

        view.setFloat32(44, this.intensity, true);
        view.setFloat32(48, this.innerConeAngle, true);
        view.setFloat32(52, this.outerConeAngle, true);
        view.setFloat32(56, this.castShadow ? 1.0 : 0.0, true);

        return buffer;
    }
}

export class PointLightsPass{

    private device:GPUDevice;
    private dirLights:DirectionalLight[];
    private pointLights:PointLight[];
    private spotLights:SpotLight[];
    private frameBufferFormat:GPUTextureFormat;
    private camera:PerspectiveCamera;

    private frontCameraBuffer:GPUBuffer | undefined;
    private rearCameraBuffer:GPUBuffer | undefined;
    private directionalLightsBuffer:GPUBuffer | undefined;
    private pointLightsBuffer:GPUBuffer | undefined;
    private spotLightsBuffer:GPUBuffer | undefined;
    private resolutionSamplerBindGroup:GPUBindGroup | undefined;
    private GBufferBindGroupLayout:GPUBindGroupLayout | undefined;
    private frontCameraBindGroup:GPUBindGroup | undefined;
    private rearCameraBindGroup:GPUBindGroup | undefined;
    private lightsBindGroup:GPUBindGroup | undefined;
    private pipeline:GPURenderPipeline | undefined;

    constructor(    device:GPUDevice,
                    frameBufferFormat:GPUTextureFormat,
                    camera:PerspectiveCamera,
                    dirLights:DirectionalLight[],
                    pointLights:PointLight[],
                    spotLights:SpotLight[]
                ){
        this.device = device;
        this.frameBufferFormat = frameBufferFormat;
        this.camera = camera;
        this.dirLights = dirLights;
        this.pointLights = pointLights;
        this.spotLights = spotLights;
    }

    public initializeRenderPipeline(
        frameBufferWidth:number,
        frameBufferHeight:number,
    ){
        // create buffers
        this.frontCameraBuffer = this.device.createBuffer({
            label:  "cameraBuffer",
            size:   16 * 4 +    // viewMatrix
                    16 * 4 +    // projMatrix
                    4  * 4,     // eye,
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this.rearCameraBuffer = this.device.createBuffer({
            label:  "cameraBuffer",
            size:   16 * 4 +    // viewMatrix
                    16 * 4 +    // projMatrix
                    4  * 4,     // eye,
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
        });
        this
        this.directionalLightsBuffer = this.device.createBuffer({
            size: maxDirectionalLights * DirectionalLight.getBufferByteLength(),
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.pointLightsBuffer = this.device.createBuffer({
            size: maxPointLights * PointLight.getBufferByteLength(),
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        this.spotLightsBuffer = this.device.createBuffer({
            label:"Spot Lights Buffer",
            size: maxSpotLights * SpotLight.getBufferByteLength(),
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST
        });
        let resolutionBuffer = this.device.createBuffer({
            label:"resolution Buffer",
            size:32,
            usage:GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
            mappedAtCreation:true
          });
        let resolutionArray = new Float32Array([
            frameBufferWidth,
            frameBufferHeight
        ]);
        let dst = new Float32Array(resolutionBuffer.getMappedRange(0,8));
        dst.set(resolutionArray);
        resolutionBuffer.unmap();
        let basicSampler = this.device.createSampler({});
        // create bind groups
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
            label:"PointLights textures bind group",
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
              }
            ]
        });
        this.resolutionSamplerBindGroup = this.device.createBindGroup({
        label:"PointLights resolution sampler bind group",
        layout:resolutionSamplerBindGroupLayout,
        entries:[
            {binding:0,resource:{buffer:resolutionBuffer}},
            {binding:1,resource:basicSampler}
        ]
        });
        let cameraBindGroupLayout = this.device.createBindGroupLayout({
            label:"PointLights camera bind group",
            entries:[
                {   // camera
                    binding:0,
                    visibility:GPUShaderStage.FRAGMENT,
                    buffer:{type:<GPUBufferBindingType>"uniform"}
                }
            ]
        });
        let lightsBindGroupLayout = this.device.createBindGroupLayout({
            label:"PointLights lights bind group",
            entries:[
                {   // directionalLights
                    binding:0,
                    visibility:GPUShaderStage.FRAGMENT,
                    buffer:{type:<GPUBufferBindingType>"uniform"}
                },
                {   // pointLights
                    binding:1,
                    visibility:GPUShaderStage.FRAGMENT,
                    buffer:{type:<GPUBufferBindingType>"uniform"}
                },
                {   // spotLights
                    binding:2,
                    visibility:GPUShaderStage.FRAGMENT,
                    buffer:{type:<GPUBufferBindingType>"uniform"}
                }
            ]
        });
        this.lightsBindGroup = this.device.createBindGroup({
            label:"PointLights lights bind group",
            layout:lightsBindGroupLayout,
            entries:[
                {binding:0,resource:{buffer:this.directionalLightsBuffer}},
                {binding:1,resource:{buffer:this.pointLightsBuffer}},
                {binding:2,resource:{buffer:this.spotLightsBuffer}}
            ]
        });
        this.frontCameraBindGroup = this.device.createBindGroup({
            label:"PointLights front camera bind group",
            layout:cameraBindGroupLayout,
            entries:[
                {binding:0,resource:{buffer:this.frontCameraBuffer}}
            ]
        });
        this.rearCameraBindGroup = this.device.createBindGroup({
            label:"PointLights rear camera bind group",
            layout:cameraBindGroupLayout,
            entries:[
                {binding:0,resource:{buffer:this.rearCameraBuffer}}
            ]
        });
        // create pipeline
        this.pipeline = this.device.createRenderPipeline({
            label:"PointLights render pipeline",
            layout:this.device.createPipelineLayout({
              bindGroupLayouts:[resolutionSamplerBindGroupLayout,this.GBufferBindGroupLayout,lightsBindGroupLayout,cameraBindGroupLayout],
            }),
            vertex:{
                module:this.device.createShaderModule({
                    code:   BRDFShader + '\n' + 
                            PointLightsDeferredShader
                }),
            },
            fragment:{
                module:this.device.createShaderModule({
                    code:   BRDFShader + '\n' + 
                            PointLightsDeferredShader
                }),
              targets:[
                {format:this.frameBufferFormat}
              ],
              constants:{
                directionalLightsCount:this.dirLights.length,
                pointLightsCount:this.pointLights.length,
                spotLightsCount:this.spotLights.length
              }
            }
    
        });
    }

    public render(  encoder:GPUCommandEncoder,
                    outFrameBuffer:GPUTexture,      
                    inBaseColorTexture:GPUTexture,
                    inPositionTexture:GPUTexture,
                    inNormalTexture:GPUTexture,
                    inMetallicRoughnessTexture:GPUTexture,
                    invertCamera:boolean=false,
                    rearFovFactor:number=1.0,
                    querySet:GPUQuerySet|undefined = undefined,
                    startTimeId:number|undefined = undefined,
                    endTimeId:number|undefined = undefined)
    {
        // check for errors
        if(this.frontCameraBuffer === undefined || this.rearCameraBuffer===undefined){
            throw Error("Camera Buffer is undefined");
        }    
        if(this.directionalLightsBuffer === undefined){
            throw Error("Directional light buffer is undefined");
        }
        if(this.pointLightsBuffer === undefined){
            throw Error("Point light buffer is undefined");
        }
        if(this.spotLightsBuffer === undefined){
            throw Error("Spot light buffer is undefined");
        }
        if(this.GBufferBindGroupLayout == undefined){
            throw Error("GBuffer bind group is undefined");
        }
        if(this.pipeline === undefined){
            throw Error("Pipeline is undefined");
        }
        if(this.resolutionSamplerBindGroup === undefined){
            throw Error("resolution Sampler Bind group is undefined");
        }
        if(this.lightsBindGroup === undefined){
            throw Error("Lights Bind Group is undefined");
        }
        if(this.frontCameraBindGroup === undefined || this.rearCameraBindGroup===undefined){
            throw Error("Camera Bind Group is undefined");
        }
        // update buffers
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
        for(let i = 0; i < this.dirLights.length; i++){
            let dl = this.dirLights[i];
            this.device.queue.writeBuffer(
                this.directionalLightsBuffer,
                DirectionalLight.getBufferByteLength() * i,
                dl.getArrayBuffer()
            );
        }
        for(let i = 0; i < this.pointLights.length; i++){
            let dl = this.pointLights[i];
            this.device.queue.writeBuffer(
                this.pointLightsBuffer,
                PointLight.getBufferByteLength() * i,
                dl.getArrayBuffer()
            );
        }
        for(let i = 0; i < this.spotLights.length; i++){
            let dl = this.spotLights[i];
            this.device.queue.writeBuffer(
                this.spotLightsBuffer,
                SpotLight.getBufferByteLength() * i,
                dl.getArrayBuffer()
            );
        }
        // create render pass
        let GBufferBindGroup = this.device.createBindGroup({
            label:"PointLights textures bind group",
            layout:this.GBufferBindGroupLayout,
            entries:[
            {binding:0,resource:inBaseColorTexture.createView()},
            {binding:1,resource:inPositionTexture.createView()},
            {binding:2,resource:inNormalTexture.createView()},
            {binding:3,resource:inMetallicRoughnessTexture.createView()},
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
        // create render pass
        let pass = encoder.beginRenderPass({
            colorAttachments:[
            { view:outFrameBuffer.createView(),
                loadOp:<GPULoadOp>'clear',
                clearValue:<GPUColor>{r:0,g:0,b:0,a:0},
                storeOp:<GPUStoreOp>'store'
            }
            ],
            timestampWrites:timeStampWrites // for profiling
        });
        pass.setPipeline(this.pipeline);
        pass.setBindGroup(0,this.resolutionSamplerBindGroup);
        pass.setBindGroup(1,GBufferBindGroup);
        pass.setBindGroup(2,this.lightsBindGroup);
        if(!invertCamera){
            pass.setBindGroup(3,this.frontCameraBindGroup);
        }
        else{
            pass.setBindGroup(3,this.rearCameraBindGroup);
        }
        
        pass.draw(6);
        pass.end();
    }

}


export class DirectionalLightController {
    private light: DirectionalLight;
    private canvas: HTMLCanvasElement;
    private azimuth: number; // Horizontal rotation angle in degrees
    private elevation: number; // Vertical rotation angle in degrees

    constructor(light: DirectionalLight, canvas: HTMLCanvasElement) {
        this.light = light;
        this.canvas = canvas;

        // Initialize azimuth and elevation based on the current light direction
        const x = this.light.direction[0];
        const y = this.light.direction[1];
        const z = this.light.direction[2];

        // Calculate azimuth and elevation from the direction vector
        this.azimuth = Math.atan2(x, z) * 180 / Math.PI;
        this.elevation = Math.asin(y / Math.sqrt(x * x + y * y + z * z)) * 180 / Math.PI;

        // Set up event listeners
        // Focus the canvas to receive keyboard events
        this.canvas.tabIndex = 0;
        this.canvas.style.outline = 'none'; // Removes the default focus outline

        // Handle keydown events
        this.canvas.addEventListener('keydown', this.handleKeydown.bind(this));
    }

    private handleKeydown(event: KeyboardEvent) {
        const delta = 5; // Degrees to rotate per key press

        switch (event.key) {
            case 'ArrowLeft':
                this.azimuth -= delta;
                break;
            case 'ArrowRight':
                this.azimuth += delta;
                break;
            case 'ArrowUp':
                this.elevation = Math.min(90, this.elevation + delta);
                break;
            case 'ArrowDown':
                this.elevation = Math.max(-90, this.elevation - delta);
                break;
            default:
                return;
        }

        this.updateLightDirection();
        event.preventDefault(); // Prevent default behavior (e.g., scrolling)
    }

    private updateLightDirection() {
        let azimuthRad = this.azimuth * Math.PI / 180;
        let elevationRad = this.elevation * Math.PI / 180;

        let x = Math.cos(elevationRad) * Math.sin(azimuthRad);
        let y = Math.sin(elevationRad);
        let z = Math.cos(elevationRad) * Math.cos(azimuthRad);

        this.light.direction[0] = x;
        this.light.direction[1] = y;
        this.light.direction[2] = z;
    }
}

export class PointLightController {
    private light: PointLight;
    private canvas: HTMLCanvasElement;

    constructor(light: PointLight, canvas: HTMLCanvasElement) {
        this.light = light;
        this.canvas = canvas;
        // Set up event listeners
        // Focus the canvas to receive keyboard events
        this.canvas.tabIndex = 0;
        this.canvas.style.outline = 'none'; // Removes the default focus outline

        // Handle keydown events
        this.canvas.addEventListener('keydown', this.handleKeydown.bind(this));
    }

    private handleKeydown(event: KeyboardEvent) {
        const delta = 0.1; // Degrees to rotate per key press

        switch (event.key) {
            case 'ArrowLeft':
                this.light.position[0] -= delta;
                break;
            case 'ArrowRight':
                this.light.position[0] += delta;
                break;
            case 'ArrowUp':
                this.light.position[2] -= delta;
                break;
            case 'ArrowDown':
                this.light.position[2] += delta;
                break;
            case '-':
                this.light.position[1] -= delta;
                break;
            case '+':
                this.light.position[1] += delta;
                break;
            default:
                return;
        }
        event.preventDefault(); // Prevent default behavior (e.g., scrolling)
    }
}

