import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import {GBuffer, GBufferOpaquePass } from "../passes/GBuffer";
import {    DirectionalLight,
            PointLightsPass,
            DirectionalLightController,
            PointLight,
            PointLightController,
             } from "../passes/PointLights";
import { GPUScene } from "../utils/glTFLoader";
import {PerspectiveCamera, OrbitCameraController, FirstPersonCameraController} from "../utils/camera"
import { normalizeVector } from "../utils/vectors";

let animationFrameId = 0;
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
        let scene:GPUScene = new GPUScene("/glTF/SponzaHelmet/glTF","SponzaHelmet.gltf",device);
        let cameraController = new OrbitCameraController(camera,canvas);
        let gBufferPass = new GBufferOpaquePass(device,camera);
        let d1 = new DirectionalLight(  1.0,                               // intensity
                                        new Float32Array([1.0,1.0,1.0]),   // color
                                        new Float32Array([0.0,1.0,0.0]),   // direction
                                        false                              // cast shadow
                                    );
        let p1 = new PointLight(  
            10.0,                               // intensity
            new Float32Array([1.0,1.0,1.0]),   // color
            new Float32Array([0.0,1.0,0.0]),   // position
            false                              // cast shadow
        );
        let d1Controller = new DirectionalLightController(d1,canvas);
        let p1Controller = new PointLightController(p1,canvas);
        let dirLights = [
            d1
        ];
        let pointLights = [
            p1
        ]
        let renderer = new PointLightsPass(
            device,
            presentationFormat,
            camera,
            [],//dirLights,
            pointLights,
            [],
        );

        let gbuffer = new GBuffer(device,canvas.width,canvas.height);

        let renderLoop = () => {
            let encoder = device.createCommandEncoder({label:"Env Renderer Encoder"});
            gBufferPass.render(
                encoder,
                gbuffer
            );
            renderer.render(
                encoder,
                context.getCurrentTexture(),
                gbuffer.baseColorTexture,
                gbuffer.positionTexture,
                gbuffer.normalTexture,gbuffer.metallicRoughnessTexture,
            )
            device.queue.submit([encoder.finish()]);
            requestAnimationFrame(renderLoop);
        }
        gBufferPass.initializePipeline(scene).then(
            () => {
                renderer.initializeRenderPipeline(canvas.width,canvas.height);
                renderLoop();
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
            renderer.initializeRenderPipeline(canvas.width,canvas.height);
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

