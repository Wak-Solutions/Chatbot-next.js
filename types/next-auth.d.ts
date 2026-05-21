import 'next-auth';

declare module 'next-auth' {
  interface Session {
    user: {
      id:        string;
      email:     string;
      name:      string;
      companyId: number;
      role:      'admin' | 'agent';
    };
  }

  // Returned from Credentials.authorize() and persisted by the DrizzleAdapter.
  // Extending User keeps companyId/role visible in the session() callback.
  interface User {
    companyId?: number;
    role?:      'admin' | 'agent';
  }
}

declare module '@auth/core/adapters' {
  interface AdapterUser {
    companyId?: number;
    role?:      'admin' | 'agent';
  }
}
