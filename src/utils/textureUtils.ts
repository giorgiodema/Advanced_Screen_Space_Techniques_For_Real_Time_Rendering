


export async function loadImage(url: string): Promise<HTMLImageElement> {
    return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error(`Failed to load image at ${url}`));
        img.src = url;
    });
}

export function mipLevelCount(width:number,height:number){
    return  Math.floor(Math.log2(Math.max(width, height))) + 1;
}

export function generateMipmaps(image: HTMLImageElement, baseWidth: number, baseHeight: number): ImageData[] {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    let currentWidth: number = baseWidth;
    let currentHeight: number = baseHeight;
    const mipmaps: ImageData[] = [];

    while (currentWidth > 1 && currentHeight > 1) {
        canvas.width = currentWidth;
        canvas.height = currentHeight;
        ctx.drawImage(image, 0, 0, currentWidth, currentHeight);
        const imageData: ImageData = ctx.getImageData(0, 0, currentWidth, currentHeight);
        mipmaps.push(imageData);

        currentWidth = Math.max(1, Math.floor(currentWidth / 2));
        currentHeight = Math.max(1, Math.floor(currentHeight / 2));
    }

    return mipmaps;
}