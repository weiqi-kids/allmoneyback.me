// engine/select/commission-seed.test.ts
//
// C4：委託案作為選題「候選種子」。重點：
//   - buildUserPrompt 在帶 commission 時把 methodDesc / hints 嵌進 prompt；
//     不帶 commission 時 prompt 不含種子段落（既有行為不變）。
//   - selectTopic 帶 commission 仍走相同硬閘門：A 類委託被拒（非自動發文）。

import { describe, it, expect } from 'vitest';
import { buildUserPrompt, selectTopic, stubSelection } from './index.js';
import type { ReaderCommission } from '../commissions/index.js';
import type { Selection } from '../schemas.js';

const COMMISSION: ReaderCommission = {
  id: 'c1',
  methodDesc: '靠在邊境兩側做小額代購維生',
  regionHint: '東南亞陸地邊境',
  sourceHint: '紀錄片',
};

describe('buildUserPrompt（委託種子）', () => {
  it('帶 commission → prompt 含 methodDesc 與 hints、且點明「候選」', () => {
    const p = buildUserPrompt({ commission: COMMISSION });
    expect(p).toContain(COMMISSION.methodDesc);
    expect(p).toContain('東南亞陸地邊境');
    expect(p).toContain('紀錄片');
    expect(p).toContain('讀者委託');
    expect(p).toContain('候選');
  });

  it('不帶 commission → prompt 不含種子段落（既有行為不變）', () => {
    const p = buildUserPrompt();
    expect(p).not.toContain('讀者委託');
  });
});

describe('selectTopic（委託案仍過硬閘門，非自動發文）', () => {
  it('帶 commission 的 B 類替身 → accepted（仍是候選經閘門）', async () => {
    const result = await selectTopic({ dedupe: false, commission: COMMISSION });
    expect(result.accepted).toBe(true);
    expect(result.selection.factCategory).toBe('B');
  });

  it('委託案展開成 A 類 → 仍被閘門拒（不自動信任）', async () => {
    const aStub = (): Selection => ({ ...stubSelection(), factCategory: 'A' });
    const result = await selectTopic({
      dedupe: false,
      commission: COMMISSION,
      stub: aStub,
    });
    expect(result.accepted).toBe(false);
    expect(result.rejectReason).toContain('A');
  });
});
