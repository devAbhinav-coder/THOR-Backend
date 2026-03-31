export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "House of Rani Backend API",
    version: "1.0.0",
    description: "Production API docs for ecommerce backend.",
  },
  servers: [{ url: "/api", description: "API base path" }],
  components: {
    schemas: {
      ApiSuccess: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          success: { type: "boolean", example: true },
          message: { type: "string", example: "OK" },
          data: { type: "object" },
          pagination: {
            type: "object",
            properties: {
              currentPage: { type: "number", example: 1 },
              totalPages: { type: "number", example: 5 },
              total: { type: "number", example: 100 },
            },
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Service health check",
        responses: {
          "200": { description: "Healthy" },
          "503": { description: "Degraded dependencies" },
        },
      },
    },
    "/products": {
      get: {
        summary: "List storefront products",
        responses: { "200": { description: "Products list" } },
      },
    },
    "/products/featured": {
      get: {
        summary: "Featured products",
        responses: { "200": { description: "Featured products list" } },
      },
    },
    "/gifting/products": {
      get: {
        summary: "Giftable products",
        responses: { "200": { description: "Gift catalog" } },
      },
    },
    "/storefront/settings": {
      get: {
        summary: "Storefront settings payload",
        responses: { "200": { description: "Settings data" } },
      },
    },
  },
} as const;
