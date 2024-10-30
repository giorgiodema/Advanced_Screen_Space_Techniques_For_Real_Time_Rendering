import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import {GBufferViewer, GBufferOpaquePass, GBuffer } from "../passes/GBuffer";
import { GPUScene } from "../utils/glTFLoader";
import {PerspectiveCamera, OrbitCameraController, FirstPersonCameraController} from "../utils/camera"
import { DirectionalLight, PointLight, PointLightsPass } from "../passes/PointLights";
import { SSReflectionsUVPass, SSXDrawPass } from "../passes/SSReflections";
import { normalizeVector } from "../utils/vectors";

async function initializeAndRender(){
    try{
        resizeCanvas("glCanvas");
        let device = await initializeWebGPU();
        let canvas = <HTMLCanvasElement>document.getElementById("glCanvas");
        let context = canvas.getContext('webgpu');
        if(context===null){
            throw Error("Cannot initialize context");
        }
        const presentationFormat = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format: presentationFormat,
        });
        let camera = new PerspectiveCamera(
            new Float32Array([0.0,0.0,-1.0]),
            new Float32Array([0.0,0.0,0.0]),
            45.0,
            0.01,
            100.0,
            canvas.width / canvas.height
        );
        let scene:GPUScene = new GPUScene("/glTF/SponzaMirrors/glTF","SponzaMirrors.gltf",device);
        let cameraController = new OrbitCameraController(camera,canvas);
        let gbuffer = new GBuffer(device,canvas.width,canvas.height);
        let gBufferRenderer = new GBufferOpaquePass(device,camera);
        let pLightsRenderer = new PointLightsPass(
            device,
            presentationFormat,
            camera,
            [
                new DirectionalLight(1.0,new Float32Array([1.0,1.0,1.0]),normalizeVector(new Float32Array([0.0,1.0,1.0])),false),
                new DirectionalLight(1.0,new Float32Array([1.0,1.0,1.0]),normalizeVector(new Float32Array([1.0,1.0,0.0])),false),
                new DirectionalLight(1.0,new Float32Array([1.0,1.0,1.0]),normalizeVector(new Float32Array([0.0,1.0,-1.0])),false),
                new DirectionalLight(1.0,new Float32Array([1.0,1.0,1.0]),normalizeVector(new Float32Array([-1.0,1.0,0.0])),false),
            ],
            [
                new PointLight(10.0,new Float32Array([1.0,1.0,1.0]),new Float32Array([0.0,1.0,0.0]), false),
                new PointLight(10.0,new Float32Array([1.0,1.0,1.0]),new Float32Array([3.0,1.0,0.0]), false),
                new PointLight(10.0,new Float32Array([1.0,1.0,1.0]),new Float32Array([-3.0,1.0,0.0]), false),
                new PointLight(10.0,new Float32Array([1.0,1.0,1.0]),new Float32Array([6.0,1.0,0.0]), false),
                new PointLight(10.0,new Float32Array([1.0,1.0,1.0]),new Float32Array([-6.0,1.0,0.0]), false)
            ],
            [],
        );
        let ssrRenderer = new SSReflectionsUVPass(
            device,
            camera
        );
        let ssrDrawRenderer = new SSXDrawPass(
            device,
            presentationFormat
        );

        let ReflectionSourceTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:presentationFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });
        let ReflectionUVTexture = device.createTexture({
            size:[canvas.width,canvas.height],
            format:SSReflectionsUVPass.targetReflUVFormat,
            usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
        });

        let renderLoop = () => {
            let encoder = device.createCommandEncoder({label:"Env Renderer Encoder"});
            gBufferRenderer.render(
                encoder,
                gbuffer
            );
            pLightsRenderer.render(
                encoder,
                ReflectionSourceTexture,
                gbuffer.baseColorTexture,
                gbuffer.positionTexture,
                gbuffer.normalTexture,
                gbuffer.metallicRoughnessTexture,
            );
            ssrRenderer.render(
                encoder,
                gbuffer.positionTexture,
                gbuffer.normalTexture,
                ReflectionUVTexture,
            );
            ssrDrawRenderer.render(
                encoder,
                ReflectionUVTexture,
                ReflectionSourceTexture,
                context.getCurrentTexture()
            );
            device.queue.submit([encoder.finish()]);
            requestAnimationFrame(renderLoop);
        }
        gBufferRenderer.initializePipeline(scene).then(
            () => {
                pLightsRenderer.initializeRenderPipeline(canvas.width,canvas.height);
                ssrRenderer.initializeRenderPipeline(canvas.width,canvas.height).then(()=>{
                    ssrDrawRenderer.initializeRenderPipeline(canvas.width,canvas.height).then(() =>{
                        renderLoop();
                    });
                });
            }
        );

        window.addEventListener('resize', async () =>{
            console.log("Resized");
            const container = <HTMLElement>document.querySelector('.main-container');
            const width = container.clientWidth;
            const height = container.clientHeight;
            canvas.width = width;
            canvas.height = height;
            canvas.style.width = width + 'px';
            canvas.style.height = height + 'px';
            resizeCanvas("glCanvas");
            camera.aspectRatio = canvas.width/canvas.height;
            gbuffer = new GBuffer(device,canvas.width,canvas.height);
            ReflectionSourceTexture = device.createTexture({
                size:[canvas.width,canvas.height],
                format:presentationFormat,
                usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            });
            ReflectionUVTexture = device.createTexture({
                size:[canvas.width,canvas.height],
                format:SSReflectionsUVPass.targetReflUVFormat,
                usage:GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING
            });
            gBufferRenderer.initializePipeline(scene).then(
                () => {
                    pLightsRenderer.initializeRenderPipeline(canvas.width,canvas.height);
                    ssrRenderer.initializeRenderPipeline(canvas.width,canvas.height).then(()=>{
                        ssrDrawRenderer.initializeRenderPipeline(canvas.width,canvas.height).then(() =>{
                        });
                    });
                }
            );
        });
        }
        catch(error)
        {
            console.log(error);
            // WebGPU is not supported
            // Clear all child elements of the body
            document.body.innerHTML = '';
            // Create and append a new header element
            const header = document.createElement('h1');
            header.textContent = 'WebGPU not supported';
            document.body.appendChild(header);
            return;
        }
}

document.addEventListener('DOMContentLoaded', async () => {
    initializeAndRender();
});

