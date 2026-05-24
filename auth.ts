import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb } from '@/lib/db/client';
import { agents, authAccounts, authSessions, authVerificationTokens } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { checkTrial } from '@/lib/auth/trial';
import { recheckIsActive } from '@/lib/auth/isActive';

export const { handlers, signIn, signOut, auth } = NextAuth({
  // Custom table map per manager directive. The `as any` on the second
  // argument silences a structural type mismatch (agents.id is `serial`
  // / integer; DrizzleAdapter's PostgresUsersTable signature requires
  // PgText / PgVarchar / PgUUID). Per the directive, we do NOT change
  // agents.id type. Runtime is unaffected today: Credentials + JWT
  // session strategy never exercises the adapter's session/account
  // methods. Cast also on the outer call result for the same reason.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(getDb(), {
    usersTable: agents,
    accountsTable: authAccounts,
    sessionsTable: authSessions,
    verificationTokensTable: authVerificationTokens,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any) as any,
  // Auth.js v5 requires JWT strategy when using the Credentials provider
  // (it refuses to issue a DB session for credential logins — throws
  // UnsupportedStrategy). With JWT, companyId/role are carried in the
  // signed token via the jwt() callback below.
  session: { strategy: 'jwt' },
  providers: [
    Credentials({
      credentials: { email: {}, password: {} },
      authorize: async ({ email, password }) => {
        const db = getDb();
        const agent = await db.query.agents.findFirst({
          where: eq(agents.email, String(email)),
        });
        if (!agent?.password_hash) return null;
        const valid = await bcrypt.compare(String(password), agent.password_hash);
        if (!valid) return null;
        await checkTrial(agent.company_id);
        return {
          id:        String(agent.id),
          email:     agent.email ?? '',
          name:      agent.name,
          companyId: agent.company_id ?? 0,
          role:      (agent.role as 'admin' | 'agent'),
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      // user is only set on initial sign-in. Persist the extra fields
      // into the JWT so the session callback below can read them.
      if (user) {
        token.id        = user.id;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token.companyId = (user as any).companyId;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        token.role      = (user as any).role;
      }
      return token;
    },
    // Under JWT strategy, Auth.js v5 passes `token` (not `user`) to the
    // session callback. Renaming via destructure so the body matches the
    // manager's snippet syntactically — `user` here is the JWT token,
    // populated by the jwt() callback above from the same authorize()
    // return value the database-strategy `user` would carry.
    async session({ session, token: user }) {
      if (user.id) {
        await recheckIsActive(Number(user.id));
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await checkTrial((user as any).companyId);   // mid-session trial gate
      session.user.id        = String(user.id ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.companyId = (user as any).companyId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.role      = (user as any).role;
      return session;
    },
  },
  pages: { signIn: '/login' },
});
