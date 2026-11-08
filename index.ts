
import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = "https://lldeduccsqzvstqfjexm.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_lx1lacFLektj2cAfzAP64A_7tEPd69A";

// Reflect the browser's requested headers so newer supabase-js headers
// are not accidentally rejected during the CORS preflight.
function corsHeaders(req: Request) {
  const origin = req.headers.get("Origin");
  const requestedHeaders = req.headers.get("Access-Control-Request-Headers");
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Headers": requestedHeaders ||
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin, Access-Control-Request-Headers",
  };
}

function reply(data: Record<string, unknown>, req: Request, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

async function removeUserStorage(admin: any, userId: string) {
  const buckets = ["friend-card-media", "friendcard-images"];

  for (const bucket of buckets) {
    const paths: string[] = [];

    async function collect(folder: string) {
      let offset = 0;
      const limit = 100;

      while (true) {
        const { data, error } = await admin.storage
          .from(bucket)
          .list(folder, { limit, offset });

        if (error) throw new Error(`${bucket} の一覧取得に失敗: ${error.message}`);

        const entries = data || [];
        for (const entry of entries) {
          const path = folder ? `${folder}/${entry.name}` : entry.name;

          if (entry.id === null) {
            await collect(path);
          } else {
            paths.push(path);
          }
        }

        if (entries.length < limit) break;
        offset += limit;
      }
    }

    await collect(userId);

    for (let i = 0; i < paths.length; i += 100) {
      const { error } = await admin.storage
        .from(bucket)
        .remove(paths.slice(i, i + 100));

      if (error) throw new Error(`${bucket} の削除に失敗: ${error.message}`);
    }
  }
}

async function deleteUserRows(admin: any, userId: string) {
  const targets = [
    ["friendcard_entries", "owner_id"],
    ["friendcard_characters", "owner_id"],
    ["friendcard_profiles", "owner_id"],
    ["cards", "user_id"],
    ["my_characters", "user_id"],
    ["profiles", "id"],
  ];

  for (const [table, column] of targets) {
    const { error } = await admin
      .from(table)
      .delete()
      .eq(column, userId);

    if (error) {
      throw new Error(`${table} の削除に失敗: ${error.message}`);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders(req) });
  }

  if (req.method !== "POST") {
    return reply({ success: false, error: "POST only" }, req, 405);
  }

  try {
    const secretKey = Deno.env.get("AIPRI_SUPABASE_SECRET_KEY");
    if (!secretKey) {
      return reply({
        success: false,
        error: "AIPRI_SUPABASE_SECRET_KEY が設定されていません。",
      }, req, 500);
    }

    const authorization = req.headers.get("Authorization") || "";
    const accessToken = authorization.replace(/^Bearer\s+/i, "");

    if (!accessToken || accessToken === authorization) {
      return reply({ success: false, error: "ログイン情報がありません。" }, req, 401);
    }

    const admin = createClient(SUPABASE_URL, secretKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: authData, error: authError } =
      await admin.auth.getUser(accessToken);

    if (authError || !authData.user) {
      return reply({ success: false, error: "ログインを確認できません。" }, req, 401);
    }

    const body = await req.json();
    const username = String(body.username || "").trim().toLowerCase();
    const password = String(body.password || "");

    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username) || !password) {
      return reply({ success: false, error: "ユーザーIDまたはパスワードを確認してください。" }, req, 400);
    }

    const verifyClient = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: verified, error: verifyError } =
      await verifyClient.auth.signInWithPassword({
        email: `${username}@users.aipri-friendcardbook.invalid`,
        password,
      });

    if (
      verifyError ||
      !verified.user ||
      verified.user.id !== authData.user.id
    ) {
      return reply({
        success: false,
        error: "ユーザーIDまたはパスワードが正しくありません。",
      }, req, 401);
    }

    // Storage files are removed before database records.
    await removeUserStorage(admin, authData.user.id);

    // Remove all account-owned database records.
    await deleteUserRows(admin, authData.user.id);

    // Delete the Auth account last.
    const { error: deleteAuthError } =
      await admin.auth.admin.deleteUser(authData.user.id);

    if (deleteAuthError) {
      console.error("Auth deletion failed:", deleteAuthError.message);
      return reply({
        success: false,
        error: "登録データは削除されましたが、ログインアカウントの削除に失敗しました。サポートに連絡してください。",
      }, req, 500);
    }

    return reply({
      success: true,
      message: "アカウントと登録データを削除しました。",
    }, req);
  } catch (error) {
    console.error("Account deletion failed:", error);
    return reply({
      success: false,
      error: error instanceof Error ? error.message : "削除処理に失敗しました。",
    }, req, 500);
  }
});
