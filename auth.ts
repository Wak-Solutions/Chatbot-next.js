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
  session: { strategy: 'database' },
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
    async session({ session, user }) {
      await recheckIsActive(Number(user.id));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.companyId = (user as any).companyId;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      session.user.role      = (user as any).role;
      return session;
    },
  },
  pages: { signIn: '/login' },
});
