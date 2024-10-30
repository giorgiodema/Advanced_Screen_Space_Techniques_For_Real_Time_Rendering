import { initializeWebGPU, resizeCanvas } from "../utils/webGPUUtils";
import {GBufferViewer, GBufferOpaquePass } from "../passes/GBuffer";
import { GPUScene } from "../utils/glTFLoader";
import {PerspectiveCamera, OrbitCameraController, FirstPersonCameraController} from "../utils/camera"
import { DirectionalLight, PointLight, PointLightsPass, SpotLight } from "../passes/PointLights";
import { SSRRenderer } from "../renderers/SSRRenderer";
import { normalizeVector } from "../utils/vectors";
import { SSTRenderer } from "../renderers/SSTRenderer";
import { SSVRenderer } from "../renderers/SSVRenderer";
import { Renderer } from "../renderers/Renderer";
import { GPUEnvironment } from "../utils/envLoader";

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
            new Float32Array([0.0,1.0,-1.0]),
            new Float32Array([0.0,0.0,0.0]),
            45.0,
            0.01,
            100.0,
            canvas.width / canvas.height
        );
        //let scene:GPUScene = new GPUScene("/glTF/LucyMetal","LucyMetal.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyMetalR3","LucyMetalR3.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyDielectric","LucyDielectric.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyDielectricR3","LucyDielectricR3.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyTransparent","LucyTransparent.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyTransparentR3","LucyTransparentR3.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyVolume","LucyVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/LucyVolumeR3","LucyVolumeR3.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/DragonAttenuation/glTF","DragonAttenuation.gltf",device);
        let scene:GPUScene = new GPUScene("/glTF/ArmadilloVolume","ArmadilloVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/HappyVolume","HappyVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/BimbaVolume","BimbaVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/DragonVolume","DragonVolume.gltf",device);
        
        //let scene:GPUScene = new GPUScene("/glTF/SponzaStatues","SponzaStatues.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/NefertitiVolume","NefertitiVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/SuzanneVolume","SuzanneVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/BallVolume","BallVolume.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/PointLights/glTF","PointLights.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/SponzaStatues/glTF","SponzaStatues.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/DragonAttenuation/glTF","DragonAttenuation.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/SponzaTransparentStatue/glTF","SponzaTransparentStatue.gltf",device);
        //let scene:GPUScene = new GPUScene("/glTF/SponzaTransparentVolumeStatue/glTF","SponzaTransparentVolumeStatue.gltf",device);
        await scene.load();
        let env:GPUEnvironment = new GPUEnvironment("/environments/forest_4k",device);
        let profilingCallback = (timestamps:Object) => {console.log(timestamps)};
        
        let cameraController = new FirstPersonCameraController(camera,canvas);
        let ssrRenderer = new Renderer(
            device,
            camera,
            scene,
            env,
            scene.pointLights,
            scene.directionalLights,
            scene.spotLights,
            true,
            2.0,
            false,
            false,
            false,
            profilingCallback
        );


        let renderLoop = () => {
            ssrRenderer.render();
            requestAnimationFrame(renderLoop);
        }
        ssrRenderer.initialize(canvas).then(()=>renderLoop());


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
            ssrRenderer.initialize(canvas).then(()=>renderLoop());
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

