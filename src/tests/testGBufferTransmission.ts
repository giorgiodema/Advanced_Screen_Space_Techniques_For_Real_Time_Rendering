import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import {GBufferViewer, GBufferOpaquePass, GBuffer, GBufferTransmissionPass, GBufferTransmissionViewer } from "../passes/GBuffer";
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
        let scene:GPUScene = new GPUScene("/glTF/SponzaTransparentStatue/glTF","SponzaTransparentStatue.gltf",device);
        let cameraController = new OrbitCameraController(camera,canvas);
        let gBufferPass = new GBufferOpaquePass(device,camera);
        let transmissiongBufferPass = new GBufferTransmissionPass(device,camera);
        let gbufferViewer = new GBufferTransmissionViewer(device,canvas);

        let gbuffer = new GBuffer(device,canvas.width,canvas.height);
        let transmissionGBuffer = new GBuffer(device,canvas.width,canvas.height);

        let renderLoop = () => {
            let encoder = device.createCommandEncoder({label:"Env Renderer Encoder"});
            gBufferPass.render(
                encoder,
                gbuffer
            );
            transmissiongBufferPass.render(
                encoder,
                gbuffer.depthStencilTexture,
                transmissionGBuffer
            );
            gbufferViewer.render(   encoder,
                                    transmissionGBuffer
            );
            device.queue.submit([encoder.finish()]);
            requestAnimationFrame(renderLoop);
        }
        gBufferPass.initializePipeline(scene).then(
            () =>{transmissiongBufferPass.initializePipeline(scene).then(
                () => {gbufferViewer.initializeRenderPipeline().then(
                    () => {renderLoop();}
                )}
            )}
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
            transmissionGBuffer = new GBuffer(device,canvas.width,canvas.height);
            transmissiongBufferPass = new GBufferTransmissionPass(device,camera);
            gBufferPass = new GBufferOpaquePass(device,camera);
            gBufferPass.initializePipeline(scene).then(
                () =>{transmissiongBufferPass.initializePipeline(scene).then(
                    () => {gbufferViewer.initializeRenderPipeline().then(
                        () => {renderLoop();}
                    )}
                )}
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

