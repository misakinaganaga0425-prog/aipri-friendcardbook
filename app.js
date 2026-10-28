(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const main = document.querySelector('main');
  const settings = $('settings');
  const notice = $('notice');
  if (!main || !settings) return;

  let client = null, currentUser = null, bootPromise = null;
  let cards = [], characters = [], shareUrl = '', activeCharacter = 'all';
  const BUCKET = 'friend-card-media';
  const message = (id, text) => { const el = $(id); if (el) el.textContent = text || ''; };
  const usernameEmail = name => name.toLowerCase() + '@users.aipri-friendcardbook.invalid';
  const validUsername = name => /^[a-zA-Z0-9_]{3,20}$/.test(name);
  const escapeText = value => String(value ?? '');

  function showView(viewName) {
    document.querySelectorAll('.view').forEach(view => view.classList.toggle('hidden', view.id !== viewName));
    document.querySelectorAll('.tabs button').forEach(button => button.classList.toggle('active', button.dataset.view === viewName));
    window.scrollTo({ top: 0, behavior: 'auto' });
  }
  function showCardTab(tab) {
    const searching = tab === 'search';
    $('cardSearchPanel')?.classList.toggle('hidden', !searching);
    $('cardRegisterPanel')?.classList.toggle('hidden', searching);
    $('searchTab')?.classList.toggle('active', searching);
    $('registerTab')?.classList.toggle('active', !searching);
  }
  function runSafely(task) {
    return Promise.resolve().then(task).catch(error => {
      console.error(error);
      const text = 'エラー：' + (error?.message || error);
      message('authStatus', text); message('status', text);
      if ($('cardRegisterPanel') && !$('cardRegisterPanel').classList.contains('hidden')) message('cardRegisterStatus', text);
    });
  }
  $('openSettings')?.addEventListener('click', () => { settings.classList.remove('hidden'); notice?.classList.add('hidden'); });
  $('settingsToggle')?.addEventListener('click', () => { settings.classList.remove('hidden'); notice?.classList.add('hidden'); });
  $('closeSettings')?.addEventListener('click', () => settings.classList.add('hidden'));
  $('dismissNotice')?.addEventListener('click', () => notice?.classList.add('hidden'));
  document.querySelectorAll('.tabs button').forEach(button => button.addEventListener('click', () => showView(button.dataset.view)));
  document.querySelectorAll('[data-go]').forEach(button => button.addEventListener('click', () => showView(button.dataset.go)));
  $('searchTab')?.addEventListener('click', () => showCardTab('search'));
  $('registerTab')?.addEventListener('click', () => showCardTab('register'));

  $('url').value = localStorage.getItem('aipri_url') || '';
  $('key').value = localStorage.getItem('aipri_key') || '';
  $('clear')?.addEventListener('click', () => {
    localStorage.removeItem('aipri_url'); localStorage.removeItem('aipri_key');
    $('url').value = ''; $('key').value = ''; client = null; bootPromise = null; currentUser = null; cards = []; characters = [];
    renderCards(); renderCharacters(); renderCharacterChips(); updateCharacterOptions(); updateAccountUI();
    message('status', '接続設定を消去しました。'); message('dbState', '未接続');
  });

  async function loadSupabaseLibrary() {
    if (window.supabase?.createClient) return;
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2';
      script.onload = resolve; script.onerror = () => reject(new Error('Supabaseライブラリを読み込めませんでした。'));
      document.head.appendChild(script);
    });
    if (!window.supabase?.createClient) throw new Error('Supabaseを利用できません。');
  }
  async function boot() {
    if (client) return;
    if (bootPromise) return bootPromise;
    bootPromise = (async () => {
      const url = localStorage.getItem('aipri_url'), key = localStorage.getItem('aipri_key');
      if (!url || !key) { message('authStatus', '先に接続設定を保存してください。'); return; }
      await loadSupabaseLibrary();
      client = window.supabase.createClient(url, key);
      const { data, error } = await client.auth.getSession(); if (error) throw error;
      currentUser = data.session?.user || null;
      client.auth.onAuthStateChange((_event, session) => {
        currentUser = session?.user || null; updateAccountUI();
        if (currentUser) setTimeout(() => loadData().catch(err => message('authStatus', 'データ読み込みエラー：' + err.message)), 0);
        else { cards = []; characters = []; renderCards(); renderCharacters(); renderCharacterChips(); updateCharacterOptions(); message('cardCount','0'); message('charCount','0'); }
      });
      updateAccountUI(); if (currentUser) await loadData();
    })();
    try { await bootPromise; } catch (error) { bootPromise = null; client = null; throw error; }
  }
  async function signUp() {
    const username = $('authUsername').value.trim(), password = $('authPassword').value;
    if (!validUsername(username)) return message('authStatus', 'ユーザーIDは半角英数字と _ の3〜20文字にしてください。');
    if (password.length < 8 || password.length > 128) return message('authStatus', 'パスワードは8〜128文字にしてください。');
    const url = localStorage.getItem('aipri_url'), key = localStorage.getItem('aipri_key');
    if (!url || !key) return message('authStatus', '先に接続設定を保存してください。');
    message('authStatus', '新規登録しています…');
    const response = await fetch(url.replace(/\/+$/, '') + '/functions/v1/smart-task', { method:'POST', headers:{'Content-Type':'application/json', apikey:key, Authorization:'Bearer '+key}, body:JSON.stringify({username,password,displayName:username}) });
    let result; try { result = await response.json(); } catch { throw new Error('サーバーから正しい応答がありませんでした。'); }
    if (!response.ok || !result.success) return message('authStatus', '登録できませんでした：' + (result.error || ('HTTP '+response.status)));
    message('authStatus', '登録できました。同じIDとパスワードでログインしてください。');
  }
  async function signIn() {
    const username = $('authUsername').value.trim(), password = $('authPassword').value;
    if (!validUsername(username)) return message('authStatus', 'ユーザーIDを確認してください。');
    if (!client) return message('authStatus', '先に接続設定を保存してください。');
    message('authStatus', 'ログインしています…');
    const { error } = await client.auth.signInWithPassword({ email:usernameEmail(username), password });
    if (error) return message('authStatus', 'ログインできませんでした。ID・パスワードを確認してください。');
    message('authStatus', 'ログインしました。');
  }
  async function signOut() { if (!client) return; const {error} = await client.auth.signOut(); if (error) throw error; currentUser = null; updateAccountUI(); showView('home'); }
  function updateAccountUI() {
    const loggedIn = !!currentUser;
    $('authPanel')?.classList.toggle('hidden', loggedIn);
    if (!loggedIn) {
      message('authStatus', client ? 'IDとパスワードでログインしてください。' : '接続設定を保存すると登録・ログインできます。');
      message('dbState', client ? '接続OK' : '未接続'); message('homeTitle','大切なフレンドカードを\nかわいくまとめよう。'); message('homeMessage','ログインしてフレカとマイキャラを管理しよう。');
      $('signOut')?.remove(); return;
    }
    message('authStatus','ログイン中です。'); message('dbState','ログイン中'); message('homeTitle','コレクションへようこそ'); message('homeMessage','フレカとマイキャラを管理できます。');
    if (!$('signOut')) { const b=document.createElement('button'); b.id='signOut'; b.className='secondary'; b.textContent='ログアウト'; b.addEventListener('click',()=>runSafely(signOut)); $('home')?.prepend(b); }
  }

  function getCardDataFields() {
    return { color:$('cardColor').value.trim(), appearance:$('cardAppearance').value.trim(), brand:$('cardBrand').value.trim(), memo:$('cardMemo').value.trim() };
  }
  function validImage(file, label) {
    if (!file) return true;
    if (!['image/jpeg','image/png','image/webp'].includes(file.type)) { message('cardRegisterStatus', label + 'はJPEG・PNG・WebP画像を選んでください。'); return false; }
    if (file.size > 10*1024*1024) { message('cardRegisterStatus', label + 'は10MB以下にしてください。'); return false; }
    return true;
  }
  async function uploadCardImage(cardId, file, type) {
    if (!file) return null;
    const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'})[file.type];
    const path = `${currentUser.id}/${cardId}/${type}.${ext}`;
    const { error } = await client.storage.from(BUCKET).upload(path, file, { upsert:true, contentType:file.type });
    if (error) throw new Error('画像アップロード失敗：' + error.message + '（Storageのバケットとポリシーを確認してください）');
    return path;
  }
  async function addCard() {
    if (!currentUser) return message('cardRegisterStatus','先にホームでログインしてください。');
    const name = $('newCardName').value.trim(), characterId = $('cardCharacter').value || null;
    const photo = $('cardPhoto').files[0] || null, qr = $('cardQr').files[0] || null;
    if (!name) return message('cardRegisterStatus','コーデ名を入力してください。');
    if (!validImage(photo,'写真') || !validImage(qr,'QRコード画像')) return;
    message('cardRegisterStatus','フレカを登録しています…'); $('addCard').disabled = true;
    let insertedCard = null;
    try {
      const {data,error} = await client.from('cards').insert({user_id:currentUser.id,card_name:name,card_data:getCardDataFields(),character_id:characterId}).select('id').single();
      if (error) throw error; insertedCard = data;
      const photoPath = await uploadCardImage(insertedCard.id, photo, 'outfit-photo');
      const qrPath = await uploadCardImage(insertedCard.id, qr, 'friend-qr');
      if (photoPath || qrPath) {
        const {error:updateError} = await client.from('cards').update({card_data:{...getCardDataFields(), photo_path:photoPath, qr_path:qrPath}}).eq('id',insertedCard.id).eq('user_id',currentUser.id);
        if (updateError) throw updateError;
      }
      ['newCardName','cardColor','cardAppearance','cardBrand','cardMemo','cardPhoto','cardQr'].forEach(id=>{ if ($(id)) $(id).value=''; }); $('cardCharacter').value='';
      message('cardRegisterStatus','フレカを登録しました！'); await loadCards(); showCardTab('search');
    } catch(error) {
      message('cardRegisterStatus','登録中にエラー：'+error.message + (insertedCard ? ' カード情報が登録済みの場合があります。一覧を確認してください。' : ''));
      if (insertedCard) await loadCards();
    } finally { $('addCard').disabled = false; }
  }
  async function addCharacter() {
    if (!currentUser) return message('characterStatus','先にホームでログインしてください。');
    const name=$('newCharName').value.trim(), memo=$('characterMemo').value.trim();
    if (!name) return message('characterStatus','マイキャラ名を入力してください。');
    const {error}=await client.from('my_characters').insert({user_id:currentUser.id,character_name:name,character_data:{memo}});
    if(error) return message('characterStatus','登録エラー：'+error.message);
    $('newCharName').value=''; $('characterMemo').value=''; message('characterStatus','マイキャラを登録しました！'); await loadCharacters();
  }
  function updateCharacterOptions() {
    const selector=$('cardCharacter'); if (!selector) return;
    const old=selector.value; selector.replaceChildren();
    const blank=document.createElement('option'); blank.value=''; blank.textContent='マイキャラを選択（任意）'; selector.appendChild(blank);
    characters.forEach(c=>{const o=document.createElement('option');o.value=c.id;o.textContent=c.character_name;selector.appendChild(o);});
    selector.value=characters.some(c=>c.id===old)?old:'';
  }
  function renderCharacterChips() {
    const containers=[$('characterChips'),$('homeCharacterList')].filter(Boolean);
    containers.forEach((container,index)=>{
      container.replaceChildren();
      if (!currentUser) { const p=document.createElement('p');p.className='muted';p.textContent='ログインするとマイキャラが表示されます。';container.appendChild(p);return; }
      if (index===0) {
        const all=document.createElement('button');all.textContent='全マイキャラ';all.classList.toggle('active',activeCharacter==='all');all.addEventListener('click',()=>{activeCharacter='all';renderCharacterChips();renderCards();});container.appendChild(all);
        characters.forEach(c=>{const b=document.createElement('button');b.textContent=c.character_name;b.classList.toggle('active',activeCharacter===c.id);b.addEventListener('click',()=>{activeCharacter=c.id;renderCharacterChips();renderCards();});container.appendChild(b);});
      } else {
        if (!characters.length) { const p=document.createElement('p');p.className='muted';p.textContent='マイキャラはまだ登録されていません。';container.appendChild(p); }
        characters.forEach(c=>{const b=document.createElement('button');b.textContent=c.character_name;b.addEventListener('click',()=>{showView('cards');activeCharacter=c.id;renderCharacterChips();renderCards();});container.appendChild(b);});
      }
    });
  }
  async function signedImageUrl(path) {
    if (!path || !client) return null;
    const {data,error}=await client.storage.from(BUCKET).createSignedUrl(path,3600);
    if(error){console.warn('画像を読み込めませんでした',error.message);return null;} return data?.signedUrl || null;
  }
  function appendText(parent, tag, text, className) { const el=document.createElement(tag);el.textContent=escapeText(text);if(className)el.className=className;parent.appendChild(el);return el; }
  async function renderCardMedia(container, data) {
    const entries=[['photo_path','コーデ写真'],['qr_path','フレンドコードQR']].filter(([key])=>data?.[key]);
    if(!entries.length)return;
    const media=document.createElement('div');media.className='itemMedia';container.appendChild(media);
    for(const [key,label] of entries){const url=await signedImageUrl(data[key]);if(!url)continue;const fig=document.createElement('figure');const img=document.createElement('img');img.src=url;img.alt=label;img.loading='lazy';fig.appendChild(img);appendText(fig,'figcaption',label);media.appendChild(fig);}
  }
  function renderCards() {
    const list=$('cardsList'); if(!list)return; list.replaceChildren();
    if(!currentUser){appendText(list,'p','ログインするとフレカを表示できます。','muted');return;}
    const keyword=($('cardSearch')?.value||'').trim().toLocaleLowerCase();
    const filtered=cards.filter(card=>{
      const d=card.card_data||{}, character=characters.find(c=>c.id===card.character_id), characterName=character?.character_name||'';
      const fields=[card.card_name,d.color,d.appearance,d.brand,d.memo,characterName].map(x=>String(x||'').toLocaleLowerCase());
      return fields.some(x=>x.includes(keyword)) && (activeCharacter==='all'||card.character_id===activeCharacter);
    });
    if(!filtered.length){appendText(list,'p',cards.length?'条件に合うフレカがありません。':'フレカはまだ登録されていません。','muted');return;}
    filtered.forEach(card=>{
      const item=document.createElement('article');item.className='item';const info=document.createElement('div');info.className='itemInfo';appendText(info,'strong',card.card_name);
      const d=card.card_data||{}, character=characters.find(c=>c.id===card.character_id);
      appendText(info,'p','マイキャラ：'+(character?.character_name||'未設定'));
      const tags=[['色',d.color],['姿',d.appearance],['ブランド',d.brand]].filter(([,v])=>v);
      if(tags.length){const row=document.createElement('div');row.className='metaLine';tags.forEach(([label,value])=>appendText(row,'span',label+'：'+value,'metaTag'));info.appendChild(row);}
      if(d.memo)appendText(info,'p',d.memo);
      item.appendChild(info);
      const del=document.createElement('button');del.className='danger';del.textContent='削除';del.addEventListener('click',()=>runSafely(async()=>{
        if(!confirm('「'+card.card_name+'」を削除しますか？'))return;
        const paths=[d.photo_path,d.qr_path].filter(Boolean); if(paths.length){const {error:storageError}=await client.storage.from(BUCKET).remove(paths);if(storageError)console.warn('画像ファイル削除エラー',storageError.message);}
        const {error}=await client.from('cards').delete().eq('id',card.id).eq('user_id',currentUser.id);if(error)throw error;message('cardRegisterStatus','フレカを削除しました。');await loadCards();
      }));item.appendChild(del);list.appendChild(item);renderCardMedia(item,d).catch(console.error);
    });
  }
  async function loadCards() {
    if(!client||!currentUser)return;
    const {data,error}=await client.from('cards').select('id,card_name,card_data,character_id,created_at').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(error){message('cardRegisterStatus','読み込みエラー：'+error.message);return;}
    cards=data||[];message('cardCount',String(cards.length));renderCards();
  }
  function renderCharacters() {
    const list=$('charsList');if(!list)return;list.replaceChildren();
    if(!currentUser){appendText(list,'p','ログインするとマイキャラを表示できます。','muted');return;}
    if(!characters.length){appendText(list,'p','マイキャラはまだ登録されていません。','muted');return;}
    characters.forEach(character=>{
      const item=document.createElement('article');item.className='item';const info=document.createElement('div');info.className='itemInfo';appendText(info,'strong',character.character_name);if(character.character_data?.memo)appendText(info,'p',character.character_data.memo);
      const actions=document.createElement('div');actions.className='buttonRow';actions.style.marginTop='0';
      const edit=document.createElement('button');edit.className='secondary';edit.textContent='名前・メモ編集';edit.addEventListener('click',()=>{
        const name=prompt('マイキャラ名',character.character_name);if(name===null)return;if(!name.trim())return alert('名前を入力してください。');
        const memo=prompt('メモ（任意）',character.character_data?.memo||'');if(memo===null)return;
        runSafely(async()=>{const {error}=await client.from('my_characters').update({character_name:name.trim(),character_data:{...(character.character_data||{}),memo:memo.trim()}}).eq('id',character.id).eq('user_id',currentUser.id);if(error)throw error;message('characterStatus','マイキャラを更新しました。');await loadCharacters();await loadCards();});
      });
      const del=document.createElement('button');del.className='danger';del.textContent='削除';del.addEventListener('click',()=>runSafely(async()=>{
        if(!confirm('「'+character.character_name+'」を削除しますか？\n紐づいたフレカのマイキャラ設定は未設定になります。'))return;
        const {error}=await client.from('my_characters').delete().eq('id',character.id).eq('user_id',currentUser.id);if(error)throw error;message('characterStatus','マイキャラを削除しました。');if(activeCharacter===character.id)activeCharacter='all';await loadCharacters();await loadCards();
      }));actions.append(edit,del);item.append(info,actions);list.appendChild(item);
    });
  }
  async function loadCharacters() {
    if(!client||!currentUser)return;
    const {data,error}=await client.from('my_characters').select('id,character_name,character_data,created_at').eq('user_id',currentUser.id).order('created_at',{ascending:false});
    if(error){message('characterStatus','読み込みエラー：'+error.message);return;}
    characters=data||[];message('charCount',String(characters.length));updateCharacterOptions();renderCharacters();renderCharacterChips();
  }
  async function loadShare() {
    if(!client||!currentUser)return;
    const {data,error}=await client.from('profiles').select('is_public,share_slug,display_name').eq('id',currentUser.id).maybeSingle();
    if(error||!data){message('shareStatus','プロフィールを読み込めませんでした。');return;}
    $('publicToggle').checked=!!data.is_public;
    shareUrl=data.share_slug?location.origin+location.pathname+'?share='+encodeURIComponent(data.share_slug):'';
    $('shareUrl').value=data.is_public&&shareUrl?shareUrl:'現在は非公開です。';$('shareLinkArea').classList.toggle('hidden',!data.is_public||!shareUrl);
  }
  async function savePublic() {
    if(!currentUser)return message('shareStatus','先にログインしてください。');
    const {error}=await client.from('profiles').update({is_public:$('publicToggle').checked}).eq('id',currentUser.id);
    if(error)return message('shareStatus','保存エラー：'+error.message);
    await loadShare();message('shareStatus','公開設定を保存しました。※共有ページの表示設定は別途必要です。');
  }
  async function loadData(){if(!client||!currentUser)return;await loadCharacters();await loadCards();await loadShare();}

  $('signupBtn')?.addEventListener('click',()=>runSafely(signUp));
  $('loginBtn')?.addEventListener('click',()=>runSafely(async()=>{await boot();await signIn();}));
  $('addCard')?.addEventListener('click',()=>runSafely(addCard));
  $('addChar')?.addEventListener('click',()=>runSafely(addCharacter));
  $('savePublic')?.addEventListener('click',()=>runSafely(savePublic));
  $('cardSearch')?.addEventListener('input',renderCards);
  $('copyShare')?.addEventListener('click',async()=>{
    if(!shareUrl)return message('shareStatus','共有URLがありません。プロフィール設定を確認してください。');
    try{await navigator.clipboard.writeText(shareUrl);message('shareStatus','共有URLをコピーしました。');}catch{message('shareStatus',shareUrl);}
  });
  $('save')?.addEventListener('click',async()=>{
    const url=$('url').value.trim().replace(/\/+$/,''),key=$('key').value.trim();
    if(!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(url)||(!key.startsWith('sb_publishable_')&&!key.startsWith('eyJ'))){message('status','Project URLとPublishable keyを確認してください。');return;}
    localStorage.setItem('aipri_url',url);localStorage.setItem('aipri_key',key);message('status','接続を確認しています…');
    try{const response=await fetch(url+'/auth/v1/health',{headers:{apikey:key},cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);client=null;bootPromise=null;await boot();message('dbState','接続OK');message('status','接続できました。');settings.classList.add('hidden');notice?.classList.add('hidden');}
    catch(error){message('dbState','要確認');message('status','接続失敗：'+(error?.message||error));}
  });
  showCardTab('search');showView(new URLSearchParams(location.search).has('share')?'share':'home');
  if(localStorage.getItem('aipri_url')&&localStorage.getItem('aipri_key'))boot().catch(error=>{console.error(error);message('authStatus','初期化エラー：'+(error?.message||error));});
})();
