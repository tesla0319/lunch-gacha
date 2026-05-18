/**
 * app.js - ランチガチャ アプリ本体
 * Step7 (MVP完成版)
 *
 * 【このファイルの構成】
 *  1. CONFIG              … 全設定値を一元管理
 *  2. DOM 要素の参照       … 操作する要素をまとめて取得
 *  3. 状態変数             … フラグ・音声キャッシュ
 *  4. wait()              … 非同期待機ヘルパー
 *  5. ---- 音声機能 ----
 *     unlockAudio()       … iOS Safari の再生制限を解除する ★ Step6追加
 *     playSound()         … 効果音を再生する              ★ Step6追加
 *  6. validateConfig()    … CONFIG の妥当性チェック
 *  7. pickRarity()        … 重み付き抽選
 *  8. pickItemByRarity()  … レアリティ内アイテム選択
 *  9. shouldPromote()     … 昇格演出判定
 * 10. renderResult()      … DOM に結果を反映
 * 11. playNormalAnimation()   … 通常演出（async）
 * 12. playPromotionAnimation() … 昇格演出（async）
 * 13. playAnimation()     … 演出ディスパッチャー
 * 14. resetDisplay()      … 表示リセット
 * 15. finishAnimation()   … 演出終了共通処理
 * 16. showError()         … エラー表示
 * 17. playGacha()         … ガチャ全体フロー
 * 18. イベントリスナー
 */

'use strict';

/* ============================================================
   1. CONFIG
   ============================================================ */

const CONFIG = {

  rarityWeights: {
    SSR: 3,
    SR:  12,
    R:   35,
    N:   50,
  },

  promotionRate: 30,

  normalAnimMs:    2500,
  promotionAnimMs: 4500,

  items: [
    { name: '焼肉',     rarity: 'SSR' },
    { name: '寿司',     rarity: 'SR'  },
    { name: 'ラーメン', rarity: 'R'   },
    { name: 'カレー',   rarity: 'R'   },
    { name: 'コンビニ', rarity: 'N'   },
  ],
};

/* ============================================================
   2. DOM 要素の参照
   ============================================================ */

const gachaBtn          = document.getElementById('gacha-btn');
const resultArea        = document.getElementById('result-area');
const resultRarity      = document.getElementById('result-rarity');
const resultName        = document.getElementById('result-name');
const resultPromotion   = document.getElementById('result-promotion');
const resultPlaceholder = document.getElementById('result-placeholder');
const screenOverlay     = document.getElementById('screen-overlay');
const resultOverlay     = document.getElementById('result-overlay');
const overlayText       = document.getElementById('overlay-text');

/* ============================================================
   3. 状態変数
   ============================================================ */

// ガチャ演出中フラグ（多重実行防止）
let isGachaRunning = false;

/*
  音声キャッシュ：{ 'click': AudioObject, 'gacha_start': AudioObject, ... }
  unlockAudio() が成功した音声だけ格納される。
  mp3 が未配置のキーは undefined のまま（playSound がハンドリングする）。
*/
const audioCache = {};

/*
  isAudioUnlocked：unlockAudio() を一度だけ実行するためのフラグ。
  最初のボタンタップ時に true になる。
*/
let isAudioUnlocked = false;

/* ============================================================
   4. wait(ms) - 非同期待機ヘルパー
   ============================================================ */

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   5-A. unlockAudio() - iOS Safari の再生制限を解除する ★ Step6追加
   ============================================================

   【iOS Safari の制約】
   ブラウザは「ユーザー操作（タップ/クリック）に直接反応したコード」の中でしか
   Audio の初回再生を許可しない。
   async/await の await より後のコードは setTimeout と同じ扱いになるため、
   「ユーザー操作に直接反応」とはみなされない。

   【解決策：事前アンロック】
   ① ボタンタップで呼ばれる playGacha() の先頭（同期処理）で unlockAudio() を実行。
   ② unlockAudio() で全音声ファイルの Audio 要素を作成し、音量0で一瞬再生する。
   ③ iOS Safari はこの操作で「このAudio要素の再生を許可」と記憶する。
   ④ 以降は await の後でも、アンロック済みの Audio 要素は再生できる。

   ※ mp3 が未配置の場合は play() が失敗するが、catch で無視する（動作に影響なし）。
*/

function unlockAudio() {
  // 2回目以降は何もしない
  if (isAudioUnlocked) return;
  isAudioUnlocked = true;

  const soundNames = ['click', 'gacha_start', 'ssr', 'result'];

  soundNames.forEach(name => {
    try {
      const audio = new Audio(`sounds/${name}.wav`);
      audio.volume = 0; // 音量ゼロ（ユーザーには聞こえない）

      // play() を呼んで iOS に「この要素の再生を許可」と登録させる
      const promise = audio.play();

      if (promise !== undefined) {
        promise
          .then(() => {
            // 再生成功 → 止めてキャッシュに保存（以降はキャッシュを使い回す）
            audio.pause();
            audio.currentTime = 0;
            audio.volume = 1;
            audioCache[name] = audio;
          })
          .catch(() => {
            // ファイル未配置など → キャッシュに入れない（playSound が個別に対処）
          });
      }
    } catch (err) {
      // Audio コンストラクタ自体が失敗した場合も無視
    }
  });
}

/* ============================================================
   5-B. playSound(name) - 効果音を再生する ★ Step6追加
   ============================================================

   【設計方針】
   - wav が存在しなくても console.warn だけで処理を続ける
   - play() の Promise reject も必ずキャッチする（iOSで必須）
   - try-catch で Audio コンストラクタのエラーも吸収する

   【キャッシュ戦略】
   - unlockAudio() で成功した音声はキャッシュ済みなので高速に再生できる
   - キャッシュにない場合（wav未配置など）は新規 Audio を作って再生試行する
     → 失敗しても console.warn で記録するだけ

   引数 name：'click' | 'gacha_start' | 'ssr' | 'result'
*/

function playSound(name) {
  try {
    const cached = audioCache[name];

    if (cached) {
      // キャッシュ済みの Audio 要素を先頭に戻して再生
      cached.currentTime = 0;
      cached.play().catch(err => {
        console.warn(`[Sound] "${name}" の再生をスキップしました:`, err.message);
      });
    } else {
      // キャッシュにない → ファイル未配置か、アンロック処理がまだ完了していない
      // 新しい Audio で再生試行（失敗しても続行）
      const audio = new Audio(`sounds/${name}.wav`);
      audio.play().catch(() => {
        // warn を出しすぎるのも邪魔なので、未配置ファイルは静かにスキップ
        console.warn(`[Sound] "sounds/${name}.wav" をスキップ（ファイル未配置の可能性）`);
      });
    }
  } catch (err) {
    // Audio コンストラクタのエラーなど、予期しない例外
    console.warn(`[Sound] "${name}" で予期しないエラーが発生しました:`, err.message);
  }
}

/* ============================================================
   6. validateConfig()
   ============================================================ */

function validateConfig() {
  const weights = CONFIG.rarityWeights;

  for (const [rarity, weight] of Object.entries(weights)) {
    if (typeof weight !== 'number') {
      console.error(`[CONFIG ERROR] rarityWeights に数値以外の値があります: ${rarity}="${weight}"`);
      return false;
    }
    if (Number.isNaN(weight)) {
      console.error(`[CONFIG ERROR] rarityWeights に NaN があります: ${rarity}=NaN`);
      return false;
    }
    if (!Number.isFinite(weight)) {
      console.error(`[CONFIG ERROR] rarityWeights に Infinity があります: ${rarity}=${weight}`);
      return false;
    }
    if (weight < 0) {
      console.error(`[CONFIG ERROR] rarityWeights に負の値があります: ${rarity}=${weight}`);
      return false;
    }
  }

  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total !== 100) {
    console.error(`[CONFIG ERROR] rarityWeights の合計が 100 ではありません: 実際の合計=${total}`);
    return false;
  }

  return true;
}

/* ============================================================
   7. pickRarity()
   ============================================================ */

function pickRarity() {
  const rand = Math.random() * 100;
  let cumulative = 0;

  for (const [rarity, weight] of Object.entries(CONFIG.rarityWeights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return rarity;
    }
  }

  const rarities = Object.keys(CONFIG.rarityWeights);
  return rarities[rarities.length - 1];
}

/* ============================================================
   8. pickItemByRarity(rarity)
   ============================================================ */

function pickItemByRarity(rarity) {
  const candidates = CONFIG.items.filter(item => item.rarity === rarity);

  if (candidates.length === 0) {
    console.error(`[CONFIG ERROR] rarity="${rarity}" に対応するアイテムがありません`);
    return null;
  }

  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

/* ============================================================
   9. shouldPromote(rarity)
   ============================================================ */

function shouldPromote(rarity) {
  if (rarity !== 'SSR') return false;
  return Math.random() * 100 < CONFIG.promotionRate;
}

/* ============================================================
   10. renderResult(item, isPromotion)
   ============================================================ */

function renderResult(item, isPromotion) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;

  resultPlaceholder.classList.add('hidden');

  resultRarity.textContent = item.rarity;
  resultRarity.className   = `result-rarity ${rarityClass}`;

  resultName.textContent = item.name;
  resultName.className   = `result-name ${rarityClass}`;

  if (isPromotion) {
    resultPromotion.textContent = '🎊 昇格演出あり';
    resultPromotion.className   = 'result-promotion rarity-ssr';
  } else {
    resultPromotion.className = 'result-promotion hidden';
  }

  resultArea.className = `result-area ${rarityClass}`;
}

/* ============================================================
   11. playNormalAnimation(item) - 通常演出
   ============================================================

   【効果音タイミング】
   - playSound('gacha_start') … Phase1 の先頭（await より前＝ユーザー操作コンテキスト内）
   - playSound('result')      … finishAnimation() 内で呼ぶ（await 後・キャッシュ使用）
*/

async function playNormalAnimation(item) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;
  const phase2Ms    = Math.floor(CONFIG.normalAnimMs * 0.42);
  const phase3Ms    = CONFIG.normalAnimMs - phase2Ms;

  // ---- Phase1：暗転 + 「抽選中…」----
  resetDisplay();
  screenOverlay.classList.add('active');
  overlayText.textContent = '抽選中…';
  overlayText.className   = 'overlay-text is-pulsing';
  resultOverlay.className = 'result-overlay';
  resultArea.className    = 'result-area is-animating';

  // ガチャ開始音（await より前なので iOS でも確実に鳴る）
  playSound('gacha_start');

  await wait(phase2Ms); // ≈ 1050ms

  // ---- Phase2：「結果発表！」+ レアリティ色 ----
  overlayText.textContent = '結果発表！';
  overlayText.className   = `overlay-text ${rarityClass}`;
  resultOverlay.className = `result-overlay ${rarityClass}`;
  resultArea.className    = 'result-area';

  await wait(phase3Ms); // ≈ 1450ms

  // ---- Phase3：結果表示（finishAnimation が result 音を鳴らす）----
  finishAnimation(item, false);
}

/* ============================================================
   12. playPromotionAnimation(item) - 昇格演出
   ============================================================

   【効果音タイミング】
   - playSound('gacha_start') … Phase1（await 前）
   - playSound('ssr')         … Phase5 昇格テキスト表示時（キャッシュ使用）
   - playSound('result')      … finishAnimation() 内（キャッシュ使用）
*/

async function playPromotionAnimation(item) {

  // ---- Phase1：「抽選中…」----
  resetDisplay();
  screenOverlay.classList.add('active');
  overlayText.textContent = '抽選中…';
  overlayText.className   = 'overlay-text is-pulsing';
  resultOverlay.className = 'result-overlay';
  resultArea.className    = 'result-area is-animating';

  // ガチャ開始音（await より前）
  playSound('gacha_start');

  await wait(1000);

  // ---- Phase2：「R... ?」R っぽい演出 ----
  overlayText.textContent = 'R ... ?';
  overlayText.className   = 'overlay-text rarity-r';
  resultOverlay.className = 'result-overlay rarity-r';
  resultArea.className    = 'result-area';

  await wait(1100);

  // ---- Phase3：R 色のカードをチラ見せ ----
  resultOverlay.className = 'result-overlay hidden';
  resultArea.className    = 'result-area rarity-r';

  await wait(500);

  // ---- Phase4：フラッシュ ----
  resultOverlay.className = 'result-overlay flash';

  await wait(500);

  // ---- Phase5：「✨ 昇格！！」虹色テキスト ----
  overlayText.textContent = '✨ 昇格！！';
  overlayText.className   = 'overlay-text is-rainbow';
  resultOverlay.className = 'result-overlay rarity-ssr';
  resultArea.className    = 'result-area rarity-ssr';

  // SSR 演出音（unlockAudio でキャッシュ済みなので await 後でも再生可能）
  playSound('ssr');

  await wait(1400);

  // ---- Phase6：SSR 結果を表示（finishAnimation が result 音を鳴らす）----
  finishAnimation(item, true);
}

/* ============================================================
   13. playAnimation(item, isPromotion) - 演出ディスパッチャー
   ============================================================ */

function playAnimation(item, isPromotion) {
  const animFn = isPromotion ? playPromotionAnimation : playNormalAnimation;

  animFn(item).catch(err => {
    console.error('[演出エラー]', err);

    /*
      演出の途中でエラーが起きた場合、画面が暗転したまま
      ボタンも押せない状態になってしまう。
      ここで確実にクリーンアップして、アプリを使える状態に戻す。
    */
    screenOverlay.classList.remove('active');
    resultOverlay.className = 'result-overlay hidden';
    resultArea.className    = 'result-area';

    isGachaRunning = false;
    gachaBtn.disabled = false;
  });
}

/* ============================================================
   14. resetDisplay() - 演出開始前に前回の表示をリセット
   ============================================================ */

function resetDisplay() {
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
  // .is-error が残っていると次回エラーでない表示でも赤文字になるのでクリアする
  resultPlaceholder.classList.remove('is-error');
  resultPlaceholder.classList.add('hidden');
}

/* ============================================================
   15. finishAnimation(item, isPromotion) - 演出終了共通処理
   ============================================================ */

function finishAnimation(item, isPromotion) {
  resultOverlay.className = 'result-overlay hidden';
  overlayText.className   = 'overlay-text';
  screenOverlay.classList.remove('active');

  renderResult(item, isPromotion);
  resultArea.classList.add('anim-card-reveal');

  // 結果表示音（unlockAudio 済みなので await 後でも再生可能）
  playSound('result');

  resultRarity.classList.add('anim-fade-in');
  resultName.classList.add('anim-fade-in');
  if (isPromotion) {
    resultPromotion.classList.add('anim-fade-in');
  }

  isGachaRunning = false;
  gachaBtn.disabled = false;

  console.log('[ガチャ完了] 演出終了・ボタン再有効化');
}

/* ============================================================
   16. showError(message)
   ============================================================ */

function showError(message) {
  resultPlaceholder.textContent = message;
  /*
    インラインスタイルは後からリセットが難しいので CSS クラスを使う。
    .is-error クラスが color を #f87171（赤）に上書きする。
    次回 resetDisplay() が呼ばれると .is-error が外れて元の色に戻る。
  */
  resultPlaceholder.classList.add('is-error');
  resultPlaceholder.classList.remove('hidden');
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
  resultArea.className      = 'result-area';
}

/* ============================================================
   17. playGacha() - ガチャ全体のフロー制御
   ============================================================

   【処理順序の意図】
   ① unlockAudio() … iOS Safari の再生制限解除（初回のみ・同期処理内）
   ② playSound('click') … 同期コンテキスト内なので iOS でも確実に鳴る
   ③ validateConfig() … 抽選前に設定の正常性を保証する
   ④ 抽選処理 … 演出開始前に全結果を確定させる（仕様書 5.1.3）
   ⑤ フラグ ON + ボタン無効化 … ここからガチャが「実行中」状態になる
   ⑥ playAnimation() … 演出終了後に⑤を解除する
*/

function playGacha() {

  if (isGachaRunning) return;

  // ① iOS Safari のオーディオロックを解除（初回のみ。2回目以降は即return）
  unlockAudio();

  // ② ボタン押下音（ユーザー操作の直後 = 同期処理内なので確実に鳴る）
  playSound('click');

  // ③ CONFIG 検証
  if (!validateConfig()) {
    showError('設定エラー：管理者にお問い合わせください');
    return;
  }

  // ④ 抽選結果をすべて確定（演出開始前に決める）
  const rarity      = pickRarity();
  const item        = pickItemByRarity(rarity);
  const isPromotion = shouldPromote(rarity);

  if (!item) {
    showError('抽選エラーが発生しました');
    return;
  }

  console.log('[ガチャ結果確定]', {
    rarity,
    item: item.name,
    promotion: isPromotion ? '昇格演出あり🎊' : 'なし',
  });

  // ⑤ 実行中フラグ ON・ボタン無効化
  isGachaRunning = true;
  gachaBtn.disabled = true;

  // ⑥ 演出開始
  playAnimation(item, isPromotion);
}

/* ============================================================
   18. イベントリスナー
   ============================================================ */

gachaBtn.addEventListener('click', playGacha);
