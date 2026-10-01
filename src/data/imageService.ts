// Local-only image handling: files are downscaled and stored as data URLs
// inside the listing record (localStorage). No Firebase Storage yet.

export const MAX_IMAGES = 5;
const MAX_DIMENSION = 720;
const JPEG_QUALITY = 0.7;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that image."));
    reader.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("That file is not a supported image."));
    img.src = src;
  });
}

async function compress(file: File): Promise<string> {
  if (!file.type.startsWith("image/")) throw new Error("Please choose image files only.");
  const original = await readAsDataUrl(file);
  const img = await loadImage(original);
  const scale = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.width * scale));
  canvas.height = Math.max(1, Math.round(img.height * scale));
  const context = canvas.getContext("2d");
  if (!context) return original;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", JPEG_QUALITY);
}

export const imageService = {
  /** Compress up to `limit` files into storable data URLs. */
  async processFiles(files: FileList | File[], limit = MAX_IMAGES): Promise<string[]> {
    return Promise.all(Array.from(files).slice(0, limit).map(compress));
  },
};
