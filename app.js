/**
 * app.js - ランチガチャ アプリ本体
 * Step5: 昇格演出（R っぽい演出 → フラッシュ → SSR へ昇格）
 *
 * 【このファイルの構成】
 *  1. CONFIG              … 全設定値を一元管理
 *  2. DOM 要素の参照       … 操作する要素をまとめて取得
 *  3. 状態変数             … アプリの状態を管理するフラグ
 *  4. wait()              … 非同期待機ヘルパー（async/await 用）★ Step5追加
 *  5. validateConfig()    … CONFIG の妥当性チェック
 *  6. pickRarity()        … 重み付き抽選でレアリティを決定
 *  7. pickItemByRarity()  … レアリティ内からアイテムをランダム選択
 *  8. shouldPromote()     … 昇格演出を発生させるか判定
 *  9. renderResult()      … 抽選結果を画面（DOM）に反映
 * 10. playNormalAnimation() … 通常演出フロー（async）★ Step5で async/await 化
 * 11. playPromotionAnimation() … 昇格演出フロー（async）★ Step5追加
 * 12. playAnimation()     … 演出ディスパッチャー（通常/昇格を振り分ける）
 * 13. showError()         … エラーメッセージを画面に表示
 * 14. playGacha()         … ガチャ全体のフロー制御（メイン関数）
 * 15. イベントリスナー     … ボタン押下の検知
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

  promotionRate: 30, // SSR 当選時のうち昇格演出が発生する確率（%）

  // 演出時間（ミリ秒）
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

let isGachaRunning = false;

/* ============================================================
   4. wait(ms) - 非同期待機ヘルパー ★ Step5追加
   ============================================================

   なぜ wait() を作るか：
   setTimeout を入れ子（ネスト）で書くと「コールバック地獄」と呼ばれる
   読みにくい構造になる。wait() を使うと以下のように書ける：

     await wait(1000); // 1秒待つ
     await wait(500);  // 0.5秒待つ

   これで演出フローを「上から順に読める」コードにできる。

   仕組み：
   Promise は「非同期処理の結果を表すオブジェクト」。
   setTimeout が完了したときに resolve() を呼ぶ Promise を返している。
   async 関数の中で await すると、Promise が解決するまで処理が止まる。
*/

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/* ============================================================
   5. validateConfig()
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
   6. pickRarity()
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
   7. pickItemByRarity(rarity)
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
   8. shouldPromote(rarity)
   ============================================================ */

function shouldPromote(rarity) {
  if (rarity !== 'SSR') return false;
  return Math.random() * 100 < CONFIG.promotionRate;
}

/* ============================================================
   9. renderResult(item, isPromotion)
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
   10. playNormalAnimation(item) - 通常演出  ★ async/await 化
   ============================================================

   SSR（昇格なし）・SR・R・N すべての通常ガチャ演出。
   フェーズを await wait() で区切ることで、上から順に読める構造にする。
*/

async function playNormalAnimation(item) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;
  const phase2Ms    = Math.floor(CONFIG.normalAnimMs * 0.42); // ≈ 1050ms
  const phase3Ms    = CONFIG.normalAnimMs - phase2Ms;         // ≈ 1450ms

  // ---- Phase1：暗転 + 「抽選中…」----
  resetDisplay();                             // 前回の結果をクリア
  screenOverlay.classList.add('active');      // 画面を暗転
  overlayText.textContent = '抽選中…';
  overlayText.className   = 'overlay-text is-pulsing';  // パルスアニメ開始
  resultOverlay.className = 'result-overlay';            // オーバーレイを表示
  resultArea.className    = 'result-area is-animating';  // カード枠を点滅

  await wait(phase2Ms); // ≈ 1050ms 待機

  // ---- Phase2：「結果発表！」+ レアリティ色に変化 ----
  overlayText.textContent = '結果発表！';
  overlayText.className   = `overlay-text ${rarityClass}`;    // テキストをレアリティ色に
  resultOverlay.className = `result-overlay ${rarityClass}`;  // 背景をレアリティ色にほんのり
  resultArea.className    = 'result-area';                    // カード点滅を止める

  await wait(phase3Ms); // ≈ 1450ms 待機

  // ---- Phase3：結果表示 ----
  finishAnimation(item, false);
}

/* ============================================================
   11. playPromotionAnimation(item) - 昇格演出  ★ Step5追加
   ============================================================

   昇格演出フロー（合計 promotionAnimMs = 4500ms）：
   ─────────────────────────────────────────────────────────
   Phase1 (0ms → 1000ms)    ：「抽選中…」（通常と同じ出だし）
   Phase2 (1000ms → 2100ms) ：「R... ?」青色演出（R っぽく見せる）
   Phase3 (2100ms → 2600ms) ：R 色のカードをチラ見せ（オーバーレイ非表示）
   Phase4 (2600ms → 3100ms) ：フラッシュ（金色に輝く）
   Phase5 (3100ms → 4500ms) ：「✨ 昇格！！」虹色テキスト
   Phase6 (4500ms)          ：本当の SSR 結果を表示
   ─────────────────────────────────────────────────────────

   【重要】抽選結果（SSR・アイテム）はすでに確定している。
   この関数は「見せ方」だけを制御し、結果を書き換えることはない。
*/

async function playPromotionAnimation(item) {

  // ---- Phase1：「抽選中…」（通常と同じ） ----
  resetDisplay();
  screenOverlay.classList.add('active');
  overlayText.textContent = '抽選中…';
  overlayText.className   = 'overlay-text is-pulsing';
  resultOverlay.className = 'result-overlay';
  resultArea.className    = 'result-area is-animating';

  await wait(1000);

  // ---- Phase2：「R... ?」R っぽい演出でユーザーを油断させる ----
  // 本当は SSR だが、まず R（青）に見えるようにする
  overlayText.textContent = 'R ... ?';
  overlayText.className   = 'overlay-text rarity-r';      // 青テキスト
  resultOverlay.className = 'result-overlay rarity-r';    // 背景をうっすら青に
  resultArea.className    = 'result-area';                // カード点滅を止める

  await wait(1100);

  // ---- Phase3：R 色のカードをチラ見せ ----
  // オーバーレイを一旦消して「あ、R か…」と思わせる瞬間
  resultOverlay.className = 'result-overlay hidden';
  resultArea.className    = 'result-area rarity-r';       // R の青グローだけ見せる
  // （アイテム名・レアリティバッジはまだ非表示のまま）

  await wait(500);

  // ---- Phase4：フラッシュ ----
  // 突然金色に輝いて「何かが変わる」ことを知らせる
  resultOverlay.className = 'result-overlay flash';       // card-flash アニメ発動
  // フラッシュアニメ（0.45s）より少し長く待つ
  await wait(500);

  // ---- Phase5：「✨ 昇格！！」虹色テキスト ----
  // フラッシュ後に SSR 金演出へ切り替える
  overlayText.textContent = '✨ 昇格！！';
  overlayText.className   = 'overlay-text is-rainbow';    // 虹色アニメーション
  resultOverlay.className = 'result-overlay rarity-ssr';  // 背景を SSR 色（暖色）に
  resultArea.className    = 'result-area rarity-ssr';     // カードを金グローに

  await wait(1400);

  // ---- Phase6：SSR 結果を表示 ----
  finishAnimation(item, true);
}

/* ============================================================
   12. playAnimation(item, isPromotion) - 演出ディスパッチャー
   ============================================================

   isPromotion の値によって通常演出と昇格演出を振り分ける。
   どちらも async 関数なので Promise を返す。
   エラーが起きてもボタンが永久に無効にならないよう .catch() で保護する。
*/

function playAnimation(item, isPromotion) {
  // isPromotion が true なら昇格演出、false なら通常演出
  const animFn = isPromotion ? playPromotionAnimation : playNormalAnimation;

  // async 関数を呼び出し、エラーが起きたときの保護を追加する
  animFn(item).catch(err => {
    // 万が一演出中にエラーが出ても、ボタンが永久に無効にならないようにする
    console.error('[演出エラー]', err);
    isGachaRunning = false;
    gachaBtn.disabled = false;
  });
}

/* ============================================================
   ヘルパー関数
   ============================================================ */

/*
  resetDisplay()：演出開始前に前回の結果表示をリセットする。
  毎回クリーンな状態から演出を始めるために必要。
*/
function resetDisplay() {
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
  resultPlaceholder.classList.add('hidden');
}

/*
  finishAnimation(item, isPromotion)：演出の最終フェーズ（共通処理）。
  通常演出・昇格演出どちらも最後はこれを呼ぶ。
  - オーバーレイを消す
  - 画面を明転
  - renderResult でアイテムを表示
  - フェードインアニメーション付与
  - ガチャ完了（ボタン再有効化）
*/
function finishAnimation(item, isPromotion) {
  resultOverlay.className = 'result-overlay hidden';
  overlayText.className   = 'overlay-text';
  screenOverlay.classList.remove('active');

  renderResult(item, isPromotion);

  // フェードインアニメーションを付与（renderResult が className をリセットした後なので確実に動く）
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
   13. showError(message)
   ============================================================ */

function showError(message) {
  resultPlaceholder.textContent = message;
  resultPlaceholder.style.color = '#f87171';
  resultPlaceholder.classList.remove('hidden');
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
  resultArea.className      = 'result-area';
}

/* ============================================================
   14. playGacha() - ガチャ全体のフロー制御（メイン関数）
   ============================================================ */

function playGacha() {

  if (isGachaRunning) return;

  if (!validateConfig()) {
    showError('設定エラー：管理者にお問い合わせください');
    return;
  }

  // ① 抽選結果をすべて確定（演出開始前に決める）
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

  // ② 実行中フラグ ON・ボタン無効化
  isGachaRunning = true;
  gachaBtn.disabled = true;

  // ③ 演出開始
  playAnimation(item, isPromotion);
}

/* ============================================================
   15. イベントリスナー
   ============================================================ */

gachaBtn.addEventListener('click', playGacha);
