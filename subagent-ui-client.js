import { createSubagentArchiveStore, partitionSubagentEntries, resolveSubagentModelInfo } from './subagent-ui.js';

const HE_SUBAGENT_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/';
const HE_SUBAGENT_NS = 'harnessEnhanced.subagentUi';
const HE_SUBAGENT_STYLE_ID = '@local/dsh-harness-enhanced/subagent-ui.css';
const HE_SUBAGENT_REFRESH_CONCURRENCY = 6;

const HE_SUBAGENT_CSS = `
.he-subagent-root{align-items:center;gap:10px;min-width:0;display:inline-flex;position:relative}
.he-subagent-switcherRoot{min-width:0;margin-left:6px}
.he-subagent-trigger,.he-subagent-switcherTrigger{border-radius:var(--dsw-radius-sm);min-height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;align-items:center;padding:3px 2px;font-size:12px;line-height:18px;display:inline-flex}
.he-subagent-trigger{gap:4px}
.he-subagent-switcherTrigger{min-width:0;max-width:244px;color:var(--dsw-alias-label-primary);gap:4px;font-size:14px;font-weight:500;line-height:20px}
.he-subagent-ancestorSwitcherTrigger{color:var(--dsw-alias-label-tertiary);font-weight:400}
.he-subagent-switcherTitle{text-overflow:ellipsis;white-space:nowrap;flex:1;min-width:0;overflow:hidden}
.he-subagent-switcherTrigger svg{flex:none;transition:transform .12s}
.he-subagent-activitySlot{flex:none;justify-content:center;align-items:center;width:14px;height:14px;display:inline-flex}
.he-subagent-trigger:focus-visible,.he-subagent-switcherTrigger:focus-visible{color:var(--dsw-alias-label-primary)}
@media (hover:hover){.he-subagent-trigger:hover,.he-subagent-switcherTrigger:hover{color:var(--dsw-alias-label-primary)}}
.he-subagent-ancestorSwitcherTrigger:focus-visible{color:var(--dsw-alias-label-tertiary)}
@media (hover:hover){.he-subagent-ancestorSwitcherTrigger:hover{color:var(--dsw-alias-label-tertiary)}}
.he-subagent-trigger .he-subagent-compactIcon{display:none}
@container (width<=460px){
  .he-subagent-trigger .he-subagent-compactIcon{display:block}
  .he-subagent-trigger .he-subagent-textModeActivity,.he-subagent-trigger .he-subagent-count{display:none}
  .he-subagent-trigger{box-sizing:border-box;width:28px;height:28px;color:var(--dsw-alias-label-secondary);justify-content:center;padding:0}
  .he-subagent-trigger .he-subagent-activitySlot,.he-subagent-trigger .he-subagent-activitySlot>svg{width:15px;height:15px}
  .he-subagent-trigger:focus-visible{color:var(--dsw-alias-label-secondary)}
  .he-subagent-trigger:active{background:var(--dsw-alias-interactive-bg-active)}
  @media (hover:hover){.he-subagent-trigger:hover{color:var(--dsw-alias-label-secondary);background:var(--dsw-alias-interactive-bg-hover)}}
}
.he-subagent-menu{z-index:100;box-sizing:border-box;--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);--dsw-elevation-stroke-color:var(--dsw-alias-border-l1);max-width:calc(100vw - 32px);max-height:min(560px,100dvh - 140px);box-shadow:var(--dsw-elevation-prominent);--dsh-subagent-menu-width:min(410px, calc(100vw - 32px));position-area:none;top:calc(anchor(bottom) + 5px);left:clamp(16px, anchor(left), calc(100vw - var(--dsh-subagent-menu-width) - 16px));width:var(--dsh-subagent-menu-width);position-try-fallbacks:--dsh-subagents-above, --dsh-subagents-window;flex-direction:column;height:fit-content;min-height:0;margin:0;padding:6px;display:flex;position:fixed;overflow:hidden}
.he-subagent-menuBody{scrollbar-gutter:stable;--dsh-scrollbar-track-margin:6px;flex-direction:column;flex:auto;min-height:0;display:flex;overflow:auto}
@supports selector(::-webkit-scrollbar){.he-subagent-menuBody{margin-right:calc(-1 * var(--dsh-scrollbar-width))}}
.he-subagent-sectionHeader{align-items:center;gap:7px;padding:4px 7px 6px;display:flex}
.he-subagent-sectionIcon{width:14px;height:20px;color:var(--dsw-alias-label-tertiary);flex:none;place-items:center;display:grid}
.he-subagent-sectionTitle{color:var(--dsw-alias-label-primary);flex:none;margin:0;font-size:13px;font-weight:500;line-height:20px}
.he-subagent-sectionProgress{min-width:0;color:var(--dsw-alias-label-tertiary);overflow-wrap:anywhere;flex:auto;margin-inline-start:2px;font-size:12px;line-height:18px}
.he-subagent-headerAction{flex:none;border:0;background:transparent;color:var(--dsw-alias-label-tertiary);cursor:pointer;border-radius:var(--dsw-radius-sm);padding:2px 6px;font-size:11px;line-height:18px;white-space:nowrap}
.he-subagent-headerAction:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
@media (hover:hover){.he-subagent-headerAction:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}
.he-subagent-sectionEmpty{color:var(--dsw-alias-label-tertiary);margin:0;padding:4px 7px 8px 28px;font-size:12px}
.he-subagent-node{min-width:0;position:relative}
.he-subagent-menuBody>[role=tree]>.he-subagent-node{margin-left:-2px}
.he-subagent-row{box-sizing:border-box;border-radius:var(--dsw-radius-md);width:100%;min-height:40px;color:var(--dsw-alias-label-primary);text-align:left;cursor:pointer;background:0 0;border:0;outline:none;align-items:flex-start;gap:7px;padding:4px 6px 4px 9px;font-size:12px;line-height:17px;display:flex;position:relative}
.he-subagent-row:focus-visible>.he-subagent-clickarea{background:var(--dsw-alias-interactive-bg-hover)}
@media (hover:hover){.he-subagent-clickarea:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.he-subagent-clickarea{box-sizing:border-box;border-radius:var(--dsw-radius-md);flex:1;align-self:stretch;align-items:flex-start;gap:7px;min-width:0;margin:-4px -6px;padding:4px 6px;display:flex}
.he-subagent-rowActivitySlot{flex:none;justify-content:center;align-items:center;width:14px;height:17px;display:inline-flex}
.he-subagent-disclosure,.he-subagent-disclosureSpace{flex:none;width:14px;height:17px}
.he-subagent-disclosure{color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;padding:0;display:inline-flex;position:static}
.he-subagent-disclosure:after{content:"";z-index:1;width:28px;position:absolute;top:0;bottom:0;left:0}
.he-subagent-disclosure svg{width:12px;height:12px;transition:transform .12s}
@media (hover:hover){.he-subagent-disclosure:hover{color:var(--dsw-alias-label-primary)}}
.he-subagent-disclosureOpen svg{transform:rotate(90deg)}
.he-subagent-content{flex-direction:column;flex:1;min-width:0;display:flex;gap:1px}
.he-subagent-label,.he-subagent-secondaryLine{white-space:normal;overflow-wrap:anywhere}
.he-subagent-label{color:inherit;font-size:13px;font-weight:400}
.he-subagent-currentLabel{font-weight:500}
.he-subagent-secondaryLine{color:var(--dsw-alias-label-tertiary);font-size:11.5px;line-height:16px;display:flex;flex-wrap:wrap;align-items:center;gap:0 4px}
.he-subagent-modelMeta{color:var(--dsw-alias-label-secondary)}
.he-subagent-metrics{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;text-align:right;white-space:nowrap;flex:none;grid-template-rows:17px 15px;font-size:10px;line-height:15px;display:grid}
.he-subagent-metricToken{grid-row:1;line-height:17px}
.he-subagent-metricDuration{grid-row:2}
.he-subagent-rowActions{display:inline-flex;align-items:center;gap:2px;flex:none;margin:4px 0}
.he-subagent-iconBtn,.he-subagent-sidebarSpace{box-sizing:border-box;flex:none;width:26px;height:26px}
.he-subagent-currentCheck{color:var(--dsw-alias-label-primary);place-items:center;display:grid}
.he-subagent-iconBtn{border-radius:var(--dsw-radius-sm);color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;justify-content:center;align-items:center;padding:5px;display:inline-flex}
.he-subagent-archiveBtn{opacity:0;transition:opacity .12s}
.he-subagent-row:hover .he-subagent-archiveBtn,.he-subagent-row:focus-within .he-subagent-archiveBtn,.he-subagent-archiveBtn:focus-visible{opacity:1}
@media (hover:none){.he-subagent-archiveBtn{opacity:1}}
.he-subagent-iconBtn:focus-visible{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}
@media (hover:hover){.he-subagent-iconBtn:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}}
.he-subagent-children{--branch-anchor-y:12.5px;margin-left:16px;padding-left:3px;position:relative}
.he-subagent-children:before,.he-subagent-children>.he-subagent-node:before{content:"";border-left:.5px solid var(--dsw-alias-border-l3);position:absolute;left:0}
.he-subagent-children:before{height:23px;top:-23px}
.he-subagent-children>.he-subagent-node:before{top:0;bottom:0;left:-3px}
.he-subagent-children>.he-subagent-node:last-child:before{height:var(--branch-anchor-y);bottom:auto}
.he-subagent-children>.he-subagent-node>.he-subagent-row:before{content:"";top:calc(var(--branch-anchor-y) - .25px);border-top:.5px solid var(--dsw-alias-border-l3);width:12px;position:absolute;left:-3px}
.he-subagent-children>.he-subagent-node>.he-subagent-row:has(>.he-subagent-disclosureSpace):before{width:33px}
.he-subagent-historyWrap{margin-top:4px;padding-top:4px;border-top:1px solid var(--dsw-alias-border-l2)}
.he-subagent-historyToggle{box-sizing:border-box;width:100%;display:flex;align-items:center;gap:6px;padding:5px 8px;border:0;border-radius:var(--dsw-radius-sm);background:transparent;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:18px;cursor:pointer;text-align:left}
.he-subagent-historyToggle svg{width:12px;height:12px;flex:none;transition:transform .12s}
.he-subagent-historyToggleOpen svg{transform:rotate(90deg)}
.he-subagent-historyToggle:focus-visible{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}
@media (hover:hover){.he-subagent-historyToggle:hover{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-interactive-bg-hover)}}
.he-subagent-historyBody{opacity:.9;padding-top:2px}
.he-subagent-notice,.he-subagent-error{color:var(--dsw-alias-label-tertiary);padding:8px 10px;font-size:11px;line-height:16px}
.he-subagent-error{color:var(--dsw-alias-state-error-primary);justify-content:space-between;align-items:center;gap:10px;display:flex}
.he-subagent-refresh{border-radius:var(--dsw-radius-sm);color:inherit;cursor:pointer;background:0 0;border:0;flex:none;align-items:center;gap:3px;padding:3px 5px;display:inline-flex}
.he-subagent-refresh svg{width:12px;height:12px}
@media (hover:hover){.he-subagent-refresh:hover{background:var(--dsw-alias-interactive-bg-hover)}}
.he-subagent-modelBadge{display:inline-flex;align-items:center;gap:5px;max-width:240px;height:24px;padding:0 8px;border-radius:var(--dsw-radius-sm,6px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-fill-quaternary,transparent);color:var(--dsw-alias-label-secondary);font-size:12px;line-height:18px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;user-select:text}
.he-subagent-modelBadgeText{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.he-subagent-modelBadge svg{flex:none;color:var(--dsw-alias-label-tertiary)}
.he-subagent-readonlyFrame{display:flex;flex-direction:column;gap:4px;padding:12px 16px;border-radius:var(--dsw-radius-lg,12px);border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-secondary,var(--dsw-alias-fill-quaternary));color:var(--dsw-alias-label-secondary);font-size:13px;line-height:1.45}
.he-subagent-readonlyHead{display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap}
.he-subagent-readonlyHead strong{color:var(--dsw-alias-label-primary);font-weight:500}
@position-try --dsh-subagents-above{top:auto;bottom:calc(anchor(top) + 5px)}
@position-try --dsh-subagents-window{top:max(16px, var(--dsh-frame-overlay-top,16px));bottom:16px;align-self:safe start;justify-self:safe start}
`;

const HE_SUBAGENT_LOCALE = {
  zh: {
    'section.title': '子智能体',
    'section.empty': '暂无子智能体',
    'section.activeEmpty': '所有子智能体已收纳到下方历史区',
    'progress.completed': '{count} 已完成',
    'progress.active': '{count} 进行中',
    'progress.inactive': '{count} 未运行',
    'progress.external': '{count} 外部任务',
    'duration.seconds': '{seconds}秒',
    'duration.minutes': '{minutes}分{seconds}秒',
    'duration.hours': '{hours}小时{minutes}分{seconds}秒',
    'duration.days': '{days}天',
    'duration.daysHours': '{days}天{hours}小时',
    'duration.months': '约{months}个月',
    'duration.monthsDays': '约{months}个月{days}天',
    'duration.years': '约{years}年',
    'duration.yearsMonths': '约{years}年{months}个月',
    'duration.exactDays': '{days}天{hours}小时{minutes}分{seconds}秒',
    'duration.exactTitle': '总活跃耗时：{duration}',
    'tokens.thousand': '{value}K',
    'tokens.million': '{value}M',
    'tokens.total': '{value} tok',
    'loading.label': '正在加载子智能体…',
    'load.idle': '尚未加载子智能体',
    'load.error': '无法加载子智能体',
    'retry': '重试',
    'mode.external': '外部任务',
    'mode.oneShot': '一次性',
    'mode.continuable': '可继续',
    'mode.unknown': '模式未知',
    'activity.running': '正在运行',
    'activity.completed': '已完成',
    'activity.inactive': '当前未运行',
    'branch.collapse': '收起 {label} 的下级子智能体',
    'branch.expand': '展开 {label} 的下级子智能体',
    'count.total.one': '{count} 个子智能体',
    'count.total.other': '{count} 个子智能体',
    'count.running.one': '{count} 个子智能体，正在运行',
    'count.running.other': '{count} 个子智能体，正在运行',
    'switcher.aria': '切换子智能体：{title}',
    'tree.aria': '子智能体会话',
    'open.sidebar': '在侧边栏打开',
    'open.sidebar.aria': '在侧边栏打开 {label}',
    'archive.allCompleted': '收纳已完成',
    'archive.one': '收纳到历史',
    'archive.restore': '移出历史',
    'history.title': '历史子智能体 ({count})',
    'model.tooltip': '子智能体模型：{model}（只读）',
    'readonly.oneShot.title': '一次性子智能体记录',
    'readonly.title': '此子智能体暂时只读',
    'readonly.oneShot.body': '一次性任务不支持后续消息，可在这里查看完整执行记录。',
    'readonly.unknown.body': '读取子会话后才能确定是否可继续。',
  },
  en: {
    'section.title': 'Subagents',
    'section.empty': 'No subagents',
    'section.activeEmpty': 'All subagents are folded into history below',
    'progress.completed': '{count} completed',
    'progress.active': '{count} in progress',
    'progress.inactive': '{count} not running',
    'progress.external': '{count} external',
    'duration.seconds': '{seconds}s',
    'duration.minutes': '{minutes}m {seconds}s',
    'duration.hours': '{hours}h {minutes}m {seconds}s',
    'duration.days': '{days}d',
    'duration.daysHours': '{days}d {hours}h',
    'duration.months': '~{months}mo',
    'duration.monthsDays': '~{months}mo {days}d',
    'duration.years': '~{years}y',
    'duration.yearsMonths': '~{years}y {months}mo',
    'duration.exactDays': '{days}d {hours}h {minutes}m {seconds}s',
    'duration.exactTitle': 'Total active duration: {duration}',
    'tokens.thousand': '{value}K',
    'tokens.million': '{value}M',
    'tokens.total': '{value} tok',
    'loading.label': 'Loading subagents…',
    'load.idle': 'Subagents not loaded',
    'load.error': 'Unable to load subagents',
    'retry': 'Retry',
    'mode.external': 'External task',
    'mode.oneShot': 'one-shot',
    'mode.continuable': 'continuable',
    'mode.unknown': 'unknown mode',
    'activity.running': 'running',
    'activity.completed': 'completed',
    'activity.inactive': 'not running',
    'branch.collapse': 'Collapse {label} descendants',
    'branch.expand': 'Expand {label} descendants',
    'count.total.one': '{count} subagent',
    'count.total.other': '{count} subagents',
    'count.running.one': '{count} subagent running',
    'count.running.other': '{count} subagents running',
    'switcher.aria': 'Switch subagent: {title}',
    'tree.aria': 'Subagent sessions',
    'open.sidebar': 'Open in sidebar',
    'open.sidebar.aria': 'Open {label} in sidebar',
    'archive.allCompleted': 'Archive done',
    'archive.one': 'Move to history',
    'archive.restore': 'Restore from history',
    'history.title': 'History ({count})',
    'model.tooltip': 'Subagent model: {model} (read-only)',
    'readonly.oneShot.title': 'One-shot subagent record',
    'readonly.title': 'This subagent is read-only for now',
    'readonly.oneShot.body': 'One-shot tasks do not accept follow-ups; review the full execution record here.',
    'readonly.unknown.body': 'Read the child session to determine whether it can be continued.',
  },
};

function heSubagentChatAddress(address) {
  const query = new URLSearchParams({ parent: address.parentSessionId, mode: address.mode });
  return `${HE_SUBAGENT_CHAT_ADDRESS}${encodeURIComponent(address.childSessionId)}?${query}`;
}

function heSubagentSelectReadOnly(owner) {
  const subagent = owner?.session?.subagent;
  if (subagent === undefined || subagent === null) return null;
  if (subagent.address?.mode === 'unknown') return { reason: 'unknown' };
  if (subagent.address?.mode === 'one-shot') return { reason: 'one-shot' };
  return null;
}

function heSubagentFormatTokens(value, t) {
  const scaled = next => (next >= 100 ? String(Math.round(next)) : String(Math.round(next * 10) / 10));
  if (value < 1e3) return String(value);
  if (value < 1e6) return t('tokens.thousand', { value: scaled(value / 1e3) });
  return t('tokens.million', { value: scaled(value / 1e6) });
}

function heSubagentTokenTotal(usage) {
  return usage === undefined
    ? undefined
    : usage.uncachedInputTokens + usage.outputTokens + usage.cacheReadTokens + usage.cacheWriteTokens;
}

function heSubagentActivityDuration(summary, activity, now) {
  const timing = summary?.projectionValues?.subagentTiming;
  if (timing === undefined) return undefined;
  if (timing.active === undefined) return timing.settledMs;
  const end = activity === 'running' ? now : timing.active.through;
  return timing.settledMs + Math.max(0, end - timing.active.since);
}

function heSubagentSplitDuration(ms) {
  const totalSeconds = Math.floor(Math.max(0, ms) / 1e3);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const totalHours = Math.floor(totalMinutes / 60);
  return {
    seconds: totalSeconds % 60,
    minutes: totalMinutes % 60,
    hours: totalHours % 24,
    days: Math.floor(totalHours / 24),
    totalMinutes,
    totalHours,
  };
}

function heSubagentFormatDuration(ms, t) {
  const { seconds, minutes, hours, days, totalMinutes, totalHours } = heSubagentSplitDuration(ms);
  if (days >= 365) {
    const years = Math.floor(days / 365);
    const months = Math.floor((days % 365) / 30);
    return months === 0 ? t('duration.years', { years }) : t('duration.yearsMonths', { years, months });
  }
  if (days >= 30) {
    const months = Math.floor(days / 30);
    const remainingDays = days % 30;
    return remainingDays === 0 ? t('duration.months', { months }) : t('duration.monthsDays', { months, days: remainingDays });
  }
  if (days > 0) return hours === 0 ? t('duration.days', { days }) : t('duration.daysHours', { days, hours });
  if (totalHours > 0) return t('duration.hours', { hours: totalHours, minutes: String(minutes).padStart(2, '0'), seconds: String(seconds).padStart(2, '0') });
  if (totalMinutes > 0) return t('duration.minutes', { minutes: totalMinutes, seconds: String(seconds).padStart(2, '0') });
  return t('duration.seconds', { seconds });
}

function heSubagentFormatExactDuration(ms, t) {
  const { seconds, minutes, hours, days } = heSubagentSplitDuration(ms);
  return days === 0
    ? heSubagentFormatDuration(ms, t)
    : t('duration.exactDays', {
      days,
      hours: String(hours).padStart(2, '0'),
      minutes: String(minutes).padStart(2, '0'),
      seconds: String(seconds).padStart(2, '0'),
    });
}

function heSubagentEntryName(entry) {
  return 'name' in entry && entry.name !== undefined ? entry.name : entry.id;
}

function heSubagentCompletedEntry(entry, summary) {
  if (entry.mode === 'external' || entry.activity === 'running') return false;
  if (summary?.projectionValues?.subagentTiming?.settledMs > 0) return true;
  if (summary?.projectionValues?.tokenUsage !== undefined) return true;
  return summary?.blank === false;
}

function heSubagentCanExpand(entry, catalogs, summaries) {
  if (entry.mode === 'external') return false;
  if (summaries[entry.id]?.formatStatus === 'migration-required') return false;
  const child = catalogs[entry.id];
  if (child?.state === 'migration-required') return false;
  return (child?.entries?.length ?? 0) > 0;
}

function heSubagentHasRunningDescendant(id, catalogs, visited = new Set()) {
  if (!id || visited.has(id)) return false;
  visited.add(id);
  const branch = catalogs[id];
  if (!branch?.entries?.length) return false;
  for (const child of branch.entries) {
    if (child.activity === 'running') return true;
    if (heSubagentHasRunningDescendant(child.id, catalogs, visited)) return true;
  }
  return false;
}

function heSubagentCatalogProgress(entries, summaries, t) {
  let active = 0;
  let completed = 0;
  let inactive = 0;
  let external = 0;
  for (const entry of entries) {
    if (entry.mode === 'external') external += 1;
    else if (entry.activity === 'running') active += 1;
    else if (heSubagentCompletedEntry(entry, summaries[entry.id])) completed += 1;
    else inactive += 1;
  }
  const parts = [];
  if (active > 0) parts.push(t('progress.active', { count: active }));
  if (completed > 0) parts.push(t('progress.completed', { count: completed }));
  if (inactive > 0) parts.push(t('progress.inactive', { count: inactive }));
  if (external > 0) parts.push(t('progress.external', { count: external }));
  return parts.join(' · ');
}

export function registerSubagentUi(ctx, React, ReactDOM, primitives, view = window) {
  if (!ctx?.slots || !ctx?.sessions || !ctx?.uiWorkspace || !ctx?.sidebarRight || !ctx?.locale) return;
  if (!React?.createElement || !ReactDOM?.createPortal || !primitives?.MenuSurface) return;

  const { createElement: h, Fragment, useEffect, useId, useMemo, useRef, useState, useSyncExternalStore } = React;
  const {
    MenuSurface,
    StateDot,
    Tooltip,
    IconUsersOutlineRegular,
    IconChevronRightOutlineRegular,
    IconCheckOutlineRegular,
    IconRefreshOutlineRegular,
  } = primitives;

  ctx.effect?.(() => ctx.locale.register(HE_SUBAGENT_NS, HE_SUBAGENT_LOCALE), 'harness-enhanced: subagent UI translations');

  ctx.effect?.(() => {
    const doc = view?.document;
    if (!doc?.head) return () => {};
    let tag = doc.querySelector(`style[data-plugin-css=${JSON.stringify(HE_SUBAGENT_STYLE_ID)}]`);
    let owned = false;
    if (!tag) {
      tag = doc.createElement('style');
      tag.dataset.plugin = '@local/dsh-harness-enhanced';
      tag.dataset.pluginCss = HE_SUBAGENT_STYLE_ID;
      tag.textContent = HE_SUBAGENT_CSS;
      doc.head.appendChild(tag);
      owned = true;
    }
    return () => {
      if (owned && tag?.parentNode) tag.parentNode.removeChild(tag);
    };
  }, 'harness-enhanced: subagent UI styles');

  let storage = null;
  try { storage = view?.localStorage ?? null; } catch {}
  const archiveStore = createSubagentArchiveStore(storage);

  let catalogStore = null;
  const catalogListeners = new Set();
  const notifyCatalog = () => { for (const fn of catalogListeners) fn(); };
  const modelCatalogFace = {
    subscribe(listener) {
      catalogListeners.add(listener);
      return () => catalogListeners.delete(listener);
    },
    getSnapshot() {
      return catalogStore?.getSnapshot?.() ?? null;
    },
  };

  ctx.inject?.(['modelDirectories'], scope => {
    const dir = scope.modelDirectories;
    catalogStore = dir?.catalog?.store ?? null;
    dir?.catalog?.load?.().catch?.(() => {});
    const unsubscribe = catalogStore?.subscribe?.(notifyCatalog);
    notifyCatalog();
    scope.effect?.(() => () => {
      unsubscribe?.();
      if (catalogStore === dir?.catalog?.store) catalogStore = null;
      notifyCatalog();
    }, 'harness-enhanced: subagent model catalog bridge');
  });

  const resolveText = value => {
    try { return ctx.locale.resolveText?.(value); } catch { return undefined; }
  };

  function SwitcherIcon() {
    return h('svg', { width: 16, height: 16, viewBox: '0 0 20 20', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M6 12.7L9.5 15.3C9.8 15.5 10.2 15.5 10.5 15.3L14 12.7', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M6 7.3L9.5 4.7C9.8 4.5 10.2 4.5 10.5 4.7L14 7.3', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    );
  }

  function ModelChipIcon() {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('rect', { x: 4, y: 4, width: 8, height: 8, rx: 1.5, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M6.5 2V4M9.5 2V4M6.5 12V14M9.5 12V14M2 6.5H4M2 9.5H4M12 6.5H14M12 9.5H14', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' }),
    );
  }

  function ArchiveIcon() {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('rect', { x: 2, y: 2.5, width: 12, height: 3, rx: 1, stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M3.2 5.5V12.2C3.2 12.9 3.8 13.5 4.5 13.5H11.5C12.2 13.5 12.8 12.9 12.8 12.2V5.5', stroke: 'currentColor', strokeWidth: 1.3 }),
      h('path', { d: 'M6.4 8.7H9.6', stroke: 'currentColor', strokeWidth: 1.3, strokeLinecap: 'round' }),
    );
  }

  function RestoreIcon() {
    return h('svg', { width: 13, height: 13, viewBox: '0 0 16 16', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M4 6.5L8 2.8L12 6.5', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round', strokeLinejoin: 'round' }),
      h('path', { d: 'M8 3.2V11.2', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round' }),
      h('path', { d: 'M3.5 13.2H12.5', stroke: 'currentColor', strokeWidth: 1.35, strokeLinecap: 'round' }),
    );
  }

  function ChevronIcon() {
    if (IconChevronRightOutlineRegular) return h(IconChevronRightOutlineRegular, {});
    return h('svg', { width: 12, height: 12, viewBox: '0 0 12 12', fill: 'none', 'aria-hidden': true },
      h('path', { d: 'M4.5 2.5L8 6L4.5 9.5', stroke: 'currentColor', strokeWidth: 1.5, strokeLinecap: 'round', strokeLinejoin: 'round' }),
    );
  }

  function MaybeTooltip({ label, children }) {
    if (!Tooltip || !label) return children;
    return h(Tooltip, { label, delayMs: 400, side: 'bottom', align: 'end' }, children);
  }

  function SubagentRow({
    entry,
    parentSessionId,
    currentSessionId,
    catalogs,
    projections,
    summaries,
    modelCatalog,
    expanded,
    level,
    reserveDisclosure,
    now,
    isArchivedSection,
    openChild,
    openChildAside,
    refreshProjection,
    toggleBranch,
    closeCatalog,
    onArchiveOne,
    onRestoreOne,
    t,
  }) {
    const external = entry.mode === 'external';
    const childCatalog = catalogs[entry.id];
    const isCurrent = entry.id === currentSessionId;
    const requiresOpening = summaries[entry.id]?.formatStatus === 'migration-required'
      || childCatalog?.state === 'migration-required';
    const canExpand = heSubagentCanExpand(entry, catalogs, summaries);
    const isExpanded = canExpand && expanded.has(entry.id);
    const summary = summaries[entry.id];
    const description = entry.label || summary?.title;
    const name = heSubagentEntryName(entry);
    const primaryLabel = description || name;
    const secondaryName = description ? name : undefined;

    const modelProjection = projections[entry.id]?.values?.modelSelection ?? summary?.projectionValues?.modelSelection;
    const modelInfo = resolveSubagentModelInfo(modelProjection, modelCatalog, resolveText);

    const completed = heSubagentCompletedEntry(entry, summary);
    const totalTokens = heSubagentTokenTotal(summary?.projectionValues?.tokenUsage);
    const durationMs = heSubagentActivityDuration(summary, entry.activity, now);
    const tokenMetric = totalTokens === undefined ? undefined : t('tokens.total', { value: heSubagentFormatTokens(totalTokens, t) });
    const durationMetric = durationMs === undefined ? undefined : {
      compact: heSubagentFormatDuration(durationMs, t),
      exact: heSubagentFormatExactDuration(durationMs, t),
    };
    const metrics = [tokenMetric, durationMetric?.exact].filter(Boolean).join(' · ');

    const isRunning = entry.activity === 'running' || heSubagentHasRunningDescendant(entry.id, catalogs);
    const canToggleArchive = level === 1 && !isRunning && !isCurrent;

    const open = () => {
      if (external) return;
      openChild({ parentSessionId, childSessionId: entry.id, mode: entry.mode });
      closeCatalog();
    };
    const handleKey = event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.stopPropagation();
        open();
      } else if ((event.key === 'ArrowRight' && canExpand && !isExpanded) || (event.key === 'ArrowLeft' && isExpanded)) {
        event.preventDefault();
        event.stopPropagation();
        toggleBranch(entry.id);
      }
    };
    const toggle = event => {
      event.preventDefault();
      event.stopPropagation();
      toggleBranch(entry.id);
    };

    return h('div', { className: 'he-subagent-node' },
      h('div', {
        role: 'treeitem',
        tabIndex: external ? -1 : 0,
        'aria-disabled': external || undefined,
        'aria-level': level,
        'aria-current': isCurrent || undefined,
        'aria-expanded': canExpand ? isExpanded : undefined,
        'aria-label': [primaryLabel, secondaryName, modelInfo?.full, metrics].filter(Boolean).join(' '),
        className: 'he-subagent-row',
        onClick: open,
        onKeyDown: handleKey,
      },
        !canExpand
          ? (reserveDisclosure ? h('span', { className: 'he-subagent-disclosureSpace' }) : null)
          : h('button', {
            type: 'button',
            tabIndex: -1,
            className: `he-subagent-disclosure${isExpanded ? ' he-subagent-disclosureOpen' : ''}`,
            'aria-label': t(isExpanded ? 'branch.collapse' : 'branch.expand', { label: primaryLabel }),
            onClick: toggle,
          }, h(ChevronIcon, null)),
        h('div', { className: 'he-subagent-clickarea' },
          h('span', { className: 'he-subagent-rowActivitySlot' },
            StateDot ? h(StateDot, { state: entry.activity === 'running' ? 'ongoing' : completed ? 'done' : 'idle' }) : null,
          ),
          h('span', { className: 'he-subagent-content' },
            h('span', { className: `he-subagent-label${isCurrent ? ' he-subagent-currentLabel' : ''}` }, primaryLabel),
            (secondaryName || modelInfo) ? h('span', { className: 'he-subagent-secondaryLine' },
              secondaryName ? h('span', null, secondaryName) : null,
              secondaryName && modelInfo ? h('span', { 'aria-hidden': true }, '·') : null,
              modelInfo ? h('span', { className: 'he-subagent-modelMeta', title: modelInfo.full }, modelInfo.compact) : null,
            ) : null,
          ),
          metrics ? h('span', { className: 'he-subagent-metrics' },
            tokenMetric ? h('span', { className: 'he-subagent-metricToken' }, tokenMetric) : null,
            durationMetric ? h('span', {
              className: 'he-subagent-metricDuration',
              title: t('duration.exactTitle', { duration: durationMetric.exact }),
            }, durationMetric.compact) : null,
          ) : null,
          h('span', { className: 'he-subagent-rowActions' },
            canToggleArchive ? h(MaybeTooltip, { label: t(isArchivedSection ? 'archive.restore' : 'archive.one') },
              h('button', {
                type: 'button',
                className: 'he-subagent-iconBtn he-subagent-archiveBtn',
                'aria-label': t(isArchivedSection ? 'archive.restore' : 'archive.one'),
                onClick: event => {
                  event.preventDefault();
                  event.stopPropagation();
                  if (isArchivedSection) onRestoreOne?.(entry.id);
                  else onArchiveOne?.(entry.id);
                },
                onKeyDown: event => event.stopPropagation(),
              }, isArchivedSection ? h(RestoreIcon, null) : h(ArchiveIcon, null)),
            ) : null,
            isCurrent
              ? h('span', {
                className: 'he-subagent-sidebarSpace he-subagent-currentCheck',
                'aria-hidden': true,
                'data-subagent-current': true,
              }, IconCheckOutlineRegular ? h(IconCheckOutlineRegular, { size: 16 }) : '✓')
              : external
                ? h('span', { className: 'he-subagent-sidebarSpace' })
                : h(MaybeTooltip, { label: t('open.sidebar') },
                  h('button', {
                    type: 'button',
                    className: 'he-subagent-iconBtn',
                    'aria-label': t('open.sidebar.aria', { label: primaryLabel }),
                    onClick: event => {
                      event.preventDefault();
                      event.stopPropagation();
                      openChildAside({ parentSessionId, childSessionId: entry.id, mode: entry.mode });
                      closeCatalog();
                    },
                    onKeyDown: event => event.stopPropagation(),
                  }, h(ChevronIcon, null)),
                ),
          ),
        ),
      ),
      !isExpanded && !external && !requiresOpening && childCatalog?.state === 'error'
        ? h('div', { className: 'he-subagent-error', role: 'alert' },
          h('span', null, t('load.error')),
          h('button', {
            type: 'button',
            className: 'he-subagent-refresh',
            onClick: () => refreshProjection(entry.id),
          }, IconRefreshOutlineRegular ? h(IconRefreshOutlineRegular, { size: 14 }) : null, t('retry')),
        )
        : null,
      childCatalog !== undefined && isExpanded
        ? h('div', { role: 'group', className: 'he-subagent-children' },
          h(CatalogRows, {
            parentSessionId: entry.id,
            currentSessionId,
            catalog: childCatalog,
            catalogs,
            projections,
            summaries,
            modelCatalog,
            expanded,
            level: level + 1,
            openChild,
            openChildAside,
            refreshProjection,
            toggleBranch,
            closeCatalog,
            t,
          }),
        )
        : null,
    );
  }

  function CatalogRows({
    parentSessionId,
    currentSessionId,
    catalog,
    catalogs,
    projections,
    summaries,
    modelCatalog,
    expanded,
    level,
    openChild,
    openChildAside,
    refreshProjection,
    toggleBranch,
    closeCatalog,
    entriesOverride,
    isArchivedSection = false,
    onArchiveOne,
    onRestoreOne,
    t,
  }) {
    const entries = entriesOverride ?? catalog.entries;
    const [now, setNow] = useState(() => Date.now());
    const running = entries.some(entry => entry.activity === 'running');
    useEffect(() => {
      if (!running) return undefined;
      const timer = view.setInterval(() => setNow(Date.now()), 1e3);
      return () => view.clearInterval(timer);
    }, [running]);

    const emptyLoading = !entriesOverride && catalog.state === 'loading' && entries.length === 0;
    const reserveDisclosure = entries.some(entry => heSubagentCanExpand(entry, catalogs, summaries));

    return h(Fragment, null,
      !entriesOverride && catalog.state === 'idle' && entries.length === 0
        ? h('div', { className: 'he-subagent-notice' }, t('load.idle'))
        : null,
      emptyLoading
        ? h('div', { className: 'he-subagent-notice' }, t('loading.label'))
        : null,
      !entriesOverride && catalog.state === 'error'
        ? h('div', { className: 'he-subagent-error' },
          h('span', null, catalog.error?.message ?? t('load.error')),
          h('button', {
            type: 'button',
            className: 'he-subagent-refresh',
            onClick: () => refreshProjection(parentSessionId),
          }, IconRefreshOutlineRegular ? h(IconRefreshOutlineRegular, { size: 14 }) : null, t('retry')),
        )
        : null,
      entries.map(entry => h(SubagentRow, {
        key: entry.id,
        entry,
        parentSessionId,
        currentSessionId,
        catalogs,
        projections,
        summaries,
        modelCatalog,
        expanded,
        level,
        reserveDisclosure,
        now,
        isArchivedSection,
        openChild,
        openChildAside,
        refreshProjection,
        toggleBranch,
        closeCatalog,
        onArchiveOne,
        onRestoreOne,
        t,
      })),
    );
  }

  function CatalogDropdown(props) {
    const {
      rootSessionId,
      currentSessionId,
      displayTitle,
      openTitle,
      variant,
      useSessions,
      useSessionStatus,
      openChild,
      openChildAside,
      prepareCatalog,
      t,
      hasSharedTasks = false,
      hasBoardContent = false,
      renderFooter,
    } = props;
    const ancestorSwitcher = variant === 'switcher' && openTitle !== undefined;
    const projections = useSessions(state => state.projectionsBySession);
    const summaries = useSessions(state => state.byId);
    const statuses = useSessionStatus(value => value);
    const modelCatalog = useSyncExternalStore(modelCatalogFace.subscribe, modelCatalogFace.getSnapshot);
    const archiveVersion = useSyncExternalStore(archiveStore.subscribe, archiveStore.getVersion);

    const catalogs = useMemo(() => Object.fromEntries(
      Object.entries(projections).map(([id, snapshot]) => {
        const projected = snapshot.values.subagentCatalog;
        return [id, {
          state: snapshot.state === 'idle'
            ? (projected === undefined ? 'idle' : 'ready')
            : (snapshot.state === 'migration-required' && projected !== undefined ? 'ready' : snapshot.state),
          error: snapshot.error,
          entries: (projected ?? []).map(entry => ({
            ...entry,
            activity: (statuses.get(entry.id)?.running ?? summaries[entry.id]?.running) === true ? 'running' : 'inactive',
          })),
        }];
      }),
    ), [projections, summaries, statuses]);

    const catalog = catalogs[rootSessionId];
    const prepareLevel = sessionId => {
      prepareCatalog(sessionId).catch(() => {});
    };

    const [open, setOpen] = useState(false);
    const [expanded, setExpanded] = useState(() => new Set());
    const [historyOpen, setHistoryOpen] = useState(false);
    const rootRef = useRef(null);
    const triggerRef = useRef(null);
    const countRef = useRef(null);
    const activityId = useId();
    const menuRef = useRef(null);
    const anchorName = `--dsh-subagents-${activityId.replaceAll(':', '')}`;
    const hoverOpenTimer = useRef(undefined);
    const hoverCloseTimer = useRef(undefined);
    const pinnedRef = useRef(false);

    const currentEntry = currentSessionId === undefined
      ? undefined
      : catalog?.entries.find(entry => entry.id === currentSessionId);
    const switcherDisplayTitle = currentEntry !== undefined
      ? (currentEntry.label || heSubagentEntryName(currentEntry))
      : displayTitle;
    const directChildren = catalog?.entries ?? [];
    const directCount = directChildren.length;
    const runningCount = directChildren.filter(entry => entry.activity === 'running').length;
    const progress = heSubagentCatalogProgress(directChildren, summaries, t);

    const partitioned = useMemo(() => {
      const prefs = archiveStore.get(rootSessionId);
      return partitionSubagentEntries(directChildren, {
        archivedIds: prefs.archivedIds,
        pinnedIds: prefs.pinnedIds,
        currentSessionId,
        hasRunningDescendant: id => heSubagentHasRunningDescendant(id, catalogs),
      });
    }, [directChildren, rootSessionId, currentSessionId, catalogs, archiveVersion]);

    const presentedCatalog = catalog ?? (variant === 'switcher' || hasBoardContent
      ? { entries: [], state: 'idle', error: null }
      : undefined);

    const cancelHoverClose = () => {
      if (hoverCloseTimer.current === undefined) return;
      view.clearTimeout(hoverCloseTimer.current);
      hoverCloseTimer.current = undefined;
    };
    const cancelHoverOpen = () => {
      if (hoverOpenTimer.current === undefined) return;
      view.clearTimeout(hoverOpenTimer.current);
      hoverOpenTimer.current = undefined;
    };
    const changeOpen = (next, restoreFocus = false) => {
      cancelHoverOpen();
      cancelHoverClose();
      if (next) {
        if (triggerRef.current === null) return;
        setOpen(true);
        prepareLevel(rootSessionId);
      } else {
        pinnedRef.current = false;
        setOpen(false);
        setExpanded(new Set());
        setHistoryOpen(false);
      }
      if (restoreFocus) queueMicrotask(() => triggerRef.current?.focus());
    };
    const allowsHoverOpen = () => variant === 'switcher'
      || (countRef.current !== null && view.getComputedStyle(countRef.current).display !== 'none');
    const scheduleHoverOpen = () => {
      cancelHoverOpen();
      cancelHoverClose();
      if (open || !allowsHoverOpen()) return;
      hoverOpenTimer.current = view.setTimeout(() => {
        hoverOpenTimer.current = undefined;
        if (allowsHoverOpen()) changeOpen(true);
      }, 150);
    };
    const scheduleHoverClose = () => {
      cancelHoverOpen();
      cancelHoverClose();
      if (pinnedRef.current) return;
      hoverCloseTimer.current = view.setTimeout(() => {
        hoverCloseTimer.current = undefined;
        changeOpen(false);
      }, 120);
    };

    const closeBranch = root => {
      const closing = new Set();
      const visit = parentId => {
        if (closing.has(parentId) || !expanded.has(parentId)) return;
        closing.add(parentId);
        for (const entry of catalogs[parentId]?.entries ?? []) visit(entry.id);
      };
      visit(root);
      setExpanded(current => new Set([...current].filter(id => !closing.has(id))));
    };
    const toggleBranch = childSessionId => {
      if (expanded.has(childSessionId)) {
        closeBranch(childSessionId);
        return;
      }
      setExpanded(current => new Set(current).add(childSessionId));
      prepareLevel(childSessionId);
    };

    useEffect(() => {
      if (!open) return undefined;
      const closeOutside = event => {
        if (event.target instanceof Node && !rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) {
          changeOpen(false);
        }
      };
      const dismiss = event => {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        changeOpen(false, menuRef.current?.contains(view.document.activeElement) === true);
      };
      view.document.addEventListener('pointerdown', closeOutside);
      view.document.addEventListener('keydown', dismiss);
      return () => {
        view.document.removeEventListener('pointerdown', closeOutside);
        view.document.removeEventListener('keydown', dismiss);
      };
    }, [open]);

    useEffect(() => () => {
      cancelHoverOpen();
      cancelHoverClose();
    }, []);

    const visible = presentedCatalog !== undefined && (
      variant === 'switcher'
      || hasBoardContent
      || presentedCatalog.state === 'error'
      || presentedCatalog.entries.length > 0
    );
    if (!visible) return null;

    const totalCountKey = directCount === 1 ? 'count.total.one' : 'count.total.other';
    const runningCountKey = runningCount === 1 ? 'count.running.one' : 'count.running.other';

    const onArchiveOne = childId => {
      pinnedRef.current = true;
      archiveStore.archive(rootSessionId, childId);
    };
    const onRestoreOne = childId => {
      pinnedRef.current = true;
      archiveStore.unarchive(rootSessionId, childId);
    };
    const onArchiveAllCompleted = event => {
      event.preventDefault();
      event.stopPropagation();
      pinnedRef.current = true;
      if (partitioned.archivableIdleIds.length > 0) {
        archiveStore.archive(rootSessionId, partitioned.archivableIdleIds);
      }
    };

    const showSectionHeader = hasSharedTasks || directCount > 0;

    return h('div', {
      ref: rootRef,
      className: `he-subagent-root${variant === 'switcher' ? ' he-subagent-switcherRoot' : ''}`,
      onPointerEnter: event => {
        if (event.pointerType !== 'touch') {
          prepareLevel(rootSessionId);
          scheduleHoverOpen();
        }
      },
      onPointerLeave: scheduleHoverClose,
    },
      h('button', {
        ref: triggerRef,
        type: 'button',
        className: variant === 'switcher'
          ? `he-subagent-switcherTrigger${ancestorSwitcher ? ' he-subagent-ancestorSwitcherTrigger' : ''}`
          : 'he-subagent-trigger',
        style: { anchorName },
        'aria-expanded': open,
        'aria-haspopup': 'dialog',
        'aria-label': variant === 'switcher' ? t('switcher.aria', { title: switcherDisplayTitle }) : undefined,
        'aria-describedby': variant === 'count' && runningCount > 0 ? activityId : undefined,
        onClick: event => {
          if (ancestorSwitcher && !open) {
            event.preventDefault();
            openTitle?.();
            return;
          }
          if (open && pinnedRef.current) {
            changeOpen(false);
          } else {
            pinnedRef.current = true;
            changeOpen(true);
          }
        },
      },
        variant === 'switcher'
          ? h(Fragment, null,
            h('span', { className: 'he-subagent-switcherTitle' }, switcherDisplayTitle),
            h(SwitcherIcon, null),
          )
          : h(Fragment, null,
            h('span', { className: 'he-subagent-activitySlot', 'aria-hidden': true },
              IconUsersOutlineRegular ? h(IconUsersOutlineRegular, {
                size: 14,
                className: runningCount > 0 ? 'he-subagent-compactIcon' : undefined,
              }) : null,
              runningCount > 0 && StateDot ? h(StateDot, { state: 'ongoing', className: 'he-subagent-textModeActivity' }) : null,
            ),
            h('span', { ref: countRef, className: 'he-subagent-count', 'data-subagent-count': true }, t(totalCountKey, { count: directCount })),
          ),
      ),
      variant === 'count' && runningCount > 0
        ? h('span', { id: activityId, hidden: true }, t(runningCountKey, { count: runningCount }))
        : null,
      open ? ReactDOM.createPortal(
        h(MenuSurface, {
          ref: menuRef,
          className: 'he-subagent-menu',
          style: { positionAnchor: anchorName },
          role: 'dialog',
          tabIndex: -1,
          'aria-label': t('tree.aria'),
          'data-subagent-panel': true,
          onPointerEnter: event => { if (event.pointerType !== 'touch') cancelHoverClose(); },
          onPointerLeave: scheduleHoverClose,
        },
          h('div', { className: 'he-subagent-menuBody' },
            showSectionHeader ? h('div', { className: 'he-subagent-sectionHeader', 'data-subagent-section-header': true },
              h('span', { className: 'he-subagent-sectionIcon', 'aria-hidden': true },
                IconUsersOutlineRegular ? h(IconUsersOutlineRegular, { size: 14 }) : null,
              ),
              h('h3', { className: 'he-subagent-sectionTitle' }, t('section.title')),
              progress ? h('span', { className: 'he-subagent-sectionProgress' }, progress) : null,
              partitioned.archivableIdleIds.length > 0 ? h('button', {
                type: 'button',
                className: 'he-subagent-headerAction',
                onClick: onArchiveAllCompleted,
              }, t('archive.allCompleted')) : null,
            ) : null,
            hasSharedTasks && presentedCatalog.state === 'ready' && directCount === 0
              ? h('p', { className: 'he-subagent-sectionEmpty' }, t('section.empty'))
              : null,
            directCount > 0 && partitioned.active.length === 0
              ? h('p', { className: 'he-subagent-sectionEmpty' }, t('section.activeEmpty'))
              : null,
            h('div', { role: 'tree', 'aria-label': t('tree.aria') },
              h(CatalogRows, {
                parentSessionId: rootSessionId,
                currentSessionId,
                catalog: presentedCatalog,
                catalogs,
                projections,
                summaries,
                modelCatalog,
                expanded,
                level: 1,
                entriesOverride: directCount > 0 ? partitioned.active : undefined,
                openChild,
                openChildAside,
                refreshProjection: prepareLevel,
                toggleBranch,
                closeCatalog: () => changeOpen(false),
                onArchiveOne,
                onRestoreOne,
                t,
              }),
            ),
            partitioned.archived.length > 0 ? h('div', { className: 'he-subagent-historyWrap' },
              h('button', {
                type: 'button',
                className: `he-subagent-historyToggle${historyOpen ? ' he-subagent-historyToggleOpen' : ''}`,
                'aria-expanded': historyOpen,
                onClick: event => {
                  event.preventDefault();
                  event.stopPropagation();
                  pinnedRef.current = true;
                  setHistoryOpen(prev => !prev);
                },
              }, h(ChevronIcon, null), h('span', null, t('history.title', { count: partitioned.archived.length }))),
              historyOpen ? h('div', { className: 'he-subagent-historyBody', role: 'group' },
                h(CatalogRows, {
                  parentSessionId: rootSessionId,
                  currentSessionId,
                  catalog: presentedCatalog,
                  catalogs,
                  projections,
                  summaries,
                  modelCatalog,
                  expanded,
                  level: 1,
                  entriesOverride: partitioned.archived,
                  isArchivedSection: true,
                  openChild,
                  openChildAside,
                  refreshProjection: prepareLevel,
                  toggleBranch,
                  closeCatalog: () => changeOpen(false),
                  onArchiveOne,
                  onRestoreOne,
                  t,
                }),
              ) : null,
            ) : null,
            renderFooter?.(),
          ),
        ),
        view.document.body,
      ) : null,
    );
  }

  function useCurrentSubagentModel({ sessionId, useSession, useSessions, useProjection }) {
    const addressedChild = typeof useSession === 'function' ? useSession(snapshot => snapshot?.subagent !== null && snapshot?.subagent !== undefined) : false;
    const listedChild = typeof useSessions === 'function' ? useSessions(state => state.byId[sessionId]?.origin === 'subagent') : false;
    const isSubagent = addressedChild || listedChild;
    const liveSelection = typeof useProjection === 'function' ? useProjection('modelSelection', value => value) : undefined;
    const projectedSelection = typeof useSessions === 'function'
      ? useSessions(state => state.projectionsBySession[sessionId]?.values?.modelSelection)
      : undefined;
    const modelCatalog = useSyncExternalStore(modelCatalogFace.subscribe, modelCatalogFace.getSnapshot);

    useEffect(() => {
      if (!isSubagent || !sessionId || liveSelection !== undefined || projectedSelection !== undefined) return;
      ctx.sessions.refreshProjections?.(sessionId)?.catch?.(() => {});
    }, [isSubagent, sessionId, liveSelection, projectedSelection]);

    if (!isSubagent) return null;
    return resolveSubagentModelInfo(liveSelection ?? projectedSelection, modelCatalog, resolveText);
  }

  function SubagentModelBadge(props) {
    const info = useCurrentSubagentModel(props);
    if (!info) return null;
    return h('span', {
      className: 'he-subagent-modelBadge',
      title: props.t('model.tooltip', { model: info.full }),
      'data-harness-enhanced-subagent-model': info.model,
    },
      h(ModelChipIcon, null),
      h('span', { className: 'he-subagent-modelBadgeText' }, info.compact),
    );
  }

  function SubagentReadOnlyComposer(props) {
    const info = useCurrentSubagentModel(props);
    const oneShot = props.matched?.reason === 'one-shot';
    return h('div', { className: 'he-subagent-readonlyFrame', role: 'status' },
      h('div', { className: 'he-subagent-readonlyHead' },
        h('strong', null, props.t(oneShot ? 'readonly.oneShot.title' : 'readonly.title')),
        info ? h('span', {
          className: 'he-subagent-modelBadge',
          title: props.t('model.tooltip', { model: info.full }),
          'data-harness-enhanced-subagent-model': info.model,
        },
          h(ModelChipIcon, null),
          h('span', { className: 'he-subagent-modelBadgeText' }, info.compact),
        ) : null,
      ),
      h('span', null, props.t(oneShot ? 'readonly.oneShot.body' : 'readonly.unknown.body')),
    );
  }

  const catalogActions = () => ({
    openChild(address) {
      ctx.uiWorkspace.openSession(address);
    },
    openChildAside(address) {
      ctx.sidebarRight.openResource(heSubagentChatAddress(address), { kind: 'subagentchat', preferNewPane: true });
    },
    async prepareCatalog(parentSessionId) {
      await ctx.sessions.refreshProjections(parentSessionId);
      const parent = ctx.sessions.list.getSnapshot().projectionsBySession[parentSessionId];
      if (parent?.state !== 'ready') return;
      const targets = (parent.values.subagentCatalog ?? []).filter(entry => {
        if (entry.mode === 'external') return false;
        const state = ctx.sessions.list.getSnapshot();
        return state.byId[entry.id]?.formatStatus !== 'migration-required'
          && state.projectionsBySession[entry.id]?.state !== 'migration-required'
          && state.projectionsBySession[entry.id]?.state !== 'error';
      }).reverse();
      for (let i = 0; i < targets.length; i += HE_SUBAGENT_REFRESH_CONCURRENCY) {
        const batch = targets.slice(i, i + HE_SUBAGENT_REFRESH_CONCURRENCY);
        await Promise.allSettled(batch.map(entry => ctx.sessions.refreshProjections(entry.id)));
      }
    },
    refreshProjection(parentSessionId) {
      ctx.sessions.refreshProjections(parentSessionId);
    },
  });

  const footerSlot = 'conversation.session.header.actions.subagent.footer';
  const EMPTY_FOOTER = Object.freeze([]);
  let cachedFooter = EMPTY_FOOTER;
  const footerEntries = {
    getSnapshot: () => {
      const next = ctx.slots.entriesOfSlot?.(footerSlot) ?? ctx.slots.entries?.(footerSlot) ?? EMPTY_FOOTER;
      if (next.length === 0) {
        cachedFooter = EMPTY_FOOTER;
        return EMPTY_FOOTER;
      }
      if (cachedFooter.length === next.length && cachedFooter.every((item, idx) => item === next[idx])) {
        return cachedFooter;
      }
      cachedFooter = next;
      return next;
    },
    subscribe: listener => ctx.slots.subscribe?.(footerSlot, listener) ?? (() => {}),
  };

  function SubagentFooter(props) {
    const entries = useSyncExternalStore(footerEntries.subscribe, footerEntries.getSnapshot);
    if (!entries || entries.length === 0) return null;
    return h(Fragment, null, entries.map((entry, idx) => {
      if (typeof entry?.component !== 'function') return null;
      const entryT = entry.locale && typeof ctx.locale?.bind === 'function'
        ? ctx.locale.bind(entry.locale)
        : props.t;
      const injected = typeof entry.inject === 'function' ? entry.inject(props.sessionId) : undefined;
      return h(entry.component, {
        key: entry.options?.id ?? idx,
        sessionId: props.sessionId,
        useSession: props.useSession,
        useSessions: props.useSessions,
        useSessionStatus: props.useSessionStatus,
        useProjection: props.useProjection,
        t: entryT,
        ...(injected && typeof injected === 'object' ? injected : {}),
      });
    }));
  }

  function RootCatalogAction(props) {
    const hasSharedTasks = props.useProjection('agentTeam', team => team?.enabled === true && team.tasks.some(task => task.status !== 'deleted'));
    const hasTaskFailure = props.useProjection('agentTeam', team => team?.enabled === true && team.failure !== undefined);
    const footerList = useSyncExternalStore(footerEntries.subscribe, footerEntries.getSnapshot);
    const footer = footerList.length > 0;
    return h(CatalogDropdown, {
      key: props.sessionId,
      rootSessionId: props.sessionId,
      variant: 'count',
      hasSharedTasks: footer && hasSharedTasks,
      hasBoardContent: footer && (hasSharedTasks || hasTaskFailure),
      renderFooter: () => (footer ? h(SubagentFooter, props) : null),
      useSessions: props.useSessions,
      useSessionStatus: props.useSessionStatus,
      openChild: props.openChild,
      openChildAside: props.openChildAside,
      prepareCatalog: props.prepareCatalog,
      t: props.t,
    });
  }

  function SubagentCatalogAction(props) {
    const addressedChild = props.useSession(snapshot => snapshot?.subagent !== null && snapshot?.subagent !== undefined);
    const listedChild = props.useSessions(state => state.byId[props.sessionId]?.origin === 'subagent');
    if (addressedChild || listedChild) return null;
    return h(RootCatalogAction, props);
  }

  function SubagentHeaderLineage({
    lineageSessionId,
    displayTitle,
    openTitle,
    useSessions,
    useSession,
    useSessionStatus,
    openChild,
    openChildAside,
    refreshProjection,
    prepareCatalog,
    t,
  }) {
    const address = useSession(session => session?.subagent?.address);
    const parentId = useSessions(state => {
      if (address?.childSessionId === lineageSessionId) return address.parentSessionId;
      for (const [candidateParent, snapshot] of Object.entries(state.projectionsBySession)) {
        if (snapshot.values.subagentCatalog?.some(entry => entry.id === lineageSessionId)) return candidateParent;
      }
      const summary = state.byId[lineageSessionId];
      return summary?.origin === 'subagent' ? summary.parentId : undefined;
    });
    if (parentId === undefined) return null;
    const shared = { useSessions, useSessionStatus, openChild, openChildAside, refreshProjection, prepareCatalog, t };
    return h(Fragment, null,
      h(CatalogDropdown, {
        key: `switcher:${lineageSessionId}`,
        rootSessionId: parentId,
        currentSessionId: lineageSessionId,
        variant: 'switcher',
        displayTitle,
        ...(openTitle === undefined ? {} : { openTitle }),
        ...shared,
      }),
      openTitle === undefined ? h(CatalogDropdown, {
        key: `children:${lineageSessionId}`,
        rootSessionId: lineageSessionId,
        variant: 'count',
        ...shared,
      }) : null,
    );
  }

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'subagent-catalog',
    order: 10,
    priority: -10,
    locale: HE_SUBAGENT_NS,
    inject: catalogActions,
  }, SubagentCatalogAction));

  ctx.slots.inject('conversation.session.header.lineage', () => ctx.slots.register({
    name: 'conversation.session.header.lineage',
    priority: -10,
    locale: HE_SUBAGENT_NS,
    inject: catalogActions,
  }, SubagentHeaderLineage));

  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'harness-enhanced.subagent-model',
    order: 5,
    locale: HE_SUBAGENT_NS,
  }, SubagentModelBadge));

  ctx.slots.inject('conversation.input.right', () => ctx.slots.register({
    name: 'conversation.input.right',
    id: 'harness-enhanced.subagent-model-composer',
    order: 90,
    locale: HE_SUBAGENT_NS,
  }, SubagentModelBadge));

  ctx.slots.inject('conversation.composer', () => ctx.slots.register({
    name: 'conversation.composer',
    priority: -20,
    locale: HE_SUBAGENT_NS,
    select: heSubagentSelectReadOnly,
  }, SubagentReadOnlyComposer));
}
