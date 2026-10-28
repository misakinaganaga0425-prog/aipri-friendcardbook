
(() => {
  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const notice = $('notice');
  const settings = $('settings');

  // Existing navigation and connection settings
  $('openSettings').onclick = () => {
    settings.classList.remove('hidden');
    notice.classList.add('hidden');
  };
  $('settingsToggle').onclick = () => {
    settings.classList.remove('hidden');
    notice.classList.add('hidden');
  };
  $('closeSettings').onclick = () => settings.classList.add('hidden');

  document.querySelectorAll('.tabs button').forEach(button => {
    button.onclick = () => {
      document.querySelectorAll('.tabs button').forEach(b =>
        b.classList.toggle('active', b === button)
      );
      document.querySelectorAll('.view').forEach(v =>
        v.classList.add('hidden')
      );
      $(button.dataset.view)?.classList.remove('hidden');
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

    if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url) ||
        (!key.startsWith('sb_publishable_') && !key.startsWith('eyJ'))) {
      $('status').textContent = 'Project URLとPublishable keyを確認してください。';
      return;
    }

    localStorage.setItem('aipri_url', url);
    localStorage.setItem('aipri_key', key);
    $('status').textContent = '接続を確認しています…';

    try {
      const r = await fetch(url + '/auth/v1/health', {
        headers: { apikey: key },
        cache: 'no-store'
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      $('dbState').textContent = '接続OK';
      $('status').textContent = '接続できました。ログイン機能を読み込みます。';
      settings.classList.add('hidden');
      notice.classList.add('hidden');
      await boot();
    } catch (e) {
      $('dbState').textContent = '要確認';
      $('status').textContent = '接続失敗：' + e.message;
    }
  };

  // Create app panels while keeping the existing page structure
  const auth = document.createElement('section');
  auth.id = 'accountPanel';
  auth.className = 'panel';
  auth.innerHTML = `
    <h2>アカウント</h2>
    <p>メールアドレスの入力は不要です。</p>
    <label>ユーザーID
      <input id="userId" autocomplete="username" maxlength="24"
        placeholder="半角英数字・_（3〜24文字）">
    </label>
    <label>パスワード
      <input id="userPassword" type="password"
        autocomplete="current-password" minlength="8"
        placeholder="8文字以上">
    </label>
    <label id="displayNameLabel">表示名
      <input id="displayName" maxlength="30" placeholder="図鑑に表示する名前">
    </label>
    <div class="actions">
      <button id="signUp">新規登録</button>
      <button id="signIn" class="secondary">ログイン</button>
      <button id="signOut" class="secondary hidden">ログアウト</button>
    </div>
    <p id="authStatus" role="status"></p>
  `;
  main.insertBefore(auth, main.querySelector('.hero'));

  const cardsPanel = $('cards');
  cardsPanel.innerHTML = `
    <h2>カード一覧</h2>
    <div class="panel">
      <label>カード名
        <input id="newCardName" maxlength="100" placeholder="カード名を入力">
      </label>
      <button id="addCard">カードを登録</button>
    </div>
    <div id="cardsList"></div>
  `;

  const charsPanel = $('characters');
  charsPanel.innerHTML = `
    <h2>マイキャラ</h2>
    <div class="panel">
      <label>マイキャラ名
        <input id="newCharName" maxlength="100" placeholder="キャラ名を入力">
      </label>
      <button id="addChar">マイキャラを登録</button>
    </div>
    <div id="charsList"></div>
  `;

  const sharePanel = $('share');
  sharePanel.innerHTML = `
    <h2>共有設定</h2>
    <div class="panel">
      <p>公開を有効にすると、共有用URLを発行できます。</p>
      <label><input id="publicToggle" type="checkbox"> 図鑑を公開する</label>
      <button id="savePublic">公開設定を保存</button>
      <p id="shareUrl"></p>
      <button id="copyShare" class="secondary">共有URLをコピー</button>
      <p id="shareStatus" role="status"></p>
    </div>
  `;

  let client = null;
  let currentUser = null;
  let shareUrl = '';

  const message = (id, text) => {
    $(id).textContent = text;
  };

  function usernameEmail(name) {
    return name.toLowerCase() + '@users.aipri-friendcardbook.invalid';
  }

  function validUsername(name) {
    return /^[a-zA-Z0-9_]{3,24}$/.test(name);
  }

  function randomSlug() {
    return crypto.randomUUID().replace(/-/g, '');
  }

  async function boot() {
    const url = localStorage.getItem('aipri_url');
    const key = localStorage.getItem('aipri_key');
    if (!url || !key || !window.supabase) return;

    client = window.supabase.createClient(url, key);
    const { data } = await client.auth.getSession();
    currentUser = data.session?.user || null;

    $('signUp').onclick = signUp;
    $('signIn').onclick = signIn;
    $('signOut').onclick = signOut;
    $('addCard').onclick = addCard;
    $('addChar').onclick = addCharacter;
    $('savePublic').onclick = savePublic;
    $('copyShare').onclick = async () => {
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
    };

    client.auth.onAuthStateChange((_event, session) => {
      currentUser = session?.user || null;
      setAccountUI();
      if (currentUser) loadData();
    });

    await setAccountUI();
    if (currentUser) await loadData();
  }

  async function signUp() {
    const username = $('userId').value.trim();
    const password = $('userPassword').value;
    const displayName = $('displayName').value.trim() || username;

    if (!validUsername(username)) {
      message('authStatus', 'IDは半角英数字と_で3〜24文字にしてください。');
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

    message('authStatus', '登録しています…');
    const email = usernameEmail(username);
    const result = await client.auth.signUp({
      email,
      password,
      options: { data: { username, display_name: displayName } }
    });

    if (result.error) {
      message('authStatus', '登録できませんでした：' + result.error.message);
      return;
    }

    const user = result.data.user;
    if (user && result.data.session) {
      const profile = await client.from('profiles').upsert({
        id: user.id,
        username: username.toLowerCase(),
        display_name: displayName,
        is_public: false,
        share_slug: randomSlug()
      });
      if (profile.error) {
        message('authStatus', 'プロフィール保存エラー：' + profile.error.message);
        return;
      }
      currentUser = user;
      await setAccountUI();
      await loadData();
      message('authStatus', '登録しました！');
    } else {
      message('authStatus',
        '登録申請を受け付けました。Supabaseのメール確認設定が有効だと、この方式ではログインできません。管理画面で確認設定を変更してください。');
    }
  }

  async function signIn() {
    const username = $('userId').value.trim();
    const password = $('userPassword').value;
    if (!validUsername(username)) {
      message('authStatus', 'ユーザーIDを確認してください。');
      return;
    }
    const { data, error } = await client.auth.signInWithPassword({
      email: usernameEmail(username),
      password
    });
    if (error) {
      message('authStatus', 'ログインできませんでした。ID・パスワードを確認してください。');
      return;
    }
    currentUser = data.user;
    await setAccountUI();
    await loadData();
    message('authStatus', 'ログインしました。');
  }

  async function signOut() {
    await client.auth.signOut();
    currentUser = null;
    await setAccountUI();
  }

  async function setAccountUI() {
    const loggedIn = !!currentUser;
    $('signUp').classList.toggle('hidden', loggedIn);
    $('signIn').classList.toggle('hidden', loggedIn);
    $('signOut').classList.toggle('hidden', !loggedIn);
    $('displayNameLabel').classList.toggle('hidden', loggedIn);
    $('userId').disabled = loggedIn;
    $('userPassword').disabled = loggedIn;

    if (!client) {
      message('authStatus', '接続設定を保存すると登録・ログインできます。');
      return;
    }
    if (loggedIn) {
      message('authStatus', 'ログイン中です。');
      $('dbState').textContent = 'ログイン中';
    } else {
      message('authStatus', 'IDとパスワードで登録またはログインしてください。');
      $('dbState').textContent = '接続OK';
    }
  }

  async function addCard() {
    if (!currentUser) return alert('先にログインしてください。');
    const name = $('newCardName').value.trim();
    if (!name) return alert('カード名を入力してください。');

    const { error } = await client.from('cards').insert({
      user_id: currentUser.id,
      card_name: name,
      card_data: {}
    });
    if (error) return alert('登録エラー：' + error.message);
    $('newCardName').value = '';
    await loadCards();
  }

  async function addCharacter() {
    if (!currentUser) return alert('先にログインしてください。');
    const name = $('newCharName').value.trim();
    if (!name) return alert('マイキャラ名を入力してください。');

    const { error } = await client.from('my_characters').insert({
      user_id: currentUser.id,
      character_name: name,
      character_data: {}
    });
    if (error) return alert('登録エラー：' + error.message);
    $('newCharName').value = '';
    await loadCharacters();
  }

  async function loadCards() {
    const { data, error } = await client.from('cards')
      .select('id,card_name,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      $('cardsList').textContent = '読み込みエラー：' + error.message;
      return;
    }
    $('cardsList').replaceChildren();
    for (const card of data || []) {
      const item = document.createElement('div');
      item.className = 'panel between';
      const name = document.createElement('span');
      name.textContent = card.card_name;
      const del = document.createElement('button');
      del.textContent = '削除';
      del.className = 'secondary';
      del.onclick = async () => {
        if (!confirm('「' + card.card_name + '」を削除しますか？')) return;
        const { error: e } = await client.from('cards').delete().eq('id', card.id);
        if (e) alert('削除エラー：' + e.message);
        await loadCards();
      };
      item.append(name, del);
      $('cardsList').append(item);
    }
    $('cardCount').textContent = String(data?.length || 0);
  }

  async function loadCharacters() {
    const { data, error } = await client.from('my_characters')
      .select('id,character_name,created_at')
      .eq('user_id', currentUser.id)
      .order('created_at', { ascending: false });

    if (error) {
      $('charsList').textContent = '読み込みエラー：' + error.message;
      return;
    }
    $('charsList').replaceChildren();
    for (const character of data || []) {
      const item = document.createElement('div');
      item.className = 'panel between';
      const name = document.createElement('span');
      name.textContent = character.character_name;
      const del = document.createElement('button');
      del.textContent = '削除';
      del.className = 'secondary';
      del.onclick = async () => {
        if (!confirm('「' + character.character_name + '」を削除しますか？')) return;
        const { error: e } = await client.from('my_characters')
          .delete().eq('id', character.id);
        if (e) alert('削除エラー：' + e.message);
        await loadCharacters();
      };
      item.append(name, del);
      $('charsList').append(item);
    }
    $('charCount').textContent = String(data?.length || 0);
  }

  async function loadData() {
    if (!client || !currentUser) return;
    await Promise.all([loadCards(), loadCharacters(), loadShare()]);
  }

  async function loadShare() {
    const { data, error } = await client.from('profiles')
      .select('is_public,share_slug,display_name')
      .eq('id', currentUser.id).maybeSingle();

    if (error || !data) {
      message('shareStatus', 'プロフィールを読み込めませんでした。');
      return;
    }
    $('publicToggle').checked = !!data.is_public;
    shareUrl = location.origin + location.pathname + '?share=' + data.share_slug;
    $('shareUrl').textContent = data.is_public ? shareUrl : '現在は非公開です。';
  }

  async function savePublic() {
    if (!currentUser) return;
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

  const url = localStorage.getItem('aipri_url');
  const key = localStorage.getItem('aipri_key');
  if (url && key) {
    boot().catch(error => {
      console.error(error);
      const status = $('authStatus');
      if (status) {
        status.textContent = '初期化エラー：' + error.message;
      }
    });
  }
})();
