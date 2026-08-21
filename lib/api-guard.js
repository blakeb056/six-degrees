// When the site is built as the public static demo (NEXT_PUBLIC_DEMO_MODE=true),
// every API route must be inert: they wrap an unauthenticated service-role
// Supabase client, which the demo has no reason to expose.
export function demoGuard() {
  if (process.env.NEXT_PUBLIC_DEMO_MODE === 'true') {
    return Response.json({ error: 'API disabled in demo mode' }, { status: 403 });
  }
  return null;
}
