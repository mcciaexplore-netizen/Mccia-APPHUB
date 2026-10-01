import NextAuth, { CredentialsSignin } from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { createHash, timingSafeEqual } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { activityLog, users } from "@/db/schema";
import { burnPasswordCheck, verifyPassword } from "@/lib/passwords";
import { clientIp, isLoginBlocked, recordLoginAttempt } from "@/lib/login-guard";

const domain = () => (process.env.ALLOWED_EMAIL_DOMAIN ?? "").trim().toLowerCase();

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

/** True when a test username/password is configured in the environment. */
export const testLoginEnabled = () => !!(process.env.TEST_LOGIN_USER && process.env.TEST_LOGIN_PASSWORD);

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
        // Only active when both TEST_LOGIN_USER and TEST_LOGIN_PASSWORD are set. Remove them in production.
        if (testLoginEnabled() && same(email, process.env.TEST_LOGIN_USER!.trim().toLowerCase())) {
          const adminEmail = process.env.HEAD_ADMIN_EMAIL?.trim().toLowerCase();
          const ok = same(password, process.env.TEST_LOGIN_PASSWORD!) && !!adminEmail;
          await recordLoginAttempt(email, ip, ok);
          if (!ok) return null;
          const [a] = await db.select().from(users).where(eq(users.email, adminEmail!));
          return a?.isActive ? loggedIn(a, ip, true) : null;
        }

        const [u] = await db.select().from(users).where(eq(users.email, email));
        if (!u || !u.passwordHash || !u.isActive) {
          await burnPasswordCheck(password);
          await recordLoginAttempt(email, ip, false);
          return null;
        }
        const ok = await verifyPassword(password, u.passwordHash);
        await recordLoginAttempt(email, ip, ok);
        return ok ? loggedIn(u, ip) : null;
      },
    }),
    // Google SSO is wired but off until credentials are configured. Invite-only: the email must already exist.
    ...(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET
      ? [Google({ authorization: { params: { hd: domain() || undefined, prompt: "select_account" } } })]
      : []),
  ],
  session: { strategy: "jwt", maxAge: SESSION_MAX_AGE },
  pages: { signIn: "/login", error: "/login" },
  trustHost: true,
  callbacks: {
    async signIn({ profile, account }) {
      if (account?.provider === "credentials") return true; // already verified in authorize()
      const email = profile?.email?.trim().toLowerCase();
      if (!email || profile?.email_verified === false) return "/login?error=NotInvited";
      // Server-side domain enforcement; the `hd` hint alone is not a control.
      if (domain() && !email.endsWith(`@${domain()}`)) return "/login?error=WrongDomain";
      const [u] = await db.select().from(users).where(eq(users.email, email));
      if (!u) return "/login?error=NotInvited";
      if (!u.isActive) return "/login?error=Deactivated";
      await loggedIn(u, null);
      return true;
    },
    async jwt({ token, profile, user, account }) {
      if (account?.provider === "credentials" && user?.id) {
        token.uid = user.id;
        // Marks a sign-in through the env test login, which skips the forced password change.
        token.test = !!(user as { test?: boolean }).test;
      }
      // Only present on sign-in: bind the token to our user row.
      if (profile?.email) {
        const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, profile.email.trim().toLowerCase()));
        if (u) token.uid = u.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.uid) (session.user as { id?: string; test?: boolean }).id = token.uid as string;
      (session.user as { test?: boolean }).test = !!token.test;
      return session;
    },
  },
});
