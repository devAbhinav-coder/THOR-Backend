// ─── House of Rani – Full OpenAPI 3.0.3 specification ────────────────────────
// Every route registered in src/routes/* is documented here.
// Swagger UI is served at  GET /api/docs
// ─────────────────────────────────────────────────────────────────────────────

export const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "The House of Rani – Backend API",
    version: "1.1.0",
    description:
      "Complete REST API documentation for the House of Rani e-commerce platform.\n\n" +
      "**Authentication:** Protected endpoints accept either:\n" +
      "- httpOnly cookie `accessToken` (web browsers), or\n" +
      "- `Authorization: Bearer <jwt>` (mobile apps with header `X-Client: mobile`).\n\n" +
      "**Admin endpoints** require `role: admin`.\n\n" +
      "**Production:** `/api/docs` is disabled unless `ENABLE_API_DOCS=true`.",
    contact: { name: "House of Rani Dev Team" },
  },
  servers: [
    { url: "/api", description: "Default (relative) – same host" },
    { url: "http://localhost:5000/api", description: "Local development" },
  ],

  // ─── Security ──────────────────────────────────────────────────────────────
  components: {
    securitySchemes: {
      cookieAuth: {
        type: "apiKey",
        in: "cookie",
        name: "accessToken",
        description: "JWT access token stored in an httpOnly cookie (web).",
      },
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
        description:
          "JWT access token for native apps. Send header `X-Client: mobile` on login/refresh to receive tokens in the JSON body.",
      },
    },

    // ─── Reusable schemas ───────────────────────────────────────────────────
    schemas: {
      // Generic wrappers
      SuccessResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "success" },
          success: { type: "boolean", example: true },
          message: { type: "string", example: "OK" },
          data: { type: "object", nullable: true },
        },
      },
      PaginatedResponse: {
        allOf: [
          { $ref: "#/components/schemas/SuccessResponse" },
          {
            type: "object",
            properties: {
              pagination: {
                type: "object",
                properties: {
                  currentPage: { type: "integer", example: 1 },
                  totalPages: { type: "integer", example: 5 },
                  total: { type: "integer", example: 100 },
                },
              },
            },
          },
        ],
      },
      ErrorResponse: {
        type: "object",
        properties: {
          status: { type: "string", example: "error" },
          success: { type: "boolean", example: false },
          message: { type: "string", example: "Something went wrong." },
        },
      },

      // ── Auth ───────────────────────────────────────────────────────────────
      SignupStartBody: {
        type: "object",
        required: ["name", "email", "password"],
        properties: {
          name: { type: "string", example: "Aisha Khan" },
          email: { type: "string", format: "email", example: "aisha@example.com" },
          password: { type: "string", minLength: 8, example: "Str0ng!Pass" },
        },
      },
      SignupVerifyBody: {
        type: "object",
        required: ["email", "otp"],
        properties: {
          email: { type: "string", format: "email" },
          otp: { type: "string", example: "482913" },
        },
      },
      LoginBody: {
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
        },
      },
      GoogleAuthBody: {
        type: "object",
        required: ["idToken"],
        properties: {
          idToken: { type: "string", description: "Firebase / Google ID token" },
        },
      },
      ForgotPasswordBody: {
        type: "object",
        required: ["email"],
        properties: { email: { type: "string", format: "email" } },
      },
      ResetPasswordBody: {
        type: "object",
        required: ["email", "otp", "password"],
        properties: {
          email: { type: "string", format: "email" },
          otp: { type: "string" },
          password: { type: "string", minLength: 8 },
        },
      },
      UpdatePasswordBody: {
        type: "object",
        required: ["currentPassword", "newPassword"],
        properties: {
          currentPassword: { type: "string" },
          newPassword: { type: "string", minLength: 8 },
        },
      },
      AddressBody: {
        type: "object",
        required: ["label", "street", "city", "state", "pincode"],
        properties: {
          label: { type: "string", example: "Home" },
          street: { type: "string", example: "123 MG Road" },
          city: { type: "string", example: "Mumbai" },
          state: { type: "string", example: "Maharashtra" },
          pincode: { type: "string", example: "400001" },
          country: { type: "string", example: "India", default: "India" },
          phone: { type: "string", example: "+919876543210" },
          isDefault: { type: "boolean", example: false },
        },
      },
      SendOtpBody: {
        type: "object",
        required: ["email", "type"],
        properties: {
          email: { type: "string", format: "email" },
          type: { type: "string", enum: ["signup", "reset", "verify"] },
        },
      },
      VerifyOtpBody: {
        type: "object",
        required: ["email", "otp", "type"],
        properties: {
          email: { type: "string", format: "email" },
          otp: { type: "string" },
          type: { type: "string", enum: ["signup", "reset", "verify"] },
        },
      },

      // ── Product ────────────────────────────────────────────────────────────
      ProductVariant: {
        type: "object",
        properties: {
          sku: { type: "string" },
          size: { type: "string" },
          color: { type: "string" },
          stock: { type: "integer" },
          price: { type: "number" },
          compareAtPrice: { type: "number", nullable: true },
        },
      },
      Product: {
        type: "object",
        properties: {
          _id: { type: "string" },
          name: { type: "string" },
          slug: { type: "string" },
          description: { type: "string" },
          category: { type: "string" },
          images: { type: "array", items: { type: "string" } },
          variants: { type: "array", items: { $ref: "#/components/schemas/ProductVariant" } },
          isFeatured: { type: "boolean" },
          isGiftable: { type: "boolean" },
          tags: { type: "array", items: { type: "string" } },
          averageRating: { type: "number" },
          reviewCount: { type: "integer" },
          createdAt: { type: "string", format: "date-time" },
        },
      },

      // ── Cart ───────────────────────────────────────────────────────────────
      CartItem: {
        type: "object",
        properties: {
          _id: { type: "string" },
          product: { $ref: "#/components/schemas/Product" },
          sku: { type: "string" },
          quantity: { type: "integer" },
          price: { type: "number" },
          customFields: { type: "object", nullable: true },
        },
      },
      AddToCartBody: {
        type: "object",
        required: ["productId", "sku", "quantity"],
        properties: {
          productId: { type: "string" },
          sku: { type: "string" },
          quantity: { type: "integer", minimum: 1 },
          customFields: { type: "object", nullable: true },
        },
      },
      UpdateCartItemBody: {
        type: "object",
        required: ["quantity"],
        properties: { quantity: { type: "integer", minimum: 0 } },
      },
      ApplyCouponBody: {
        type: "object",
        required: ["code"],
        properties: { code: { type: "string", example: "SAVE20" } },
      },

      // ── Order ──────────────────────────────────────────────────────────────
      CreateOrderBody: {
        type: "object",
        required: ["shippingAddress", "paymentMethod"],
        properties: {
          shippingAddress: {
            type: "object",
            required: ["name", "phone", "street", "city", "state", "pincode"],
            properties: {
              name: { type: "string", example: "Aisha Khan" },
              phone: { type: "string", example: "9876543210" },
              label: { type: "string", example: "Home" },
              house: { type: "string" },
              street: { type: "string" },
              landmark: { type: "string" },
              city: { type: "string" },
              state: { type: "string" },
              pincode: { type: "string", example: "395003" },
              country: { type: "string", default: "India" },
            },
          },
          paymentMethod: { type: "string", enum: ["razorpay", "cod"] },
          couponCode: { type: "string", nullable: true },
          notes: { type: "string", maxLength: 500, nullable: true },
          buyNowItem: {
            type: "object",
            nullable: true,
            properties: {
              productId: { type: "string" },
              variant: {
                type: "object",
                properties: {
                  size: { type: "string" },
                  color: { type: "string" },
                  colorCode: { type: "string" },
                  sku: { type: "string" },
                },
              },
              quantity: { type: "integer", minimum: 1, maximum: 10 },
            },
          },
          marketingAttribution: { type: "object", nullable: true },
          metaBrowser: { type: "object", nullable: true },
        },
      },
      VerifyPaymentBody: {
        type: "object",
        required: ["razorpayOrderId", "razorpayPaymentId", "razorpaySignature"],
        properties: {
          razorpayOrderId: { type: "string" },
          razorpayPaymentId: { type: "string" },
          razorpaySignature: { type: "string" },
          orderId: {
            type: "string",
            description: "Mongo ObjectId — required if checkoutIntentId omitted",
          },
          checkoutIntentId: {
            type: "string",
            description: "Mongo ObjectId — required if orderId omitted",
          },
          metaBrowser: { type: "object", nullable: true },
        },
      },

      // ── Review ─────────────────────────────────────────────────────────────
      CreateReviewBody: {
        type: "object",
        required: ["rating"],
        properties: {
          rating: { type: "integer", minimum: 1, maximum: 5 },
          title: { type: "string" },
          body: { type: "string" },
        },
      },

      // ── Coupon ─────────────────────────────────────────────────────────────
      CreateCouponBody: {
        type: "object",
        required: ["code", "discountType", "discountValue"],
        properties: {
          code: { type: "string", example: "SUMMER25" },
          discountType: { type: "string", enum: ["percentage", "flat"] },
          discountValue: { type: "number", example: 25 },
          minOrderAmount: { type: "number", nullable: true },
          maxUses: { type: "integer", nullable: true },
          expiresAt: { type: "string", format: "date-time", nullable: true },
          isActive: { type: "boolean", default: true },
        },
      },

      // ── Blog ───────────────────────────────────────────────────────────────
      Blog: {
        type: "object",
        properties: {
          _id: { type: "string" },
          title: { type: "string" },
          slug: { type: "string" },
          body: { type: "string" },
          coverImage: { type: "string", nullable: true },
          tags: { type: "array", items: { type: "string" } },
          publishedAt: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["draft", "published", "scheduled"] },
          author: { type: "string" },
        },
      },

      // ── Gifting ────────────────────────────────────────────────────────────
      SubmitGiftingRequestBody: {
        type: "object",
        required: ["recipientName", "occasion", "budget"],
        properties: {
          recipientName: { type: "string" },
          occasion: { type: "string" },
          budget: { type: "number" },
          notes: { type: "string", nullable: true },
          deliveryDate: { type: "string", format: "date", nullable: true },
        },
      },

      // ── Notification ───────────────────────────────────────────────────────
      PushSubscribeBody: {
        type: "object",
        required: ["subscription"],
        properties: {
          subscription: {
            type: "object",
            properties: {
              endpoint: { type: "string" },
              keys: {
                type: "object",
                properties: {
                  auth: { type: "string" },
                  p256dh: { type: "string" },
                },
              },
            },
          },
        },
      },
      ExpoPushBody: {
        type: "object",
        required: ["token"],
        properties: { token: { type: "string", description: "Expo push token" } },
      },

      // ── Admin – Inventory ──────────────────────────────────────────────────
      StockAdjustmentBody: {
        type: "object",
        required: ["delta", "reason"],
        properties: {
          delta: { type: "integer", description: "Positive to add, negative to subtract" },
          reason: { type: "string", example: "manual correction" },
        },
      },

      // ── Admin – Operating Expense ──────────────────────────────────────────
      CreateOperatingExpenseBody: {
        type: "object",
        required: ["category", "amount", "date"],
        properties: {
          category: { type: "string", enum: ["shipping", "packing", "ads", "misc"] },
          amount: { type: "number" },
          date: { type: "string", format: "date" },
          description: { type: "string", nullable: true },
          orderId: { type: "string", nullable: true },
        },
      },

      // ── Admin – Offline Order ──────────────────────────────────────────────
      CreateOfflineOrderBody: {
        type: "object",
        required: ["customerName", "items", "paymentMethod"],
        properties: {
          customerName: { type: "string" },
          customerPhone: { type: "string" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                productId: { type: "string" },
                sku: { type: "string" },
                quantity: { type: "integer" },
                price: { type: "number" },
              },
            },
          },
          paymentMethod: { type: "string", enum: ["cash", "upi", "card"] },
          discount: { type: "number", nullable: true },
          note: { type: "string", nullable: true },
        },
      },

      // ── Admin – Marketing ──────────────────────────────────────────────────
      SendMarketingEmailBody: {
        type: "object",
        required: ["subject", "htmlBody", "audience"],
        properties: {
          subject: { type: "string" },
          htmlBody: { type: "string" },
          audience: { type: "string", enum: ["all", "active", "inactive", "segment"] },
          segmentFilter: { type: "object", nullable: true },
        },
      },
    },
  },

  // ─── Global security (cookie OR bearer — either is enough) ─────────────────
  security: [{ cookieAuth: [] }, { bearerAuth: [] }],

  // ─── Paths ──────────────────────────────────────────────────────────────────
  paths: {
    // ════════════════════════════════════════════════════════════════════════
    // HEALTH
    // ════════════════════════════════════════════════════════════════════════
    "/health": {
      get: {
        tags: ["System"],
        summary: "Public readiness check",
        description:
          "MongoDB + Redis booleans only. Full infra posture is at /health/detailed (token-gated).",
        security: [],
        responses: {
          "200": {
            description: "All systems operational",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    message: { type: "string", example: "API is running" },
                    timestamp: { type: "string", format: "date-time" },
                    checks: {
                      type: "object",
                      properties: {
                        mongodb: { type: "boolean" },
                        redis: { oneOf: [{ type: "boolean" }, { type: "string", example: "disabled" }] },
                      },
                    },
                  },
                },
              },
            },
          },
          "503": { description: "Database connection failed" },
        },
      },
    },
    "/health/detailed": {
      get: {
        tags: ["System"],
        summary: "Detailed infrastructure health (token-gated)",
        description:
          "Requires HEALTHCHECK_TOKEN via ?token= or x-healthcheck-token header.",
        security: [],
        parameters: [
          {
            name: "token",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": { description: "Detailed infra report" },
          "401": { description: "Unauthorized" },
          "503": { description: "Degraded or token not configured in production" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // AUTH  –  /api/auth/*
    // ════════════════════════════════════════════════════════════════════════
    "/auth/signup/start": {
      post: {
        tags: ["Auth"],
        summary: "Step 1 – Begin signup (sends OTP)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SignupStartBody" } },
          },
        },
        responses: {
          "200": { description: "OTP sent to email" },
          "409": { description: "Email already registered" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/auth/signup/verify": {
      post: {
        tags: ["Auth"],
        summary: "Step 2 – Verify OTP & create account",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SignupVerifyBody" } },
          },
        },
        responses: {
          "201": { description: "Account created, access token cookie set" },
          "400": { description: "Invalid or expired OTP" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/auth/send-otp": {
      post: {
        tags: ["Auth"],
        summary: "Send OTP (unified – signup / reset / verify)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SendOtpBody" } },
          },
        },
        responses: {
          "200": { description: "OTP dispatched" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/auth/resend-otp": {
      post: {
        tags: ["Auth"],
        summary: "Resend OTP",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email", "type"],
                properties: {
                  email: { type: "string", format: "email" },
                  type: { type: "string", enum: ["signup", "reset", "verify"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "OTP resent" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/auth/verify-otp": {
      post: {
        tags: ["Auth"],
        summary: "Verify OTP (standalone check)",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/VerifyOtpBody" } },
          },
        },
        responses: {
          "200": { description: "OTP valid" },
          "400": { description: "Invalid or expired OTP" },
        },
      },
    },
    "/auth/login": {
      post: {
        tags: ["Auth"],
        summary: "Email + password login",
        description: "Returns an `accessToken` cookie on success.",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/LoginBody" } },
          },
        },
        responses: {
          "200": { description: "Logged in – cookie set" },
          "401": { description: "Invalid credentials" },
          "429": { description: "Rate limited" },
        },
      },
    },
    "/auth/refresh": {
      post: {
        tags: ["Auth"],
        summary: "Refresh access token using refresh token cookie",
        security: [],
        responses: {
          "200": { description: "New access token issued" },
          "401": { description: "Refresh token invalid or expired" },
        },
      },
    },
    "/auth/forgot-password": {
      post: {
        tags: ["Auth"],
        summary: "Request password-reset OTP",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ForgotPasswordBody" } },
          },
        },
        responses: {
          "200": { description: "Reset OTP sent" },
          "404": { description: "Email not found" },
        },
      },
    },
    "/auth/reset-password": {
      post: {
        tags: ["Auth"],
        summary: "Reset password using OTP",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ResetPasswordBody" } },
          },
        },
        responses: {
          "200": { description: "Password reset successfully" },
          "400": { description: "Invalid or expired OTP" },
        },
      },
    },
    "/auth/google": {
      post: {
        tags: ["Auth"],
        summary: "Google OAuth – sign in / sign up",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/GoogleAuthBody" } },
          },
        },
        responses: {
          "200": { description: "Authenticated – cookie set" },
          "401": { description: "Invalid Google token" },
        },
      },
    },
    "/auth/logout": {
      post: {
        tags: ["Auth"],
        summary: "Logout – clear auth cookies",
        security: [],
        responses: { "200": { description: "Logged out" } },
      },
    },
    "/auth/me": {
      get: {
        tags: ["Auth"],
        summary: "Get current authenticated user profile",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "User profile data" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/update-me": {
      patch: {
        tags: ["Auth"],
        summary: "Update own profile (name, avatar, etc.)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  avatar: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Profile updated" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/update-password": {
      patch: {
        tags: ["Auth"],
        summary: "Change own password",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdatePasswordBody" } },
          },
        },
        responses: {
          "200": { description: "Password changed" },
          "400": { description: "Wrong current password" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/delete-me": {
      delete: {
        tags: ["Auth"],
        summary: "Soft-delete own account",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "Account deactivated" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/addresses": {
      post: {
        tags: ["Auth"],
        summary: "Add a delivery address",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AddressBody" } },
          },
        },
        responses: {
          "201": { description: "Address added" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/addresses/{addressId}": {
      delete: {
        tags: ["Auth"],
        summary: "Remove a delivery address",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "addressId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Address removed" },
          "404": { description: "Address not found" },
        },
      },
    },
    "/auth/sessions": {
      get: {
        tags: ["Auth"],
        summary: "List active sessions for the current user",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "Session list" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/auth/sessions/{sessionId}": {
      delete: {
        tags: ["Auth"],
        summary: "Revoke a specific session",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "sessionId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Session revoked" },
          "404": { description: "Session not found" },
        },
      },
    },
    "/auth/sessions/revoke-others": {
      post: {
        tags: ["Auth"],
        summary: "Revoke all sessions except the current one",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Other sessions revoked" } },
      },
    },
    "/auth/sessions/revoke-all": {
      post: {
        tags: ["Auth"],
        summary: "Revoke ALL sessions including the current one (global logout)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "All sessions revoked, logged out" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // PRODUCTS  –  /api/products/*
    // ════════════════════════════════════════════════════════════════════════
    "/products": {
      get: {
        tags: ["Products"],
        summary: "List / filter storefront products",
        security: [],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "sort", in: "query", schema: { type: "string", example: "price_asc" } },
          { name: "minPrice", in: "query", schema: { type: "number" } },
          { name: "maxPrice", in: "query", schema: { type: "number" } },
          { name: "tags", in: "query", schema: { type: "string", description: "Comma-separated tag list" } },
          { name: "inStock", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { description: "Paginated product list", content: { "application/json": { schema: { $ref: "#/components/schemas/PaginatedResponse" } } } },
        },
      },
      post: {
        tags: ["Products"],
        summary: "[Admin] Create a new product",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["name", "category", "variants"],
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  category: { type: "string" },
                  variants: { type: "string", description: "JSON string of variant array" },
                  isFeatured: { type: "boolean" },
                  isGiftable: { type: "boolean" },
                  tags: { type: "string", description: "Comma-separated tags" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Product created" },
          "401": { description: "Not authenticated" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/products/search": {
      get: {
        tags: ["Products"],
        summary: "Full-text search products",
        security: [],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string", example: "silk saree" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Search results" } },
      },
    },
    "/products/autocomplete": {
      get: {
        tags: ["Products"],
        summary: "Autocomplete search query",
        security: [],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Autocomplete suggestions array" } },
      },
    },
    "/products/suggestions": {
      get: {
        tags: ["Products"],
        summary: "Personalised / contextual search suggestions",
        security: [],
        parameters: [
          { name: "q", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Suggestion list" } },
      },
    },
    "/products/trending": {
      get: {
        tags: ["Products"],
        summary: "Trending search terms",
        security: [],
        parameters: [
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
        ],
        responses: { "200": { description: "Trending keyword list" } },
      },
    },
    "/products/featured": {
      get: {
        tags: ["Products"],
        summary: "Featured / hero products",
        security: [],
        responses: { "200": { description: "Featured product list" } },
      },
    },
    "/products/filters": {
      get: {
        tags: ["Products"],
        summary: "Available filter options (categories, price range, sizes, etc.)",
        security: [],
        responses: { "200": { description: "Filter facets" } },
      },
    },
    "/products/category/{category}": {
      get: {
        tags: ["Products"],
        summary: "Products by category slug",
        security: [],
        parameters: [
          { name: "category", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Products in category" } },
      },
    },
    "/products/{slug}": {
      get: {
        tags: ["Products"],
        summary: "Get single product by slug",
        security: [],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Product detail" },
          "404": { description: "Product not found" },
        },
      },
    },
    "/products/{id}": {
      patch: {
        tags: ["Products"],
        summary: "[Admin] Update product by MongoDB id",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  description: { type: "string" },
                  variants: { type: "string" },
                  isFeatured: { type: "boolean" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Product updated" },
          "403": { description: "Admin only" },
          "404": { description: "Product not found" },
        },
      },
      delete: {
        tags: ["Products"],
        summary: "[Admin] Delete product by MongoDB id",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Product deleted" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/products/{slug}/view": {
      post: {
        tags: ["Products"],
        summary: "Record a product view (analytics)",
        security: [],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "View recorded" } },
      },
    },
    "/products/{id}/images/{publicId}": {
      delete: {
        tags: ["Products"],
        summary: "[Admin] Delete a single product image by Cloudinary publicId",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "publicId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Image deleted" },
          "403": { description: "Admin only" },
          "404": { description: "Image not found" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // CATEGORIES  –  /api/categories/*
    // ════════════════════════════════════════════════════════════════════════
    "/categories": {
      get: {
        tags: ["Categories"],
        summary: "List all categories",
        security: [],
        responses: { "200": { description: "Category list" } },
      },
    },
    "/categories/stats": {
      get: {
        tags: ["Categories"],
        summary: "Category product-count statistics",
        security: [],
        responses: { "200": { description: "Stats per category" } },
      },
    },
    "/categories/{id}": {
      get: {
        tags: ["Categories"],
        summary: "Get single category by ID",
        security: [],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Category detail" },
          "404": { description: "Not found" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // CART  –  /api/cart/*  (all protected)
    // ════════════════════════════════════════════════════════════════════════
    "/cart": {
      get: {
        tags: ["Cart"],
        summary: "Get current user's cart",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "Cart with items and totals" },
          "401": { description: "Not authenticated" },
        },
      },
      delete: {
        tags: ["Cart"],
        summary: "Clear entire cart",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "Cart cleared" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/cart/sync": {
      get: {
        tags: ["Cart"],
        summary: "Server-Sent Events stream for real-time cart sync",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": {
            description: "SSE stream (text/event-stream)",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/cart/add": {
      post: {
        tags: ["Cart"],
        summary: "Add item to cart",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/AddToCartBody" } },
          },
        },
        responses: {
          "200": { description: "Item added / quantity updated" },
          "400": { description: "Insufficient stock or validation error" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/cart/custom-field-image": {
      post: {
        tags: ["Cart"],
        summary: "Upload a custom-field image for a cart item (e.g. personalisation photo)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["image"],
                properties: { image: { type: "string", format: "binary" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Image uploaded, URL returned" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/cart/item/{cartItemId}": {
      patch: {
        tags: ["Cart"],
        summary: "Update cart item quantity",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cartItemId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/UpdateCartItemBody" } },
          },
        },
        responses: {
          "200": { description: "Cart item updated" },
          "404": { description: "Item not found" },
        },
      },
      delete: {
        tags: ["Cart"],
        summary: "Remove item from cart",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cartItemId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Item removed" },
          "404": { description: "Item not found" },
        },
      },
    },
    "/cart/apply-coupon": {
      post: {
        tags: ["Cart"],
        summary: "Apply a coupon code to the cart",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ApplyCouponBody" } },
          },
        },
        responses: {
          "200": { description: "Coupon applied, discount reflected" },
          "400": { description: "Invalid or expired coupon" },
        },
      },
    },
    "/cart/coupon": {
      delete: {
        tags: ["Cart"],
        summary: "Remove applied coupon from cart",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Coupon removed" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ORDERS  –  /api/orders/*  (all protected)
    // ════════════════════════════════════════════════════════════════════════
    "/orders": {
      post: {
        tags: ["Orders"],
        summary: "Create a new order (checkout)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateOrderBody" } },
          },
        },
        responses: {
          "201": { description: "Order created – Razorpay order ID returned for online payment" },
          "400": { description: "Validation error or out-of-stock" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/orders/verify-payment": {
      post: {
        tags: ["Orders"],
        summary: "Verify Razorpay payment and confirm order",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/VerifyPaymentBody" } },
          },
        },
        responses: {
          "200": { description: "Payment verified, order confirmed" },
          "400": { description: "Signature mismatch" },
        },
      },
    },
    "/orders/my-orders": {
      get: {
        tags: ["Orders"],
        summary: "Get current user's order history",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Paginated order list" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/orders/{id}": {
      get: {
        tags: ["Orders"],
        summary: "Get a single order by ID",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Order detail" },
          "403": { description: "Access denied (not owner or admin)" },
          "404": { description: "Order not found" },
        },
      },
    },
    "/orders/{id}/cancel": {
      patch: {
        tags: ["Orders"],
        summary: "Cancel an order",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { reason: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Order cancelled" },
          "400": { description: "Cannot cancel (already shipped or delivered)" },
        },
      },
    },
    "/orders/{id}/return": {
      post: {
        tags: ["Orders"],
        summary: "Request a return for an order",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  reason: { type: "string" },
                  items: { type: "array", items: { type: "string" }, description: "Order item IDs to return" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Return request created" },
          "400": { description: "Not eligible for return" },
        },
      },
    },
    "/orders/{orderId}/prepare-payment": {
      post: {
        tags: ["Orders"],
        summary: "Prepare / retry payment for an existing pending order",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "New Razorpay order ID issued for retry" },
          "400": { description: "Order already paid or not payable" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // REVIEWS  –  /api/reviews/*
    // ════════════════════════════════════════════════════════════════════════
    "/reviews/featured": {
      get: {
        tags: ["Reviews"],
        summary: "Get featured / homepage reviews",
        security: [],
        responses: { "200": { description: "Featured review list" } },
      },
    },
    "/reviews/product/{productId}": {
      get: {
        tags: ["Reviews"],
        summary: "Get reviews for a product",
        security: [],
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "sort", in: "query", schema: { type: "string", example: "recent" } },
        ],
        responses: { "200": { description: "Paginated reviews" } },
      },
      post: {
        tags: ["Reviews"],
        summary: "Create a review for a product",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["rating"],
                properties: {
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  title: { type: "string" },
                  body: { type: "string" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Review created" },
          "400": { description: "Already reviewed or not purchased" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/reviews/product/{productId}/can-review": {
      get: {
        tags: ["Reviews"],
        summary: "Check if current user can review this product",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "{ canReview: boolean }" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/reviews/{id}": {
      patch: {
        tags: ["Reviews"],
        summary: "Update own review",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  rating: { type: "integer" },
                  title: { type: "string" },
                  body: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Review updated" },
          "403": { description: "Not the owner" },
        },
      },
      delete: {
        tags: ["Reviews"],
        summary: "Delete own review",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Review deleted" },
          "403": { description: "Not the owner" },
        },
      },
    },
    "/reviews/{id}/helpful": {
      patch: {
        tags: ["Reviews"],
        summary: "Vote a review as helpful",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Vote recorded" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/reviews/{id}/report": {
      patch: {
        tags: ["Reviews"],
        summary: "Report a review as inappropriate",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { reason: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Report submitted" },
          "401": { description: "Not authenticated" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // WISHLIST  –  /api/wishlist/*  (all protected)
    // ════════════════════════════════════════════════════════════════════════
    "/wishlist": {
      get: {
        tags: ["Wishlist"],
        summary: "Get current user's wishlist",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: {
          "200": { description: "Wishlist items" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/wishlist/{productId}": {
      post: {
        tags: ["Wishlist"],
        summary: "Toggle product in/out of wishlist",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "productId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Added or removed from wishlist" },
          "401": { description: "Not authenticated" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // COUPONS  –  /api/coupons/*
    // ════════════════════════════════════════════════════════════════════════
    "/coupons/validate": {
      post: {
        tags: ["Coupons"],
        summary: "Validate a coupon code against cart",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["code", "cartTotal"],
                properties: {
                  code: { type: "string" },
                  cartTotal: { type: "number" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Coupon valid, discount amount returned" },
          "400": { description: "Invalid, expired or minimum not met" },
        },
      },
    },
    "/coupons/eligible": {
      get: {
        tags: ["Coupons"],
        summary: "Get coupons eligible for the current user & cart",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "cartTotal", in: "query", required: true, schema: { type: "number" } },
        ],
        responses: {
          "200": { description: "Eligible coupon list" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/coupons": {
      get: {
        tags: ["Coupons"],
        summary: "[Admin] List all coupons",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Coupon list" } },
      },
      post: {
        tags: ["Coupons"],
        summary: "[Admin] Create coupon",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateCouponBody" } },
          },
        },
        responses: {
          "201": { description: "Coupon created" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/coupons/{id}": {
      get: {
        tags: ["Coupons"],
        summary: "[Admin] Get coupon by ID",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Coupon detail" },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags: ["Coupons"],
        summary: "[Admin] Update coupon",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateCouponBody" } },
          },
        },
        responses: {
          "200": { description: "Coupon updated" },
          "403": { description: "Admin only" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags: ["Coupons"],
        summary: "[Admin] Delete coupon",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Coupon deleted" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/coupons/{id}/archive": {
      patch: {
        tags: ["Coupons"],
        summary: "[Admin] Archive (deactivate) a coupon",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Coupon archived" },
          "403": { description: "Admin only" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // BLOGS  –  /api/blogs/*
    // ════════════════════════════════════════════════════════════════════════
    "/blogs": {
      get: {
        tags: ["Blogs"],
        summary: "List published blogs",
        security: [],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 10 } },
          { name: "tag", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Blog list" } },
      },
      post: {
        tags: ["Blogs"],
        summary: "[Admin] Create blog post",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["title", "body"],
                properties: {
                  title: { type: "string" },
                  body: { type: "string" },
                  tags: { type: "string" },
                  status: { type: "string", enum: ["draft", "published", "scheduled"] },
                  publishAt: { type: "string", format: "date-time" },
                  coverImage: { type: "string", format: "binary" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Blog created" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/blogs/admin/all": {
      get: {
        tags: ["Blogs"],
        summary: "[Admin] List all blogs including drafts",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "All blogs" } },
      },
    },
    "/blogs/admin/analytics": {
      get: {
        tags: ["Blogs"],
        summary: "[Admin] Blog performance analytics",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Analytics data" } },
      },
    },
    "/blogs/{slug}": {
      get: {
        tags: ["Blogs"],
        summary: "Get blog post by slug",
        security: [],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Blog post" },
          "404": { description: "Not found" },
        },
      },
    },
    "/blogs/{id}": {
      patch: {
        tags: ["Blogs"],
        summary: "[Admin] Update blog post by MongoDB id",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  body: { type: "string" },
                  status: { type: "string", enum: ["draft", "published", "scheduled"] },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Blog updated" },
          "403": { description: "Admin only" },
        },
      },
      delete: {
        tags: ["Blogs"],
        summary: "[Admin] Delete blog post by MongoDB id",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Blog deleted" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/blogs/{slug}/related": {
      get: {
        tags: ["Blogs"],
        summary: "Get related blog posts",
        security: [],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
          { name: "limit", in: "query", schema: { type: "integer", default: 3 } },
        ],
        responses: { "200": { description: "Related blogs" } },
      },
    },
    "/blogs/{slug}/track-shop-click": {
      post: {
        tags: ["Blogs"],
        summary: "Track a shop-link click from a blog post",
        security: [],
        parameters: [
          { name: "slug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Click tracked" } },
      },
    },
    "/blogs/{id}/like": {
      post: {
        tags: ["Blogs"],
        summary: "Toggle like on a blog post",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Like toggled" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/blogs/{id}/comments": {
      post: {
        tags: ["Blogs"],
        summary: "Add a comment to a blog post",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["body"],
                properties: { body: { type: "string" } },
              },
            },
          },
        },
        responses: {
          "201": { description: "Comment added" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/blogs/{id}/comments/{commentId}": {
      delete: {
        tags: ["Blogs"],
        summary: "Delete a comment (own or admin)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "commentId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Comment deleted" },
          "403": { description: "Not the owner or admin" },
        },
      },
    },
    "/blogs/{id}/images/{publicId}": {
      delete: {
        tags: ["Blogs"],
        summary: "[Admin] Delete a blog image by Cloudinary publicId",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
          { name: "publicId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Image deleted" },
          "403": { description: "Admin only" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // NEWSLETTER  –  /api/newsletter/*
    // ════════════════════════════════════════════════════════════════════════
    "/newsletter/subscribe": {
      post: {
        tags: ["Newsletter"],
        summary: "Subscribe an email to the newsletter",
        security: [],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["email"],
                properties: { email: { type: "string", format: "email" } },
              },
            },
          },
        },
        responses: {
          "200": { description: "Subscribed (or already subscribed)" },
          "429": { description: "Rate limited" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // NOTIFICATIONS  –  /api/notifications/*  (all protected)
    // ════════════════════════════════════════════════════════════════════════
    "/notifications": {
      get: {
        tags: ["Notifications"],
        summary: "Get current user's notifications",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "unreadOnly", in: "query", schema: { type: "boolean" } },
        ],
        responses: {
          "200": { description: "Notification list" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/notifications/preferences": {
      get: {
        tags: ["Notifications"],
        summary: "Get notification preference settings",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Preference object" } },
      },
      patch: {
        tags: ["Notifications"],
        summary: "Update notification preferences",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  orderUpdates: { type: "boolean" },
                  promotions: { type: "boolean" },
                  newBlogPosts: { type: "boolean" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Preferences updated" } },
      },
    },
    "/notifications/mark-all-read": {
      patch: {
        tags: ["Notifications"],
        summary: "Mark all notifications as read",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "All marked read" } },
      },
    },
    "/notifications/clear-all": {
      delete: {
        tags: ["Notifications"],
        summary: "Delete all notifications for current user",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Notifications cleared" } },
      },
    },
    "/notifications/push/public-key": {
      get: {
        tags: ["Notifications"],
        summary: "Get VAPID public key for Web Push",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "{ publicKey: string }" } },
      },
    },
    "/notifications/push/subscribe": {
      post: {
        tags: ["Notifications"],
        summary: "Subscribe browser to Web Push notifications",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/PushSubscribeBody" } },
          },
        },
        responses: {
          "200": { description: "Push subscription saved" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/notifications/push/unsubscribe": {
      post: {
        tags: ["Notifications"],
        summary: "Unsubscribe browser from Web Push",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { endpoint: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Unsubscribed" } },
      },
    },
    "/notifications/push/expo": {
      post: {
        tags: ["Notifications"],
        summary: "Register Expo push token (mobile)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ExpoPushBody" } },
          },
        },
        responses: { "200": { description: "Expo token registered" } },
      },
      delete: {
        tags: ["Notifications"],
        summary: "Unregister Expo push token",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/ExpoPushBody" } },
          },
        },
        responses: { "200": { description: "Expo token removed" } },
      },
    },
    "/notifications/push/test-self": {
      post: {
        tags: ["Notifications"],
        summary: "Send a test push notification to current user (dev/debug)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Test push dispatched" } },
      },
    },
    "/notifications/{id}/read": {
      patch: {
        tags: ["Notifications"],
        summary: "Mark a single notification as read",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Notification marked read" },
          "404": { description: "Not found" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // GIFTING  –  /api/gifting/*
    // ════════════════════════════════════════════════════════════════════════
    "/gifting/products": {
      get: {
        tags: ["Gifting"],
        summary: "List giftable products",
        security: [],
        responses: { "200": { description: "Giftable product list" } },
      },
    },
    "/gifting/categories": {
      get: {
        tags: ["Gifting"],
        summary: "List gift categories",
        security: [],
        responses: { "200": { description: "Gift category list" } },
      },
    },
    "/gifting/requests": {
      get: {
        tags: ["Gifting"],
        summary: "[Admin] List all gifting requests",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Gifting request list" } },
      },
      post: {
        tags: ["Gifting"],
        summary: "Submit a gifting request",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                allOf: [{ $ref: "#/components/schemas/SubmitGiftingRequestBody" }],
                properties: {
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "Gifting request submitted" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/gifting/my-requests": {
      get: {
        tags: ["Gifting"],
        summary: "Get current user's gifting requests",
        security: [{ cookieAuth: [] }],
        responses: {
          "200": { description: "User's gifting requests" },
          "401": { description: "Not authenticated" },
        },
      },
    },
    "/gifting/requests/{id}": {
      get: {
        tags: ["Gifting"],
        summary: "Get a gifting request by ID",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Gifting request detail" },
          "403": { description: "Access denied" },
          "404": { description: "Not found" },
        },
      },
      patch: {
        tags: ["Gifting"],
        summary: "[Admin] Update gifting request (status, quote, etc.)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  status: { type: "string", enum: ["pending", "quoted", "accepted", "rejected", "fulfilled"] },
                  quotedAmount: { type: "number" },
                  adminNote: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Gifting request updated" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/gifting/requests/{id}/respond": {
      post: {
        tags: ["Gifting"],
        summary: "User responds to a gifting quote (accept/reject)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["response"],
                properties: {
                  response: { type: "string", enum: ["accepted", "rejected"] },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Response recorded" },
          "400": { description: "Request not in quotable state" },
          "401": { description: "Not authenticated" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // STOREFRONT  –  /api/storefront/*
    // ════════════════════════════════════════════════════════════════════════
    "/storefront/settings": {
      get: {
        tags: ["Storefront"],
        summary: "Get public storefront settings (banners, SEO, social links, etc.)",
        security: [],
        responses: { "200": { description: "Storefront settings payload" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // WEBHOOKS  –  /api/webhooks/*
    // ════════════════════════════════════════════════════════════════════════
    "/webhooks/razorpay": {
      post: {
        tags: ["Webhooks"],
        summary: "Razorpay payment webhook (HMAC-verified)",
        description:
          "Receives Razorpay webhook events. The body must be raw (not JSON-parsed). " +
          "The `X-Razorpay-Signature` header is validated using the Razorpay webhook secret.",
        security: [],
        parameters: [
          {
            name: "X-Razorpay-Signature",
            in: "header",
            required: true,
            schema: { type: "string" },
          },
        ],
        requestBody: {
          required: true,
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: {
          "200": { description: "Webhook processed" },
          "400": { description: "Invalid signature" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Analytics / Revenue / Security
    // ════════════════════════════════════════════════════════════════════════
    "/admin/analytics": {
      get: {
        tags: ["Admin – Analytics"],
        summary: "Dashboard analytics overview",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "period", in: "query", schema: { type: "string", example: "30d" } },
        ],
        responses: { "200": { description: "Dashboard analytics data" } },
      },
    },
    "/admin/revenue/summary": {
      get: {
        tags: ["Admin – Analytics"],
        summary: "Revenue period summary (gross, net, refunds)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Revenue summary" } },
      },
    },
    "/admin/security/audit": {
      get: {
        tags: ["Admin – Analytics"],
        summary: "Security audit logs",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: { "200": { description: "Audit log entries" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – AI (Groq)
    // ════════════════════════════════════════════════════════════════════════
    "/admin/ai/status": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI feature status (is Groq configured?)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "{ enabled: boolean }" } },
      },
    },
    "/admin/ai/daily-brief": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI-generated daily business brief (SSE stream)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "date", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: {
          "200": {
            description: "SSE stream of AI brief text",
            content: { "text/event-stream": { schema: { type: "string" } } },
          },
        },
      },
    },
    "/admin/ai/action-suggestions": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI-suggested admin actions based on current store state",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "SSE stream of suggestions" } },
      },
    },
    "/admin/ai/explain/order/{orderId}": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI explanation / summary for a specific order",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "orderId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/explain/user/{userId}": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI insight summary for a specific user",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "userId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/explain/returns": {
      get: {
        tags: ["Admin – AI"],
        summary: "AI analysis of current returns trend",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/draft/product": {
      post: {
        tags: ["Admin – AI"],
        summary: "AI-draft product description / copy",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["productId"],
                properties: {
                  productId: { type: "string" },
                  tone: { type: "string", example: "luxury" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "SSE stream of generated copy" } },
      },
    },
    "/admin/ai/draft/review/{reviewId}": {
      post: {
        tags: ["Admin – AI"],
        summary: "AI-draft reply to a customer review",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "reviewId", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/draft/marketing-email": {
      post: {
        tags: ["Admin – AI"],
        summary: "AI-draft marketing email",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  campaign: { type: "string" },
                  audience: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/draft/blog": {
      post: {
        tags: ["Admin – AI"],
        summary: "AI-draft a blog post",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  topic: { type: "string" },
                  tone: { type: "string" },
                  wordCount: { type: "integer" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "SSE stream of blog post" } },
      },
    },
    "/admin/ai/blog-calendar/plan": {
      post: {
        tags: ["Admin – AI"],
        summary: "AI-plan a blog content calendar",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  months: { type: "integer", example: 3 },
                  themes: { type: "array", items: { type: "string" } },
                },
              },
            },
          },
        },
        responses: { "200": { description: "SSE stream" } },
      },
    },
    "/admin/ai/ask": {
      post: {
        tags: ["Admin – AI"],
        summary: "Ask the AI anything about the store (RAG-powered)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["question"],
                properties: { question: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "SSE stream of AI answer" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Products
    // ════════════════════════════════════════════════════════════════════════
    "/admin/products": {
      get: {
        tags: ["Admin – Products"],
        summary: "List all products with full admin data (inventory, revenue, etc.)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "sort", in: "query", schema: { type: "string" } },
          { name: "category", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Admin product list" } },
      },
    },
    "/admin/products/search": {
      get: {
        tags: ["Admin – Products"],
        summary: "Admin product full-text search",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "q", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Search results" } },
      },
    },
    "/admin/products/{id}": {
      get: {
        tags: ["Admin – Products"],
        summary: "Get full admin product detail by ID",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: {
          "200": { description: "Product detail (admin view)" },
          "404": { description: "Not found" },
        },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Orders
    // ════════════════════════════════════════════════════════════════════════
    "/admin/orders": {
      get: {
        tags: ["Admin – Orders"],
        summary: "List all orders",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Paginated order list" } },
      },
    },
    "/admin/orders/offline": {
      post: {
        tags: ["Admin – Orders"],
        summary: "Create an offline (walk-in) order",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateOfflineOrderBody" } },
          },
        },
        responses: {
          "201": { description: "Offline order created" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/admin/orders/{id}": {
      get: {
        tags: ["Admin – Orders"],
        summary: "Get full order detail",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Order detail" },
          "404": { description: "Not found" },
        },
      },
      delete: {
        tags: ["Admin – Orders"],
        summary: "Delete an order record",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Order deleted" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/admin/orders/{id}/status": {
      patch: {
        tags: ["Admin – Orders"],
        summary: "Update order status (processing → shipped → delivered, etc.)",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["status"],
                properties: {
                  status: { type: "string", enum: ["processing", "confirmed", "shipped", "delivered", "cancelled"] },
                  trackingNumber: { type: "string", nullable: true },
                  courierName: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Status updated" },
          "400": { description: "Invalid status transition" },
        },
      },
    },
    "/admin/orders/{id}/generate-invoice": {
      post: {
        tags: ["Admin – Orders"],
        summary: "Generate PDF invoice for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: {
          "200": { description: "Invoice PDF URL returned" },
          "404": { description: "Order not found" },
        },
      },
    },
    "/admin/orders/{id}/refund": {
      post: {
        tags: ["Admin – Orders"],
        summary: "Process a Razorpay refund for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  amount: { type: "number", description: "Partial refund amount (omit for full refund)" },
                  reason: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Refund initiated" },
          "400": { description: "Refund not possible" },
        },
      },
    },
    "/admin/orders/{id}/return/resolve": {
      patch: {
        tags: ["Admin – Orders"],
        summary: "Resolve a return request (approve / reject)",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["resolution"],
                properties: {
                  resolution: { type: "string", enum: ["approved", "rejected"] },
                  note: { type: "string" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Return resolved" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Delhivery (Shipping)
    // ════════════════════════════════════════════════════════════════════════
    "/admin/delhivery/status": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Check Delhivery integration status / credentials",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "{ enabled: boolean, configured: boolean }" } },
      },
    },
    "/admin/delhivery/serviceability": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Check Delhivery serviceability for a PIN code",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "pin", in: "query", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Serviceability result" } },
      },
    },
    "/admin/orders/{id}/delhivery/pin-check": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Check serviceability for the delivery PIN of an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Pin serviceability" } },
      },
    },
    "/admin/orders/{id}/delhivery/estimate": {
      post: {
        tags: ["Admin – Shipping"],
        summary: "Estimate Delhivery shipping cost for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: { weight: { type: "number", description: "kg" } },
              },
            },
          },
        },
        responses: { "200": { description: "Shipping estimate" } },
      },
    },
    "/admin/orders/{id}/delhivery/create-shipment": {
      post: {
        tags: ["Admin – Shipping"],
        summary: "Create Delhivery shipment for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  weight: { type: "number" },
                  dimensions: {
                    type: "object",
                    properties: {
                      length: { type: "number" },
                      breadth: { type: "number" },
                      height: { type: "number" },
                    },
                  },
                },
              },
            },
          },
        },
        responses: {
          "200": { description: "Shipment created, waybill number returned" },
          "400": { description: "Shipment already exists or invalid" },
        },
      },
    },
    "/admin/orders/{id}/delhivery/sync-tracking": {
      post: {
        tags: ["Admin – Shipping"],
        summary: "Manually sync Delhivery tracking for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Tracking synced" } },
      },
    },
    "/admin/orders/{id}/delhivery/packing-slip": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Get packing slip HTML for an order",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "HTML packing slip" } },
      },
    },
    "/admin/orders/{id}/delhivery/packing-slip/file": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Download packing slip as a file",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Packing slip file stream" } },
      },
    },
    "/admin/orders/{id}/delhivery/packing-slip/json": {
      get: {
        tags: ["Admin – Shipping"],
        summary: "Get packing slip data as JSON",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Packing slip JSON" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Returns
    // ════════════════════════════════════════════════════════════════════════
    "/admin/returns": {
      get: {
        tags: ["Admin – Returns"],
        summary: "List return requests",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "status", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Return request list" } },
      },
    },
    "/admin/returns/insights": {
      get: {
        tags: ["Admin – Returns"],
        summary: "Returns analytics / insights",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Returns insights" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Users
    // ════════════════════════════════════════════════════════════════════════
    "/admin/users": {
      get: {
        tags: ["Admin – Users"],
        summary: "List all registered users",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
          { name: "search", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "User list" } },
      },
    },
    "/admin/users/stats": {
      get: {
        tags: ["Admin – Users"],
        summary: "User directory statistics (total, active, new this month)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "User stats" } },
      },
    },
    "/admin/offline-customers": {
      get: {
        tags: ["Admin – Users"],
        summary: "List offline (walk-in) customers",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        ],
        responses: { "200": { description: "Offline customer list" } },
      },
    },
    "/admin/users/{id}/insights": {
      get: {
        tags: ["Admin – Users"],
        summary: "AI-enriched insights for a single user",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "User insights" } },
      },
    },
    "/admin/users/{id}/toggle-status": {
      patch: {
        tags: ["Admin – Users"],
        summary: "Toggle user active / suspended status",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Status toggled" } },
      },
    },
    "/admin/users/{id}/role": {
      patch: {
        tags: ["Admin – Users"],
        summary: "Update user role (user → admin or vice versa)",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["role"],
                properties: { role: { type: "string", enum: ["user", "admin"] } },
              },
            },
          },
        },
        responses: { "200": { description: "Role updated" } },
      },
    },
    "/admin/users/{id}/note": {
      patch: {
        tags: ["Admin – Users"],
        summary: "Add / update admin note on a user",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["note"],
                properties: { note: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Note saved" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Reviews
    // ════════════════════════════════════════════════════════════════════════
    "/admin/reviews": {
      get: {
        tags: ["Admin – Reviews"],
        summary: "List all reviews (including flagged / unreported)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "status", in: "query", schema: { type: "string" } },
          { name: "reported", in: "query", schema: { type: "boolean" } },
        ],
        responses: { "200": { description: "Review list" } },
      },
    },
    "/admin/reviews/{id}": {
      delete: {
        tags: ["Admin – Reviews"],
        summary: "Delete a review",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Review deleted" } },
      },
    },
    "/admin/reviews/{id}/reply": {
      patch: {
        tags: ["Admin – Reviews"],
        summary: "Post admin reply to a review",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["reply"],
                properties: { reply: { type: "string" } },
              },
            },
          },
        },
        responses: { "200": { description: "Reply added" } },
      },
    },
    "/admin/reviews/{id}/moderate": {
      patch: {
        tags: ["Admin – Reviews"],
        summary: "Moderate a review (approve / hide)",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["action"],
                properties: { action: { type: "string", enum: ["approve", "hide"] } },
              },
            },
          },
        },
        responses: { "200": { description: "Review moderated" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Marketing / Emails
    // ════════════════════════════════════════════════════════════════════════
    "/admin/emails/audience-preview": {
      get: {
        tags: ["Admin – Marketing"],
        summary: "Preview audience size for a marketing email filter",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "audience", in: "query", required: true, schema: { type: "string", enum: ["all", "active", "inactive", "segment"] } },
        ],
        responses: { "200": { description: "Audience count preview" } },
      },
    },
    "/admin/emails/send": {
      post: {
        tags: ["Admin – Marketing"],
        summary: "Send bulk marketing email",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/SendMarketingEmailBody" } },
          },
        },
        responses: {
          "200": { description: "Email queued / sent" },
          "403": { description: "Admin only" },
        },
      },
    },
    "/admin/newsletter-subscribers": {
      get: {
        tags: ["Admin – Marketing"],
        summary: "List newsletter subscribers",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
        ],
        responses: { "200": { description: "Subscriber list" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Storefront Settings
    // ════════════════════════════════════════════════════════════════════════
    "/admin/storefront/settings": {
      get: {
        tags: ["Admin – Storefront"],
        summary: "Get storefront settings (admin view)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Full storefront settings" } },
      },
      patch: {
        tags: ["Admin – Storefront"],
        summary: "Update storefront settings (banners, SEO, social links, logo, etc.)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  siteName: { type: "string" },
                  logo: { type: "string", format: "binary" },
                  bannerImages: { type: "array", items: { type: "string", format: "binary" } },
                  settings: { type: "string", description: "JSON string of settings fields" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Settings updated" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Sales Invoices
    // ════════════════════════════════════════════════════════════════════════
    "/admin/invoices": {
      get: {
        tags: ["Admin – Invoices"],
        summary: "List admin B2B / bulk sales invoices",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "limit", in: "query", schema: { type: "integer", default: 20 } },
        ],
        responses: { "200": { description: "Invoice list" } },
      },
      post: {
        tags: ["Admin – Invoices"],
        summary: "Create a new sales invoice",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["customerName", "items"],
                properties: {
                  customerName: { type: "string" },
                  customerGstin: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        description: { type: "string" },
                        quantity: { type: "integer" },
                        unitPrice: { type: "number" },
                        gstRate: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Invoice created" } },
      },
    },
    "/admin/invoices/{id}": {
      get: {
        tags: ["Admin – Invoices"],
        summary: "Get invoice by ID",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Invoice detail" } },
      },
      put: {
        tags: ["Admin – Invoices"],
        summary: "Replace / update invoice",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Invoice updated" } },
      },
      delete: {
        tags: ["Admin – Invoices"],
        summary: "Delete invoice",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Invoice deleted" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Categories
    // ════════════════════════════════════════════════════════════════════════
    "/admin/categories": {
      get: {
        tags: ["Admin – Categories"],
        summary: "List all categories (admin)",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Category list" } },
      },
      post: {
        tags: ["Admin – Categories"],
        summary: "Create category",
        security: [{ cookieAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string" },
                  slug: { type: "string" },
                  description: { type: "string" },
                  image: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Category created" } },
      },
    },
    "/admin/categories/{id}": {
      patch: {
        tags: ["Admin – Categories"],
        summary: "Update category",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  image: { type: "string", format: "binary" },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Category updated" } },
      },
      delete: {
        tags: ["Admin – Categories"],
        summary: "Delete category",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Category deleted" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Inventory
    // ════════════════════════════════════════════════════════════════════════
    "/admin/inventory": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "Inventory overview (stock levels, low-stock alerts)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "lowStock", in: "query", schema: { type: "boolean" } },
          { name: "category", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Inventory overview" } },
      },
    },
    "/admin/inventory/products/{id}/variants/{sku}/stock": {
      patch: {
        tags: ["Admin – Inventory"],
        summary: "Adjust stock for a product variant",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "id", in: "path", required: true, schema: { type: "string" }, description: "Product ID" },
          { name: "sku", in: "path", required: true, schema: { type: "string" } },
        ],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/StockAdjustmentBody" } },
          },
        },
        responses: { "200": { description: "Stock adjusted" } },
      },
    },
    "/admin/inventory/ledger": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "Stock movement ledger",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Ledger entries" } },
      },
    },
    "/admin/inventory/valuation": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "Inventory valuation report",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Valuation data" } },
      },
    },
    "/admin/inventory/purchase-invoices": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "List purchase invoices (goods received)",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
        ],
        responses: { "200": { description: "Purchase invoice list" } },
      },
      post: {
        tags: ["Admin – Inventory"],
        summary: "Create purchase invoice",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["supplierName", "items"],
                properties: {
                  supplierName: { type: "string" },
                  items: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        productId: { type: "string" },
                        sku: { type: "string" },
                        quantity: { type: "integer" },
                        unitCost: { type: "number" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Purchase invoice created" } },
      },
    },
    "/admin/inventory/purchase-invoices/{id}": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "Get purchase invoice by ID",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Purchase invoice detail" } },
      },
      put: {
        tags: ["Admin – Inventory"],
        summary: "Update purchase invoice",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: { content: { "application/json": { schema: { type: "object" } } } },
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        tags: ["Admin – Inventory"],
        summary: "Delete purchase invoice",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" } },
      },
    },
    "/admin/inventory/gst-summary": {
      get: {
        tags: ["Admin – Inventory"],
        summary: "GST purchase summary for tax filing",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "GST summary" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Operating Expenses
    // ════════════════════════════════════════════════════════════════════════
    "/admin/operating-expenses": {
      get: {
        tags: ["Admin – Expenses"],
        summary: "List operating expenses",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "page", in: "query", schema: { type: "integer", default: 1 } },
          { name: "category", in: "query", schema: { type: "string" } },
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Expense list" } },
      },
      post: {
        tags: ["Admin – Expenses"],
        summary: "Create operating expense record",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateOperatingExpenseBody" } },
          },
        },
        responses: { "201": { description: "Expense created" } },
      },
    },
    "/admin/operating-expenses/summary": {
      get: {
        tags: ["Admin – Expenses"],
        summary: "Operating expense summary by category / period",
        security: [{ cookieAuth: [] }],
        parameters: [
          { name: "from", in: "query", schema: { type: "string", format: "date" } },
          { name: "to", in: "query", schema: { type: "string", format: "date" } },
        ],
        responses: { "200": { description: "Expense summary" } },
      },
    },
    "/admin/operating-expenses/{id}": {
      put: {
        tags: ["Admin – Expenses"],
        summary: "Update operating expense",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/CreateOperatingExpenseBody" } },
          },
        },
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        tags: ["Admin – Expenses"],
        summary: "Void / delete operating expense",
        security: [{ cookieAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Voided" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // ADMIN – Blog Content Plans (Calendar)
    // ════════════════════════════════════════════════════════════════════════
    "/admin/blog-content-plans": {
      get: {
        tags: ["Admin – Blog Calendar"],
        summary: "List blog content plan entries",
        security: [{ cookieAuth: [] }],
        responses: { "200": { description: "Content plan list" } },
      },
      post: {
        tags: ["Admin – Blog Calendar"],
        summary: "Create a blog content plan entry",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["title", "scheduledDate"],
                properties: {
                  title: { type: "string" },
                  scheduledDate: { type: "string", format: "date" },
                  topic: { type: "string" },
                  assignedTo: { type: "string" },
                  status: { type: "string", enum: ["idea", "in-progress", "done"] },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Plan entry created" } },
      },
    },
    "/admin/blog-content-plans/bulk": {
      post: {
        tags: ["Admin – Blog Calendar"],
        summary: "Bulk create blog content plan entries (e.g. from AI calendar plan)",
        security: [{ cookieAuth: [] }],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["plans"],
                properties: {
                  plans: {
                    type: "array",
                    items: {
                      type: "object",
                      properties: {
                        title: { type: "string" },
                        scheduledDate: { type: "string", format: "date" },
                        topic: { type: "string" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Plans created" } },
      },
    },
    "/admin/blog-content-plans/{id}": {
      patch: {
        tags: ["Admin – Blog Calendar"],
        summary: "Update a blog content plan entry",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "application/json": { schema: { type: "object" } },
          },
        },
        responses: { "200": { description: "Updated" } },
      },
      delete: {
        tags: ["Admin – Blog Calendar"],
        summary: "Delete a blog content plan entry",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" } },
      },
    },

    // ════════════════════════════════════════════════════════════════════════
    // SALES / COLLECTIONS / TESTIMONIALS / REVIEW INVITES / RANI CARE / NAV
    // ════════════════════════════════════════════════════════════════════════
    "/sales/public": {
      get: {
        tags: ["Sales"],
        summary: "List active public sale campaigns",
        security: [],
        responses: { "200": { description: "Public sales" } },
      },
    },
    "/sales/preview": {
      post: {
        tags: ["Sales"],
        summary: "[Admin] Preview sale campaign pricing",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Preview result" }, "403": { description: "Admin only" } },
      },
    },
    "/sales": {
      get: {
        tags: ["Sales"],
        summary: "[Admin] List all sale campaigns",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Sale campaigns" }, "403": { description: "Admin only" } },
      },
      post: {
        tags: ["Sales"],
        summary: "[Admin] Create sale campaign",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: { type: "object", properties: { image: { type: "string", format: "binary" } } },
            },
          },
        },
        responses: { "201": { description: "Created" }, "403": { description: "Admin only" } },
      },
    },
    "/sales/{id}": {
      get: {
        tags: ["Sales"],
        summary: "[Admin] Get sale campaign",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Sale campaign" }, "403": { description: "Admin only" } },
      },
      patch: {
        tags: ["Sales"],
        summary: "[Admin] Update sale campaign",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" }, "403": { description: "Admin only" } },
      },
      delete: {
        tags: ["Sales"],
        summary: "[Admin] Delete sale campaign",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" }, "403": { description: "Admin only" } },
      },
    },
    "/sales/{id}/archive": {
      patch: {
        tags: ["Sales"],
        summary: "[Admin] Archive sale campaign",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Archived" }, "403": { description: "Admin only" } },
      },
    },

    "/collections/{catSlug}": {
      get: {
        tags: ["Collections"],
        summary: "Get shop collection (category) details",
        security: [],
        parameters: [{ name: "catSlug", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Collection details" }, "404": { description: "Not found" } },
      },
    },
    "/collections/{catSlug}/products": {
      get: {
        tags: ["Collections"],
        summary: "List products in a collection",
        security: [],
        parameters: [
          { name: "catSlug", in: "path", required: true, schema: { type: "string" } },
          { name: "page", in: "query", schema: { type: "integer" } },
          { name: "limit", in: "query", schema: { type: "integer" } },
          { name: "sort", in: "query", schema: { type: "string" } },
        ],
        responses: { "200": { description: "Products" } },
      },
    },
    "/collections/{catSlug}/filters": {
      get: {
        tags: ["Collections"],
        summary: "Filter facets for a collection",
        security: [],
        parameters: [{ name: "catSlug", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Filters" } },
      },
    },
    "/collections/{catSlug}/{subSlug}": {
      get: {
        tags: ["Collections"],
        summary: "Get subcategory collection details",
        security: [],
        parameters: [
          { name: "catSlug", in: "path", required: true, schema: { type: "string" } },
          { name: "subSlug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Subcollection details" } },
      },
    },
    "/collections/{catSlug}/{subSlug}/products": {
      get: {
        tags: ["Collections"],
        summary: "List products in a subcategory collection",
        security: [],
        parameters: [
          { name: "catSlug", in: "path", required: true, schema: { type: "string" } },
          { name: "subSlug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Products" } },
      },
    },
    "/collections/{catSlug}/{subSlug}/filters": {
      get: {
        tags: ["Collections"],
        summary: "Filter facets for a subcategory collection",
        security: [],
        parameters: [
          { name: "catSlug", in: "path", required: true, schema: { type: "string" } },
          { name: "subSlug", in: "path", required: true, schema: { type: "string" } },
        ],
        responses: { "200": { description: "Filters" } },
      },
    },

    "/testimonials": {
      get: {
        tags: ["Testimonials"],
        summary: "Public approved testimonials",
        security: [],
        responses: { "200": { description: "Testimonials" } },
      },
      post: {
        tags: ["Testimonials"],
        summary: "[Admin] Create testimonial",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "201": { description: "Created" }, "403": { description: "Admin only" } },
      },
    },
    "/testimonials/submit": {
      post: {
        tags: ["Testimonials"],
        summary: "Public testimonial submit (share link)",
        security: [],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  name: { type: "string" },
                  message: { type: "string" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Submitted for review" } },
      },
    },
    "/testimonials/admin": {
      get: {
        tags: ["Testimonials"],
        summary: "[Admin] List all testimonials",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Admin list" }, "403": { description: "Admin only" } },
      },
    },
    "/testimonials/{id}": {
      patch: {
        tags: ["Testimonials"],
        summary: "[Admin] Update testimonial",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" }, "403": { description: "Admin only" } },
      },
      delete: {
        tags: ["Testimonials"],
        summary: "[Admin] Delete testimonial",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" }, "403": { description: "Admin only" } },
      },
    },
    "/testimonials/{id}/approve": {
      patch: {
        tags: ["Testimonials"],
        summary: "[Admin] Approve testimonial",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Approved" }, "403": { description: "Admin only" } },
      },
    },
    "/testimonials/{id}/reject": {
      patch: {
        tags: ["Testimonials"],
        summary: "[Admin] Reject testimonial",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Rejected" }, "403": { description: "Admin only" } },
      },
    },

    "/review-invites/{token}": {
      get: {
        tags: ["Review Invites"],
        summary: "Get public review invite by token",
        security: [],
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Invite details" }, "404": { description: "Invalid/expired" } },
      },
    },
    "/review-invites/{token}/submit": {
      post: {
        tags: ["Review Invites"],
        summary: "Submit review via invite token",
        security: [],
        parameters: [{ name: "token", in: "path", required: true, schema: { type: "string" } }],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  rating: { type: "integer", minimum: 1, maximum: 5 },
                  title: { type: "string" },
                  comment: { type: "string" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Review submitted" } },
      },
    },

    "/rani-care/status": {
      get: {
        tags: ["Rani Care"],
        summary: "Rani Care chat availability status",
        security: [],
        responses: { "200": { description: "Status" } },
      },
    },
    "/rani-care/chat": {
      post: {
        tags: ["Rani Care"],
        summary: "Send a Rani Care chat message",
        security: [],
        requestBody: {
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["message"],
                properties: {
                  message: { type: "string" },
                  sessionId: { type: "string", nullable: true },
                },
              },
            },
          },
        },
        responses: { "200": { description: "Assistant reply" } },
      },
    },

    "/navigation/mega-menu": {
      get: {
        tags: ["Navigation"],
        summary: "Navbar mega-menu categories + subcategories",
        security: [],
        responses: { "200": { description: "Mega menu tree" } },
      },
    },

    "/coupons/public": {
      get: {
        tags: ["Coupons"],
        summary: "Public coupon banners / offers",
        security: [],
        responses: { "200": { description: "Public coupons" } },
      },
    },
    "/storefront/visit": {
      post: {
        tags: ["Storefront"],
        summary: "Record a storefront visit (analytics)",
        security: [],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Recorded" } },
      },
    },
    "/storefront/meta-event": {
      post: {
        tags: ["Storefront"],
        summary: "Forward Meta CAPI browser event",
        security: [],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Forwarded" } },
      },
    },
    "/categories/slug/{slug}": {
      get: {
        tags: ["Categories"],
        summary: "Get category by slug",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Category" }, "404": { description: "Not found" } },
      },
    },
    "/categories/slug/{slug}/subcategories": {
      get: {
        tags: ["Categories"],
        summary: "List subcategories for a category slug",
        security: [],
        parameters: [{ name: "slug", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Subcategories" } },
      },
    },
    "/reviews/submit-public": {
      post: {
        tags: ["Reviews"],
        summary: "Public review submit (tokenized / guest flows)",
        security: [],
        requestBody: {
          content: {
            "multipart/form-data": {
              schema: {
                type: "object",
                properties: {
                  rating: { type: "integer" },
                  comment: { type: "string" },
                  images: { type: "array", items: { type: "string", format: "binary" } },
                },
              },
            },
          },
        },
        responses: { "201": { description: "Submitted" } },
      },
    },

    "/admin/ai/draft/catalog-seo": {
      post: {
        tags: ["Admin – AI"],
        summary: "[Admin] Draft catalog SEO copy",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Draft SEO" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/orders/{id}/review-invite": {
      post: {
        tags: ["Admin – Orders"],
        summary: "[Admin] Create review invite for order",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "201": { description: "Invite created" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/orders/{id}/review-invite/email": {
      post: {
        tags: ["Admin – Orders"],
        summary: "[Admin] Email review invite for order",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Email queued" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/categories/{id}/subcategories": {
      get: {
        tags: ["Admin – Categories"],
        summary: "[Admin] List subcategories for category",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Subcategories" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/subcategories": {
      get: {
        tags: ["Admin – Categories"],
        summary: "[Admin] List subcategories",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "200": { description: "Subcategories" }, "403": { description: "Admin only" } },
      },
      post: {
        tags: ["Admin – Categories"],
        summary: "[Admin] Create subcategory",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        responses: { "201": { description: "Created" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/subcategories/reorder": {
      patch: {
        tags: ["Admin – Categories"],
        summary: "[Admin] Reorder subcategories",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        requestBody: {
          content: { "application/json": { schema: { type: "object" } } },
        },
        responses: { "200": { description: "Reordered" }, "403": { description: "Admin only" } },
      },
    },
    "/admin/subcategories/{id}": {
      get: {
        tags: ["Admin – Categories"],
        summary: "[Admin] Get subcategory",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Subcategory" }, "403": { description: "Admin only" } },
      },
      patch: {
        tags: ["Admin – Categories"],
        summary: "[Admin] Update subcategory",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Updated" }, "403": { description: "Admin only" } },
      },
      delete: {
        tags: ["Admin – Categories"],
        summary: "[Admin] Delete subcategory",
        security: [{ cookieAuth: [] }, { bearerAuth: [] }],
        parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
        responses: { "200": { description: "Deleted" }, "403": { description: "Admin only" } },
      },
    },
  },
} as const;
