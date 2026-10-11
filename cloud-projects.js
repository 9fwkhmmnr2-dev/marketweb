import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL =
  "https://msxmhgxsjlgfdlhirikj.supabase.co";

const SUPABASE_PUBLISHABLE_KEY =
  "sb_publishable_6wS64xCMk4_073N2xbLJ4Q_1GYzALcq";

const MAX_HTML_BYTES = 300000;
const MAX_PROJECT_BYTES = 5 * 1024 * 1024;

export const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_PUBLISHABLE_KEY
);

export async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();

  if (error) throw error;

  if (!data.user) {
    throw new Error("Iniciá sesión para continuar.");
  }

  return data.user;
}

export async function listProjects() {
  await getCurrentUser();

  const { data, error } = await supabase
    .from("mw_projects")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  return data;
}

export async function saveProject({
  id,
  title,
  html,
  projectData
}) {
  const user = await getCurrentUser();

  const cleanTitle = String(title || "").trim();

  if (!cleanTitle || cleanTitle.length > 80) {
    throw new Error(
      "El título debe tener entre 1 y 80 caracteres."
    );
  }

  if (typeof html !== "string" || !html.trim()) {
    throw new Error("El HTML del proyecto está vacío.");
  }

  if (
    new TextEncoder().encode(html).length > MAX_HTML_BYTES
  ) {
    throw new Error(
      "El HTML supera el límite actual de 300 KB."
    );
  }

  if (
    !projectData ||
    typeof projectData !== "object" ||
    Array.isArray(projectData) ||
    projectData.app !== "marketweb" ||
    projectData.v !== 1 ||
    !projectData.state ||
    typeof projectData.state !== "object" ||
    Array.isArray(projectData.state)
  ) {
    throw new Error(
      "Los datos del proyecto no tienen el formato esperado."
    );
  }

  let serialized;

  try {
    serialized = JSON.stringify(projectData);
  } catch {
    throw new Error("No se pudieron procesar los datos del proyecto.");
  }

  if (
    new TextEncoder().encode(serialized).length >
    MAX_PROJECT_BYTES
  ) {
    throw new Error(
      "El proyecto supera el límite de 5 MB para guardarlo en la nube. Reducí el tamaño de las imágenes."
    );
  }

  const payload = {
    title: cleanTitle,
    html,
    project_data: JSON.parse(serialized),
    updated_at: new Date().toISOString()
  };

  if (id) {
    const { data, error } = await supabase
      .from("mw_projects")
      .update(payload)
      .eq("id", id)
      .eq("user_id", user.id)
      .select("id, title, created_at, updated_at")
      .single();

    if (error) throw error;

    return data;
  }

  const { data, error } = await supabase
    .from("mw_projects")
    .insert({
      ...payload,
      user_id: user.id
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

  const user = await getCurrentUser();

  const { data, error } = await supabase
    .from("mw_projects")
    .select(
      "id, title, html, project_data, created_at, updated_at"
    )
    .eq("id", id)
    .eq("user_id", user.id)
    .single();

  if (error) throw error;

  return data;
}

export async function deleteProject(id) {
  if (!id) {
    throw new Error("Falta el identificador del proyecto.");
  }

  const user = await getCurrentUser();

  const { error } = await supabase
    .from("mw_projects")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);

  if (error) throw error;
}
