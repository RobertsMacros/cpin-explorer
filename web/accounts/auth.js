import { betterAuth } from "better-auth";

// Construct per request: bindings and reset callbacks must never leak between requests.
export function accountAuth(env, sendResetPassword = async () => {}) {
  return betterAuth({
    database: env.ACCOUNTS,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.AUTH_ORIGIN,
    trustedOrigins: [env.AUTH_ORIGIN],
    emailAndPassword: {
      enabled: true, minPasswordLength: 12, maxPasswordLength: 128,
      autoSignIn: true, sendResetPassword,
      resetPasswordTokenExpiresIn: 1800, revokeSessionsOnPasswordReset: true,
    },
    user: { additionalFields: {
      approved: { type: "boolean", defaultValue: false, input: false },
      role: { type: "string", defaultValue: "reader", input: false },
    } },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24,
      cookieCache: { enabled: false } },
    advanced: { useSecureCookies: env.AUTH_ORIGIN.startsWith("https:"),
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] } },
    rateLimit: { enabled: true, storage: "database", window: 60, max: 60,
      customRules: { "/sign-up/email": { window: 3600, max: 10 },
        "/sign-in/email": { window: 60, max: 10 },
        "/reset-password": { window: 60, max: 5 } } },
    logger: { disabled: true }, // Never log credentials, session tokens or reset links.
  });
}
