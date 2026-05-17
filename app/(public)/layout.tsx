/**
 * Public route-group layout — pass-through. No auth gate; pages under
 * (public)/ are reachable without a session cookie. Inherits Providers
 * from the root layout.
 */

export default function PublicLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return <>{children}</>;
}
