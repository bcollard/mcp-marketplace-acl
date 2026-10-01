// src/server.ts
import type { NextFunction, Request, Response } from "express";
import express from "express";
import cors from "cors";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { exchangeToken, exchangeJwtBearer, rawTokenStorage, tokenExchangeConfig, jwtBearerConfig, decodeJwtClaims, logger } from "./tokenExchange.js";

// -------------------- In-memory data --------------------
const users: Record<string, string> = {
  a1b2c3d4: "Alice Johnson",
  e5f6g7h8: "Bob Smith",
  i9j0k1l2: "Charlie Lee",
  m3n4o5p6: "Diana Evans",
  q7r8s9t0: "Ethan Brown",
  u1v2w3x4: "Fiona Clark",
  y5z6a7b8: "George Harris",
  c9d0e1f2: "Hannah Lewis",
  g3h4i5j6: "Ian Walker",
  k7l8m9n0: "Julia Turner"
};

type Order = { id: string; name: string; userId: string };
const orders: Order[] = [
  { id: "ord001", name: "Sugar (50kg)", userId: "a1b2c3d4" },
  { id: "ord002", name: "Cleaning Supplies Pack", userId: "a1b2c3d4" },
  { id: "ord003", name: "Canned Tomatoes (100 cans)", userId: "a1b2c3d4" },

  { id: "ord004", name: "Flour (100kg)", userId: "e5f6g7h8" },
  { id: "ord005", name: "Dish Soap (10 bottles)", userId: "e5f6g7h8" },
  { id: "ord006", name: "Salt (25kg)", userId: "e5f6g7h8" },

  { id: "ord007", name: "Olive Oil (20L)", userId: "i9j0k1l2" },
  { id: "ord008", name: "Baking Powder (10kg)", userId: "i9j0k1l2" },

  { id: "ord009", name: "Rice (200kg)", userId: "m3n4o5p6" },
  { id: "ord010", name: "Vegetable Oil (15L)", userId: "m3n4o5p6" },
  { id: "ord011", name: "Pasta (80kg)", userId: "m3n4o5p6" },
  { id: "ord012", name: "Canned Beans (50 cans)", userId: "m3n4o5p6" },

  { id: "ord013", name: "Toilet Paper (Case of 48)", userId: "q7r8s9t0" },
  { id: "ord014", name: "Hand Sanitizer (20 bottles)", userId: "q7r8s9t0" },

  { id: "ord015", name: "Laundry Detergent (10L)", userId: "u1v2w3x4" },
  { id: "ord016", name: "Trash Bags (100 ct)", userId: "u1v2w3x4" },
  { id: "ord017", name: "Disinfectant Spray (5 bottles)", userId: "u1v2w3x4" },

  { id: "ord018", name: "Coffee Beans (30kg)", userId: "k7l8m9n0" },
  { id: "ord019", name: "Tea Bags (500ct)", userId: "k7l8m9n0" },
  { id: "ord020", name: "Condensed Milk (40 cans)", userId: "k7l8m9n0" },

  { id: "ord021", name: "Paper Towels (24 rolls)", userId: "g3h4i5j6" },
  { id: "ord022", name: "Broom & Mop Set", userId: "g3h4i5j6" },

  { id: "ord023", name: "Cereal (20 boxes)", userId: "c9d0e1f2" },
  { id: "ord024", name: "Powdered Milk (10kg)", userId: "c9d0e1f2" },
  { id: "ord025", name: "Snacks Variety Pack", userId: "c9d0e1f2" },

  { id: "ord026", name: "Cooking Gas Cylinder", userId: "y5z6a7b8" },
  { id: "ord027", name: "Napkins (1000ct)", userId: "y5z6a7b8" }
];

// -------------------- MCP Server --------------------
const server = new McpServer({
  name: "Marketplace MCP Server - Demo",
  version: "1.6.0"
});

// Tool: list all users
server.registerTool(
  "list_users",
  {
    title: "List Users",
    description: "List all users (id, fullName).",
    inputSchema: {}, // no args
    outputSchema: {
      users: z.array(z.object({ id: z.string(), fullName: z.string() }))
    }
  },
  async () => {
    logger.info("[tool:list_users] called");
    const list = Object.entries(users).map(([id, fullName]) => ({ id, fullName }));
    const output = { users: list };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: get one user by id
server.registerTool(
  "get_user",
  {
    title: "Get User",
    description: "Get a single user by id.",
    inputSchema: { id: z.string() },
    outputSchema: {
      found: z.boolean(),
      user: z.object({ id: z.string(), fullName: z.string() }).nullable()
    }
  },
  async ({ id }) => {
    logger.info(`[tool:get_user] called | args: ${JSON.stringify({ id })}`);
    const fullName = users[id];
    const output =
      fullName != null
        ? { found: true, user: { id, fullName } }
        : { found: false, user: null };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: list all orders
server.registerTool(
  "list_orders",
  {
    title: "List Orders",
    description: "List all orders.",
    inputSchema: {},
    outputSchema: {
      orders: z.array(
        z.object({ id: z.string(), name: z.string(), userId: z.string() })
      )
    }
  },
  async () => {
    logger.info("[tool:list_orders] called");
    const output = { orders };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: list orders for a given userId
server.registerTool(
  "list_orders_for_user",
  {
    title: "List Orders for User",
    description: "List orders by userId.",
    inputSchema: { userId: z.string() },
    outputSchema: {
      userExists: z.boolean(),
      orders: z.array(
        z.object({ id: z.string(), name: z.string(), userId: z.string() })
      )
    }
  },
  async ({ userId }) => {
    logger.info(`[tool:list_orders_for_user] called | args: ${JSON.stringify({ userId })}`);
    const exists = users[userId] != null;
    const userOrders = exists ? orders.filter((o) => o.userId === userId) : [];
    const output = { userExists: !!exists, orders: userOrders };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: search orders by case-insensitive substring
server.registerTool(
  "search_orders",
  {
    title: "Search Orders",
    description: "Search orders by name (case-insensitive substring).",
    inputSchema: { q: z.string().min(1) },
    outputSchema: {
      count: z.number(),
      results: z.array(
        z.object({ id: z.string(), name: z.string(), userId: z.string() })
      )
    }
  },
  async ({ q }) => {
    logger.info(`[tool:search_orders] called | args: ${JSON.stringify({ q })}`);
    const needle = q.toLowerCase();
    const results = orders.filter((o) => o.name.toLowerCase().includes(needle));
    const output = { count: results.length, results };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: call the configured TARGET_RESOURCE using the exchanged token,
// forwarding JWT claims as X-Jwt-* headers so the downstream service can
// identify the caller without re-parsing the token itself.
server.registerTool(
  "play_with_token_exchange",
  {
    title: "Play with token exchange",
    description:
      "Play with token exchange. " +  
      "Calls TARGET_RESOURCE using the exchanged Bearer token. " +
      "Scalar claims from the token (sub, scope, azp, iss, …) are forwarded " +
      "as X-Jwt-<claim> headers. The raw response body is returned as a string.",
    inputSchema: {
      path: z.string().default("/headers").describe("Path appended to TARGET_RESOURCE, e.g. /get or /headers")
    },
    outputSchema: {
      status: z.number(),
      body: z.string()
    }
  },
  async ({ path }) => {
    logger.info(`[tool:play_with_token_exchange] called | args: ${JSON.stringify({ path })}`);
    const authHeader = rawTokenStorage.getStore();
    const isAuthorizationHeader = AUTH_HEADER_NAME === "authorization";

    if (!authHeader) {
      throw new Error(`Request must include a token in the ${AUTH_HEADER_NAME} header`);
    }
    if (isAuthorizationHeader && !authHeader.startsWith("Bearer ")) {
      throw new Error("Request must include a Bearer token in the authorization header");
    }

    const incomingToken = isAuthorizationHeader ? authHeader.slice(7) : authHeader;
    const token = await exchangeToken(incomingToken);
    const claims = decodeJwtClaims(token);

    // Map every scalar claim to an X-Jwt-<claim> header
    const claimHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(claims)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        claimHeaders[`X-Jwt-${key}`] = String(value);
      }
    }

    const url = `${tokenExchangeConfig.targetResource}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...claimHeaders
      }
    });

    const body = await response.text();
    const output = { status: response.status, body };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// Tool: same as play_with_token_exchange but uses RFC 7523 JWT Bearer grant
// with CLIENT_ID_JWT_OTHER_DOMAIN / CLIENT_SECRET_JWT_OTHER_DOMAIN credentials.
server.registerTool(
  "play_with_jwt_bearer",
  {
    title: "Play with JWT Bearer",
    description:
      "Play with JWT Bearer grant (RFC 7523). " +
      "Builds a signed JWT assertion from the caller's sub, exchanges it for an access token " +
      "via the jwt-bearer grant, then calls TARGET_RESOURCE forwarding scalar claims as X-Jwt-* headers.",
    inputSchema: {
      path: z.string().default("/headers").describe("Path appended to TARGET_RESOURCE, e.g. /get or /headers")
    },
    outputSchema: {
      status: z.number(),
      body: z.string()
    }
  },
  async ({ path }) => {
    logger.info(`[tool:play_with_jwt_bearer] called | args: ${JSON.stringify({ path })}`);
    const authHeader = rawTokenStorage.getStore();
    const isAuthorizationHeader = AUTH_HEADER_NAME === "authorization";

    if (!authHeader) {
      throw new Error(`Request must include a token in the ${AUTH_HEADER_NAME} header`);
    }
    if (isAuthorizationHeader && !authHeader.startsWith("Bearer ")) {
      throw new Error("Request must include a Bearer token in the authorization header");
    }

    const incomingToken = isAuthorizationHeader ? authHeader.slice(7) : authHeader;
    const token = await exchangeJwtBearer(incomingToken);
    const claims = decodeJwtClaims(token);

    const claimHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(claims)) {
      if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        claimHeaders[`X-Jwt-${key}`] = String(value);
      }
    }

    const url = `${jwtBearerConfig.targetResource}${path}`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        ...claimHeaders
      }
    });

    const body = await response.text();
    const output = { status: response.status, body };
    return {
      content: [{ type: "text", text: JSON.stringify(output, null, 2) }],
      structuredContent: output
    };
  }
);

// -------------------- HTTP (Streamable) wiring --------------------
const app = express();
app.use(express.json());

const AUTH_HEADER_NAME = (process.env.AUTH_HEADER_NAME || "authorization").toLowerCase();

// CORS: expose the MCP session header for browser clients (per MCP spec session ID mechanism).
// Note: in production, validate allowed origins carefully (see security guidance below).
app.use(
  cors({
    origin: true,
    credentials: false,
    exposedHeaders: ["Mcp-Session-Id"]
  })
);

// Auth middleware: forward the raw auth header value into AsyncLocalStorage.
// Header validation and token exchange are handled by the tools that need them.
app.use("/mcp", (req: Request, _res: Response, next: NextFunction) => {
  const rawAuthHeader = req.headers[AUTH_HEADER_NAME];
  const authHeader = Array.isArray(rawAuthHeader) ? rawAuthHeader[0] : rawAuthHeader;
  rawTokenStorage.run(authHeader ?? "", () => next());
});

// Single MCP endpoint (no REST business routes).
// The SDK handles Streamable HTTP semantics (JSON or SSE responses) behind this transport.
app.post("/mcp", async (req: Request, res: Response) => {
  // Create a fresh transport per request to avoid request-id collisions
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true
    // Optional: add sessionIdGenerator to enable stateful sessions and resumability.
    // sessionIdGenerator: () => crypto.randomUUID(),
    // Optional: enable DNS rebinding protection; also validate Origin in middleware if exposing publicly.
    // enableDnsRebindingProtection: true,
  });

  // Close transport if the client disconnects early
  res.on("close", () => transport.close());

  // Connect the SDK server to the transport and process this HTTP request
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

const PORT = parseInt(process.env.PORT || "3001", 10);
app.listen(PORT, '0.0.0.0', () => {
  console.log(`MCP Server (Streamable HTTP) listening at http://localhost:${PORT}/mcp (auth header: ${AUTH_HEADER_NAME})`);
});
