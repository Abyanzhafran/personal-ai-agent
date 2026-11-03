type Json = Record<string, unknown>;

export interface PropertyFacts {
  /** Hanya `type` berupa string; `anyOf`, `allOf`, dan `type: [...]` (OpenAPI 3.1) dibaca sebagai tidak jelas. */
  readonly type?: string;
  readonly enum?: readonly unknown[];
  readonly required: boolean;
}

/** Yang diperlukan mesin severity dari satu operasi: parameter query dan properti tingkat atas. */
export interface OperationFacts {
  readonly query: ReadonlyMap<string, PropertyFacts>;
  readonly body: ReadonlyMap<string, PropertyFacts>;
  readonly response: ReadonlyMap<string, PropertyFacts>;
}

const isObject = (value: unknown): value is Json =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const MAX_REF_DEPTH = 10;

/** Mengikuti `$ref` lokal (`#/...`). Rujukan eksternal, putus, atau berputar jadi `undefined`. */
function resolve(spec: Json, node: unknown, depth = 0): Json | undefined {
  if (!isObject(node)) return undefined;
  const ref = node['$ref'];
  if (typeof ref !== 'string') return node;
  if (depth >= MAX_REF_DEPTH || !ref.startsWith('#/')) return undefined;
  let target: unknown = spec;
  for (const part of ref.slice(2).split('/')) {
    const key = decodeURIComponent(part).replaceAll('~1', '/').replaceAll('~0', '~');
    target = isObject(target) ? target[key] : undefined;
  }
  return resolve(spec, target, depth + 1);
}

function jsonSchema(spec: Json, container: Json | undefined): unknown {
  const content = container?.['content'];
  if (!isObject(content)) return undefined;
  const mediaType = Object.keys(content).find((name) => /json/i.test(name));
  return mediaType === undefined ? undefined : resolve(spec, content[mediaType])?.['schema'];
}

function propertyFacts(spec: Json, schema: unknown, required: boolean): PropertyFacts {
  const property = resolve(spec, schema);
  const type = property?.['type'];
  const values = property?.['enum'];
  return {
    ...(typeof type === 'string' ? { type } : {}),
    ...(Array.isArray(values) ? { enum: values } : {}),
    required,
  };
}

/** Properti tingkat atas; skema array dibuka satu tingkat (isi `items`). */
function properties(spec: Json, schema: unknown): Map<string, PropertyFacts> {
  let target = resolve(spec, schema);
  if (target?.['type'] === 'array') target = resolve(spec, target['items']);
  const required = new Set(Array.isArray(target?.['required']) ? target['required'] : []);
  const result = new Map<string, PropertyFacts>();
  const props = target?.['properties'];
  if (!isObject(props)) return result;
  for (const [name, raw] of Object.entries(props)) {
    result.set(name, propertyFacts(spec, raw, required.has(name)));
  }
  return result;
}

/**
 * Fakta satu operasi dari dokumen OpenAPI 3 mentah (JSON atau hasil parse YAML), atau `undefined`
 * bila operasinya tidak ada. Body = skema JSON `requestBody`; response = gabungan skema JSON semua
 * respons 2xx (nama yang sama: yang pertama menang). Hanya properti tingkat atas; Swagger 2 tidak
 * dikenali.
 */
export function readOperation(
  spec: Json,
  { method, path }: { readonly method: string; readonly path: string },
): OperationFacts | undefined {
  const item = resolve(spec, resolve(spec, spec['paths'])?.[path]);
  const operation = resolve(spec, item?.[method.toLowerCase()]);
  if (!operation) return undefined;

  const query = new Map<string, PropertyFacts>();
  const declared = [item?.['parameters'], operation['parameters']];
  for (const list of declared) {
    for (const raw of Array.isArray(list) ? list : []) {
      const parameter = resolve(spec, raw);
      if (parameter?.['in'] === 'query' && typeof parameter['name'] === 'string') {
        query.set(
          parameter['name'],
          propertyFacts(spec, parameter['schema'], parameter['required'] === true),
        );
      }
    }
  }

  const response = new Map<string, PropertyFacts>();
  const responses = resolve(spec, operation['responses']) ?? {};
  for (const [status, raw] of Object.entries(responses)) {
    if (!/^2\d\d$/.test(status)) continue;
    for (const [name, facts] of properties(spec, jsonSchema(spec, resolve(spec, raw)))) {
      if (!response.has(name)) response.set(name, facts);
    }
  }

  return {
    query,
    body: properties(spec, jsonSchema(spec, resolve(spec, operation['requestBody']))),
    response,
  };
}
