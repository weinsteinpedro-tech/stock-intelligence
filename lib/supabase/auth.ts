import { supabase } from "./client";

export async function ensureAnonymousSession() {
  const { data: existing } = await supabase.auth.getSession();
  if (existing.session) return existing.session;

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error) throw new Error(`Auth failed: ${error.message}`);
  return data.session;
}
