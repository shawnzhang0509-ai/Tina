/**
 * Tina家 tinanz.com → 当前表格「Products」工作表
 * 与仓库内 sync.py 的汇率、品牌分类、跳过关键词保持一致。
 *
 * 使用步骤：
 * 1. 打开你的 Google 表格 → 扩展程序 → Apps Script
 * 2. 新建脚本文件，把本文件全部粘贴进去（或复制到 Code.gs）
 * 3. 保存 → 运行一次 scheduledTinanzSync（会请求外部 tinanz.com，需授权）
 * 4. 左侧「触发器」→ 添加触发器 → 选择 scheduledTinanzSync → 时间驱动（如每天凌晨）
 *
 * 可选：在「项目设置」→「脚本属性」中设置（不设置则用下方默认值）
 *   TINANZ_CATEGORY  分类 ID，默认 1026
 *   SYNC_START_ID    起始商品 id，默认 9
 *   MAX_PAGES        最多翻页，默认 20
 */

var CONFIG = {
  NZD_RATE: 0.25,
  AUD_RATE: 0.23,
  NZ_BRANDS: [
    'trilogy', 'comvita', 'streamland', 'caprilac', 'awa', 'encare',
    'mitoq', 'red seal', 'redwin', 'eco store', 'kiwigarden', 'hubbards',
    'vogel', 'weet-bix', 'sanitarium', 'whittakers', 'tasti', 'timtam',
    'knoppers', 'healtheries', 'edmonds', 'olivia', 'moccona', 'tangle teezer',
    'fresco', 'wyeth', 'oz care', 'oz farm', 'pediasure', 'ensure', 'glucerna',
    'karicare', 'bellamy', 'a2 platinum', 'a2 ', 'bellamy',
    'saviq', 'parrs', 'oasis sun', 'freezeframe', 'menino', 'linden leaves',
    'antipodes', 'royal nectar', 'km ', 'living nature', 'jurlique', 'savar',
    'isaac', 'epiology', 'alpine silk', 'organic care', "nature's beauty",
    "la'bonic", 'triumph', 'oneone', 'joy living', 'little beauties',
    'vivano', 'manuka secrets', 'ddmask', 'shadez', 'glow lab',
    'holistic hair', 'clinicians', 'milk & co', 'vida glow', 'essano',
    'lifemum', 'immunrise', 'syrene', 'ficce code', 'natio', 'foodfamily',
    'earthwise', "nature's way", 'bio balance', 'radiance', 'lifestream',
    'nutra life', 'good health', 'life space', 'artemis', 'childlife',
    'kidz minerals', 'harker', 'aspenridge', 'manuka', '蜜纽康', 'mgo',
    '新溪岛', '康维他', '蜡笔', 'gold kiwi', '花胶', '海参',
    'a2milk', 'a2 ', 'karicare goat', 'caprilac goat'
  ],
  AU_BRANDS: [
    'blackmores', 'swisse', 'aptamil', 'healthy care', 'bio island',
    'ostelin', 'bio revive', 'thompson', 'bio balance', 'goat soap',
    'lucas papaw', 'restoria', 'femfresh', 'dermatix', 'refresh',
    'nu-lax', 'floradix', 'farex', 'rhinocort', 'morning fresh', 'moose',
    'mrs rogers', 'belle fleur', 'oral-b', 'heinz', 'tommee tippee',
    'watties', 'sukin', 'ego', 'beauteous', 'gm', 'eaoron',
    'thursday plantation', 'abeeco', 'moroccanoil', 'aveeno',
    'du it', 'bio oil', 'fatblaster', 'go healthy', 'puria', 'astasupreme',
    'haab', 'sudocrem', 'ypl', 'nuskin', 'detto', 'kelo-cote',
    'sheveu', 'saviq', 'parrs', 'menino', 'freezeframe',
    'antipodes', 'royal nectar', 'km口红', 'mgo', 'neurio', '纽瑞优',
    '爱他美', '澳佳宝', '斯维诗', '佳思敏', 'bio island', 'bio rev',
    'life space', 'thompson', 'radiance', 'goat soap',
    'lucas papaw', 'restoria', 'femfresh', 'refresh', 'floradix',
    'farex', 'rhinocort', 'sukin', 'ego', 'eaoron', 'thursday',
    'moroccanoil', 'aveeno', 'du it', 'bio oil', 'fatblaster',
    'go healthy', 'puria', 'astasupreme'
  ],
  SKIP_KEYWORDS: ['礼品袋', '下单咨询', '才可以拍', '下单花胶']
};

function getScriptNumber_(key, defaultVal) {
  var p = PropertiesService.getScriptProperties().getProperty(key);
  if (p == null || p === '') return defaultVal;
  var n = parseInt(p, 10);
  return isNaN(n) ? defaultVal : n;
}

function getScriptString_(key, defaultVal) {
  var p = PropertiesService.getScriptProperties().getProperty(key);
  return (p == null || p === '') ? defaultVal : String(p);
}

/** 供定时触发器调用：成功/失败都写入「_SyncLog」（失败不再抛错，避免重复触发失败邮件） */
function scheduledTinanzSync() {
  try {
    var n = runTinanzSyncInternal_();
    logSyncResult_(new Date(), 'OK', n + ' 条商品已写入 Products');
  } catch (e) {
    logSyncResult_(new Date(), 'ERROR', String(e && e.message ? e.message : e));
  }
}

/** 编辑器里手动运行，便于首次授权与调试 */
function manualTinanzSync() {
  var n = runTinanzSyncInternal_();
  Logger.log('完成，写入 ' + n + ' 条');
}

/**
 * 安装每日触发器（每天约 北京时间 09:00 = UTC+8；Apps Script 按项目时区执行）。
 * 若项目时区为上海，则 hour 9 = 上午 9 点。
 */
function installDailyTriggerAt9() {
  removeTinanzSyncTriggers_();
  ScriptApp.newTrigger('scheduledTinanzSync')
    .timeBased()
    .everyDays(1)
    .atHour(9)
    .create();
}

function removeTinanzSyncTriggers() {
  removeTinanzSyncTriggers_();
}

function removeTinanzSyncTriggers_() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'scheduledTinanzSync') {
      ScriptApp.deleteTrigger(t);
    }
  });
}

function runTinanzSyncInternal_() {
  var categoryId = getScriptString_('TINANZ_CATEGORY', '1026');
  var startId = getScriptNumber_('SYNC_START_ID', 9);
  var maxPages = getScriptNumber_('MAX_PAGES', 20);

  var products = fetchProductsFromTinanz_(categoryId, maxPages);
  var rows = convertToSheetRows_(products, startId);
  writeProductsSheet_(rows);
  return rows.length;
}

function fetchUrl_(url) {
  var resp = UrlFetchApp.fetch(url, {
    muteHttpExceptions: true,
    followRedirects: true,
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TinanzSync/1.0)' },
    timeout: 120000
  });
  var code = resp.getResponseCode();
  if (code !== 200) {
    throw new Error('HTTP ' + code + ' ' + url);
  }
  var text = resp.getContentText();
  if (!text || text.length < 1000) {
    throw new Error('响应过短，可能无法解析: ' + url);
  }
  return text;
}

function fetchProductsFromTinanz_(categoryId, maxPages) {
  var all = [];
  for (var page = 1; page <= maxPages; page++) {
    var url = 'https://www.tinanz.com/products/' + categoryId + '?p=' + page;
    var html = fetchUrl_(url);
    var parsed = parseTinanzListHtml_(html);
    if (parsed.length === 0) {
      break;
    }
    for (var i = 0; i < parsed.length; i++) {
      all.push(parsed[i]);
    }
    Utilities.sleep(300);
  }
  return all;
}

/**
 * 解析列表页 HTML（与 sync.py 同样依赖 class=items-gallery / entry-title / price1）
 */
function parseTinanzListHtml_(html) {
  var products = [];
  var chunks = html.split('<div class="items-gallery"');
  var titleRe = /class="entry-title"[^>]*>([\s\S]*?)<\/a>/i;
  var priceRe = /<span class="price1">\s*￥\s*(\d+)\s*<\/span>/i;
  var imgRe = /<img[^>]+src="([^"]+)"/i;

  for (var c = 1; c < chunks.length; c++) {
    var block = chunks[c];
    var tm = block.match(titleRe);
    var pm = block.match(priceRe);
    var im = block.match(imgRe);
    if (!tm || !pm) {
      continue;
    }
    var rawName = decodeHtmlEntities_(stripTags_(tm[1])).replace(/\s+/g, ' ').trim();
    var rmb = parseInt(pm[1], 10);
    var imgSrc = im ? im[1] : '';
    if (imgSrc.indexOf('//') === 0) {
      imgSrc = 'https:' + imgSrc;
    }
    products.push({
      name: rawName,
      price_rmb: rmb,
      image: imgSrc
    });
  }
  return products;
}

function stripTags_(s) {
  return String(s).replace(/<[^>]+>/g, '');
}

function decodeHtmlEntities_(s) {
  var t = String(s);
  t = t.replace(/&#(\d+);/g, function (_, n) {
    return String.fromCharCode(parseInt(n, 10));
  });
  t = t.replace(/&#x([0-9a-fA-F]+);/g, function (_, h) {
    return String.fromCharCode(parseInt(h, 16));
  });
  t = t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return t;
}

function classifyProduct_(name) {
  var lower = String(name).toLowerCase();
  var i;
  for (i = 0; i < CONFIG.AU_BRANDS.length; i++) {
    if (lower.indexOf(CONFIG.AU_BRANDS[i].toLowerCase()) !== -1) {
      return ['澳洲直邮', 'AU$'];
    }
  }
  for (i = 0; i < CONFIG.NZ_BRANDS.length; i++) {
    if (lower.indexOf(CONFIG.NZ_BRANDS[i].toLowerCase()) !== -1) {
      return ['新西兰直邮', 'NZ$'];
    }
  }
  return ['新西兰直邮', 'NZ$'];
}

function shouldSkip_(name) {
  var n = String(name);
  for (var i = 0; i < CONFIG.SKIP_KEYWORDS.length; i++) {
    if (n.indexOf(CONFIG.SKIP_KEYWORDS[i]) !== -1) {
      return true;
    }
  }
  return false;
}

function convertToSheetRows_(products, startId) {
  var rows = [];
  var id = startId;
  for (var i = 0; i < products.length; i++) {
    var p = products[i];
    var cleanName = String(p.name).replace(/^【[^】]+】\s*/, '').trim();
    if (shouldSkip_(cleanName)) {
      continue;
    }
    var oc = classifyProduct_(cleanName);
    var origin = oc[0];
    var currency = oc[1];
    var rmb = p.price_rmb || 0;
    var rate = currency === 'NZ$' ? CONFIG.NZD_RATE : CONFIG.AUD_RATE;
    var price = Math.round(rmb * rate * 100) / 100;
    if (price <= 0) {
      continue;
    }
    rows.push([id, cleanName, price, '', p.image || '', origin, currency, 0, true]);
    id++;
  }
  return rows;
}

function writeProductsSheet_(rows) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('Products');
  if (!sheet) {
    throw new Error('找不到工作表「Products」');
  }
  var lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    sheet.getRange(2, 1, lastRow, 9).clearContent();
  }
  if (rows.length > 0) {
    sheet.getRange(2, 1, rows.length + 1, 9).setValues(rows);
  }
}

function logSyncResult_(when, status, message) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var name = '_SyncLog';
  var sh = ss.getSheetByName(name);
  if (!sh) {
    try {
      sh = ss.insertSheet(name);
      sh.appendRow(['time', 'status', 'message']);
    } catch (e) {
      Logger.log(status + ' ' + message);
      return;
    }
  }
  sh.appendRow([when, status, message]);
}

// ----- 兼容：误删 Code.gs 里的 myFunction 时，旧触发器仍会报错；保留此桩 -----
function myFunction() {
  manualTinanzSync();
}

// ----- 常见拼写错误（下拉选错也能跑）-----
function scheduledTinanSync() {
  scheduledTinanzSync();
}
