import { initializeWebGPU, resizeCanvas } from "./utils/webGPUUtils";
import { GPUScene } from "./utils/glTFLoader";
import {PerspectiveCamera, FirstPersonCameraController} from "./utils/camera"
import { Renderer, TimeQueries, ViewModes } from "./renderers/Renderer";
import models from "./data/models.json";
import { GPUEnvironment } from "./utils/envLoader";
import Long from 'long';


async function initializeAndRender(){
    try{
        resizeCanvas("glCanvas");
        let device = await initializeWebGPU();
        let canvas = <HTMLCanvasElement>document.getElementById("glCanvas");
        let context = canvas.getContext('webgpu');
        if(context===null){
            throw Error("Cannot initialize context");
        }

        // read models data from json file and update HTML
        let modelsList = <HTMLUListElement>document.getElementById("ModelsList")!;
        console.log(models);
        let sceneFolder = models[0].sceneFolder;
        let sceneFile = models[0].sceneFile;
        let scene = new GPUScene(sceneFolder,sceneFile,device);
        let env:GPUEnvironment = new GPUEnvironment("/environments/forest_4k",device);

        // settings controller
        let settingsButton = <HTMLButtonElement>document.getElementById("SettingsButton")!;
        let settingsPanel  = <HTMLElement>document.getElementById("SettingsPanel")!;
        let closeSettingsButton = <HTMLButtonElement>document.getElementById("CloseSettingsButton")!;
        settingsButton.onclick = () =>{
                settingsPanel.classList.add('active');
        }
        closeSettingsButton.onclick = () =>{
            settingsPanel.classList.remove('active');
        }
        // defaults
        let ssrRearEnabled = true;
        let doubleFovEnabled = true;
        let viewMode = ViewModes.SceneLit;
        let useDepthPeeling = false;
        let useEnvProxy = false;
        let useConeTracing = false;
        
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
        await scene.load();

        // stats
        let showStats = false;
        let stats = {
            iterationCount:0,
            opaqueSSRUV1Cam_AVG:0.0,
            opaqueSSRUV2Cam_AVG:0.0,
            opaqueGBuffer_AVG:0.0,
            opaqueGBufferRear_AVG:0.0,
            volumeRefractionUV_AVG:0.0,
            opaquePointLights_AVG:0.0,
            opaquePointLightsRear_AVG:0.0,
            totalTime_AVG:0.0
        };
        const statsUpdateEvery = 60;
        let toggleStats = <HTMLElement>document.getElementById("toggle-stats")!;
        let statsPanel = <HTMLElement>document.getElementById("stats-panel")!;
        let opaqueSSRUV1CamStat = <HTMLElement>document.getElementById("OpaqueSSRUV1Cam")!;
        let opaqueSSRUV2CamStat = <HTMLElement>document.getElementById("OpaqueSSRUV2Cam")!;
        let opaqueGBufferStat = <HTMLElement>document.getElementById("OpaqueGBuffer")!;
        let opaqueGBufferRearStat = <HTMLElement>document.getElementById("OpaqueGBufferRear")!;
        let volumeRefractionUVStat = <HTMLElement>document.getElementById("VolumeRefractionUV")!;
        let opaquePointLightsStats = <HTMLElement>document.getElementById("OpaquePointLightStats")!;
        let opaquePointLightsRearStats = <HTMLElement>document.getElementById("OpaquePointLightStatsRear")!;
        let totalTimeStat = <HTMLElement>document.getElementById("TotalTime")!; 

        let updateStats = (timestamps:Long[]) => {
            stats.iterationCount +=1;
            let opaqueSSRUV1Cam_Elapsed = timestamps[TimeQueries.OpaqueSSRUV1Cam_End].sub(timestamps[TimeQueries.OpaqueSSRUV1Cam_Start]).toNumber() * 10**(-6);
            let opaqueSSRUV2Cam_Elapsed = timestamps[TimeQueries.OpaqueSSRUV2Cam_End].sub(timestamps[TimeQueries.OpaqueSSRUV2Cam_Start]).toNumber() * 10**(-6);
            let opaqueGBuffer_Elapsed = timestamps[TimeQueries.OpaqueGBuffer_End].sub(timestamps[TimeQueries.OpaqueGBuffer_Start]).toNumber() * 10**(-6);
            let opaqueGBufferRear_Elapsed = timestamps[TimeQueries.OpaqueGBufferRear_End].sub(timestamps[TimeQueries.OpaqueGBufferRear_Start]).toNumber() * 10**(-6);
            let volumeRefractionUV_Elapsed = timestamps[TimeQueries.VolumeRefractionUV_End].sub(timestamps[TimeQueries.VolumeRefractionUV_Start]).toNumber() * 10**(-6);
            let opaquePointLights_Elapsed = timestamps[TimeQueries.OpaquePointLights_End].sub(timestamps[TimeQueries.OpaquePointLights_Start]).toNumber() * 10**(-6);
            let opaquePointLightsRear_Elapsed = timestamps[TimeQueries.OpaquePointLightsRear_End].sub(timestamps[TimeQueries.OpaquePointLightsRear_Start]).toNumber() * 10**(-6);
            let totalTime_Elapsed = timestamps[TimeQueries.BlendFrameBuffersAndDepthPass_End].sub(timestamps[TimeQueries.OpaqueGBuffer_Start]).toNumber() * 10**(-6);
            stats.opaqueSSRUV1Cam_AVG = stats.opaqueSSRUV1Cam_AVG + (opaqueSSRUV1Cam_Elapsed - stats.opaqueSSRUV1Cam_AVG) / stats.iterationCount;
            stats.opaqueSSRUV2Cam_AVG = stats.opaqueSSRUV2Cam_AVG + (opaqueSSRUV2Cam_Elapsed - stats.opaqueSSRUV2Cam_AVG) / stats.iterationCount;
            stats.opaqueGBuffer_AVG = stats.opaqueGBuffer_AVG + (opaqueGBuffer_Elapsed - stats.opaqueGBuffer_AVG) / stats.iterationCount;
            stats.opaqueGBufferRear_AVG = stats.opaqueGBufferRear_AVG + (opaqueGBufferRear_Elapsed - stats.opaqueGBufferRear_AVG) / stats.iterationCount;
            stats.volumeRefractionUV_AVG = stats.volumeRefractionUV_AVG + (volumeRefractionUV_Elapsed - stats.volumeRefractionUV_AVG) / stats.iterationCount;
            stats.opaquePointLights_AVG = stats.opaquePointLights_AVG + (opaquePointLights_Elapsed - stats.opaquePointLights_AVG) / stats.iterationCount;
            stats.opaquePointLightsRear_AVG = stats.opaquePointLightsRear_AVG + (opaquePointLightsRear_Elapsed - stats.opaquePointLightsRear_AVG) / stats.iterationCount;
            stats.totalTime_AVG = stats.totalTime_AVG + (totalTime_Elapsed-stats.totalTime_AVG)/stats.iterationCount;
            if(stats.iterationCount % statsUpdateEvery === 0) {
                opaqueSSRUV1CamStat.innerText = stats.opaqueSSRUV1Cam_AVG.toFixed(2) + " ms";
                opaqueSSRUV2CamStat.innerText = stats.opaqueSSRUV2Cam_AVG.toFixed(2) + " ms";
                opaqueGBufferStat.innerText = stats.opaqueGBuffer_AVG.toFixed(2) + " ms";
                opaqueGBufferRearStat.innerText = stats.opaqueGBufferRear_AVG.toFixed(2) + " ms";
                volumeRefractionUVStat.innerText = stats.volumeRefractionUV_AVG.toFixed(2) + " ms";
                opaquePointLightsStats.innerText = stats.opaquePointLights_AVG.toFixed(2) + " ms";
                opaquePointLightsRearStats.innerText = stats.opaquePointLightsRear_AVG.toFixed(2) + " ms";
                totalTimeStat.innerText = stats.totalTime_AVG.toFixed(2) + " ms";
            }
            //console.log("opaqueSSRUV1Cam_AVG --> "+stats.opaqueSSRUV1Cam_AVG.toString());
        };
        let zeroStats = () => {
            stats.iterationCount = 0;
            stats.opaqueSSRUV1Cam_AVG = 0;
        };
        toggleStats.onclick = () => {
            showStats = !showStats;
            if(showStats){
                zeroStats();
                statsPanel.style.display="block";
            }
            else{
                statsPanel.style.display="none";
            }
        };
        
        let cameraController = new FirstPersonCameraController(camera,canvas);
        let renderer = new Renderer(
            device,
            camera,
            scene,
            env,
            scene.pointLights,
            scene.directionalLights,
            scene.spotLights,
            ssrRearEnabled,
            doubleFovEnabled ? 2.0:1.0,
            useDepthPeeling,
            useEnvProxy,
            useConeTracing,
            updateStats
        );

        let animationFrameId: number | null = null;
        let renderLoop = () => {
            renderer.render();
            animationFrameId = requestAnimationFrame(renderLoop);
        }
        renderer.initialize(canvas).then(()=>renderLoop());

        // install renderer controllers
        document.getElementById("ViewModes-SceneLit")!.onclick = () => {
            viewMode = ViewModes.SceneLit;
            renderer.setViewMode(viewMode)
        };
        // Opaque view modes
        document.getElementById("ViewModes-OpaqueLit")!.onclick = () => {
            viewMode = ViewModes.OpaqueLit;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-OpaqueGBuffer")!.onclick = () => {
            viewMode = ViewModes.OpaqueGBuffer;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-OpaqueReflections")!.onclick = () => {
            viewMode = ViewModes.OpaqueReflections;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-OpaqueReflectionsVisibility")!.onclick = () => {
            viewMode = ViewModes.OpaqueReflectionsVisibility;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-OpaqueReflectionsUVs")!.onclick = () => {
            viewMode = ViewModes.OpaqueReflectionsUVs;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-OpaquePointLights")!.onclick = () => {
            viewMode = ViewModes.OpaquePointLights;
            renderer.setViewMode(viewMode);
        };
        // volume view modes
        document.getElementById("ViewModes-VolumeLit")!.onclick = () => {
            viewMode = ViewModes.VolumeLit;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeEnv")!.onclick = () => {
            viewMode = ViewModes.VolumeEnv;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeGBufferLayer1")!.onclick = () => {
            viewMode = ViewModes.VolumeGBufferLayer1;
            renderer.setViewMode(viewMode)
        };
        document.getElementById("ViewModes-VolumeGBufferLayer2")!.onclick = () => {
            viewMode = ViewModes.VolumeGBufferLayer2;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeRefractions")!.onclick = () => {
            viewMode = ViewModes.VolumeRefractions;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeRefractionsDistanceTravelled")!.onclick = () => {
            viewMode = ViewModes.VolumeRefractionsDistanceTravelled;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeRefractionsVisibility")!.onclick = () => {
            viewMode = ViewModes.VolumeRefractionsVisibility;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-VolumeRefractionsUVs")!.onclick = () => {
            viewMode = ViewModes.VolumeRefractionsUVs;
            renderer.setViewMode(viewMode);
        };
        // transparent view modes
        document.getElementById("ViewModes-TransparentLit")!.onclick = () => {
            viewMode = ViewModes.TransparentLit;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-TransparentGBuffer")!.onclick = () => {
            viewMode = ViewModes.TransparentGBuffer;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-TransparentReflections")!.onclick = () => {
            viewMode = ViewModes.TransparentReflections;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-TransparentReflectionsVisibility")!.onclick = () => {
            viewMode = ViewModes.TransparentReflectionsVisibility;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-TransparentReflectionsUVs")!.onclick = () => {
            viewMode = ViewModes.TransparentReflectionsUVs;
            renderer.setViewMode(viewMode);
        };
        document.getElementById("ViewModes-TransparentPointLights")!.onclick = () => {
            viewMode = ViewModes.TransparentPointLights;
            renderer.setViewMode(viewMode);
        };

        // Environment selection
        document.getElementById("EnvList-Forest")!.onclick = async () => {
            env = new GPUEnvironment("/environments/forest_4k",device);
            await env.load();
            renderer.env = env;
        };
        document.getElementById("EnvList-Terrace")!.onclick = async () => {
            env = new GPUEnvironment("/environments/terrace_4k",device);
            await env.load();
            renderer.env = env;
        };
        document.getElementById("EnvList-Overcast")!.onclick = async () => {
            env = new GPUEnvironment("/environments/overcast_4k",device);
            await env.load();
            renderer.env = env;
        };
        
        // initialize model dropdown and install handlers
        models.forEach((value,index) => {
            const liItem = document.createElement('li');
            liItem.setAttribute('class','dropdown-item');
            liItem.setAttribute('data-sceneFolder',value.sceneFolder);
            liItem.setAttribute('data-sceneFile',value.sceneFile);
            liItem.textContent = value.displayName;
            liItem.onclick = (event) => {
                const target = event.currentTarget as HTMLElement;
                const folder:string = target.getAttribute('data-sceneFolder')!;
                const file:string = target.getAttribute('data-sceneFile')!;
                scene = new GPUScene(folder,file,device);
                // reinitialize camera to default position
                camera = new PerspectiveCamera(
                    new Float32Array([0.0,1.0,-1.0]),
                    new Float32Array([0.0,0.0,0.0]),
                    45.0,
                    0.01,
                    100.0,
                    canvas.width / canvas.height
                );
                cameraController = new FirstPersonCameraController(camera,canvas);
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                    
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            }
            modelsList.appendChild(liItem);
        });

        // SSRRearCamera Option handler
        let optionSSRRearCheckbox = <HTMLInputElement>document.getElementById('ssr-rear-camera')!;
        optionSSRRearCheckbox.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.checked) {
                ssrRearEnabled = true;
                console.log('SSR Rear Camera enabled');
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    true,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            } else {
                ssrRearEnabled = false;
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    false,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            }
        });
        // Double FOV Option handler
        let optiondoubleFOV = <HTMLInputElement>document.getElementById('ssr-rear-doubleFov')!;
        optiondoubleFOV.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.checked) {
                doubleFovEnabled = true;
                console.log('DoubleFOV enabled');
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            } else {
                doubleFovEnabled = false;
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            }
        });
        // Cone Tracing Option handler
        let optionConeTracing = <HTMLInputElement>document.getElementById('ssr-coneTracing')!;
        optionConeTracing.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.checked) {
                useConeTracing = true;
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            } else {
                useConeTracing = false;
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            }
        });
        // Env Proxy Option handler
        let optionEnvProxy = <HTMLInputElement>document.getElementById('env-proxy')!;
        optionEnvProxy.addEventListener('change', (event: Event) => {
            const target = event.target as HTMLInputElement;
            if (target.checked) {
                useEnvProxy = true;
                console.log('Env Proxy enabled');
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            } else {
                useEnvProxy = false;
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            }
        });
        // Volume Second Layer Algorithm
        document.querySelectorAll('input[name="volume-layer"]').forEach((radio) => {
            radio.addEventListener('change', (event) => {
                const selectedValue = (event.target as HTMLInputElement).value;
                useDepthPeeling = selectedValue === "true";
                renderer.destroy();
                renderer = new Renderer(
                    device,
                    camera,
                    scene,
                    env,
                    scene.pointLights,
                    scene.directionalLights,
                    scene.spotLights,
                    ssrRearEnabled,
                    doubleFovEnabled ? 2.0:1.0,
                    useDepthPeeling,
                    useEnvProxy,
                    useConeTracing,
                    updateStats
                );
                renderer.setViewMode(viewMode);
                if(animationFrameId!==null){
                    cancelAnimationFrame(animationFrameId);
                }
                renderer.initialize(canvas).then(()=>renderLoop());
            });
        });
        

        // resize window handler
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
            if(animationFrameId!==null){
                cancelAnimationFrame(animationFrameId);
            }
            renderer.initialize(canvas).then(()=>renderLoop());
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

