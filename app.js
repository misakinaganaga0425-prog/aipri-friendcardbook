(()=>{
  const $ = id => document.getElementById(id);
  const panel = $('settings');
  const notice = $('notice');
  const openSettings = () => { panel.classList.remove('hidden'); notice.classList.add('hidden'); };

  $('openSettings').onclick = openSettings;
  $('settingsToggle').onclick = openSettings;
  $('closeSettings').onclick = () => panel.classList.add('hidden');

  document.querySelectorAll('.tabs button').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(item => item.classList.toggle('active', item === button));
      document.querySelectorAll('.view').forEach(view => view.classList.add('hidden'));
      const target = $(button.dataset.view);
      if (target) target.classList.remove('hidden');
    };
  });

  $('url').value = localStorage.getItem('aipri_url') || '';
  $('key').value = localStorage.getItem('aipri_key') || '';

  $('clear').onclick = () => {
    localStorage.removeItem('aipri_url');
    localStorage.removeItem('aipri_key');
    $('url').value = '';
    $('key').value = '';
    $('status').textContent = '設定を消去しました';
    $('dbState').textContent = '未接続';
  };

  $('save').onclick = async () => {
    const url = $('url').value.trim().replace(/\/+$/, '');
    const key = $('key').value.trim();
    const status = $('status');
    const dbState = $('dbState');

    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)) {
      status.textContent = 'Project URLを確認してください。例：https://xxxx.supabase.co';
      dbState.textContent = '要確認';
      return;
    }
    if (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ')) {
      status.textContent = 'Publishable key（sb_publishable_...）を確認してください。Secret keyは使わないでください。';
      dbState.textContent = '要確認';
      return;
    }

    localStorage.setItem('aipri_url', url);
    localStorage.setItem('aipri_key', key);
    status.textContent = '保存しました。接続を確認しています…';
    dbState.textContent = '確認中';

    try {
      // /rest/v1/ is an admin/OpenAPI endpoint on some Supabase setups and can
      // reject a publishable key. Check the Auth health endpoint instead.
      const response = await fetch(url + '/auth/v1/health', {
        method: 'GET',
        headers: { apikey: key },
        cache: 'no-store'
      });
      if (response.ok) {
        dbState.textContent = '接続OK';
        status.textContent = 'Supabaseへの接続を確認できました。次はログイン設定とテーブル権限の設定が必要です。';
      } else {
        dbState.textContent = '要確認';
        let detail = '';
        try {
          const body = await response.json();
          detail = body.msg || body.message || body.error_description || body.error || '';
        } catch (_) {}
        status.textContent = `接続確認に失敗しました（HTTP ${response.status}）。${detail ? ' 詳細：' + detail : ' Project URLとPublishable keyが同じプロジェクトのものか確認してください。'}`;
      }
    } catch (error) {
      dbState.textContent = '通信エラー';
      status.textContent = 'Supabaseに通信できませんでした。ネット接続とProject URLを確認してください。';
    }
  };
})();
