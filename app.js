
(() => {
  'use strict';

  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const settings = $('settings');
  const notice = $('notice');

  if (!main || !settings) return;

  let client = null;
  let currentUser = null;
  let bootPromise = null;
  let cards = [];
  let characters = [];
  let shareUrl = '';

  const message = (id, text) => {
    const el = $(id);
    if (el) el.textContent = text;
  };

  const usernameEmail = name =>
    name.toLowerCase() + '@users.aipri-friendcardbook.invalid';

  const validUsername = name =>
    /^[a-zA-Z0-9_]{3,20}$/.test(name);

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(view => {
      view.classList.toggle('hidden', view.id !== viewName);
    });

    document.querySelectorAll('.tabs button').forEach(button => {
      button.classList.toggle('active', button.dataset.view === viewName);
    });

    window.scrollTo({ top: 0, behavior: 'auto' });
  }

  function showCardTab(tab) {
    const searching = tab === 'search';

    $('cardSearchPanel').classList.toggle('hidden', !searching);
    $('cardRegisterPanel').classList.toggle('hidden', searching);
    $('searchTab').classList.toggle('active', searching);
    $('registerTab').classList.toggle('active', !searching);
  }

  // ログイン画面をホーム内に配置
  const authPanel = $('authPanel');

  if (authPanel && $('home') && authPanel.parentElement !== $('home')) {
    $('home').prepend(authPanel);
  }

  $('accountPanel')?.remove();

  // 接続設定
  $('openSettings')?.addEventListener('click', () => {
    settings.classList.remove('hidden');
    notice?.classList.add('hidden');
  });

  $('settingsToggle')?.addEventListener('click', () => {
    settings.classList.remove('hidden');
    notice?.classList.add('hidden');
  });

  $('closeSettings')?.addEventListener('click', () => {
    settings.classList.add('hidden');
  });

  $('dismissNotice')?.addEventListener('click', () => {
    notice?.classList.add('hidden');
  });

  document.querySelectorAll('.tabs button').forEach(button => {
    button.addEventListener('click', () => showView(button.dataset.view));
  });

  $('searchTab')?.addEventListener('click', () => showCardTab('search'));
  $('registerTab')?.addEventListener('click', () => showCardTab('register'));

  // 保存済みの接続設定を読み込む
  $('url').value = localStorage.getItem('aipri_url') || '';
  $('key').value = localStorage.getItem('aipri_key') || '';

  $('clear')?.addEventListener('click', () => {
    localStorage.removeItem('aipri_url');
    localStorage.removeItem('aipri_key');

    $('url').value = '';
    $('key').value = '';

    client = null;
    bootPromise = null;
    currentUser = null;
    cards = [];
    characters = [];

    $('cardsList')?.replaceChildren();
    $('charsList')?.replaceChildren();

    updateAccountUI();

    message('status', '接続設定を消去しました。');
    message('dbState', '未接続');
  });

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;

    await new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve;
      script.onerror = () =>
        reject(new Error('Supabaseライブラリを読み込めませんでした。'));
      document.head.appendChild(script);
    });

    if (!window.supabase?.createClient) {
      throw new Error('Supabaseを利用できません。');
    }
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

        if (currentUser) {
          loadData().catch(error => {
            console.error(error);
            message('authStatus', 'データ読み込みエラー：' + error.message);
          });
        } else {
          cards = [];
          characters = [];
          renderCards();
          renderCharacters();
          updateCharacterOptions();
          message('cardCount', '0');
          message('charCount', '0');
        }
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

  // 新規登録
  async function signUp() {
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;

    if (!validUsername(username)) {
      message('authStatus', 'ユーザーIDは半角英数字と _ の3〜20文字にしてください。');
      return;
    }

    if (password.length < 8 || password.length > 128) {
      message('authStatus', 'パスワードは8〜128文字にしてください。');
      return;
    }

    const url = localStorage.getItem('aipri_url');
    const key = localStorage.getItem('aipri_key');

    if (!url || !key) {
      message('authStatus', '先に接続設定を保存してください。');
      return;
    }

    message('authStatus', '新規登録しています…');

    const response = await fetch(
      url.replace(/\/+$/, '') + '/functions/v1/smart-task',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          apikey: key,
          Authorization: 'Bearer ' + key
        },
        body: JSON.stringify({
          username,
          password,
          displayName: username
        })
      }
    );

    let result;

    try {
      result = await response.json();
    } catch {
      throw new Error('サーバーから正しい応答がありませんでした。');
    }

    if (!response.ok || !result.success) {
      message(
        'authStatus',
        '登録できませんでした：' + (result.error || ('HTTP ' + response.status))
      );
      return;
    }

    message(
      'authStatus',
      '登録できました。同じIDとパスワードでログインしてください。'
    );
  }

  // ログイン
  async function signIn() {
    const username = $('authUsername').value.trim();
    const password = $('authPassword').value;

    if (!validUsername(username)) {
      message('authStatus', 'ユーザーIDを確認してください。');
      return;
    }

    if (!client) {
      message('authStatus', '先に接続設定を保存してください。');
      return;
    }

    message('authStatus', 'ログインしています…');

    const { error } = await client.auth.signInWithPassword({
      email: usernameEmail(username),
      password
    });

    if (error) {
      message('authStatus', 'ログインできませんでした。ID・パスワードを確認してください。');
      return;
    }

    message('authStatus', 'ログインしました。');
  }

  async function signOut() {
    if (!client) return;

    const { error } = await client.auth.signOut();
    if (error) throw error;

    currentUser = null;
    updateAccountUI();
    showView('home');
  }

  function updateAccountUI() {
    const loggedIn = !!currentUser;

    if (authPanel) authPanel.classList.toggle('hidden', loggedIn);

    if (!loggedIn) {
      message(
        'authStatus',
        client
          ? 'IDとパスワードでログインしてください。'
          : '接続設定を保存すると登録・ログインできます。'
      );
      message('dbState', client ? '接続OK' : '未接続');
      message('homeTitle', 'ログインして図鑑を使おう');
      message('homeMessage', 'フレカとマイキャラを登録できます。');
      $('signOut')?.remove();
      return;
    }

    message('authStatus', 'ログイン中です。');
    message('dbState', 'ログイン中');
    message('homeTitle', 'コレクションへようこそ');
    message('homeMessage', 'フレカとマイキャラを管理できます。');

    if (!$('signOut')) {
      const button = document.createElement('button');
      button.id = 'signOut';
      button.className = 'secondary';
      button.textContent = 'ログアウト';
      button.addEventListener('click', () => runSafely(signOut));
      authPanel?.appendChild(button);
    }
  }

  // フレカ登録
  async function addCard() {
    if (!currentUser) {
      message('cardRegisterStatus', '先にホームでログインしてください。');
      return;
    }

    const name = $('newCardName').value.trim();
    const memo = $('cardMemo').value.trim();
    const characterId = $('cardCharacter').value || null;

    if (!name) {
      message('cardRegisterStatus', 'フレカ名を入力してください。');
      return;
    }

    const { error } = await client.from('cards').insert({
      user_id: currentUser.id,
      card_name: name,
      card_data: { memo },
      character_id: characterId
    });

    if (error) {
      message('cardRegisterStatus', '登録エラー：' + error.message);
      return;
    }

    $('newCardName').value = '';
    $('cardMemo').value = '';
    $('cardCharacter').value = '';

    message('cardRegisterStatus', 'フレカを登録しました！');
    await loadCards();
    showCardTab('search');
  }

  // マイキャラ登録
  async function addCharacter() {
    if (!currentUser) {
      message('characterStatus', '先にホームでログインしてください。');
      return;
    }

    const name = $('newCharName').value.trim();
    const memo = $('characterMemo').value.trim();

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
    $('characterMemo').value = '';

    message('characterStatus', 'マイキャラを登録しました！');
    await loadCharacters();
    await loadCards();
  }

  // マイキャラの選択肢を更新
  function updateCharacterOptions() {
    const filter = $('characterFilter');
    const selector = $('cardCharacter');

    if (!filter || !selector) return;

    const oldFilter = filter.value || 'all';
    const oldSelector = selector.value || '';

    filter.replaceChildren();
    selector.replaceChildren();

    const allOption = document.createElement('option');
    allOption.value = 'all';
    allOption.textContent = 'すべて';
    filter.appendChild(allOption);

    const emptyOption = document.createElement('option');
    emptyOption.value = '';
    emptyOption.textContent = 'マイキャラを選択（任意）';
    selector.appendChild(emptyOption);

    characters.forEach(character => {
      const option = document.createElement('option');
      option.value = character.id;
      option.textContent = character.character_name;
      filter.appendChild(option);

      const registerOption = document.createElement('option');
      registerOption.value = character.id;
      registerOption.textContent = character.character_name;
      selector.appendChild(registerOption);
    });

    filter.value = characters.some(c => c.id === oldFilter) ? oldFilter : 'all';
    selector.value = characters.some(c => c.id === oldSelector) ? oldSelector : '';

    renderCards();
  }

  // フレカ一覧を表示
  function renderCards() {
    const list = $('cardsList');
    if (!list) return;

    list.replaceChildren();

    const keyword = ($('cardSearch')?.value || '').trim().toLowerCase();
    const characterFilter = $('characterFilter')?.value || 'all';

    const filtered = cards.filter(card => {
      const memo = card.card_data?.memo || '';
      const character = characters.find(c => c.id === card.character_id);
      const characterName = character?.character_name || '';

      const matchesKeyword =
        card.card_name.toLowerCase().includes(keyword) ||
        memo.toLowerCase().includes(keyword) ||
        characterName.toLowerCase().includes(keyword);

      const matchesCharacter =
        characterFilter === 'all' ||
        card.character_id === characterFilter;

      return matchesKeyword && matchesCharacter;
    });

    if (!currentUser) {
      list.textContent = 'ログインするとフレカを表示できます。';
      return;
    }

    if (!filtered.length) {
      list.textContent = cards.length
        ? '条件に合うフレカがありません。'
        : 'フレカはまだ登録されていません。';
      return;
    }

    filtered.forEach(card => {
      const item = document.createElement('article');
      item.className = 'item';

      const info = document.createElement('div');
      const title = document.createElement('strong');
      title.textContent = card.card_name;
      info.appendChild(title);

      const character = characters.find(c => c.id === card.character_id);

      const detail = document.createElement('p');
      detail.textContent = character
        ? 'マイキャラ：' + character.character_name
        : 'マイキャラ：未設定';
      info.appendChild(detail);

      const memo = card.card_data?.memo;
      if (memo) {
        const p = document.createElement('p');
        p.textContent = memo;
        info.appendChild(p);
      }

      const del = document.createElement('button');
      del.className = 'danger';
      del.textContent = '削除';

      del.addEventListener('click', () => runSafely(async () => {
        if (!confirm('「' + card.card_name + '」を削除しますか？')) return;

        const { error } = await client.from('cards')
          .delete()
          .eq('id', card.id)
          .eq('user_id', currentUser.id);

        if (error) {
          message('cardStatus', '削除エラー：' + error.message);
          return;
        }

        message('cardStatus', 'フレカを削除しました。');
        await loadCards();
      }));

      item.append(info, del);
      list.appendChild(item);
    });
  }

  async function loadCards() {
    if (!client || !currentUser) return;

    const { data, error } = await client.from('cards')
      .select('id,card_name,card_data,character_id,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      message('cardStatus', '読み込みエラー：' + error.message);
      return;
    }

    cards = data || [];
    message('cardCount', String(cards.length));
    renderCards();
  }

  function renderCharacters() {
    const list = $('charsList');
    if (!list) return;

    list.replaceChildren();

    if (!currentUser) {
      list.textContent = 'ログインするとマイキャラを表示できます。';
      return;
    }

    if (!characters.length) {
      list.textContent = 'マイキャラはまだ登録されていません。';
      return;
    }

    characters.forEach(character => {
      const item = document.createElement('article');
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

      del.addEventListener('click', () => runSafely(async () => {
        if (!confirm('「' + character.character_name + '」を削除しますか？')) return;

        const { error } = await client.from('my_characters')
          .delete()
          .eq('id', character.id)
          .eq('user_id', currentUser.id);

        if (error) {
          message('characterStatus', '削除エラー：' + error.message);
          return;
        }

        message('characterStatus', 'マイキャラを削除しました。');
        await loadCharacters();
        await loadCards();
      }));

      item.append(info, del);
      list.appendChild(item);
    });
  }

  async function loadCharacters() {
    if (!client || !currentUser) return;

    const { data, error } = await client.from('my_characters')
      .select('id,character_name,character_data,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      message('characterStatus', '読み込みエラー：' + error.message);
      return;
    }

    characters = data || [];
    message('charCount', String(characters.length));

    updateCharacterOptions();
    renderCharacters();
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

    shareUrl = data.share_slug
      ? location.origin + location.pathname + '?share=' + encodeURIComponent(data.share_slug)
      : '';

    $('shareUrl').value = data.is_public && shareUrl
      ? shareUrl
      : '現在は非公開です。';

    $('shareLinkArea').classList.toggle('hidden', !data.is_public || !shareUrl);
  }

  async function savePublic() {
    if (!currentUser) {
      message('shareStatus', '先にログインしてください。');
      return;
    }

    const { error } = await client.from('profiles')
      .update({ is_public: $('publicToggle').checked })
      .eq('id', currentUser.id);

    if (error) {
      message('shareStatus', '保存エラー：' + error.message);
      return;
    }

    await loadShare();
    message('shareStatus', '公開設定を保存しました。');
  }

  async function loadData() {
    if (!client || !currentUser) return;

    await loadCharacters();
    await loadCards();
    await loadShare();
  }

  // ボタン・検索イベント
  $('signupBtn')?.addEventListener('click', () => runSafely(signUp));

  $('loginBtn')?.addEventListener('click', () => runSafely(async () => {
    await boot();
    await signIn();
  }));

  $('addCard')?.addEventListener('click', () => runSafely(addCard));
  $('addChar')?.addEventListener('click', () => runSafely(addCharacter));
  $('savePublic')?.addEventListener('click', () => runSafely(savePublic));

  $('cardSearch')?.addEventListener('input', renderCards);
  $('characterFilter')?.addEventListener('change', renderCards);

  $('copyShare')?.addEventListener('click', async () => {
    if (!shareUrl) {
      message('shareStatus', '共有URLがありません。プロフィール設定を確認してください。');
      return;
    }

    try {
      await navigator.clipboard.writeText(shareUrl);
      message('shareStatus', '共有URLをコピーしました。');
    } catch {
      message('shareStatus', shareUrl);
    }
  });

  // 接続設定の保存・確認
  $('save')?.addEventListener('click', async () => {
    const url = $('url').value.trim().replace(/\/+$/, '');
    const key = $('key').value.trim();

    if (
      !/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) ||
      (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ'))
    ) {
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

      client = null;
      bootPromise = null;

      await boot();

      message('dbState', '接続OK');
      message('status', '接続できました。');

      settings.classList.add('hidden');
      notice?.classList.add('hidden');
    } catch (error) {
      message('dbState', '要確認');
      message('status', '接続失敗：' + (error?.message || error));
    }
  });

  // 初期表示
  showCardTab('search');

  if (new URLSearchParams(location.search).has('share')) {
    showView('share');
  } else {
    showView('home');
  }

  if (localStorage.getItem('aipri_url') && localStorage.getItem('aipri_key')) {
    boot().catch(error => {
      console.error(error);
      message('authStatus', '初期化エラー：' + (error?.message || error));
    });
  }
})();
