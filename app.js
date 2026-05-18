/**
 * app.js - ランチガチャ アプリ本体
 * Step4: ガチャ演出（暗転・テキスト切り替え・レアリティ色変化）
 *
 * 【このファイルの構成】
 *  1. CONFIG             … 全設定値を一元管理
 *  2. DOM 要素の参照      … 操作する要素をまとめて取得
 *  3. 状態変数            … アプリの状態を管理するフラグ
 *  4. validateConfig()   … CONFIG の妥当性チェック
 *  5. pickRarity()       … 重み付き抽選でレアリティを決定
 *  6. pickItemByRarity() … レアリティ内からアイテムをランダム選択
 *  7. shouldPromote()    … 昇格演出を発生させるか判定
 *  8. renderResult()     … 抽選結果を画面（DOM）に反映
 *  9. playAnimation()    … 演出フロー制御（暗転→テキスト→結果表示）★Step4追加
 * 10. showError()        … エラーメッセージを画面に表示
 * 11. playGacha()        … ガチャ全体のフロー制御（メイン関数）
 * 12. イベントリスナー    … ボタン押下の検知
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

  // 演出時間（ミリ秒）。playAnimation() で参照する。
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

// Step4 で追加：演出用オーバーレイ
const screenOverlay     = document.getElementById('screen-overlay');
const resultOverlay     = document.getElementById('result-overlay');
const overlayText       = document.getElementById('overlay-text');

/* ============================================================
   3. 状態変数
   ============================================================ */

let isGachaRunning = false;

/* ============================================================
   4. validateConfig()
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
   5. pickRarity()
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
   6. pickItemByRarity(rarity)
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
   7. shouldPromote(rarity)
   ============================================================ */

function shouldPromote(rarity) {
  if (rarity !== 'SSR') return false;
  return Math.random() * 100 < CONFIG.promotionRate;
}

/* ============================================================
   8. renderResult(item, isPromotion)
   抽選結果を画面（DOM）に反映する。
   演出には関与しない。表示だけに徹する。
   ============================================================ */

function renderResult(item, isPromotion) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;

  // プレースホルダーを非表示
  resultPlaceholder.classList.add('hidden');

  // レアリティバッジを表示（className の書き換えで hidden が外れる）
  resultRarity.textContent = item.rarity;
  resultRarity.className   = `result-rarity ${rarityClass}`;

  // アイテム名を表示
  resultName.textContent = item.name;
  resultName.className   = `result-name ${rarityClass}`;

  // 昇格演出テキスト
  if (isPromotion) {
    resultPromotion.textContent = '🎊 昇格演出あり';
    resultPromotion.className   = 'result-promotion rarity-ssr';
  } else {
    resultPromotion.className = 'result-promotion hidden';
  }

  // カードの枠線・グローをレアリティ色に変える
  resultArea.className = `result-area ${rarityClass}`;
}

/* ============================================================
   9. playAnimation(item, isPromotion)   ★ Step4 で追加
   ============================================================

   演出の3フェーズ：
   ─────────────────────────────────────────────────────────
   Phase1（t=0）
     ・画面暗転（screen-overlay を active に）
     ・カード内に「抽選中…」を表示（パルスアニメ）
     ・カード枠を点滅させる（is-animating）
   ─────────────────────────────────────────────────────────
   Phase2（t = totalMs × 40% ≈ 1000ms）
     ・テキストを「結果発表！」に変更
     ・テキスト色をレアリティ色に変更（色でレアリティを予告）
     ・オーバーレイ背景を薄くレアリティ色に染める
     ・カードの点滅を止める
   ─────────────────────────────────────────────────────────
   Phase3（t = totalMs ≈ 2500ms）
     ・オーバーレイを非表示
     ・画面を明転
     ・renderResult() で結果を表示
     ・フェードインアニメーションを付与
     ・ボタン再有効化・フラグ解除
   ─────────────────────────────────────────────────────────

   【重要】このメソッドは演出を制御するだけ。
   抽選はすでに playGacha() で完了しており、
   ここでは item と isPromotion を使うだけで再抽選しない。
*/

function playAnimation(item, isPromotion) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`;

  // isPromotion の場合は演出時間を長くする（Step5 で本格的な昇格演出を追加）
  const totalMs  = isPromotion ? CONFIG.promotionAnimMs : CONFIG.normalAnimMs;
  const phase2Ms = Math.floor(totalMs * 0.42); // Phase2 開始タイミング

  // ---- Phase1：暗転 + 抽選中テキスト ----

  // 前回の結果表示をリセット（カード・各要素のクラスをデフォルトに戻す）
  resultArea.className      = 'result-area is-animating';
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
  resultPlaceholder.classList.add('hidden');

  // 画面全体を暗転（CSS transition が 0.4s で黒くなる）
  screenOverlay.classList.add('active');

  // カード内に「抽選中…」オーバーレイを表示
  overlayText.textContent = '抽選中…';
  overlayText.className   = 'overlay-text is-pulsing'; // パルスアニメーション開始
  resultOverlay.className = 'result-overlay';           // hidden を外して表示

  // ---- Phase2：レアリティ色で「結果発表！」----

  setTimeout(() => {
    // テキストをレアリティ色に変えることで、
    // ユーザーに「何かが来る」予告を与える
    overlayText.textContent = '結果発表！';
    overlayText.className   = `overlay-text ${rarityClass}`; // パルス停止 + 色変化

    // オーバーレイ背景をレアリティ色にほんのり染める
    resultOverlay.className = `result-overlay ${rarityClass}`;

    // カードの点滅を止める（次フェーズで renderResult が色を設定する）
    resultArea.className = 'result-area';

  }, phase2Ms);

  // ---- Phase3：結果表示 ----

  setTimeout(() => {
    // オーバーレイを非表示にして結果を見せる
    resultOverlay.className = 'result-overlay hidden';
    overlayText.className   = 'overlay-text';

    // 画面を明転（CSS transition で黒から元の色に戻る）
    screenOverlay.classList.remove('active');

    // 結果を DOM に反映（renderResult は演出を知らなくてよい）
    renderResult(item, isPromotion);

    // 登場アニメーション（フェードイン）を付与する
    // renderResult() が className をリセットした後に追加するので確実に動く
    resultRarity.classList.add('anim-fade-in');
    resultName.classList.add('anim-fade-in');
    if (isPromotion) {
      resultPromotion.classList.add('anim-fade-in');
    }

    // ガチャ完了：ボタンを再有効化
    isGachaRunning = false;
    gachaBtn.disabled = false;

    console.log('[ガチャ完了] 演出終了・ボタン再有効化');

  }, totalMs);
}

/* ============================================================
   10. showError(message)
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
   11. playGacha() - ガチャ全体のフロー制御
   ============================================================

   Step3 との変更点：
   - renderResult() の直接呼び出し → playAnimation() に変更
   - isGachaRunning=false / button.disabled=false の解除は
     playAnimation() の Phase3 で行う（演出が終わるまで待つ）
*/

function playGacha() {

  // 多重実行防止
  if (isGachaRunning) return;

  // CONFIG 検証
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

  // 結果をコンソールに出力（開発確認用）
  console.log('[ガチャ結果確定]', {
    rarity,
    item: item.name,
    promotion: isPromotion ? '昇格演出あり🎊' : 'なし',
  });

  // ② 実行中フラグ ON・ボタン無効化
  isGachaRunning = true;
  gachaBtn.disabled = true;

  // ③ 演出開始（演出終了後に isGachaRunning=false・ボタン解除される）
  playAnimation(item, isPromotion);
}

/* ============================================================
   12. イベントリスナー
   ============================================================ */

gachaBtn.addEventListener('click', playGacha);
