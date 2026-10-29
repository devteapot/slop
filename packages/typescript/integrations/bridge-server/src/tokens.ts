export interface UserTokenRecord {
  userId: string;
  label?: string;
  mcpToken: string;
  relayToken: string;
}

export interface TokenRegistry {
  users: UserTokenRecord[];
  resolveMcpToken(token: string): UserTokenRecord | null;
  resolveRelayToken(token: string): UserTokenRecord | null;
}

type EnvUserRecord = {
  label?: unknown;
  mcpToken?: unknown;
  relayToken?: unknown;
};

const TOKEN_MIN_LENGTH = 16;

export function readTokenRegistryFromEnv(env = process.env): TokenRegistry {
  const raw = env.SLOP_BRIDGE_USERS;
  if (!raw) {
    throw new Error("Missing SLOP_BRIDGE_USERS. Expected JSON mapping user IDs to mcpToken and relayToken.");
  }
  return parseTokenRegistry(raw);
}

export function parseTokenRegistry(raw: string): TokenRegistry {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`SLOP_BRIDGE_USERS is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("SLOP_BRIDGE_USERS must be a JSON object keyed by user id.");
  }

  const usedTokens = new Set<string>();
  const users: UserTokenRecord[] = [];

  for (const [userId, value] of Object.entries(parsed as Record<string, EnvUserRecord>)) {
    if (!isValidUserId(userId)) {
      throw new Error(`Invalid bridge user id "${userId}".`);
    }
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      throw new Error(`Bridge user "${userId}" must be an object.`);
    }

    const mcpToken = readToken(value.mcpToken, `mcpToken for "${userId}"`);
    const relayToken = readToken(value.relayToken, `relayToken for "${userId}"`);
    if (mcpToken === relayToken) {
      throw new Error(`Bridge user "${userId}" must use different MCP and relay tokens.`);
    }
    for (const token of [mcpToken, relayToken]) {
      if (usedTokens.has(token)) {
        throw new Error("SLOP_BRIDGE_USERS contains duplicate tokens.");
      }
      usedTokens.add(token);
    }

    users.push({
      userId,
      label: typeof value.label === "string" ? value.label : undefined,
      mcpToken,
      relayToken,
    });
  }

  if (users.length === 0) {
    throw new Error("SLOP_BRIDGE_USERS must contain at least one user.");
  }

  const mcpByToken = new Map(users.map((user) => [user.mcpToken, user]));
  const relayByToken = new Map(users.map((user) => [user.relayToken, user]));
  return {
    users,
    resolveMcpToken(token: string) {
      return mcpByToken.get(token) ?? null;
    },
    resolveRelayToken(token: string) {
      return relayByToken.get(token) ?? null;
    },
  };
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization");
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1] ?? null;
}

function readToken(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length < TOKEN_MIN_LENGTH) {
    throw new Error(`Invalid ${label}; expected a string with at least ${TOKEN_MIN_LENGTH} characters.`);
  }
  return value;
}

function isValidUserId(value: string): boolean {
  return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(value);
}
