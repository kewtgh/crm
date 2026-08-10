export type ImageSize = {
  width: number;
  height: number;
  type?: string;
  orientation?: number;
  images?: Array<{ width: number; height: number }>;
};

export declare const types: readonly string[];
export declare function disableTypes(types: string[]): void;
export declare function imageSize(input: Uint8Array | ArrayBuffer): ImageSize;
export default imageSize;
