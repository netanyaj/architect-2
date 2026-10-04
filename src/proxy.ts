import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { isPublicPath, loginUrl } from "@/lib/auth-paths";
import type { Database } from "@/lib/database.types";
import { supabaseAnonKey, supabaseUrl } from "@/lib/db";

/**
 * Refreshes the Supabase session cookie on every page request, and sends signed-out visitors
 * from private pages to /login (an optimistic check; pages and actions check again on the server).
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient<Database>(
    supabaseUrl,
    supabaseAnonKey,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (toSet, headers) => {
          for (const { name, value } of toSet) request.cookies.set(name, value);
          response = NextResponse.next({ request });
          for (const { name, value, options } of toSet) response.cookies.set(name, value, options);
          for (const [k, v] of Object.entries(headers ?? {})) response.headers.set(k, v);
        },
      },
    },
  );

  // getUser() checks the token with Supabase and refreshes it when needed. Don't remove.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname, search } = request.nextUrl;
  // Server actions (buttons, forms) aren't page loads: redirecting them returns the login page's HTML where the
  // browser expects an action result ("An unexpected response was received from the server"). Let them through;
  // every action checks sign-in itself and sends the person to /login properly.
  const isServerAction = request.headers.has("next-action");
  if (!user && !isPublicPath(pathname) && !isServerAction) {
    const url = request.nextUrl.clone();
    const target = new URL(loginUrl(pathname + search), request.url);
    url.pathname = target.pathname;
    url.search = target.search;
    const redirect = NextResponse.redirect(url);
    for (const c of response.cookies.getAll()) redirect.cookies.set(c);
    return redirect;
  }
  return response;
}

export const config = {
  // Everything except static files and images.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)"],
};
