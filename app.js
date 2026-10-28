(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const notice = $('notice');
  const settings = $('settings');

  if (!main || !settings) {
    console.error('ページの必要な要素が見つかりません。');
    return;
  }

  let client = null;
  let currentUser = null;
  let bootPromise = null;
  let shareUrl = '';

  const message = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  const usernameEmail = name =>
    name.toLowerCase() + '@users.aipri-friendcardbook.invalid';

  const validUsername = name => /^[a-zA-Z0-9_]{3,20}$/.test(name);

  const randomSlug = () => {
    if (crypto.randomUUID) return crypto.randomUUID().replace(/-/g, '');
    return Array.from(crypto.getRandomValues(new Uint8Array(16)))
      .map(n => n.toString(16).padStart(2, '0')).join('');
  };

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('hidden', view.id !== viewName);
    });
    document.querySelectorAll('.tabs button').forEach(button => {
      button.classList.toggle('active', button.dataset.view === viewName);
    });
    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  // 既存HTMLのログイン画面をホーム内へ移動し、重複作成を防ぐ
  const authPanel = $('authPanel');
  if (authPanel && $('home') && authPanel.parentElement !== $('home')) {
    $('home').prepend(authPanel);
  }
  authPanel?.classList.remove('hidden');
  $('accountPanel')?.remove();

  // 設定画面
  $('openSettings')?.addEventListener('click', () => {
    settings.classList.remove('hidden');
    notice?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  $('settingsToggle')?.addEventListener('click', () => {
    settings.classList.remove('hidden');
    notice?.classList.add('hidden');
    window.scrollTo({ top: 0, behavior: 'auto' });
  });
  $('closeSettings')?.addEventListener('click', () => settings.classList.add('hidden'));
  $('dismissNotice')?.addEventListener('click', () => notice?.classList.add('hidden'));

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });

  // HTMLにある要素を利用し、IDをJavaScript側で必要な名前にそろえる
  if ($('authUsername')) $('authUsername').id = 'userId';
  if ($('authPassword')) $('authPassword').id = 'userPassword';
  if ($('signupBtn')) $('signupBtn').id = 'signUp';
  if ($('loginBtn')) $('loginBtn').id = 'signIn';
  if ($('cardName')) $('cardName').id = 'newCardName';
  if ($('addCardBtn')) $('addCardBtn').id = 'addCard';
  if ($('cardList')) $('cardList').id = 'cardsList';
  if ($('characterName')) $('characterName').id = 'newCharName';
  if ($('addCharacterBtn')) $('addCharacterBtn').id = 'addChar';
  if ($('characterList')) $('characterList').id = 'charsList';
  if ($('saveShareBtn')) $('saveShareBtn').id = 'savePublic';
  if ($('copyShareBtn')) $('copyShareBtn').id = 'copyShare';

  // 表示名欄を追加（HTMLを大きく変更せず既存フォームに合わせる）
  if (!$('displayName')) {
    const usernameInput = $('userId');
    const usernameLabel = usernameInput?.closest('label');
    if (usernameLabel) {
      const label = document.createElement('label');
      label.id = 'displayNameLabel';
      label.textContent = '表示名（任意）';
      const input = document.createElement('input');
      input.id = 'displayName';
      input.maxLength = 30;
      input.placeholder = '図鑑に表示する名前';
      label.appendChild(input);
      usernameLabel.parentElement.insertBefore(label, usernameLabel.nextSibling);
    }
  }

  $('url').value = localStorage.getItem('aipri_url') || '';
  $('key').value = localStorage.getItem('aipri_key') || '';

  $('clear')?.addEventListener('click', () => {
    localStorage.removeItem('aipri_url');
    localStorage.removeItem('aipri_key');
    $('url').value = '';
    $('key').value = '';
    message('status', '設定を消去しました');
    message('dbState', '未接続');
    client = null;
    bootPromise = null;
  });

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () => reject(new Error('Supabaseライブラリを読み込めませんでした。'));
      document.head.appendChild(script);
    });
    if (!window.supabase?.createClient) throw new Error('Supabaseライブラリを利用できません。');
  }

  async function runSafely(task) {
    try {
      await task();
    } catch (error) {
      console.error(error);
      message('authStatus', 'エラー：' + (error?.message || error));
      message('status', 'エラー：' + (error?.message || error));
    }
  }

  async function boot() {
    if (client) return;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const url = localStorage.getItem('aipri_url');
      const key = localStorage.getItem('aipri_key');
      if (!url || !key) {
        message('authStatus', '先に接続設定を保存してください。');
        return;
      }
      await loadSupabaseLibrary();
      client = window.supabase.createClient(url, key);
      const { data, error } = await client.auth.getSession();
      if (error) throw error;
      currentUser = data.session?.user || null;
      client.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null;
        updateAccountUI();
        if (currentUser) loadData().catch(error => {
          console.error(error);
          message('authStatus', 'データ読み込みエラー：' + (error?.message || error));
        });
      });
      updateAccountUI();
      if (currentUser) await loadData();
    })();
    try {
      await bootPromise;
    } catch (error) {
      bootPromise = null;
      client = null;
      throw error;
    }
  }

  async function signUp() {
    const username = $('userId').value.trim();
    const password = $('userPassword').value;
    const displayName = $('displayName')?.value.trim() || username;
    if (!validUsername(username)) {
      message('authStatus', 'ユーザーIDは半角英数字と _ の3〜20文字にしてください。');
      return;
    }
    if (password.length < 8) {
      message('authStatus', 'パスワードは8文字以上にしてください。');
      return;
    }
    if (!client) {
      message('authStatus', '先に接続設定を保存してください。');
      return;
    }

    message('authStatus', '新規登録しています…');
    const { data, error } = await client.auth.signUp({
      email: usernameEmail(username),
      password,
      options: { data: { username, display_name: displayName } }
    });
    if (error) {
      message('authStatus', '登録できませんでした：' + error.message);
      return;
    }

    if (data.user && data.session) {
      const { error: profileError } = await client.from('profiles').upsert({
        id: data.user.id,
        username: username.toLowerCase(),
        display_name: displayName,
        is_public: false,
        share_slug: randomSlug()
      });
      if (profileError) {
        message('authStatus', 'プロフィール保存エラー：' + profileError.message);
        return;
      }
      currentUser = data.user;
      await updateAccountUI();
      await loadData();
      message('authStatus', '登録しました！');
    } else {
      message('authStatus', '登録申請を受け付けました。Supabaseのメール確認設定が有効な場合は、メール確認設定を確認してください。');
    }
  }

  async function signIn() {
    const username = $('userId').value.trim();
    const password = $('userPassword').value;
    if (!validUsername(username)) {
      message('authStatus', 'ユーザーIDは半角英数字と _ の3〜20文字にしてください。');
      return;
    }
    if (!client) {
      message('authStatus', '先に接続設定を保存してください。');
      return;
    }
    message('authStatus', 'ログインしています…');
    const { data, error } = await client.auth.signInWithPassword({
      email: usernameEmail(username),
      password
    });
    if (error) {
      message('authStatus', 'ログインできませんでした。ID・パスワードを確認してください。');
      return;
    }
    currentUser = data.user;
    await updateAccountUI();
    await loadData();
    message('authStatus', 'ログインしました。');
  }

  async function signOut() {
    if (!client) return;
    const { error } = await client.auth.signOut();
    if (error) throw error;
    currentUser = null;
    await updateAccountUI();
    showView('home');
  }

  async function updateAccountUI() {
    const loggedIn = !!currentUser;
    const panel = $('authPanel');
    if (panel) panel.classList.toggle('hidden', loggedIn);
    if ($('userId')) $('userId').disabled = loggedIn;
    if ($('userPassword')) $('userPassword').disabled = loggedIn;
    if ($('displayNameLabel')) $('displayNameLabel').classList.toggle('hidden', loggedIn);
    if (!loggedIn) {
      message('authStatus', client ? 'IDとパスワードで登録またはログインしてください。' : '接続設定を保存すると登録・ログインできます。');
      message('dbState', client ? '接続OK' : '未接続');
      message('homeTitle', 'ログインして図鑑を使おう');
      message('homeMessage', 'カードとマイキャラを登録できます。');
      return;
    }
    message('authStatus', 'ログイン中です。');
    message('dbState', 'ログイン中');
    message('homeTitle', 'コレクションへようこそ');
    message('homeMessage', 'カード一覧・マイキャラ・共有から管理できます。');

    if (!$('signOut')) {
      const button = document.createElement('button');
      button.id = 'signOut';
      button.className = 'secondary';
      button.textContent = 'ログアウト';
      button.addEventListener('click', () => runSafely(signOut));
      panel?.appendChild(button);
    }
  }

  async function addCard() {
    if (!currentUser) {
      message('cardStatus', '先にホームでログインしてください。');
      return;
    }
    const name = $('newCardName').value.trim();
    const memo = $('cardMemo')?.value.trim() || '';
    if (!name) {
      message('cardStatus', 'カード名を入力してください。');
      return;
    }
    const { error } = await client.from('cards').insert({
      user_id: currentUser.id,
      card_name: name,
      card_data: { memo }
    });
    if (error) {
      message('cardStatus', '登録エラー：' + error.message);
      return;
    }
    $('newCardName').value = '';
    if ($('cardMemo')) $('cardMemo').value = '';
    message('cardStatus', 'カードを登録しました。');
    await loadCards();
  }

  async function addCharacter() {
    if (!currentUser) {
      message('characterStatus', '先にホームでログインしてください。');
      return;
    }
    const name = $('newCharName').value.trim();
    const memo = $('characterMemo')?.value.trim() || '';
    if (!name) {
      message('characterStatus', 'マイキャラ名を入力してください。');
      return;
    }
    const { error } = await client.from('my_characters').insert({
      user_id: currentUser.id,
      character_name: name,
      character_data: { memo }
    });
    if (error) {
      message('characterStatus', '登録エラー：' + error.message);
      return;
    }
    $('newCharName').value = '';
    if ($('characterMemo')) $('characterMemo').value = '';
    message('characterStatus', 'マイキャラを登録しました。');
    await loadCharacters();
  }

  async function loadCards() {
    if (!client || !currentUser) return;
    const { data, error } = await client.from('cards')
      .select('id,card_name,card_data,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    const list = $('cardsList');
    if (error) {
      list.textContent = '読み込みエラー：' + error.message;
      return;
    }
    list.replaceChildren();
    (data || []).forEach(card => {
      const item = document.createElement('div');
      item.className = 'item';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = card.card_name;
      info.appendChild(title);
      const memo = card.card_data?.memo;
      if (memo) {
        const p = document.createElement('p');
        p.textContent = memo;
        info.appendChild(p);
      }
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (!confirm('「' + card.card_name + '」を削除しますか？')) return;
        const { error: deleteError } = await client.from('cards').delete().eq('id', card.id);
        if (deleteError) message('cardStatus', '削除エラー：' + deleteError.message);
        await loadCards();
      });
      item.append(info, del);
      list.appendChild(item);
    });
    message('cardCount', String(data?.length || 0));
  }

  async function loadCharacters() {
    if (!client || !currentUser) return;
    const { data, error } = await client.from('my_characters')
      .select('id,character_name,character_data,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });
    const list = $('charsList');
    if (error) {
      list.textContent = '読み込みエラー：' + error.message;
      return;
    }
    list.replaceChildren();
    (data || []).forEach(character => {
      const item = document.createElement('div');
      item.className = 'item';
      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = character.character_name;
      info.appendChild(title);
      const memo = character.character_data?.memo;
      if (memo) {
        const p = document.createElement('p');
        p.textContent = memo;
        info.appendChild(p);
      }
      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '削除';
      del.addEventListener('click', async () => {
        if (!confirm('「' + character.character_name + '」を削除しますか？')) return;
        const { error: deleteError } = await client.from('my_characters').delete().eq('id', character.id);
        if (deleteError) message('characterStatus', '削除エラー：' + deleteError.message);
        await loadCharacters();
      });
      item.append(info, del);
      list.appendChild(item);
    });
    message('charCount', String(data?.length || 0));
  }

  async function loadShare() {
    if (!client || !currentUser) return;
    const { data, error } = await client.from('profiles')
      .select('is_public,share_slug,display_name')
      .eq('id', currentUser.id)
      .maybeSingle();
    if (error || !data) {
      message('shareStatus', 'プロフィールを読み込めませんでした。');
      return;
    }
    $('publicToggle').checked = !!data.is_public;
    shareUrl = location.origin + location.pathname + '?share=' + data.share_slug;
    if ($('shareUrl')) $('shareUrl').value = data.is_public ? shareUrl : '現在は非公開です。';
    $('shareLinkArea')?.classList.toggle('hidden', !data.is_public);
  }

  async function savePublic() {
    if (!currentUser) {
      message('shareStatus', '先にホームでログインしてください。');
      return;
    }
    const { error } = await client.from('profiles').update({
      is_public: $('publicToggle').checked
    }).eq('id', currentUser.id);
    if (error) {
      message('shareStatus', '保存エラー：' + error.message);
      return;
    }
    await loadShare();
    message('shareStatus', '公開設定を保存しました。');
  }

  async function loadData() {
    if (!client || !currentUser) return;
    await Promise.all([loadCards(), loadCharacters(), loadShare()]);
  }

  // ボタン処理を、接続設定の状態に関係なく最初に登録する
  $('signUp')?.addEventListener('click', () => runSafely(async () => {
    await boot();
    await signUp();
  }));
  $('signIn')?.addEventListener('click', () => runSafely(async () => {
    await boot();
    await signIn();
  }));
  $('addCard')?.addEventListener('click', () => runSafely(addCard));
  $('addChar')?.addEventListener('click', () => runSafely(addCharacter));
  $('savePublic')?.addEventListener('click', () => runSafely(savePublic));
  $('copyShare')?.addEventListener('click', async () => {
    if (!shareUrl) {
      message('shareStatus', '先にログインして公開設定を保存してください。');
      return;
    }
    try {
      await navigator.clipboard.writeText(shareUrl);
      message('shareStatus', '共有URLをコピーしました。');
    } catch {
      message('shareStatus', shareUrl);
    }
  });

  // 接続設定を保存してSupabaseに接続
  $('save')?.addEventListener('click', async () => {
    const url = $('url').value.trim().replace(/\/+$/, '');
    const key = $('key').value.trim();
    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) ||
        (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ'))) {
      message('status', 'Project URLとPublishable keyを確認してください。');
      return;
    }
    localStorage.setItem('aipri_url', url);
    localStorage.setItem('aipri_key', key);
    message('status', '接続を確認しています…');
    try {
      const response = await fetch(url + '/auth/v1/health', {
        headers: { apikey: key },
        cache: 'no-store'
      });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      message('dbState', '接続OK');
      message('status', '接続できました。ログイン機能を読み込みます。');
      await boot();
      settings.classList.add('hidden');
      notice?.classList.add('hidden');
    } catch (error) {
      message('dbState', '要確認');
      message('status', '接続失敗：' + (error?.message || error));
    }
  });

  // 保存済み設定がある場合は自動接続
  if (localStorage.getItem('aipri_url') && localStorage.getItem('aipri_key')) {
    boot().catch(error => {
      console.error(error);
      message('authStatus', '初期化エラー：' + (error?.message || error));
      message('status', '初期化エラー：' + (error?.message || error));
    });
  }

  // URLの共有パラメータがある場合、共有ページを開く（公開読み取りはDBポリシーに依存）
  const params = new URLSearchParams(location.search);
  if (params.has('share')) showView('share');
  else showView('home');
})();
