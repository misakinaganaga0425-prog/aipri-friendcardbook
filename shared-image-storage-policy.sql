-- アイプリ フレンドカード図鑑：共有ページで公開画像を表示するためのStorageポリシー
-- Supabase SQL Editor で実行してください。
-- 公開設定がONのマイキャラ画像と、公開設定がONのフレカ画像だけを
-- anon / authenticated が署名付きURLで読み込めるようにします。

drop policy if exists "Public shared character and card media read" on storage.objects;

create policy "Public shared character and card media read"
on storage.objects
for select
to anon, authenticated
using (
  bucket_id = 'friend-card-media'
  and (
    -- マイキャラ図鑑で公開中のメイン画像（旧フィールドも含む）
    exists (
      select 1
      from public.my_characters mc
      where mc.character_data->>'is_public' = 'true'
        and (
          mc.character_data->>'main_image_path' = storage.objects.name
          or mc.character_data->>'image_path' = storage.objects.name
          or mc.character_data->>'image_url' = storage.objects.name
          or mc.character_data->>'image' = storage.objects.name
          or mc.character_data->>'photo_url' = storage.objects.name
          or mc.character_data->>'illustration_url' = storage.objects.name
        )
    )
    -- マイキャラ図鑑で公開中のスタイル画像
    or exists (
      select 1
      from public.my_characters mc
      cross join lateral jsonb_array_elements(
        case
          when jsonb_typeof(mc.character_data->'appearance_photos') = 'array'
            then mc.character_data->'appearance_photos'
          else '[]'::jsonb
        end
      ) as photo
      where mc.character_data->>'is_public' = 'true'
        and photo->>'path' = storage.objects.name
    )
    -- フレカ図鑑で公開中のコーデ写真・QR画像
    or exists (
      select 1
      from public.cards c
      where c.is_public = true
        and (
          c.card_data->>'photo_path' = storage.objects.name
          or c.card_data->>'qr_path' = storage.objects.name
        )
    )
  )
);
