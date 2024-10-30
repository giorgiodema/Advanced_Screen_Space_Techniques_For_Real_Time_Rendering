import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import {GBufferViewer, GBufferOpaquePass, GBuffer } from "../passes/GBuffer";
import { GPUScene } from "../utils/glTFLoader";
import {PerspectiveCamera, OrbitCameraController, FirstPersonCameraController} from "../utils/camera"

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
        let scene:GPUScene = new GPUScene("/glTF/SponzaStatue/glTF","SponzaStatue.gltf",device);
        let cameraController = new FirstPersonCameraController(camera,canvas);
        let gBufferPass = new GBufferOpaquePass(device,camera);
        let gbufferViewer = new GBufferViewer(device,presentationFormat);

        let gbuffer = new GBuffer(device,canvas.width,canvas.height);

        let renderLoop = () => {
            let encoder = device.createCommandEncoder({label:"Env Renderer Encoder"});
            gBufferPass.render(
                encoder,
                gbuffer,
            );
            gbufferViewer.render(   encoder,
                                    gbuffer,
                                    context.getCurrentTexture()
            );
            device.queue.submit([encoder.finish()]);
            requestAnimationFrame(renderLoop);
        }
        gBufferPass.initializePipeline(scene).then(
            () => {gbufferViewer.initializeRenderPipeline(canvas.width,canvas.height).then(
                () => {renderLoop()})});

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
            gbufferViewer.initializeRenderPipeline(canvas.width,canvas.height);
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

