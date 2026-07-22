import path from "node:path";
import { DemoSemanticSpace } from "./demo.js";
import { PackedSemanticSpace } from "./packed.js";
import type { SemanticSpace } from "./space.js";

export async function loadSemanticSpace(): Promise<SemanticSpace> {
  const configuredPath = process.env.MODEL_DIR ?? "data/model";
  const modelDirectory = path.resolve(process.cwd(), configuredPath);
  try {
    return await PackedSemanticSpace.load(modelDirectory);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    console.warn(`[semantic] Navec-модель не загружена (${reason}). Используется демонстрационная.`);
    return new DemoSemanticSpace();
  }
}
