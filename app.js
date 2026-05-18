/**
 * app.js - ランチガチャ アプリ本体
 * Step3: ボタン押下 → 抽選 → DOM 表示の最小フロー
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
 *  9. showError()        … エラーメッセージを画面に表示
 * 10. playGacha()        … ガチャ全体のフロー制御（メイン関数）
 * 11. イベントリスナー    … ボタン押下の検知
 */

'use strict'; // 厳格モード：バグを早期発見しやすくなる

/* ============================================================
   1. CONFIG - アプリ全体の設定値
   数値を変えるだけで確率・演出時間を調整できる
   ============================================================ */

const CONFIG = {

  // ---- 抽選確率（合計が必ず 100 になること） ----
  rarityWeights: {
    SSR: 3,   // 3%
    SR:  12,  // 12%
    R:   35,  // 35%
    N:   50,  // 50%
  },

  // SSR 当選時のうち、この % で昇格演出が発生する
  promotionRate: 30, // 30%

  // 演出時間（ミリ秒）。Step4 のアニメーション実装で使用する。
  normalAnimMs:    2500,
  promotionAnimMs: 4500,

  // ガチャ候補アイテム
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
   getElementById で要素を取得しておく。
   毎回 getElementById を呼ぶより、最初に変数に入れておく方が効率的。
   ============================================================ */

const gachaBtn          = document.getElementById('gacha-btn');
const resultArea        = document.getElementById('result-area');
const resultRarity      = document.getElementById('result-rarity');
const resultName        = document.getElementById('result-name');
const resultPromotion   = document.getElementById('result-promotion');
const resultPlaceholder = document.getElementById('result-placeholder');

/* ============================================================
   3. 状態変数
   ============================================================ */

/*
  isGachaRunning：ガチャ演出中かどうかを示すフラグ。
  true の間はボタンを押しても何もしない（多重実行防止）。
  Step4 でアニメーション中に true になり、終了後に false に戻る。
*/
let isGachaRunning = false;

/* ============================================================
   4. validateConfig() - CONFIG の妥当性チェック
   戻り値：正常=true / 異常=false
   ============================================================ */

function validateConfig() {
  const weights = CONFIG.rarityWeights;

  // (1) 各値の妥当性チェック（型・NaN・Infinity・負数）
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

  // (2) 合計値チェック
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
  if (total !== 100) {
    console.error(`[CONFIG ERROR] rarityWeights の合計が 100 ではありません: 実際の合計=${total}`);
    return false;
  }

  return true;
}

/* ============================================================
   5. pickRarity() - 重み付き抽選でレアリティを決定
   戻り値：'SSR' | 'SR' | 'R' | 'N'
   ============================================================ */

function pickRarity() {
  /*
    累積確率法：
    ランダム値が最初に累積値を下回ったレアリティを返す。
    例）rand=4.7：SSR累積3（通過）→ SR累積15（4.7<15）→ SR を返す
  */
  const rand = Math.random() * 100;
  let cumulative = 0;

  for (const [rarity, weight] of Object.entries(CONFIG.rarityWeights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return rarity;
    }
  }

  // 浮動小数点誤差のフォールバック（通常はここに来ない）
  const rarities = Object.keys(CONFIG.rarityWeights);
  return rarities[rarities.length - 1];
}

/* ============================================================
   6. pickItemByRarity(rarity) - レアリティ内からアイテムを均等抽選
   戻り値：{ name: string, rarity: string } または null
   ============================================================ */

function pickItemByRarity(rarity) {
  const candidates = CONFIG.items.filter(item => item.rarity === rarity);

  if (candidates.length === 0) {
    console.error(`[CONFIG ERROR] rarity="${rarity}" に対応するアイテムがありません`);
    return null;
  }

  // 均等抽選：0〜(候補数-1) の整数インデックスをランダムに選ぶ
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

/* ============================================================
   7. shouldPromote(rarity) - 昇格演出を発生させるか判定
   戻り値：true（昇格演出あり）/ false（なし）
   ============================================================ */

function shouldPromote(rarity) {
  if (rarity !== 'SSR') return false;
  return Math.random() * 100 < CONFIG.promotionRate;
}

/* ============================================================
   8. renderResult(item, isPromotion) - 結果を画面（DOM）に反映
   ============================================================

   やること：
   - プレースホルダーを隠す
   - レアリティバッジ・アイテム名を表示し、レアリティ色を付ける
   - 昇格演出ありの場合はテキストを表示する
   - カードの枠線色をレアリティに合わせる
*/

function renderResult(item, isPromotion) {
  const rarityClass = `rarity-${item.rarity.toLowerCase()}`; // 例：'rarity-ssr'

  // プレースホルダーを非表示にする
  resultPlaceholder.classList.add('hidden');

  // レアリティバッジを表示
  // className を直接書き換えることで、前回のレアリティクラスもリセットできる
  resultRarity.textContent = item.rarity;
  resultRarity.className   = `result-rarity ${rarityClass}`; // hidden は外れる

  // アイテム名を表示（レアリティと同じ色にする）
  resultName.textContent = item.name;
  resultName.className   = `result-name ${rarityClass}`;     // hidden は外れる

  // 昇格演出テキストの表示・非表示
  if (isPromotion) {
    resultPromotion.textContent = '🎊 昇格演出あり';
    resultPromotion.className   = `result-promotion rarity-ssr`; // hidden は外れる
  } else {
    resultPromotion.className = 'result-promotion hidden';
  }

  // カードの枠線色をレアリティに合わせる
  // result-area.rarity-ssr などの CSS が border-color を上書きする
  resultArea.className = `result-area ${rarityClass}`;
}

/* ============================================================
   9. showError(message) - 画面にエラーメッセージを表示
   CONFIG が不正なときなど、抽選を実行できない場合に呼ぶ
   ============================================================ */

function showError(message) {
  // プレースホルダーをエラーメッセージとして再利用する
  resultPlaceholder.textContent   = message;
  resultPlaceholder.style.color   = '#f87171'; // 赤色でエラーと分かるように
  resultPlaceholder.classList.remove('hidden');

  // 結果要素は隠しておく
  resultRarity.className    = 'result-rarity hidden';
  resultName.className      = 'result-name hidden';
  resultPromotion.className = 'result-promotion hidden';
}

/* ============================================================
   10. playGacha() - ガチャ全体のフロー制御（メイン関数）
   ============================================================

   【重要】抽選結果は演出開始前に確定させること（仕様書 5.1.3 より）
   → pickRarity・pickItemByRarity・shouldPromote を先に全部呼ぶ。
   → 演出と結果生成を混ぜると「演出途中で結果が変わる」バグが起きやすい。
*/

function playGacha() {

  // ---- 多重実行防止 ----
  // ガチャ演出中（isGachaRunning=true）は何もしない
  if (isGachaRunning) return;

  // ---- CONFIG バリデーション ----
  if (!validateConfig()) {
    showError('設定エラー：管理者にお問い合わせください');
    return;
  }

  // ---- ① 抽選結果を先に確定 ----
  // この3行で「今回のガチャ結果」がすべて決まる。
  // 以降の演出・表示はこの結果を使うだけで、抽選は行わない。
  const rarity      = pickRarity();
  const item        = pickItemByRarity(rarity);
  const isPromotion = shouldPromote(rarity);

  // CONFIG 設定ミスで item が取得できなかった場合は中止
  if (!item) {
    showError('抽選エラーが発生しました');
    return;
  }

  // 開発者確認用ログ（Step4 以降も残しておくと便利）
  console.log('[ガチャ結果確定]', {
    rarity,
    item: item.name,
    promotion: isPromotion ? '昇格演出あり🎊' : 'なし',
  });

  // ---- ② 実行中フラグ ON・ボタン無効化 ----
  isGachaRunning = true;
  gachaBtn.disabled = true;

  // ---- ③ 結果を画面に反映 ----
  // Step3 では演出なしで即時表示する。
  // Step4 でここに「アニメーション → 一定時間後に renderResult」の処理を追加する。
  renderResult(item, isPromotion);

  // ---- ④ 実行中フラグ OFF・ボタン有効化 ----
  // Step3 では即時。Step4 でアニメーション終了後に呼ぶ形に変える。
  isGachaRunning = false;
  gachaBtn.disabled = false;
}

/* ============================================================
   11. イベントリスナー - ボタン押下を検知して playGacha を呼ぶ
   ============================================================ */

// 'click' イベントはマウスクリックにもスマホのタップにも反応する
gachaBtn.addEventListener('click', playGacha);
