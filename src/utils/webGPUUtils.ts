
export async function initializeWebGPU() : Promise<GPUDevice> {
    if (!navigator.gpu) {
      throw Error("WebGPU not supported.");
    }
  
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw Error("Couldn't request WebGPU adapter.");
    }
  
    let device = await adapter.requestDevice({
      requiredFeatures: [<GPUFeatureName>'timestamp-query']
    });
    if (!device) {
      throw Error("Could not initialize device");
    }
  
    return device;
  }
  
  export function resizeCanvas(canvasId:string) {
    const canvas = <HTMLCanvasElement>document.getElementById(canvasId);
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();

    // Set the drawing buffer size to match the display size multiplied by the pixel ratio.
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;

    // Use CSS to set the display size (fallback to 100% width/height in CSS if this is not set)
    canvas.style.width = rect.width + 'px';
    canvas.style.height = rect.height + 'px';

    // Optionally, if you need to do any re-render or adjustment after resizing, call it here
}

