export type DocumentLogo = { dataUrl: string; width: number; height: number };
// Uploads are normalised to bounded PNGs. Validate again when reading Storage.
export function decodeDocumentLogo(bytes: Uint8Array): DocumentLogo {
  if (
    bytes.length < 24 ||
    bytes.length > 2 * 1024 * 1024 ||
    ![137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v)
  )
    throw new Error("Invalid document logo");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16),
    height = view.getUint32(20);
  if (!width || !height || width > 1024 || height > 1024)
    throw new Error("Document logo dimensions exceed limit");
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return { dataUrl: `data:image/png;base64,${btoa(binary)}`, width, height };
}
export function logoSize(
  logo: DocumentLogo,
  maxWidth: number,
  maxHeight: number,
) {
  const scale = Math.min(maxWidth / logo.width, maxHeight / logo.height);
  return { width: logo.width * scale, height: logo.height * scale };
}
