import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Zoho from "next-auth/providers/zoho";
import Credentials from "next-auth/providers/credentials";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";
import { clientIp, isLoginBlocked, recordLoginAttempt } from "@/lib/login-guard";
import { displayName, isEmailAllowed } from "@/lib/domains";

const headAdminEmail = () => process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase() || null;

/** Zoho accounts server for your data centre: .com (US), .in (India), .eu, .com.au, .jp, .sa, .ca. */
const zohoBase = () => (process.env.ZOHO_ACCOUNTS_URL?.trim() || "https://accounts.zoho.com").replace(/\/+$/, "");

/** Sessions expire 8 hours after sign-in. */
const SESSION_MAX_AGE = 8 * 60 * 60;

async function loggedIn(u: { id: string; email: string; name: string }, ip: string | null, test = false) {
  await Promise.all([
    db.update(users).set({ lastLoginAt: new Date() }).where(eq(users.id, u.id)),
    db.insert(activityLog).values({ userId: u.id, action: "login", ipAddress: ip }),
  ]);
  return { id: u.id, email: u.email, name: u.name, test };
}

const digest = (v: string) => createHash("sha256").update(v).digest();
const same = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** True when a test username/password is configured. Never true in production builds, even if the variables are set. */
export const testLoginEnabled = () =>
  process.env.NODE_ENV !== "production" && !!(process.env.TEST_LOGIN_USER && process.env.TEST_LOGIN_PASSWORD);

class LockedError extends CredentialsSignin {
  code = "Locked";
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      async authorize(c, request) {
        const email = String(c?.email ?? "").trim().toLowerCase();
        const password = String(c?.password ?? "");
        if (!email || !password) return null;
        const ip = clientIp(request.headers);

        if (await isLoginBlocked(email, ip)) throw new LockedError();

        // Optional test login: a fixed username/password from env that signs in as HEAD_ADMIN_EMAIL.
        // Only active outside production, and only when both TEST_LOGIN_USER and TEST_LOGIN_PASSWORD are set.
        if (testLoginEnabled() && same(email, process.env.TEST_LOGIN_USER!.trim().toLowerCase())) {
          const adminEmail = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
          const ok = same(password, process.env.TEST_LOGIN_PASSWORD!) && !!adminEmail;
          await recordLoginAttempt(email, ip, ok);
          if (!ok) return null;
          const [a] = await db.select().from(users).where(eq(users.email, adminEmail!));
          return a?.isActive ? loggedIn(a, ip, true) : null;
        }

        const [u] = await db.select().from(users).where(eq(users.email, email));
        if (!u || !u.passwordHash || !u.isActive || u.status === "rejected") {
          await burnPasswordCheck(password);
          await recordLoginAttempt(email, ip, false);
          return null;
        }
        const ok = await verifyPassword(password, u.passwordHash);
        await recordLoginAttempt(email, ip, ok);
        return ok ? loggedIn(u, ip) : null;
      },
    }),
    // Google sign-up/sign-in, off until credentials are configured. New people become "pending" until an admin accepts them.
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({ authorization: { params: { prompt: "select_account" } } })]
      : []),
    // Zoho sign-up/sign-in (credentials AUTH_ZOHO_ID / AUTH_ZOHO_SECRET). Same approval flow as Google.
    ...(process.env.AUTH_ZOHO_ID && process.env.AUTH_ZOHO_SECRET
      ? [
          Zoho({
            authorization: `${zohoBase()}/oauth/v2/auth?scope=AaaServer.profile.Read`,
            token: `${zohoBase()}/oauth/v2/token`,
            userinfo: `${zohoBase()}/oauth/user/info`,
          }),
        ]
      : []),
  ],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ user, profile, account }) {
      if (account?.provider === "credentials") return true; // already verified in authorize()
      // `user.email` is normalised by each provider (Zoho's raw profile uses `Email`, so `profile.email` is empty).
      const email = (user?.email ?? profile?.email)?.trim().toLowerCase();
      if (!email || profile?.email_verified === false) return "/login?error=NotInvited";
      // Server-side domain enforcement.
      if (!isEmailAllowed(email, account?.provider)) return `/login?error=${account?.provider === "zoho" ? "WrongDomainZoho" : "WrongDomain"}`;

      const isAdmin = email === headAdminEmail();
      let [u] = await db.select().from(users).where(eq(users.email, email));
      if (!u) {
        // First visit: record the request. The person then sets a password and waits for approval (admins are approved at once).
        await db
          .insert(users)
          .values({
            name: displayName(user?.name, email),
            email,
            role: isAdmin ? "head_admin" : "member",
            status: isAdmin ? "approved" : "pending",
            signupSource: account?.provider ?? null,
          })
          .onConflictDoNothing();
        [u] = await db.select().from(users).where(eq(users.email, email));
      } else if (isAdmin && (u.role !== "head_admin" || u.status !== "approved" || !u.isActive)) {
        // The admin named in the environment is always an active, approved head admin.
        [u] = await db.update(users).set({ role: "head_admin", status: "approved", isActive: true }).where(eq(users.id, u.id)).returning();
      }
      if (!u) return "/login?error=NotInvited";
      if (!u.isActive) return "/login?error=Deactivated";
      if (u.status === "rejected") return "/login?error=Rejected";
      if (u.status === "approved") await loggedIn(u, null);
      return true;
    },
    async jwt({ token, profile, user, account }) {
      if (account) token.via = account.provider; // credentials | google | zoho
      if (account?.provider === "credentials" && user?.id) {
        token.uid = user.id;
        // Marks a sign-in through the env test login, which skips the forced password change.
        token.test = !!(user as { test?: boolean }).test;
      }
      // Only present on sign-in: bind the token to our user row.
      const oauthEmail = account && account.provider !== "credentials" ? (user?.email ?? profile?.email) : undefined;
      if (oauthEmail) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, oauthEmail.trim().toLowerCase()));
        if (u) token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session.user as { id?: string; test?: boolean }).id = token.uid as string;
      (session.user as { test?: boolean }).test = !!token.test;
      (session.user as { via?: string }).via = (token.via as string | undefined) ?? "credentials";
      return session;
    },
  },
});
