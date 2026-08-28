import openApi from "../../../openapi/operatoros.openapi.json";
import type { OpenAPIV3 } from "openapi-types";

const deprecatedOperations = new Set(["POST /api/uploads/upload"]);
const httpMethods = new Set(["get", "post", "put", "patch", "delete", "head", "options", "trace"]);

function operationKey(path: string, method: string): string {
  return `${method.toUpperCase()} ${path}`;
}

function currentContract(): {
  info: OpenAPIV3.InfoObject;
  paths: OpenAPIV3.PathsObject;
  components?: OpenAPIV3.ComponentsObject;
} {
  const source = openApi as unknown as {
    info: OpenAPIV3.InfoObject;
    paths: Record<string, Record<string, unknown>>;
    components?: OpenAPIV3.ComponentsObject;
  };
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [path, pathItem] of Object.entries(source.paths)) {
    const operations = Object.fromEntries(
      Object.entries(pathItem).filter(([method]) =>
        !httpMethods.has(method) || !deprecatedOperations.has(operationKey(path, method)),
      ),
    );
    if (Object.keys(operations).length > 0) paths[path] = operations;
  }

  return { info: source.info, paths: paths as OpenAPIV3.PathsObject, components: source.components };
}

/**
 * This committed document is the accepted public contract for the full app.
 * Elysia owns route execution and runtime validation.
 * The deprecated upload operation stays out of the public document.
 */
export function openApiDocumentation(): {
  info: OpenAPIV3.InfoObject;
  paths: OpenAPIV3.PathsObject;
  components?: OpenAPIV3.ComponentsObject;
} {
  return currentContract();
}
