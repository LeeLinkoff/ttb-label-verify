// swagger-spec.ts
//
// OpenAPI 3.0 spec for the TTB Label Verification API.
// components.schemas is generated from the actual TS interfaces, see
// schemas.generated.ts and scripts/generate-openapi-schemas.ts, run
// `npm run generate:schemas` after changing any interface in services/.
// `paths` (routes, verbs, request bodies, status codes) is still
// hand-maintained here, that metadata doesn't exist anywhere in the TS
// source for a generator to read it from.

import { generatedSchemas } from "./schemas.generated";

const swaggerSpec = {
  openapi: "3.0.3",

  info: {
    title: "TTB Label Verification API",
    version: "0.2.0",
    description:
      "Prototype API for verifying alcohol beverage label artwork against submitted application data. " +
      "Built for the TTB AI-powered alcohol label verification take-home assessment.\n\n" +
      "/api/health, /api/verify, and /api/verify/batch are all implemented. Field extraction uses " +
      "an OpenAI vision model (env-configurable via OPENAI_VISION_MODEL, required, no default is " +
      "hardcoded); matching applies exact comparison for the Government Warning statement " +
      "(27 CFR 16.21/16.22) and normalized, review-flagged comparison for brand name, class/type, " +
      "net contents, producer name, and producer address. Country of origin is only checked when " +
      "the application declares one (imports only)."
  },

  servers: [
    {
      url: "/",
      description: "Same-origin (Apache proxy in production, Vite proxy in dev)"
    }
  ],

  tags: [
    {
      name: "Diagnostics",
      description: "Health and status endpoints"
    },
    {
      name: "Label Verification",
      description: "Label field extraction and application-data matching"
    },
    {
      name: "Batch",
      description: "Batch upload and processing"
    }
  ],

  components: {
    schemas: {
      ...generatedSchemas,
      // Not backed by an exported TS interface (it's just an inline
      // shape in server.ts's catch blocks), so this one stays
      // hand-written rather than generated.
      ErrorResponse: {
        type: "object",
        properties: {
          ok: { type: "boolean", example: false },
          error: { type: "string" }
        },
        required: ["ok", "error"]
      }
    }
  },

  paths: {
    "/api/health": {
      get: {
        tags: ["Diagnostics"],
        summary: "Health check",
        description: "Returns service status. Used to confirm the backend is reachable and responding.",
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    ok: { type: "boolean", example: true },
                    service: { type: "string", example: "ttb-label-verify-backend" },
                    timestamp: { type: "string", format: "date-time" }
                  }
                }
              }
            }
          }
        }
      }
    },

    "/api/verify": {
      post: {
        tags: ["Label Verification"],
        summary: "Verify a single label against application data",
        description:
          "Accepts a label image plus application field data, extracts label fields via an OpenAI " +
          "vision model, and returns a per-field match result against the submitted application data.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  labelImage: { type: "string", format: "binary" },
                  brandName: { type: "string" },
                  classType: { type: "string" },
                  alcoholContent: { type: "string" },
                  netContents: { type: "string" },
                  producerName: {
                    type: "string",
                    description: "Name of the bottler/producer. Optional, compared with the same normalize()-then-compare logic as brandName."
                  },
                  producerAddress: {
                    type: "string",
                    description: "Address of the bottler/producer. Optional, same comparison logic as producerName."
                  },
                  countryOfOrigin: {
                    type: "string",
                    description: "Country of origin, imports only. If omitted, this field is not checked at all (treated as a domestic product), not compared against an empty string."
                  }
                },
                required: ["labelImage"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Match result",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MatchResult" }
              }
            }
          },
          "400": {
            description: "Missing labelImage",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" }
              }
            }
          },
          "502": {
            description: "Extraction or matching failed (e.g. vision API error, malformed response)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" }
              }
            }
          }
        }
      }
    },

    "/api/verify/batch": {
      post: {
        tags: ["Batch"],
        summary: "Verify multiple labels in one request",
        description:
          "Accepts multiple label images under labelImages[] plus a JSON-encoded array of matching " +
          "application data under applications. Each item is processed independently, one failed " +
          "extraction or match does not fail the whole batch. Each entry in applications follows the " +
          "same ApplicationData shape as POST /api/verify's form fields (brandName, classType, " +
          "alcoholContent, netContents, producerName, producerAddress, countryOfOrigin), matched to " +
          "labelImages[] strictly by array position, not filename.",
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  labelImages: {
                    type: "array",
                    items: { type: "string", format: "binary" }
                  },
                  applications: {
                    type: "string",
                    description:
                      "JSON-encoded array of ApplicationData objects, same order as labelImages[]."
                  }
                },
                required: ["labelImages", "applications"]
              }
            }
          }
        },
        responses: {
          "200": {
            description: "Per-item results, in the same order as the submitted files",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    results: {
                      type: "array",
                      items: { $ref: "#/components/schemas/BatchResultItem" }
                    }
                  },
                  required: ["results"]
                }
              }
            }
          },
          "502": {
            description: "Batch-level failure (e.g. malformed applications JSON)",
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/ErrorResponse" }
              }
            }
          }
        }
      }
    }
  }
};

export default swaggerSpec;
