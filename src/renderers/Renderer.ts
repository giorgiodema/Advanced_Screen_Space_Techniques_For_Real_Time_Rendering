import { BlurMips } from "../passes/BlurMips";
import { AttenuationColorDistanceBuffer, AttenuationColorDistanceBufferPass, GBuffer, GBufferOpaquePass, GBufferTransmissionPass, GBufferViewer, GBufferVolumeBackPass, GBufferVolumeFrontPass, GBufferVolumePass } from "../passes/GBuffer";
import { PointLight, DirectionalLight, SpotLight, PointLightsPass } from "../passes/PointLights";
import { SSR2CamsDrawPass, SSR2CamsDrawPassWithEnv, SSReflections2CamsUVPass } from "../passes/SSR2Cams";
import { BlendReflectionsPass, BlendTransmissionPass, BlendVolumeEnvPass, BlendVolumePass, BlendVolumeProxyEnvPass, ShowDistanceTravelledPass, ShowUVPass, ShowVisibilityPass, SSReflectionsUVPass, SSTransmissionUVPass, SSVolumeRefractionDirectionPass, SSVolumeUVPass, SSXDrawPass, SSXDrawPassWithEnv } from "../passes/SSReflections";
import { BlendFrameBuffersAndDepthPass, BlendFrameBuffersAndEnvPass, BlendFrameBuffersPass, ShowUnfilterableTexturePass } from "../passes/Utils";
import { PerspectiveCamera } from "../utils/camera";
import { GPUEnvironment } from "../utils/envLoader";
import { GPUScene } from "../utils/glTFLoader";
import Long from 'long';

function uint8ArrayToUint64Array(data: Uint8Array): Long[] {
    if (data.length % 8 !== 0) {
        throw new Error('Uint8Array length must be a multiple of 8 to interpret as Uint64.');
    }

    const result: Long[] = [];

    for (let i = 0; i < data.length; i += 8) {
        const low = (
        (data[i]      ) |
        (data[i + 1] << 8) |
        (data[i + 2] << 16) |
        (data[i + 3] << 24)
        ) >>> 0;

        const high = (
        (data[i + 4]      ) |
        (data[i + 5] << 8) |
        (data[i + 6] << 16) |
        (data[i + 7] << 24)
        ) >>> 0;

        // Use Long.js to handle 64-bit unsigned integers
        const longValue = new Long(low, high, true); // true for unsigned
        result.push(longValue);
    }

    return result;
}


export enum ViewModes{
    SceneLit,
    
    OpaqueLit,
    OpaqueGBuffer,
    OpaqueReflections,
    OpaqueReflectionsVisibility,
    OpaqueReflectionsUVs,
    OpaquePointLights,

    TransparentLit,
    TransparentGBuffer,
    TransparentReflections,
    TransparentReflectionsVisibility,
    TransparentReflectionsUVs,
    TransparentPointLights,

    VolumeLit,
    VolumeEnv,
    VolumeGBufferLayer1,
    VolumeGBufferLayer2,
    VolumeRefractions,
    VolumeRefractionsDistanceTravelled,
    VolumeRefractionsVisibility,
    VolumeRefractionsUVs

}

export enum TimeQueries{
    OpaqueSSRUV1Cam_Start,
    OpaqueSSRUV1Cam_End,
    OpaqueSSRUV2Cam_Start,
    OpaqueSSRUV2Cam_End,
    OpaqueGBuffer_Start,
    OpaqueGBuffer_End,
    OpaqueGBufferRear_Start,
    OpaqueGBufferRear_End,
    VolumeRefractionUV_Start,
    VolumeRefractionUV_End,
    OpaquePointLights_Start,
    OpaquePointLights_End,
    OpaquePointLightsRear_Start,
    OpaquePointLightsRear_End,
    BlendFrameBuffersAndDepthPass_Start,
    BlendFrameBuffersAndDepthPass_End


}

function enumLength(e:Object){
    return Object.keys(e).filter(key => isNaN(Number(key))).length;
}

export class Renderer{

    private presentationFormat:GPUTextureFormat = <GPUTextureFormat>'rgba16float';
    private viewMode:ViewModes = ViewModes.SceneLit;
    private device:GPUDevice;
    private scene:GPUScene;
    public  env:GPUEnvironment;
    private context:GPUCanvasContext|undefined;
    private useRearCamera:boolean;
    private rearFovFactor:number;
    public  useDepthPeeling:boolean;
    public useEnvProxy:boolean;
    private useConeTracing:boolean;
    // profiling
    private nQueries:number;
    private querySet:GPUQuerySet;
    private timestampBuffer:GPUBuffer;
    private profilingCallback:(timestamps:Long[]) => void;

    // render passes
    private opaqueGBufferPass:GBufferOpaquePass;
    private volumeGBufferPass1:GBufferVolumePass;
    private volumeGBufferPass2:GBufferVolumePass;
    private volumeGBufferFront:GBufferVolumeFrontPass;
    private volumeGbufferBack:GBufferVolumeBackPass;
    private gbufferTransmissionPass:GBufferTransmissionPass;
    private attenuationDistanceColorPass:AttenuationColorDistanceBufferPass;
    private gbufferViewer:GBufferViewer; // for debug
    private showTextureBChannelPass:ShowUnfilterableTexturePass; // for debug
    private showTextureRGChannelPass:ShowUnfilterableTexturePass; // for debug
    private showDistanceTravelledPass:ShowDistanceTravelledPass; // for debug
    private showUVShaderPass:ShowUVPass; // for debug
    private showVisibilityPass:ShowVisibilityPass; // for debug
    private pointLightPass:PointLightsPass;
    private ssReflectionsUVPass1Cam:SSReflectionsUVPass;
    private ssReflectionsUVPass2Cam:SSReflections2CamsUVPass;
    private ssVolumeUVPass:SSVolumeUVPass;
    private ssTransmissionUVPass:SSTransmissionUVPass;
    private ssr2CamsDrawPassWithEnv:SSR2CamsDrawPassWithEnv;
    private ssxDrawPassWithEnv:SSXDrawPassWithEnv;
    private ssr2CamsDrawPass:SSR2CamsDrawPass;
    private ssxDrawPass:SSXDrawPass;
    private mipmapPass:BlurMips;
    private blendReflectionsPass:BlendReflectionsPass;
    private blendVolumePass:BlendVolumePass;
    private blendVolumePassProxyEnv:BlendVolumeProxyEnvPass;
    private blendTransmissionPass:BlendTransmissionPass;
    private blendFrameBuffersandDepthPass:BlendFrameBuffersAndDepthPass;
    private blendFrameBuffersPass:BlendFrameBuffersPass;
    private blendFrameBuffersAndEnvPass:BlendFrameBuffersAndEnvPass;
    // to render only volume with env map
    private ssVolumeRefractionDirectionPass:SSVolumeRefractionDirectionPass;
    private blendVolumeEnvPass:BlendVolumeEnvPass;

    // textures
    private opaqueGBuffer:GBuffer | undefined;
    private opaqueRearGBuffer:GBuffer | undefined;
    private volumeGBufferLayer1:GBuffer | undefined;
    private volumeGBufferLayer2:GBuffer | undefined;
    private gbufferTransmission:GBuffer|undefined;
    private attenuationColorDistanceBuffer:AttenuationColorDistanceBuffer | undefined;
    // the texture contains the uv coordinate of 
    // reflected color from opaque geometry
    private opaqueReflectionsUV:GPUTexture | undefined;
    private opaqueReflectionsTexture:GPUTexture | undefined;
    // the texture contains uv coordinates of refracted
    // opaque grometry color (in r,g channels), the 
    // visibility (in b channel) and the distance travelled
    // by the ray inside the volume (a channel)
    private volumeRefractionsUV:GPUTexture | undefined;
    private volumeReflectionsUV:GPUTexture | undefined;
    private volumeRefractionsTexture:GPUTexture | undefined;
    private volumeReflectionsTexture:GPUTexture | undefined;
    private transmissionReflectionUVTexture:GPUTexture|undefined;
    private transmissionReflectionTexture:GPUTexture | undefined;
    private opaquePointLightsTexture:GPUTexture | undefined;
    private opaqueRearPointLightsTexture:GPUTexture | undefined;
    private volumePointLightsTexture:GPUTexture | undefined;
    private transmissionPointLightTexture:GPUTexture | undefined;
    // fully shaded opaque geometry, with point lights
    // and screen space reflections
    private opaqueLitTexture:GPUTexture | undefined;
    private volumeLitTexture:GPUTexture | undefined;
    private transmissionLitTexture:GPUTexture | undefined;
    private opaqueVolumeMinDepthTexture:GPUTexture | undefined;
    private opaqueVolumeLitTexture:GPUTexture | undefined;
    // to render only volume and envMap
    private volumeRefractionDirection:GPUTexture | undefined;


    constructor(    device:GPUDevice,
                    camera:PerspectiveCamera,
                    scene:GPUScene,
                    env:GPUEnvironment,
                    pointLights:PointLight[],
                    directionalLights:DirectionalLight[],
                    spotLights:SpotLight[],
                    useRearCamera:boolean=false,
                    rearFovFactor:number=1.0,
                    useDepthPeeling:boolean=false,
                    useEnvProxy:boolean=false,
                    useConeTracing:boolean=false,
                    profilingCallback:(timestamps:Long[]) => void){

            this.device = device;
            this.scene = scene;
            this.env = env;
            this.useRearCamera = useRearCamera;
            this.rearFovFactor = rearFovFactor;
            this.useDepthPeeling = useDepthPeeling;
            this.useEnvProxy = useEnvProxy;
            this.useConeTracing = useConeTracing;

            this.opaqueGBufferPass = new GBufferOpaquePass(device,camera);
            this.volumeGBufferPass1 = new GBufferVolumePass(device,camera);
            this.volumeGBufferPass2 = new GBufferVolumePass(device,camera);
            this.volumeGBufferFront = new GBufferVolumeFrontPass(device,camera);
            this.volumeGbufferBack = new GBufferVolumeBackPass(device,camera);
            this.gbufferTransmissionPass = new GBufferTransmissionPass(device,camera);
            this.attenuationDistanceColorPass = new AttenuationColorDistanceBufferPass(device,camera);
            this.gbufferViewer = new GBufferViewer(device,this.presentationFormat);
            this.showTextureBChannelPass = new ShowUnfilterableTexturePass(device,this.presentationFormat);
            this.showTextureRGChannelPass = new ShowUnfilterableTexturePass(device,this.presentationFormat);
            this.showDistanceTravelledPass = new ShowDistanceTravelledPass(device,this.presentationFormat);
            this.showUVShaderPass = new ShowUVPass(device,this.presentationFormat);
            this.showVisibilityPass = new ShowVisibilityPass(device,this.presentationFormat);
            this.pointLightPass = new PointLightsPass(device,this.presentationFormat,camera,directionalLights,pointLights,spotLights);
            this.ssReflectionsUVPass1Cam = new SSReflectionsUVPass(device,camera);
            this.ssReflectionsUVPass2Cam = new SSReflections2CamsUVPass(device,camera);
            this.ssVolumeUVPass = new SSVolumeUVPass(device,camera);
            this.ssTransmissionUVPass = new SSTransmissionUVPass(device,camera);
            this.ssxDrawPassWithEnv = new SSXDrawPassWithEnv(device,camera,this.presentationFormat);
            this.ssr2CamsDrawPassWithEnv = new SSR2CamsDrawPassWithEnv(device,camera,this.presentationFormat);
            this.ssxDrawPass = new SSXDrawPass(device,this.presentationFormat);
            this.ssr2CamsDrawPass = new SSR2CamsDrawPass(device,this.presentationFormat);
            this.mipmapPass = new BlurMips(device,this.presentationFormat);
            this.blendReflectionsPass = new BlendReflectionsPass(device,this.presentationFormat,this.useConeTracing);
            this.blendVolumePass = new BlendVolumePass(device,this.presentationFormat);
            this.blendVolumePassProxyEnv = new BlendVolumeProxyEnvPass(device,this.presentationFormat);
            this.blendTransmissionPass = new BlendTransmissionPass(device,this.presentationFormat);
            this.blendFrameBuffersPass = new BlendFrameBuffersPass(device,this.presentationFormat);
            this.blendFrameBuffersAndEnvPass = new BlendFrameBuffersAndEnvPass(device,camera,this.presentationFormat);
            this.blendFrameBuffersandDepthPass = new BlendFrameBuffersAndDepthPass(device,this.presentationFormat);
            this.ssVolumeRefractionDirectionPass = new SSVolumeRefractionDirectionPass(device,camera);
            this.blendVolumeEnvPass = new BlendVolumeEnvPass(device,camera,this.presentationFormat);
    
            // profiling
            this.nQueries = enumLength(TimeQueries);
            this.querySet = device.createQuerySet({
                type:<GPUQueryType>'timestamp',
                count:this.nQueries
            });
            this.timestampBuffer = device.createBuffer({
                size: 8 * this.nQueries,
                usage: GPUBufferUsage.QUERY_RESOLVE 
                | GPUBufferUsage.STORAGE
                | GPUBufferUsage.COPY_SRC
                | GPUBufferUsage.COPY_DST,
            });
            this.profilingCallback = profilingCallback;

        }

    public setViewMode(viewMode:ViewModes){
        this.viewMode = viewMode;
    }

    public async initialize(canvas:HTMLCanvasElement){
        if(!this.scene.loaded){
            await this.scene.load();
        }
        if(!this.env.loaded){
            await this.env.load();
        }
        let context = canvas.getContext('webgpu');
        if(context===null){
            throw Error("WebGPU not supported");
        }
        this.context = context;
        let device = this.device;
        this.context.configure({
            device,
            format: this.presentationFormat,
            usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_DST
        });
        let canvasWidth = context.getCurrentTexture().width;
        let canvasHeight = context.getCurrentTexture().height;
        
        // initialize render passes
        await this.opaqueGBufferPass.initializePipeline(this.scene);
        await this.volumeGBufferPass1.initializePipeline(this.scene);
        await this.volumeGBufferPass2.initializePipeline(this.scene);
        await this.volumeGBufferFront.initializePipeline(this.scene);
        await this.volumeGbufferBack.initializePipeline(this.scene);
        await this.gbufferTransmissionPass.initializePipeline(this.scene);
        await this.attenuationDistanceColorPass.initializePipeline(this.scene);
        await this.gbufferViewer.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.showTextureBChannelPass.initializeRenderPipeline(canvasWidth,canvasHeight,false,false,true,false);
        await this.showTextureRGChannelPass.initializeRenderPipeline(canvasWidth,canvasHeight,true,true,false,false);
        await this.showDistanceTravelledPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.showUVShaderPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.showVisibilityPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.pointLightPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssReflectionsUVPass1Cam.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssReflectionsUVPass2Cam.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssVolumeUVPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssTransmissionUVPass.initializeRenderPipeline(canvas.width,canvas.height);
        await this.ssxDrawPassWithEnv.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssr2CamsDrawPassWithEnv.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssxDrawPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.ssr2CamsDrawPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        this.blendReflectionsPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        this.blendVolumePass.initializeRenderPipeline(canvasWidth,canvasHeight);
        this.blendVolumePassProxyEnv.initializeRenderPipeline(canvasWidth,canvasHeight);
        this.blendTransmissionPass.initializeRenderPipeline(canvas.width,canvas.height);
        this.blendFrameBuffersPass.initializeRenderPipeline();
        this.blendFrameBuffersAndEnvPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        this.blendFrameBuffersandDepthPass.initializeRenderPipeline();
        this.mipmapPass.initializeRenderPipeline();
        await this.ssVolumeRefractionDirectionPass.initializeRenderPipeline(canvasWidth,canvasHeight);
        await this.blendVolumeEnvPass.initializeRenderPipeline(canvasWidth,canvasHeight);

        // initialize textures
        this.opaqueGBuffer = new GBuffer(this.device,canvasWidth,canvasHeight);
        this.opaqueRearGBuffer = new GBuffer(this.device,canvas.width,canvas.height);
        this.volumeGBufferLayer1 = new GBuffer(this.device,canvasWidth,canvasHeight);
        this.volumeGBufferLayer2 = new GBuffer(this.device,canvasWidth,canvasHeight);
        this.gbufferTransmission = new GBuffer(this.device,canvas.width,canvas.height);
        this.attenuationColorDistanceBuffer = new AttenuationColorDistanceBuffer(device,canvasWidth,canvasHeight);
        this.opaqueReflectionsUV = device.createTexture({
            size:[canvasWidth,canvasHeight],
            format:SSReflectionsUVPass.targetReflUVFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumeRefractionsUV = device.createTexture({
            size:[canvasWidth,canvasHeight],
            format:SSReflectionsUVPass.targetReflUVFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumeReflectionsUV = device.createTexture({
            size:[canvasWidth,canvasHeight],
            format:SSReflectionsUVPass.targetReflUVFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumeRefractionsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumeReflectionsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.transmissionReflectionUVTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:SSReflectionsUVPass.targetReflUVFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        this.transmissionReflectionTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.COPY_SRC
        });
        this.opaquePointLightsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.opaqueRearPointLightsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumePointLightsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.transmissionPointLightTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_SRC
        });
        this.opaqueReflectionsTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.opaqueLitTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.volumeLitTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
        this.transmissionLitTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |GPUTextureUsage.COPY_SRC
        });
        this.opaqueVolumeMinDepthTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:<GPUTextureFormat>'r32float',   
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |GPUTextureUsage.COPY_SRC    
        });
        this.opaqueVolumeLitTexture = this.device.createTexture({
            size:[canvas.width,canvas.height],
            format:this.presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING |GPUTextureUsage.COPY_SRC
        });
        this.volumeRefractionDirection = device.createTexture({
            size:[canvasWidth,canvasHeight],
            format:SSVolumeRefractionDirectionPass.targetRefractedDirectionFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | GPUTextureUsage.TEXTURE_BINDING
        });
    }

    public render(){
        if( this.context===undefined || 
            this.opaqueGBuffer === undefined ||
            this.opaqueRearGBuffer === undefined ||
            this.volumeGBufferLayer1 === undefined ||
            this.volumeGBufferLayer2 === undefined ||
            this.gbufferTransmission === undefined ||
            this.opaqueReflectionsUV === undefined ||
            this.volumeRefractionsUV === undefined ||
            this.volumeRefractionsTexture === undefined ||
            this.volumeReflectionsTexture === undefined ||
            this.transmissionReflectionUVTexture === undefined ||
            this.transmissionReflectionTexture === undefined ||
            this.opaquePointLightsTexture === undefined ||
            this.opaqueRearPointLightsTexture === undefined ||
            this.opaqueReflectionsTexture === undefined || 
            this.opaqueLitTexture === undefined ||
            this.volumeReflectionsUV === undefined ||
            this.volumePointLightsTexture === undefined ||
            this.transmissionPointLightTexture === undefined ||
            this.attenuationColorDistanceBuffer === undefined ||
            this.volumeLitTexture === undefined || 
            this.transmissionLitTexture=== undefined ||
            this.opaqueVolumeMinDepthTexture===undefined ||
            this.opaqueVolumeLitTexture===undefined ||
            this.volumeRefractionDirection===undefined)
        {
            throw Error("Not initialized");
        }
        let canvasWidth = this.context.getCurrentTexture().width;
        let canvasHeight = this.context.getCurrentTexture().height;
        // Create command encoder
        let encoder = this.device.createCommandEncoder({label:"SSV Render Encoder"});
        // ------------------------
        // Render Opaque Geometry
        // ------------------------
        // create opaque gbuffer pass
        this.opaqueGBufferPass.render(
            encoder,
            this.opaqueGBuffer,
            false,
            1.0,
            this.querySet,
            TimeQueries.OpaqueGBuffer_Start,
            TimeQueries.OpaqueGBuffer_End
        );
        if(this.viewMode === ViewModes.OpaqueGBuffer){
            this.gbufferViewer.render(encoder,this.opaqueGBuffer,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.useRearCamera){
            this.opaqueGBufferPass.render(
                encoder,
                this.opaqueRearGBuffer,
                true,
                this.rearFovFactor,
                this.querySet,
                TimeQueries.OpaqueGBufferRear_Start,
                TimeQueries.OpaqueGBufferRear_End
            );     
        }
        // shade opaque geometry with point lights
        this.pointLightPass.render(
            encoder,
            this.opaquePointLightsTexture,
            this.opaqueGBuffer.baseColorTexture,
            this.opaqueGBuffer.positionTexture,
            this.opaqueGBuffer.normalTexture,
            this.opaqueGBuffer.metallicRoughnessTexture,
            false,
            1.0,
            this.querySet,
            TimeQueries.OpaquePointLights_Start,
            TimeQueries.OpaquePointLights_End
        );
        if(this.viewMode === ViewModes.OpaquePointLights){
            encoder.copyTextureToTexture(
                {texture:this.opaquePointLightsTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.useRearCamera){
            this.pointLightPass.render(
                encoder,
                this.opaqueRearPointLightsTexture,
                this.opaqueRearGBuffer.baseColorTexture,
                this.opaqueRearGBuffer.positionTexture,
                this.opaqueRearGBuffer.normalTexture,
                this.opaqueRearGBuffer.metallicRoughnessTexture,
                true,
                this.rearFovFactor,
                this.querySet,
                TimeQueries.OpaquePointLightsRear_Start,
                TimeQueries.OpaquePointLightsRear_End
            );  
        }
        // create reflections uv for opaque object
        if(!this.useRearCamera){
            this.ssReflectionsUVPass1Cam.render(
                encoder,
                this.opaqueGBuffer.positionTexture,
                this.opaqueGBuffer.normalTexture,
                this.opaqueReflectionsUV,
                this.querySet,
                TimeQueries.OpaqueSSRUV1Cam_Start,
                TimeQueries.OpaqueSSRUV1Cam_End
            );
        }
        else{
            this.ssReflectionsUVPass2Cam.render(
                encoder,
                this.opaqueGBuffer.positionTexture,
                this.opaqueGBuffer.normalTexture,
                this.opaqueRearGBuffer.positionTexture,
                this.opaqueRearGBuffer.normalTexture,
                this.opaqueReflectionsUV,
                this.rearFovFactor,
                this.querySet,
                TimeQueries.OpaqueSSRUV2Cam_Start,
                TimeQueries.OpaqueSSRUV2Cam_End
            );
        }
        if(this.viewMode === ViewModes.OpaqueReflectionsVisibility){
            this.showVisibilityPass.render(encoder,this.opaqueReflectionsUV,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.viewMode === ViewModes.OpaqueReflectionsUVs){
            this.showUVShaderPass.render(encoder,this.opaqueReflectionsUV,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // draw reflections using the uv found in 
        // this.ssReflectionsUVPass to index the
        // opaque framebuffer
        if(!this.useRearCamera){
            if(this.useEnvProxy){
                this.ssxDrawPassWithEnv.render(
                    encoder,
                    this.opaqueReflectionsUV,
                    this.opaquePointLightsTexture,
                    this.env.texture!,
                    this.opaqueReflectionsTexture,
                );
            }
            else{
                this.ssxDrawPass.render(
                    encoder,
                    this.opaqueReflectionsUV,
                    this.opaquePointLightsTexture,
                    this.opaqueReflectionsTexture,
                );  
            }

        }
        else{
            if(this.useEnvProxy){
                this.ssr2CamsDrawPassWithEnv.render(
                    encoder,
                    this.opaqueReflectionsUV,
                    this.opaquePointLightsTexture,
                    this.opaqueRearPointLightsTexture,
                    this.env.texture!,
                    this.opaqueReflectionsTexture
                );
            }
            else{
                this.ssr2CamsDrawPass.render(
                    encoder,
                    this.opaqueReflectionsUV,
                    this.opaquePointLightsTexture,
                    this.opaqueRearPointLightsTexture,
                    this.opaqueReflectionsTexture
                );    
            }

        }
        if(this.viewMode === ViewModes.OpaqueReflections){
            encoder.copyTextureToTexture(
                {texture:this.opaqueReflectionsTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // blur the reflections, such that they
        // can be used for different roughness levels
        let mipMappedOpaqueReflectionsTexture = this.mipmapPass.render(
            encoder,
            this.opaqueReflectionsTexture
        );
        // shade the opaque geometry with PBR using
        // mipmapped reflections texture
        this.blendReflectionsPass.render(
            encoder,
            this.opaqueLitTexture,
            mipMappedOpaqueReflectionsTexture,
            this.opaqueGBuffer.metallicRoughnessTexture,
            this.opaqueGBuffer.baseColorTexture,
            this.opaquePointLightsTexture,
            this.opaqueGBuffer.positionTexture,
            this.opaqueGBuffer.normalTexture,
            this.opaqueReflectionsUV
        );
        if(this.viewMode === ViewModes.OpaqueLit){
            encoder.copyTextureToTexture(
                {texture:this.opaqueLitTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;  
        }
        // ------------------------
        // Render Volume Geometry
        // ------------------------
        // create first layer gbuffer of volume
        // geometry
        if(this.useDepthPeeling){
            this.volumeGBufferPass1.render(
                encoder,
                this.opaqueGBuffer.depthStencilTexture,
                this.opaqueGBuffer.depthStencilTexture,
                this.volumeGBufferLayer1,
                0.0
            );
        }
        else{
            this.volumeGBufferFront.render(
                encoder,
                this.volumeGBufferLayer1
            );
        }
        if(this.viewMode===ViewModes.VolumeGBufferLayer1){
            this.gbufferViewer.render(encoder,this.volumeGBufferLayer1,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;  
        }
        // shade opaque geometry with point lights
        this.pointLightPass.render(
            encoder,
            this.volumePointLightsTexture,
            this.volumeGBufferLayer1.baseColorTexture,
            this.volumeGBufferLayer1.positionTexture,
            this.volumeGBufferLayer1.normalTexture,
            this.volumeGBufferLayer1.metallicRoughnessTexture
        );
        // create second layer gbuffer of volume
        // geometry
        if(this.useDepthPeeling){
            this.volumeGBufferPass2.render(
                encoder,
                this.volumeGBufferLayer1.depthStencilTexture,
                this.opaqueGBuffer.depthStencilTexture,
                this.volumeGBufferLayer2
            );
        }
        else{
            this.volumeGbufferBack.render(
                encoder,
                this.volumeGBufferLayer2
            );
        }
        if(this.viewMode===ViewModes.VolumeGBufferLayer2){
            this.gbufferViewer.render(encoder,this.volumeGBufferLayer2,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;  
        }
        if(this.viewMode===ViewModes.VolumeEnv){
            this.ssVolumeRefractionDirectionPass.render(
                encoder,
                this.volumeGBufferLayer1.positionTexture,
                this.volumeGBufferLayer1.normalTexture,
                this.volumeGBufferLayer2.positionTexture,
                this.volumeGBufferLayer2.normalTexture,
                this.volumeRefractionDirection
            );
            this.blendVolumeEnvPass.render(
                encoder,
                this.context.getCurrentTexture(),
                this.volumeRefractionDirection,
                this.env.texture!
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // use another pass to write attenuation color
        // and distance for each visible fragment of the 
        // volume object, this could be done in volumeGBufferPass
        // but the available memory for render attachment was finished
        this.attenuationDistanceColorPass.render(
            encoder,
            this.opaqueGBuffer.depthStencilTexture,
            this.attenuationColorDistanceBuffer
        );
        // create refraction uv for volume object
        this.ssVolumeUVPass.render(
            encoder,
            this.volumeGBufferLayer1.positionTexture,
            this.volumeGBufferLayer1.normalTexture,
            this.volumeGBufferLayer2.positionTexture,
            this.volumeGBufferLayer2.normalTexture,
            this.opaqueGBuffer.positionTexture,
            this.volumeRefractionsUV,
            this.querySet,
            TimeQueries.VolumeRefractionUV_Start,
            TimeQueries.VolumeRefractionUV_End
        );
        if(this.viewMode===ViewModes.VolumeRefractionsDistanceTravelled){
            this.showDistanceTravelledPass.render(
                encoder,
                this.volumeRefractionsUV,
                this.context.getCurrentTexture()
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.viewMode === ViewModes.VolumeRefractionsVisibility){
            this.showVisibilityPass.render(encoder,this.volumeRefractionsUV,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.viewMode === ViewModes.VolumeRefractionsUVs){
            this.showUVShaderPass.render(encoder,this.volumeRefractionsUV,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // draw volume refractions using the uv found
        // with ssVolumeUVPass to index the opaque
        // framebuffer
        if(this.useEnvProxy){
            this.ssxDrawPassWithEnv.render(
                encoder,
                this.volumeRefractionsUV,
                this.opaqueLitTexture,
                this.env.texture!,
                this.volumeRefractionsTexture,
            );
        }
        else{
            this.ssxDrawPass.render(
                encoder,
                this.volumeRefractionsUV,
                this.opaqueLitTexture,
                this.volumeRefractionsTexture,
            );  
        }

        if(this.viewMode===ViewModes.VolumeRefractions){
            encoder.copyTextureToTexture(
                {texture:this.volumeRefractionsTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;  
        }
        let mipmappedVolumeRefractionsTexture = this.mipmapPass.render(
            encoder,
            this.volumeRefractionsTexture
        );
        // create reflection uv for volume object
        this.ssReflectionsUVPass1Cam.render(
            encoder,
            this.volumeGBufferLayer1.positionTexture,
            this.volumeGBufferLayer1.normalTexture,
            this.volumeReflectionsUV
        );
        // draw volume trfractions using the uv found
        // with ssReflectionsUVPass1Cam to index the 
        // opaque framebuffer
        if(this.useEnvProxy){
            this.ssxDrawPassWithEnv.render(
                encoder,
                this.volumeReflectionsUV,
                this.opaqueLitTexture,
                this.env.texture!,
                this.volumeReflectionsTexture,
            );
        }
        else{
            this.ssxDrawPass.render(
                encoder,
                this.volumeReflectionsUV,
                this.opaqueLitTexture,
                this.volumeReflectionsTexture,
            );  
        }

        let mipmappedVolumeReflectionsTexture = this.mipmapPass.render(
            encoder,
            this.volumeReflectionsTexture
        );
        let mipMappedOpaqueLit = this.mipmapPass.render(
            encoder,
            this.opaqueLitTexture
        );
        if(!this.useEnvProxy){
            this.blendVolumePass.render(
                encoder,
                this.volumeLitTexture,
                mipmappedVolumeReflectionsTexture,
                mipmappedVolumeRefractionsTexture,
                this.volumeGBufferLayer1.metallicRoughnessTexture,
                this.volumeGBufferLayer1.baseColorTexture,
                this.volumePointLightsTexture,
                this.volumeGBufferLayer1.positionTexture,
                this.volumeGBufferLayer1.normalTexture,
                this.attenuationColorDistanceBuffer.attenuationColorDistanceTexture,
                this.volumeRefractionsUV,
                mipMappedOpaqueLit
            );
        }
        else{
            this.blendVolumePassProxyEnv.render(
                encoder,
                this.volumeLitTexture,
                mipmappedVolumeReflectionsTexture,
                mipmappedVolumeRefractionsTexture,
                this.volumeGBufferLayer1.metallicRoughnessTexture,
                this.volumeGBufferLayer1.baseColorTexture,
                this.volumePointLightsTexture,
                this.volumeGBufferLayer1.positionTexture,
                this.volumeGBufferLayer1.normalTexture,
                this.attenuationColorDistanceBuffer.attenuationColorDistanceTexture,
                this.volumeRefractionsUV,
                mipMappedOpaqueLit
            );
        }
        if(this.viewMode===ViewModes.VolumeLit){
            encoder.copyTextureToTexture(
                {texture:this.volumeLitTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;        
        }
        // ------------------------
        // Render Transmissive Geometry
        // ------------------------
        // compute the gBuffer for 
        // transmissive geometry
        this.gbufferTransmissionPass.render(
            encoder,
            this.opaqueGBuffer.depthStencilTexture,
            this.gbufferTransmission
        );
        if(this.viewMode === ViewModes.TransparentGBuffer){
            this.gbufferViewer.render(encoder,this.gbufferTransmission,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // compute point lights shading for
        // transmissive geometry
        this.pointLightPass.render(
            encoder,
            this.transmissionPointLightTexture,
            this.gbufferTransmission.baseColorTexture,
            this.gbufferTransmission.positionTexture,
            this.gbufferTransmission.normalTexture,
            this.gbufferTransmission.metallicRoughnessTexture
        );
        if(this.viewMode === ViewModes.TransparentPointLights){
            encoder.copyTextureToTexture(
                {texture:this.transmissionPointLightTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // compute reflected uv for
        // transmissive geometry
        this.ssTransmissionUVPass.render(
            encoder,
            this.gbufferTransmission.positionTexture,
            this.gbufferTransmission.normalTexture,
            this.opaqueGBuffer.positionTexture,
            this.transmissionReflectionUVTexture
        );
        if(this.viewMode === ViewModes.TransparentReflectionsVisibility){
            this.showVisibilityPass.render(encoder,this.transmissionReflectionUVTexture,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        if(this.viewMode === ViewModes.TransparentReflectionsUVs){
            this.showUVShaderPass.render(encoder,this.transmissionReflectionUVTexture,this.context.getCurrentTexture());
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        // compute reflected color for
        // transmissive geometry
        if(this.useEnvProxy){
            this.ssxDrawPassWithEnv.render(
                encoder,
                this.transmissionReflectionUVTexture,
                this.opaqueLitTexture,
                this.env.texture!,
                this.transmissionReflectionTexture,
            );
        }
        else{
            this.ssxDrawPass.render(
                encoder,
                this.transmissionReflectionUVTexture,
                this.opaqueLitTexture,
                this.transmissionReflectionTexture,
            );      
        }

        if(this.viewMode === ViewModes.TransparentReflections){
            encoder.copyTextureToTexture(
                {texture:this.transmissionReflectionTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;
        }
        let mipMappedTransmissionReflections = this.mipmapPass.render(
            encoder,
            this.transmissionReflectionTexture
        );
        // compute mipmapped transmitted color 
        let mipMappedTransmissions = this.mipmapPass.render(
            encoder,
            this.opaqueLitTexture,
        );
        // compute final color of thin transparent geometry
        this.blendTransmissionPass.render(
            encoder,
            this.transmissionLitTexture,
            mipMappedTransmissionReflections,
            mipMappedTransmissions,
            this.gbufferTransmission.metallicRoughnessTexture,
            this.gbufferTransmission.baseColorTexture,
            this.transmissionPointLightTexture,
            this.gbufferTransmission.positionTexture,
            this.gbufferTransmission.normalTexture
        );
        if(this.viewMode === ViewModes.TransparentLit){
            encoder.copyTextureToTexture(
                {texture:this.transmissionLitTexture},
                {texture:this.context.getCurrentTexture()},
                [canvasWidth,canvasHeight]
            );
            this.device.queue.submit([encoder.finish()]);
            return;  
        }
        // ------------------------
        // Blend Results
        // ------------------------
        this.blendFrameBuffersandDepthPass.render(
            encoder,
            this.opaqueVolumeLitTexture,
            this.opaqueVolumeMinDepthTexture,
            this.opaqueLitTexture,
            this.volumeLitTexture,
            this.opaqueGBuffer.depthStencilTexture,
            this.volumeGBufferLayer1.depthStencilTexture,
            this.querySet,
            TimeQueries.BlendFrameBuffersAndDepthPass_Start,
            TimeQueries.BlendFrameBuffersAndDepthPass_End
        );
        if(!this.useEnvProxy){
            this.blendFrameBuffersPass.render(
                encoder,
                this.context.getCurrentTexture(),
                this.opaqueVolumeLitTexture,
                this.transmissionLitTexture,
                this.opaqueVolumeMinDepthTexture,
                this.gbufferTransmission.depthStencilTexture
            );        
        }
        else{
            this.blendFrameBuffersAndEnvPass.render(
                encoder,
                this.context.getCurrentTexture(),
                this.opaqueVolumeLitTexture,
                this.transmissionLitTexture,
                this.opaqueVolumeMinDepthTexture,
                this.gbufferTransmission.depthStencilTexture,
                this.env.texture!
            );
        }

        /*
        this.blendFrameBuffersPass.render(
            encoder,
            this.context.getCurrentTexture(),
            this.opaqueLitTexture,
            this.transmissionLitTexture,//this.volumeLitTexture,
            this.opaqueGBuffer.depthStencilTexture,
            this.gbufferTransmission.depthStencilTexture//this.volumeGBufferLayer1.depthStencilTexture
        );
        */
        // ------------------------
        // Debug Code
        // ------------------------
        //this.showTexturePass.render(encoder,this.volumeLitTexture,this.context.getCurrentTexture());
        //this.gbufferViewer.render(encoder,this.opaqueGBuffer,this.context.getCurrentTexture());
        
        //let canvasWidth = this.context.getCurrentTexture().width;
        //let canvasHeight = this.context.getCurrentTexture().height;
        //encoder.copyTextureToTexture(
        //    {texture:this.opaqueVolumeLitTexture},
        //    {texture:this.context.getCurrentTexture()},
        //    [canvasWidth,canvasHeight]
        //);
        
        // profiling
        encoder.resolveQuerySet(
            this.querySet,
            0,
            this.nQueries,
            this.timestampBuffer,
            0
        );
        // Send Commands to GPU
        this.device.queue.submit([encoder.finish()]);

        // cleanup
        mipMappedOpaqueLit.destroy();
        mipMappedOpaqueReflectionsTexture.destroy();
        mipMappedTransmissions.destroy();
        mipMappedTransmissionReflections.destroy();
        mipmappedVolumeReflectionsTexture.destroy();
        mipmappedVolumeRefractionsTexture.destroy();

        // profiling
        const timestampReadBuffer = this.device.createBuffer({
            size:this.timestampBuffer.size,
            usage:GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ
        });
        const copyEncoder = this.device.createCommandEncoder();
        copyEncoder.copyBufferToBuffer(this.timestampBuffer,0,timestampReadBuffer,0,this.timestampBuffer.size);
        const copyCommands = copyEncoder.finish();
        this.device.queue.submit([copyCommands]);
        timestampReadBuffer.mapAsync(GPUMapMode.READ).then(() =>{
            let timestampArrayUint8 = new Uint8Array(timestampReadBuffer.getMappedRange());
            let timestampArray = uint8ArrayToUint64Array(timestampArrayUint8);
            this.profilingCallback(timestampArray);
        }).catch(()=>{
            console.log("Profiling: map async failed");
        });
    }

    public destroy(){
        this.opaqueGBuffer?.destroy();
        this.opaqueRearGBuffer?.destroy();
        this.gbufferTransmission?.destroy();
        this.volumeGBufferLayer1?.destroy();
        this.volumeGBufferLayer2?.destroy();
        this.attenuationColorDistanceBuffer?.destroy();
        this.opaqueReflectionsUV?.destroy();
        this.opaqueReflectionsTexture?.destroy();
        this.volumeRefractionsUV?.destroy();
        this.volumeReflectionsUV?.destroy();
        this.volumeRefractionsTexture?.destroy();
        this.volumeReflectionsTexture?.destroy();
        this.transmissionReflectionUVTexture?.destroy();
        this.transmissionReflectionTexture?.destroy();
        this.opaquePointLightsTexture?.destroy();
        this.opaqueRearPointLightsTexture?.destroy();
        this.volumePointLightsTexture?.destroy();
        this.transmissionPointLightTexture?.destroy();
        this.opaqueLitTexture?.destroy();
        this.volumeLitTexture?.destroy();
        this.transmissionLitTexture?.destroy();
        this.opaqueVolumeMinDepthTexture?.destroy();
        this.opaqueVolumeLitTexture?.destroy();
        this.volumeRefractionDirection?.destroy();
    }

}