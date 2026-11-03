import swagger2openapi from 'swagger2openapi';
import { SpecConvertError } from './errors.js';

interface SpecRef {
  readonly document: Record<string, unknown>;
  readonly sha: string;
  readonly path: string;
}

type Swagger2 = Parameters<typeof swagger2openapi.convertObj>[0];

const isSwagger2 = (document: Record<string, unknown>) =>
  typeof document.swagger === 'string' && document.swagger.startsWith('2');

const firstLine = (text: string) => text.split('\n')[0] ?? text;

/**
 * oasdiff hanya membaca OpenAPI 3, jadi Swagger 2 (`swagger: "2.0"`) dikonversi dengan
 * swagger2openapi; dokumen lain dikembalikan apa adanya (objek yang sama). Referensi eksternal
 * tidak diambil (tanpa jaringan). Melempar `SpecConvertError` bila konversi gagal.
 */
export async function toOpenApi3<S extends SpecRef>(spec: S): Promise<S> {
  if (!isSwagger2(spec.document)) return spec;
  try {
    // Salinan: konversi boleh mengubah masukannya, sedangkan `spec.document` bisa dari cache.
    const swagger = structuredClone(spec.document) as unknown as Swagger2;
    const { openapi } = await swagger2openapi.convertObj(swagger, {});
    return { ...spec, document: openapi as unknown as Record<string, unknown> };
  } catch (error) {
    throw new SpecConvertError(
      spec.sha,
      spec.path,
      firstLine(error instanceof Error ? error.message : String(error)),
    );
  }
}
