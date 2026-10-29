// ============================================================
// Инициализация Supabase-клиента (единая точка входа)
// ============================================================
(function () {
  if (!window.supabase || !window.supabase.createClient) {
    console.error('[supabase-client] SDK не загружен');
    return;
  }
  if (!window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error('[supabase-client] config.js не заполнен');
    return;
  }
  const client = window.supabase.createClient(
    window.SUPABASE_URL,
    window.SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
  window.sb = client;
  console.log('[supabase-client] OK');
})();