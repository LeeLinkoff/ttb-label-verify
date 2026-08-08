// swagger-spec.ts
//
// OpenAPI 3.0 spec for the TTB Label Verification API.
// This is a skeleton: only /api/health is real right now. The label
// verification endpoints below are stubbed as documentation-only
// placeholders so the shape of the API is visible before the logic
// behind it exists. Update each path's description and remove the
// "(planned)" marker as it gets implemented.

const swaggerSpec = {
  openapi: "3.0.3",

  info: {
    title: "TTB Label Verification API",
    version: "0.1.0",
    description:
      "Prototype API for verifying alcohol beverage label artwork against submitted application data. " +
      "Built for the TTB AI-powered alcohol label verification take-home assessment.\n\n" +
      "This is a skeleton. Only /api/health is implemented. Label ingestion, field extraction, " +
      "matching, and batch endpoints are documented as planned but not yet built."
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
      description: "Label field extraction and application-data matching (planned)"
    },
    {
      name: "Batch",
      description: "Batch upload and processing (planned)"
    }
  ],

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
        summary: "(planned) Verify a single label against application data",
        description:
          "Accepts a label image plus application field data, extracts label fields via vision/OCR, " +
          "and returns a per-field match result. Not yet implemented.",
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
                  netContents: { type: "string" }
                }
              }
            }
          }
        },
        responses: {
          "501": {
            description: "Not implemented yet"
          }
        }
      }
    },

    "/api/verify/batch": {
      post: {
        tags: ["Batch"],
        summary: "(planned) Verify multiple labels in one request",
        description: "Accepts multiple label/application pairs and returns per-item match results. Not yet implemented.",
        responses: {
          "501": {
            description: "Not implemented yet"
          }
        }
      }
    }
  }
};

export default swaggerSpec;
