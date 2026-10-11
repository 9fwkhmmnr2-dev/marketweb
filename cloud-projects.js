
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = "https://msxmhgxsjlgfdlhirikj.supabase.co";
const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_6wS64xCMk4_073N2xbLJ4Q_1GYzALcq";

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  return data.user;
}

export async function listProjects() {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Iniciá sesión para ver tus proyectos.");
  }

  const { data, error } = await supabase
    .from("mw_projects")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return data;
}

export async function saveProject({ id, title, html }) {
  const user = await getCurrentUser();

  if (!user) {
    throw new Error("Iniciá sesión para guardar proyectos.");
  }

  const cleanTitle = String(title || "").trim();

  if (!cleanTitle || cleanTitle.length > 80) {
    throw new Error("El título debe tener entre 1 y 80 caracteres.");
  }

  if (typeof html !== "string" || !html.trim()) {
    throw new Error("El HTML del proyecto está vacío.");
  }

  if (new TextEncoder().encode(html).length > 300000) {
    throw new Error("El proyecto supera el límite de 300 KB.");
  }

  if (id) {
    const { data, error } = await supabase
      .from("mw_projects")
      .update({
        title: cleanTitle,
        html,
        updated_at: new Date().toISOString()
      })
      .eq("id", id)
      .select("id, title, created_at, updated_at")
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("mw_projects")
    .insert({
      user_id: user.id,
      title: cleanTitle,
      html
    })
    .select("id, title, created_at, updated_at")
    .single();

  if (error) throw error;

  return data;
}

export async function loadProject(id) {
  if (!id) {
    throw new Error("Falta el identificador del proyecto.");
  }

  const { data, error } = await supabase
    .from("mw_projects")
    .select("id, title, html, created_at, updated_at")
    .eq("id", id)
    .single();

  if (error) throw error;

  return data;
}

export async function deleteProject(id) {
  if (!id) {
    throw new Error("Falta el identificador del proyecto.");
  }

  const { error } = await supabase
    .from("mw_projects")
    .delete()
    .eq("id", id);

  if (error) throw error;
}
