import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import { GPUEnvironment } from "../utils/envLoader";
import { CubeMapPass } from "../passes/CubeMap";
import { BlurMips } from "../passes/BlurMips";
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
        let cameraController = new OrbitCameraController(camera,canvas);
        let env:GPUEnvironment = new GPUEnvironment("/environments/forest_4k",device);
        await env.load();
        let mipsEncoder = device.createCommandEncoder();
        let blurMips = new BlurMips(device,env.texture!.format);
        blurMips.initializeRenderPipeline();
        let filtered = blurMips.render(mipsEncoder,env.texture!);
        device.queue.submit([mipsEncoder.finish()]);
        let renderer = new CubeMapPass(
            device,
            camera,
            presentationFormat,
            filtered,
            0
        );

        let renderLoop = () => {
            let encoder = device.createCommandEncoder({label:"Env Renderer Encoder"});
            renderer.render(context.getCurrentTexture(),encoder);
            device.queue.submit([encoder.finish()]);
            requestAnimationFrame(renderLoop);
        }
        renderer.initializeRenderPipeline().then(()=>{renderLoop()});

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
            renderer.initializeRenderPipeline();
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

