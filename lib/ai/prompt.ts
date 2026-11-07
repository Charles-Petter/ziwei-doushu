/**
 * lib/ai/prompt —— 把命盘对象序列化成给模型看的文本 + 系统提示词
 *
 * 只做"数据 → 文字"的忠实转写，不含论断结论。
 * 论断由模型基于这些结构化事实自行推演。
 */

import type { ZiweiChart } from '@/lib/ziwei/types';

const BRANCH = ['子', '丑', '寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥'];
const STEM = ['甲', '乙', '丙', '丁', '戊', '己', '庚', '辛', '壬', '癸'];

const branchName = (i?: number) => (typeof i === 'number' ? BRANCH[((i % 12) + 12) % 12] : '—');

/** 把一张命盘转成结构化中文描述 */
export function chartToText(chart: ZiweiChart): string {
  const { birthInfo, lunarInfo, palaces } = chart;
  const lines: string[] = [];

  const lunarMonth = `${lunarInfo.isLeapMonth ? '闰' : ''}${Math.abs(lunarInfo.lunarMonth)}月`;
  const gender = birthInfo.gender === 'male' ? '男' : '女';
  const hourLabel = `${BRANCH[birthInfo.hour % 12]}时`;

  lines.push('【基本信息】');
  lines.push(`公历：${birthInfo.year}年${birthInfo.month}月${birthInfo.day}日 ${hourLabel}（时辰序号 ${birthInfo.hour}）`);
  if (birthInfo.origInput) {
    const o = birthInfo.origInput;
    lines.push(`原始输入：${o.year}/${o.month}/${o.day} ${String(o.clockHour).padStart(2, '0')}:${String(o.clockMinute).padStart(2, '0')}（已按子时换日规则归一）`);
  }
  if (birthInfo.city || birthInfo.province) {
    lines.push(`出生地：${[birthInfo.province, birthInfo.city].filter(Boolean).join(' ')}`);
  }
  lines.push(`性别：${gender}`);
  lines.push(
    `农历：${lunarInfo.lunarYear}年 ${lunarMonth}${lunarInfo.lunarDay}日（${STEM[lunarInfo.yearStem]}${BRANCH[lunarInfo.yearBranch]}年）`,
  );
  if (lunarInfo.fourPillars) lines.push(`节气四柱：${lunarInfo.fourPillars.join(' ')}`);
  if (lunarInfo.fourPillarsLunar) lines.push(`农历四柱：${lunarInfo.fourPillarsLunar.join(' ')}`);

  lines.push(`五行局：${chart.wuxingJuName}`);
  lines.push(`命宫：${branchName(chart.mingGongBranch)}宫　身宫：${branchName(chart.shenGongBranch)}宫`);
  if (chart.mingZhu || chart.shenZhu) {
    lines.push(`命主：${chart.mingZhu ?? '—'}　身主：${chart.shenZhu ?? '—'}`);
  }
  if (chart.yinYangGender) lines.push(`阴阳性别：${chart.yinYangGender}`);
  lines.push(`当前年龄：${chart.currentAge} 岁`);
  lines.push('');

  lines.push('【十二宫】（按地支子→亥排列）');
  for (const p of [...palaces].sort((a, b) => a.branch - b.branch)) {
    const tags: string[] = [];
    if (p.isMingGong) tags.push('命宫');
    if (p.isShenGong) tags.push('身宫');
    if (p.isCurrentDaXian) tags.push('★当前大限');

    const head = `${branchName(p.branch)}宫 · ${p.name}${tags.length ? `（${tags.join('、')}）` : ''}`;
    const age = p.daXianAge ? `　大限 ${p.daXianAge[0]}-${p.daXianAge[1]} 岁` : '';
    lines.push(`${head}${age}`);

    const majors = p.stars.filter(s => s.type === 'major');
    const others = p.stars.filter(s => s.type !== 'major');

    const fmt = (s: typeof p.stars[number]) =>
      `${s.name}${s.brightnessRaw ? `(${s.brightnessRaw})` : ''}${s.siHua ? `[化${s.siHua}]` : ''}`;

    if (majors.length) {
      lines.push(`  主星：${majors.map(fmt).join('　')}`);
    } else {
      const borrowed = p.borrowedFromName
        ? `借对宫${p.borrowedFromName}${p.borrowedStars?.length ? `（${p.borrowedStars.join('、')}）` : ''}`
        : '无主星';
      lines.push(`  主星：空宫，${borrowed}`);
    }
    if (others.length) lines.push(`  辅星：${others.map(fmt).join('　')}`);
    if (p.selfSihua?.length) {
      const stemLabel = typeof p.stem === 'number' ? `${STEM[p.stem]}干` : '宫干';
      lines.push(`  自化：${stemLabel} → ${p.selfSihua.map(s => `${s.starName}自化${s.siHua}`).join('、')}`);
    }
    lines.push('');
  }

  if (chart.daXians?.length) {
    lines.push('【大限序列】');
    chart.daXians.forEach((d, i) => {
      const mark = i === chart.currentDaXianIndex ? ' ★当前' : '';
      const sihua = d.siHua
        ? `　四化：禄${d.siHua.lu} 权${d.siHua.quan} 科${d.siHua.ke} 忌${d.siHua.ji}`
        : '';
      lines.push(
        `${d.startAge}-${d.endAge} 岁：${d.palaceName}（${branchName(d.palaceBranch)}宫）`
        + `${d.stemName ? `${d.stemName}干` : ''}${sihua}${mark}`,
      );
    });
  }

  return lines.join('\n');
}

/** /api/interpret 的系统提示词 */
export function buildInterpretSystem(chart: ZiweiChart): string {
  return `你是精通倪海厦《天纪》体系紫微斗数的命理师，同时熟悉《紫微斗数全集》《紫微斗数全书》《骨髓赋》等古籍。

【工作要求】
1. 只依据下面这张命盘的事实推演，不要臆造命盘里没有的星曜、宫位或四化。
2. 论述要落到具体宫位与星曜上，说明"为什么"，避免只给结论。
3. 涉及格局时，先点出构成条件，再谈吉凶。
4. 语言简洁、条理清楚，用短段落或小标题；不使用表格，不用 Markdown 的加粗星号堆砌。
5. 命理专名保持中文原样（如"化忌""三方四正""自化"）。
6. 结尾务必提醒：命理仅供参考，重大决定请结合现实判断。

【命盘数据】
${chartToText(chart)}`;
}

/** /api/heming 的系统提示词 */
export function buildHemingSystem(chartA: ZiweiChart, chartB: ZiweiChart): string {
  return `你是精通倪海厦《天纪》体系紫微斗数的命理师，现在为用户做双人合盘分析。

【工作要求】
1. 先分别看出两人的命宫、夫妻宫、福德宫与四化走向，再谈两人之间的互动。
2. 重点分析：夫妻宫互看、命宫对命宫的呼应、双方四化是否互相引动、大限节奏是否同步。
3. 只依据命盘事实推演，不臆造星曜。
4. 指出契合之处，也如实说明需要磨合之处，不给空泛的吉利话。
5. 用短段落组织，不使用表格。
6. 结尾提醒：合盘仅供参考，关系经营取决于现实中的沟通与选择。

【甲方命盘】
${chartToText(chartA)}

【乙方命盘】
${chartToText(chartB)}`;
}
