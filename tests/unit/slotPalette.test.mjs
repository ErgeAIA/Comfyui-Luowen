import test from 'node:test';
import assert from 'node:assert/strict';
import { themeSlotColors, applySlotPalette, clearSlotPalette } from '../../luowen/web/colors/slotPalette.js';

test('slotPalette: 五主题 62 类颜色表齐全且为 #RRGGBB', () => {
  for (const id of ['luowen-cyberpunk', 'luowen-nightlight', 'luowen-dawn', 'luowen-jellyfish', 'luowen-solarized']) {
    const map = themeSlotColors(id);
    assert.ok(map, `${id} 存在`);
    assert.equal(Object.keys(map).length, 62, `${id} 62 类`);
    for (const [type, hex] of Object.entries(map)) assert.ok(/^#[0-9A-F]{6}$/.test(hex), `${id}.${type}=${hex}`);
  }
  assert.equal(themeSlotColors('nope'), null);
});

test('slotPalette: 应用写入宿主 byType，关闭后原样还原（含删除新增键）', () => {
  const app = { canvas: { default_connection_color_byType: { IMAGE: '#111111' }, setDirty() {} } };
  const colors = themeSlotColors('luowen-cyberpunk');
  applySlotPalette(app, 'luowen-cyberpunk');
  assert.equal(app.canvas.default_connection_color_byType.IMAGE, colors.IMAGE);
  assert.equal(app.canvas.default_connection_color_byType.VIDEO, colors.VIDEO);
  clearSlotPalette(app);
  assert.equal(app.canvas.default_connection_color_byType.IMAGE, '#111111', '原有键还原');
  assert.equal(Object.prototype.hasOwnProperty.call(app.canvas.default_connection_color_byType, 'VIDEO'), false, '新增键删除');
});

test('slotPalette: 主题切换后关闭仍还原到最初宿主值', () => {
  const app = { canvas: { default_connection_color_byType: { IMAGE: '#222222' }, setDirty() {} } };
  applySlotPalette(app, 'luowen-nightlight');
  const cyber = themeSlotColors('luowen-cyberpunk');
  applySlotPalette(app, 'luowen-cyberpunk');
  assert.equal(app.canvas.default_connection_color_byType.IMAGE, cyber.IMAGE);
  clearSlotPalette(app);
  assert.equal(app.canvas.default_connection_color_byType.IMAGE, '#222222');
});
