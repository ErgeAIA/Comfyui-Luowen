import test from 'node:test';
import assert from 'node:assert/strict';
import { i18nKeyDiff } from '../../luowen/web/i18n.js';

test('i18n: zh/en 键集相等（缺 key 会在英文界面回退中文）', () => {
  assert.deepEqual(i18nKeyDiff(), { missingInEn: [], missingInZh: [] });
});
