import * as fs from "fs";
import type { SharpLoader } from "../common/tool-types";
import { type NormalizedImage } from "./image-normalizer";
export type LoadedImageFile = {
    image: NormalizedImage;
    stat: fs.Stats;
};
export declare function loadImageFile(filePath: string, loadSharp?: SharpLoader, signal?: AbortSignal): Promise<LoadedImageFile>;
//# sourceMappingURL=image-file.d.ts.map