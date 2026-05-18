/**
 * app.js - ランチガチャ アプリ本体
 * Step2: CONFIG・抽選ロジック・バリデーション
 *
 * 【このファイルの構成】
 *  1. CONFIG    … アプリの全設定値を一元管理するオブジェクト
 *  2. validateConfig()      … CONFIGの妥当性を検証する
 *  3. pickRarity()          … 重み付き抽選でレアリティを決める
 *  4. pickItemByRarity()    … レアリティ内からアイテムをランダム選択
 *  5. shouldPromote()       … 昇格演出を発生させるか判定
 *  6. 動作確認コード         … ページ読み込み時にコンソールで確認（Step3で削除）
 */

'use strict'; // バグを早期発見するための厳格モード

/* ============================================================
   1. CONFIG - アプリ全体の設定値
   ※ この中の数値を変えるだけで確率・演出時間などが調整できる
   ============================================================ */

const CONFIG = {

  // ---- 抽選確率（レアリティの重み） ----
  // 合計が必ず 100 になるようにすること（validateConfig でチェックする）
  rarityWeights: {
    SSR: 3,   // 3%
    SR:  12,  // 12%
    R:   35,  // 35%
    N:   50,  // 50%
  },

  // ---- 昇格演出の発生率 ----
  // SSR 当選時のうち、この % の確率で「昇格演出」が発生する
  promotionRate: 30, // 30%

  // ---- 演出時間（ミリ秒） ----
  // Step4（ガチャ演出）で使用する。1000ms = 1秒。
  normalAnimMs:    2500, // 通常演出の長さ
  promotionAnimMs: 4500, // 昇格演出の長さ

  // ---- ガチャ候補アイテム ----
  // name: 表示名、rarity: 上の rarityWeights のキーと一致させること
  items: [
    { name: '焼肉',     rarity: 'SSR' },
    { name: '寿司',     rarity: 'SR'  },
    { name: 'ラーメン', rarity: 'R'   },
    { name: 'カレー',   rarity: 'R'   },
    { name: 'コンビニ', rarity: 'N'   },
  ],
};

/* ============================================================
   2. validateConfig() - CONFIG の妥当性チェック
   ============================================================

   なぜ必要か：
   CONFIG の数値を誰かが誤って書き換えたとき（例：SSR: -1 や合計=99）、
   抽選ロジックが壊れる。それを事前に検出してエラーを出すための関数。

   戻り値：
   - true  … CONFIG は正常、抽選を続行してよい
   - false … CONFIG に問題あり、抽選を中止すること
*/

function validateConfig() {
  const weights = CONFIG.rarityWeights;

  // ---- (1) 各値の妥当性チェック ----
  // 一つでも不正な値があれば即 false を返す（早期 return）
  for (const [rarity, weight] of Object.entries(weights)) {

    // typeof チェック：文字列など数値以外が入っていないか
    if (typeof weight !== 'number') {
      console.error(
        `[CONFIG ERROR] rarityWeights に数値以外の値があります: ${rarity}="${weight}"`
      );
      return false;
    }

    // NaN チェック：Number.isNaN() は NaN のときだけ true になる
    // （typeof NaN === 'number' なので上のチェックでは通ってしまう）
    if (Number.isNaN(weight)) {
      console.error(
        `[CONFIG ERROR] rarityWeights に NaN があります: ${rarity}=NaN`
      );
      return false;
    }

    // Infinity チェック：Number.isFinite() は有限数のとき true になる
    if (!Number.isFinite(weight)) {
      console.error(
        `[CONFIG ERROR] rarityWeights に Infinity があります: ${rarity}=${weight}`
      );
      return false;
    }

    // 負数チェック：0 は「そのレアリティを排除」として許容する
    if (weight < 0) {
      console.error(
        `[CONFIG ERROR] rarityWeights に負の値があります: ${rarity}=${weight}`
      );
      return false;
    }
  }

  // ---- (2) 合計値チェック ----
  // reduce で全ての重みを足し合わせる
  const total = Object.values(weights).reduce((sum, w) => sum + w, 0);

  if (total !== 100) {
    console.error(
      `[CONFIG ERROR] rarityWeights の合計が 100 ではありません: 実際の合計=${total}`
    );
    return false;
  }

  // 全チェック通過
  return true;
}

/* ============================================================
   3. pickRarity() - 重み付き抽選でレアリティを決める
   ============================================================

   アルゴリズム（累積確率法）：
   ① 0以上100未満のランダム値を生成（例: 4.7）
   ② 重みを先頭から順番に足していく（累積値）
   ③ ランダム値が累積値を下回った時点のレアリティを返す

   例：SSR=3, SR=12, R=35, N=50 のとき
     rand=4.7 →  SSR:3 (累積3, 4.7≥3)
              →  SR:12 (累積15, 4.7<15) → SR を返す ✓

   戻り値：'SSR' | 'SR' | 'R' | 'N'
*/

function pickRarity() {
  // 0以上100未満のランダム値
  const rand = Math.random() * 100;

  let cumulative = 0; // 累積値（最初は0）

  // Object.entries はオブジェクトのキーを挿入順で返す
  // → CONFIG で SSR→SR→R→N の順に書いてあれば、その順で判定される
  for (const [rarity, weight] of Object.entries(CONFIG.rarityWeights)) {
    cumulative += weight;
    if (rand < cumulative) {
      return rarity;
    }
  }

  /*
    浮動小数点の誤差（例：合計が 99.9999... になるケース）で
    ループを抜けてしまう場合のフォールバック。
    validateConfig で合計=100 を保証しているので通常はここに来ない。
  */
  const rarities = Object.keys(CONFIG.rarityWeights);
  return rarities[rarities.length - 1];
}

/* ============================================================
   4. pickItemByRarity(rarity) - 同レアリティ内からアイテムをランダム選択
   ============================================================

   なぜ別関数か：
   レアリティ決定（pickRarity）とアイテム決定を分離することで、
   「同レアリティ内は均等抽選」というルールをここだけに閉じ込められる。

   引数：rarity - 'SSR' | 'SR' | 'R' | 'N'
   戻り値：{ name: string, rarity: string }
*/

function pickItemByRarity(rarity) {
  // 指定されたレアリティのアイテムだけを絞り込む
  const candidates = CONFIG.items.filter(item => item.rarity === rarity);

  /*
    候補が0件になるのは CONFIG の設定ミス（重みはあるのにアイテムが無い）。
    起きてほしくないが、万が一のためにフォールバックを用意する。
  */
  if (candidates.length === 0) {
    console.error(`[CONFIG ERROR] rarity="${rarity}" に対応するアイテムがありません`);
    return null;
  }

  // 均等抽選：Math.floor で 0〜(候補数-1) の整数インデックスを得る
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

/* ============================================================
   5. shouldPromote(rarity) - 昇格演出を発生させるか判定
   ============================================================

   昇格演出（Step5で実装）：
   SSR 当選時にさらに確率で「最初は R っぽく見せてから SSR に昇格する」演出。

   引数：rarity - 抽選で確定したレアリティ
   戻り値：true（昇格演出あり）/ false（昇格演出なし）
*/

function shouldPromote(rarity) {
  // SSR 以外では昇格演出は発生しない
  if (rarity !== 'SSR') {
    return false;
  }

  // SSR 当選時のみ、CONFIG.promotionRate % の確率で昇格演出を発生させる
  return Math.random() * 100 < CONFIG.promotionRate;
}

/* ============================================================
   6. 動作確認コード（Step2のみ）
   ============================================================

   ブラウザの開発者ツール（コンソール）で抽選結果を確認するためのコード。
   Step3 でボタン連携が完成したら、この IIFE（即時実行関数）ブロックを削除する。
*/

(function step2Test() {
  console.log('========================================');
  console.log('  ランチガチャ Step2 動作確認');
  console.log('========================================');

  // まず CONFIG を検証する
  const isValid = validateConfig();
  if (!isValid) {
    console.warn('⛔ CONFIG が不正なため抽選テストを中止します');
    return;
  }
  console.log('✅ CONFIG バリデーション: OK（重み合計=100）');
  console.log('--- 抽選テスト（10回）---');

  // 10回抽選して結果を出力
  for (let i = 1; i <= 10; i++) {
    const rarity    = pickRarity();
    const item      = pickItemByRarity(rarity);
    const promotion = shouldPromote(rarity);

    // アイテムが取得できなかった場合（CONFIG設定ミス）はスキップ
    if (!item) continue;

    console.log(
      `[${String(i).padStart(2, '0')}回目]`,
      `rarity: ${rarity.padEnd(3)}`,
      `| item: ${item.name}`,
      promotion ? '| 🎊 昇格演出あり' : ''
    );
  }

  console.log('--- テスト完了 ---');
  console.log('※ Step3 完了後、このテストコードは削除します');
})();
