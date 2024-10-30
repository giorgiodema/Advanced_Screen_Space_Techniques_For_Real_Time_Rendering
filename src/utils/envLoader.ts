import { loadImage,generateMipmaps } from "./textureUtils";

export class GPUEnvironment {
    public sampler: GPUSampler | undefined;
    public texture: GPUTexture | undefined;
    public loaded: boolean = false;

    private path: string;
    private device: GPUDevice;

    constructor(path: string, device: GPUDevice) {
        this.path = path;
        this.device = device;
    }

    public async load(): Promise<void> {
        await this.initialize();
        this.loaded = true;
    }

    private async initialize(): Promise<void> {
        const paths: string[] = [
            `${this.path}/px.png`,
            `${this.path}/nx.png`,
            `${this.path}/py.png`,
            `${this.path}/ny.png`,
            `${this.path}/pz.png`,
            `${this.path}/nz.png`
        ];

        const images: HTMLImageElement[] = await Promise.all(paths.map(url => loadImage(url)));

        // Assuming all images are the same size
        const width: number = images[0].naturalWidth;
        const height: number = images[0].naturalHeight;
        const mipLevelCount: number = Math.floor(Math.log2(Math.max(width, height))) + 1;

        this.texture = this.device.createTexture({
            size: { width, height, depthOrArrayLayers: 6 },
            format: 'rgba8unorm',
            mipLevelCount,
            usage:  GPUTextureUsage.COPY_DST | 
            GPUTextureUsage.COPY_SRC | 
            GPUTextureUsage.RENDER_ATTACHMENT | 
            GPUTextureUsage.STORAGE_BINDING | 
            GPUTextureUsage.TEXTURE_BINDING
        });

        for (let i = 0; i < images.length; i++) {
            const mipmaps: ImageData[] = generateMipmaps(images[i], width, height);
            for (let level = 0; level < mipmaps.length; level++) {
                const mipmap = mipmaps[level];
                this.device.queue.writeTexture(
                    { texture: this.texture, origin: { x: 0, y: 0, z: i }, mipLevel: level },
                    mipmap.data,
                    { bytesPerRow: mipmap.width * 4, rowsPerImage: mipmap.height },
                    { width: mipmap.width, height: mipmap.height, depthOrArrayLayers: 1 }
                );
            }
        }

        this.sampler = this.device.createSampler({
            magFilter: "linear",
            minFilter: "linear",
            mipmapFilter: "linear"
        });
    }
}
