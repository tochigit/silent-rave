import { prepareImage } from "@/lib/uploads/prepare-image";
export const compressProof = (file: File) => prepareImage(file, "proof");
