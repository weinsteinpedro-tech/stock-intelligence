import { supabase } from "./client";

export async function ensureAnonymousSession() {
  try {
    const { data: existing } = await supabase.auth.getSession();
    if (existing?.session) return existing.session;

    const { data, error } = await supabase.auth.signInAnonymously();
    if (error) {
      console.warn("Supabase auth warning:", error.message);
      return { user: { id: "anonymous" } };
    }
    return data?.session ?? { user: { id: "anonymous" } };
  } catch (err) {
    console.warn("Supabase auth catch:", err);
    return { user: { id: "anonymous" } };
  }
}
