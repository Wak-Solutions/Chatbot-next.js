import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { DrizzleAdapter } from '@auth/drizzle-adapter';
import { getDb } from '@/lib/db/client';
import { agents } from '@/lib/db/schema';
import { eq } from 'drizzle-orm';
import bcrypt from 'bcrypt';
import { checkTrial } from '@/lib/auth/trial';
import { recheckIsActive } from '@/lib/auth/isActive';

export const { handlers, signIn, signOut, auth } = NextAuth({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  adapter: DrizzleAdapter(getDb()) as any,
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
    async session({ session, token }) {
      if (token.id) {
        await recheckIsActive(Number(token.id));
      }
      session.user.id        = String(token.id ?? '');
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.companyId = token.companyId as any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.role      = token.role as any;
      return session;
    },
  },
  pages: { signIn: '/login' },
});
